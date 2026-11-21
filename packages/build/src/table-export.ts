// Tables written out for programs: JSON, CSV, TSV and xlsx (spec/table.md §7.4,
// design/table-model.md §10).
//
// The grid is written for people and for diffs; a script that wants the
// contents should not have to know `^`, `<`, `#`, `@key` or the inline
// notation to get them right. So the one parser resolves them all and the
// result is written in a form any language reads. The `.table` file stays the
// source: what is written here is derived, never read back.
//
// Writing only what changed is the default. A ledger in the output folder
// remembers what was written from what, so an unchanged table is skipped and
// the output of a table that is gone is removed. Like the build, this module
// never touches a filesystem or a hash function: the CLI and VS Code hand it
// the folder and the hash, and both get the same behaviour.

import { byteLength, LocalizedError, say, utf8Bytes, utf8Text, type Locale } from '@docpresenter/base';
import { parseTable, rowKeyOf, shownText, type Cell, type TableFile } from '@docpresenter/markdown';
import { asNumber, gridOfTable, runsOf, uniform, writeXlsx, type Grid, type Merge } from '@docpresenter/xlsx';
import './messages.js';

/** What a table can be written out as. JSON when nothing is said. */
export const TABLE_FORMATS = ['json', 'csv', 'tsv', 'xlsx'] as const;
export type TableFormat = (typeof TABLE_FORMATS)[number];
export const isTableFormat = (format: string): format is TableFormat =>
  (TABLE_FORMATS as readonly string[]).includes(format);
export const isTable = (path: string): boolean => /\.table$/i.test(path);

/** The ledger's name in the output folder. Kept out of Git by `init`. */
export const TABLE_LEDGER = '.table-export.json';
/** The file every table goes into with `bundle`. */
export const TABLE_BUNDLE = 'tables.json';
/**
 * The version of what is written. Raised when the same table and options
 * would be written differently, so the ledger does not skip a stale output.
 */
const OUTPUT_VERSION = 1;

// ---- the JSON shape (spec/table.schema.json) ---------------------------------

/** One cell's value: always this shape, so a typed reader needs one type. */
export interface TableValue {
  readonly text: string;
  readonly number: number | null;
}

export interface TableJson {
  readonly format: 'docpresenter.table/1';
  readonly source: string;
  readonly range: string | null;
  readonly columns: readonly { readonly name: string; readonly align: string }[];
  readonly rows: readonly { readonly key: string | null; readonly line: number; readonly values: readonly TableValue[] }[];
  readonly merges: readonly { readonly row: number; readonly column: number; readonly rowSpan: number; readonly colSpan: number }[];
  readonly blocks: Readonly<Record<string, string>>;
  readonly ranges: Readonly<Record<string, { readonly first: string; readonly last: string }>>;
}

export interface TablesJson {
  readonly format: 'docpresenter.tables/1';
  readonly tables: readonly TableJson[];
}

/** How a table is written out, beyond its format. */
export interface TableRenderOptions {
  /** The cells' text as written instead of as shown. `number` does not change. */
  readonly raw?: boolean;
  /** Only the rows of this named range. */
  readonly range?: string;
  /** Begin CSV and TSV with a UTF-8 byte order mark, so Excel reads them as UTF-8. True when absent. */
  readonly bom?: boolean;
}

/** A table that cannot be written as asked: unreadable, or without the range named. */
export class TableExportError extends LocalizedError {}

/** The body rows a render covers: all of them, or a named range's. */
function rowSpanOf(table: TableFile, range: string | undefined): { from: number; to: number } {
  if (range === undefined) return { from: 0, to: table.rows.length - 1 };
  const named = table.ranges.get(range);
  const from = named ? table.rows.findIndex((_, r) => rowKeyOf(table, r) === named.from) : -1;
  const to = named ? table.rows.findIndex((_, r) => rowKeyOf(table, r) === named.to) : -1;
  if (from < 0 || to < from) throw new TableExportError({ id: 'build.tableExport.noRange', params: { range } });
  return { from, to };
}

/** The cell covering each grid position: a merged position points at the cell it belongs to. */
function ownersOf(table: TableFile): (Cell | undefined)[][] {
  const owners = table.rows.map(() => new Array<Cell | undefined>(table.columns.length).fill(undefined));
  for (const row of table.rows) {
    for (const cell of row.cells) {
      for (let r = cell.row; r < cell.row + cell.rowspan && r < owners.length; r++) {
        for (let c = cell.column; c < cell.column + cell.colspan && c < table.columns.length; c++) owners[r]![c] = cell;
      }
    }
  }
  return owners;
}

/** Inline notation removed and its escapes resolved: what the reader sees. */
function plainText(text: string): string {
  return runsOf(text).map(run => run.text).join('');
}

/** A number when the text is plainly one and drawn one way throughout (spec/table.md §7.4.2). */
function numberOf(text: string): number | null {
  const runs = runsOf(text);
  if (runs.length === 0 || !uniform(runs)) return null;
  return asNumber(runs.map(run => run.text).join(''))?.value ?? null;
}

const BLOCK = /^@(\S+)$/;

function valueOf(table: TableFile, cell: Cell | undefined, raw: boolean): TableValue {
  if (!cell) return { text: '', number: null };
  const block = BLOCK.exec(cell.text);
  const body = block ? table.blocks.get(block[1]!) : undefined;
  if (body !== undefined) return { text: raw ? cell.text : body, number: null };
  const shown = shownText(cell);
  return { text: raw ? cell.text : plainText(shown), number: numberOf(shown) };
}

/** The table as the JSON object spec/table.md §7.4.1 describes. */
export function tableJson(table: TableFile, source: string, options: TableRenderOptions = {}): TableJson {
  const raw = options.raw === true;
  const { from, to } = rowSpanOf(table, options.range);
  const owners = ownersOf(table);
  const rows: TableJson['rows'][number][] = [];
  for (let r = from; r <= to; r++) {
    const row = table.rows[r]!;
    rows.push({
      key: row.cells[0]?.text ?? null,
      line: lineOf(table, row.line.span.start),
      values: table.columns.map((_, c) => valueOf(table, owners[r]![c], raw)),
    });
  }
  const merges: TableJson['merges'][number][] = [];
  const seen = new Set<Cell>();
  for (let r = from; r <= to; r++) {
    for (let c = 0; c < table.columns.length; c++) {
      const cell = owners[r]![c];
      if (!cell || seen.has(cell) || (cell.rowspan === 1 && cell.colspan === 1)) continue;
      seen.add(cell);
      // A cell starting above a range is cut at its top, as the range shows it.
      const top = Math.max(cell.row, from);
      const bottom = Math.min(cell.row + cell.rowspan - 1, to);
      if (bottom === top && cell.colspan === 1) continue;
      merges.push({ row: top - from, column: cell.column, rowSpan: bottom - top + 1, colSpan: cell.colspan });
    }
  }
  return {
    format: 'docpresenter.table/1',
    source,
    range: options.range ?? null,
    columns: table.columns.map(column => ({ name: raw ? column.header : plainText(column.header), align: column.align })),
    rows,
    merges,
    blocks: Object.fromEntries(table.blocks),
    ranges: Object.fromEntries([...table.ranges].map(([name, range]) => [name, { first: range.from, last: range.to }])),
  };
}

/**
 * The 1-based line each grid line starts on, by its byte offset. The parser
 * keeps byte ranges, not line numbers; a table read by `readTableForExport`
 * has them counted from its text. One parsed elsewhere is counted from its
 * header as if that were line 1.
 */
const gridLineNumbers = new WeakMap<TableFile, ReadonlyMap<number, number>>();
function lineOf(table: TableFile, offset: number): number {
  const known = gridLineNumbers.get(table)?.get(offset);
  if (known !== undefined) return known;
  const index = table.rows.findIndex(row => row.line.span.start === offset);
  return index + 3;
}

/** CSV or TSV: names, then one line per body row; quoted as RFC 4180 says (spec/table.md §7.4.3). */
export function tableDelimited(table: TableFile, separator: ',' | '\t', options: TableRenderOptions = {}): string {
  const json = tableJson(table, '', options);
  const field = (text: string): string =>
    text.includes(separator) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  const lines = [json.columns.map(column => field(column.name)), ...json.rows.map(row => row.values.map(value => field(value.text)))];
  return `${options.bom === false ? '' : '﻿'}${lines.map(cells => cells.join(separator)).join('\r\n')}\r\n`;
}

/** The workbook "open in Excel" writes, limited to a range's rows when one is named. */
export function tableWorkbook(table: TableFile, sheet: string, options: TableRenderOptions = {}): Uint8Array {
  const grid = gridOfTable(table);
  if (options.range === undefined) return writeXlsx(grid, { sheet });
  const { from, to } = rowSpanOf(table, options.range);
  return writeXlsx(sliceGrid(grid, from, to), { sheet });
}

/** The rows from `from` to `to` of a grid, merges cut to them and their text moved to where they now start. */
function sliceGrid(grid: Grid, from: number, to: number): Grid {
  const rows = grid.rows.slice(from, to + 1).map(row => [...row]);
  const merges: Merge[] = [];
  for (const merge of grid.merges) {
    const top = Math.max(merge.row, from);
    const bottom = Math.min(merge.row + merge.rows - 1, to);
    if (bottom < top) continue;
    if (merge.row < from) rows[0]![merge.column] = grid.rows[merge.row]![merge.column]!;
    if (bottom > top || merge.columns > 1) merges.push({ ...merge, row: top - from, rows: bottom - top + 1 });
  }
  return { ...grid, rows, merges };
}

/** Reads a table, its rows' line numbers included, or throws why it cannot be read. */
export function readTableForExport(text: string): TableFile {
  const table = parseTable(text);
  const lines = new Map<number, number>();
  let offset = 0;
  text.split('\n').forEach((line, i) => {
    lines.set(offset + (byteLength(line) - byteLength(line.trimStart())), i + 1);
    offset += byteLength(line) + 1;
  });
  gridLineNumbers.set(table, lines);
  return table;
}

/** One table rendered in one format. */
export function renderTable(
  table: TableFile, source: string, format: TableFormat, options: TableRenderOptions = {},
): Uint8Array {
  const encode = utf8Bytes;
  switch (format) {
    case 'json': return encode(formatJson(tableJson(table, source, options)));
    case 'csv': return encode(tableDelimited(table, ',', options));
    case 'tsv': return encode(tableDelimited(table, '\t', options));
    case 'xlsx': return tableWorkbook(table, sheetOf(source), options);
  }
}

/** Several tables as one JSON file. */
export function renderBundle(tables: readonly { table: TableFile; source: string }[], options: TableRenderOptions = {}): Uint8Array {
  const bundle: TablesJson = {
    format: 'docpresenter.tables/1',
    tables: tables.map(one => tableJson(one.table, one.source, options)),
  };
  return utf8Bytes(formatJson(bundle));
}

/**
 * JSON indented as usual, except that an object or array holding only plain
 * values, and short enough, stays on one line: a cell's value, a column, a
 * merge. A table of a thousand rows is then a thousand short lines rather
 * than ten thousand.
 */
export function formatJson(value: unknown): string {
  const write = (one: unknown, indent: string): string => {
    if (one === null || typeof one !== 'object') return JSON.stringify(one);
    const entries = Array.isArray(one)
      ? one.map(item => ['', item] as const)
      : Object.entries(one as Record<string, unknown>);
    const open = Array.isArray(one) ? '[' : '{';
    const close = Array.isArray(one) ? ']' : '}';
    if (entries.length === 0) return `${open}${close}`;
    const key = (name: string) => Array.isArray(one) ? '' : `${JSON.stringify(name)}: `;
    if (entries.every(([, item]) => item === null || typeof item !== 'object')) {
      const line = `${open} ${entries.map(([name, item]) => `${key(name)}${JSON.stringify(item)}`).join(', ')} ${close}`;
      if (line.length <= 120) return line;
    }
    const inner = `${indent}  `;
    return `${open}\n${entries.map(([name, item]) => `${inner}${key(name)}${write(item, inner)}`).join(',\n')}\n${indent}${close}`;
  };
  return `${write(value, '')}\n`;
}

function sheetOf(source: string): string {
  return (source.split('/').pop() ?? source).replace(/\.table$/i, '');
}

/**
 * Where a table's output goes in the output folder: beside where the table
 * is, or straight in the folder when flat. A range adds its name.
 */
export function tableOutputPath(source: string, format: TableFormat, options: { flat?: boolean; range?: string } = {}): string {
  const stem = source.replace(/^\.?\/+/, '').replace(/\.table$/i, '');
  const placed = options.flat ? stem.split('/').pop()! : stem;
  return `${placed}${options.range === undefined ? '' : `.${options.range}`}.${format}`;
}

// ---- writing a folder of them, with the ledger -------------------------------

/** The output folder, from its root. Writes replace a file whole (a temporary file renamed over it). */
export interface ExportFolder {
  read(path: string): Uint8Array | undefined;
  write(path: string, bytes: Uint8Array): void;
  remove(path: string): void;
}

export interface TableExportOptions extends TableRenderOptions {
  readonly formats: readonly TableFormat[];
  /** Every table's JSON in one file, `tables.json`, instead of one each. CSV, TSV and xlsx stay one each. */
  readonly bundle?: boolean;
  /** Write everything, changed or not. */
  readonly force?: boolean;
  /** Remove the outputs of tables that are gone. True when absent; false only lists them. */
  readonly prune?: boolean;
  readonly flat?: boolean;
}

export interface TableExportInput {
  /** The tables to write: their path from the root and their text. */
  readonly tables: readonly { readonly path: string; readonly text: string }[];
  /** Whether a path is inside what this run was pointed at: outputs are only removed from there. */
  readonly inScope: (path: string) => boolean;
  /** Whether a table is still in the workspace. */
  readonly exists: (path: string) => boolean;
  readonly folder: ExportFolder;
  /** A digest of some bytes. The same bytes must give the same string from run to run. */
  readonly hash: (bytes: Uint8Array) => string;
  readonly options: TableExportOptions;
  readonly locale: Locale;
}

export interface TableExportResult {
  /** Paths in the output folder, with `/`. */
  readonly written: readonly { readonly sources: readonly string[]; readonly format: TableFormat; readonly file: string; readonly bytes: number }[];
  readonly skipped: readonly { readonly sources: readonly string[]; readonly format: TableFormat; readonly file: string }[];
  readonly removed: readonly { readonly sources: readonly string[]; readonly file: string }[];
  /** Outputs of tables that are gone, left where they are: by `prune: false`, or because they were changed by hand. */
  readonly kept: readonly { readonly sources: readonly string[]; readonly file: string; readonly edited: boolean }[];
  readonly failed: readonly { readonly source: string; readonly message: string }[];
  /** The ledger was not there before this run. */
  readonly ledgerCreated: boolean;
}

interface LedgerEntry {
  readonly sources: readonly string[];
  readonly format: TableFormat;
  /** The options and output version the file was written with. */
  readonly options: string;
  /** Digest of the sources' text. */
  readonly source: string;
  /** Digest of the file as written. */
  readonly output: string;
}

interface Ledger {
  readonly format: 'docpresenter.table-export/1';
  readonly outputs: Record<string, LedgerEntry>;
}

function readLedger(folder: ExportFolder): { ledger: Ledger; existed: boolean } {
  const empty = (): Ledger => ({ format: 'docpresenter.table-export/1', outputs: {} });
  const bytes = folder.read(TABLE_LEDGER);
  if (bytes === undefined) return { ledger: empty(), existed: false };
  try {
    const parsed = JSON.parse(utf8Text(bytes)) as Partial<Ledger>;
    // A ledger that is not ours, or broken, is started again: everything is written.
    if (parsed.format !== 'docpresenter.table-export/1' || typeof parsed.outputs !== 'object' || parsed.outputs === null) {
      return { ledger: empty(), existed: true };
    }
    return { ledger: { format: parsed.format, outputs: { ...parsed.outputs } }, existed: true };
  } catch {
    return { ledger: empty(), existed: true };
  }
}

/** One file this run means to have in the folder. */
interface Planned {
  readonly file: string;
  readonly sources: readonly string[];
  readonly format: TableFormat;
  readonly sourceDigest: string;
  readonly render: () => Uint8Array;
}

/**
 * Writes the tables into the folder, skipping what has not changed since the
 * ledger says it was written, and removing the outputs of tables that are
 * gone. One table that cannot be read is said and counted; the rest go on.
 */
export function exportTables(input: TableExportInput): TableExportResult {
  const { folder, hash, options, locale } = input;
  const text = utf8Bytes;
  // What the file was written with. The byte order mark is only CSV's and TSV's.
  const optionKey = (format: TableFormat): string => [
    `v=${OUTPUT_VERSION}`, `raw=${options.raw === true ? 1 : 0}`, `range=${options.range ?? ''}`,
    ...(format === 'csv' || format === 'tsv' ? [`bom=${options.bom === false ? 0 : 1}`] : []),
  ].join(';');
  const render: TableRenderOptions = {
    ...(options.raw === undefined ? {} : { raw: options.raw }),
    ...(options.range === undefined ? {} : { range: options.range }),
    ...(options.bom === undefined ? {} : { bom: options.bom }),
  };

  const failed: { source: string; message: string }[] = [];
  const parsed: { path: string; table: TableFile; digest: string }[] = [];
  for (const one of input.tables) {
    try {
      const table = readTableForExport(one.text);
      // A range named for the run must be there, or the table cannot be written as asked.
      if (options.range !== undefined) rowSpanOf(table, options.range);
      parsed.push({ path: one.path, table, digest: hash(text(one.text)) });
    } catch (error) {
      failed.push({ source: one.path, message: messageOf(error, locale) });
    }
  }

  const planned: Planned[] = [];
  const claimed = new Map<string, string>();
  const claim = (file: string, source: string): boolean => {
    const key = file.toLowerCase();
    const before = claimed.get(key);
    if (before !== undefined && before !== source) {
      failed.push({ source, message: say(locale, { id: 'build.tableExport.collision', params: { file, other: before } }) });
      return false;
    }
    claimed.set(key, source);
    return true;
  };
  for (const format of options.formats) {
    if (format === 'json' && options.bundle) {
      if (parsed.length === 0 || !claim(TABLE_BUNDLE, '')) continue;
      planned.push({
        file: TABLE_BUNDLE,
        sources: parsed.map(one => one.path),
        format,
        sourceDigest: hash(text(parsed.map(one => `${one.path}\0${one.digest}`).join('\n'))),
        render: () => renderBundle(parsed.map(one => ({ table: one.table, source: one.path })), render),
      });
      continue;
    }
    for (const one of parsed) {
      const file = tableOutputPath(one.path, format, {
        ...(options.flat ? { flat: true } : {}), ...(options.range === undefined ? {} : { range: options.range }),
      });
      if (!claim(file, one.path)) continue;
      planned.push({
        file, sources: [one.path], format, sourceDigest: one.digest,
        render: () => renderTable(one.table, one.path, format, render),
      });
    }
  }

  const { ledger, existed } = readLedger(folder);
  const written: TableExportResult['written'][number][] = [];
  const skipped: TableExportResult['skipped'][number][] = [];
  for (const plan of planned) {
    const before = ledger.outputs[plan.file];
    if (!options.force && before && before.source === plan.sourceDigest && before.options === optionKey(plan.format)
      && before.format === plan.format && sameList(before.sources, plan.sources)) {
      const onDisk = folder.read(plan.file);
      // Changed or removed by hand since: written again.
      if (onDisk !== undefined && hash(onDisk) === before.output) {
        skipped.push({ sources: plan.sources, format: plan.format, file: plan.file });
        continue;
      }
    }
    let bytes: Uint8Array;
    try {
      bytes = plan.render();
      folder.write(plan.file, bytes);
    } catch (error) {
      for (const source of plan.sources) failed.push({ source, message: messageOf(error, locale) });
      continue;
    }
    ledger.outputs[plan.file] = {
      sources: plan.sources, format: plan.format, options: optionKey(plan.format), source: plan.sourceDigest, output: hash(bytes),
    };
    written.push({ sources: plan.sources, format: plan.format, file: plan.file, bytes: bytes.length });
  }

  // The outputs of tables that are gone. Only those this run was pointed at,
  // and only as they were written: a file changed since is someone's now.
  const removed: TableExportResult['removed'][number][] = [];
  const kept: TableExportResult['kept'][number][] = [];
  const planning = new Set(planned.map(plan => plan.file));
  for (const [file, entry] of Object.entries(ledger.outputs)) {
    if (planning.has(file) || entry.sources.length === 0) continue;
    if (!entry.sources.every(source => input.inScope(source) && !input.exists(source))) continue;
    const onDisk = folder.read(file);
    if (onDisk === undefined) { delete ledger.outputs[file]; continue; }
    const edited = hash(onDisk) !== entry.output;
    if (options.prune === false || edited) {
      kept.push({ sources: entry.sources, file, edited });
      if (edited) delete ledger.outputs[file];
      continue;
    }
    try {
      folder.remove(file);
      delete ledger.outputs[file];
      removed.push({ sources: entry.sources, file });
    } catch (error) {
      failed.push({ source: entry.sources[0]!, message: messageOf(error, locale) });
    }
  }

  const changed = written.length > 0 || removed.length > 0 || kept.some(one => one.edited) || !existed;
  if (changed && (Object.keys(ledger.outputs).length > 0 || existed)) {
    folder.write(TABLE_LEDGER, text(formatJson(sortedLedger(ledger))));
  }
  return { written, skipped, removed, kept, failed, ledgerCreated: !existed && Object.keys(ledger.outputs).length > 0 };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((one, i) => one === b[i]);
}

/** The ledger with its outputs in path order, so two runs that wrote the same write the same file. */
function sortedLedger(ledger: Ledger): Ledger {
  const outputs: Record<string, LedgerEntry> = {};
  for (const file of Object.keys(ledger.outputs).sort()) outputs[file] = ledger.outputs[file]!;
  return { format: ledger.format, outputs };
}

function messageOf(error: unknown, locale: Locale): string {
  if (error instanceof LocalizedError) return say(locale, error.phrase);
  return error instanceof Error ? error.message : String(error);
}
