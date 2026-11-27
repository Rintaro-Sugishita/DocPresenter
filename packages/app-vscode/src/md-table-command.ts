// What is done with the tables written straight into a document, and the
// document written out as one Markdown file.
//
// A table typed in the prose is quick to start and awkward to keep: Excel
// cannot edit it, and the document's diff fills with it. So it can be moved
// into a `.table` of its own (named as the editor names a new one), looked at
// in Excel, or made from cells copied out of Excel. The other way round, a
// document made of many files is written out as one ordinary Markdown file
// for whoever reads it without this tool.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { describeError } from '@docpresenter/base';
import { singleMarkdown, themeOf } from '@docpresenter/build';
import {
  markdownTables, parseDocument, parseTable, splitMarkdownTables, tableFromTsv, withVariables,
} from '@docpresenter/markdown';
import { gridOfTable, writeXlsx } from '@docpresenter/xlsx';
import { readWorkspace } from './workspace-files.js';
import { openWithSystem } from './open-file.js';
import { hostLocale, t } from './l10n.js';

/**
 * Told of the `.table` files a split is about to make, before the document is
 * rewritten to import them: an open screen takes them in first, so the
 * document it redraws names files it already has.
 */
type MadeTables = (tables: readonly { path: string; text: string }[]) => void;
const listeners = new Set<MadeTables>();
export function onTablesMade(listener: MadeTables): { dispose(): void } {
  listeners.add(listener);
  return { dispose: () => { listeners.delete(listener); } };
}

const pathOf = (uri: vscode.Uri): string => vscode.workspace.asRelativePath(uri, false).split('\\').join('/');

/** The table the cursor is in: its first and last line, or nothing. */
function tableAt(document: vscode.TextDocument, line: number): { first: number; last: number } | undefined {
  return markdownTables(document.getText()).find(one => one.first <= line && line <= one.last);
}

/**
 * The table under the cursor, or every table when the cursor is in none,
 * moved into `.table` files beside the document. `line` is given when the
 * screen asks for one table.
 */
export async function splitTables(uri: vscode.Uri, line?: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const text = document.getText();
  const editor = vscode.window.visibleTextEditors.find(one => one.document.uri.toString() === uri.toString());
  const at = line ?? (editor ? tableAt(document, editor.selection.active.line)?.first : undefined);
  const path = pathOf(uri);
  const folder = path.replace(/\.md$/i, '');
  const taken = new Set((await vscode.workspace.findFiles(`${folder}/*.table`)).map(pathOf));
  const split = splitMarkdownTables(text, path, taken, at === undefined ? undefined : [at]);
  if (split.tables.length === 0) {
    void vscode.window.showInformationMessage(`DocPresenter: ${t('vscode.tables.none')}`);
    return;
  }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return;
  const edit = new vscode.WorkspaceEdit();
  for (const table of split.tables) {
    edit.createFile(vscode.Uri.joinPath(root, ...table.path.split('/')), {
      contents: new TextEncoder().encode(table.text), ignoreIfExists: false,
    });
  }
  edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), split.text);
  for (const listener of listeners) listener(split.tables);
  if (!await vscode.workspace.applyEdit(edit)) return;
  void vscode.window.showInformationMessage(`DocPresenter: ${t('vscode.tables.split', {
    count: split.tables.length, files: split.tables.map(one => one.path).join(', '),
  })}`);
}

/** Cells copied from Excel, written at the cursor as a Markdown table. */
async function pasteExcel(editor: vscode.TextEditor): Promise<void> {
  const table = tableFromTsv(await vscode.env.clipboard.readText());
  if (table === undefined) {
    void vscode.window.showInformationMessage(`DocPresenter: ${t('vscode.tables.noCells')}`);
    return;
  }
  const document = editor.document;
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const line = document.lineAt(editor.selection.active.line);
  // On a line of its own, apart from the paragraphs around it.
  const before = line.isEmptyOrWhitespace ? '' : eol + eol;
  const at = line.isEmptyOrWhitespace ? line.range.start : line.range.end;
  await editor.edit(edit => edit.insert(at, `${before}${table.split('\n').join(eol)}${eol}`));
}

/**
 * A table written in a document, opened in Excel to look at, sort or print.
 * It is a copy: what is changed there stays there. A table to be edited in
 * Excel and kept is moved into a `.table` first, which Excel writes back to.
 */
export async function tableToExcel(storage: vscode.Uri, text: string, name: string): Promise<void> {
  let grid;
  try {
    grid = gridOfTable(parseTable(text));
  } catch (error) {
    void vscode.window.showErrorMessage(`DocPresenter: ${describeError(error, hostLocale())}`);
    return;
  }
  const folder = join(storage.fsPath, 'excel', `md-${createHash('sha1').update(text).digest('hex').slice(0, 12)}`);
  const sheet = name.replace(/[\\/:*?"<>|[\]]/g, '_').slice(0, 31) || 'table';
  const workbook = join(folder, `${sheet}.xlsx`);
  try {
    mkdirSync(folder, { recursive: true });
    writeFileSync(workbook, writeXlsx(grid, { sheet }));
  } catch (error) {
    void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.excel.cannotWrite', { message: describeError(error, hostLocale()) })}`);
    return;
  }
  if (!await openWithSystem(vscode.Uri.file(workbook))) {
    void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.excel.cannotOpen', { file: workbook })}`);
    return;
  }
  void vscode.window.showInformationMessage(`DocPresenter: ${t('vscode.tables.excelCopy')}`);
}

/** The document, everything it takes in included, as one Markdown file and its drawings as SVG. */
export async function exportSingle(context: vscode.ExtensionContext, uri?: vscode.Uri): Promise<void> {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri ?? activeTab();
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!target || !/\.md$/i.test(target.path) || !root) {
    void vscode.window.showInformationMessage(`DocPresenter: ${t('vscode.noDocument')}`);
    return;
  }
  const path = pathOf(target);
  const stem = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
  const chosen = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(root, 'out', `${stem}.md`),
    filters: { Markdown: ['md'] }, saveLabel: t('vscode.single.saveLabel'),
  });
  if (!chosen) return;
  const out = pathOf(chosen);
  if (out === path) {
    void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.single.same')}`);
    return;
  }
  const { workspace, text } = await readWorkspace();
  const source = (await vscode.workspace.openTextDocument(target)).getText();
  let result;
  try {
    const document = withVariables(parseDocument(source), { path });
    const theme = typeof document.frontmatter.raw['theme'] === 'string' ? document.frontmatter.raw['theme'] : 'default';
    const shipped = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'media', 'theme.css')));
    result = singleMarkdown({ ...workspace, read: one => (one === path ? source : workspace.read(one)) },
      { path, document, formats: [] },
      { out, theme: themeOf(one => text.get(one), theme) ?? shipped, locale: hostLocale() });
  } catch (error) {
    void vscode.window.showErrorMessage(`DocPresenter: ${describeError(error, hostLocale())}`);
    return;
  }
  const encoder = new TextEncoder();
  await vscode.workspace.fs.writeFile(chosen, encoder.encode(result.text));
  for (const [file, svg] of result.files) {
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, ...file.split('/')), encoder.encode(svg));
  }
  const action = t('vscode.single.open');
  const picked = await vscode.window.showInformationMessage(
    `DocPresenter: ${t('vscode.single.done', { path: out, count: result.files.size })}`, action);
  if (picked === action) await vscode.window.showTextDocument(chosen);
}

/** The file of the editor in front, when it is a custom editor rather than a text one. */
function activeTab(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText ? input.uri : undefined;
}

export function registerMarkdownTables(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerTextEditorCommand('docpresenter.splitMarkdownTables', editor => splitTables(editor.document.uri)),
    vscode.commands.registerTextEditorCommand('docpresenter.pasteExcelTable', editor => pasteExcel(editor)),
    vscode.commands.registerTextEditorCommand('docpresenter.markdownTableToExcel', async editor => {
      const found = tableAt(editor.document, editor.selection.active.line);
      if (!found) {
        void vscode.window.showInformationMessage(`DocPresenter: ${t('vscode.tables.notInTable')}`);
        return;
      }
      const lines = editor.document.getText().split('\n').slice(found.first, found.last + 1).map(one => one.replace(/\r$/, ''));
      const name = pathOf(editor.document.uri).replace(/^.*\//, '').replace(/\.md$/i, '');
      await tableToExcel(context.globalStorageUri, lines.join('\n'), name);
    }),
    vscode.commands.registerCommand('docpresenter.exportSingleMarkdown', (uri?: vscode.Uri) => exportSingle(context, uri)),
  );
}
