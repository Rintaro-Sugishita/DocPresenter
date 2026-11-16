// A workbook read back as the grid its sheet shows.
//
// What a cell shows is what comes back: a number in the text its format
// gives it, a date as the date, a formula as its result. Fonts become the
// inline marks, a solid fill becomes the cell's fill, the horizontal
// alignment its alignment. Borders, row heights, pictures and comments have
// no place in a `.table` file and are not read.

import { unzipSync, strFromU8 } from 'fflate';
import { BUILT_IN_FORMATS, formatNumber } from './number.js';
import { colourOf, themeColours, type ThemeColours } from './colour.js';
import { inlineOf, isCodeFont, type Run } from './runs.js';
import { child, children, descendants, parseXml, type XmlNode } from './xml.js';
import type { Grid, GridCell, Horizontal, Merge, SheetNotes } from './model.js';

export interface Workbook {
  /** The sheets, in tab order. */
  readonly sheets: readonly string[];
  /** One sheet's cells; the first sheet when no name is given. */
  sheet(name?: string): Sheet | undefined;
}

export interface SheetCell {
  readonly runs: readonly Run[];
  readonly fill: string | undefined;
  readonly align: GridCell['align'];
  readonly formula: boolean;
}

export interface Sheet {
  readonly name: string;
  /** Keyed `row,column`, both from 0. */
  readonly cells: ReadonlyMap<string, SheetCell>;
  readonly merges: readonly Merge[];
  /** Column widths in characters, by column from 0. */
  readonly widths: ReadonlyMap<number, number>;
}

/** A rectangle of a sheet, zero-based and inclusive. */
export interface Area { readonly top: number; readonly left: number; readonly bottom: number; readonly right: number }

export class XlsxError extends Error {}

export function readWorkbook(bytes: Uint8Array): Workbook {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new XlsxError('not an xlsx file'); }
  const xml = (path: string): XmlNode | undefined => {
    const found = files[path];
    return found ? parseXml(strFromU8(found)) : undefined;
  };
  const book = xml('xl/workbook.xml');
  if (!book) throw new XlsxError('not an xlsx file');
  const rels = new Map(descendants(xml('xl/_rels/workbook.xml.rels'), 'Relationship')
    .map(one => [one.attributes['Id'] ?? '', one.attributes['Target'] ?? '']));
  const sheets = descendants(book, 'sheet').map(one => ({
    name: one.attributes['name'] ?? '',
    path: partPath(rels.get(one.attributes['id'] ?? '') ?? ''),
  }));
  const theme = themeColours(xml('xl/theme/theme1.xml'));
  const styles = readStyles(xml('xl/styles.xml'), theme);
  // Kept as written: a run without a font of its own takes the font of the cell it is in.
  const shared = descendants(xml('xl/sharedStrings.xml'), 'si');

  return {
    sheets: sheets.map(one => one.name),
    sheet: name => {
      const found = name === undefined ? sheets[0] : sheets.find(one => one.name === name);
      const part = found ? xml(found.path) : undefined;
      return found && part ? readSheet(found.name, part, styles, shared, theme) : undefined;
    },
  };
}

function partPath(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  return `xl/${target}`.replace(/\/[^/]+\/\.\.\//g, '/');
}

interface CellStyle {
  readonly font: Omit<Run, 'text'>;
  readonly format: string;
  readonly fill: string | undefined;
  readonly align: Horizontal | undefined;
}

const PLAIN_FONT: Omit<Run, 'text'> = { bold: false, italic: false, code: false, colour: undefined };
const NO_STYLE: CellStyle = { font: PLAIN_FONT, format: 'General', fill: undefined, align: undefined };

function readStyles(styles: XmlNode | undefined, theme: ThemeColours): CellStyle[] {
  const formats = new Map<number, string>(Object.entries(BUILT_IN_FORMATS).map(([id, code]) => [Number(id), code]));
  for (const one of descendants(styles, 'numFmt')) {
    formats.set(Number(one.attributes['numFmtId']), one.attributes['formatCode'] ?? 'General');
  }
  const sheet = child(styles, 'styleSheet');
  const fonts = children(child(sheet, 'fonts'), 'font').map(font => fontOf(font, theme));
  const fills = children(child(sheet, 'fills'), 'fill').map(fill => {
    const pattern = child(fill, 'patternFill');
    if (pattern?.attributes['patternType'] !== 'solid') return undefined;
    const colour = colourOf(child(pattern, 'fgColor'), theme);
    return colour === '#ffffff' ? undefined : colour;
  });
  return children(child(sheet, 'cellXfs'), 'xf').map(xf => {
    const horizontal = child(xf, 'alignment')?.attributes['horizontal'];
    return {
      font: fonts[Number(xf.attributes['fontId'] ?? 0)] ?? NO_STYLE.font,
      format: formats.get(Number(xf.attributes['numFmtId'] ?? 0)) ?? 'General',
      fill: fills[Number(xf.attributes['fillId'] ?? 0)],
      align: horizontal === 'right' ? 'right' : horizontal === 'left' ? 'left'
        : horizontal === 'center' || horizontal === 'centerContinuous' ? 'center' : undefined,
    };
  });
}

/** A `<font>` or a run's `<rPr>` as the marks it draws. */
function fontOf(font: XmlNode, theme: ThemeColours): Omit<Run, 'text'> {
  const on = (name: string): boolean => {
    const found = child(font, name);
    const value = found?.attributes['val'];
    return found !== undefined && value !== '0' && value !== 'false' && value !== 'none';
  };
  const raise = child(font, 'vertAlign')?.attributes['val'];
  const colour = colourOf(child(font, 'color'), theme);
  const name = child(font, 'name')?.attributes['val'] ?? child(font, 'rFont')?.attributes['val'];
  return {
    bold: on('b'), italic: on('i'), code: isCodeFont(name),
    colour: colour === '#000000' ? undefined : colour,
    strike: on('strike'), underline: on('u'),
    script: raise === 'superscript' ? 'sup' : raise === 'subscript' ? 'sub' : undefined,
  };
}

/** The runs of a shared string or an inline string; a run without its own font takes the cell's. */
function richRuns(item: XmlNode, cellFont: Omit<Run, 'text'> | undefined, theme: ThemeColours): Run[] {
  const base = cellFont ?? NO_STYLE.font;
  const runs = children(item, 'r');
  if (runs.length === 0) {
    const text = child(item, 't')?.text ?? '';
    return text === '' ? [] : [{ ...base, text }];
  }
  return runs.map(run => {
    const properties = child(run, 'rPr');
    return { ...(properties ? fontOf(properties, theme) : base), text: child(run, 't')?.text ?? '' };
  });
}

function readSheet(
  name: string, part: XmlNode, styles: readonly CellStyle[], shared: readonly XmlNode[], theme: ThemeColours,
): Sheet {
  const cells = new Map<string, SheetCell>();
  for (const cell of descendants(part, 'c')) {
    const at = position(cell.attributes['r'] ?? '');
    if (!at) continue;
    const style = styles[Number(cell.attributes['s'] ?? 0)] ?? NO_STYLE;
    const type = cell.attributes['t'] ?? 'n';
    const value = child(cell, 'v')?.text;
    let runs: Run[];
    if (type === 's') {
      const item = shared[Number(value)];
      runs = item ? richRuns(item, style.font, theme) : [];
    } else if (type === 'inlineStr') {
      runs = richRuns(child(cell, 'is') ?? cell, style.font, theme);
    } else if (value === undefined || value === '') {
      runs = [];
    } else if (type === 'b') {
      runs = [{ ...style.font, text: value === '1' ? 'TRUE' : 'FALSE' }];
    } else if (type === 'n') {
      runs = [{ ...style.font, text: formatNumber(Number(value), style.format) }];
    } else {
      runs = [{ ...style.font, text: value }];
    }
    // A cell nobody aligned is drawn by what it holds: Excel puts a number at
    // the right and words at the left. What comes back is what was on screen.
    const shown = style.align ?? (type === 'n' && runs.length > 0 ? 'right' : undefined);
    cells.set(`${at.row},${at.column}`, {
      runs, fill: style.fill, align: shown === 'left' ? undefined : shown, formula: child(cell, 'f') !== undefined,
    });
  }
  const merges = descendants(part, 'mergeCell').flatMap(one => {
    const [from, to] = (one.attributes['ref'] ?? '').split(':').map(position);
    return from && to ? [{ row: from.row, column: from.column, rows: to.row - from.row + 1, columns: to.column - from.column + 1 }] : [];
  });
  const widths = new Map<number, number>();
  for (const column of descendants(part, 'col')) {
    const width = Number(column.attributes['width']);
    if (!Number.isFinite(width)) continue;
    for (let c = Number(column.attributes['min']); c <= Number(column.attributes['max']) && c <= 16384; c++) widths.set(c - 1, width);
  }
  return { name, cells, merges, widths };
}

/** `B3` as row 2, column 1. */
export function position(ref: string): { row: number; column: number } | undefined {
  const found = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref.trim());
  if (!found) return undefined;
  let column = 0;
  for (const letter of found[1]!.toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
  return { row: Number(found[2]) - 1, column: column - 1 };
}

/** `A1:F20` as an area. */
export function areaOf(text: string): Area | undefined {
  const [from, to] = text.split(':').map(position);
  if (!from) return undefined;
  const end = to ?? from;
  return {
    top: Math.min(from.row, end.row), left: Math.min(from.column, end.column),
    bottom: Math.max(from.row, end.row), right: Math.max(from.column, end.column),
  };
}

/** The smallest area holding every cell that says something, and every merge. */
export function usedArea(sheet: Sheet): Area | undefined {
  let area: Area | undefined;
  const take = (row: number, column: number): void => {
    area = area
      ? { top: Math.min(area.top, row), left: Math.min(area.left, column), bottom: Math.max(area.bottom, row), right: Math.max(area.right, column) }
      : { top: row, left: column, bottom: row, right: column };
  };
  for (const [key, cell] of sheet.cells) {
    if (cell.runs.every(run => run.text.trim() === '')) continue;
    const [row, column] = key.split(',').map(Number) as [number, number];
    take(row, column);
  }
  for (const merge of sheet.merges) {
    take(merge.row, merge.column);
    take(merge.row + merge.rows - 1, merge.column + merge.columns - 1);
  }
  return area;
}

/**
 * The grid an area of a sheet shows: its first row is the header, the rest
 * the body. The header's own bold is the header's look, not a mark, and is
 * not read as one.
 */
export function gridOfSheet(sheet: Sheet, area: Area | undefined = usedArea(sheet)): { grid: Grid; notes: SheetNotes } {
  if (!area) return { grid: { header: [], rows: [], merges: [], widths: [] }, notes: { formulas: 0 } };
  let formulas = 0;
  const cellAt = (row: number, column: number): SheetCell | undefined => sheet.cells.get(`${row},${column}`);
  const columns = area.right - area.left + 1;
  const header = Array.from({ length: columns }, (_, c) =>
    inlineOf((cellAt(area.top, area.left + c)?.runs ?? []).map(run => ({ ...run, bold: false }))));
  const covered = (row: number, column: number): boolean => sheet.merges.some(one =>
    one.row <= row && row < one.row + one.rows && one.column <= column && column < one.column + one.columns
    && !(one.row === row && one.column === column));
  const rows: GridCell[][] = [];
  for (let r = area.top + 1; r <= area.bottom; r++) {
    rows.push(Array.from({ length: columns }, (_, c): GridCell => {
      const cell = cellAt(r, area.left + c);
      if (!cell || covered(r, area.left + c)) return { text: '' };
      if (cell.formula) formulas += 1;
      return {
        text: inlineOf(cell.runs),
        ...(cell.fill ? { fill: cell.fill } : {}),
        ...(cell.align ? { align: cell.align } : {}),
      };
    }));
  }
  const merges = sheet.merges
    .filter(one => one.row > area.top && one.row <= area.bottom && one.column >= area.left && one.column <= area.right)
    .map(one => ({
      row: one.row - area.top - 1, column: one.column - area.left,
      rows: Math.min(one.rows, area.bottom - one.row + 1), columns: Math.min(one.columns, area.right - one.column + 1),
    }))
    .filter(one => one.rows > 1 || one.columns > 1);
  const widths = Array.from({ length: columns }, (_, c) => sheet.widths.get(area.left + c));
  return { grid: { header, rows, merges, widths }, notes: { formulas } };
}
