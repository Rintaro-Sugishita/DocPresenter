// A deck that came back from PowerPoint, read into the drawings it was made from.
//
// The same reading as `tools/pptx-back.mjs`, with VS Code's own ways of asking
// and writing: the deck is picked from the explorer or a file dialog, what
// would change is listed (and spelled out line by line in the output panel)
// before anything is written, and the chosen drawings are rewritten as one
// `WorkspaceEdit` — each as the smallest range that changed, so undo and the
// git diff show the edit and nothing else.

import * as vscode from 'vscode';
import { writeBack, type WriteBack } from '@docpresenter/build';
import { hostLocale, t } from './l10n.js';
import { outDirOf, readWorkspace } from './workspace-files.js';

export async function readBackDeck(
  output: Pick<vscode.OutputChannel, 'appendLine' | 'clear' | 'show'>, given?: vscode.Uri,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.noFolder')}`);
    return;
  }
  const deck = given ?? (await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: vscode.Uri.joinPath(folder.uri, ...outDirOf().split('/')),
    filters: { PowerPoint: ['pptx'] },
    openLabel: t('vscode.back.pick'),
    title: t('vscode.back.title'),
  }))?.[0];
  if (!deck) return;

  const { workspace } = await readWorkspace();
  const result = writeBack(await vscode.workspace.fs.readFile(deck), workspace, hostLocale());

  output.clear();
  output.appendLine(t('vscode.back.reading', { deck: vscode.workspace.asRelativePath(deck, false) }));
  for (const one of result.diagnostics) {
    output.appendLine(`  ${one.severity === 'error' ? '✗' : '!'} ${one.path ? `${one.path}: ` : ''}${one.message}`);
  }
  const changed = result.files.filter(file => file.text !== file.source);
  for (const file of result.files) {
    if (file.text === file.source) {
      output.appendLine(t('vscode.back.unchanged', { path: file.path }));
      continue;
    }
    output.appendLine(`${file.path}　${file.changes.join(t('vscode.back.join'))}`);
    for (const line of changedLines(file.source, file.text)) output.appendLine(`    ${line}`);
  }

  if (changed.length === 0) {
    const said = t(result.diagnostics.length > 0 ? 'vscode.back.nothingButWarnings' : 'vscode.back.nothing');
    if (result.diagnostics.length > 0) output.show(true);
    void vscode.window.showInformationMessage(`DocPresenter: ${said}`);
    return;
  }

  output.show(true);
  const picked = await vscode.window.showQuickPick(
    changed.map(file => ({ label: file.path, description: file.changes.join(t('vscode.back.join')), picked: true, file })),
    { canPickMany: true, title: t('vscode.back.title'), placeHolder: t('vscode.back.choose') });
  if (!picked || picked.length === 0) return;

  const { done, stale } = await apply(folder.uri, picked.map(one => one.file));
  const said = [
    ...(done > 0 ? [t('vscode.back.done', { count: done })] : []),
    ...(stale.length > 0 ? [t('vscode.back.stale', { paths: stale.join(t('vscode.back.list')) })] : []),
    ...(result.diagnostics.length > 0 ? [t('vscode.back.warnings', { count: result.diagnostics.length })] : []),
  ].join(t('vscode.back.sentence'));
  const show = stale.length > 0 || result.diagnostics.length > 0
    ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
  void show(`DocPresenter: ${said}`);
}

/**
 * Writes the drawings, each as the one range that differs. A drawing that is
 * not what was read — edited since, or open with unsaved changes — is left as
 * it is and named: writing over it would lose the author's change.
 */
async function apply(root: vscode.Uri, files: readonly WriteBack[]): Promise<{ done: number; stale: string[] }> {
  const edit = new vscode.WorkspaceEdit();
  const stale: string[] = [];
  const touched: vscode.TextDocument[] = [];
  for (const file of files) {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, ...file.path.split('/')));
    const now = document.getText();
    if (now !== file.source || document.isDirty) { stale.push(file.path); continue; }
    const { start, end, text } = difference(now, file.text);
    edit.replace(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(end)), text);
    touched.push(document);
  }
  if (touched.length === 0) return { done: 0, stale };
  if (!await vscode.workspace.applyEdit(edit)) return { done: 0, stale: files.map(file => file.path) };
  for (const document of touched) await document.save();
  return { done: touched.length, stale };
}

/** The one range, in UTF-16 units of `before`, that turns it into `after`. */
export function difference(before: string, after: string): { start: number; end: number; text: string } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let tail = 0;
  while (tail < before.length - start && tail < after.length - start
    && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
  // Never split a surrogate pair: the range has to be one VS Code can hold.
  if (start > 0 && /[\uD800-\uDBFF]/.test(before[start - 1]!)) start -= 1;
  return { start, end: before.length - tail, text: after.slice(start, after.length - tail) };
}

/**
 * The lines that differ, so what would be written can be read before it is:
 * the old lines between the first and the last that changed, then the new.
 */
function changedLines(before: string, after: string): string[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head
    && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  return [
    ...a.slice(head, a.length - tail).map(line => `- ${line}`),
    ...b.slice(head, b.length - tail).map(line => `+ ${line}`),
  ];
}
