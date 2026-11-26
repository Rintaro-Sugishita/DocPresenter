// F2 on a shape's name in the text: the shape renamed everywhere the drawing
// names it — its line, its connections, the groups and containers holding it,
// its pin, its look — and its row in the item table with it. A name that is
// taken, or that cannot be a name, is refused before anything is written.

import { unitsBefore } from '@docpresenter/base';
import { describeError } from '@docpresenter/base';
import { parseDiagram, renameItemId, renameNode, withItems } from '@docpresenter/diagram';
import * as vscode from 'vscode';
import { itemTableOf, readText } from './dgm-language.js';
import { hostLocale, t } from './l10n.js';

const NAME = /[A-Za-z0-9_぀-鿿]+/u;

/** The shape's name under the cursor, and where it is. */
function nameAt(document: vscode.TextDocument, position: vscode.Position): { range: vscode.Range; id: string } | undefined {
  const range = document.getWordRangeAtPosition(position, NAME);
  if (!range) return undefined;
  const id = document.getText(range);
  try {
    if (!parseDiagram(document.getText()).nodes.some(node => node.id === id)) return undefined;
  } catch { return undefined; }
  return { range, id };
}

/** The edits that rename `was` to `now` in the drawing and its item table, or the reason not to. */
async function renameEdits(document: vscode.TextDocument, was: string, now: string): Promise<vscode.WorkspaceEdit> {
  const text = document.getText();
  const edits = new vscode.WorkspaceEdit();
  try {
    const file = parseDiagram(text);
    const made = renameNode(file, text, was, now);
    edits.replace(document.uri, new vscode.Range(
      document.positionAt(unitsBefore(text, made.span.start)),
      document.positionAt(unitsBefore(text, made.span.end))), made.text);
    const tablePath = itemTableOf(text);
    if (tablePath !== undefined) {
      const uri = vscode.Uri.joinPath(document.uri, '..', ...tablePath.split('/'));
      const table = await readText(uri);
      if (table !== undefined) {
        const linked = withItems(file, path => (path === tablePath ? table : undefined));
        const also = renameItemId(linked, table, was, now);
        if (also) {
          const target = await vscode.workspace.openTextDocument(uri);
          const current = target.getText();
          edits.replace(uri, new vscode.Range(
            target.positionAt(unitsBefore(current, also.span.start)),
            target.positionAt(unitsBefore(current, also.span.end))), also.text);
        }
      }
    }
  } catch (error) {
    throw new Error(describeError(error, hostLocale()));
  }
  return edits;
}

/**
 * F2 in the text of a drawing: the name under the cursor, asked for again in
 * a box that refuses a name that is taken or cannot be one as it is typed.
 */
export async function renameShapeAtCursor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'dgm') return;
  const found = nameAt(editor.document, editor.selection.active);
  if (!found) {
    void vscode.window.showInformationMessage(`DocPresenter Diagram: ${t('diagramExt.rename.notShape')}`);
    return;
  }
  const document = editor.document;
  const typed = await vscode.window.showInputBox({
    title: t('diagramExt.rename.title', { id: found.id }),
    value: found.id,
    valueSelection: [0, found.id.length],
    validateInput: value => {
      const now = value.trim();
      if (now === found.id) return undefined;
      try { renameNode(parseDiagram(document.getText()), document.getText(), found.id, now); return undefined; }
      catch (error) { return describeError(error, hostLocale()); }
    },
  });
  if (typed === undefined || typed.trim() === found.id) return;
  try {
    await vscode.workspace.applyEdit(await renameEdits(document, found.id, typed.trim()));
  } catch (error) {
    void vscode.window.showErrorMessage(`DocPresenter Diagram: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function registerShapeRename(): vscode.Disposable {
  return vscode.languages.registerRenameProvider({ language: 'dgm' }, {
    prepareRename(document, position) {
      const found = nameAt(document, position);
      if (!found) throw new Error(t('diagramExt.rename.notShape'));
      return { range: found.range, placeholder: found.id };
    },
    async provideRenameEdits(document, position, newName) {
      const found = nameAt(document, position);
      if (!found) throw new Error(t('diagramExt.rename.notShape'));
      return renameEdits(document, found.id, newName.trim());
    },
  });
}
