// The tables written straight into a document, lined up.
//
// A table in the prose is the same grid a `.table` file holds, so it is lined
// up the same way: every column as wide as its widest cell, the delimiter row
// keeping each column's alignment. Only the tables are touched; the rest of
// the document is given back as it was, character for character.

import { formatGrid } from './format.js';
import { parseTable } from './parse.js';

/** A line that could be a delimiter row: `| --- | :-: |`, with or without the outer bars. */
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Where the tables of a document are: the first and last line of each, from 0. */
export function markdownTables(source: string): { first: number; last: number }[] {
  const lines = source.split('\n').map(line => line.replace(/\r$/, ''));
  const found: { first: number; last: number }[] = [];
  let fence: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) fence = marker;
      else if (marker.startsWith(fence)) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const next = lines[i + 1];
    if (!line.includes('|') || next === undefined || !DELIMITER.test(next) || !next.includes('-')) continue;
    // A delimiter row of one column without bars is a setext heading's rule.
    if (!next.includes('|') && !line.trim().startsWith('|')) continue;
    let last = i + 1;
    while (last + 1 < lines.length && lines[last + 1]!.trim() !== '' && lines[last + 1]!.includes('|')) last++;
    found.push({ first: i, last });
    i = last;
  }
  return found;
}

/** The document with every table in it lined up. A table that cannot be read is left as written. */
export function formatMarkdownTables(source: string): string {
  const ending = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split('\n').map(line => line.replace(/\r$/, ''));
  for (const { first, last } of markdownTables(source).reverse()) {
    const block = lines.slice(first, last + 1);
    // A table indented under a list item keeps its indent.
    const indent = /^\s*/.exec(block[0]!)?.[0] ?? '';
    if (!block.every(line => line.startsWith(indent))) continue;
    let formatted: string;
    try {
      formatted = formatGrid(parseTable(block.map(line => line.slice(indent.length)).join('\n')));
    } catch {
      continue;
    }
    lines.splice(first, last - first + 1, ...formatted.split('\n').map(line => `${indent}${line}`));
  }
  return lines.join(ending);
}

/** One table taken out of a document into a file of its own. */
export interface SplitTable {
  /** The new file, by its path from the workspace root. */
  readonly path: string;
  /** What goes in it: the table, lined up. */
  readonly text: string;
}

/**
 * The document with tables written in it moved into `.table` files beside it,
 * each replaced by the `@import` line that shows it — the same name a table
 * made from the editor gets: `docs/a.md` keeps `docs/a/table-1.table`, then
 * `table-2.table`, never a name already `taken`. `only` picks tables by the
 * line they start on (from 0); without it every table goes.
 */
export function splitMarkdownTables(
  source: string, documentPath: string, taken: ReadonlySet<string>, only?: readonly number[],
): { text: string; tables: SplitTable[] } {
  const ending = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split('\n').map(line => line.replace(/\r$/, ''));
  const folder = documentPath.replace(/\.md$/i, '');
  const base = documentPath.includes('/') ? documentPath.slice(0, documentPath.lastIndexOf('/') + 1) : '';
  const used = new Set(taken);
  const picked = markdownTables(source).filter(one => only === undefined || only.includes(one.first));
  // Named first to last, so the numbers read down the document.
  const named = picked.flatMap(one => {
    const block = lines.slice(one.first, one.last + 1);
    const indent = /^\s*/.exec(block[0]!)?.[0] ?? '';
    if (indent !== '' || !block.every(line => line.startsWith(indent))) return [];
    let text: string;
    try { text = formatGrid(parseTable(block.join('\n'))); } catch { return []; }
    let n = 1;
    while (used.has(`${folder}/table-${n}.table`)) n++;
    const path = `${folder}/table-${n}.table`;
    used.add(path);
    return [{ ...one, path, text: text.endsWith('\n') ? text : `${text}\n` }];
  });
  for (const one of [...named].reverse()) {
    const written = one.path.startsWith(base) ? one.path.slice(base.length) : one.path;
    lines.splice(one.first, one.last - one.first + 1, `@import "${written}"`);
  }
  return { text: lines.join(ending), tables: named.map(({ path, text }) => ({ path, text })) };
}

/**
 * Cells copied from Excel — tab-separated, a cell with a line break or a tab
 * in it quoted — as a Markdown table, the first row its heading. Undefined
 * when the text is not a grid of at least two cells: plain text pasted is
 * plain text.
 */
export function tableFromTsv(text: string): string | undefined {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (quoted) {
      if (char === '"' && body[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === '\t') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  row.push(cell);
  rows.push(row);
  const width = Math.max(...rows.map(one => one.length));
  if (width < 2 && rows.length < 2) return undefined;
  if (!body.includes('\t')) return undefined;
  const escape = (value: string): string => value.trim().replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  const line = (cells: readonly string[]): string =>
    `| ${Array.from({ length: width }, (_, n) => escape(cells[n] ?? '')).join(' | ')} |`;
  const grid = [line(rows[0]!), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)];
  try { return formatGrid(parseTable(grid.join('\n'))).replace(/\n+$/, ''); } catch { return grid.join('\n'); }
}
