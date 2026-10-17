// Drawings belong to the diagram extension (DocPresenter Diagram), which this
// extension's pack brings along. This one opens a .dgm on that extension's
// canvas, and as text when the canvas is not there to open it on.

import * as vscode from 'vscode';

/** The diagram extension, as VS Code names it. */
export const DIAGRAM_EXTENSION = 'docpresenter.docpresenter-diagram';
/** Its canvas, by the view type it registers. */
export const DIAGRAM_CANVAS = 'docpresenterDiagram.canvas';

export async function openDrawing(uri: vscode.Uri, beside = false): Promise<void> {
  const column = beside ? { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true } : undefined;
  if (vscode.extensions?.getExtension(DIAGRAM_EXTENSION)) {
    await vscode.commands.executeCommand('vscode.openWith', uri, DIAGRAM_CANVAS, column);
    return;
  }
  await vscode.window.showTextDocument(uri, column);
}
