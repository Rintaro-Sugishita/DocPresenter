// The table model. Merging lives in the content layer so that the grid's shape
// stays readable from the text alone; ruling and fills live in the style layer
// and are recorded only where they deviate from the theme.

import type { LineEnding } from '@docpresenter/base';
import type { ByteSpan } from '../document/model.js';

export type Align = 'left' | 'center' | 'right' | 'default';

/**
 * One line of the grid, with the bytes it occupies. A cell is edited by
 * rewriting its own line and nothing else: the escapes and the padding inside
 * a line are easier to keep right by substituting one field than by tracking a
 * byte range per cell, and one line is already a small enough edit.
 */
export interface GridLine {
  readonly text: string;
  readonly span: ByteSpan;
}

export interface Column {
  readonly header: string;
  readonly align: Align;
}

/** A cell occupies `rowspan` x `colspan` positions starting at its own. */
export interface Cell {
  readonly text: string;
  readonly row: number;
  readonly column: number;
  rowspan: number;
  colspan: number;
  /**
   * A cell written `#`: its place among the `#` cells of its column, from 1.
   * The number is computed, never written, so a row inserted above does not
   * change every row below it in the diff.
   */
  number?: number;
}

/** The cell's text as a reader sees it: a `#` cell shows its number. */
export function shownText(cell: Cell): string {
  return cell.number === undefined ? cell.text : String(cell.number);
}

/** Holds only the cells that start in this row; merged-away positions are absent. */
export interface Row {
  readonly cells: Cell[];
  readonly line: GridLine;
}

export type Selector =
  | { readonly kind: 'header' }
  | { readonly kind: 'column'; readonly name: string }
  | { readonly kind: 'row'; readonly which: 'odd' | 'even' | 'all' }
  /**
   * One cell. The row is named by the text of its leading cell, or — written
   * `cell:[BY=ROW]/COL` — by the text of its cell in the column headed `BY`,
   * for a table whose leading column repeats (`^` merged down, `#` numbers).
   */
  | { readonly kind: 'cell'; readonly row: string; readonly column: string; readonly by?: string }
  | { readonly kind: 'range'; readonly from: string; readonly to: string }
  | { readonly kind: 'namedRange'; readonly name: string };

export interface StyleRule {
  readonly selector: Selector;
  readonly declarations: ReadonlyMap<string, string>;
  /** The rule's own line, so one rule can be rewritten without the others. */
  readonly span: ByteSpan;
}

/** Where rules live, so the editor can add one. */
export interface StyleBlock {
  /** The whole `style { … }` block. */
  readonly span: ByteSpan;
  /** Just before the closing brace: where a new rule goes. */
  readonly insertAt: number;
  /** The indent the existing rules use. */
  readonly indent: string;
}

export interface NamedRange {
  readonly from: string;
  readonly to: string;
}

export interface TableFile {
  /** `#` lines before the grid. Not part of the table. */
  readonly comments: readonly string[];
  readonly columns: readonly Column[];
  readonly rows: readonly Row[];
  /** The header line and the `---` line below it, for editing in place. */
  readonly header: GridLine;
  readonly delimiter: GridLine;
  /** Block content referenced from a cell as `@1`. */
  readonly blocks: ReadonlyMap<string, string>;
  /** Theme name from `style { theme: ... }`, if given. */
  readonly theme: string | undefined;
  readonly style: readonly StyleRule[];
  /** Absent when the file has no `style { … }` block yet. */
  readonly styleBlock: StyleBlock | undefined;
  /** Named row ranges, used by partial references such as `{rows="認証関連"}`. */
  readonly ranges: ReadonlyMap<string, NamedRange>;
  /**
   * How the file ends its lines. A line's range stops before its line break,
   * so removing a whole line has to know how long the break is: one byte, or
   * two on a CRLF checkout.
   */
  readonly lineEnding: LineEnding;
}

/** The text a row is named by in a rule: its first cell that starts on the row. */
export function rowKeyOf(table: TableFile, row: number): string | undefined {
  return table.rows[row]?.cells[0]?.text;
}

/** Whether a `cell:` selector names this body row. */
export function cellSelectorRow(
  table: TableFile, selector: { readonly row: string; readonly by?: string }, row: number,
): boolean {
  if (selector.by === undefined) return rowKeyOf(table, row) === selector.row;
  const column = table.columns.findIndex(one => one.header === selector.by);
  return column >= 0 && cellAt(table, row, column)?.text === selector.row;
}

/**
 * The selector for one body cell, named so that it picks out that cell alone:
 * by the leading cell when its text is unique, otherwise by the first column
 * whose text is unique down the table. Undefined when no column tells the row
 * apart — a rule could not name the cell without naming others too.
 */
export function cellSelectorFor(
  table: TableFile, row: number, column: number,
): Extract<Selector, { kind: 'cell' }> | undefined {
  const header = table.columns[column]?.header;
  if (header === undefined || row < 0 || row >= table.rows.length) return undefined;
  const key = rowKeyOf(table, row);
  const usable = (text: string | undefined): text is string =>
    text !== undefined && text.trim() !== '' && text !== '#' && text !== '^' && text !== '<';
  if (usable(key) && table.rows.filter((_, r) => rowKeyOf(table, r) === key).length === 1) {
    return { kind: 'cell', row: key, column: header };
  }
  for (let c = 0; c < table.columns.length; c++) {
    const by = table.columns[c]!.header;
    if (by.trim() === '' || table.columns.filter(one => one.header === by).length > 1) continue;
    const own = cellAt(table, row, c);
    if (!own || own.row !== row || own.rowspan > 1 || !usable(own.text)) continue;
    const same = table.rows.filter((_, r) => cellAt(table, r, c)?.text === own.text).length;
    if (same === 1) return { kind: 'cell', row: own.text, column: header, by };
  }
  return undefined;
}

/** Resolves the cell covering a grid position, or undefined when out of range. */
export function cellAt(table: TableFile, row: number, column: number): Cell | undefined {
  for (let r = row; r >= 0; r--) {
    for (const cell of table.rows[r]?.cells ?? []) {
      if (
        cell.column <= column && column < cell.column + cell.colspan &&
        cell.row <= row && row < cell.row + cell.rowspan
      ) return cell;
    }
  }
  return undefined;
}
