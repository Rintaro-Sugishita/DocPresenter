// DocPresenter Diagram: .dgm drawings in VS Code — written as text with colours,
// suggestions and formatting, drawn and edited on a canvas, and saved as SVG.
//
// It stands on @docpresenter/diagram alone. The document extension
// (DocPresenter) brings it along in its pack, and draws the same drawings
// inside documents with the same package.

import * as vscode from 'vscode';
import { CANVAS_VIEW, CanvasEditorProvider } from './canvas-editor.js';
import { registerDgmLanguage } from './dgm-language.js';
import { activeTabUri, exportSvg, isDiagram } from './export-svg.js';
import { exportScreen } from './export-screen.js';
import { formatDiagramFile, registerDgmFormatter } from './format-command.js';
import { diagramToMermaid, mermaidToDiagram } from './mermaid-command.js';
import { t } from './l10n.js';
import { registerItemTableFollow } from './rename-items.js';
import { registerShapeRename, renameShapeAtCursor } from './rename-shape.js';

export function activate(context: vscode.ExtensionContext): void {
  /** Opens a drawing on the canvas — in place, or beside the text it was written in. */
  const open = async (uri: vscode.Uri | undefined, beside: boolean): Promise<void> => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri ?? activeTabUri();
    if (!target || !isDiagram(target)) {
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
    // A screen as the start of the real one: an HTML page, or a WPF window.
    vscode.commands.registerCommand('docpresenterDiagram.exportHtml', (uri?: vscode.Uri) => exportScreen('html', uri)),
    vscode.commands.registerCommand('docpresenterDiagram.exportXaml', (uri?: vscode.Uri) => exportScreen('xaml', uri)),
    vscode.commands.registerCommand('docpresenterDiagram.toMermaid', (uri?: vscode.Uri) => diagramToMermaid(uri)),
    vscode.commands.registerCommand('docpresenterDiagram.fromMermaid', (uri?: vscode.Uri) => mermaidToDiagram(uri)),
    registerDgmLanguage(),
    registerDgmFormatter(),
    registerItemTableFollow(),
    registerShapeRename(),
    vscode.commands.registerCommand('docpresenterDiagram.renameShape', () => renameShapeAtCursor()),
  );
}

export function deactivate(): void { /* 後始末は subscriptions が持つ */ }
