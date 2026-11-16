// A `.table` file as the grid its cells show.

import { displayWidth } from '@docpresenter/base';
import {
  cellAt, cellRules, rowRules, shownText, type StyleRule, type TableFile,
} from '@docpresenter/markdown';
import type { Grid, GridCell, Merge } from './model.js';

/** A table about this wide fills a page, in Excel's character widths. */
export const PAGE_CHARACTERS = 110;
const COLOUR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

export function gridOfTable(table: TableFile): Grid {
  const merges: Merge[] = [];
  const rows = table.rows.map((row, r) => table.columns.map((column, c): GridCell => {
    const owner = cellAt(table, r, c);
    if (!owner || owner.row !== r || owner.column !== c) return { text: '' };
    if (owner.rowspan > 1 || owner.colspan > 1) {
      merges.push({ row: r, column: c, rows: owner.rowspan, columns: owner.colspan });
    }
    const rules = cellRules(table, owner, r);
    const align = last(rules, 'align') ?? (column.align === 'default' ? undefined : column.align);
    const fill = hexOf(last(rules, 'fill')) ?? hexOf(last(rowRules(table, r), 'fill'));
    return {
      text: shownText(owner),
      ...(align === 'center' || align === 'right' ? { align } : {}),
      ...(fill ? { fill } : {}),
    };
  }));
  const widths = table.columns.map((column, c) => {
    const rule = table.style.find(one => one.selector.kind === 'column' && one.selector.name === column.header);
    return charactersOf(rule?.declarations.get('width'))
      ?? fitted([column.header, ...rows.map(row => row[c]?.text ?? '')]);
  });
  return { header: table.columns.map(column => column.header), rows, merges, widths };
}

function last(rules: readonly StyleRule[], property: string): string | undefined {
  let found: string | undefined;
  for (const rule of rules) found = rule.declarations.get(property) ?? found;
  return found;
}

function hexOf(value: string | undefined): string | undefined {
  if (value === undefined || !COLOUR.test(value)) return undefined;
  const hex = value.slice(1).toLowerCase();
  return `#${hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex}`;
}


/** A width the table gives a column, in characters. */
export function charactersOf(width: string | undefined): number | undefined {
  const found = /^(\d+(?:\.\d+)?)(%|em|px|ch)$/.exec(width ?? '');
  if (!found) return undefined;
  const value = Number(found[1]);
  switch (found[2]) {
    case '%': return round(value * PAGE_CHARACTERS / 100);
    case 'em': return round(value * 2);
    case 'px': return round(value / 7);
    default: return round(value);
  }
}

/** A width in characters, written in the unit the column already uses. */
export function widthIn(characters: number, unit: string | undefined): string {
  switch (unit) {
    case '%': return `${Math.max(1, Math.round(characters * 100 / PAGE_CHARACTERS))}%`;
    case 'em': return `${round(characters / 2)}em`;
    case 'px': return `${Math.round(characters * 7)}px`;
    default: return `${round(characters)}ch`;
  }
}

/** A column wide enough for what it holds, within reason. */
function fitted(texts: readonly string[]): number {
  return Math.min(50, Math.max(6, ...texts.map(text => displayWidth(text) + 2)));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
