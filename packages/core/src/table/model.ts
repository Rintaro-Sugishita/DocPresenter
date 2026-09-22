// The table model. Merging lives in the content layer so that the grid's shape
// stays readable from the text alone; ruling and fills live in the style layer
// and are recorded only where they deviate from the theme.

export type Align = 'left' | 'center' | 'right' | 'default';

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
}

/** Holds only the cells that start in this row; merged-away positions are absent. */
export interface Row {
  readonly cells: Cell[];
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
  /** Block content referenced from a cell as `@1`. */
  readonly blocks: ReadonlyMap<string, string>;
  /** Theme name from `style { theme: ... }`, if given. */
  readonly theme: string | undefined;
  readonly style: readonly StyleRule[];
  /** Named row ranges, used by partial references such as `{rows="認証関連"}`. */
  readonly ranges: ReadonlyMap<string, NamedRange>;
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
