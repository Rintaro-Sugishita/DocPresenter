// Grid operations on a `.table` file.
//
// Every one is a byte-range edit in that file, and the range is as small as
// the change: editing a cell rewrites its line, adding a row inserts one line.
// Only a column operation has to touch every line, because a column runs down
// all of them — that is the change, not a side effect of how it is stored.

import {
  cellAt, delimiterField, displayWidth, formatGrid, formatRule, insertField, joinFields,
  removeField, replaceField, sameSelector, splitFields,
  type Align, type Selector, type TableFile,
} from '@docpresenter/core';
import type { Edit } from './edit.js';

export class TableEditError extends Error {}

/** Every line of the grid, in order, with the range it occupies. */
function gridLines(table: TableFile): { text: string; start: number; end: number }[] {
  return [table.header, table.delimiter, ...table.rows.map(r => r.line)]
    .map(line => ({ text: line.text, start: line.span.start, end: line.span.end }));
}

/** Row -1 is the header; 0 and up are body rows. The delimiter is not a row. */
function lineOf(table: TableFile, row: number): { text: string; start: number; end: number } {
  const line = row < 0 ? table.header : table.rows[row]?.line;
  if (!line) throw new TableEditError(`${row + 1} 行目は無い`);
  return { text: line.text, start: line.span.start, end: line.span.end };
}

export function setCell(table: TableFile, row: number, column: number, text: string): Edit {
  const line = lineOf(table, row);
  return {
    span: { start: line.start, end: line.end },
    text: replaceField(line.text, column, text),
    description: 'セルを編集',
  };
}

export function setAlign(table: TableFile, column: number, align: Align): Edit {
  const fields = splitFields(table.delimiter.text);
  const width = displayWidth((fields[column] ?? '   ').trim());
  fields[column] = delimiterField(align, width);
  return {
    span: table.delimiter.span,
    text: joinFields(fields),
    description: '寄せを変更',
  };
}

/** Inserts an empty row before `at`; `at === rows.length` appends. */
export function insertRow(table: TableFile, at: number): Edit {
  const blank = joinFields(splitFields(table.delimiter.text).map(f => ' '.repeat(Math.max(1, f.length))));
  if (at >= table.rows.length) {
    const last = table.rows[table.rows.length - 1]?.line ?? table.delimiter;
    return {
      span: { start: last.span.end, end: last.span.end },
      text: `\n${blank}`,
      description: '行を追加',
    };
  }
  const line = lineOf(table, at);
  return {
    span: { start: line.start, end: line.start },
    text: `${blank}\n`,
    description: '行を追加',
  };
}

export function removeRow(table: TableFile, at: number): Edit {
  if (table.rows.length <= 1) throw new TableEditError('最後の行は削除できない');
  const line = lineOf(table, at);
  // Take the newline on one side so no blank line is left behind.
  const span = at > 0
    ? { start: lineOf(table, at - 1).end, end: line.end }
    : { start: line.start, end: line.end + 1 };
  return { span, text: '', description: '行を削除' };
}

export function insertColumn(table: TableFile, at: number, header = ''): Edit {
  return rewriteGrid(table, (text, index) => {
    if (index === 0) return insertField(text, at, header);
    if (index === 1) return insertField(text, at, '---');
    return insertField(text, at, '');
  }, '列を追加');
}

export function removeColumn(table: TableFile, at: number): Edit {
  if (table.columns.length <= 1) throw new TableEditError('最後の列は削除できない');
  return rewriteGrid(table, text => removeField(text, at), '列を削除');
}

/**
 * Pastes a block of values, growing the table when the block runs past its
 * edge. This is how a table arrives from Excel, so it is the one operation
 * that is allowed to change the grid's shape without being asked twice.
 */
export function pasteGrid(
  table: TableFile, row: number, column: number, values: readonly (readonly string[])[],
): Edit {
  const lines = gridLines(table);
  const needed = column + Math.max(...values.map(v => v.length));
  const width = Math.max(table.columns.length, needed);
  const height = Math.max(table.rows.length, row + values.length);

  const written: string[] = [];
  for (let r = -1; r < height; r++) {
    const existing = r === -1 ? lines[0] : lines[r + 2];
    const fields = splitFields(existing?.text ?? joinFields(new Array<string>(width).fill('   ')));
    while (fields.length < width) fields.push('   ');

    const source = r >= row ? values[r - row] : undefined;
    if (source) {
      source.forEach((value, i) => { fields[column + i] = ` ${value.trim()} `; });
    }
    written.push(joinFields(fields));
    if (r === -1) {
      const delimiter = splitFields(lines[1]!.text);
      while (delimiter.length < width) delimiter.push(' --- ');
      written.push(joinFields(delimiter));
    }
  }

  return {
    span: { start: lines[0]!.start, end: lines[lines.length - 1]!.end },
    text: written.join('\n'),
    description: '貼り付け',
  };
}

/** The explicit format command. Never run on its own. */
export function formatTable(table: TableFile): Edit {
  const lines = gridLines(table);
  return {
    span: { start: lines[0]!.start, end: lines[lines.length - 1]!.end },
    text: formatGrid(table),
    description: '表を整形',
  };
}

/** Parses what a spreadsheet puts on the clipboard. */
export function parseClipboardGrid(text: string): string[][] {
  return text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(line => line.split('\t'));
}

function rewriteGrid(
  table: TableFile, rewrite: (text: string, index: number) => string, description: string,
): Edit {
  const lines = gridLines(table);
  return {
    span: { start: lines[0]!.start, end: lines[lines.length - 1]!.end },
    text: lines.map((line, i) => rewrite(line.text, i)).join('\n'),
    description,
  };
}

// --- セル結合 -----------------------------------------------------------
//
// The file says a merge by marking the cell that gives itself up: `^` for the
// one above, `<` for the one to the left. So merging is writing those markers,
// and unmerging is clearing them — no range selection needed, and the grid
// shows the result because the parser reads the markers back as spans.

const MERGE_UP = '^';
const MERGE_LEFT = '<';

export interface CellRange {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

/** Grows a rectangle until it contains every cell it touches whole. */
export function wholeCells(table: TableFile, range: CellRange): CellRange {
  let { top, left, bottom, right } = range;
  for (let pass = 0; pass < 8; pass++) {
    let grew = false;
    for (let r = top; r <= bottom; r++) {
      for (let c = left; c <= right; c++) {
        const cell = cellAt(table, r, c);
        if (!cell) continue;
        if (cell.row < top) { top = cell.row; grew = true; }
        if (cell.column < left) { left = cell.column; grew = true; }
        if (cell.row + cell.rowspan - 1 > bottom) { bottom = cell.row + cell.rowspan - 1; grew = true; }
        if (cell.column + cell.colspan - 1 > right) { right = cell.column + cell.colspan - 1; grew = true; }
      }
    }
    if (!grew) break;
  }
  return { top, left, bottom, right };
}

/** The text that merging a range would throw away, top-left cell aside. */
export function mergeLoses(table: TableFile, range: CellRange): string[] {
  const { top, left, bottom, right } = wholeCells(table, range);
  const lost: string[] = [];
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      if (r === top && c === left) continue;
      const cell = cellAt(table, r, c);
      if (cell && cell.row === r && cell.column === c && cell.text.trim() !== '') {
        lost.push(cell.text.trim());
      }
    }
  }
  return lost;
}

/**
 * Merges a rectangle into its top-left cell. The first row marks the columns
 * to the right as given up, and every row below marks the whole width — which
 * is the spelling the parser already read before any of this existed.
 */
export function mergeRange(table: TableFile, range: CellRange): Edit {
  const { top, left, bottom, right } = wholeCells(table, range);
  if (top === bottom && left === right) throw new TableEditError('結合する範囲が 1 セルしかない');
  if (top < 0) throw new TableEditError('見出し行は結合できない');

  const lines: { span: { start: number; end: number }; text: string }[] = [];
  for (let r = top; r <= bottom; r++) {
    const line = table.rows[r]?.line;
    if (!line) throw new TableEditError('範囲が表の外に出ている');
    let text = line.text;
    for (let c = left; c <= right; c++) {
      if (r === top && c === left) continue;
      text = replaceField(text, c, r === top ? MERGE_LEFT : MERGE_UP);
    }
    lines.push({ span: line.span, text });
  }
  return {
    span: { start: lines[0]!.span.start, end: lines[lines.length - 1]!.span.end },
    text: lines.map(l => l.text).join('\n'),
    description: 'セルを結合',
  };
}

/** Takes the row below into the cell at (row, column). */
export function mergeDown(table: TableFile, row: number, column: number): Edit {
  const owner = cellAt(table, row, column);
  if (!owner) throw new TableEditError('結合するセルが無い');
  const below = table.rows[owner.row + owner.rowspan];
  if (!below) throw new TableEditError('これより下に行が無い');

  // A cell that spans several columns is marked once per column below it.
  let text = below.line.text;
  for (let c = owner.column; c < owner.column + owner.colspan; c++) {
    text = replaceField(text, c, MERGE_UP);
  }
  return { span: below.line.span, text, description: 'セルを結合' };
}

/** Takes the column to the right into the cell at (row, column). */
export function mergeRight(table: TableFile, row: number, column: number): Edit {
  const owner = cellAt(table, row, column);
  if (!owner) throw new TableEditError('結合するセルが無い');
  const next = owner.column + owner.colspan;
  if (next >= table.columns.length) throw new TableEditError('これより右に列が無い');

  // Every row the cell covers gives up its cell in that column.
  const lines = [];
  for (let r = owner.row; r < owner.row + owner.rowspan; r++) {
    const line = table.rows[r]?.line;
    if (!line) continue;
    lines.push({ span: line.span, text: replaceField(line.text, next, MERGE_LEFT) });
  }
  if (lines.length === 0) throw new TableEditError('結合するセルが無い');
  return {
    span: { start: lines[0]!.span.start, end: lines[lines.length - 1]!.span.end },
    text: lines.map(l => l.text).join('\n'),
    description: 'セルを結合',
  };
}

/** Clears the markers a merged cell holds, giving the positions back. */
export function unmerge(table: TableFile, row: number, column: number): Edit {
  const owner = cellAt(table, row, column);
  if (!owner || (owner.rowspan === 1 && owner.colspan === 1)) {
    throw new TableEditError('結合されていない');
  }
  const lines = [];
  for (let r = owner.row; r < owner.row + owner.rowspan; r++) {
    const line = table.rows[r]?.line;
    if (!line) continue;
    let text = line.text;
    for (let c = owner.column; c < owner.column + owner.colspan; c++) {
      if (r === owner.row && c === owner.column) continue;   // 本体は残す
      text = replaceField(text, c, '');
    }
    lines.push({ span: line.span, text });
  }
  return {
    span: { start: lines[0]!.span.start, end: lines[lines.length - 1]!.span.end },
    text: lines.map(l => l.text).join('\n'),
    description: '結合を解除',
  };
}

// --- スタイル -----------------------------------------------------------
//
// Ruling and fills are recorded only where they deviate from the theme, so a
// style change adds, rewrites or removes one rule line. The selectors are the
// ones the file already uses — a cell by the names of its row and column, a
// range by the names of its first and last row — so a rule keeps pointing at
// the same thing when rows move.

/**
 * The properties a rule may carry. `fill` and `color` take a colour the author
 * picked; `width` takes a share of the table. The rest are a theme's tokens.
 */
export type StyleProperty = 'fill' | 'color' | 'width' | 'bottom' | 'right' | 'top' | 'left';

/**
 * Sets one property on a selector. `undefined` removes it, and a rule with
 * nothing left in it is removed rather than left as an empty pair of braces.
 */
export function setStyle(
  table: TableFile, selector: Selector, property: StyleProperty, value: string | undefined,
): Edit {
  const existing = table.style.find(rule => sameSelector(rule.selector, selector));

  if (!existing) {
    if (value === undefined) {
      return { span: table.header.span, text: table.header.text, description: '変更なし' };
    }
    return addRule(table, selector, new Map([[property, value]]));
  }

  const declarations = new Map(existing.declarations);
  if (value === undefined) declarations.delete(property);
  else declarations.set(property, value);

  if (declarations.size === 0) {
    return {
      span: { start: existing.span.start, end: existing.span.end + 1 },
      text: '',
      description: 'スタイルを解除',
    };
  }
  return {
    span: existing.span,
    text: formatRule(selector, declarations),
    description: value === undefined ? 'スタイルを解除' : 'スタイルを設定',
  };
}

/** What a selector currently carries, for showing the buttons as pressed. */
export function styleAt(
  table: TableFile, selector: Selector, property: StyleProperty,
): string | undefined {
  return table.style
    .find(rule => sameSelector(rule.selector, selector))
    ?.declarations.get(property);
}

/** A column's width, as its own kind of change so the label reads right. */
export function setWidth(table: TableFile, column: string, width: string): Edit {
  return {
    ...setStyle(table, { kind: 'column', name: column }, 'width', width),
    description: '列幅を変更',
  };
}

function addRule(
  table: TableFile, selector: Selector, declarations: ReadonlyMap<string, string>,
): Edit {
  const line = formatRule(selector, declarations);
  if (table.styleBlock) {
    const { insertAt, indent } = table.styleBlock;
    return {
      span: { start: insertAt, end: insertAt },
      text: `\n${indent}${line}`,
      description: 'スタイルを設定',
    };
  }
  // No style block yet: start one after everything else in the file.
  const end = lastByte(table);
  return {
    span: { start: end, end },
    text: `\n\nstyle {\n  ${line}\n}`,
    description: 'スタイルを設定',
  };
}

function lastByte(table: TableFile): number {
  return Math.max(
    table.rows[table.rows.length - 1]?.line.span.end ?? 0,
    table.delimiter.span.end,
    ...table.style.map(rule => rule.span.end),
    table.styleBlock?.span.end ?? 0,
  );
}
