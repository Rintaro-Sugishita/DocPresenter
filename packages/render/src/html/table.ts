// Renders a .table as an HTML table. Style tokens become class names so the
// theme decides what `thick` or `changed` look like; the renderer never emits
// a literal colour or width.

import type { Align, Cell, StyleRule, TableFile } from '@docpresenter/core';

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

export function renderTable(table: TableFile): string {
  const head = table.columns
    .map(c => `<th${classAttr([ALIGN_CLASS[c.align], ...headerClasses(table)])}>${escapeHtml(c.header)}</th>`)
    .join('');

  const body = table.rows.map((row, r) => {
    const cells = row.cells.map(cell => renderCell(table, cell, r)).join('');
    return `<tr${classAttr(rowClasses(table, r))}>${cells}</tr>`;
  }).join('\n');

  return [
    `<table class="dp-table"${table.theme ? ` data-theme="${escapeAttr(table.theme)}"` : ''}>`,
    `<thead><tr>${head}</tr></thead>`,
    `<tbody>\n${body}\n</tbody>`,
    '</table>',
  ].join('\n');
}

function renderCell(table: TableFile, cell: Cell, row: number): string {
  const column = table.columns[cell.column];
  const attributes = [
    cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '',
    cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '',
    classAttr([
      column ? ALIGN_CLASS[column.align] : '',
      ...cellClasses(table, cell, row),
    ]),
  ].join('');
  return `<td${attributes}>${renderCellText(table, cell.text)}</td>`;
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

/** Emphasis, inline code and hard breaks — the range a grid cell can hold. */
function inlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

/**
 * The style classes for one position. Exported because the grid editor shows
 * the same fills and rules while you are editing; one implementation keeps the
 * grid and the printed table from disagreeing.
 */
export function headerClasses(table: TableFile): string[] {
  return declarationClasses(table.style.filter(r => r.selector.kind === 'header'));
}

export function rowClasses(table: TableFile, row: number): string[] {
  const odd = (row + 1) % 2 === 1;
  return declarationClasses(table.style.filter(rule => {
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
  }));
}

function withinRange(table: TableFile, row: number, from: string, to: string): boolean {
  const keyOf = (r: number): string => table.rows[r]?.cells[0]?.text ?? '';
  const first = table.rows.findIndex((_, r) => keyOf(r) === from);
  const last = table.rows.findIndex((_, r) => keyOf(r) === to);
  return first >= 0 && last >= first && first <= row && row <= last;
}

export function cellClasses(table: TableFile, cell: Cell, row: number): string[] {
  const columnName = table.columns[cell.column]?.header;
  const rowName = table.rows[row]?.cells[0]?.text;
  return declarationClasses(table.style.filter(rule => {
    const s = rule.selector;
    if (s.kind === 'column') return s.name === columnName;
    if (s.kind === 'cell') return s.column === columnName && s.row === rowName;
    return false;
  }));
}

/** `fill: changed` becomes `dp-fill-changed`; the theme resolves the token. */
function declarationClasses(rules: readonly StyleRule[]): string[] {
  const classes: string[] = [];
  for (const rule of rules) {
    for (const [property, value] of rule.declarations) {
      if (property === 'width') continue;   // a measurement, not a token
      classes.push(`dp-${property}-${value}`);
    }
  }
  return classes;
}

function classAttr(classes: readonly string[]): string {
  const list = classes.filter(c => c !== '');
  return list.length ? ` class="${escapeAttr(list.join(' '))}"` : '';
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

export function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}
