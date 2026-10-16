// Grid operations on a `.table` file.
//
// Every one is a byte-range edit in that file, and the range is as small as
// the change: editing a cell rewrites its line, adding a row inserts one line.
// Only a column operation has to touch every line, because a column runs down
// all of them — that is the change, not a side effect of how it is stored.

import {
  cellAt, delimiterField, displayWidth, escapeCell, formatGrid, formatRule, insertField, joinFields,
  removeField, replaceField, sameSelector, splitFields,
  type Align, type Selector, type TableFile,
} from '@docpresenter/markdown';
import { described, LocalizedError, type Edit, type Phrase } from '@docpresenter/base';
import { ed } from './messages.js';

export class TableEditError extends LocalizedError {}

/** Every line of the grid, in order, with the range it occupies. */
function gridLines(table: TableFile): { text: string; start: number; end: number }[] {
  return [table.header, table.delimiter, ...table.rows.map(r => r.line)]
    .map(line => ({ text: line.text, start: line.span.start, end: line.span.end }));
}

/** Row -1 is the header; 0 and up are body rows. The delimiter is not a row. */
function lineOf(table: TableFile, row: number): { text: string; start: number; end: number } {
  const line = row < 0 ? table.header : table.rows[row]?.line;
  if (!line) throw new TableEditError(ed('editor.table.noRow', { row: row + 1 }));
  return { text: line.text, start: line.span.start, end: line.span.end };
}

export function setCell(table: TableFile, row: number, column: number, text: string): Edit {
  const line = lineOf(table, row);
  return {
    span: { start: line.start, end: line.end },
    text: replaceField(line.text, column, text),
    ...described(ed('editor.did.cell')),
  };
}

export function setAlign(table: TableFile, column: number, align: Align): Edit {
  const fields = splitFields(table.delimiter.text);
  const width = displayWidth((fields[column] ?? '   ').trim());
  fields[column] = delimiterField(align, width);
  return {
    span: table.delimiter.span,
    text: joinFields(fields),
    ...described(ed('editor.did.align')),
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
      ...described(ed('editor.did.insertRow')),
    };
  }
  const line = lineOf(table, at);
  return {
    span: { start: line.start, end: line.start },
    text: `${blank}\n`,
    ...described(ed('editor.did.insertRow')),
  };
}

export function removeRow(table: TableFile, at: number): Edit {
  if (table.rows.length <= 1) throw new TableEditError(ed('editor.table.lastRow'));
  const line = lineOf(table, at);
  // Take the newline on one side so no blank line is left behind.
  const span = at > 0
    ? { start: lineOf(table, at - 1).end, end: line.end }
    : { start: line.start, end: line.end + table.lineEnding.length };
  return { span, text: '', ...described(ed('editor.did.removeRow')) };
}

export function insertColumn(table: TableFile, at: number, header = ''): Edit {
  return rewriteGrid(table, (text, index) => {
    if (index === 0) return insertField(text, at, header);
    if (index === 1) return insertField(text, at, '---');
    return insertField(text, at, '');
  }, ed('editor.did.insertColumn'));
}

export function removeColumn(table: TableFile, at: number): Edit {
  if (table.columns.length <= 1) throw new TableEditError(ed('editor.table.lastColumn'));
  return rewriteGrid(table, text => removeField(text, at), ed('editor.did.removeColumn'));
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
      // A pipe from a spreadsheet is a character, not a column: written `\|`,
      // as typing it into a cell writes it.
      source.forEach((value, i) => { fields[column + i] = ` ${escapeCell(value.trim())} `; });
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
    ...described(ed('editor.did.paste')),
  };
}

/** The explicit format command. Never run on its own. */
export function formatTable(table: TableFile): Edit {
  const lines = gridLines(table);
  return {
    span: { start: lines[0]!.start, end: lines[lines.length - 1]!.end },
    text: formatGrid(table),
    ...described(ed('editor.did.format')),
  };
}

/**
 * Parses what a spreadsheet puts on the clipboard: rows of tab-separated cells.
 *
 * A cell holding a line break, a tab or a quote comes in double quotes, with a
 * quote inside written twice — Excel and Google Sheets both write it so. Read
 * line by line, such a cell would split into two rows. A quote that does not
 * open a quoted cell this way is an ordinary character.
 */
export function parseClipboardGrid(text: string): string[][] {
  const source = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let at = 0;
  for (;;) {
    let cell: string | undefined;
    if (source[at] === '"') {
      const quoted = /^"((?:[^"]|"")*)"(?=\t|\n|$)/.exec(source.slice(at));
      if (quoted) {
        cell = quoted[1]!.replace(/""/g, '"');
        at += quoted[0].length;
      }
    }
    if (cell === undefined) {
      const end = source.slice(at).search(/[\t\n]/);
      cell = end < 0 ? source.slice(at) : source.slice(at, at + end);
      at += cell.length;
    }
    row.push(cell);
    const next = source[at];
    at += 1;
    if (next === '\t') continue;
    rows.push(row);
    if (next === undefined) return rows;
    row = [];
  }
}

/** A cell for the clipboard, quoted the way a spreadsheet reads it back. */
function clipboardCell(text: string): string {
  return /["\t\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The picked rectangle as tab-separated text: what a spreadsheet expects on the
 * clipboard, and what `parseClipboardGrid` reads back. A position covered by a
 * merge is empty rather than a repeat of the cell that owns it — a repeat would
 * paste as real duplicated values.
 */
export function copyRange(table: TableFile, range: CellRange): string {
  const { top, left, bottom, right } = wholeCells(table, range);
  const lines: string[] = [];
  for (let r = top; r <= bottom; r++) {
    const fields: string[] = [];
    for (let c = left; c <= right; c++) {
      if (r < 0) { fields.push(clipboardCell(table.columns[c]?.header ?? '')); continue; }
      const cell = cellAt(table, r, c);
      fields.push(cell && cell.row === r && cell.column === c ? clipboardCell(cell.text.trim()) : '');
    }
    lines.push(fields.join('\t'));
  }
  return lines.join('\n');
}

/**
 * Empties every cell in the range in one edit. The merge markers stay: they say
 * what shape the grid is, not what is written in it, and clearing them would
 * silently break the row apart.
 */
export function clearRange(table: TableFile, range: CellRange): Edit {
  const { top, left, bottom, right } = wholeCells(table, range);
  const lines = gridLines(table);
  const first = top < 0 ? 0 : top + 2;
  const last = Math.min(bottom + 2, lines.length - 1);
  const written = lines.slice(first, last + 1).map((line, offset) => {
    const index = first + offset;
    // 0 is the header, 1 the delimiter, and the rest are rows.
    const row = index === 0 ? -1 : index === 1 ? undefined : index - 2;
    if (row === undefined) return line.text;
    let text = line.text;
    for (let c = left; c <= right; c++) {
      const field = splitFields(text)[c]?.trim();
      if (field === '^' || field === '<') continue;
      text = replaceField(text, c, '');
    }
    return text;
  });
  return {
    span: { start: lines[first]!.start, end: lines[last]!.end },
    text: written.join('\n'),
    ...described(ed('editor.did.clear')),
  };
}

function rewriteGrid(
  table: TableFile, rewrite: (text: string, index: number) => string, description: Phrase,
): Edit {
  const lines = gridLines(table);
  return {
    span: { start: lines[0]!.start, end: lines[lines.length - 1]!.end },
    text: lines.map((line, i) => rewrite(line.text, i)).join('\n'),
    ...described(description),
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
  if (top === bottom && left === right) throw new TableEditError(ed('editor.table.oneCell'));
  if (top < 0) throw new TableEditError(ed('editor.table.headerMerge'));

  const lines: { span: { start: number; end: number }; text: string }[] = [];
  for (let r = top; r <= bottom; r++) {
    const line = table.rows[r]?.line;
    if (!line) throw new TableEditError(ed('editor.table.outside'));
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
    ...described(ed('editor.did.merge')),
  };
}

/** Takes the row below into the cell at (row, column). */
export function mergeDown(table: TableFile, row: number, column: number): Edit {
  const owner = cellAt(table, row, column);
  if (!owner) throw new TableEditError(ed('editor.table.noOwner'));
  const below = table.rows[owner.row + owner.rowspan];
  if (!below) throw new TableEditError(ed('editor.table.noRowBelow'));

  // A cell that spans several columns is marked once per column below it.
  let text = below.line.text;
  for (let c = owner.column; c < owner.column + owner.colspan; c++) {
    text = replaceField(text, c, MERGE_UP);
  }
  return { span: below.line.span, text, ...described(ed('editor.did.merge')) };
}

/** Takes the column to the right into the cell at (row, column). */
export function mergeRight(table: TableFile, row: number, column: number): Edit {
  const owner = cellAt(table, row, column);
  if (!owner) throw new TableEditError(ed('editor.table.noOwner'));
  const next = owner.column + owner.colspan;
  if (next >= table.columns.length) throw new TableEditError(ed('editor.table.noColumnRight'));

  // Every row the cell covers gives up its cell in that column.
  const lines = [];
  for (let r = owner.row; r < owner.row + owner.rowspan; r++) {
    const line = table.rows[r]?.line;
    if (!line) continue;
    lines.push({ span: line.span, text: replaceField(line.text, next, MERGE_LEFT) });
  }
  if (lines.length === 0) throw new TableEditError(ed('editor.table.noOwner'));
  return {
    span: { start: lines[0]!.span.start, end: lines[lines.length - 1]!.span.end },
    text: lines.map(l => l.text).join('\n'),
    ...described(ed('editor.did.merge')),
  };
}

/** Clears the markers a merged cell holds, giving the positions back. */
export function unmerge(table: TableFile, row: number, column: number): Edit {
  const owner = cellAt(table, row, column);
  if (!owner || (owner.rowspan === 1 && owner.colspan === 1)) {
    throw new TableEditError(ed('editor.table.notMerged'));
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
    ...described(ed('editor.did.unmerge')),
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
export type StyleProperty =
  | 'fill' | 'color' | 'width' | 'align' | 'bottom' | 'right' | 'top' | 'left';

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
      return { span: table.header.span, text: table.header.text, ...described(ed('editor.did.nothing')) };
    }
    return addRule(table, selector, new Map([[property, value]]));
  }

  const declarations = new Map(existing.declarations);
  if (value === undefined) declarations.delete(property);
  else declarations.set(property, value);

  if (declarations.size === 0) {
    return {
      span: { start: existing.span.start, end: existing.span.end + table.lineEnding.length },
      text: '',
      ...described(ed('editor.did.unstyle')),
    };
  }
  return {
    span: existing.span,
    text: formatRule(selector, declarations),
    ...described(value === undefined ? ed('editor.did.unstyle') : ed('editor.did.style')),
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
    ...described(ed('editor.did.width')),
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
      ...described(ed('editor.did.style')),
    };
  }
  // No style block yet: start one after everything else in the file.
  const end = lastByte(table);
  return {
    span: { start: end, end },
    text: `\n\nstyle {\n  ${line}\n}`,
    ...described(ed('editor.did.style')),
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
