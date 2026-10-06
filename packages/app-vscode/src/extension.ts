// What VS Code loads.
//
// Registered and nothing else at start-up: the editor for documents and for
// drawings on their own, the export buttons' commands, the commands that
// write every document at once, and the one that sets a folder up.

import * as vscode from 'vscode';
import { exportAll, FORMAT_LABEL } from './export-command.js';
import { initWorkspace } from './init-command.js';
import type { ExportFormat } from './protocol.js';
import { SheetEditorProvider } from './sheet-editor.js';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('DocPresenter');
  const provider = new SheetEditorProvider(context, output);
  // The document stays open behind the editor, so switching to the text and
  // back does not throw away the view's state.
  const options = {
    webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false,
  };

  /** Opens a document or a drawing in DocPresenter. */
  const openInDocPresenter = async (uri: vscode.Uri | undefined): Promise<void> => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      void vscode.window.showInformationMessage('DocPresenter: 開く文書がありません');
      return;
    }
    const viewType = /\.dgm$/i.test(target.path)
      ? SheetEditorProvider.diagramViewType : SheetEditorProvider.viewType;
    await vscode.commands.executeCommand('vscode.openWith', target, viewType);
  };

  context.subscriptions.push(
    output,
    vscode.window.registerCustomEditorProvider(SheetEditorProvider.viewType, provider, options),
    vscode.window.registerCustomEditorProvider(SheetEditorProvider.diagramViewType, provider, options),
    // The editor title's button acts on the editor in front; the explorer's
    // menu hands over the file that was right-clicked.
    vscode.commands.registerCommand('docpresenter.openEditor', (uri?: vscode.Uri) => openInDocPresenter(uri)),
    vscode.commands.registerCommand('docpresenter.exportHtml', () => provider.export('html')),
    vscode.commands.registerCommand('docpresenter.exportPdf', () => provider.export('pdf')),
    vscode.commands.registerCommand('docpresenter.exportPptx', () => provider.export('pptx')),
    // Every document with an `output:`, in the formats each one names.
    vscode.commands.registerCommand('docpresenter.build', () => exportAll(context, output)),
    // Every document with an `output:`, in the formats picked here instead.
    vscode.commands.registerCommand('docpresenter.buildAs', async () => {
      const picked = await vscode.window.showQuickPick(
        (['html', 'pdf', 'pptx'] as const).map(format => ({
          label: FORMAT_LABEL[format], format, picked: format === 'html',
        })),
        {
          canPickMany: true,
          title: 'DocPresenter: 出力対象をすべて書き出す',
          placeHolder: '書き出す形式を選んでください（各文書の output: の指定より優先します）',
        });
      if (!picked || picked.length === 0) return;
      await exportAll(context, output, picked.map(one => one.format as ExportFormat));
    }),
    // The recommended folders, a first document, and the guide an agent writes by.
    vscode.commands.registerCommand('docpresenter.init', () => initWorkspace(context)),
  );
}

export function deactivate(): void { /* 後始末は subscriptions が持つ */ }
