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
  | { readonly kind: 'cell'; readonly row: string; readonly column: string }
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
