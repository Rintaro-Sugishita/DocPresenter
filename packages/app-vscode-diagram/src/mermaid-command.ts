// A drawing written as a Mermaid flowchart, and a flowchart written as a
// drawing. Each opens as a new, unsaved document beside the one it came from:
// nothing is overwritten, and what to keep is the author's to save.
//
// The conversion itself is @docpresenter/diagram's. What it could not carry
// across is said in one message, so a lost click handler is never silent.

import { describeError, say } from '@docpresenter/base';
import { fromMermaid, parseDiagram, toMermaid, withParts, type Converted } from '@docpresenter/diagram';
import * as vscode from 'vscode';
import { DGM_LANGUAGE, librariesUsed } from './dgm-language.js';
import { activeTabUri, isDiagram } from './export-svg.js';
import { hostLocale, t } from './l10n.js';

/** The drawing in front (or the one right-clicked), as a Mermaid flowchart. */
export async function diagramToMermaid(uri?: vscode.Uri): Promise<void> {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri ?? activeTabUri();
  if (!target || !isDiagram(target)) {
    void vscode.window.showInformationMessage(`DocPresenter Diagram: ${t('diagramExt.notDiagram')}`);
    return;
  }
  const document = await vscode.workspace.openTextDocument(target);
  const source = document.getText();
  let made: Converted;
  try {
    const files = await librariesUsed(target, source);
    made = toMermaid(withParts(parseDiagram(source), path => files.get(path)), hostLocale());
  } catch (error) {
    void vscode.window.showErrorMessage(`DocPresenter Diagram: ${t('diagramExt.mermaid.failed', {
      message: describeError(error, hostLocale()),
    })}`);
    return;
  }
  await show(made, 'mermaid');
}

/**
 * The flowchart in front as a drawing: the selection when there is one — a
 * ```mermaid block picked out of a document — or the whole text.
 */
export async function mermaidToDiagram(uri?: vscode.Uri): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  let source: string | undefined;
  if (uri !== undefined && uri.toString() !== editor?.document.uri.toString()) {
    source = (await vscode.workspace.openTextDocument(uri)).getText();
  } else if (editor) {
    source = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
  }
  if (source === undefined || source.trim() === '') {
    void vscode.window.showInformationMessage(`DocPresenter Diagram: ${t('diagramExt.mermaid.nothing')}`);
    return;
  }
  let made: Converted;
  try {
    made = fromMermaid(source, hostLocale());
  } catch (error) {
    void vscode.window.showErrorMessage(`DocPresenter Diagram: ${t('diagramExt.mermaid.failed', {
      message: describeError(error, hostLocale()),
    })}`);
    return;
  }
  await show(made, DGM_LANGUAGE);
}

/** Opens what was made beside the text it came from, and says what was left behind. */
async function show(made: Converted, language: string): Promise<void> {
  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument({ language, content: made.text });
  } catch {
    // A language VS Code does not know (no Mermaid extension installed) is
    // opened as plain text: the words are what matter.
    document = await vscode.workspace.openTextDocument({ content: made.text });
  }
  await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside });
  if (made.notes.length > 0) {
    const notes = made.notes.map(note => say(hostLocale(), note)).join(' / ');
    void vscode.window.showInformationMessage(`DocPresenter Diagram: ${t('diagramExt.mermaid.notes', { notes })}`);
  }
}
