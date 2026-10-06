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
  build, readGraph, renderPage, type Artifact, type FormatWriter,
} from '@docpresenter/build';
import { createSubsetter, writePdf, type Subsetter } from '@docpresenter/pdf';
import { systemFonts } from './pdf-fonts.js';
import type { ExportFormat, FromView, ToView } from './protocol.js';
import { outDirOf, readWorkspace } from './workspace-files.js';

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
  if (!folder) throw new Error('フォルダを開いてから実行してください');
  const { output } = options;
  output.clear();
  options.progress?.('作業場を読んでいます…');

  const { workspace, text } = await readWorkspace();
  const graph = readGraph(workspace);
  const roots = options.only === undefined ? graph.roots.map(root => root.path) : options.only;
  const wanted = new Set<string>(options.formats ?? graph.roots
    .filter(root => roots.includes(root.path)).flatMap(root => root.formats));

  // A browser only when something needs one: a PDF, or a slide with Mermaid.
  let renderer: Renderer | OpenView | undefined;
  if ((wanted.has('pdf') || wanted.has('pptx')) && options.renderer) {
    options.progress?.('組版の準備をしています…');
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
    options.progress?.('書き出しています…');
    const result = await build(workspace, {
      ...(options.only === undefined ? {} : { only: options.only }),
      ...(options.formats === undefined ? {} : { formats: options.formats }),
      outDir: outDirOf(),
      style: theme => text.get(`themes/${theme}/theme.css`) ?? options.shipped,
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
      if (trouble.message.includes('どの成果物にも含まれていない')) continue;
      if (trouble.message.includes('pdf 出力はこの環境では書けない')) continue;
      const where = trouble.path ? `${trouble.path}: ` : '';
      output.appendLine(`  ${trouble.severity === 'error' ? '✗' : '!'} ${where}${trouble.message}`);
    }
    const written: string[] = [];
    for (const artifact of result.artifacts) {
      await save(folder.uri, artifact);
      written.push(artifact.path);
      const bytes = artifact.bytes?.length ?? new TextEncoder().encode(artifact.text).length;
      const pdf = report.get(artifact.path);
      const pages = pdf ? `、${pdf.pages} ページ、${pdf.font}` : '';
      output.appendLine(`${artifact.path}（${artifact.root} → ${artifact.format}、${(bytes / 1024).toFixed(0)} KB${pages}）`);
      for (const message of pdf?.diagnostics ?? []) output.appendLine(`  ! ${message}`);
    }
    const skipped = wanted.has('pdf') && !writers['pdf'] ? ['pdf'] : [];
    if (skipped.length > 0) {
      output.appendLine('PDF は、文書を DocPresenter で開いて上の「PDF」ボタンで書き出せます'
        + '（コマンド「DocPresenter: この文書を PDF に書き出す」でも可）。');
    }
    output.appendLine(`ルート ${result.graph.roots.length} 件 / 成果物 ${result.artifacts.length} 件`);
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
  view.post({ kind: 'export-state', busy: true, message: `${label} を書き出しています…` });
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
      view.post({ kind: 'export-state', busy: false, message: `${label} を書き出せませんでした` });
      void vscode.window.showErrorMessage(`DocPresenter: ${label} を書き出せませんでした（出力パネルに理由）`);
      return;
    }
    view.post({ kind: 'export-state', busy: false, message: `${path} に書き出しました` });
    await offerToOpen(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    view.post({ kind: 'export-state', busy: false, message: `${label} を書き出せませんでした` });
    void vscode.window.showErrorMessage(`DocPresenter: ${label} を書き出せませんでした: ${message}`);
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
    const said = `${result.written.length} 件を ${outDir} に書き出しました`
      + (result.failed ? '（書けなかったものがある。出力パネルを見てください）' : '');
    const choice = await (result.failed
      ? vscode.window.showWarningMessage(`DocPresenter: ${said}`, 'フォルダに表示')
      : vscode.window.showInformationMessage(`DocPresenter: ${said}`, 'フォルダに表示'));
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (choice === 'フォルダに表示' && folder && result.written[0]) {
      await vscode.commands.executeCommand('revealFileInOS',
        vscode.Uri.joinPath(folder.uri, ...result.written[0].split('/')));
    }
  } catch (error) {
    output.show(true);
    void vscode.window.showErrorMessage(
      `DocPresenter: 書き出せませんでした: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function offerToOpen(path: string): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const uri = vscode.Uri.joinPath(folder.uri, ...path.split('/'));
  const open = await vscode.window.showInformationMessage(
    `DocPresenter: ${path} に書き出しました`, '開く', 'フォルダに表示');
  if (open === '開く') await vscode.env.openExternal(uri);
  if (open === 'フォルダに表示') await vscode.commands.executeCommand('revealFileInOS', uri);
}

/**
 * A panel that lays pages out for a batch export: a WebView with the theme
 * loaded and nothing but the script that answers the build. Shown beside the
 * editor, without taking the focus, so the author can see it working.
 */
async function openExporter(context: vscode.ExtensionContext): Promise<Renderer> {
  const panel = vscode.window.createWebviewPanel(
    'docpresenter.exporter', 'DocPresenter 書き出し',
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
<html lang="ja"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${media('theme.css')}">
<style>
  html, body { margin: 0; padding: 0; max-width: none; background: #fff; }
  .dp-exporter { font: 13px system-ui, sans-serif; color: #3a4048; padding: 24px; }
</style>
</head><body>
<div class="dp-exporter"><p>文書を組んで書き出しています。終わるとこの画面は閉じます。</p>
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
    new Promise((_, reject) => setTimeout(() => reject(new Error('書き出しの画面が開かない')), 30_000)),
  ]);
  return {
    documentPath: '',
    post,
    ask: (make, answer) => new Promise((resolve, reject) => {
      const id = ++asked;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error('書き出しの画面から応答がない'));
      }, 120_000);
      waiting.set(id, message => {
        clearTimeout(timer);
        if (message.kind === answer) resolve(message as Extract<FromView, { kind: typeof answer }>);
        else reject(new Error(`思わぬ応答: ${message.kind}`));
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
    progress?.(`${input.root.path} の PDF を組んでいます…`);
    view.post({ kind: 'export-state', busy: true, message: `${input.root.path} の PDF を組んでいます…` });
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
    const foot = [raw['document'], raw['version'] ? `版 ${String(raw['version'])}` : '']
      .filter(value => value !== undefined && value !== '').map(String).join('　');

    const measured = await view.ask(id => ({ kind: 'measure', id, body, foot, title }), 'measured');
    if (measured.error !== undefined || !measured.plan) {
      throw new Error(measured.error ?? '組版の結果が返ってこなかった');
    }
    const { bytes, missing } = await writePdf(measured.plan, { fonts: set, subset });
    for (const one of missing) input.diagnostics.push({
      severity: 'warning', path: input.root.path, message: `フォントに無い字: ${one.character}`,
    });
    const path = `${input.out}.pdf`;
    report.set(path, {
      pages: measured.plan.pages.length, font: name, diagnostics: measured.diagnostics ?? [],
    });
    return { path, bytes, root: input.root.path, format: 'pdf' };
  };
}
