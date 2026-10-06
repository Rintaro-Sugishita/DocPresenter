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
import { unitsBefore } from './bytes.js';
import { inWorkspace } from './paths.js';
import type { FromView, ToView } from './protocol.js';
import { exportDocument, type OpenView } from './export-command.js';

/** Text the document could refer to, and pictures it could show. */
const TEXT_FILES = '**/*.{dgm,table,mmd,ermlx,md}';
const IMAGE_FILES = '**/*.{png,jpg,jpeg,gif,webp,svg}';
const IGNORED = '**/{node_modules,out,dist,.git}/**';

export class SheetEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'docpresenter.sheets';
  /** A `.dgm` on its own: the same editor, showing just that drawing. */
  static readonly diagramViewType = 'docpresenter.diagram';

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
      void vscode.window.showInformationMessage('DocPresenter: 書き出す文書を DocPresenter で開いてください');
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
      panel.webview.html = plainPage('フォルダを開いてから使ってください'
        + '（図や表は作業場からの相対パスで引かれます）');
      return;
    }
    const root = folder.uri;
    const pathOf = (uri: vscode.Uri): string =>
      vscode.workspace.asRelativePath(uri, false).split('\\').join('/');
    const documentPath = pathOf(document.uri);
    // A drawing opened on its own is shown as a one-line document that takes
    // it in: the editor then works on it exactly as on a figure in a document,
    // and the only file it ever writes is the drawing.
    const diagram = /\.dgm$/i.test(documentPath);
    const name = documentPath.slice(documentPath.lastIndexOf('/') + 1);

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media'), root],
    };
    panel.webview.html = page(panel.webview, this.context.extensionUri, !diagram);

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
          reject(new Error('DocPresenter の画面から応答がない'));
        }, 120_000);
        waiting.set(id, message => {
          clearTimeout(timer);
          if (message.kind === answer) resolve(message as Extract<FromView, { kind: typeof answer }>);
          else reject(new Error(`思わぬ応答: ${message.kind}`));
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
      if (diagram) files[documentPath] = document.getText();
      post({
        kind: 'open',
        path: documentPath,
        source: diagram ? `@import "${name}"\n` : document.getText(),
        files, images,
        commitKey: commitKey(),
        ...(diagram ? { diagram: true } : {}),
      });
    };

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
      // The document a drawing is shown in exists only on screen.
      if (diagram && change.path === undefined) return;
      const uri = change.path === undefined
        ? document.uri
        : vscode.Uri.joinPath(root, ...change.path.split('/'));
      const target = change.path === undefined
        ? document
        : await vscode.workspace.openTextDocument(uri);
      const text = target.getText();
      const from = unitsBefore(text, change.span.start);
      const to = unitsBefore(text, change.span.end);
      // Worked out and remembered *before* the edit is applied: VS Code
      // reports the change while `applyEdit` is still running, so a note made
      // afterwards is made too late — and the editor gets told to redraw
      // itself for the edit it just made, under the author's hands.
      const path = pathOf(uri);
      applied.set(path, text.slice(0, from) + change.text + text.slice(to));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(target.positionAt(from), target.positionAt(to)), change.text);
      if (!await vscode.workspace.applyEdit(edit)) {
        applied.delete(path);
        void vscode.window.showErrorMessage(`DocPresenter: ${change.description}を書き戻せなかった`);
        return;
      }
      // A file the author never opened should not be left unsaved: a dirty
      // buffer behind a figure they edited through a picture is a state they
      // cannot see. The document itself follows VS Code's own rules — its tab
      // is right there with the dot on it.
      if (change.path !== undefined) await target.save();
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
        if (message.kind === 'change') { await apply(message); return; }
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

    panel.onDidDispose(() => {
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
<html lang="ja"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${media('theme.css')}">
<style>
  html, body { height: 100%; margin: 0; padding: 0; max-width: none; background: #fff; }
  body { display: flex; flex-direction: column; }
  #editor { flex: 1; min-height: 0; }
  /* 書き出しのボタン。編集画面の飾りであって、文書には出ない。 */
  .dp-export {
    flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 12px;
    border-bottom: 1px solid #e3e6ea; background: #f7f8fa;
    font: 12px system-ui, sans-serif; color: #3a4048;
  }
  .dp-export-label { margin-right: 2px; }
  .dp-export button {
    font: inherit; padding: 3px 12px; border: 1px solid #c9ced6; border-radius: 4px;
    background: #fff; color: #1c1f24; cursor: pointer;
  }
  .dp-export button:hover:not(:disabled) { background: #eef3fa; border-color: #1f5fa8; }
  .dp-export button:focus-visible { outline: 2px solid #1f5fa8; outline-offset: 1px; }
  .dp-export button:disabled { color: #a7aeb8; cursor: default; }
  .dp-export-status { margin-left: 8px; color: #5a6270; }
</style>
</head><body>
${exportBar ? `<div class="dp-export" role="toolbar" aria-label="書き出し">
  <span class="dp-export-label">書き出し</span>
  <button type="button" data-format="html">HTML</button>
  <button type="button" data-format="pdf">PDF</button>
  <button type="button" data-format="pptx">PPTX</button>
  <span class="dp-export-status" role="status" aria-live="polite"></span>
</div>` : ''}
<div id="editor"></div>
<script nonce="${nonce}" src="${media('webview.js')}"></script>
</body></html>`;
}

function plainPage(message: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"></head>`
    + `<body style="font: 13px system-ui; padding: 2em; color: #3a4048">${message}</body></html>`;
}
