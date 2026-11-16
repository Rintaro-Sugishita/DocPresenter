// Exporting a document with what changed since an earlier version marked.
//
// The build already compares (design/diff-marking.md); the CLI asks for it
// with `--diff-from`. This is the same question asked with two pickers: which
// version to compare with, and in which format. The marked file goes beside
// the plain one (`name.changes.pdf`), so neither overwrites the other.
//
// A third question, for a page or a PDF: whether what was taken out is shown,
// struck through where it stood (`--show-removed strike`). A slide has no room
// for it, so the question is not asked for one.

import * as vscode from 'vscode';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { exportDocument, FORMAT_LABEL, type Changes, type OpenView } from './export-command.js';
import { t } from './l10n.js';
import type { ExportFormat } from './protocol.js';
import { git } from './workspace-files.js';

/** What the author picked last time, offered first next time. */
interface Remembered { readonly from?: string; readonly format?: ExportFormat; readonly showRemoved?: 'none' | 'strike' }
const MEMORY = 'docpresenter.changes';

/** One version the document can be compared with. */
export interface Version { readonly ref: string; readonly label: string; readonly detail: string; readonly kind: 'commit' | 'tag' | 'branch' }

/**
 * Versions worth comparing with, newest first: the commits that changed this
 * document, then tags, then other branches. Read from `git log` / `git tag` /
 * `git branch` output, so it can be tested without a repository.
 */
export function versionsOf(log: string, tags: string, branches: string): Version[] {
  const versions: Version[] = [];
  for (const line of log.split('\n')) {
    const [hash, when, ...subject] = line.split('\t');
    if (!hash || !when) continue;
    versions.push({ ref: hash, label: `$(git-commit) ${hash}`, detail: `${when}　${subject.join('\t')}`, kind: 'commit' });
  }
  for (const line of tags.split('\n')) {
    const [tag, when] = line.split('\t');
    if (!tag) continue;
    versions.push({ ref: tag, label: `$(tag) ${tag}`, detail: when ?? '', kind: 'tag' });
  }
  for (const line of branches.split('\n')) {
    const [branch, current] = line.split('\t');
    if (!branch || current === '*') continue;
    versions.push({ ref: branch, label: `$(git-branch) ${branch}`, detail: '', kind: 'branch' });
  }
  return versions;
}

/** The workspace's files as they were at a commit, tag or branch. */
export function atRevision(root: string, ref: string): (path: string) => string | undefined {
  return path => {
    try {
      return execFileSync('git', ['show', `${ref}:./${path}`],
        { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    } catch { return undefined; }
  };
}

/** The workspace's files as another copy of it has them. */
export function inFolder(folder: string): (path: string) => string | undefined {
  return path => { try { return readFileSync(join(folder, path), 'utf8'); } catch { return undefined; } };
}

/** Asks what to compare with and how, then exports the open document with the changes marked. */
export async function exportChanges(
  view: OpenView, context: vscode.ExtensionContext, output: vscode.OutputChannel,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.noFolder')}`); return; }
  const root = folder.uri.fsPath;
  const last = context.workspaceState.get<Remembered>(MEMORY) ?? {};

  const from = await pickVersion(root, view.documentPath, last.from);
  if (!from) return;
  const format = await pickFormat(last.format);
  if (!format) return;
  const showRemoved = format === 'pptx' ? 'none' : await pickRemoved(last.showRemoved);
  if (!showRemoved) return;
  await context.workspaceState.update(MEMORY, {
    from: from.from, format, showRemoved: format === 'pptx' ? last.showRemoved ?? 'none' : showRemoved,
  } satisfies Remembered);
  await exportDocument(view, format, context, output, { ...from, showRemoved });
}

type Picked = Omit<Changes, 'showRemoved'>;

async function pickVersion(root: string, documentPath: string, last: string | undefined): Promise<Picked | undefined> {
  if ((await git(root, ['rev-parse', '--is-inside-work-tree']))?.trim() !== 'true') {
    // Without a repository there is still another copy to compare with.
    return pickFolder();
  }
  const [log, tags, branches] = await Promise.all([
    git(root, ['log', '-n', '30', '--format=%h%x09%cs%x09%s', '--', documentPath]),
    git(root, ['tag', '--sort=-creatordate', '--format=%(refname:short)%09%(creatordate:short)']),
    git(root, ['branch', '--format=%(refname:short)%09%(HEAD)']),
  ]);
  type Item = vscode.QuickPickItem & { ref?: string; action?: 'folder' | 'type' };
  const versions = versionsOf(log ?? '', tags ?? '', branches ?? '');
  const item = (one: Version): Item => ({ label: one.label, description: one.detail, ref: one.ref });
  const remembered = last === undefined ? undefined
    : versions.find(one => one.ref === last) ?? (isFolder(last) ? undefined : { ref: last, label: `$(history) ${last}`, detail: '', kind: 'commit' as const });
  const group = (label: string): Item => ({ label, kind: vscode.QuickPickItemKind.Separator });
  const items: Item[] = [
    ...(remembered ? [group(t('vscode.changes.last')), item(remembered)] : []),
    ...section(t('vscode.changes.commits'), versions.filter(one => one.kind === 'commit')),
    ...section(t('vscode.changes.tags'), versions.filter(one => one.kind === 'tag')),
    ...section(t('vscode.changes.branches'), versions.filter(one => one.kind === 'branch')),
    group(t('vscode.changes.other')),
    { label: `$(edit) ${t('vscode.changes.type')}`, action: 'type' },
    { label: `$(folder) ${t('vscode.changes.folder')}`, action: 'folder' },
  ];
  function section(label: string, list: Version[]): Item[] {
    const rest = list.filter(one => one.ref !== remembered?.ref);
    return rest.length === 0 ? [] : [group(label), ...rest.map(item)];
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: t('vscode.changes.title'), placeHolder: t('vscode.changes.from'), matchOnDescription: true,
  });
  if (!picked) return undefined;
  if (picked.action === 'folder') return pickFolder();
  let ref = picked.ref;
  if (picked.action === 'type') {
    ref = (await vscode.window.showInputBox({
      title: t('vscode.changes.title'), prompt: t('vscode.changes.typePrompt'), placeHolder: 'HEAD~3',
      validateInput: async value => value.trim() === '' || await verified(root, value.trim())
        ? undefined : t('vscode.changes.unknown', { ref: value.trim() }),
    }))?.trim();
  }
  if (!ref) return undefined;
  if (!await verified(root, ref)) {
    void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.changes.unknown', { ref })}`);
    return undefined;
  }
  return { from: ref, read: atRevision(root, ref) };
}

async function verified(root: string, ref: string): Promise<boolean> {
  return (await git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) !== undefined;
}

function isFolder(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

async function pickFolder(): Promise<Picked | undefined> {
  const chosen = await vscode.window.showOpenDialog({
    canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
    title: t('vscode.changes.folderTitle'), openLabel: t('vscode.changes.folderOpen'),
  });
  const folder = chosen?.[0]?.fsPath;
  return folder === undefined ? undefined : { from: folder, read: inFolder(folder) };
}

/** Whether what was taken out is shown, struck through, or left out. */
async function pickRemoved(last: 'none' | 'strike' | undefined): Promise<'none' | 'strike' | undefined> {
  const choices = [
    { label: `$(diff-removed) ${t('vscode.changes.strike')}`, detail: t('vscode.changes.strikeDetail'), value: 'strike' as const },
    { label: `$(eye-closed) ${t('vscode.changes.leaveOut')}`, detail: t('vscode.changes.leaveOutDetail'), value: 'none' as const },
  ];
  const ordered = last === 'none' ? [choices[1]!, choices[0]!] : choices;
  const picked = await vscode.window.showQuickPick(ordered, { title: t('vscode.changes.title'), placeHolder: t('vscode.changes.removed') });
  return picked?.value;
}

async function pickFormat(last: ExportFormat | undefined): Promise<ExportFormat | undefined> {
  const formats: ExportFormat[] = ['pdf', 'html', 'pptx'];
  const ordered = last ? [last, ...formats.filter(one => one !== last)] : formats;
  const picked = await vscode.window.showQuickPick(
    ordered.map(format => ({ label: FORMAT_LABEL[format], format })),
    { title: t('vscode.changes.title'), placeHolder: t('vscode.changes.format') });
  return picked?.format;
}
