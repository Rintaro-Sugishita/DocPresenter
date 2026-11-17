// A table on a screen that holds what is in it.
//
// The table picture (`ui/grid`) used to say only "a table goes here". A table
// on a real screen has columns with names, and rows that hold a check box, a
// link or a button as often as words — so what is in its cells has to be
// shapes, the same as anywhere else on the screen. A grid container already
// places shapes in cells; a table is that grid with the table picture as its
// frame, and its rules are drawn where its cells are (arrange.ts).
//
// What is written for one:
//
//   results  grid:
//   name     label:"氏名"
//   ...
//   grid results (cols: 1fr, 1fr; gap: 4 12; pad: 6) {
//     check ; name
//     c1    ; n1
//   }
//
// The first row is the header. Every change here is a few lines added or
// taken away and the grid's rows rewritten, worked out step by step and handed
// back as one edit.

import { applyEdit, byteLength, sliceBytes, type Edit, type Phrase } from '@docpresenter/base';
import { EMPTY_CELL, TABLE_PICTURE, containerOf, isTable } from './arrange.js';
import { DiagramEditError, editBetween, removeNodes, setContainerCells, splice } from './edits.js';
import { dgm } from './messages.js';
import type { DiagramFile } from './model.js';
import { parseDiagram } from './parse.js';

/** The rules between a table's cells, and the room round what is in them. */
const TABLE_GAP = { y: 4, x: 12 };
const TABLE_PAD = 6;

/** Where a shape is in a table: the table, and the row and column it sits in. */
export interface TableCell {
  readonly table: string;
  readonly row: number | undefined;
  readonly col: number | undefined;
}

/**
 * The table a shape belongs to: the table itself when the shape is one, or the
 * table whose cell it sits in. Undefined for anything else.
 */
export function tableOf(file: DiagramFile, id: string): TableCell | undefined {
  if (isTable(file, id)) return { table: id, row: undefined, col: undefined };
  const holder = containerOf(file).get(id);
  if (holder === undefined || !isTable(file, holder)) return undefined;
  const cells = file.containers.get(holder)!.cells;
  const row = cells.findIndex(one => one.includes(id));
  return { table: holder, row, col: row < 0 ? undefined : cells[row]!.indexOf(id) };
}

/** Whether a shape is drawn as a table that does not hold anything yet. */
export function isEmptyTable(file: DiagramFile, id: string): boolean {
  return file.style.get(id)?.get('icon') === TABLE_PICTURE && !file.containers.has(id);
}

/**
 * Gives a table picture something to hold: a header row of column names and
 * one row under it, every cell a shape that can be written in or changed into
 * another part.
 */
export function makeTable(
  file: DiagramFile, source: string, id: string, columns: readonly string[],
): Edit {
  if (!isEmptyTable(file, id)) throw new DiagramEditError(dgm('diagram.table.notEmptyTable', { id }));
  if (!file.body) throw new DiagramEditError(dgm('diagram.edit.noBody'));
  const names = freshIds(file, `${id}H`, columns.length);
  const row = freshIds(file, `${id}R`, columns.length, new Set(names));
  const lines = [
    ...names.map((name, i) => cellLine(file, name, 'label', columns[i]!)),
    ...row.map(name => cellLine(file, name, 'body', '')),
  ];
  const cols = columns.map(() => '1fr').join(', ');
  const block = [
    `grid ${id} (cols: ${cols}; gap: ${TABLE_GAP.y} ${TABLE_GAP.x}; pad: ${TABLE_PAD}) {`,
    `  ${names.join(' ; ')}`,
    `  ${row.join(' ; ')}`,
    '}',
  ];
  const changes = [
    { span: { start: file.body.insertAt, end: file.body.insertAt }, text: lines.map(line => `\n${file.body!.indent}${line}`).join('') },
    ...layoutLines(file, source, block),
  ];
  return splice(source, changes, dgm('diagram.did.makeTable'));
}

/** A row of new cells under the given row (the last one when none is given). */
export function addTableRow(
  file: DiagramFile, source: string, table: string, after: number | undefined,
): Edit {
  const grid = tableGrid(file, table);
  const width = Math.max(1, ...grid.cells.map(cells => cells.length));
  const row = freshIds(file, `${table}R`, width);
  const at = after === undefined ? grid.cells.length : Math.min(grid.cells.length, after + 1);
  // A new row under the header is a row of the table, not of headings.
  const cells = [...grid.cells.slice(0, at), row, ...grid.cells.slice(at)];
  return withCells(file, source, table, row.map(name => cellLine(file, name, 'body', '')), cells,
    dgm('diagram.did.tableRow'));
}

/** A column of new cells right of the given column (the last one when none is given). */
export function addTableColumn(
  file: DiagramFile, source: string, table: string, after: number | undefined, title: string,
): Edit {
  const grid = tableGrid(file, table);
  const width = Math.max(1, ...grid.cells.map(cells => cells.length));
  const at = after === undefined ? width : Math.min(width, after + 1);
  const ids = freshIds(file, `${table}C`, grid.cells.length);
  const lines = ids.map((name, r) => cellLine(file, name, r === 0 ? 'label' : 'body', r === 0 ? title : ''));
  const cells = grid.cells.map((cells, r) => {
    const padded = [...cells, ...Array.from({ length: width - cells.length }, () => EMPTY_CELL)];
    padded.splice(at, 0, ids[r]!);
    return padded;
  });
  const said = dgm('diagram.did.tableColumn');
  const edit = withCells(file, source, table, lines, cells, said);
  return columnsSpec(source, edit, table, cols => cols.splice(at, 0, '1fr'), said);
}

/** Takes away a row, and the shapes in it. The header row stays: a table needs one. */
export function removeTableRow(
  file: DiagramFile, source: string, table: string, row: number,
): Edit {
  const grid = tableGrid(file, table);
  if (grid.cells.length <= 1 || row < 0 || row >= grid.cells.length) {
    throw new DiagramEditError(dgm('diagram.table.lastRow'));
  }
  const going = grid.cells[row]!.filter(cell => cell !== EMPTY_CELL
    && !grid.cells.some((other, r) => r !== row && other.includes(cell)));
  const cells = grid.cells.filter((_, r) => r !== row);
  return without(file, source, table, going, cells, dgm('diagram.did.tableRowGone'));
}

/** Takes away a column, and the shapes in it. The last column stays. */
export function removeTableColumn(
  file: DiagramFile, source: string, table: string, col: number,
): Edit {
  const grid = tableGrid(file, table);
  const width = Math.max(1, ...grid.cells.map(cells => cells.length));
  if (width <= 1 || col < 0 || col >= width) throw new DiagramEditError(dgm('diagram.table.lastColumn'));
  const going = grid.cells.map(cells => cells[col]).filter((cell): cell is string => cell !== undefined
    && cell !== EMPTY_CELL && !grid.cells.some(other => other.some((one, c) => c !== col && one === cell)));
  const cells = grid.cells.map(cells => cells.filter((_, c) => c !== col));
  const said = dgm('diagram.did.tableColumnGone');
  const edit = without(file, source, table, going, cells, said);
  return columnsSpec(source, edit, table, cols => cols.splice(col, 1), said);
}

// --- 書き方 -------------------------------------------------------------------

function tableGrid(file: DiagramFile, table: string): { cells: readonly (readonly string[])[] } {
  const grid = file.containers.get(table);
  if (!grid || !isTable(file, table)) throw new DiagramEditError(dgm('diagram.table.notTable', { id: table }));
  return grid;
}

/** A cell's line: a part of the screen's library when it has one, words otherwise. */
function cellLine(file: DiagramFile, id: string, part: 'label' | 'body', text: string): string {
  const words = `"${text.replace(/"/g, '')}"`;
  return file.library.has(part) ? `${id} ${part}:${words}` : `${id} ${words}`;
}

/** `count` ids starting with `base` that nothing in the drawing has yet. */
function freshIds(file: DiagramFile, base: string, count: number, also: ReadonlySet<string> = new Set()): string[] {
  const taken = new Set([...file.nodes.map(node => node.id), ...file.containers.keys(), ...also]);
  const out: string[] = [];
  for (let n = 1; out.length < count; n++) {
    const id = `${base}${n}`;
    if (!taken.has(id)) { out.push(id); taken.add(id); }
  }
  return out;
}

/** Lines for the layout section, in it or in a new one at the end. */
function layoutLines(file: DiagramFile, source: string, lines: readonly string[]): { span: { start: number; end: number }; text: string }[] {
  if (file.layoutBlock) {
    return [{
      span: { start: file.layoutBlock.insertAt, end: file.layoutBlock.insertAt },
      text: lines.map(line => `\n${file.layoutBlock!.indent}${line}`).join(''),
    }];
  }
  const end = byteLength(source.replace(/\s+$/, ''));
  return [{
    span: { start: end, end: byteLength(source) },
    text: `\n\nlayout {\n${lines.map(line => `  ${line}`).join('\n')}\n}\n`,
  }];
}

/**
 * The text read again between two steps. Only the layout's rows are read from
 * it, so the parts are not looked up: a library in another file is not at
 * hand here, and nothing asked of it needs one.
 */
function reread(text: string): DiagramFile {
  return parseDiagram(text);
}

/** New shapes written, then the grid's rows rewritten — one edit. */
function withCells(
  file: DiagramFile, source: string, table: string, lines: readonly string[],
  cells: readonly (readonly string[])[], description: Phrase,
): Edit {
  if (!file.body) throw new DiagramEditError(dgm('diagram.edit.noBody'));
  const added = applyEdit(source, splice(source, [{
    span: { start: file.body.insertAt, end: file.body.insertAt },
    text: lines.map(line => `\n${file.body!.indent}${line}`).join(''),
  }], description));
  const after = applyEdit(added, setContainerCells(reread(added), added, table, cells));
  return editBetween(source, after, description);
}

/** Shapes taken away, then the grid's rows rewritten — one edit. */
function without(
  file: DiagramFile, source: string, table: string, going: readonly string[],
  cells: readonly (readonly string[])[], description: Phrase,
): Edit {
  // Removing a shape leaves its cell empty; the row or column it was in is
  // then taken out of the grid's rows.
  const gone = going.length === 0 ? source : applyEdit(source, removeNodes(file, source, going));
  const now = reread(gone);
  const current = now.containers.get(table);
  const same = current !== undefined && JSON.stringify(current.cells) === JSON.stringify(cells);
  const after = same ? gone : applyEdit(gone, setContainerCells(now, gone, table, cells));
  return editBetween(source, after, description);
}

/** The edit, with the grid's `cols:` list changed the same way its columns were. */
function columnsSpec(
  source: string, edit: Edit, table: string, change: (cols: string[]) => void, description: Phrase,
): Edit {
  const after = applyEdit(source, edit);
  const grid = reread(after).containers.get(table);
  if (!grid || grid.cols.length === 0) return edit;
  const cols = [...grid.cols];
  change(cols);
  const text = sliceBytes(after, grid.span.start, grid.span.end);
  const rewritten = text.replace(/cols\s*:\s*[^;)]*/, `cols: ${cols.join(', ')}`);
  const whole = sliceBytes(after, 0, grid.span.start) + rewritten + sliceBytes(after, grid.span.end, byteLength(after));
  return editBetween(source, whole, description);
}
