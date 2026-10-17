// DocPresenter Diagram: .dgm drawings in VS Code — written as text with colours,
// suggestions and formatting, drawn and edited on a canvas, and saved as SVG.
//
// It stands on @docpresenter/diagram alone. The document extension
// (DocPresenter) brings it along in its pack, and draws the same drawings
// inside documents with the same package.

import * as vscode from 'vscode';
import { CANVAS_VIEW, CanvasEditorProvider } from './canvas-editor.js';
import { registerDgmLanguage } from './dgm-language.js';
import { activeTabUri, exportSvg } from './export-svg.js';
import { formatDiagramFile, registerDgmFormatter } from './format-command.js';
import { t } from './l10n.js';

export function activate(context: vscode.ExtensionContext): void {
  /** Opens a drawing on the canvas — in place, or beside the text it was written in. */
  const open = async (uri: vscode.Uri | undefined, beside: boolean): Promise<void> => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri ?? activeTabUri();
    if (!target || !/\.dgm$/i.test(target.path)) {
      void vscode.window.showInformationMessage(`DocPresenter Diagram: ${t('diagramExt.notDiagram')}`);
      return;
    }
    await vscode.commands.executeCommand('vscode.openWith', target, CANVAS_VIEW,
      beside ? { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true } : undefined);
  };

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(CANVAS_VIEW, new CanvasEditorProvider(context.extensionUri), {
      webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand('docpresenterDiagram.open', (uri?: vscode.Uri) => open(uri, false)),
    vscode.commands.registerCommand('docpresenterDiagram.openToSide', (uri?: vscode.Uri) => open(uri, true)),
    vscode.commands.registerCommand('docpresenterDiagram.format', (uri?: vscode.Uri) => formatDiagramFile(uri)),
    vscode.commands.registerCommand('docpresenterDiagram.exportSvg',
      (uri?: vscode.Uri) => exportSvg(context.extensionUri, uri)),
    registerDgmLanguage(),
    registerDgmFormatter(),
  );
}

export function deactivate(): void { /* 後始末は subscriptions が持つ */ }
