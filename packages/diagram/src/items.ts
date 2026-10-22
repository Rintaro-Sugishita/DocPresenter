// A screen and the table that lists its items.
//
// A screen is drawn and its item list is written, and until now the two said
// the same things twice: which items there are, in what order, with what
// number. The screen is where the items are, so it says which there are and in
// what order; the table is where an item's nature is written — its type, if it
// is required, which way its text runs — so the screen reads that from it. The
// shape's id is what joins a row to a shape; a number is computed from both and
// written in neither.
//
// Like the parts, the table is read by the host and applied before anything
// else sees the drawing, so the renderer, the canvas and the PPTX writer only
// meet ordinary styles and a list of marks to draw.

import {
  byteLength, displayWidth, escapeCell, replaceField, splitFields, splitGridRow,
  DEFAULT_LOCALE, described, type ByteSpan, type Edit, type Locale, type Phrase,
} from '@docpresenter/base';
import { containerOf, members } from './arrange.js';
import { DIAGRAM_MESSAGES, dgm } from './messages.js';
import type { DiagramFile, ItemLink, ItemLinks } from './model.js';
import { DiagramEditError } from './edits.js';

/** Reads a file named by the drawing, as written in it. */
type Reader = (path: string) => string | undefined;

/** One body line of the table. */
export interface ItemTableRow {
  /** The cells as a reader sees them: `^` already replaced by what it merges with. */
  readonly cells: readonly string[];
  /** The cells as written. */
  readonly written: readonly string[];
  readonly text: string;
  readonly span: ByteSpan;
}

/** The grid of a `.table`, as much of it as a screen needs. */
export interface ItemTable {
  readonly headers: readonly string[];
  readonly delimiter: { readonly text: string; readonly span: ByteSpan };
  readonly rows: readonly ItemTableRow[];
  /** From the first body line to the last; empty, after the delimiter, when there are none. */
  readonly body: ByteSpan;
}

/**
 * The headers each column is known by. A table is written in its author's
 * language, so both are read; the first of each is what this tool writes.
 */
const HEADERS = {
  id: ['ID', '項目ID', 'Item ID'],
  number: ['No', 'No.', '番号', '#', 'Number'],
  name: ['項目名', '名前', 'Name', 'Item'],
  category: ['分類', '種別', 'Category', 'Kind'],
  required: ['必須', 'Required'],
  align: ['寄せ', '配置', 'Align', 'Alignment'],
} as const;

export type ItemColumn = keyof typeof HEADERS;

/** A cell written `#`: a number computed from the row's place. */
export const AUTO_NUMBER = '#';
const MERGE_UP = '^';
/** What a cell that says "nothing here" is written as. */
const NOTHING = new Set(['', '—', '―', '-', '–', '−']);
const YES = new Set(['○', '◯', '●', '✓', '✔', '必須', 'yes', 'y', 'true', 'required']);
const NO = new Set(['×', '✕', '任意', 'no', 'n', 'false', 'optional']);
const ALIGN: Readonly<Record<string, 'left' | 'center' | 'right'>> = {
  '左': 'left', '左寄せ': 'left', 'left': 'left',
  '中央': 'center', '中': 'center', '中央寄せ': 'center', 'center': 'center', 'centre': 'center',
  '右': 'right', '右寄せ': 'right', 'right': 'right',
};
/** The shipped pictures of controls, and the kind of item each is. */
const PICTURE_ITEMS: Readonly<Record<string, string>> = {
  'ui/check': '入力', 'ui/check-on': '入力', 'ui/radio': '入力', 'ui/radio-on': '入力',
  'ui/select': '入力', 'ui/spinner': '入力', 'ui/slider': '入力',
  'ui/grid': '表示', 'ui/list': '表示', 'ui/tree': '表示', 'ui/menu': '操作',
};
/** A shape written as an item turns that off with this. */
const NOT_AN_ITEM = 'none';

/** The grid of a table file, or undefined when it has none. */
export function readItemTable(source: string): ItemTable | undefined {
  const ended = source.split('\n');
  let at = 0;
  const lines = ended.map(raw => {
    const line = raw.replace(/\r$/, '');
    const lead = line.length - line.trimStart().length;
    const text = line.trim();
    const start = at + byteLength(line.slice(0, lead));
    at += byteLength(raw) + 1;
    return { text, span: { start, end: start + byteLength(text) } };
  });
  let i = 0;
  while (i < lines.length && (lines[i]!.text === '' || lines[i]!.text.startsWith('#'))) i++;
  const grid: { text: string; span: ByteSpan }[] = [];
  for (; i < lines.length && lines[i]!.text.startsWith('|'); i++) grid.push(lines[i]!);
  if (grid.length < 2) return undefined;

  const headers = splitGridRow(grid[0]!.text);
  const above: string[] = [];
  const rows = grid.slice(2).map(line => {
    const written = splitGridRow(line.text);
    const cells = headers.map((_, c) => {
      const cell = written[c] ?? '';
      const value = cell === MERGE_UP ? above[c] ?? '' : cell;
      above[c] = value;
      return value;
    });
    return { cells, written, text: line.text, span: line.span };
  });
  const delimiter = grid[1]!;
  const body = rows.length === 0
    ? { start: delimiter.span.end, end: delimiter.span.end }
    : { start: rows[0]!.span.start, end: rows[rows.length - 1]!.span.end };
  return { headers, delimiter, rows, body };
}

/** Which column holds what, by header. */
export function itemColumns(headers: readonly string[]): Partial<Record<ItemColumn, number>> {
  const found: Partial<Record<ItemColumn, number>> = {};
  for (const [kind, names] of Object.entries(HEADERS) as [ItemColumn, readonly string[]][]) {
    const index = headers.findIndex(header =>
      names.some(name => name.toLowerCase() === header.trim().toLowerCase()));
    if (index >= 0) found[kind] = index;
  }
  return found;
}

/**
 * The shapes of a screen in the order a reader meets them: as the file lists
 * them, except that a container is read through — what it holds, in the order
 * it holds it — before going on. A shape a container holds is met there and
 * not again.
 */
export function readingOrder(diagram: DiagramFile): readonly string[] {
  const held = containerOf(diagram);
  const groups = new Map<string, readonly string[]>();
  for (const node of diagram.nodes) if (node.shape === 'group') groups.set(node.id, node.children);
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string, depth: number): void => {
    if (seen.has(id) || depth > 64) return;
    seen.add(id);
    order.push(id);
    const container = diagram.containers.get(id);
    for (const child of container ? members(container) : groups.get(id) ?? []) visit(child, depth + 1);
  };
  const inGroup = new Set([...groups.values()].flat());
  for (const node of diagram.nodes) if (!held.has(node.id) && !inGroup.has(node.id)) visit(node.id, 0);
  for (const node of diagram.nodes) visit(node.id, 0);
  return order.filter(id => diagram.nodes.some(node => node.id === id));
}

/**
 * The shapes that are items, with what kind of item each is.
 *
 * A part says it is one (`item: 入力`) — that is a decision about a product's
 * screens, not about drawings, so it lives with the parts and can be changed
 * there. One shape opts out with `item: none` in its own style.
 */
export function itemShapes(diagram: DiagramFile): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const node of diagram.nodes) {
    const rule = diagram.style.get(node.id);
    // A screen drawn with no library holds the shipped pictures themselves
    // (`{ icon: ui/check-on }`), and a check box is an item however it was put
    // there. The library's word wins where it says one.
    const kind = rule?.get('item') ?? PICTURE_ITEMS[rule?.get('icon') ?? ''];
    if (kind !== undefined && kind !== NOT_AN_ITEM && kind.trim() !== '') found.set(node.id, kind.trim());
  }
  return found;
}

/**
 * The words that name an item on the screen: the text beside it, or its own.
 *
 * A field is a caption and a box, and which comes first is how the container
 * starts: a stack that opens with a caption puts each caption before its box
 * (`ログイン ID` over its input), one that opens with a box puts it after (a
 * check box and the words to its right). A shape with neither beside it — a
 * button — is named by its own words. Asked again of the container when the
 * shape has no neighbour there, because a row of two inputs shares the
 * caption above the row.
 */
export function labelOf(diagram: DiagramFile, id: string, items?: ReadonlyMap<string, string>): string | undefined {
  const kinds = items ?? itemShapes(diagram);
  const held = containerOf(diagram);
  const byId = new Map(diagram.nodes.map(node => [node.id, node]));
  const isCaption = (name: string | undefined): boolean => {
    const node = name === undefined ? undefined : byId.get(name);
    return node !== undefined && node.shape === 'text' && node.text.trim() !== ''
      && !kinds.has(node.id) && !diagram.containers.has(node.id);
  };
  let at = id;
  for (let depth = 0; depth < 32; depth++) {
    const holder = held.get(at);
    const container = holder === undefined ? undefined : diagram.containers.get(holder);
    if (!container || container.kind === 'grid' || container.kind === 'tabs') break;
    const all = members(container);
    const index = all.indexOf(at);
    const before = isCaption(all[0]);
    const next = before ? all[index - 1] : all[index + 1];
    if (isCaption(next)) return next;
    at = holder!;
  }
  return undefined;
}

/** What an item is called on the screen. */
export function itemName(diagram: DiagramFile, id: string, items?: ReadonlyMap<string, string>): string {
  const byId = new Map(diagram.nodes.map(node => [node.id, node]));
  const label = labelOf(diagram, id, items);
  return (label === undefined ? byId.get(id)?.text : byId.get(label)?.text)?.trim() ?? '';
}

/**
 * The drawing with its item table applied: what is numbered and required,
 * the alignment the table gives, and what did not join.
 */
export function withItems(diagram: DiagramFile, read: Reader): DiagramFile {
  const written = diagram.itemTable;
  if (written === undefined || diagram.mode !== 'free') return diagram;
  const path = written.path;
  const notes: Phrase[] = [];
  const done = (links: Map<string, ItemLink>, style = diagram.style): DiagramFile => ({
    ...diagram, style, itemLinks: { path, links, notes, mark: requiredMark(diagram) },
  });

  const source = read(path);
  const table = source === undefined ? undefined : readItemTable(source);
  if (table === undefined) {
    notes.push(dgm('diagram.items.unreadable', { path }));
    return done(new Map());
  }
  const columns = itemColumns(table.headers);
  if (columns.id === undefined) {
    notes.push(dgm('diagram.items.noIdColumn', { path }));
    return done(new Map());
  }

  const byId = new Map(diagram.nodes.map(node => [node.id, node]));
  const rows = new Map<string, { row: number; required: boolean; align: string | undefined; numbered: boolean }>();
  table.rows.forEach((row, index) => {
    const id = row.cells[columns.id!]!.trim();
    if (NOTHING.has(id)) return;
    if (!byId.has(id)) { notes.push(dgm('diagram.items.missingShape', { item: id, path })); return; }
    if (rows.has(id)) { notes.push(dgm('diagram.items.duplicate', { id, path })); return; }
    const required = columns.required === undefined ? false : requiredOf(row.cells[columns.required]!);
    if (required === undefined) {
      notes.push(dgm('diagram.items.badRequired', { id, value: row.cells[columns.required!]! }));
    }
    const align = columns.align === undefined ? undefined : alignOf(row.cells[columns.align]!);
    if (align === null) notes.push(dgm('diagram.items.badAlign', { id, value: row.cells[columns.align!]! }));
    const numbered = columns.number === undefined || row.cells[columns.number]!.trim() === AUTO_NUMBER;
    rows.set(id, { row: index, required: required ?? false, align: align ?? undefined, numbered });
  });

  const order = readingOrder(diagram);
  const kinds = itemShapes(diagram);
  const links = new Map<string, ItemLink>();
  let count = 0;
  for (const id of order) {
    const row = rows.get(id);
    if (row === undefined) {
      if (kinds.has(id)) notes.push(dgm('diagram.items.unlisted', { id, path }));
      continue;
    }
    links.set(id, {
      id, row: row.row, required: row.required,
      number: row.numbered ? ++count : undefined,
      label: labelOf(diagram, id, kinds),
    });
  }

  // The table's rows in the screen's order, or the numbers on the two would
  // be different numbers for the same item.
  const screen = order.filter(id => rows.has(id));
  const listed = [...rows.keys()].sort((a, b) => rows.get(a)!.row - rows.get(b)!.row);
  if (screen.some((id, index) => listed[index] !== id)) notes.push(dgm('diagram.items.order', { path }));

  const style = new Map(diagram.style);
  for (const [id, row] of rows) {
    if (row.align === undefined) continue;
    style.set(id, new Map([...(style.get(id) ?? new Map<string, string>()), ['align', row.align]]));
  }
  return done(links, style);
}

/** Yes, no, or a word that is neither. */
function requiredOf(cell: string): boolean | undefined {
  const value = cell.trim().toLowerCase();
  if (YES.has(value)) return true;
  if (NOTHING.has(value) || NO.has(value)) return false;
  return undefined;
}

/** An alignment, none (an empty cell), or null for a word that is neither. */
function alignOf(cell: string): 'left' | 'center' | 'right' | undefined | null {
  const value = cell.trim().toLowerCase();
  if (NOTHING.has(value)) return undefined;
  return ALIGN[value] ?? null;
}

/**
 * How "required" is drawn: the part named `required`, whatever this product
 * makes of it — a red asterisk unless the library says otherwise.
 */
function requiredMark(diagram: DiagramFile): ItemLinks['mark'] {
  const part = diagram.library.get('required');
  return {
    text: part?.text ?? '*',
    style: part?.style ?? new Map([['color', '#b3261e']]),
    ...(part?.width === undefined ? {} : { width: part.width }),
    ...(part?.height === undefined ? {} : { height: part.height }),
  };
}

/**
 * The table, made to list the screen's items in the screen's order.
 *
 * A row the screen has no item for is kept where it is, under the row it
 * followed — it may be an item that is not drawn (a message), and a row nobody
 * asked to remove is not this edit's to remove. An item the table lacks gets a
 * row with its id, a number, its kind and its name; everything else in the row
 * is the author's to write. Undefined when the table already agrees.
 */
export function syncItemTable(diagram: DiagramFile, source: string): Edit | undefined {
  const written = diagram.itemTable;
  if (written === undefined) throw new DiagramEditError(dgm('diagram.items.noTable'));
  const table = readItemTable(source);
  if (table === undefined) throw new DiagramEditError(dgm('diagram.items.unreadable', { path: written.path }));
  const columns = itemColumns(table.headers);
  if (columns.id === undefined) throw new DiagramEditError(dgm('diagram.items.noIdColumn', { path: written.path }));

  const byId = new Set(diagram.nodes.map(node => node.id));
  const kinds = itemShapes(diagram);
  const idOf = (row: ItemTableRow): string | undefined => {
    const id = row.cells[columns.id!]!.trim();
    return byId.has(id) ? id : undefined;
  };

  // Each row on the screen leads the rows after it that are not: those go
  // where it goes. The rows before the first such row stay at the top.
  const lead: ItemTableRow[] = [];
  const groups = new Map<string, ItemTableRow[]>();
  let current: ItemTableRow[] = lead;
  for (const row of table.rows) {
    const id = idOf(row);
    if (id !== undefined && !groups.has(id)) { current = [row]; groups.set(id, current); } else current.push(row);
  }

  const wanted = readingOrder(diagram).filter(id => groups.has(id) || kinds.has(id));
  const widths = splitFields(table.delimiter.text).map(field => Math.max(3, displayWidth(field) - 2));
  const out: { row: ItemTableRow | undefined; fresh: string[] | undefined }[] = lead.map(row => ({ row, fresh: undefined }));
  for (const id of wanted) {
    const group = groups.get(id);
    if (group) { for (const row of group) out.push({ row, fresh: undefined }); continue; }
    out.push({ row: undefined, fresh: freshRow(diagram, table.headers, columns, id, kinds) });
  }

  // A `^` means "the same as above", which is true only while the row above
  // is the same row — or one that says the same thing.
  const lines: string[] = [];
  const shown: (readonly string[])[] = [];
  const merges = new Set(table.rows.flatMap(row => row.written
    .map((cell, c) => (cell === MERGE_UP ? c : -1)).filter(c => c >= 0)));
  out.forEach((one, index) => {
    const before = index === 0 ? undefined : out[index - 1]!;
    const above = shown[index - 1];
    if (one.fresh) {
      const cells = one.fresh.map((cell, c) =>
        merges.has(c) && above !== undefined && cell !== '' && above[c] === cell ? MERGE_UP : cell);
      lines.push(formatRow(cells, widths));
      shown.push(one.fresh);
      return;
    }
    const row = one.row!;
    const was = table.rows.indexOf(row);
    let text = row.text;
    if (before?.row !== table.rows[was - 1] || before?.fresh) {
      row.written.forEach((cell, c) => {
        if (cell === MERGE_UP && above?.[c] !== row.cells[c]) text = replaceField(text, c, row.cells[c]!);
      });
    }
    lines.push(text);
    shown.push(row.cells);
  });

  const now = table.rows.map(row => row.text);
  if (lines.length === now.length && lines.every((line, index) => line === now[index])) return undefined;
  const text = table.rows.length === 0 ? lines.map(line => `\n${line}`).join('') : lines.join('\n');
  return { span: table.body, text, ...described(dgm('diagram.items.synced')), path: written.path };
}

/** What a new row says: the id, a number, its kind and its name. The rest is the author's. */
function freshRow(
  diagram: DiagramFile, headers: readonly string[], columns: Partial<Record<ItemColumn, number>>,
  id: string, kinds: ReadonlyMap<string, string>,
): string[] {
  const cells = headers.map(() => '');
  if (columns.id !== undefined) cells[columns.id] = id;
  if (columns.number !== undefined) cells[columns.number] = AUTO_NUMBER;
  if (columns.name !== undefined) cells[columns.name] = itemName(diagram, id, kinds);
  if (columns.category !== undefined) cells[columns.category] = kinds.get(id) ?? '';
  return cells;
}

/** The columns a new item table has, in the language it is written in. */
const NEW_TABLE: Readonly<Record<Locale, readonly { readonly header: string; readonly align?: 'right' | 'center' }[]>> = {
  ja: [
    { header: '分類' }, { header: 'No', align: 'right' }, { header: 'ID' }, { header: '項目名' }, { header: '型' },
    { header: '必須', align: 'center' }, { header: '寄せ', align: 'center' }, { header: '初期値', align: 'center' },
    { header: '説明' },
  ],
  en: [
    { header: 'Category' }, { header: 'No', align: 'right' }, { header: 'ID' }, { header: 'Name' }, { header: 'Type' },
    { header: 'Required', align: 'center' }, { header: 'Align', align: 'center' }, { header: 'Default', align: 'center' },
    { header: 'Description' },
  ],
};

/** Where a screen's item table goes when nobody says: beside it, named after it. */
export function itemTableName(screen: string): string {
  const name = screen.split('/').pop()!.replace(/\.dgm$/i, '');
  return `${name}-items.table`;
}

/**
 * A new item table for a screen: the columns an item list has, and a row for
 * each item the screen holds, in the screen's order — the same rows "match
 * the item table to the screen" would add, so a table made here is already
 * in step.
 */
export function newItemTable(diagram: DiagramFile, locale: Locale = DEFAULT_LOCALE): string {
  const t = DIAGRAM_MESSAGES.in(locale);
  const shape = NEW_TABLE[locale];
  const headers = shape.map(one => one.header);
  const columns = itemColumns(headers);
  const kinds = itemShapes(diagram);
  const rows = readingOrder(diagram).filter(id => kinds.has(id))
    .map(id => freshRow(diagram, headers, columns, id, kinds));
  // The same kind as the row above is written `^`, the way the sample is.
  const shown = rows.map((cells, index) => cells.map((cell, c) =>
    c === columns.category && index > 0 && cell !== '' && rows[index - 1]![c] === cell ? MERGE_UP : cell));
  const widths = headers.map((header, c) =>
    Math.max(3, displayWidth(header), ...shown.map(cells => displayWidth(escapeCell(cells[c]!)))));
  const delimiter = `|${shape.map((one, c) => {
    const dashes = '-'.repeat(widths[c]!);
    return ` ${one.align === 'right' ? `${dashes.slice(1)}:` : one.align === 'center' ? `:${dashes.slice(2)}:` : dashes} `;
  }).join('|')}|`;
  return [
    `# ${t('diagram.items.tableComment1')}`,
    `# ${t('diagram.items.tableComment2')}`,
    '',
    formatRow(headers, widths),
    delimiter,
    ...shown.map(cells => formatRow(cells, widths)),
    '',
  ].join('\n');
}

/**
 * The `items` line, written into a screen that has none: under its `use`
 * lines, or above its first section. One line, so one byte range.
 */
export function linkItemTable(diagram: DiagramFile, source: string, path: string): Edit {
  if (diagram.mode !== 'free') throw new DiagramEditError(dgm('diagram.items.notScreen'));
  if (diagram.itemTable !== undefined) {
    throw new DiagramEditError(dgm('diagram.items.already', { path: diagram.itemTable.path }));
  }
  // Measured on the text read as LF, as every range of the drawing is.
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let at = 0;
  let after: number | undefined;
  let before: number | undefined;
  for (const line of lines) {
    const text = line.trim();
    if (/^use\s+"[^"]+"$/.test(text)) after = at + byteLength(line);
    else if (before === undefined && text !== '' && !text.startsWith('#')) before = at;
    at += byteLength(line) + 1;
  }
  const line = `items "${path}"`;
  const where = after ?? before ?? 0;
  return {
    span: { start: where, end: where },
    text: after !== undefined ? `\n${line}` : `${line}\n\n`,
    ...described(dgm('diagram.items.linked', { path })),
  };
}

/**
 * A new screen: the shipped parts, its item table named, and a frame holding
 * a title, one field and a button — enough to show how a screen is built, and
 * to give its table a first few rows.
 */
export function starterScreen(table: string, locale: Locale = DEFAULT_LOCALE): string {
  const t = DIAGRAM_MESSAGES.in(locale);
  return [
    'use "default"',
    `items "${table}"`,
    '',
    'free {',
    '  frame  frame:',
    `  title  title:"${t('diagram.starter.screenTitle')}"`,
    '  field  ""',
    `  label  label:"${t('diagram.starter.screenLabel')}"`,
    '  input  textbox:',
    `  submit primary:"${t('diagram.starter.screenButton')}"`,
    '}',
    '',
    'layout {',
    '  frame @ (20, 20) 380x220',
    '',
    '  stack frame (down; gap: 18; pad: 30) { title ; field ; submit }',
    '  stack field (down; gap: 2; pad: 0) { label ; input }',
    '}',
    '',
  ].join('\n');
}

/** A new row, each cell padded to its column's width. */
function formatRow(cells: readonly string[], widths: readonly number[]): string {
  return `|${cells.map((cell, c) => {
    const text = escapeCell(cell);
    return ` ${text}${' '.repeat(Math.max(0, (widths[c] ?? 3) - displayWidth(text)))} `;
  }).join('|')}|`;
}

/**
 * One item's required or alignment cell, written. `value` is true or false
 * for required; for alignment a side, or undefined to leave it to the part.
 */
export function setItemCell(
  diagram: DiagramFile, source: string, id: string,
  column: 'required' | 'align', value: boolean | 'left' | 'center' | 'right' | undefined,
): Edit {
  const written = diagram.itemTable;
  if (written === undefined) throw new DiagramEditError(dgm('diagram.items.noTable'));
  const table = readItemTable(source);
  if (table === undefined) throw new DiagramEditError(dgm('diagram.items.unreadable', { path: written.path }));
  const columns = itemColumns(table.headers);
  const at = columns[column];
  if (columns.id === undefined) throw new DiagramEditError(dgm('diagram.items.noIdColumn', { path: written.path }));
  if (at === undefined) {
    throw new DiagramEditError(dgm('diagram.items.noColumn', { column: HEADERS[column][0], path: written.path }));
  }
  const row = table.rows.find(one => one.cells[columns.id!]!.trim() === id);
  if (!row) throw new DiagramEditError(dgm('diagram.items.notListed', { id, path: written.path }));

  // Written the way the table already writes it: a table of ○ and — gets ○
  // and —, not "yes".
  const japanese = /[^\x00-\x7f]/.test(table.headers[at]!);
  const used = (test: (cell: string) => boolean): string | undefined =>
    table.rows.map(one => one.cells[at]!.trim()).find(cell => cell !== '' && test(cell));
  let text: string;
  if (column === 'required') {
    text = value === true
      ? used(cell => requiredOf(cell) === true) ?? (japanese ? '○' : 'yes')
      : used(cell => NOTHING.has(cell)) ?? '';
  } else {
    const side = value === undefined || typeof value === 'boolean' ? undefined : value;
    text = side === undefined ? used(cell => NOTHING.has(cell)) ?? ''
      : japanese ? { left: '左', center: '中央', right: '右' }[side] : side;
  }
  const phrase = column === 'required'
    ? dgm(value === true ? 'diagram.items.setRequired' : 'diagram.items.clearRequired', { id })
    : dgm('diagram.items.setAlign', { id });
  return { span: row.span, text: replaceField(row.text, at, text), ...described(phrase), path: written.path };
}
