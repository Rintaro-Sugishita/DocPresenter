// Tables written out for programs (spec/table.md §7.4) and the ledger that
// writes only what changed (design/table-model.md §10.3).

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readWorkbook } from '@docpresenter/xlsx';
import {
  exportTables, readTableForExport, renderTable, tableDelimited, tableJson, tableOutputPath,
  TABLE_LEDGER, type ExportFolder, type TableExportOptions,
} from '../src/index.js';

const TABLE = `# 項目定義
# 二行目のコメント

| 分類 | No | ID      | 項目名 | 金額 | 説明 |
|------|---:|---------|--------|-----:|------|
| 入力 |  # | idBox   | **ID** | 1,000 | @1 |
| ^    |  # | pwBox   | パス\\|ワード | 1.50 | \`varchar(64)\` |
| 操作 |  — | submit  | 送信 | 50% | **1**00 |
| 表示 | <  | <       | 001 | **100** | -0 |

[@1]:
- 大文字小文字は区別しない
- 前後の空白は除く

range {
  操作以降: 操作..表示
}
`;

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('tableJson', () => {
  const json = tableJson(readTableForExport(TABLE), 'docs/a.table');

  it('names the columns by their shown header and alignment', () => {
    expect(json.format).toBe('docpresenter.table/1');
    expect(json.columns.map(one => one.name)).toEqual(['分類', 'No', 'ID', '項目名', '金額', '説明']);
    expect(json.columns.map(one => one.align)).toEqual(['default', 'right', 'default', 'default', 'right', 'default']);
  });

  it('gives every row one value per column, merged positions holding their owner', () => {
    for (const row of json.rows) expect(row.values).toHaveLength(6);
    expect(json.rows[1]!.values[0]).toEqual({ text: '入力', number: null });
    expect(json.rows[3]!.values.slice(0, 3).map(one => one.text)).toEqual(['表示', '表示', '表示']);
    expect(json.merges).toEqual([
      { row: 0, column: 0, rowSpan: 2, colSpan: 1 },
      { row: 3, column: 0, rowSpan: 1, colSpan: 3 },
    ]);
  });

  it('decides numbers as the Excel export does', () => {
    const values = json.rows.map(row => row.values);
    expect(values[0]![1]).toEqual({ text: '1', number: 1 });
    expect(values[1]![1]).toEqual({ text: '2', number: 2 });
    expect(values[0]![4]).toEqual({ text: '1,000', number: 1000 });
    expect(values[1]![4]).toEqual({ text: '1.50', number: 1.5 });
    expect(values[2]![4]).toEqual({ text: '50%', number: 0.5 });
    expect(values[3]![4]).toEqual({ text: '100', number: 100 });
    expect(values[2]![5]).toEqual({ text: '100', number: null });
    expect(values[3]![3]).toEqual({ text: '001', number: null });
    expect(values[3]![5]).toEqual({ text: '-0', number: null });
    expect(values[2]![1]).toEqual({ text: '—', number: null });
  });

  it('shows text without its notation, a block as its content', () => {
    expect(json.rows[0]!.values[3]!.text).toBe('ID');
    expect(json.rows[1]!.values[3]!.text).toBe('パス|ワード');
    expect(json.rows[1]!.values[5]!.text).toBe('varchar(64)');
    expect(json.rows[0]!.values[5]).toEqual({ text: '- 大文字小文字は区別しない\n- 前後の空白は除く', number: null });
    expect(json.blocks).toEqual({ 1: '- 大文字小文字は区別しない\n- 前後の空白は除く' });
  });

  it('keeps the text as written when asked, numbers unchanged', () => {
    const raw = tableJson(readTableForExport(TABLE), 'docs/a.table', { raw: true });
    expect(raw.rows[0]!.values[1]).toEqual({ text: '#', number: 1 });
    expect(raw.rows[0]!.values[5]).toEqual({ text: '@1', number: null });
    expect(raw.rows[0]!.values[3]!.text).toBe('**ID**');
  });

  it('carries each row\'s key and line', () => {
    expect(json.rows.map(row => row.key)).toEqual(['入力', '#', '操作', '表示']);
    expect(json.rows.map(row => row.line)).toEqual([6, 7, 8, 9]);
  });

  it('limits the rows to a named range, keeping the numbers and owners', () => {
    const part = tableJson(readTableForExport(TABLE), 'docs/a.table', { range: '操作以降' });
    expect(part.range).toBe('操作以降');
    expect(part.rows.map(row => row.key)).toEqual(['操作', '表示']);
    expect(part.merges).toEqual([{ row: 1, column: 0, rowSpan: 1, colSpan: 3 }]);
    expect(() => tableJson(readTableForExport(TABLE), 'a.table', { range: 'nope' })).toThrow(/nope/);
  });

  it('cuts a merge a range starts inside, and gives it its owner\'s text', () => {
    const table = readTableForExport('| a | b |\n|---|---|\n| x | 1 |\n| ^ | 2 |\n| ^ | 3 |\n\nrange {\n  後: 2..3\n}\n');
    const part = tableJson(table, 't.table', { range: '後' });
    expect(part.rows.map(row => row.values[0]!.text)).toEqual(['x', 'x']);
    expect(part.merges).toEqual([{ row: 0, column: 0, rowSpan: 2, colSpan: 1 }]);
  });
});

describe('CSV and TSV', () => {
  it('quote as RFC 4180 says, end lines with CRLF and begin with a BOM', () => {
    const table = readTableForExport('| a | b |\n|---|---|\n| x, y | say "hi" |\n| ^ | @1 |\n\n[@1]:\nline one\nline two\n');
    expect(tableDelimited(table, ',')).toBe('﻿a,b\r\n"x, y","say ""hi"""\r\n"x, y","line one\nline two"\r\n');
    expect(tableDelimited(table, '\t', { bom: false })).toBe('a\tb\r\nx, y\t"say ""hi"""\r\nx, y\t"line one\nline two"\r\n');
  });
});

describe('xlsx', () => {
  it('writes the workbook "open in Excel" writes, numbers as numbers', () => {
    const book = readWorkbook(renderTable(readTableForExport(TABLE), 'docs/a.table', 'xlsx'));
    expect(book.sheets).toEqual(['a']);
  });
});

describe('tableOutputPath', () => {
  it('puts an output beside where the table is, a range in its name', () => {
    expect(tableOutputPath('docs/a.table', 'json')).toBe('docs/a.json');
    expect(tableOutputPath('docs/a.table', 'csv', { flat: true })).toBe('a.csv');
    expect(tableOutputPath('docs/a.table', 'json', { range: '認証' })).toBe('docs/a.認証.json');
  });
});

/** An output folder held in memory. */
function memoryFolder(): ExportFolder & { files: Map<string, Uint8Array>; writes: string[] } {
  const files = new Map<string, Uint8Array>();
  const writes: string[] = [];
  return {
    files, writes,
    read: path => files.get(path),
    write: (path, bytes) => { files.set(path, bytes); writes.push(path); },
    remove: path => { files.delete(path); },
  };
}

describe('exportTables', () => {
  const run = (
    folder: ExportFolder, tables: { path: string; text: string }[], options: Partial<TableExportOptions> = {},
    exists = (path: string) => tables.some(one => one.path === path),
  ) => exportTables({
    tables, folder, hash: sha, locale: 'en', inScope: () => true, exists,
    options: { formats: ['json'], ...options },
  });

  it('writes, then skips what has not changed', () => {
    const folder = memoryFolder();
    const first = run(folder, [{ path: 'a.table', text: TABLE }]);
    expect(first.written.map(one => one.file)).toEqual(['a.json']);
    expect(first.ledgerCreated).toBe(true);
    expect(folder.files.has(TABLE_LEDGER)).toBe(true);
    folder.writes.length = 0;
    const second = run(folder, [{ path: 'a.table', text: TABLE }]);
    expect(second.written).toEqual([]);
    expect(second.skipped.map(one => one.file)).toEqual(['a.json']);
    expect(folder.writes).toEqual([]);
  });

  it('writes again when the table, the options or the output changed', () => {
    const folder = memoryFolder();
    run(folder, [{ path: 'a.table', text: TABLE }]);
    expect(run(folder, [{ path: 'a.table', text: `${TABLE}\n` }]).written).toHaveLength(1);
    expect(run(folder, [{ path: 'a.table', text: `${TABLE}\n` }], { raw: true }).written).toHaveLength(1);
    folder.files.set('a.json', new TextEncoder().encode('edited'));
    expect(run(folder, [{ path: 'a.table', text: `${TABLE}\n` }], { raw: true }).written).toHaveLength(1);
    folder.files.delete('a.json');
    expect(run(folder, [{ path: 'a.table', text: `${TABLE}\n` }], { raw: true }).written).toHaveLength(1);
    expect(run(folder, [{ path: 'a.table', text: `${TABLE}\n` }], { raw: true, force: true }).written).toHaveLength(1);
  });

  it('starts again from a broken ledger', () => {
    const folder = memoryFolder();
    run(folder, [{ path: 'a.table', text: TABLE }]);
    folder.files.set(TABLE_LEDGER, new TextEncoder().encode('{ broken'));
    expect(run(folder, [{ path: 'a.table', text: TABLE }]).written).toHaveLength(1);
    expect(JSON.parse(text(folder.files.get(TABLE_LEDGER)!)).outputs['a.json'].sources).toEqual(['a.table']);
  });

  it('removes the output of a table that is gone, and only as it was written', () => {
    const folder = memoryFolder();
    run(folder, [{ path: 'a.table', text: TABLE }, { path: 'b.table', text: TABLE }], { formats: ['json', 'csv'] });
    const listed = run(folder, [{ path: 'b.table', text: TABLE }], { formats: ['json'], prune: false });
    expect(listed.kept.map(one => one.file).sort()).toEqual(['a.csv', 'a.json']);
    expect(folder.files.has('a.json')).toBe(true);

    folder.files.set('a.csv', new TextEncoder().encode('mine now'));
    const pruned = run(folder, [{ path: 'b.table', text: TABLE }], { formats: ['json'] });
    expect(pruned.removed.map(one => one.file)).toEqual(['a.json']);
    expect(pruned.kept).toEqual([{ sources: ['a.table'], file: 'a.csv', edited: true }]);
    expect(folder.files.has('a.json')).toBe(false);
    expect(folder.files.has('a.csv')).toBe(true);
    expect(Object.keys(JSON.parse(text(folder.files.get(TABLE_LEDGER)!)).outputs).sort()).toEqual(['b.csv', 'b.json']);
  });

  it('leaves the outputs of tables outside what the run was pointed at', () => {
    const folder = memoryFolder();
    run(folder, [{ path: 'x/a.table', text: TABLE }, { path: 'y/b.table', text: TABLE }]);
    const result = exportTables({
      tables: [], folder, hash: sha, locale: 'en', options: { formats: ['json'] },
      inScope: path => path.startsWith('y/'), exists: () => false,
    });
    expect(result.removed.map(one => one.file)).toEqual(['y/b.json']);
    expect(folder.files.has('x/a.json')).toBe(true);
  });

  it('writes every table into one file when bundled', () => {
    const folder = memoryFolder();
    const result = run(folder, [{ path: 'a.table', text: TABLE }, { path: 'b.table', text: '| x |\n|---|\n| 1 |\n' }], { bundle: true });
    expect(result.written.map(one => one.file)).toEqual(['tables.json']);
    const bundle = JSON.parse(text(folder.files.get('tables.json')!));
    expect(bundle.format).toBe('docpresenter.tables/1');
    expect(bundle.tables.map((one: { source: string }) => one.source)).toEqual(['a.table', 'b.table']);
    expect(run(folder, [{ path: 'a.table', text: TABLE }, { path: 'b.table', text: '| x |\n|---|\n| 1 |\n' }], { bundle: true }).skipped).toHaveLength(1);
  });

  it('says which tables cannot be read and writes the rest', () => {
    const folder = memoryFolder();
    const result = run(folder, [{ path: 'bad.table', text: 'no grid' }, { path: 'a.table', text: TABLE }]);
    expect(result.failed.map(one => one.source)).toEqual(['bad.table']);
    expect(result.written.map(one => one.file)).toEqual(['a.json']);
    expect(run(folder, [{ path: 'a.table', text: TABLE }], { range: 'none' }).failed[0]!.message).toBe('No named range none');
  });

  it('refuses two tables that would land on one file', () => {
    const result = run(memoryFolder(), [{ path: 'x/a.table', text: TABLE }, { path: 'y/a.table', text: TABLE }], { flat: true });
    expect(result.written.map(one => one.file)).toEqual(['a.json']);
    expect(result.failed.map(one => one.source)).toEqual(['y/a.table']);
  });
});
