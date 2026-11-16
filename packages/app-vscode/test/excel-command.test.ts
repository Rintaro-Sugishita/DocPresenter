import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { gridOfSheet, readWorkbook, writeXlsx, type Grid } from '@docpresenter/xlsx';
import { openInExcel, sweepWorkbooks } from '../src/excel-command.js';
import { give, held, saved, shown, Uri } from './fake-vscode.js';

const TABLE = [
  '| 分類 | No | ID     | 項目名      |',
  '|------|---:|--------|-------------|',
  '| 入力 |  # | idBox  | ログイン ID |',
  '| ^    |  # | pwBox  | パスワード  |',
  '',
].join('\n');

const storage = mkdtempSync(join(tmpdir(), 'dp-excel-'));
afterAll(() => rmSync(storage, { recursive: true, force: true }));
const output = { lines: [] as string[], appendLine(line: string) { this.lines.push(line); } };

/** What Excel does: change the sheet and save the file over itself. */
function saveInExcel(file: string, change: (grid: { header: string[]; rows: { text: string; fill?: string }[][] }) => void): void {
  const { grid } = gridOfSheet(readWorkbook(readFileSync(file)).sheet()!);
  const edited = { ...grid, header: [...grid.header], rows: grid.rows.map(row => row.map(cell => ({ ...cell }))) };
  change(edited);
  writeFileSync(file, writeXlsx(edited as Grid, { sheet: 'items' }));
  const later = new Date(Date.now() + 5000);
  utimesSync(file, later, later);
}

describe('表を Excel で開いて書き戻す', () => {
  it('作業場の外に xlsx を作って開き、Excel で保存すると直したセルだけを書き戻して保存する', async () => {
    give({ 'docs/items.table': TABLE });
    const opened: string[] = [];
    const session = await openInExcel(Uri.file('/w/docs/items.table'), Uri.file(storage), output,
      async file => { opened.push(file.fsPath); return true; });
    expect(session).toBeDefined();
    expect(opened).toHaveLength(1);
    expect(opened[0]!.startsWith(storage)).toBe(true);
    expect(opened[0]!.endsWith('items.xlsx')).toBe(true);
    // 作業場には何も増えない
    expect([...held.keys()]).toEqual(['docs/items.table']);

    saveInExcel(opened[0]!, grid => { grid.rows[1]![3]!.text = 'パスワード（8 文字以上）'; });
    await session!.saved();
    expect(held.get('docs/items.table')).toBe(TABLE.replace('| パスワード  |', '| パスワード（8 文字以上） |'));
    expect(saved).toContain('docs/items.table');
    expect(shown.some(line => line.includes('1 セル'))).toBe(true);

    // 2 回目の保存は、1 回目からの変更だけ
    saveInExcel(opened[0]!, grid => { grid.rows[0]![3]!.text = 'ログイン名'; });
    await session!.saved();
    expect(held.get('docs/items.table')).toContain('| ログイン名  |');
    expect(held.get('docs/items.table')).toContain('パスワード（8 文字以上）');
    session!.dispose();
  });

  it('Excel が閉じたら（~$ のロックが消えたら）最後の保存を書き戻してからブックを消す', async () => {
    give({ 'docs/items.table': TABLE });
    let file = '';
    const session = await openInExcel(Uri.file('/w/docs/items.table'), Uri.file(storage), output,
      async opened => { file = opened.fsPath; return true; });
    const lock = join(session!.folder, '~$items.xlsx');

    // 開いている間はロックがあり、ブックは残る
    writeFileSync(lock, '');
    await session!.settled();
    expect(existsSync(file)).toBe(true);

    // 保存して閉じる: 書き戻してから、作業用のフォルダごと消す
    saveInExcel(file, grid => { grid.rows[0]![3]!.text = 'ログイン名'; });
    rmSync(lock);
    await session!.settled();
    expect(held.get('docs/items.table')).toContain('| ログイン名  |');
    expect(existsSync(session!.folder)).toBe(false);
  });

  it('Excel がまだ開いていないうちは、ロックが無くても消さない', async () => {
    give({ 'docs/items.table': TABLE });
    const session = await openInExcel(Uri.file('/w/docs/items.table'), Uri.file(storage), output, async () => true);
    await session!.settled();
    expect(existsSync(session!.workbook)).toBe(true);
    session!.dispose();
  });

  it('前に残ったブックは、古くて誰も開いていなければ掃除し、開いているものと新しいものは残す', () => {
    const root = join(storage, 'excel');
    const make = (name: string, age: number, locked = false): string => {
      const folder = join(root, name);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'x.xlsx'), '');
      if (locked) writeFileSync(join(folder, '~$x.xlsx'), '');
      const when = new Date(Date.now() - age);
      utimesSync(folder, when, when);
      return folder;
    };
    const HOUR = 60 * 60 * 1000;
    const stale = make('stale', HOUR);
    const open = make('open', HOUR, true);
    const fresh = make('fresh', 0);
    sweepWorkbooks(Uri.file(storage));
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(open)).toBe(true);
    expect(existsSync(fresh)).toBe(true);
  });

  it('表として読めないファイルは開かずに知らせる', async () => {
    give({ 'docs/broken.table': 'これは表ではない\n' });
    const session = await openInExcel(Uri.file('/w/docs/broken.table'), Uri.file(storage), output, async () => true);
    expect(session).toBeUndefined();
    expect(shown.some(line => line.includes('表として読めません'))).toBe(true);
  });
});
