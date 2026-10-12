// Renders a .table as an HTML table. Style tokens become class names so the
// theme decides what `thick` or `changed` look like; the renderer never emits
// a literal colour or width.

import { markClass, type TableMarks } from './diff.js';
import type { Align, Cell, StyleRule, TableFile } from '../table/model.js';
import { markdown } from './markdown.js';

const ALIGN_CLASS: Readonly<Record<Align, string>> = {
  left: 'dp-align-left', center: 'dp-align-center', right: 'dp-align-right', default: '',
};

/**
 * Keeps only the rows in a named range. The range names the first and last
 * row by the text of its leading cell, so editing the table does not move it
 * the way a line number would.
 */
export function selectRows(table: TableFile, rangeName: string): TableFile | undefined {
  const range = table.ranges.get(rangeName);
  if (!range) return undefined;
  const keyOf = (r: number): string => table.rows[r]?.cells[0]?.text ?? '';
  const from = table.rows.findIndex((_, r) => keyOf(r) === range.from);
  const to = table.rows.findIndex((_, r) => keyOf(r) === range.to);
  if (from < 0 || to < 0 || to < from) return undefined;
  return { ...table, rows: table.rows.slice(from, to + 1) };
}

/** `#abc` or `#aabbcc`. Anything else is not a colour and is not emitted. */
const COLOUR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
/** A length the layout can use, for column widths. */
const LENGTH = /^\d+(\.\d+)?(%|em|px|ch)$/;

export function renderTable(table: TableFile, marks?: TableMarks): string {
  const head = table.columns
    .map((c, i) => {
      const rules = [...headerRules(table), ...columnRules(table, c.header)];
      // A header is a cell. It takes the same inline Markdown the others do —
      // dropping it there would show the notation to the reader.
      return `<th${styleAttrs(alignOf(table, i, rules), rules)}>`
        + `${inlineMarkdown(c.header)}</th>`;
    })
    .join('');

  const body = table.rows.map((row, r) => {
    const cells = row.cells.map(cell => renderCell(table, cell, r, marks)).join('');
    const changed = markClass(marks?.rows.get(keyOfRow(table, r)));
    return `<tr${styleAttrs('', rowRules(table, r), changed)}>${cells}</tr>`;
  }).join('\n');

  return [
    `<table class="dp-table"${table.theme ? ` data-theme="${escapeAttr(table.theme)}"` : ''}>`,
    columnGroup(table),
    `<thead><tr>${head}</tr></thead>`,
    `<tbody>\n${body}\n</tbody>`,
    '</table>',
  ].filter(part => part !== '').join('\n');
}

/**
 * The width each column's style gives it (`col:説明 { width: 38% }`), or
 * undefined where none is given. The page and the slide read the same rule.
 */
export function columnWidths(table: TableFile): (string | undefined)[] {
  return table.columns.map(column => {
    const rule = table.style.find(r =>
      r.selector.kind === 'column' && r.selector.name === column.header);
    const width = rule?.declarations.get('width');
    return width !== undefined && LENGTH.test(width) ? width : undefined;
  });
}

/**
 * Column widths are a measurement, not a token, so they are written as a real
 * width on a `<col>`. A theme cannot decide how wide the "備考" column should
 * be in one particular table.
 */
function columnGroup(table: TableFile): string {
  const widths = columnWidths(table);
  if (widths.every(width => width === undefined)) return '';
  return `<colgroup>${widths
    .map(width => width === undefined ? '<col>' : `<col style="width:${width}">`)
    .join('')}</colgroup>`;
}

function renderCell(table: TableFile, cell: Cell, row: number, marks?: TableMarks): string {
  const rules = cellRules(table, cell, row);
  // A cell is named the way a selector names it: by the text of its row's
  // leading cell and of its column's header.
  const changed = markClass(marks?.cells.get(
    `${keyOfRow(table, row)}/${table.columns[cell.column]?.header ?? ''}`));
  const attributes = [
    cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '',
    cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '',
    styleAttrs(alignOf(table, cell.column, rules), rules, changed),
  ].join('');
  return `<td${attributes}>${renderCellText(table, cell.text)}</td>`;
}

function columnRules(table: TableFile, header: string | undefined): readonly StyleRule[] {
  return table.style.filter(r => r.selector.kind === 'column' && r.selector.name === header);
}

/**
 * The delimiter row sets one alignment for the whole column, which is all
 * Markdown can say. A rule may override it for the header alone — the usual
 * scientific table centres its headings over right-aligned figures — so the
 * class is decided once here rather than left to two classes fighting.
 */
export function alignOf(table: TableFile, column: number, rules: readonly StyleRule[]): string {
  for (const rule of rules) {
    const align = rule.declarations.get('align');
    if (align === 'left' || align === 'center' || align === 'right') return ALIGN_CLASS[align];
  }
  return ALIGN_CLASS[table.columns[column]?.align ?? 'default'];
}

/** Cells hold inline markdown; a block reference expands to its definition. */
function renderCellText(table: TableFile, text: string): string {
  const block = /^@(\S+)$/.exec(text);
  if (block) {
    const body = table.blocks.get(block[1]!);
    if (body !== undefined) return `<div class="dp-cell-block">${inlineMarkdown(body)}</div>`;
  }
  return inlineMarkdown(text);
}

/**
 * A cell holds inline Markdown — the same inline Markdown as the prose.
 * Exported because the grid editor shows what the cell will look like, not
 * the notation that produces it; the notation appears when the cell is open.
 */
export function inlineMarkdown(text: string): string {
  return markdown.renderInline(text);
}

/**
 * The style classes for one position. Exported because the grid editor shows
 * the same fills and rules while you are editing; one implementation keeps the
 * grid and the printed table from disagreeing.
 */
export function headerRules(table: TableFile): readonly StyleRule[] {
  return table.style.filter(r => r.selector.kind === 'header');
}

export function headerClasses(table: TableFile): string[] {
  return declarationClasses(headerRules(table));
}

export function rowClasses(table: TableFile, row: number): string[] {
  return declarationClasses(rowRules(table, row));
}

export function rowRules(table: TableFile, row: number): readonly StyleRule[] {
  const odd = (row + 1) % 2 === 1;
  return table.style.filter(rule => {
    const s = rule.selector;
    if (s.kind === 'row') return s.which === 'all' || (s.which === 'odd') === odd;
    // A range names its first and last row by the text of their leading cell,
    // the same way a named range does, so it survives the rows moving.
    if (s.kind === 'range') return withinRange(table, row, s.from, s.to);
    if (s.kind === 'namedRange') {
      const range = table.ranges.get(s.name);
      return range !== undefined && withinRange(table, row, range.from, range.to);
    }
    return false;
  });
}

function withinRange(table: TableFile, row: number, from: string, to: string): boolean {
  const keyOf = (r: number): string => table.rows[r]?.cells[0]?.text ?? '';
  const first = table.rows.findIndex((_, r) => keyOf(r) === from);
  const last = table.rows.findIndex((_, r) => keyOf(r) === to);
  return first >= 0 && last >= first && first <= row && row <= last;
}

export function cellClasses(table: TableFile, cell: Cell, row: number): string[] {
  return declarationClasses(cellRules(table, cell, row));
}

export function cellRules(table: TableFile, cell: Cell, row: number): readonly StyleRule[] {
  const columnName = table.columns[cell.column]?.header;
  const rowName = table.rows[row]?.cells[0]?.text;
  return table.style.filter(rule => {
    const s = rule.selector;
    if (s.kind === 'column') return s.name === columnName;
    if (s.kind === 'cell') return s.column === columnName && s.row === rowName;
    return false;
  });
}

/**
 * Class names for the theme's own tokens, and a real declaration for a colour
 * the author picked. A colour is checked against the hex forms before it is
 * emitted, so nothing else can reach the style attribute.
 */
function styleAttrs(align: string, rules: readonly StyleRule[], extra = ''): string {
  const inline = inlineStyle(rules);
  const style = inline === '' ? '' : ` style="${escapeAttr(inline)}"`;
  return `${classAttr([align, ...declarationClasses(rules), ...(extra ? [extra.trim()] : [])])}${style}`;
}

/** A row is named by the text of its leading cell, as everything else names it. */
function keyOfRow(table: TableFile, row: number): string {
  return table.rows[row]?.cells[0]?.text ?? '';
}

/**
 * The colours an author picked, as CSS. Exported because the grid editor shows
 * the same fills and text colours while you are editing.
 */
export function inlineStyle(rules: readonly StyleRule[]): string {
  const parts: string[] = [];
  for (const rule of rules) {
    for (const [property, value] of rule.declarations) {
      if (!COLOUR.test(value)) continue;
      if (property === 'fill') parts.push(`background:${value}`);
      if (property === 'color') parts.push(`color:${value}`);
    }
  }
  return parts.join(';');
}

/** `fill: changed` becomes `dp-fill-changed`; the theme resolves the token. */
function declarationClasses(rules: readonly StyleRule[]): string[] {
  const classes: string[] = [];
  for (const rule of rules) {
    for (const [property, value] of rule.declarations) {
      if (property === 'width') continue;   // a measurement, on the <col>
      if (property === 'align') continue;   // decided in one place, by alignOf
      if (COLOUR.test(value)) continue;     // a colour, written as a declaration
      classes.push(`dp-${property}-${value}`);
    }
  }
  return classes;
}

function classAttr(classes: readonly string[]): string {
  const list = classes.filter(c => c !== '');
  return list.length ? ` class="${escapeAttr(list.join(' '))}"` : '';
}

import { escapeAttr, escapeHtml } from '@docpresenter/base';

// Kept exported here: this file has been the place callers reach for them.
export { escapeAttr, escapeHtml };
