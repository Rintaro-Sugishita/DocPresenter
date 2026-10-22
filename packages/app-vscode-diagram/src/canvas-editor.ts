// A .dgm opened on the canvas: the drawing as it will be drawn, edited by hand.
//
// The canvas is @docpresenter/diagram's; this hosts it. Every gesture comes
// back as one byte range of the text and is handed to VS Code as one
// `WorkspaceEdit`, so undo, the unsaved dot and the Git diff are VS Code's own,
// and the text editor beside the canvas shows the change as it is made.

import { replaceBytes, unitsBefore } from '@docpresenter/base';
import * as vscode from 'vscode';
import { itemTableOf, librariesUsed } from './dgm-language.js';
import { hostLocale } from './l10n.js';
import type { FromCanvas, ToCanvas } from './protocol.js';

export const CANVAS_VIEW = 'docpresenterDiagram.canvas';

export class CanvasEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
    panel.webview.html = canvasPage(panel.webview, media);

    const post = (message: ToCanvas): void => { void panel.webview.postMessage(message); };
    const send = async (kind: ToCanvas['kind']): Promise<void> => {
      const source = document.getText();
      const libraries = Object.fromEntries(await librariesUsed(document.uri, source));
      post({ kind, source, libraries, locale: hostLocale() });
    };

    /**
     * The text the last edit from the canvas left. VS Code reports that change
     * back like any other; drawing it again would redraw the canvas under the
     * author's hands for a change it already shows.
     */
    let mine: string | undefined;

    panel.webview.onDidReceiveMessage(async (message: FromCanvas) => {
      switch (message.kind) {
        case 'ready':
          await send('open');
          return;
        case 'edit': {
          if (message.path !== undefined) { await editNamed(message.path, message); return; }
          const text = document.getText();
          // An edit made against an older text would land in the wrong place.
          if (text !== message.base) { await send('update'); return; }
          const range = new vscode.Range(
            document.positionAt(unitsBefore(text, message.start)),
            document.positionAt(unitsBefore(text, message.end)));
          mine = replaceBytes(text, message.start, message.end, message.text);
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, range, message.text);
          if (!await vscode.workspace.applyEdit(edit)) { mine = undefined; await send('update'); }
          return;
        }
        case 'source':
          await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside });
          return;
        case 'error':
          void vscode.window.showErrorMessage(`DocPresenter Diagram: ${message.message}`);
          return;
      }
    });

    /**
     * Writes an edit to a file the drawing names — its item table. It is one
     * `WorkspaceEdit` like any other, so it is undone in that file, and the
     * table's own editor shows it.
     */
    const editNamed = async (path: string, message: { start: number; end: number; text: string; base: string }): Promise<void> => {
      const uri = vscode.Uri.joinPath(document.uri, '..', ...path.split('/'));
      let target: vscode.TextDocument;
      try {
        target = await vscode.workspace.openTextDocument(uri);
      } catch {
        await send('update');
        return;
      }
      const text = target.getText();
      if (text !== message.base) { await send('update'); return; }
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(
        target.positionAt(unitsBefore(text, message.start)),
        target.positionAt(unitsBefore(text, message.end))), message.text);
      if (!await vscode.workspace.applyEdit(edit)) await send('update');
    };

    const changed = vscode.workspace.onDidChangeTextDocument(event => {
      // The item table, changed here or anywhere: its numbers and marks are drawn.
      const table = itemTableOf(document.getText());
      if (table !== undefined
        && event.document.uri.toString() === vscode.Uri.joinPath(document.uri, '..', ...table.split('/')).toString()) {
        void send('update');
        return;
      }
      if (event.document.uri.toString() !== document.uri.toString()) return;
      if (document.getText() === mine) { mine = undefined; return; }
      void send('update');
    });
    panel.onDidDispose(() => changed.dispose());
  }
}

/**
 * The canvas page: the theme the drawing is styled by — the same one documents
 * are drawn with — and the script, under a policy that allows only those.
 */
function canvasPage(webview: vscode.Webview, media: vscode.Uri): string {
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  const script = webview.asWebviewUri(vscode.Uri.joinPath(media, 'canvas.js'));
  const theme = webview.asWebviewUri(vscode.Uri.joinPath(media, 'theme.css'));
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${theme}">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head><body><div id="status" role="status"></div><div id="canvas"></div>
<script nonce="${nonce}" src="${script}"></script></body></html>`;
}
