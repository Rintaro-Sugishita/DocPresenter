// Editing a table in Excel, and writing it back when Excel saves.
//
// The `.table` file stays the one the repository keeps. "Open in Excel" writes
// it out as a workbook outside the workspace — in the extension's own storage,
// so nothing appears in Git — and opens that in Excel. The folder is watched:
// each time Excel saves, the workbook is read and what was changed in it is
// written back into the `.table` file and saved (packages/xlsx/write-back.ts),
// so the diff shows the cells that changed and nothing else.
//
// Writing a workbook and reading one take milliseconds; the wait is Excel
// starting. A table edited in VS Code while Excel has it open keeps those
// edits: only what Excel changed comes back.
//
// The workbook lives only while Excel has it. Excel keeps a `~$` lock file
// beside a workbook it has open and takes it away when it closes it; once the
// lock has come and gone, the last save is written back and the workbook is
// deleted. One left behind (VS Code closed first) is swept up the next time.

import * as vscode from 'vscode';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { parseTable } from '@docpresenter/markdown';
import {
  differenceOf, gridOfSheet, gridOfTable, readWorkbook, roundTrip, usedArea, writeBack, writeXlsx, type Grid,
} from '@docpresenter/xlsx';
import { describeError } from '@docpresenter/base';
import { hostLocale, t } from './l10n.js';

/** How long after the last change in the folder the workbook is read: Excel saves in steps. */
const SETTLE_MS = 500;
/** A workbook left with nothing holding it is swept up once it is this old. */
const STALE_MS = 10 * 60 * 1000;

/** Whether something has the workbooks in a folder open: Excel's `~$` lock, or LibreOffice's. */
export function isHeld(folder: string): boolean {
  try {
    return readdirSync(folder).some(name => name.startsWith('~$') || name.startsWith('.~lock.'));
  } catch {
    return false;
  }
}

/** One table open in Excel. */
export class ExcelSession implements vscode.Disposable {
  private base: Grid;
  private watcher: FSWatcher | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastSeen = 0;
  /** Excel has had the workbook open, so its lock going away means it was closed. */
  private held = false;
  private closed = false;
  /** One write-back at a time; a save during one is read after it. */
  private running: Promise<void> = Promise.resolve();

  constructor(
    readonly table: vscode.Uri,
    readonly workbook: string,
    base: Grid,
    private readonly output: Pick<vscode.OutputChannel, 'appendLine'>,
    private readonly onClosed: (session: ExcelSession) => void = () => undefined,
  ) {
    this.base = base;
    this.lastSeen = mtimeOf(workbook);
  }

  get folder(): string {
    return join(this.workbook, '..');
  }

  /**
   * Watches the workbook's folder; Excel replaces the file rather than
   * writing into it, and puts its lock beside it.
   */
  watch(): void {
    this.watcher = watch(this.folder, () => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => { void this.settled(); }, SETTLE_MS);
    });
  }

  /** The folder has stopped changing: write back what was saved, and let go once Excel has closed the workbook. */
  async settled(): Promise<void> {
    await this.saved();
    if (isHeld(this.folder)) { this.held = true; return; }
    if (this.held) this.close();
  }

  /** Excel has closed the workbook: stop watching and delete it. */
  close(): void {
    if (this.closed) return;
    this.dispose();
    this.closed = true;
    try { rmSync(this.folder, { recursive: true, force: true }); } catch { /* swept up next time */ }
    this.output.appendLine(t('vscode.excel.closed', { name: vscode.workspace.asRelativePath(this.table, false) }));
    this.onClosed(this);
  }

  /** Excel saved: read the workbook and write what changed back into the table. */
  saved(): Promise<void> {
    this.running = this.running.then(() => this.writeBack()).catch(error => {
      this.output.appendLine(`! ${describeError(error, hostLocale())}`);
    });
    return this.running;
  }

  private async writeBack(): Promise<void> {
    const seen = mtimeOf(this.workbook);
    if (seen === 0 || seen === this.lastSeen) return;
    const bytes = await readSettled(this.workbook);
    if (!bytes) return;
    this.lastSeen = seen;
    const sheet = readWorkbook(bytes).sheet();
    if (!sheet) return;
    const area = usedArea(sheet);
    const { grid, notes } = gridOfSheet(sheet, area ? { top: 0, left: 0, bottom: area.bottom, right: area.right } : undefined);

    const document = await vscode.workspace.openTextDocument(this.table);
    const source = document.getText();
    const name = vscode.workspace.asRelativePath(this.table, false);
    const result = writeBack(source, this.base, grid);
    if (result.refused) {
      void vscode.window.showWarningMessage(`DocPresenter: ${t('vscode.excel.refused', { name })}`);
      return;
    }
    const change = differenceOf(source, result.text);
    if (change) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(this.table, new vscode.Range(document.positionAt(change.start), document.positionAt(change.end)), change.text);
      await vscode.workspace.applyEdit(edit);
      await document.save();
    }
    // What Excel says now is what the next save is compared with. When a cell
    // was kept from the file, Excel's text for it stays the "before", so the
    // next save does not push it over the file again.
    this.base = result.conflicts.length > 0 ? grid : roundTrip(parseTable(result.text));

    if (change) {
      this.output.appendLine(t('vscode.excel.wrote', { name, cells: result.cells }));
      void vscode.window.setStatusBarMessage(`DocPresenter: ${t('vscode.excel.wrote', { name, cells: result.cells })}`, 5000);
    }
    if (notes.formulas > 0) {
      void vscode.window.showInformationMessage(`DocPresenter: ${t('vscode.excel.formulas', { count: notes.formulas })}`);
    }
    if (result.conflicts.length > 0) {
      void vscode.window.showWarningMessage(`DocPresenter: ${t('vscode.excel.conflicts', { name, cells: result.conflicts.join(', ') })}`);
    }
    if (result.kept > 0) {
      void vscode.window.showInformationMessage(`DocPresenter: ${t('vscode.excel.keptFill', { count: result.kept })}`);
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.watcher?.close();
  }
}

function mtimeOf(path: string): number {
  try { return statSync(path).mtimeMs; } catch { return 0; }
}

/** The workbook's bytes once Excel has finished with them: a half-written file is tried again. */
async function readSettled(path: string): Promise<Uint8Array | undefined> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const bytes = readFileSync(path);
      readWorkbook(bytes);
      return bytes;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  return undefined;
}

const sessions = new Map<string, ExcelSession>();

/**
 * Opens a table in Excel. `storage` is where the workbook goes; `open` hands
 * it to the system, which opens it in whatever opens `.xlsx` files.
 */
export async function openInExcel(
  table: vscode.Uri, storage: vscode.Uri, output: Pick<vscode.OutputChannel, 'appendLine'>,
  open: (file: vscode.Uri) => Thenable<boolean> = file => vscode.env.openExternal(file),
): Promise<ExcelSession | undefined> {
  const name = vscode.workspace.asRelativePath(table, false);
  let source: string;
  try {
    source = (await vscode.workspace.openTextDocument(table)).getText();
  } catch (error) {
    void vscode.window.showErrorMessage(`DocPresenter: ${describeError(error, hostLocale())}`);
    return undefined;
  }
  let parsed;
  try {
    parsed = parseTable(source);
  } catch (error) {
    void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.excel.unreadable', { name, message: describeError(error, hostLocale()) })}`);
    return undefined;
  }

  const sheet = basename(table.path).replace(/\.table$/i, '');
  const folder = join(storage.fsPath, 'excel', createHash('sha1').update(table.toString()).digest('hex').slice(0, 12));
  const workbook = join(folder, `${sheet}.xlsx`);
  const key = table.toString();
  const running = sessions.get(key);
  // Excel still has it open: bring it forward rather than overwrite it.
  if (running && isHeld(folder)) {
    await open(vscode.Uri.file(workbook));
    return running;
  }
  running?.dispose();
  sessions.delete(key);

  try {
    mkdirSync(folder, { recursive: true });
    writeFileSync(workbook, writeXlsx(gridOfTable(parsed), { sheet }));
  } catch (error) {
    void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.excel.cannotWrite', { message: describeError(error, hostLocale()) })}`);
    return undefined;
  }
  const session = new ExcelSession(table, workbook, roundTrip(parsed, sheet), output, closed => {
    if (sessions.get(key) === closed) sessions.delete(key);
  });
  session.watch();
  sessions.set(key, session);
  output.appendLine(t('vscode.excel.opened', { name, file: workbook }));
  if (!await open(vscode.Uri.file(workbook))) {
    void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.excel.cannotOpen', { file: workbook })}`);
  } else {
    void vscode.window.setStatusBarMessage(`DocPresenter: ${t('vscode.excel.watching', { name })}`, 8000);
  }
  return session;
}

/**
 * Deletes the workbooks nothing has open any more: those left when VS Code
 * closed before Excel did. A folder written in the last few minutes may be
 * one another window is still opening in Excel, and is left alone.
 */
export function sweepWorkbooks(storage: vscode.Uri, now = Date.now()): void {
  const root = join(storage.fsPath, 'excel');
  let folders: string[];
  try { folders = readdirSync(root); } catch { return; }
  for (const name of folders) {
    const folder = join(root, name);
    if (isHeld(folder) || now - mtimeOf(folder) < STALE_MS) continue;
    try { rmSync(folder, { recursive: true, force: true }); } catch { /* still in use */ }
  }
}

/** The command: the table right-clicked, the one in the editor, or one picked from the workspace. */
export function registerExcel(context: vscode.ExtensionContext, output: vscode.OutputChannel): vscode.Disposable {
  sweepWorkbooks(context.globalStorageUri);
  return vscode.Disposable.from(
    vscode.commands.registerCommand('docpresenter.openInExcel', async (uri?: vscode.Uri) => {
      let table = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!table || !/\.table$/i.test(table.path)) {
        const files = await vscode.workspace.findFiles('**/*.table', '**/node_modules/**');
        const picked = await vscode.window.showQuickPick(
          files.map(file => ({ label: vscode.workspace.asRelativePath(file, false), file })),
          { title: t('vscode.excel.pickTitle'), placeHolder: t('vscode.excel.pick') });
        table = picked?.file;
      }
      if (table) await openInExcel(table, context.globalStorageUri, output);
    }),
    {
      dispose: () => {
        // A workbook Excel no longer has goes with the window; one it still has stays until the next sweep.
        for (const session of [...sessions.values()]) {
          if (isHeld(session.folder)) session.dispose(); else session.close();
        }
        sessions.clear();
      },
    },
  );
}
