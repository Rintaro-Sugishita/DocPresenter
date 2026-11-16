// What Excel changed, written back into the `.table` file.
//
// Three grids are compared, all made the same way — written to a workbook and
// read back — so that like is compared with like:
//
//   base     the table as it was when it was opened in Excel
//   excel    the sheet as Excel saved it
//   current  the table as it is now, which someone may have edited meanwhile
//
// Only what Excel changed is written. A cell changed in the file meanwhile is
// kept, and a cell changed on both sides keeps the file's text and is reported.
// When both sides changed the table's shape — rows or columns added or taken
// away — the cells can no longer be lined up, and nothing is written.
//
// The file is rewritten where the change is and nowhere else: a cell keeps its
// line's padding, a `#` cell that still shows its number stays `#`, and a
// style rule is added, changed or removed one line at a time.

import { byteLength, displayWidth, escapeCell, replaceBytes, joinFields, replaceField, splitFields, splitGridRow } from '@docpresenter/base';
import {
  cellAt, cellSelectorFor, delimiterField, formatRule, parseTable, sameSelector,
  type Align, type Selector, type TableFile,
} from '@docpresenter/markdown';
import { readWorkbook, gridOfSheet } from './read.js';
import { writeXlsx } from './write.js';
import { charactersOf, gridOfTable, widthIn } from './table-grid.js';
import { coveredBy, sameCell, type Grid, type GridCell, type Merge } from './model.js';

/** A width Excel saved within this much of the one written is the same width. */
const WIDTH_SLACK = 0.75;

/** The grid a table makes when it is written to a workbook and read back. */
export function roundTrip(table: TableFile, sheet = 'Sheet1'): Grid {
  const book = readWorkbook(writeXlsx(gridOfTable(table), { sheet }));
  const read = book.sheet();
  if (!read) return gridOfTable(table);
  return gridOfSheet(read, { top: 0, left: 0, bottom: table.rows.length, right: table.columns.length - 1 }).grid;
}

export interface WriteBack {
  /** The file as it should now read; the same as the source when nothing changed. */
  readonly text: string;
  /** Cells whose text, fill or alignment Excel changed and the file now has. */
  readonly cells: number;
  /** Cells changed in Excel and in the file both; the file's text was kept. */
  readonly conflicts: readonly string[];
  /** Fills that could not be taken off: they come from a rule on the whole column or row. */
  readonly kept: number;
  /** Set when both sides changed the table's shape and nothing could be written. */
  readonly refused?: 'shape';
}

export function writeBack(source: string, base: Grid, excel: Grid): WriteBack {
  const table = parseTable(source);
  const current = roundTrip(table);
  const merged = target(base, excel, current);
  if (merged === 'shape') return { text: source, cells: 0, conflicts: [], kept: 0, refused: 'shape' };

  const pairs = lineUp(current, merged.grid);
  const grid = gridText(source, table, current, merged.grid, pairs);
  const styled = styleText(grid, merged.grid, current);
  return { text: styled.text, cells: changedCells(current, merged.grid, pairs), conflicts: merged.conflicts, kept: styled.kept };
}

// --- what the table should be -----------------------------------------------

function target(base: Grid, excel: Grid, current: Grid): { grid: Grid; conflicts: string[] } | 'shape' {
  if (sameGrid(current, base)) return { grid: excel, conflicts: [] };
  const sameShape = (a: Grid, b: Grid): boolean => a.header.length === b.header.length && a.rows.length === b.rows.length;
  if (sameGrid(excel, base)) return { grid: current, conflicts: [] };
  if (!sameShape(base, excel) || !sameShape(base, current)) return 'shape';

  const conflicts: string[] = [];
  const pick = <T>(was: T, theirs: T, ours: T, same: (a: T, b: T) => boolean, where: string): T => {
    if (same(theirs, was)) return ours;
    if (same(ours, was) || same(ours, theirs)) return theirs;
    conflicts.push(where);
    return ours;
  };
  const header = base.header.map((was, c) =>
    pick(was, excel.header[c]!, current.header[c]!, (a, b) => a === b, columnName(c) + '1'));
  const rows = base.rows.map((row, r) => row.map((was, c) =>
    pick(was, excel.rows[r]![c]!, current.rows[r]![c]!, sameCell, `${columnName(c)}${r + 2}`)));
  const merges = pick(base.merges, excel.merges, current.merges, sameMerges, 'merge');
  const widths = base.widths.map((was, c) => pick(was, excel.widths[c], current.widths[c], sameWidth, columnName(c)));
  return { grid: { header, rows, merges, widths }, conflicts: conflicts.filter(one => one !== 'merge') };
}

function sameGrid(a: Grid, b: Grid): boolean {
  return a.header.length === b.header.length && a.header.every((text, c) => text === b.header[c])
    && a.rows.length === b.rows.length && a.rows.every((row, r) => row.every((cell, c) => sameCell(cell, b.rows[r]![c])))
    && sameMerges(a.merges, b.merges)
    && a.widths.every((width, c) => sameWidth(width, b.widths[c]));
}

function sameMerges(a: readonly Merge[], b: readonly Merge[]): boolean {
  const key = (list: readonly Merge[]): string =>
    list.map(one => `${one.row},${one.column},${one.rows},${one.columns}`).sort().join(';');
  return key(a) === key(b);
}

function sameWidth(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Math.abs(a - b) <= WIDTH_SLACK;
}

function columnName(c: number): string {
  let name = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

// --- lining the rows up -----------------------------------------------------

/** For each row of the target, the row of the current table it is, or -1 for a new row. */
function lineUp(current: Grid, next: Grid): number[] {
  const signature = (grid: Grid, r: number): string => grid.rows[r]!.map(cell => cell.text).join('\u0001');
  const a = current.rows.map((_, r) => signature(current, r));
  const b = next.rows.map((_, r) => signature(next, r));
  const pairs = common(a, b);
  const out = new Array<number>(b.length).fill(-1);
  let ai = 0;
  let bi = 0;
  const pairGap = (aTo: number, bTo: number): void => {
    // Rows between two that match are the same rows, edited, as far as both sides have them.
    for (let k = 0; ai + k < aTo && bi + k < bTo; k++) out[bi + k] = ai + k;
  };
  for (const [ax, bx] of pairs) {
    pairGap(ax, bx);
    out[bx] = ax;
    ai = ax + 1;
    bi = bx + 1;
  }
  pairGap(a.length, b.length);
  return out;
}

/** The longest common subsequence of two lists, as index pairs. */
function common(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

function changedCells(current: Grid, next: Grid, pairs: readonly number[]): number {
  let count = 0;
  next.rows.forEach((row, r) => row.forEach((cell, c) => {
    const was = pairs[r]! >= 0 ? current.rows[pairs[r]!]?.[c] : undefined;
    if (!sameCell(cell, was) && (pairs[r]! >= 0 || cell.text !== '')) count += 1;
  }));
  next.header.forEach((text, c) => { if (text !== current.header[c]) count += 1; });
  return count;
}

// --- the grid lines ---------------------------------------------------------

/** What a position is written as: its text, or `^` / `<` where a merge covers it. */
function tokenOf(grid: Grid, row: number, column: number): string {
  const merge = coveredBy(grid, row, column);
  if (!merge) return grid.rows[row]![column]!.text;
  return merge.row === row ? '<' : '^';
}

function gridText(source: string, table: TableFile, current: Grid, next: Grid, pairs: readonly number[]): string {
  const columns = next.header.length;
  const sameColumns = columns === table.columns.length;
  const lines: string[] = [];

  // The header and the delimiter.
  let header = table.header.text;
  next.header.forEach((text, c) => {
    if (!sameColumns || text !== current.header[c]) header = replaceField(header, c, text);
  });
  const aligns = columnAligns(next, table);
  const widths = splitFields(table.delimiter.text).map(field => displayWidth(field.trim()));
  let delimiter = table.delimiter.text;
  if (!sameColumns || aligns.some((align, c) => align !== table.columns[c]?.align)) {
    delimiter = joinFields(aligns.map((align, c) => delimiterField(align, widths[c] ?? Math.max(3, displayWidth(next.header[c] ?? '')))));
  }

  const body = next.rows.map((_, r) => {
    const was = pairs[r]!;
    const fresh = Array.from({ length: columns }, (__, c) => tokenOf(next, r, c));
    if (was < 0 || !sameColumns) return newLine(fresh, delimiter);
    let line = table.rows[was]!.line.text;
    const raw = splitGridRow(line);
    fresh.forEach((token, c) => {
      const unchanged = !coveredBy(current, was, c) && !coveredBy(next, r, c)
        && current.rows[was]![c]!.text === next.rows[r]![c]!.text;
      // A cell that shows what it showed keeps what it was written as: `#`, an escape, its padding.
      if (unchanged || raw[c] === token) return;
      line = replaceField(line, c, token);
    });
    return line;
  });

  if (!sameColumns) {
    // A column added or taken away runs down every line: the grid is written afresh, aligned.
    const all = [next.header.map(text => text), null, ...next.rows.map((_, r) => Array.from({ length: columns }, (__, c) => tokenOf(next, r, c)))];
    const width = Array.from({ length: columns }, (_, c) =>
      Math.max(3, ...all.filter((row): row is string[] => row !== null).map(row => displayWidth(escapeCell(row[c] ?? '')))));
    lines.push(...all.map(row => row === null
      ? joinFields(aligns.map((align, c) => delimiterField(align, width[c]!)))
      : joinFields(row.map((text, c) => ` ${escapeCell(text)}${' '.repeat(width[c]! - displayWidth(escapeCell(text)))} `))));
  } else {
    lines.push(header, delimiter, ...body);
  }

  const start = table.header.span.start;
  const lastRow = table.rows[table.rows.length - 1]?.line ?? table.delimiter;
  const end = lastRow.span.end;
  const eol = table.lineEnding;
  return replaceBytes(source, start, end, lines.join(eol));
}

function newLine(tokens: readonly string[], delimiter: string): string {
  const widths = splitFields(delimiter).map(field => displayWidth(field) - 2);
  return joinFields(tokens.map((token, c) => {
    const text = escapeCell(token);
    return ` ${text}${' '.repeat(Math.max(0, (widths[c] ?? 3) - displayWidth(text)))} `;
  }));
}

/** Left and not aligned are drawn alike, and the grid says both as not aligned. */
function atLeft(align: Align): Align {
  return align === 'left' ? 'default' : align;
}

/** Each column's alignment: what most of its cells are aligned by. */
function columnAligns(next: Grid, table: TableFile): Align[] {
  return next.header.map((_, c) => {
    const counts = new Map<Align, number>();
    next.rows.forEach((row, r) => {
      if (coveredBy(next, r, c) || row[c]!.text === '') return;
      const align: Align = row[c]!.align ?? 'default';
      counts.set(align, (counts.get(align) ?? 0) + 1);
    });
    if (counts.size === 0) return table.columns[c]?.align ?? 'default';
    const was = table.columns[c]?.align ?? 'default';
    const best = Math.max(...counts.values());
    // A tie keeps what the column was, and so does a left column whose cells sit at the left.
    if ((counts.get(atLeft(was)) ?? 0) === best) return was;
    return [...counts].find(([, count]) => count === best)![0];
  });
}

// --- the style rules --------------------------------------------------------

interface RuleChange { selector: Selector; set: Map<string, string | undefined> }

function styleText(source: string, next: Grid, current: Grid): { text: string; kept: number } {
  const table = parseTable(source);
  const changes: RuleChange[] = [];
  let kept = 0;
  const change = (selector: Selector, property: string, value: string | undefined): void => {
    let found = changes.find(one => sameSelector(one.selector, selector));
    if (!found) { found = { selector, set: new Map() }; changes.push(found); }
    found.set.set(property, value);
  };
  const ruleOf = (selector: Selector) => table.style.find(rule => sameSelector(rule.selector, selector));
  const now = gridOfTable(table);

  next.rows.forEach((row, r) => row.forEach((cell, c) => {
    if (coveredBy(next, r, c) || r >= table.rows.length) return;
    const owner = cellAt(table, r, c);
    if (!owner || owner.row !== r || owner.column !== c) return;
    const selector = cellSelectorFor(table, r, c);
    // Fill: what the cell should have against what the rules now give it.
    if (cell.fill !== now.rows[r]![c]!.fill) {
      if (selector && cell.fill !== undefined) change(selector, 'fill', cell.fill);
      else if (selector && ruleOf(selector)?.declarations.has('fill')) change(selector, 'fill', undefined);
      else kept += 1;
    }
    // Alignment, against the column's.
    const column = atLeft(table.columns[c]!.align);
    const wanted: Align = cell.align ?? 'default';
    const own = selector ? ruleOf(selector)?.declarations.get('align') : undefined;
    // An empty cell shows no alignment, so it has none to give back.
    if (selector && cell.text !== '' && wanted !== atLeft(own as Align | undefined ?? column)) {
      if (wanted === column) change(selector, 'align', undefined);
      else change(selector, 'align', wanted === 'default' ? 'left' : wanted);
    }
  }));

  // Widths, in the unit each column already uses; characters for one that had none.
  next.widths.forEach((width, c) => {
    const header = table.columns[c]?.header;
    if (width === undefined || header === undefined || sameWidth(width, current.widths[c])) return;
    const selector: Selector = { kind: 'column', name: header };
    const existing = ruleOf(selector)?.declarations.get('width');
    if (sameWidth(width, charactersOf(existing))) return;
    change(selector, 'width', widthIn(width, /(%|em|px|ch)$/.exec(existing ?? '')?.[1]));
  });

  return { text: applyRules(source, table, changes), kept };
}

/** Rule changes applied one line each: a rule rewritten, removed, or added to the style block. */
function applyRules(source: string, table: TableFile, changes: readonly RuleChange[]): string {
  const edits: { start: number; end: number; text: string }[] = [];
  const added: string[] = [];
  for (const { selector, set } of changes) {
    const rule = table.style.find(one => sameSelector(one.selector, selector));
    const declarations = new Map(rule?.declarations ?? []);
    for (const [property, value] of set) {
      if (value === undefined) declarations.delete(property);
      else declarations.set(property, value);
    }
    if (rule) {
      if (declarations.size === 0) {
        edits.push({ start: rule.span.start, end: rule.span.end + table.lineEnding.length, text: '' });
      } else {
        edits.push({ start: rule.span.start, end: rule.span.end, text: formatRule(selector, declarations) });
      }
    } else if (declarations.size > 0) {
      added.push(formatRule(selector, declarations));
    }
  }
  const eol = table.lineEnding;
  if (added.length > 0) {
    if (table.styleBlock) {
      const { insertAt, indent } = table.styleBlock;
      edits.push({ start: insertAt, end: insertAt, text: added.map(line => `${eol}${indent}${line}`).join('') });
    } else {
      const end = byteLength(source.replace(/\s+$/, ''));
      edits.push({ start: end, end, text: `${eol}${eol}style {${eol}${added.map(line => `  ${line}`).join(eol)}${eol}}` });
    }
  }
  let text = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = replaceBytes(text, edit.start, edit.end, edit.text);
  return text;
}

/** The smallest single replacement that turns one text into the other, in UTF-16 offsets. */
export function differenceOf(before: string, after: string): { start: number; end: number; text: string } | undefined {
  if (before === after) return undefined;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let tail = 0;
  while (tail < before.length - start && tail < after.length - start
    && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  // From the start of the line, so the edit reads as the lines that changed.
  const lineStart = before.lastIndexOf(String.fromCharCode(10), start - 1) + 1;
  return { start: lineStart, end: before.length - tail, text: after.slice(lineStart, after.length - tail) };
}

export type { GridCell };
