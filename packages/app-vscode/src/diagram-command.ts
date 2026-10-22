// A new diagram: its kind asked first — `flow`, laid out from its arrows, or
// `free`, drawn where the shapes are put — then where it goes and its name.
//
// A diagram usually belongs to one document, so the folders offered first are
// the documents' own (`docs/auth-design/` beside `docs/auth-design.md`), then
// the ones that already hold diagrams, then `shared/` for those several
// documents use.

import * as vscode from 'vscode';
import { starterDiagram, type DiagramKind } from '@docpresenter/editor/starter';
import { itemTableName, newItemTable, parseDiagram, starterScreen, withParts } from '@docpresenter/diagram';
import {
  folderOf, nameMessage, numbersInUse, pickFolder, withoutExtension, workspaceFiles, type FolderChoice,
} from './document-command.js';
import { hostLocale, t } from './l10n.js';
import { openDrawing } from './drawing.js';

const IGNORED = '**/{node_modules,out,dist,.git,.docpresenter}/**';

export async function newDiagram(target?: vscode.Uri): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.noFolder')}`);
    return;
  }
  const files = workspaceFiles(folder.uri);
  const step = (n: number): string => t('vscode.newDiagram.step', { step: n });

  type KindItem = vscode.QuickPickItem & { layout: DiagramKind | 'screen' };
  const kinds: KindItem[] = [
    { label: t('vscode.newDiagram.flow'), detail: t('vscode.newDiagram.flowDetail'), layout: 'flow' },
    { label: t('vscode.newDiagram.free'), detail: t('vscode.newDiagram.freeDetail'), layout: 'free' },
    { label: t('vscode.newDiagram.screen'), detail: t('vscode.newDiagram.screenDetail'), layout: 'screen' },
  ];
  const kind = (await vscode.window.showQuickPick(kinds, { title: step(1), placeHolder: t('vscode.newDiagram.kind') }))?.layout;
  if (kind === undefined) return;

  const place = folderOf(folder.uri, target) ?? await pickFolder(step(2), await diagramFolders(files.exists));
  if (place === undefined) return;

  const pathOf = (name: string): string => `${[place, name].filter(Boolean).join('/')}.dgm`;
  const typed = await vscode.window.showInputBox({
    title: step(3), prompt: t('vscode.newDiagram.name'),
    validateInput: async value => {
      const name = withoutExtension(value, 'dgm');
      return nameMessage(name)
        ?? (await files.exists(pathOf(name)) ? t('vscode.newDoc.exists', { path: pathOf(name) }) : undefined);
    },
  });
  if (typed === undefined) return;
  const path = pathOf(withoutExtension(typed, 'dgm'));

  if (kind === 'screen') {
    // The screen and its item table together, so nobody writes the link by
    // hand. A table already there under that name is used, not written over.
    const table = itemTableName(path);
    const tablePath = [place, table].filter(Boolean).join('/');
    const source = starterScreen(table, hostLocale());
    await vscode.workspace.fs.writeFile(files.at(path), new TextEncoder().encode(source));
    if (!await files.exists(tablePath)) {
      const made = newItemTable(withParts(parseDiagram(source), () => undefined), hostLocale());
      await vscode.workspace.fs.writeFile(files.at(tablePath), new TextEncoder().encode(made));
    }
  } else {
    await vscode.workspace.fs.writeFile(files.at(path), new TextEncoder().encode(starterDiagram(kind, hostLocale())));
  }
  void vscode.window.showInformationMessage(`DocPresenter: ${t('vscode.newDiagram.made', { path })}`);
  await openDrawing(files.at(path));
}

/**
 * The folders a diagram is likely to go in: each numbered document's own
 * folder, every folder that already holds diagrams, and `shared/`.
 */
async function diagramFolders(exists: (path: string) => Promise<boolean>): Promise<FolderChoice[]> {
  const offered = new Map<string, string>();
  for (const document of [...(await numbersInUse()).values()].sort()) {
    const own = document.replace(/\.md$/i, '');
    offered.set(own, t('vscode.folder.companion', { path: document }));
  }
  const diagrams = new Map<string, number>();
  for (const uri of await vscode.workspace.findFiles('**/*.dgm', IGNORED)) {
    const path = vscode.workspace.asRelativePath(uri, false).split('\\').join('/');
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    diagrams.set(dir, (diagrams.get(dir) ?? 0) + 1);
  }
  for (const [dir, count] of [...diagrams].sort()) {
    if (!offered.has(dir)) offered.set(dir, t('vscode.folder.diagrams', { count }));
  }
  if (!offered.has('shared') && await exists('shared')) offered.set('shared', t('vscode.folder.shared'));
  return [...offered].map(([path, detail]) => ({ path, detail }));
}
