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
//   grid results (cols: col1 1fr, col2 1fr; gap: 4 12; pad: 6) {
//     check ; name
//     c1    ; n1
//   }
//
// The first row is the header (`head:` says how many rows are), the last
// `foot:` rows a footer, and the rows between the body. A table's rows repeat,
// so the body is worked on by column: a column is named in `cols:` and is one
// item of the screen, changing the part of one of its cells changes the
// column, and a row added takes the parts of the row above. A cell can still
// be made different on its own — a footer, or a row that really is unlike the
// rest. Every change here is a few lines added or taken away and the grid's
// rows rewritten, worked out step by step and handed back as one edit.

import { applyEdit, byteLength, described, sliceBytes, type Edit, type Phrase } from '@docpresenter/base';
import { EMPTY_CELL, TABLE_PICTURE, containerOf, isTable, rowRoles } from './arrange.js';
import { DiagramEditError, editBetween, removeNodes, setContainerCells, setNodePart, splice } from './edits.js';
import { containerSettings } from './format.js';
import { dgm } from './messages.js';
import type { Container, DiagramFile } from './model.js';
import { parseDiagram } from './parse.js';

/** The rules between a table's cells, and the room round what is in them. */
const TABLE_GAP = { y: 4, x: 12 };
const TABLE_PAD = 6;
/** What a new column is called until someone names it: `col1`, `col2`. */
const COLUMN = 'col';
/** What a column may be called: what an id may be, without a dot. */
const COLUMN_NAME = /^[A-Za-z0-9_\u3040-\u9fff]+$/;

/** What a row of a table is: a heading, a row of the body, or a footer. */
export type RowRole = 'head' | 'body' | 'foot';

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
  const cols = columns.map((_, i) => `${COLUMN}${i + 1} 1fr`).join(', ');
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

/**
 * A row of new cells under the given row (the last row of the body when none
 * is given). A new row is a row of the body, whichever row was picked — under
 * the headings, or above the footer — and its cells are the parts of the body
 * row above it, empty: a column of check boxes gets another check box.
 */
export function addTableRow(
  file: DiagramFile, source: string, table: string, after: number | undefined,
): Edit {
  const grid = tableGrid(file, table);
  const { head, foot } = rowRoles(grid);
  const width = Math.max(1, ...grid.cells.map(cells => cells.length));
  const row = freshIds(file, `${table}R`, width);
  const end = grid.cells.length - foot;
  const at = Math.max(head, Math.min(end, after === undefined ? end : after + 1));
  // The body row the new one copies: the one above it, or the first below it
  // when it is the first row of the body.
  const model = at > head ? grid.cells[at - 1] : at < end ? grid.cells[at] : undefined;
  const lines = row.map((name, c) => cellLine(file, name, partOfCell(file, model?.[c]), ''));
  const cells = [...grid.cells.slice(0, at), row, ...grid.cells.slice(at)];
  return withCells(file, source, table, lines, cells, dgm('diagram.did.tableRow'));
}

/** A column of new cells right of the given column (the last one when none is given). */
export function addTableColumn(
  file: DiagramFile, source: string, table: string, after: number | undefined, title: string,
): Edit {
  const grid = tableGrid(file, table);
  const width = Math.max(1, ...grid.cells.map(cells => cells.length));
  const at = after === undefined ? width : Math.min(width, after + 1);
  const { head } = rowRoles(grid);
  const ids = freshIds(file, `${table}C`, grid.cells.length);
  const lines = ids.map((name, r) => cellLine(file, name, r < head ? 'label' : 'body', r === head - 1 ? title : ''));
  const cells = grid.cells.map((cells, r) => {
    const padded = [...cells, ...Array.from({ length: width - cells.length }, () => EMPTY_CELL)];
    padded.splice(at, 0, ids[r]!);
    return padded;
  });
  const said = dgm('diagram.did.tableColumn');
  const edit = withCells(file, source, table, lines, cells, said);
  const taken = new Set(grid.names);
  let number = width + 1;
  while (taken.has(`${COLUMN}${number}`)) number++;
  return thenSettings(source, edit, table, one => {
    const cols = padded(one.cols, width, '1fr');
    const names = padded<string | undefined>(one.names, width, undefined);
    cols.splice(at, 0, '1fr');
    names.splice(at, 0, `${COLUMN}${number}`);
    return { ...one, cols, names };
  }, said);
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
  const said = dgm('diagram.did.tableRowGone');
  const edit = without(file, source, table, going, cells, said);
  // A heading or a footer taken away is one fewer of them.
  const { head, foot } = rowRoles(grid);
  if (row >= head && row < grid.cells.length - foot) return edit;
  return thenSettings(source, edit, table, one => (row < head
    ? { ...one, head: head - 1 } : { ...one, foot: foot - 1 }), said);
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
  if (grid.cols.length === 0 && grid.names.length === 0) return edit;
  return thenSettings(source, edit, table, one => ({
    ...one, cols: one.cols.filter((_, c) => c !== col), names: one.names.filter((_, c) => c !== col),
  }), said);
}

/**
 * Makes a row a heading, a row of the body or a footer. Headings are the rows
 * at the top and a footer the rows at the bottom, so a row made a heading
 * takes the rows above it along, and one made a footer the rows below it.
 */
export function setRowRole(
  file: DiagramFile, source: string, table: string, row: number, role: RowRole,
): Edit {
  const grid = tableGrid(file, table);
  const count = grid.cells.length;
  if (row < 0 || row >= count) throw new DiagramEditError(dgm('diagram.edit.noChange'));
  const { head, foot } = rowRoles(grid);
  let next = { head, foot };
  if (role === 'head') next = { head: row + 1, foot: Math.min(foot, count - row - 1) };
  else if (role === 'foot') next = { head: Math.min(head, row), foot: count - row };
  else next = { head: Math.min(head, row), foot: Math.min(foot, count - row - 1) };
  if (next.head === grid.head && next.foot === grid.foot) throw new DiagramEditError(dgm('diagram.edit.noChange'));
  return settingsEdit(source, grid, { ...grid, ...next }, dgm('diagram.did.rowRole'));
}

/**
 * Changes the part of every body cell of a column — a column of words made a
 * column of check boxes. The headings and the footer are not the column's
 * rows and keep what they are; a cell is changed on its own with
 * `setNodePart`.
 */
export function setColumnPart(
  file: DiagramFile, source: string, table: string, col: number, part: string,
): Edit {
  const grid = tableGrid(file, table);
  const { head, foot } = rowRoles(grid);
  const cells = [...new Set(grid.cells.slice(head, grid.cells.length - foot)
    .map(cells => cells[col])
    .filter((cell): cell is string => cell !== undefined && cell !== EMPTY_CELL))]
    .filter(cell => file.nodes.some(node => node.id === cell && node.shape !== 'group') && file.partOf.get(cell) !== part);
  if (cells.length === 0) throw new DiagramEditError(dgm('diagram.edit.noChange'));
  return splice(source, cells.map(cell => setNodePart(file, source, cell, part)), dgm('diagram.did.columnPart'));
}

/** Names a column: the name the item table knows it by (`results.pick`). */
export function renameColumn(
  file: DiagramFile, source: string, table: string, col: number, name: string,
): Edit {
  const grid = tableGrid(file, table);
  const wanted = name.trim();
  if (!COLUMN_NAME.test(wanted)) throw new DiagramEditError(dgm('diagram.table.badColumnName', { name: wanted }));
  const width = Math.max(1, ...grid.cells.map(cells => cells.length));
  if (col < 0 || col >= width) throw new DiagramEditError(dgm('diagram.edit.noChange'));
  if (grid.names.some((one, c) => c !== col && one === wanted)) {
    throw new DiagramEditError(dgm('diagram.table.columnTaken', { name: wanted }));
  }
  if (grid.names[col] === wanted) throw new DiagramEditError(dgm('diagram.edit.noChange'));
  // Naming a column writes `cols:` out in full: a name has to stand beside a width.
  const cols = padded(grid.cols, width, '1fr');
  const names = padded<string | undefined>(grid.names, width, undefined);
  names[col] = wanted;
  return settingsEdit(source, grid, { ...grid, cols, names }, dgm('diagram.did.renameColumn'));
}

/** How any container scrolls: not at all, down, across, or both ways. */
export function setScroll(
  file: DiagramFile, source: string, id: string, scroll: Container['scroll'],
): Edit {
  const container = file.containers.get(id);
  if (!container) throw new DiagramEditError(dgm('diagram.table.notContainer', { id }));
  if (container.scroll === scroll) throw new DiagramEditError(dgm('diagram.edit.noChange'));
  return settingsEdit(source, container, { ...container, scroll }, dgm('diagram.did.scroll'));
}

// --- 書き方 -------------------------------------------------------------------

function tableGrid(file: DiagramFile, table: string): Container {
  const grid = file.containers.get(table);
  if (!grid || !isTable(file, table)) throw new DiagramEditError(dgm('diagram.table.notTable', { id: table }));
  return grid;
}

/** A cell's line: a part of the screen's library when it has one, words otherwise. */
function cellLine(file: DiagramFile, id: string, part: string, text: string): string {
  const words = `"${text.replace(/"/g, '')}"`;
  return file.library.has(part) ? `${id} ${part}:${words}` : `${id} ${words}`;
}

/** The part a cell is written as, to give a new cell beside or under it; words when it names none. */
function partOfCell(file: DiagramFile, cell: string | undefined): string {
  const part = cell === undefined || cell === EMPTY_CELL ? undefined : file.partOf.get(cell);
  return part ?? 'body';
}

/** A list made as long as the table is wide, the missing ones filled. */
function padded<T>(list: readonly T[], width: number, fill: T): T[] {
  return Array.from({ length: Math.max(width, list.length) }, (_, i) => (i < list.length ? list[i]! : fill));
}

/**
 * A container's head line written again with other settings: everything
 * before its opening brace, in the canonical order, so what the canvas
 * writes is what the formatter would.
 */
function settingsEdit(source: string, was: Container, now: Container, description: Phrase): Edit {
  const text = sliceBytes(source, was.span.start, was.span.end);
  const brace = text.indexOf('{');
  const settings = containerSettings(now);
  return {
    span: { start: was.span.start, end: was.span.start + byteLength(text.slice(0, brace)) },
    text: `${now.kind} ${now.id}${settings === '' ? '' : ` (${settings})`} `,
    ...described(description),
  };
}

/** The edit, with the table's settings then changed as well — one edit. */
function thenSettings(
  source: string, edit: Edit, table: string, change: (container: Container) => Container, description: Phrase,
): Edit {
  const after = applyEdit(source, edit);
  const grid = reread(after).containers.get(table);
  if (!grid) return edit;
  const whole = applyEdit(after, settingsEdit(after, grid, change(grid), description));
  return editBetween(source, whole, description);
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
