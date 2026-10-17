// The document, open as sheets, inside VS Code.
//
// A `CustomTextEditorProvider` rather than a window of our own: VS Code keeps
// owning the file. Undo, the dot on the tab, Save, the git gutter and everyone
// else's view of the same buffer all keep working, because every edit this
// extension makes is a `WorkspaceEdit` over the range the editor named — the
// same byte range the product writes into a commit.
//
// The editor itself runs in the WebView and knows nothing about any of this
// (packages/editor is handed callbacks, not a platform). What crosses between
// them is in protocol.ts.

import * as vscode from 'vscode';
import { spanInFile } from '@docpresenter/base';
import { retargetImports } from '@docpresenter/markdown';
import { unitsBefore } from './bytes.js';
import { inWorkspace } from './paths.js';
import type { FromView, ToView } from './protocol.js';
import { hostLocale, t } from './l10n.js';
import { exportDocument, type OpenView } from './export-command.js';
import { addNote, loadNotes, updateNote, watchReviews } from './review-host.js';
import { documentNumberOf, parseDocument } from '@docpresenter/markdown';
import { themePaths } from '@docpresenter/build';
import { PAGE_STYLE } from './page-style.js';

/** Text the document could refer to, and pictures it could show. */
const TEXT_FILES = '**/*.{dgm,table,mmd,ermlx,md}';
const IMAGE_FILES = '**/*.{png,jpg,jpeg,gif,webp,svg}';
const IGNORED = '**/{node_modules,out,dist,.git}/**';

export class SheetEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'docpresenter.sheets';

  /** Every open editor, so a command can act on the one in front. */
  private readonly views = new Map<vscode.WebviewPanel, OpenView>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  /** The DocPresenter editor the author is looking at, if any. */
  activeView(): OpenView | undefined {
    for (const [panel, view] of this.views) if (panel.active) return view;
    return undefined;
  }

  /** Writes the document in the editor in front as HTML, PDF or PPTX. */
  async export(format: 'html' | 'pdf' | 'pptx'): Promise<void> {
    const view = this.activeView();
    if (!view) {
      void vscode.window.showInformationMessage(`DocPresenter: ${t('vscode.openFirst')}`);
      return;
    }
    await exportDocument(view, format, this.context, this.output);
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) {
      panel.webview.html = plainPage(t('vscode.noFolderPage'));
      return;
    }
    const root = folder.uri;
    const pathOf = (uri: vscode.Uri): string =>
      vscode.workspace.asRelativePath(uri, false).split('\\').join('/');
    const documentPath = pathOf(document.uri);

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media'), root],
    };
    panel.webview.html = page(panel.webview, this.context.extensionUri, true);

    const post = (message: ToView): void => { void panel.webview.postMessage(message); };

    // A request the WebView answers — laying a page out, drawing a picture —
    // is matched to its answer by number.
    let asked = 0;
    const waiting = new Map<number, (message: FromView) => void>();
    const view: OpenView = {
      documentPath,
      post,
      ask: (make, answer) => new Promise((resolve, reject) => {
        const id = ++asked;
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(new Error(t('vscode.noAnswer')));
        }, 120_000);
        waiting.set(id, message => {
          clearTimeout(timer);
          if (message.kind === answer) resolve(message as Extract<FromView, { kind: typeof answer }>);
          else reject(new Error(t('vscode.unexpected', { kind: message.kind })));
        });
        post(make(id));
      }),
    };
    this.views.set(panel, view);

    /**
     * What this extension has just written, by path.
     *
     * VS Code reports every change to a document, including the ones made
     * here. Sending those back would redraw the editor under the author's
     * hands — and lose the place — for a change it already knows about.
     */
    const applied = new Map<string, string>();

    const open = async (): Promise<void> => {
      const files: Record<string, string> = {};
      for (const uri of await vscode.workspace.findFiles(TEXT_FILES, IGNORED)) {
        try {
          files[pathOf(uri)] = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        } catch { /* 読めないものは無いものとして扱う（診断は描画側が出す） */ }
      }
      const images: Record<string, string> = {};
      for (const uri of await vscode.workspace.findFiles(IMAGE_FILES, IGNORED)) {
        images[pathOf(uri)] = panel.webview.asWebviewUri(uri).toString();
      }
      post({
        kind: 'open',
        path: documentPath,
        source: document.getText(),
        files, images,
        commitKey: commitKey(),
        locale: hostLocale(),
      });
      await sendReviews();
      await sendTheme();
    };

    /**
     * The workspace's own theme for this document, to the screen — so what is
     * edited looks as it will be printed. Nothing when it has none.
     */
    const sendTheme = async (): Promise<void> => {
      const raw = parseFrontmatter(document.getText());
      const name = typeof raw['theme'] === 'string' ? raw['theme'] : 'default';
      let css: string | undefined;
      for (const path of themePaths(name)) {
        try { css = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, ...path.split('/')))); break; } catch { /* 次の置き場所へ */ }
      }
      post(css === undefined ? { kind: 'theme' } : { kind: 'theme', css });
    };

    /** The review comments on this document, to the screen. */
    const sendReviews = async (): Promise<void> => {
      post({ kind: 'reviews', notes: await loadNotes(root, documentPath, document.getText()) });
    };
    /** The review file comments made here go into, once one was picked. */
    const reviewFile: { file?: string } = {};

    const write = async (path: string, bytes: Uint8Array): Promise<void> => {
      const uri = vscode.Uri.joinPath(root, ...path.split('/'));
      await vscode.workspace.fs.writeFile(uri, bytes);
    };

    /**
     * Applies one edit to one file, as the range it was given.
     *
     * The whole text comes with the message and writing that would be simpler,
     * but then every edit is a whole-file change: the undo step would swallow
     * the file, and anybody else looking at the same buffer would have their
     * place taken away. A byte range is what the product promises, so a byte
     * range is what VS Code is handed.
     */
    const apply = async (change: Extract<FromView, { kind: 'change' }>): Promise<void> => {
      const uri = change.path === undefined
        ? document.uri
        : vscode.Uri.joinPath(root, ...change.path.split('/'));
      const target = change.path === undefined
        ? document
        : await vscode.workspace.openTextDocument(uri);
      const text = target.getText();
      // The range was measured on the file read as LF (protocol.ts); a CRLF
      // file has it further along, and takes the new text with CRLF too.
      const { span, text: written } = spanInFile(text, change);
      const from = unitsBefore(text, span.start);
      const to = unitsBefore(text, span.end);
      // Worked out and remembered *before* the edit is applied: VS Code
      // reports the change while `applyEdit` is still running, so a note made
      // afterwards is made too late — and the editor gets told to redraw
      // itself for the edit it just made, under the author's hands.
      const path = pathOf(uri);
      applied.set(path, text.slice(0, from) + written + text.slice(to));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(target.positionAt(from), target.positionAt(to)), written);
      if (!await vscode.workspace.applyEdit(edit)) {
        applied.delete(path);
        void vscode.window.showErrorMessage(
          `DocPresenter: ${t('vscode.writeBackFailed', { description: change.description })}`);
        return;
      }
      // A file the author never opened should not be left unsaved: a dirty
      // buffer behind a figure they edited through a picture is a state they
      // cannot see. The document itself follows VS Code's own rules — its tab
      // is right there with the dot on it.
      if (change.path !== undefined) await target.save();
    };

    /**
     * Moves a figure's file and points every other document at it, as one
     * `WorkspaceEdit` — one step to undo, and nothing half done if it fails.
     * The document on screen is left out: its editor rewrites it with the
     * `change` that follows, as a byte range like every other edit.
     */
    const move = async (from: string, to: string): Promise<void> => {
      const at = (path: string): vscode.Uri => vscode.Uri.joinPath(root, ...path.split('/'));
      const edit = new vscode.WorkspaceEdit();
      edit.renameFile(at(from), at(to), { overwrite: false });
      const others: vscode.TextDocument[] = [];
      for (const uri of await vscode.workspace.findFiles('**/*.md', IGNORED)) {
        if (uri.toString() === document.uri.toString()) continue;
        const other = await vscode.workspace.openTextDocument(uri);
        const text = other.getText();
        let replacements;
        try { replacements = retargetImports(text, pathOf(uri), from, to); } catch { continue; }
        for (const one of replacements) {
          edit.replace(uri, new vscode.Range(
            other.positionAt(unitsBefore(text, one.span.start)),
            other.positionAt(unitsBefore(text, one.span.end))), one.text);
        }
        // One with unsaved work of the author's is left unsaved: saving it
        // would write their half-finished change along with ours.
        if (replacements.length > 0 && !other.isDirty) others.push(other);
      }
      if (!await vscode.workspace.applyEdit(edit)) {
        void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.move.failed', { from, to })}`);
        await open();
        return;
      }
      // Written through, as an edit to a figure's own file is: the author is
      // looking at this document, not at the others that were brought along.
      for (const other of others) await other.save();
    };

    // Messages that change files are handled one at a time, in the order they
    // were sent: a rename and the document edit after it touch the same lines.
    // Answers to the host's own questions are not queued — an export waits for
    // them, and queueing them behind it would wait for ever.
    let writing: Promise<void> = Promise.resolve();
    const inTurn = (work: () => Promise<void>): Promise<void> => {
      writing = writing.then(work, work);
      return writing;
    };

    panel.webview.onDidReceiveMessage(async (message: FromView) => {
      try {
        if (message.kind === 'ready') { await open(); return; }
        if (message.kind === 'measured' || message.kind === 'pictured') {
          waiting.get(message.id)?.(message);
          waiting.delete(message.id);
          return;
        }
        if (message.kind === 'export') {
          await exportDocument(view, message.format, this.context, this.output);
          return;
        }
        if (message.kind === 'change') { await inTurn(() => apply(message)); return; }
        if (message.kind === 'move') { await inTurn(() => move(message.from, message.to)); return; }
        if (message.kind === 'review-update') {
          await inTurn(async () => {
            const refused = await updateNote(root, message.round, message.id, {
              ...(message.status === undefined ? {} : { status: message.status }),
              ...(message.reply === undefined ? {} : { reply: message.reply }),
            });
            if (refused !== undefined) void vscode.window.showWarningMessage(`DocPresenter: ${refused}`);
            await sendReviews();
          });
          return;
        }
        if (message.kind === 'review-add') {
          await inTurn(async () => {
            const refused = await addNote(root, documentPath, message, reviewFile, documentNumberOf(document.getText()));
            if (refused !== undefined) void vscode.window.showWarningMessage(`DocPresenter: ${refused}`);
            await sendReviews();
          });
          return;
        }
        if (message.kind === 'create') {
          const bytes = message.bytes
            ? Uint8Array.from(message.bytes)
            : new TextEncoder().encode(message.text ?? '');
          await write(message.path, bytes);
          if (message.bytes) {
            const uri = vscode.Uri.joinPath(root, ...message.path.split('/'));
            post({ kind: 'image', path: message.path, url: panel.webview.asWebviewUri(uri).toString() });
          }
          return;
        }
        if (message.kind === 'error') {
          void vscode.window.showWarningMessage(`DocPresenter: ${message.message}`);
        }
      } catch (error) {
        void vscode.window.showErrorMessage(
          `DocPresenter: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    // Somebody else's change — a text editor on the same file, a git checkout,
    // a formatter. The editor is told, because what it is showing is now out
    // of date, and showing a file's old text is the one thing a tool like this
    // must never do.
    const watching = vscode.workspace.onDidChangeTextDocument(event => {
      const path = pathOf(event.document.uri);
      const text = event.document.getText();
      if (applied.get(path) === text) return;
      applied.delete(path);
      const relevant = event.document.uri.toString() === document.uri.toString()
        || /\.(dgm|table|mmd|ermlx|md)$/i.test(path);
      if (relevant) post({ kind: 'file', path, text });
    });

    const settings = vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('docpresenter.commitKey')) {
        post({ kind: 'settings', commitKey: commitKey() });
      }
    });

    const reviews = watchReviews(() => { void sendReviews(); });
    // A theme saved, made or removed is on the screen at once.
    const themeWatcher = vscode.workspace.createFileSystemWatcher('**/themes/**/theme.css');
    const themeChanged = [themeWatcher.onDidChange, themeWatcher.onDidCreate, themeWatcher.onDidDelete]
      .map(on => on(() => { void sendTheme(); }));

    panel.onDidDispose(() => {
      reviews.dispose();
      for (const one of themeChanged) one.dispose();
      themeWatcher.dispose();
      watching.dispose();
      settings.dispose();
      this.views.delete(panel);
    });
  }
}

function commitKey(): 'ctrl-enter' | 'enter' | 'shift-enter' | 'alt-enter' {
  const written = vscode.workspace.getConfiguration('docpresenter').get<string>('commitKey');
  return written === 'enter' || written === 'shift-enter' || written === 'alt-enter'
    ? written : 'ctrl-enter';
}

/** A document's frontmatter, or nothing when it has none or it cannot be read. */
function parseFrontmatter(source: string): Readonly<Record<string, unknown>> {
  try { return parseDocument(source).frontmatter.raw; } catch { return {}; }
}

/** The page the WebView loads: our own script, the theme, and nothing else. */
function page(webview: vscode.Webview, extensionUri: vscode.Uri, exportBar = true): string {
  const media = (name: string): vscode.Uri =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', name));
  // A nonce, so the only script that runs is the one shipped with the
  // extension. Pictures come from the workspace through webview URIs, and
  // fonts and styles from the extension — nothing reaches the network.
  const nonce = Array.from({ length: 32 }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[
      Math.floor(Math.random() * 62)]).join('');
  return `<!doctype html>
<html lang="${hostLocale()}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${media('theme.css')}">
<style>
${PAGE_STYLE}
</style>
</head><body>
${exportBar ? `<div class="dp-export" role="toolbar" aria-label="${t('vscode.exportBar')}">
  <span class="dp-modes" role="group" aria-label="${t('vscode.mode.group')}">
    <button type="button" data-mode="edit" aria-pressed="true">${t('vscode.mode.edit')}</button>
    <button type="button" data-mode="view" aria-pressed="false">${t('vscode.mode.view')}</button>
  </span>
  <label class="dp-marks" title="${t('vscode.mode.marksTitle')}"><input type="checkbox" checked> ${t('vscode.mode.marks')}</label>
  <span class="dp-bar-gap"></span>
  <span class="dp-export-label">${t('vscode.exportBar')}</span>
  <button type="button" data-format="html">HTML</button>
  <button type="button" data-format="pdf">PDF</button>
  <button type="button" data-format="pptx">PPTX</button>
  <span class="dp-export-status" role="status" aria-live="polite"></span>
</div>` : ''}
<div class="dp-main"><div id="editor"></div><aside class="dp-review-panel" hidden></aside></div>
<script nonce="${nonce}" src="${media('webview.js')}"></script>
</body></html>`;
}

function plainPage(message: string): string {
  return `<!doctype html><html lang="${hostLocale()}"><head><meta charset="utf-8"></head>`
    + `<body style="font: 13px system-ui; padding: 2em; color: #3a4048">${message}</body></html>`;
}
