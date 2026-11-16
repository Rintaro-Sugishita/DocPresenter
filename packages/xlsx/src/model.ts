// A table as a grid of what each cell shows: the shape a `.table` file and an
// Excel sheet have in common.
//
// Both sides are turned into this, and compared as this: the table written
// out and read back is the "before", the sheet Excel saved is the "after".
// Comparing like with like is what lets a round trip leave untouched cells,
// their padding and their `#` numbers exactly as they were.

export type Horizontal = 'left' | 'center' | 'right';

export interface GridCell {
  /** What the cell says, in the inline notation a `.table` cell is written in. */
  readonly text: string;
  /** A colour the author picked, `#rrggbb`. */
  readonly fill?: string | undefined;
  /**
   * Where the cell's words sit. Left is how a page draws a cell nobody
   * aligned, so left is left out: a cell set left and a cell never set are
   * the same cell, on the page and in Excel.
   */
  readonly align?: 'center' | 'right' | undefined;
}

/** Cells joined into one, in body coordinates (row 0 is the first row under the header). */
export interface Merge {
  readonly row: number;
  readonly column: number;
  readonly rows: number;
  readonly columns: number;
}

export interface Grid {
  readonly header: readonly string[];
  /** Every row as wide as the header; a position covered by a merge is empty. */
  readonly rows: readonly (readonly GridCell[])[];
  readonly merges: readonly Merge[];
  /** Column widths in Excel's unit, the width of a character. */
  readonly widths: readonly (number | undefined)[];
}

/** What could not come back from a sheet, said once rather than per cell. */
export interface SheetNotes {
  /** Cells holding a formula: their value came back, the formula did not. */
  readonly formulas: number;
}

export function sameCell(a: GridCell | undefined, b: GridCell | undefined): boolean {
  return (a?.text ?? '') === (b?.text ?? '') && a?.fill === b?.fill && a?.align === b?.align;
}

/** The merge whose top-left cell is at this position. */
export function mergeAt(grid: Grid, row: number, column: number): Merge | undefined {
  return grid.merges.find(one => one.row === row && one.column === column);
}

/** The merge covering this position without starting at it. */
export function coveredBy(grid: Grid, row: number, column: number): Merge | undefined {
  return grid.merges.find(one =>
    one.row <= row && row < one.row + one.rows && one.column <= column && column < one.column + one.columns
    && !(one.row === row && one.column === column));
}
