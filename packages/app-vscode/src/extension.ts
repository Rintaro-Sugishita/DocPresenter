// What VS Code loads.
//
// Two things are registered and nothing else happens at start-up: a custom
// editor for Markdown documents, and a command that builds the workspace.

import * as vscode from 'vscode';
import { runBuild } from './build-command.js';
import { SheetEditorProvider } from './sheet-editor.js';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('DocPresenter');
  context.subscriptions.push(
    output,
    vscode.window.registerCustomEditorProvider(
      SheetEditorProvider.viewType,
      new SheetEditorProvider(context),
      // The document stays open behind the editor, so switching to the text
      // and back does not throw away the view's state.
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false },
    ),
    vscode.commands.registerCommand('docpresenter.openEditor', async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri) {
        void vscode.window.showInformationMessage('DocPresenter: 開く文書がありません');
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', uri, SheetEditorProvider.viewType);
    }),
    vscode.commands.registerCommand('docpresenter.build', async () => {
      // The theme the extension ships, read once per build. A workspace that
      // carries its own is answered from the workspace instead.
      let shipped: string | undefined;
      try {
        shipped = new TextDecoder().decode(await vscode.workspace.fs.readFile(
          vscode.Uri.joinPath(context.extensionUri, 'media', 'theme.css')));
      } catch { /* テーマが読めなくても、作業場のものがあれば出る */ }
      await runBuild(output, shipped);
    }),
  );
}

export function deactivate(): void { /* 後始末は subscriptions が持つ */ }
