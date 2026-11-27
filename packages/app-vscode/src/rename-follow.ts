// A figure's file renamed in the Explorer takes the documents with it.
//
// The editor's own "名前・題・ラベル" moves a file and rewrites every
// `@import` that names it in one step. A rename made anywhere else — the
// Explorer, a drag between folders, the item table a renamed screen took with
// it — left the documents pointing at a file that was no longer there. Every
// document that imports a renamed file is pointed at its new name; a rename
// the editor made itself has already done this, and finds nothing left to do.

import * as vscode from 'vscode';
import { retargetImports } from '@docpresenter/markdown';
import { unitsBefore } from './bytes.js';

const IGNORED = '**/{node_modules,out,dist,.git}/**';

const pathOf = (uri: vscode.Uri): string => vscode.workspace.asRelativePath(uri, false).split('\\').join('/');

/** The `@import` lines of every document that names one of the files renamed, rewritten. */
export async function followRenames(files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[]): Promise<void> {
  // Documents themselves are not imported; folders are followed file by file
  // by VS Code's own event for each, so only files with an extension count.
  const moved = files
    .filter(one => !/\.md$/i.test(one.oldUri.path) && /\.[^/]+$/.test(one.oldUri.path))
    .map(one => ({ from: pathOf(one.oldUri), to: pathOf(one.newUri) }));
  if (moved.length === 0) return;
  const edit = new vscode.WorkspaceEdit();
  const touched: vscode.TextDocument[] = [];
  for (const uri of await vscode.workspace.findFiles('**/*.md', IGNORED)) {
    let document: vscode.TextDocument;
    try { document = await vscode.workspace.openTextDocument(uri); } catch { continue; }
    const text = document.getText();
    if (!text.includes('@import')) continue;
    let any = false;
    for (const { from, to } of moved) {
      let replacements;
      try { replacements = retargetImports(text, pathOf(uri), from, to); } catch { continue; }
      for (const one of replacements) {
        edit.replace(uri, new vscode.Range(
          document.positionAt(unitsBefore(text, one.span.start)),
          document.positionAt(unitsBefore(text, one.span.end))), one.text);
        any = true;
      }
    }
    // One with unsaved work of the author's is left unsaved.
    if (any && !document.isDirty) touched.push(document);
  }
  if (edit.size === 0) return;
  if (!await vscode.workspace.applyEdit(edit)) return;
  for (const document of touched) await document.save();
}

export function registerRenameFollow(): vscode.Disposable {
  return vscode.workspace.onDidRenameFiles(event => {
    void followRenames(event.files).catch(() => { /* 追従できなければ元のまま */ });
  });
}
