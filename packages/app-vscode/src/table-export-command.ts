// Writing tables out for programs from inside VS Code: JSON, CSV, TSV, xlsx
// (design/table-model.md §10).
//
// Two commands: "Export Tables…" for the tables (or folders) right-clicked or
// the one in the editor, and "Export All Tables" for the workspace. Both pick
// the formats and then run the build's exportTables, the routine the CLI's
// `docpresenter export --to json` runs, so the two write the same files and
// share one ledger: an unchanged table is skipped, and the outputs of tables
// that are gone are removed.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import {
  exportTables, isTable, TABLE_FORMATS, TABLE_LEDGER, type ExportFolder, type TableExportResult, type TableFormat,
} from '@docpresenter/build';
import { hostLocale, t } from './l10n.js';
import { outDirOf } from './workspace-files.js';

const LABEL: Readonly<Record<TableFormat, string>> = { json: 'JSON', csv: 'CSV', tsv: 'TSV', xlsx: 'Excel (xlsx)' };
const IGNORED = '**/{node_modules,out,dist,.git}/**';

export function registerTableExport(output: vscode.OutputChannel): vscode.Disposable {
  return vscode.Disposable.from(
    // The explorer hands over the item right-clicked and every one selected with it.
    vscode.commands.registerCommand('docpresenter.exportTables', async (uri?: vscode.Uri, selected?: vscode.Uri[]) => {
      const given = selected && selected.length > 0 ? selected : uri ? [uri] : [];
      const active = vscode.window.activeTextEditor?.document.uri;
      const targets = given.length > 0 ? given : active && isTable(active.path) ? [active] : await pickTables();
      if (targets && targets.length > 0) await exportTablesFrom(output, targets);
    }),
    vscode.commands.registerCommand('docpresenter.exportAllTables', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) { void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.noFolder')}`); return; }
      await exportTablesFrom(output, [folder.uri]);
    }),
  );
}

/** Tables picked from the workspace, when nothing was handed over. */
async function pickTables(): Promise<vscode.Uri[] | undefined> {
  const files = await vscode.workspace.findFiles('**/*.table', IGNORED);
  const picked = await vscode.window.showQuickPick(
    files.map(file => ({ label: vscode.workspace.asRelativePath(file, false), file })),
    { canPickMany: true, title: t('vscode.tables.title'), placeHolder: t('vscode.tables.pick') });
  return picked?.map(one => one.file);
}

/** Picks the formats, JSON offered first and already ticked. */
async function pickFormats(): Promise<TableFormat[] | undefined> {
  const picked = await vscode.window.showQuickPick(
    TABLE_FORMATS.map(format => ({ label: LABEL[format], format, picked: format === 'json' })),
    { canPickMany: true, title: t('vscode.tables.title'), placeHolder: t('vscode.tables.formats') });
  return picked && picked.length > 0 ? picked.map(one => one.format) : undefined;
}

/**
 * Writes out the tables the targets are or hold. What the targets cover is
 * also where the outputs of tables that are gone are removed from, so
 * exporting one folder never removes another's.
 */
async function exportTablesFrom(output: vscode.OutputChannel, targets: readonly vscode.Uri[]): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.noFolder')}`); return; }
  const formats = await pickFormats();
  if (!formats) return;
  const root = folder.uri.fsPath;
  const relative = (uri: vscode.Uri) => vscode.workspace.asRelativePath(uri, false).split('\\').join('/');
  const scopes = targets.map(uri => uri.toString() === folder.uri.toString() ? '' : relative(uri));
  const inScope = (path: string) => scopes.some(scope => scope === '' || path === scope || path.startsWith(`${scope}/`));
  const out = join(root, outDirOf());

  const result = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification, title: `DocPresenter: ${t('vscode.tables.running')}`,
  }, async () => {
    const files = (await vscode.workspace.findFiles('**/*.table', IGNORED)).filter(uri => inScope(relative(uri)));
    const tables: { path: string; text: string }[] = [];
    for (const uri of files.sort((a, b) => relative(a).localeCompare(relative(b)))) {
      tables.push({ path: relative(uri), text: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)) });
    }
    return exportTables({
      tables, inScope,
      exists: path => existsSync(join(root, path)),
      folder: nodeExportFolder(out),
      hash: bytes => createHash('sha256').update(bytes).digest('hex'),
      options: { formats },
      locale: hostLocale(),
    });
  });
  report(output, result, out);
  if (result.ledgerCreated && await isTracked(root, join(out, TABLE_LEDGER))) {
    void vscode.window.showWarningMessage(`DocPresenter: ${t('vscode.tables.notIgnored', { ledger: join(outDirOf(), TABLE_LEDGER), name: TABLE_LEDGER })}`);
  }
}

function report(output: vscode.OutputChannel, result: TableExportResult, out: string): void {
  const shown = (file: string) => join(outDirOf(), file).split('\\').join('/');
  const sources = (list: readonly string[]) => list.join(', ');
  for (const one of result.written) output.appendLine(t('vscode.tables.wrote', { file: shown(one.file), source: sources(one.sources) }));
  for (const one of result.removed) output.appendLine(t('vscode.tables.removed', { file: shown(one.file), source: sources(one.sources) }));
  for (const one of result.kept) {
    output.appendLine(t(one.edited ? 'vscode.tables.edited' : 'vscode.tables.wouldRemove', { file: shown(one.file), source: sources(one.sources) }));
  }
  for (const one of result.failed) output.appendLine(t('vscode.tables.failed', { source: one.source, message: one.message }));
  const summary = t('vscode.tables.summary', {
    written: result.written.length, skipped: result.skipped.length, removed: result.removed.length,
    failed: result.failed.length, folder: out,
  });
  output.appendLine(summary);
  if (result.failed.length > 0) {
    output.show(true);
    void vscode.window.showWarningMessage(`DocPresenter: ${summary}`);
  } else {
    void vscode.window.showInformationMessage(`DocPresenter: ${summary}`);
  }
}

/** The output folder on disk. A file is written beside itself and renamed over, so a reader never sees half of it. */
function nodeExportFolder(folder: string): ExportFolder {
  return {
    read: path => { try { return new Uint8Array(readFileSync(join(folder, path))); } catch { return undefined; } },
    write: (path, bytes) => {
      const file = join(folder, path);
      mkdirSync(dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, bytes);
      renameSync(temporary, file);
    },
    remove: path => rmSync(join(folder, path), { force: true }),
  };
}

/** Whether Git would pick the ledger up: inside a repository and not ignored. */
function isTracked(root: string, ledger: string): Promise<boolean> {
  return new Promise(done => {
    execFile('git', ['check-ignore', '-q', ledger], { cwd: root }, error => {
      // 0: ignored. 1: not ignored. Anything else: not a repository, or no git.
      if (!error) { done(false); return; }
      if ((error as { code?: unknown }).code !== 1) { done(false); return; }
      execFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root }, inside => done(!inside));
    });
  });
}
