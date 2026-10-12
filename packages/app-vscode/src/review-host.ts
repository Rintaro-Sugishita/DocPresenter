// The review comments of an open document, for the editor's review mode.
//
// The comments live in `reviews/*.review.yml` (design/review-model.md §4). The
// screen is sent the ones made on this document (§3.5), each with the file it
// is anchored to as it was at the commit the comment was made on, so the
// screen can follow it through the edits since (§3.2). A comment made on the
// screen is appended to a review file the author picks, once per editor.

import * as vscode from 'vscode';
import { appendScreenComment, updateReviewEntry } from '@docpresenter/pdf';
import { difference } from './pptx-back-command.js';
import { anchorFileOf, documentNumberOf, isAbout, parseReviewFile } from '@docpresenter/markdown';
import type { Anchor, Precision } from '@docpresenter/base';
import { t } from './l10n.js';
import type { ReviewNoteMessage } from './protocol.js';
import { git } from './workspace-files.js';

const REVIEWS = '**/*.review.yml';
const IGNORED = '**/{node_modules,out,dist,.git}/**';

const pathOf = (uri: vscode.Uri): string => vscode.workspace.asRelativePath(uri, false).split('\\').join('/');

/** The comments made on `documentPath`, from every review file in the workspace. */
export async function loadNotes(root: vscode.Uri, documentPath: string, source = ''): Promise<ReviewNoteMessage[]> {
  const number = documentNumberOf(source);
  const notes: ReviewNoteMessage[] = [];
  const before = new Map<string, Promise<string | undefined>>();
  // The file as it was at a commit, asked of git once per commit and file.
  const at = (commit: string, file: string): Promise<string | undefined> => {
    const key = `${commit}:${file}`;
    if (!before.has(key)) {
      before.set(key, git(root.fsPath, ['show', `${commit}:./${file}`]).then(text => text?.replace(/\r\n/g, '\n')));
    }
    return before.get(key)!;
  };
  for (const uri of await vscode.workspace.findFiles(REVIEWS, IGNORED)) {
    const round = pathOf(uri);
    let text: string;
    try { text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)); } catch { continue; }
    for (const comment of parseReviewFile(text, round)) {
      if (!isAbout(comment, documentPath, number)) continue;
      // Followed by number to where the document is now, its own words are there.
      const file = anchorFileOf(comment, documentPath);
      // An anchor in uncommitted changes was measured on the working copy, not
      // on its commit: following it through the commit would mislead.
      const old = comment.commit && comment.file && !comment.uncommitted ? await at(comment.commit, comment.file) : undefined;
      notes.push({
        key: `${round}#${comment.id}`,
        round, id: comment.id,
        ...(file === undefined ? {} : { file }),
        ...(comment.start === undefined ? {} : { start: comment.start }),
        ...(comment.end === undefined ? {} : { end: comment.end }),
        ...(comment.quote === undefined ? {} : { quote: comment.quote }),
        ...(old === undefined ? {} : { before: old }),
        body: comment.body, status: comment.status,
        ...(comment.reply === undefined ? {} : { reply: comment.reply }),
        ...(comment.author === undefined ? {} : { author: comment.author }),
        ...(comment.date === undefined ? {} : { date: comment.date }),
        replies: comment.replies.map(one => ({ body: one.body, ...(one.author ? { author: one.author } : {}) })),
      });
    }
  }
  return notes;
}

/**
 * Adds a comment made on the screen. The review file is asked for the first
 * time and remembered in `chosen` for the rest of the editor's life. Returns
 * why it could not be added, or undefined when it was.
 */
export async function addNote(
  root: vscode.Uri, documentPath: string,
  note: { anchor: Anchor; precision: Precision; body: string },
  chosen: { file?: string },
  number?: string,
): Promise<string | undefined> {
  if (!chosen.file) {
    const day = new Date();
    const two = (n: number): string => String(n).padStart(2, '0');
    const stem = documentPath.split('/').pop()!.replace(/\.md$/i, '');
    const fresh = `reviews/${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}-${stem}.review.yml`;
    const existing = (await vscode.workspace.findFiles(REVIEWS, IGNORED)).map(pathOf).filter(path => path !== fresh).sort();
    const picked = await vscode.window.showQuickPick([
      { label: fresh, description: t('vscode.review.newFile'), path: fresh },
      ...existing.map(path => ({ label: path, description: t('vscode.review.appendTo'), path })),
    ], { title: t('vscode.reviewMode.pickTitle'), placeHolder: t('vscode.reviewMode.pickWhere') });
    if (!picked) return t('vscode.reviewMode.cancelled');
    chosen.file = picked.path;
  }
  const target = vscode.Uri.joinPath(root, ...chosen.file.split('/'));
  let document: vscode.TextDocument | undefined;
  try {
    await vscode.workspace.fs.stat(target);
    document = await vscode.workspace.openTextDocument(target);
  } catch { document = undefined; }
  if (document?.isDirty) return t('vscode.review.dirty', { path: chosen.file });

  const commit = (await git(root.fsPath, ['rev-parse', 'HEAD']))?.trim() || undefined;
  // The range was measured on the file as it is now. If that is not the commit,
  // the anchor says so (§3.3) rather than pointing into a version that differs.
  const changed = commit === undefined ? undefined
    : (await git(root.fsPath, ['status', '--porcelain', '--', note.anchor.file]))?.trim() !== '';
  const author = (await git(root.fsPath, ['config', 'user.name']))?.trim() || undefined;
  const before = document?.getText();
  const stem = documentPath.split('/').pop()!.replace(/\.md$/i, '');
  const { text } = appendScreenComment(before, {
    anchor: note.anchor, precision: note.precision, body: note.body,
    document: documentPath, date: new Date().toISOString(), ...(number ? { number } : {}),
    ...(author ? { author } : {}), ...(commit ? { commit } : {}), ...(changed ? { uncommitted: true } : {}),
  }, t('vscode.reviewMode.round', { document: stem }), chosen.file);

  if (document && before !== undefined) {
    const edit = new vscode.WorkspaceEdit();
    edit.insert(target, document.positionAt(before.length), text.slice(before.length));
    if (!await vscode.workspace.applyEdit(edit)) return t('vscode.review.writeFailed', { path: chosen.file });
    await document.save();
  } else {
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
  }
  return undefined;
}

/**
 * Sets a comment's state or answer in its review file, as the one range that
 * changes. Returns why it could not, or undefined when it did.
 */
export async function updateNote(
  root: vscode.Uri, round: string, id: number, update: { status?: string; reply?: string },
): Promise<string | undefined> {
  const uri = vscode.Uri.joinPath(root, ...round.split('/'));
  let document: vscode.TextDocument;
  try { document = await vscode.workspace.openTextDocument(uri); } catch { return t('vscode.move.missing', { path: round }); }
  if (document.isDirty) return t('vscode.review.dirty', { path: round });
  const now = document.getText();
  const next = updateReviewEntry(now.replace(/\r\n/g, '\n'), id, update);
  if (next === undefined) return t('vscode.review.noEntry', { path: round, id });
  const written = /\r\n/.test(now) ? next.replace(/\n/g, '\r\n') : next;
  if (written === now) return undefined;
  const { start, end, text } = difference(now, written);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(document.positionAt(start), document.positionAt(end)), text);
  if (!await vscode.workspace.applyEdit(edit)) return t('vscode.review.writeFailed', { path: round });
  await document.save();
  return undefined;
}

/** Calls `onChange` whenever a review file is written, made or removed. */
export function watchReviews(onChange: () => void): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(REVIEWS);
  const subscriptions = [watcher.onDidChange(onChange), watcher.onDidCreate(onChange), watcher.onDidDelete(onChange)];
  return { dispose: () => { for (const one of subscriptions) one.dispose(); watcher.dispose(); } };
}
