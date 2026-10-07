// "Set this folder up for DocPresenter": asks for the first document's name and
// title, writes what `planScaffold` lays out, and opens the document.

import * as vscode from 'vscode';
import { DOCUMENT_NAME, planScaffold, type Shipped } from './scaffold.js';
import { hostLocale, t } from './l10n.js';
import { SheetEditorProvider } from './sheet-editor.js';
import { outDirOf } from './workspace-files.js';

/** The format specs the extension ships beside the guide, in `media/init/spec/`. */
const SPECS = ['dgm.md', 'table.md', 'inline-text.md'];

export async function initWorkspace(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.noFolder')}`);
    return;
  }

  const title = await vscode.window.showInputBox({
    title: t('vscode.init.step', { step: 1 }),
    prompt: t('vscode.init.title'),
    placeHolder: t('vscode.init.titleExample'),
    validateInput: value => value.trim() === '' ? t('vscode.init.titleEmpty') : undefined,
  });
  if (title === undefined) return;
  const name = await vscode.window.showInputBox({
    title: t('vscode.init.step', { step: 2 }),
    prompt: t('vscode.init.name'),
    value: 'design',
    validateInput: value => DOCUMENT_NAME.test(value) ? undefined : t('vscode.init.nameInvalid'),
  });
  if (name === undefined) return;
  const number = await vscode.window.showInputBox({
    title: t('vscode.init.step', { step: 3 }),
    prompt: t('vscode.init.number'),
    placeHolder: 'SD-AUTH-001',
  });
  if (number === undefined) return;

  const at = (path: string): vscode.Uri => vscode.Uri.joinPath(folder.uri, ...path.split('/'));
  const read = async (uri: vscode.Uri): Promise<string | undefined> => {
    try { return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)); } catch { return undefined; }
  };
  const media = (name: string): vscode.Uri => vscode.Uri.joinPath(context.extensionUri, 'media', 'init', name);

  const guide = await read(media('guide.md'));
  if (guide === undefined) {
    void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.init.noGuide')}`);
    return;
  }
  const specs: Record<string, string> = {};
  for (const spec of SPECS) {
    const text = await read(media(`spec/${spec}`));
    if (text !== undefined) specs[spec] = text;
  }
  const shipped: Shipped = { guide, specs };

  // Every path the plan might touch, read once, so the plan itself stays a
  // function of what is there.
  const candidates = [
    `docs/${name}.md`, `docs/${name}/revision.md`, 'docs/assets/.gitkeep', 'shared/glossary.table',
    '.docpresenter/guide.md', ...SPECS.map(spec => `.docpresenter/spec/${spec}`),
    'CLAUDE.md', 'AGENTS.md', '.gitignore',
  ];
  const existing = new Map<string, string>();
  for (const path of candidates) {
    const text = await read(at(path));
    if (text !== undefined) existing.set(path, text);
  }

  const plan = planScaffold({
    name, title: title.trim(), number: number.trim() || undefined,
    today: localDate(new Date()), outDir: outDirOf(), locale: hostLocale(),
  }, shipped, path => existing.get(path));

  for (const file of plan.files) {
    const text = file.mode === 'append' ? `${existing.get(file.path) ?? ''}${file.text}` : file.text;
    await vscode.workspace.fs.writeFile(at(file.path), new TextEncoder().encode(text));
  }

  const made = plan.files.filter(file => file.mode === 'create').length;
  const added = plan.files.filter(file => file.mode === 'append').map(file => file.path);
  const list = t('vscode.init.list');
  const said = [
    t('vscode.init.made', { count: made }),
    ...(added.length > 0 ? [t('vscode.init.appended', { paths: added.join(list) })] : []),
    ...(plan.kept.length > 0
      ? [t('vscode.init.kept', { count: plan.kept.length, paths: plan.kept.join(list) })] : []),
  ].join(t('vscode.init.join'));
  void vscode.window.showInformationMessage(`DocPresenter: ${said}`);

  await vscode.commands.executeCommand('vscode.openWith', at(plan.document), SheetEditorProvider.viewType);
}

/** Today as the author's calendar has it, not UTC's. */
function localDate(now: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}
