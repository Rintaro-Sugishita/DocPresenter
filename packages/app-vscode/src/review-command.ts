// A PDF that came back with annotations, taken into a review file.
//
// The reviewer marked up the PDF the way they always do; the PDF carries the
// map of where each line came from (packages/pdf/src/review.ts), so each
// annotation becomes a comment anchored to a file and a byte range. The
// comments are appended to a review file — a new one for the round, or one the
// author picks — and nothing already in it is rewritten.

import * as vscode from 'vscode';
import {
  appendReview, readReviewPdf, resolveAnnotations, type ResolvedAnnotation,
} from '@docpresenter/pdf';
import { describeError } from '@docpresenter/base';
import { hostLocale, t } from './l10n.js';
import { outDirOf } from './workspace-files.js';

export async function importReview(
  output: Pick<vscode.OutputChannel, 'appendLine' | 'clear' | 'show'>, given?: vscode.Uri,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.noFolder')}`);
    return;
  }
  const pdfUri = given ?? (await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: vscode.Uri.joinPath(folder.uri, ...outDirOf().split('/')),
    filters: { PDF: ['pdf'] },
    openLabel: t('vscode.review.pick'),
    title: t('vscode.review.title'),
  }))?.[0];
  if (!pdfUri) return;
  const pdfPath = vscode.workspace.asRelativePath(pdfUri, false).split('\\').join('/');

  let resolved: ResolvedAnnotation[];
  let review: Awaited<ReturnType<typeof readReviewPdf>>;
  try {
    review = await readReviewPdf(await vscode.workspace.fs.readFile(pdfUri));
    resolved = resolveAnnotations(review);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `DocPresenter: ${t('vscode.review.unreadable', { path: pdfPath, message: describeError(error, hostLocale()) })}`);
    return;
  }
  if (resolved.length === 0) {
    void vscode.window.showInformationMessage(`DocPresenter: ${t('vscode.review.none', { path: pdfPath })}`);
    return;
  }

  output.clear();
  output.appendLine(t('vscode.review.reading', { path: pdfPath, count: resolved.length }));
  if (!review.map) output.appendLine(`  ! ${t('vscode.review.noMap')}`);
  for (const one of resolved) {
    const where = one.anchor ? `${one.anchor.file} ${one.anchor.start}–${one.anchor.end}` : t('vscode.review.nowhere');
    output.appendLine(`  p.${one.annotation.page} ${one.annotation.kind}　[${t(`vscode.review.precision.${one.precision}`)}] ${where}`);
    if (one.anchor) output.appendLine(`      「${short(one.anchor.quote)}」`);
    if (one.annotation.body) output.appendLine(`      ${short(one.annotation.body)}`);
  }
  output.show(true);

  // Which review file: a new one for this round, or one already there.
  const day = new Date();
  const two = (n: number): string => String(n).padStart(2, '0');
  const stem = pdfPath.split('/').pop()!.replace(/\.pdf$/i, '');
  const fresh = `reviews/${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}-${stem}.review.yml`;
  const existing = (await vscode.workspace.findFiles('reviews/**/*.review.yml'))
    .map(uri => vscode.workspace.asRelativePath(uri, false).split('\\').join('/'))
    .filter(path => path !== fresh)
    .sort();
  const choice = await vscode.window.showQuickPick([
    { label: fresh, description: t('vscode.review.newFile'), path: fresh },
    ...existing.map(path => ({ label: path, description: t('vscode.review.appendTo'), path })),
  ], { title: t('vscode.review.title'), placeHolder: t('vscode.review.where', { count: resolved.length }) });
  if (!choice) return;

  const target = vscode.Uri.joinPath(folder.uri, ...choice.path.split('/'));
  const document = await openIfThere(target);
  if (document?.isDirty) {
    void vscode.window.showWarningMessage(`DocPresenter: ${t('vscode.review.dirty', { path: choice.path })}`);
    return;
  }
  const before = document?.getText();
  let appended;
  try {
    appended = appendReview(before, resolved, {
      round: t('vscode.review.round', { pdf: stem }),
      pdf: pdfPath,
      document: review.map?.document ?? pdfPath,
      commit: review.map?.commit ?? review.commit,
      clean: review.map?.clean,
      path: choice.path,
    });
  } catch (error) {
    void vscode.window.showErrorMessage(`DocPresenter: ${describeError(error, hostLocale())}`);
    return;
  }
  if (appended.added === 0) {
    void vscode.window.showInformationMessage(
      `DocPresenter: ${t('vscode.review.already', { path: choice.path, count: appended.skipped })}`);
    return;
  }

  // Added at the end as an edit, so undo takes it back and nothing before it moves.
  if (document) {
    const edit = new vscode.WorkspaceEdit();
    const end = document.positionAt(before!.length);
    edit.insert(target, end, appended.text.slice(before!.length));
    if (!await vscode.workspace.applyEdit(edit)) {
      void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.review.writeFailed', { path: choice.path })}`);
      return;
    }
    await document.save();
  } else {
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(appended.text));
  }

  const orphaned = resolved.filter(one => one.precision === 'none').length;
  const said = [
    t('vscode.review.done', { count: appended.added, path: choice.path }),
    ...(appended.skipped > 0 ? [t('vscode.review.skipped', { count: appended.skipped })] : []),
    ...(orphaned > 0 ? [t('vscode.review.orphaned', { count: orphaned })] : []),
    ...(review.map?.clean === false ? [t('vscode.review.uncommitted')] : []),
  ].join(t('vscode.back.sentence'));
  const show = orphaned > 0 || !review.map ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
  void show(`DocPresenter: ${said}`);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target), { preview: false });
}

async function openIfThere(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    return undefined;
  }
  return vscode.workspace.openTextDocument(uri);
}

/** One line of a long text, for the output panel. */
function short(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}
