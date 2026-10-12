// PDFs that came back with annotations, taken into review files.
//
// The reviewer marked up the PDF the way they always do; the PDF carries the
// map of where each line came from and which document it is (packages/pdf/src/
// review.ts), so each annotation becomes a comment anchored to a file and a
// byte range, on the right document. Several PDFs — one per document of a
// review round — are taken in at once: each says which document it is.
//
// Replies to the comments a PDF was sent with go under those comments, in
// their own review files. New comments go into one review file the author
// picks, a new one for the round or one already there, and nothing already in
// any of them is rewritten.

import * as vscode from 'vscode';
import {
  appendReplies, appendReview, planImport, readReviewPdf, resolveAnnotations,
  type ImportPlan, type PdfReply, type ReviewPdf,
} from '@docpresenter/pdf';
import { difference } from './pptx-back-command.js';
import { describeError } from '@docpresenter/base';
import { hostLocale, t } from './l10n.js';
import { outDirOf } from './workspace-files.js';

/** One PDF, read and sorted. */
interface Read {
  readonly path: string;
  readonly review: ReviewPdf;
  readonly plan: ImportPlan;
}

/**
 * Takes in the PDFs given — the one right-clicked, or every one selected in
 * the explorer — or asks for them.
 */
export async function importReview(
  output: Pick<vscode.OutputChannel, 'appendLine' | 'clear' | 'show'>,
  given?: vscode.Uri, selected?: readonly vscode.Uri[],
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.noFolder')}`);
    return;
  }
  const uris = selected && selected.length > 0 ? selected.filter(uri => /\.pdf$/i.test(uri.path))
    : given ? [given]
      : await vscode.window.showOpenDialog({
        canSelectMany: true,
        defaultUri: vscode.Uri.joinPath(folder.uri, ...outDirOf().split('/')),
        filters: { PDF: ['pdf'] },
        openLabel: t('vscode.review.pick'),
        title: t('vscode.review.title'),
      }) ?? [];
  if (uris.length === 0) return;

  const reads: Read[] = [];
  for (const uri of uris) {
    const path = vscode.workspace.asRelativePath(uri, false).split('\\').join('/');
    try {
      const review = await readReviewPdf(await vscode.workspace.fs.readFile(uri));
      // What the PDF was sent with is ours; a reply to it goes under the
      // comment it answers; everything else is a new comment.
      reads.push({ path, review, plan: planImport(resolveAnnotations(review), review.map?.written) });
    } catch (error) {
      void vscode.window.showErrorMessage(
        `DocPresenter: ${t('vscode.review.unreadable', { path, message: describeError(error, hostLocale()) })}`);
    }
  }
  const fresh = reads.reduce((sum, one) => sum + one.plan.fresh.length, 0);
  const replies = new Map<string, PdfReply[]>();
  for (const one of reads) {
    for (const [round, list] of one.plan.replies) replies.set(round, [...(replies.get(round) ?? []), ...list]);
  }
  const replyCount = [...replies.values()].reduce((sum, list) => sum + list.length, 0);
  if (fresh === 0 && replyCount === 0) {
    void vscode.window.showInformationMessage(`DocPresenter: ${t('vscode.review.none', { path: reads.map(one => one.path).join(t('vscode.back.list')) })}`);
    return;
  }

  output.clear();
  for (const { path, review, plan } of reads) {
    output.appendLine(t('vscode.review.reading', { path, count: plan.fresh.length + [...plan.replies.values()].flat().length }));
    if (review.map) output.appendLine(`  ${t('vscode.review.forDocument', { document: review.map.document, number: review.map.number ?? '—' })}`);
    else output.appendLine(`  ! ${t('vscode.review.noMap')}`);
    if (plan.ours > 0) output.appendLine(`  ${t('vscode.review.ours', { count: plan.ours })}`);
    for (const [round, list] of plan.replies) {
      for (const reply of list) {
        output.appendLine(`  ${t('vscode.review.replyTo', { path: round, id: reply.id })}`);
        output.appendLine(`      ${short(reply.body)}`);
      }
    }
    for (const one of plan.fresh) {
      const where = one.anchor ? `${one.anchor.file} ${one.anchor.start}–${one.anchor.end}` : t('vscode.review.nowhere');
      output.appendLine(`  p.${one.annotation.page} ${one.annotation.kind}　[${t(`vscode.review.precision.${one.precision}`)}] ${where}`);
      if (one.anchor) output.appendLine(`      「${short(one.anchor.quote)}」`);
      if (one.annotation.body) output.appendLine(`      ${short(one.annotation.body)}`);
    }
  }
  output.show(true);

  // Replies, each under its comment in that comment's review file.
  let repliesAdded = 0;
  let repliesSkipped = 0;
  for (const [round, list] of replies) {
    const uri = vscode.Uri.joinPath(folder.uri, ...round.split('/'));
    const document = await openIfThere(uri);
    if (!document) { repliesSkipped += list.length; continue; }
    if (document.isDirty) {
      void vscode.window.showWarningMessage(`DocPresenter: ${t('vscode.review.dirty', { path: round })}`);
      repliesSkipped += list.length;
      continue;
    }
    const now = document.getText();
    const placed = appendReplies(now, list);
    repliesSkipped += placed.skipped;
    if (placed.added === 0) continue;
    const { start, end, text } = difference(now, placed.text);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(document.positionAt(start), document.positionAt(end)), text);
    if (!await vscode.workspace.applyEdit(edit)) {
      void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.review.writeFailed', { path: round })}`);
      continue;
    }
    await document.save();
    repliesAdded += placed.added;
  }
  if (fresh === 0) {
    const said = [
      t('vscode.review.repliesDone', { count: repliesAdded }),
      ...(repliesSkipped > 0 ? [t('vscode.review.skipped', { count: repliesSkipped })] : []),
    ].join(t('vscode.back.sentence'));
    void vscode.window.showInformationMessage(`DocPresenter: ${said}`);
    return;
  }

  // Which review file the new comments go into: a new one for this round, or
  // one already there. One PDF names it after the PDF; several, after the day.
  const day = new Date();
  const two = (n: number): string => String(n).padStart(2, '0');
  const withFresh = reads.filter(one => one.plan.fresh.length > 0);
  const stem = withFresh.length === 1 ? withFresh[0]!.path.split('/').pop()!.replace(/\.pdf$/i, '') : 'review';
  const freshFile = `reviews/${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}-${stem}.review.yml`;
  const existing = (await vscode.workspace.findFiles('reviews/**/*.review.yml'))
    .map(uri => vscode.workspace.asRelativePath(uri, false).split('\\').join('/'))
    .filter(path => path !== freshFile)
    .sort();
  const choice = await vscode.window.showQuickPick([
    { label: freshFile, description: t('vscode.review.newFile'), path: freshFile },
    ...existing.map(path => ({ label: path, description: t('vscode.review.appendTo'), path })),
  ], {
    title: t('vscode.review.title'),
    placeHolder: withFresh.length === 1
      ? t('vscode.review.where', { count: fresh })
      : t('vscode.review.whereMany', { count: fresh, pdfs: withFresh.length }),
  });
  if (!choice) return;

  const target = vscode.Uri.joinPath(folder.uri, ...choice.path.split('/'));
  const document = await openIfThere(target);
  if (document?.isDirty) {
    void vscode.window.showWarningMessage(`DocPresenter: ${t('vscode.review.dirty', { path: choice.path })}`);
    return;
  }
  const before = document?.getText();
  // Each PDF's comments in turn, each with its own document, number and commit.
  let text = before;
  let added = 0;
  let skipped = 0;
  try {
    for (const { path, review, plan } of withFresh) {
      const appended = appendReview(text, plan.fresh, {
        round: t('vscode.review.round', { pdf: stem }),
        pdf: path,
        document: review.map?.document ?? path,
        number: review.map?.number,
        commit: review.map?.commit ?? review.commit,
        clean: review.map?.clean,
        path: choice.path,
      });
      if (appended.added > 0) text = appended.text;
      added += appended.added;
      skipped += appended.skipped;
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`DocPresenter: ${describeError(error, hostLocale())}`);
    return;
  }
  if (added === 0 || text === undefined) {
    const replied = repliesAdded > 0 ? `${t('vscode.review.repliesDone', { count: repliesAdded })}${t('vscode.back.sentence')}` : '';
    void vscode.window.showInformationMessage(
      `DocPresenter: ${replied}${t('vscode.review.already', { path: choice.path, count: skipped })}`);
    return;
  }

  // Added at the end as an edit, so undo takes it back and nothing before it moves.
  if (document && before !== undefined) {
    const edit = new vscode.WorkspaceEdit();
    edit.insert(target, document.positionAt(before.length), text.slice(before.length));
    if (!await vscode.workspace.applyEdit(edit)) {
      void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.review.writeFailed', { path: choice.path })}`);
      return;
    }
    await document.save();
  } else {
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
  }

  const orphaned = withFresh.reduce((sum, one) => sum + one.plan.fresh.filter(c => c.precision === 'none').length, 0);
  const noMap = reads.some(one => !one.review.map);
  const said = [
    t('vscode.review.done', { count: added, path: choice.path }),
    ...(repliesAdded > 0 ? [t('vscode.review.repliesDone', { count: repliesAdded })] : []),
    ...(skipped > 0 ? [t('vscode.review.skipped', { count: skipped })] : []),
    ...(orphaned > 0 ? [t('vscode.review.orphaned', { count: orphaned })] : []),
    ...(reads.some(one => one.review.map?.clean === false) ? [t('vscode.review.uncommitted')] : []),
  ].join(t('vscode.back.sentence'));
  const show = orphaned > 0 || noMap ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
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
