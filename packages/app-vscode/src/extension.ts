// What VS Code loads.
//
// Registered and nothing else at start-up: the editor for documents and for
// drawings on their own, the export buttons' commands, the commands that
// write every document at once, the one that sets a folder up, and the
// suggestions in a drawing opened as text.

import * as vscode from 'vscode';
import { registerDgmLanguage } from './dgm-language.js';
import { registerWorkspaceProblems } from './workspace-problems.js';
import { exportAll, FORMAT_LABEL } from './export-command.js';
import { initWorkspace } from './init-command.js';
import { newDocument } from './document-command.js';
import { newDiagram } from './diagram-command.js';
import { readBackDeck } from './pptx-back-command.js';
import { importReview } from './review-command.js';
import { t } from './l10n.js';
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
  // `beside` keeps the text editor where it is and opens the screen next to
  // it: both are views of one TextDocument, so what is typed in the text is
  // drawn as it is typed, and the typing keeps VS Code's own editing.
  const openInDocPresenter = async (uri: vscode.Uri | undefined, beside = false): Promise<void> => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      void vscode.window.showInformationMessage(`DocPresenter: ${t('vscode.noDocument')}`);
      return;
    }
    const viewType = /\.dgm$/i.test(target.path)
      ? SheetEditorProvider.diagramViewType : SheetEditorProvider.viewType;
    await vscode.commands.executeCommand('vscode.openWith', target, viewType,
      beside ? { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true } : undefined);
  };

  context.subscriptions.push(
    output,
    vscode.window.registerCustomEditorProvider(SheetEditorProvider.viewType, provider, options),
    vscode.window.registerCustomEditorProvider(SheetEditorProvider.diagramViewType, provider, options),
    // The editor title's button acts on the editor in front; the explorer's
    // menu hands over the file that was right-clicked.
    vscode.commands.registerCommand('docpresenter.openEditor', (uri?: vscode.Uri) => openInDocPresenter(uri)),
    vscode.commands.registerCommand('docpresenter.openToSide', (uri?: vscode.Uri) => openInDocPresenter(uri, true)),
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
          title: t('vscode.buildAs.title'),
          placeHolder: t('vscode.buildAs.placeHolder'),
        });
      if (!picked || picked.length === 0) return;
      await exportAll(context, output, picked.map(one => one.format as ExportFormat));
    }),
    // The recommended folders, a first document, and the guide an agent writes by.
    vscode.commands.registerCommand('docpresenter.init', () => initWorkspace(context)),
    // A new document with a number nobody in the repository uses.
    // From the Explorer, the folder right-clicked is where it goes.
    vscode.commands.registerCommand('docpresenter.newDocument', (target?: vscode.Uri) => newDocument(target)),
    vscode.commands.registerCommand('docpresenter.newDiagram', (target?: vscode.Uri) => newDiagram(target)),
    // A deck edited in PowerPoint, read back into the drawings it came from.
    // The explorer's menu hands over the deck that was right-clicked.
    vscode.commands.registerCommand('docpresenter.readBackPptx', (uri?: vscode.Uri) => readBackDeck(output, uri)),
    // A PDF a reviewer annotated, taken into a review file as anchored comments.
    // The explorer hands over the PDF right-clicked and every one selected with it.
    vscode.commands.registerCommand('docpresenter.importPdfReview',
      (uri?: vscode.Uri, selected?: vscode.Uri[]) => importReview(output, uri, selected)),
    // A drawing written by hand: what fits where the cursor is.
    registerDgmLanguage(),
    registerWorkspaceProblems(output),
  );
}

export function deactivate(): void { /* 後始末は subscriptions が持つ */ }
