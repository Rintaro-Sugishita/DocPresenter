// Formatting a .dgm written by hand: VS Code's "Format Document", and a command
// that does the same from the palette or the Explorer.
//
// What the canonical form is, and the proof that it draws the same picture, are
// @docpresenter/diagram's business. This reads the libraries a drawing uses —
// the picture depends on the parts they declare — and hands back the edit.

import { describeError, say } from '@docpresenter/base';
import { formatDiagram } from '@docpresenter/diagram';
import * as vscode from 'vscode';
import { DGM_LANGUAGE, librariesUsed } from './dgm-language.js';
import { hostLocale, t } from './l10n.js';

export function registerDgmFormatter(): vscode.Disposable {
  return vscode.languages.registerDocumentFormattingEditProvider(
    { language: DGM_LANGUAGE },
    { provideDocumentFormattingEdits: async document => (await formatEdits(document)) ?? [] },
  );
}

/**
 * The edit that formats the drawing: empty when it is already formatted,
 * undefined when it cannot be read. Only the lines that change are replaced,
 * so the cursor and the folds above and below the change stay where they were.
 */
export async function formatEdits(document: vscode.TextDocument): Promise<vscode.TextEdit[] | undefined> {
  const source = document.getText();
  const files = await librariesUsed(document.uri, source);
  let formatted;
  try {
    formatted = formatDiagram(source, path => files.get(path));
  } catch (error) {
    void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.format.unreadable', {
      path: vscode.workspace.asRelativePath(document.uri, false), message: describeError(error, hostLocale()),
    })}`);
    return undefined;
  }
  for (const note of formatted.notes) {
    void vscode.window.showInformationMessage(`DocPresenter: ${say(hostLocale(), note)}`);
  }
  if (!formatted.changed) return [];

  const { start, end, text } = changedLines(source, formatted.text);
  return [vscode.TextEdit.replace(
    new vscode.Range(document.positionAt(start), document.positionAt(end)), text)];
}

/** The smallest run of whole lines to replace to turn one text into the other. */
function changedLines(before: string, after: string): { start: number; end: number; text: string } {
  let head = 0;
  const shortest = Math.min(before.length, after.length);
  while (head < shortest && before[head] === after[head]) head++;
  head = before.lastIndexOf('\n', head - 1) + 1;

  let tail = 0;
  while (tail < shortest - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  // Back to the start of a line, so the replacement ends with whole lines.
  while (tail > 0 && before[before.length - tail - 1] !== '\n') tail--;
  return { start: head, end: before.length - tail, text: after.slice(head, after.length - tail) };
}

/**
 * Formats a drawing and saves it — the one right-clicked in the Explorer, or
 * the one in front. A drawing with unsaved changes is formatted and left
 * unsaved, so the command never saves what somebody has not decided to keep.
 */
export async function formatDiagramFile(uri?: vscode.Uri): Promise<void> {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri ?? activeTabUri();
  if (!target || !/\.dgm$/i.test(target.path)) {
    void vscode.window.showInformationMessage(`DocPresenter: ${t('vscode.format.notDiagram')}`);
    return;
  }
  const document = await vscode.workspace.openTextDocument(target);
  const path = vscode.workspace.asRelativePath(target, false);
  const unsaved = document.isDirty;
  const edits = await formatEdits(document);
  if (edits === undefined) return;
  if (edits.length === 0) {
    void vscode.window.showInformationMessage(`DocPresenter: ${t('vscode.format.already', { path })}`);
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  for (const one of edits) edit.replace(target, one.range, one.newText);
  if (!await vscode.workspace.applyEdit(edit)) return;
  if (!unsaved) await document.save();
  void vscode.window.showInformationMessage(`DocPresenter: ${t('vscode.format.done', { path })}`);
}

/** The file of the tab in front, when it is not a text editor — the canvas, say. */
function activeTabUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups?.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined;
  return input?.uri;
}
