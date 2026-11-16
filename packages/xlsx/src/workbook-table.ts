// A sheet of an existing workbook, taken into a document as a table.
//
//   @import "見積.xlsx"                 the first sheet, as far as it is filled in
//   @import "見積.xlsx#内訳"            the sheet named 内訳
//   @import "見積.xlsx#内訳!A3:F20"     that area of it; its first row is the header
//
// The sheet is turned into the text of a `.table` file and from then on is a
// table like any other: numbered, captioned, drawn on the page, in a PDF and
// on a slide. It is read, never written: the workbook stays the team's own.
// This is for documents that have to use a workbook they already have; a new
// table is a `.table` file, which a diff can show.

import { displayWidth, escapeCell, joinFields } from '@docpresenter/base';
import { cellSelectorFor, delimiterField, formatRule, parseTable, type Align, type Selector } from '@docpresenter/markdown';
import { areaOf, gridOfSheet, readWorkbook, usedArea, XlsxError, type Area } from './read.js';
import { coveredBy, type Grid } from './model.js';
import { escapeMarks } from './runs.js';

/** Whether an imported path names a workbook, with or without a sheet after `#`. */
export function isWorkbookPath(path: string): boolean {
  return /\.xlsx(#.*)?$/i.test(path);
}

/** A workbook path split into the file and what follows `#`. */
export function splitWorkbookPath(path: string): { file: string; fragment: string } {
  const at = path.search(/\.xlsx#/i);
  return at < 0 ? { file: path, fragment: '' } : { file: path.slice(0, at + 5), fragment: path.slice(at + 6) };
}

/** The `.table` text of the sheet and area a fragment names. */
export function workbookTable(bytes: Uint8Array, fragment: string): string {
  const book = readWorkbook(bytes);
  const { sheet: name, area: written } = parseFragment(fragment, book.sheets);
  const sheet = book.sheet(name);
  if (!sheet) throw new XlsxError(`no sheet "${name ?? ''}" (${book.sheets.join(', ')})`);
  const area: Area | undefined = written === undefined ? usedArea(sheet) : areaOf(written);
  if (!area) throw new XlsxError(`"${sheet.name}" is empty`);
  return tableTextOf(gridOfSheet(sheet, area).grid);
}

function parseFragment(fragment: string, sheets: readonly string[]): { sheet: string | undefined; area: string | undefined } {
  const text = decodeURIComponent(fragment.trim());
  if (text === '') return { sheet: undefined, area: undefined };
  const bang = text.lastIndexOf('!');
  if (bang >= 0) return { sheet: unquote(text.slice(0, bang)), area: text.slice(bang + 1) };
  // A name that is a sheet is a sheet; otherwise `A1:F20` is an area of the first one.
  if (sheets.includes(unquote(text))) return { sheet: unquote(text), area: undefined };
  if (/^\$?[A-Z]{1,3}\$?\d+(:\$?[A-Z]{1,3}\$?\d+)?$/i.test(text)) return { sheet: undefined, area: text };
  return { sheet: unquote(text), area: undefined };
}

function unquote(name: string): string {
  return /^'.*'$/.test(name) ? name.slice(1, -1).replace(/''/g, "'") : name;
}

/** A grid written as a `.table` file: the grid aligned, then the rules for what the grid cannot say. */
export function tableTextOf(grid: Grid): string {
  const columns = grid.header.length;
  const header = grid.header.map((text, c) => text.trim() === '' ? columnLetters(c) : text);
  const body = grid.rows.map((row, r) => row.map((cell, c) => {
    const merge = coveredBy(grid, r, c);
    if (merge) return merge.row === r ? '<' : '^';
    // A cell that says `^`, `<` or `#` means it, and is not a merge or a number.
    return /^[\^<#]$/.test(cell.text) ? escapeMarks(cell.text) : cell.text;
  }));
  const aligns: Align[] = header.map((_, c) => {
    const counts = new Map<Align, number>();
    grid.rows.forEach((row, r) => {
      if (coveredBy(grid, r, c) || row[c]!.text === '') return;
      const align: Align = row[c]!.align ?? 'default';
      counts.set(align, (counts.get(align) ?? 0) + 1);
    });
    let best: Align = 'default';
    let most = 0;
    for (const [align, count] of counts) if (count > most) { best = align; most = count; }
    return best;
  });
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.max(3, displayWidth(escapeCell(header[c]!)), ...body.map(row => displayWidth(escapeCell(row[c] ?? '')))));
  const line = (cells: readonly string[]): string =>
    joinFields(cells.map((text, c) => ` ${escapeCell(text)}${' '.repeat(widths[c]! - displayWidth(escapeCell(text)))} `));
  const lines = [line(header), joinFields(aligns.map((align, c) => delimiterField(align, widths[c]!))), ...body.map(line)].join('\n');

  // What the grid cannot say: fills, a cell aligned against its column, widths.
  const table = parseTable(`${lines}\n`);
  const rules: string[] = [];
  const total = grid.widths.reduce<number>((sum, width) => sum + (width ?? 0), 0);
  if (total > 0 && grid.widths.every(width => width !== undefined)) {
    header.forEach((name, c) => {
      rules.push(formatRule({ kind: 'column', name }, new Map([['width', `${Math.max(1, Math.round(grid.widths[c]! * 100 / total))}%`]])));
    });
  }
  grid.rows.forEach((row, r) => row.forEach((cell, c) => {
    if (coveredBy(grid, r, c)) return;
    const declarations = new Map<string, string>();
    if (cell.fill) declarations.set('fill', cell.fill);
    if (cell.text !== '' && (cell.align ?? 'default') !== aligns[c] && cell.align) declarations.set('align', cell.align);
    if (declarations.size === 0) return;
    const selector: Selector | undefined = cellSelectorFor(table, r, c);
    if (selector) rules.push(formatRule(selector, declarations));
  }));
  return rules.length === 0 ? `${lines}\n` : `${lines}\n\nstyle {\n${rules.map(rule => `  ${rule}`).join('\n')}\n}\n`;
}

function columnLetters(c: number): string {
  let name = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/**
 * A reader that gives a workbook path the text of its table and passes every
 * other path through. Each workbook is read once.
 */
export function withWorkbooks(
  read: (path: string) => string | undefined,
  bytes: (file: string) => Uint8Array | undefined,
): (path: string) => string | undefined {
  const cache = new Map<string, string | undefined>();
  return path => {
    if (!isWorkbookPath(path)) return read(path);
    if (cache.has(path)) return cache.get(path);
    const { file, fragment } = splitWorkbookPath(path);
    const found = bytes(file);
    // A sheet that cannot be read is shown as the error it is, where the table would be.
    let text: string | undefined;
    if (found) {
      try { text = workbookTable(found, fragment); } catch (error) {
        text = `!xlsx ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    cache.set(path, text);
    return text;
  };
}
