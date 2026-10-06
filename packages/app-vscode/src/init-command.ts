// "Set this folder up for DocPresenter": asks for the first document's name and
// title, writes what `planScaffold` lays out, and opens the document.

import * as vscode from 'vscode';
import { DOCUMENT_NAME, planScaffold, type Shipped } from './scaffold.js';
import { SheetEditorProvider } from './sheet-editor.js';
import { outDirOf } from './workspace-files.js';

/** The format specs the extension ships beside the guide, in `media/init/spec/`. */
const SPECS = ['dgm.md', 'table.md', 'inline-text.md'];

export async function initWorkspace(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage('DocPresenter: フォルダを開いてから実行してください');
    return;
  }

  const title = await vscode.window.showInputBox({
    title: 'DocPresenter: 作業場を初期化する（1/3）',
    prompt: '最初の文書の題',
    placeHolder: '認証機能 設計書',
    validateInput: value => value.trim() === '' ? '題を入れてください' : undefined,
  });
  if (title === undefined) return;
  const name = await vscode.window.showInputBox({
    title: 'DocPresenter: 作業場を初期化する（2/3）',
    prompt: 'ファイル名（英小文字・数字・-）。docs/<ファイル名>.md と docs/<ファイル名>/ ができます',
    value: 'design',
    validateInput: value => DOCUMENT_NAME.test(value) ? undefined : '英小文字・数字・- で付けてください（例: auth-design）',
  });
  if (name === undefined) return;
  const number = await vscode.window.showInputBox({
    title: 'DocPresenter: 作業場を初期化する（3/3）',
    prompt: '文書番号（表紙に出ます。無ければ空のまま Enter）',
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
    void vscode.window.showErrorMessage('DocPresenter: 拡張に書き方の仕様書が入っていません（拡張をビルドし直してください）');
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
    today: localDate(new Date()), outDir: outDirOf(),
  }, shipped, path => existing.get(path));

  for (const file of plan.files) {
    const text = file.mode === 'append' ? `${existing.get(file.path) ?? ''}${file.text}` : file.text;
    await vscode.workspace.fs.writeFile(at(file.path), new TextEncoder().encode(text));
  }

  const made = plan.files.filter(file => file.mode === 'create').length;
  const added = plan.files.filter(file => file.mode === 'append').map(file => file.path);
  const said = [
    `${made} 個のファイルを作りました`,
    ...(added.length > 0 ? [`${added.join('・')} に追記しました`] : []),
    ...(plan.kept.length > 0 ? [`既にある ${plan.kept.length} 個はそのままです（${plan.kept.join('・')}）`] : []),
  ].join('。');
  void vscode.window.showInformationMessage(`DocPresenter: ${said}`);

  await vscode.commands.executeCommand('vscode.openWith', at(plan.document), SheetEditorProvider.viewType);
}

/** Today as the author's calendar has it, not UTC's. */
function localDate(now: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}
