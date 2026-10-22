// Writing the grid back.
//
// Editing one cell rewrites one line and leaves the rest of the file alone.
// The field keeps the width it had where it can, so a shorter or equal value
// does not knock the source grid out of alignment; a longer one has to push,
// and straightening that out is the explicit "format" command's job. Automatic
// reformatting on every keystroke would turn a one-cell change into a diff
// across the whole table.

import { displayWidth, escapeCell, joinFields, splitFields } from '@docpresenter/base';
import type { Align, Selector, TableFile } from './model.js';

export { displayWidth, escapeCell, joinFields, replaceField, splitFields } from '@docpresenter/base';

export function insertField(line: string, index: number, text: string): string {
  const fields = splitFields(line);
  fields.splice(Math.min(index, fields.length), 0, ` ${escapeCell(text)} `);
  return joinFields(fields);
}

export function removeField(line: string, index: number): string {
  const fields = splitFields(line);
  fields.splice(index, 1);
  return joinFields(fields);
}

/** The `---` field for one column, at a given width. */
export function delimiterField(align: Align, width: number): string {
  const inner = Math.max(3, width);
  switch (align) {
    case 'left': return ` :${'-'.repeat(inner - 1)} `;
    case 'right': return ` ${'-'.repeat(inner - 1)}: `;
    case 'center': return ` :${'-'.repeat(inner - 2)}: `;
    case 'default': return ` ${'-'.repeat(inner)} `;
  }
}

/**
 * The grid, with every column padded to its widest value — the explicit
 * command, never run on its own. Only the grid lines are produced: the
 * comments, blocks and style sections around them are not this command's
 * business and are left exactly as the author wrote them.
 */
export function formatGrid(table: TableFile): string {
  const lines = [table.header.text, table.delimiter.text, ...table.rows.map(r => r.line.text)];
  const fields = lines.map(line => splitFields(line).map(f => f.trim()));
  const count = Math.max(...fields.map(f => f.length));

  const widths: number[] = [];
  for (let c = 0; c < count; c++) {
    // The delimiter row is generated, so its current width does not count.
    const cells = fields.filter((_, i) => i !== 1).map(row => row[c] ?? '');
    widths.push(Math.max(3, ...cells.map(displayWidth)));
  }

  return fields.map((row, i) => {
    if (i === 1) {
      return joinFields(widths.map((width, c) => delimiterField(table.columns[c]?.align ?? 'default', width)));
    }
    return joinFields(widths.map((width, c) => {
      const text = row[c] ?? '';
      return ` ${text}${' '.repeat(width - displayWidth(text))} `;
    }));
  }).join('\n');
}

/** Writes a selector back in the form the parser reads. */
export function formatSelector(selector: Selector): string {
  switch (selector.kind) {
    case 'header': return 'header';
    case 'column': return `col:${selector.name}`;
    case 'row': return `row:${selector.which}`;
    case 'cell': return `cell:${selector.row}/${selector.column}`;
    case 'range': return `range:${selector.from}..${selector.to}`;
    case 'namedRange': return `range:${selector.name}`;
  }
}

export function sameSelector(a: Selector, b: Selector): boolean {
  return formatSelector(a) === formatSelector(b);
}

/** One rule line, without its indent. */
export function formatRule(
  selector: Selector, declarations: ReadonlyMap<string, string>,
): string {
  const body = [...declarations].map(([property, value]) => `${property}: ${value}`).join(', ');
  return `${formatSelector(selector)} { ${body} }`;
}
