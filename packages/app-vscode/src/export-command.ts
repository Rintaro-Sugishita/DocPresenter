// Writing documents as HTML, PDF or PPTX from inside VS Code.
//
// One routine, three ways in: the buttons above an open document, the commands
// that write every document with an `output:` (as each one asks, or in formats
// the author picks), and the older build command. All of them are the same
// build as the CLI. What only a browser can do — laying a page out for a PDF,
// drawing Mermaid as a picture for a slide — is asked of a WebView: the open
// document's own, or, for a batch, a panel opened for the purpose. The PDF
// itself is written here, from the plan the WebView measured — the same split
// the CLI makes with its own browser.

import * as vscode from 'vscode';
import {
  build, readGraph, renderPage, reviewSourceOf, themeOf, type Artifact, type FormatWriter,
} from '@docpresenter/build';
import { createSubsetter, writePdf, type Subsetter } from '@docpresenter/pdf';
import { BUILD_MESSAGES } from '@docpresenter/build';
import { describeError } from '@docpresenter/base';
import { hostLocale, t } from './l10n.js';
import { systemFonts } from './pdf-fonts.js';
import type { ExportFormat, FromView, ToView } from './protocol.js';
import { gitState, outDirOf, readWorkspace } from './workspace-files.js';

/** A WebView that answers the build's requests: an open editor, or the export panel. */
export interface OpenView {
  readonly documentPath: string;
  post(message: ToView): void;
  /** Sends a request and waits for the WebView's answer to it. */
  ask<K extends FromView['kind']>(
    make: (id: number) => ToView, answer: K,
  ): Promise<Extract<FromView, { kind: K }>>;
}

/** A WebView that is only borrowed for one export, and closed afterwards. */
export interface Renderer extends OpenView {
  dispose(): void;
}

export const FORMAT_LABEL: Readonly<Record<ExportFormat, string>> = {
  html: 'HTML', pdf: 'PDF', pptx: 'PPTX',
};

/** What a write-out needs from wherever it runs. */
export interface WriteOutOptions {
  /** Only these documents; every document with an `output:` when absent. */
  readonly only?: readonly string[];
  /** These formats, instead of what each document's `output:` asks for. */
  readonly formats?: readonly ExportFormat[];
  /**
   * A browser for PDF and Mermaid pictures, opened only if one is needed.
   * Without one, PDF is not written and slides show Mermaid as code.
   */
  readonly renderer?: () => Promise<Renderer | OpenView | undefined>;
  /** Reads a file the extension ships in `media/`. */
  readonly media?: (name: string) => Promise<Uint8Array | undefined>;
  /** The theme to use when the workspace has none of its own. */
  readonly shipped?: string;
  readonly output: Pick<vscode.OutputChannel, 'appendLine' | 'clear' | 'show'>;
  /** How far it has got, for whoever is showing it. */
  readonly progress?: (message: string) => void;
}

export interface WriteOutResult {
  /** Workspace paths of what was written. */
  readonly written: readonly string[];
  readonly failed: boolean;
  /** Formats that were asked for and could not be written here. */
  readonly skipped: readonly string[];
}

let subsetter: Promise<Subsetter> | undefined;

/** Builds, writes the artifacts into the workspace, and reports in the output panel. */
export async function writeOut(options: WriteOutOptions): Promise<WriteOutResult> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error(t('vscode.noFolder'));
  const { output } = options;
  const locale = hostLocale();
  output.clear();
  options.progress?.(t('vscode.export.reading'));

  const { workspace, text } = await readWorkspace();
  const graph = readGraph(workspace, locale);
  const roots = options.only === undefined ? graph.roots.map(root => root.path) : options.only;
  const wanted = new Set<string>(options.formats ?? graph.roots
    .filter(root => roots.includes(root.path)).flatMap(root => root.formats));

  // A browser only when something needs one: a PDF, or a slide with Mermaid.
  let renderer: Renderer | OpenView | undefined;
  if ((wanted.has('pdf') || wanted.has('pptx')) && options.renderer) {
    options.progress?.(t('vscode.export.preparing'));
    renderer = await options.renderer();
  }
  try {
    const decode = (bytes: Uint8Array | undefined): string | undefined =>
      bytes === undefined ? undefined : new TextDecoder().decode(bytes);
    const mermaidScript = wanted.has('html') ? decode(await options.media?.('mermaid-page.js')) : undefined;
    const report = new Map<string, PdfReport>();
    const writers: Record<string, FormatWriter> = {};
    const wasm = wanted.has('pdf') && renderer ? await options.media?.('harfbuzz-subset.wasm') : undefined;
    if (renderer && wasm) writers['pdf'] = await pdfWriter(renderer, wasm, report, options.progress);

    const view = renderer;
    options.progress?.(t('vscode.export.writing'));
    // The commit goes into the PDF, so an annotated copy that comes back says
    // which version the reviewer read.
    const git = await gitState(folder.uri.fsPath);
    const result = await build(workspace, {
      locale,
      ...git,
      reviewNotes: vscode.workspace.getConfiguration('docpresenter').get<boolean>('pdfReviewNotes') !== false,
      ...(options.only === undefined ? {} : { only: options.only }),
      ...(options.formats === undefined ? {} : { formats: options.formats }),
      outDir: outDirOf(),
      style: theme => themeOf(path => text.get(path), theme) ?? options.shipped,
      builtAt: new Date().toISOString(),
      writers,
      ...(mermaidScript === undefined ? {} : { mermaidScript }),
      ...(view === undefined ? {} : {
        mermaidPicture: async (source: string) => {
          const answer = await view.ask(id => ({ kind: 'picture', id, source }), 'pictured');
          if (answer.error !== undefined) throw new Error(answer.error);
          return answer.picture;
        },
      }),
    });

    for (const trouble of result.diagnostics) {
      if (trouble.id === 'build.orphan') continue;
      if (trouble.id === 'build.noWriter' && trouble.message.includes('pdf')) continue;
      const where = trouble.path ? `${trouble.path}: ` : '';
      output.appendLine(`  ${trouble.severity === 'error' ? '✗' : '!'} ${where}${trouble.message}`);
    }
    const written: string[] = [];
    for (const artifact of result.artifacts) {
      await save(folder.uri, artifact);
      written.push(artifact.path);
      const bytes = artifact.bytes?.length ?? new TextEncoder().encode(artifact.text).length;
      const pdf = report.get(artifact.path);
      const pages = pdf ? t('vscode.export.pages', { pages: pdf.pages, font: pdf.font }) : '';
      output.appendLine(t('vscode.export.artifact', {
        path: artifact.path, root: artifact.root, format: artifact.format,
        size: (bytes / 1024).toFixed(0), pages,
      }));
      for (const message of pdf?.diagnostics ?? []) output.appendLine(`  ! ${message}`);
    }
    const skipped = wanted.has('pdf') && !writers['pdf'] ? ['pdf'] : [];
    if (skipped.length > 0) {
      output.appendLine(t('vscode.export.pdfHint'));
    }
    output.appendLine(t('vscode.export.summary', {
      roots: result.graph.roots.length, artifacts: result.artifacts.length,
    }));
    return {
      written,
      failed: result.diagnostics.some(one => one.severity === 'error'),
      skipped,
    };
  } finally {
    if (renderer && 'dispose' in renderer) renderer.dispose();
  }
}

async function save(root: vscode.Uri, artifact: Artifact): Promise<void> {
  const bytes = artifact.bytes ?? new TextEncoder().encode(artifact.text);
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, ...artifact.path.split('/')), bytes);
}

/** Reads a file the extension ships. */
export function mediaOf(context: vscode.ExtensionContext): (name: string) => Promise<Uint8Array | undefined> {
  return async name => {
    try {
      return await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'media', name));
    } catch {
      return undefined;
    }
  };
}

/** The open document, written in one format — the buttons above it. */
export async function exportDocument(
  view: OpenView, format: ExportFormat, context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): Promise<void> {
  const label = FORMAT_LABEL[format];
  view.post({ kind: 'export-state', busy: true, message: t('vscode.export.busy', { format: label }) });
  try {
    // Saved first: the build reads the files on disk, and an export of what
    // the file said a minute ago is not what the author is looking at.
    await vscode.workspace.textDocuments
      .find(document => vscode.workspace.asRelativePath(document.uri, false).split('\\').join('/') === view.documentPath)
      ?.save();
    const media = mediaOf(context);
    const result = await writeOut({
      only: [view.documentPath], formats: [format], output, media,
      shipped: new TextDecoder().decode(await media('theme.css') ?? new Uint8Array()),
      renderer: async () => view,
    });
    const path = result.written[0];
    if (!path) {
      output.show(true);
      view.post({ kind: 'export-state', busy: false, message: t('vscode.export.failed', { format: label }) });
      void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.export.failedSeeOutput', { format: label })}`);
      return;
    }
    view.post({ kind: 'export-state', busy: false, message: t('vscode.export.done', { path }) });
    await offerToOpen(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    view.post({ kind: 'export-state', busy: false, message: t('vscode.export.failed', { format: label }) });
    void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.export.failedBecause', { format: label, message })}`);
  }
}

/**
 * Every document with an `output:` — in the formats each one asks for, or in
 * the formats given. A panel is opened to lay the pages out when a PDF or a
 * Mermaid picture is needed, and closed when the export is done.
 */
export async function exportAll(
  context: vscode.ExtensionContext, output: vscode.OutputChannel,
  formats?: readonly ExportFormat[],
): Promise<void> {
  // Every open document is saved first, for the same reason a single one is.
  await vscode.workspace.saveAll(false);
  const media = mediaOf(context);
  const shipped = new TextDecoder().decode(await media('theme.css') ?? new Uint8Array());
  try {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'DocPresenter',
      cancellable: false,
    }, async progress => writeOut({
      ...(formats === undefined ? {} : { formats }),
      output, media, shipped,
      renderer: () => openExporter(context),
      progress: message => progress.report({ message }),
    }));
    output.show(true);
    const outDir = outDirOf();
    const said = t('vscode.export.batchDone', { count: result.written.length, outDir })
      + (result.failed ? t('vscode.export.batchSomeFailed') : '');
    const reveal = t('vscode.export.reveal');
    const choice = await (result.failed
      ? vscode.window.showWarningMessage(`DocPresenter: ${said}`, reveal)
      : vscode.window.showInformationMessage(`DocPresenter: ${said}`, reveal));
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (choice === reveal && folder && result.written[0]) {
      await vscode.commands.executeCommand('revealFileInOS',
        vscode.Uri.joinPath(folder.uri, ...result.written[0].split('/')));
    }
  } catch (error) {
    output.show(true);
    void vscode.window.showErrorMessage(
      `DocPresenter: ${t('vscode.export.batchFailed', { message: describeError(error, hostLocale()) })}`);
  }
}

async function offerToOpen(path: string): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const uri = vscode.Uri.joinPath(folder.uri, ...path.split('/'));
  const opening = t('vscode.export.open');
  const reveal = t('vscode.export.reveal');
  const open = await vscode.window.showInformationMessage(
    `DocPresenter: ${t('vscode.export.done', { path })}`, opening, reveal);
  if (open === opening) await vscode.env.openExternal(uri);
  if (open === reveal) await vscode.commands.executeCommand('revealFileInOS', uri);
}

/**
 * A panel that lays pages out for a batch export: a WebView with the theme
 * loaded and nothing but the script that answers the build. Shown beside the
 * editor, without taking the focus, so the author can see it working.
 */
async function openExporter(context: vscode.ExtensionContext): Promise<Renderer> {
  const panel = vscode.window.createWebviewPanel(
    'docpresenter.exporter', t('vscode.export.panelTitle'),
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] },
  );
  const webview = panel.webview;
  const media = (name: string): vscode.Uri =>
    webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', name));
  const nonce = Array.from({ length: 32 }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[
      Math.floor(Math.random() * 62)]).join('');
  webview.html = `<!doctype html>
<html lang="${hostLocale()}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${media('theme.css')}">
<style>
  html, body { margin: 0; padding: 0; max-width: none; background: #fff; }
  .dp-exporter { font: 13px system-ui, sans-serif; color: #3a4048; padding: 24px; }
</style>
</head><body>
<div class="dp-exporter"><p>${t('vscode.export.panelBody')}</p>
<p class="dp-exporter-status" role="status" aria-live="polite"></p></div>
<script nonce="${nonce}" src="${media('exporter.js')}"></script>
</body></html>`;

  let asked = 0;
  const waiting = new Map<number, (message: FromView) => void>();
  let ready: () => void = () => undefined;
  const opened = new Promise<void>(resolve => { ready = resolve; });
  const listening = webview.onDidReceiveMessage((message: FromView) => {
    if (message.kind === 'ready') { ready(); return; }
    if (message.kind === 'measured' || message.kind === 'pictured') {
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
    }
  });
  const post = (message: ToView): void => { void webview.postMessage(message); };
  await Promise.race([
    opened,
    new Promise((_, reject) => setTimeout(() => reject(new Error(t('vscode.export.panelNotOpen'))), 30_000)),
  ]);
  return {
    documentPath: '',
    post,
    ask: (make, answer) => new Promise((resolve, reject) => {
      const id = ++asked;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(t('vscode.export.panelNoAnswer')));
      }, 120_000);
      waiting.set(id, message => {
        clearTimeout(timer);
        if (message.kind === answer) resolve(message as Extract<FromView, { kind: typeof answer }>);
        else reject(new Error(t('vscode.unexpected', { kind: message.kind })));
      });
      post(make(id));
    }),
    dispose: () => { listening.dispose(); panel.dispose(); },
  };
}

/** What the PDF writer has to say beyond the file itself. */
interface PdfReport { readonly pages: number; readonly font: string; readonly diagnostics: readonly string[] }

/**
 * The PDF, from a page a WebView lays out. The page is rendered here, as the
 * build renders it for HTML; the WebView sets it in the theme it already has
 * loaded, draws its Mermaid, and measures; the PDF is written here from that.
 */
async function pdfWriter(
  view: OpenView, wasm: Uint8Array, report: Map<string, PdfReport>,
  progress?: (message: string) => void,
): Promise<FormatWriter> {
  const { set, name } = await systemFonts();
  subsetter ??= createSubsetter(new Uint8Array(wasm));
  const subset = await subsetter;

  return async input => {
    const composing = t('vscode.export.composing', { path: input.root.path });
    progress?.(composing);
    view.post({ kind: 'export-state', busy: true, message: composing });
    const html = renderPage({
      workspace: input.workspace,
      document: input.prepared.document,
      resolved: input.prepared.resolved,
      // The WebView has the theme already; the page brings only its body.
      style: '',
      root: input.root.path,
      ...(input.inlined === undefined ? {} : { inlined: input.inlined }),
      ...(input.marks === undefined ? {} : { marks: input.marks }),
    });
    const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'));
    const raw = input.root.document.frontmatter.raw;
    const title = String(raw['title'] ?? '');
    const { locale } = input.prepared.resolved;
    const version = raw['version']
      ? BUILD_MESSAGES.in(locale)('build.foot.version', { version: String(raw['version']) }) : '';
    const foot = [raw['document'], version]
      .filter(value => value !== undefined && value !== '').map(String).join('　');

    // Laid out in the theme the document is built with — the team's own when
    // the workspace has one — not the one the WebView happens to have loaded.
    const measured = await view.ask(id => ({ kind: 'measure', id, body, foot, title, locale, style: input.style }), 'measured');
    if (measured.error !== undefined || !measured.plan) {
      throw new Error(measured.error ?? t('vscode.export.noPlan'));
    }
    const { bytes, missing } = await writePdf(measured.plan, { fonts: set, subset, review: reviewSourceOf(input) });
    for (const one of missing) input.diagnostics.push({
      severity: 'warning', path: input.root.path,
      message: t('vscode.export.missingGlyph', { character: one.character }),
    });
    const path = `${input.out}.pdf`;
    report.set(path, {
      pages: measured.plan.pages.length, font: name, diagnostics: measured.diagnostics ?? [],
    });
    return { path, bytes, root: input.root.path, format: 'pdf' };
  };
}
