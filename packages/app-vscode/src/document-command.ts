// A new document, with a number nobody in the repository is using.
//
// A document's number (`document:` in its frontmatter) is what its review
// comments are tied to, so every document has one and no two share one. The
// number is picked, not typed from memory: the series the repository already
// uses are offered with their next free number, beside a new series and a
// number of one's own — which is refused when it is taken.

import * as vscode from 'vscode';
import { documentNumberOf, firstNumber, numberSeries, suggestNumber } from '@docpresenter/markdown';
import {
  TEMPLATE_DOCUMENT, TEMPLATE_REVISION, documentFiles, documentPaths, nameProblem,
} from '@docpresenter/build';
import { hostLocale, t } from './l10n.js';
import { SheetEditorProvider } from './sheet-editor.js';

const IGNORED = '**/{node_modules,out,dist,.git,.docpresenter}/**';

/** Every document number in the workspace, with the document that has it. */
export async function numbersInUse(): Promise<Map<string, string>> {
  const used = new Map<string, string>();
  for (const uri of await vscode.workspace.findFiles('**/*.md', IGNORED)) {
    let text: string;
    try { text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)); } catch { continue; }
    const number = documentNumberOf(text);
    if (number && !used.has(number)) used.set(number, vscode.workspace.asRelativePath(uri, false).split('\\').join('/'));
  }
  return used;
}

/** Asks for a document number that no document of the workspace has. Undefined when cancelled. */
export async function pickNumber(title: string): Promise<string | undefined> {
  const used = await numbersInUse();
  const free = (number: string): string | undefined => {
    const trimmed = number.trim();
    if (trimmed === '') return t('vscode.number.empty');
    const by = used.get(trimmed);
    return by ? t('vscode.number.taken', { number: trimmed, path: by }) : undefined;
  };
  const series = numberSeries([...used.keys()]);
  type Item = vscode.QuickPickItem & { number?: string; action?: 'series' | 'custom' };
  const items: Item[] = [
    ...(series.length === 0
      ? [{ label: suggestNumber([]), description: t('vscode.number.first'), number: suggestNumber([]) }]
      : series.map(one => ({ label: one.next, description: t('vscode.number.next', { prefix: one.prefix, count: one.count }), number: one.next }))),
    { label: t('vscode.number.newSeries'), action: 'series' },
    { label: t('vscode.number.custom'), action: 'custom' },
  ];
  const picked = await vscode.window.showQuickPick(items, { title, placeHolder: t('vscode.number.pick') });
  if (!picked) return undefined;
  if (picked.number) return picked.number;
  if (picked.action === 'series') {
    const prefix = await vscode.window.showInputBox({
      title, prompt: t('vscode.number.prefix'), placeHolder: 'SD-PAY-',
      validateInput: value => value.trim() === '' ? t('vscode.number.empty') : free(firstNumber(value.trim())),
    });
    return prefix === undefined ? undefined : firstNumber(prefix.trim());
  }
  const typed = await vscode.window.showInputBox({ title, prompt: t('vscode.number.input'), validateInput: free });
  return typed?.trim();
}

/**
 * Makes a document and its revision history, numbered, and opens it. Given a
 * folder — the Explorer's "New Document" on one — it goes there; otherwise the
 * folder is asked for, beside the ones that already hold documents.
 */
export async function newDocument(target?: vscode.Uri): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.noFolder')}`);
    return;
  }
  const files = workspaceFiles(folder.uri);
  const step = (n: number): string => t('vscode.newDoc.step', { step: n });

  const title = await vscode.window.showInputBox({
    title: step(1), prompt: t('vscode.init.title'),
    placeHolder: t('vscode.init.titleExample'),
    validateInput: value => value.trim() === '' ? t('vscode.init.titleEmpty') : undefined,
  });
  if (title === undefined) return;

  const used = await numbersInUse();
  const place = folderOf(folder.uri, target) ?? await pickFolder(step(2), documentFolders([...used.values()]));
  if (place === undefined) return;

  const typed = await vscode.window.showInputBox({
    title: step(3), prompt: t('vscode.init.name'),
    validateInput: async value => {
      const name = withoutExtension(value, 'md');
      const path = documentPaths(place, name).document;
      return nameMessage(name) ?? (await files.exists(path) ? t('vscode.newDoc.exists', { path }) : undefined);
    },
  });
  if (typed === undefined) return;
  const name = withoutExtension(typed, 'md');
  const number = await pickNumber(step(4));
  if (number === undefined) return;

  const made = documentFiles({
    name, folder: place, title: title.trim(), number, today: localDate(new Date()), locale: hostLocale(),
    glossary: await files.exists('shared/glossary.table'),
  }, {
    // The team's own templates, set up with the folder and theirs to change.
    document: await files.read(TEMPLATE_DOCUMENT), revision: await files.read(TEMPLATE_REVISION),
  });
  for (const file of made) {
    // Never over what is there: the name was checked, but a revision file may
    // have been left behind by a document that was deleted.
    if (await files.exists(file.path)) continue;
    await vscode.workspace.fs.writeFile(files.at(file.path), new TextEncoder().encode(file.text));
  }
  void vscode.window.showInformationMessage(`DocPresenter: ${t('vscode.newDoc.made', { path: made[0]!.path, number })}`);
  await vscode.commands.executeCommand('vscode.openWith', files.at(made[0]!.path), SheetEditorProvider.viewType);
}

/** Reading and finding files of the workspace by their path from its root. */
export function workspaceFiles(root: vscode.Uri): {
  at(path: string): vscode.Uri;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string | undefined>;
} {
  const at = (path: string): vscode.Uri => vscode.Uri.joinPath(root, ...path.split('/').filter(Boolean));
  return {
    at,
    exists: async path => { try { await vscode.workspace.fs.stat(at(path)); return true; } catch { return false; } },
    read: async path => { try { return new TextDecoder().decode(await vscode.workspace.fs.readFile(at(path))); } catch { return undefined; } },
  };
}

/** A name with the extension the author may have typed taken off: `a.md` is `a`. */
export function withoutExtension(name: string, extension: string): string {
  return name.trim().replace(/\\/g, '/').replace(new RegExp(`\\.${extension}$`, 'i'), '');
}

/** Why a name cannot be a file name, in words, or undefined when it can. */
export function nameMessage(name: string): string | undefined {
  const problem = nameProblem(name);
  if (problem === undefined) return undefined;
  const part = name.split('/').find(one => nameProblem(one) === problem) ?? name;
  return t(`vscode.name.${problem}`, { name: part });
}

/** A folder the Explorer gave, as a path from the workspace root; undefined when none was. */
export function folderOf(root: vscode.Uri, target: vscode.Uri | undefined): string | undefined {
  if (!target || !target.path.startsWith(root.path)) return undefined;
  return target.path.slice(root.path.length).replace(/^\/+|\/+$/g, '');
}

/** A folder offered for something new: its path, and why it is offered. */
export interface FolderChoice {
  readonly path: string;
  readonly detail: string;
}

/** `docs/` first, then every folder a numbered document is in, with how many. */
export function documentFolders(documents: readonly string[]): FolderChoice[] {
  const count = new Map<string, number>([['docs', 0]]);
  for (const path of documents) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    count.set(dir, (count.get(dir) ?? 0) + 1);
  }
  return [...count].map(([path, n]) => ({
    path, detail: n === 0 ? t('vscode.folder.default') : t('vscode.folder.documents', { count: n }),
  }));
}

/**
 * Asks which folder something new goes in: one of those offered, or one typed
 * (made when it is missing). `''` is the workspace root. Undefined when cancelled.
 */
export async function pickFolder(title: string, offered: readonly FolderChoice[]): Promise<string | undefined> {
  type Item = vscode.QuickPickItem & { path?: string };
  const items: Item[] = [
    ...offered.map(one => ({ label: `${one.path || '.'}/`, description: one.detail, path: one.path })),
    { label: t('vscode.folder.other'), description: t('vscode.folder.otherDetail') },
  ];
  const picked = await vscode.window.showQuickPick(items, { title, placeHolder: t('vscode.folder.pick') });
  if (!picked) return undefined;
  if (picked.path !== undefined) return picked.path;
  const typed = await vscode.window.showInputBox({
    title, prompt: t('vscode.folder.input'), value: 'docs/',
    validateInput: value => nameMessage(value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')),
  });
  return typed?.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/** Today as the author's calendar has it, not UTC's. */
export function localDate(now: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}
