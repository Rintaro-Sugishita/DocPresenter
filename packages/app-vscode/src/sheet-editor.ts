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

/** Text the document could refer to, and pictures it could show. */
const TEXT_FILES = '**/*.{dgm,table,mmd,ermlx,md}';
const IMAGE_FILES = '**/*.{png,jpg,jpeg,gif,webp,svg}';
const IGNORED = '**/{node_modules,out,dist,.git}/**';

export class SheetEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'docpresenter.sheets';

  constructor(private readonly context: vscode.ExtensionContext) {}

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

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media'), root],
    };
    panel.webview.html = page(panel.webview, this.context.extensionUri);

    const post = (message: ToView): void => { void panel.webview.postMessage(message); };

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

    panel.onDidDispose(() => { watching.dispose(); settings.dispose(); });
  }
}

function commitKey(): 'ctrl-enter' | 'enter' | 'shift-enter' | 'alt-enter' {
  const written = vscode.workspace.getConfiguration('docpresenter').get<string>('commitKey');
  return written === 'enter' || written === 'shift-enter' || written === 'alt-enter'
    ? written : 'ctrl-enter';
}

/** The page the WebView loads: our own script, the theme, and nothing else. */
function page(webview: vscode.Webview, extensionUri: vscode.Uri): string {
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
  #editor { min-height: 0; }
</style>
</head><body>
<div id="editor"></div>
<script nonce="${nonce}" src="${media('webview.js')}"></script>
</body></html>`;
}

function plainPage(message: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"></head>`
    + `<body style="font: 13px system-ui; padding: 2em; color: #3a4048">${message}</body></html>`;
}
