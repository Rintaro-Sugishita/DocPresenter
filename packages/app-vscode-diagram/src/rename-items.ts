// A screen renamed takes its item table with it.
//
// A screen's item table is a file beside it named after it (`login.dgm` →
// `login-items.table`), and the screen names it on an `items "…"` line. Renaming
// the screen in the Explorer left the table under the old name: still found,
// because the line still named it, but no longer named after its screen — and
// the next screen called `login` would find someone else's table waiting.
//
// So when a drawing is renamed or moved, the table that carries its old name
// is renamed to carry the new one, beside it, and the line is rewritten. A
// table named anything else was named by someone on purpose and is left alone,
// as is one whose new name is already taken.

import * as vscode from 'vscode';
import { itemTableName } from '@docpresenter/diagram';
import { itemTableOf } from './dgm-language.js';

async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

/** The item table's rename and the drawing's new `items` line, for one drawing renamed. */
export async function followItemTable(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
  if (!/\.dgm$/i.test(oldUri.path) || !/\.dgm$/i.test(newUri.path)) return;
  const was = itemTableName(oldUri.path);
  const now = itemTableName(newUri.path);
  let document: vscode.TextDocument;
  try { document = await vscode.workspace.openTextDocument(newUri); } catch { return; }
  const text = document.getText();
  // Only the table beside it, written by its own name: the one this tool made.
  if (itemTableOf(text) !== was) return;
  const oldTable = vscode.Uri.joinPath(oldUri, '..', was);
  const newTable = vscode.Uri.joinPath(newUri, '..', now);
  if (!await exists(oldTable) || await exists(newTable)) return;

  const edit = new vscode.WorkspaceEdit();
  edit.renameFile(oldTable, newTable, { overwrite: false });
  const line = /^(\s*items\s+")([^"]+)(")/m.exec(text);
  if (line) {
    const start = line.index + line[1]!.length;
    edit.replace(newUri, new vscode.Range(document.positionAt(start), document.positionAt(start + line[2]!.length)), now);
  }
  const unsaved = document.isDirty;
  if (!await vscode.workspace.applyEdit(edit)) return;
  // Written through, as the rename itself was: the author renamed a file, and
  // a buffer left dirty by it is a change they did not make. One that held
  // unsaved work of theirs already is left for them to save.
  if (!unsaved) await document.save();
}

export function registerItemTableFollow(): vscode.Disposable {
  return vscode.workspace.onDidRenameFiles(async event => {
    for (const { oldUri, newUri } of event.files) {
      try { await followItemTable(oldUri, newUri); } catch { /* 追従できなければ元のまま */ }
    }
  });
}
