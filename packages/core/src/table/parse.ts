// Parses a `.table` file. The grid reads as a GFM table apart from the merge
// markers, so the only departures from standard markdown are `^` and `<` and
// the block references.

import { byteLength } from '../bytes.js';
import type {
  Align, Cell, Column, GridLine, NamedRange, Row, Selector, StyleRule, TableFile,
} from './model.js';

/** Merge with the cell above. */
const MERGE_UP = '^';
/** Merge with the cell to the left. */
const MERGE_LEFT = '<';

export class TableParseError extends Error {
  constructor(message: string, readonly line: number) {
    super(`${message}（${line} 行目）`);
    this.name = 'TableParseError';
  }
}

export function parseTable(source: string): TableFile {
  const lines = source.split(/\r?\n/);

  // Byte offset of the start of each line, built once so every grid line can
  // carry the range it occupies.
  const lineStart: number[] = [];
  let at = 0;
  for (const line of lines) {
    lineStart.push(at);
    at += byteLength(line) + 1;
  }
  /** The range of a line, trimmed of its leading and trailing spaces. */
  const spanOfLine = (index: number): GridLine => {
    const raw = lines[index] ?? '';
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    const start = lineStart[index]! + byteLength(raw.slice(0, lead));
    return { text, span: { start, end: start + byteLength(text) } };
  };
  const comments: string[] = [];
  const blocks = new Map<string, string>();
  const ranges = new Map<string, NamedRange>();
  const style: StyleRule[] = [];
  let theme: string | undefined;

  const gridLines: { text: string; line: number; grid: GridLine }[] = [];
  let i = 0;

  // Leading comments and blank lines.
  for (; i < lines.length; i++) {
    const text = (lines[i] ?? '').trim();
    if (text.startsWith('#')) comments.push(text.replace(/^#\s?/, ''));
    else if (text !== '') break;
  }

  // The grid: consecutive lines beginning with a pipe.
  for (; i < lines.length; i++) {
    const text = (lines[i] ?? '').trim();
    if (!text.startsWith('|')) break;
    gridLines.push({ text, line: i + 1, grid: spanOfLine(i) });
  }
  if (gridLines.length < 2) throw new TableParseError('表のグリッドが見つからない', i + 1);

  // Remaining sections.
  for (; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const text = raw.trim();
    if (text === '' || text.startsWith('#')) continue;

    const block = /^\[@([^\]]+)\]:\s*(.*)$/.exec(text);
    if (block) {
      const [, key, rest] = block;
      const body: string[] = rest && rest.trim() !== '' ? [rest] : [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1] ?? '';
        if (next.trim() === '' || /^\[@[^\]]+\]:/.test(next.trim()) || /^(style|range)\s*\{/.test(next.trim())) break;
        body.push(next.trim());
        i++;
      }
      blocks.set(key!, body.join('\n'));
      continue;
    }

    const section = /^(style|range)\s*\{$/.exec(text);
    if (section) {
      const kind = section[1];
      const body: string[] = [];
      let depth = 1;
      while (++i < lines.length) {
        const inner = (lines[i] ?? '').trim();
        depth += count(inner, '{') - count(inner, '}');
        if (depth === 0) break;
        body.push(inner);
      }
      if (kind === 'style') theme = parseStyle(body, style) ?? theme;
      else parseRanges(body, ranges);
      continue;
    }

    throw new TableParseError(`解釈できない行: ${text}`, i + 1);
  }

  const { columns, rows } = parseGrid(gridLines);
  return {
    comments, columns, rows, blocks, theme, style, ranges,
    header: gridLines[0]!.grid,
    delimiter: gridLines[1]!.grid,
  };
}

function count(text: string, char: string): number {
  let n = 0;
  for (const c of text) if (c === char) n++;
  return n;
}

/** Splits a grid line into cells, honouring `\|` as a literal pipe. */
function splitRow(text: string): string[] {
  const cells: string[] = [];
  let current = '';
  for (let i = 1; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\' && text[i + 1] === '|') { current += '|'; i++; continue; }
    if (c === '|') { cells.push(current.trim()); current = ''; continue; }
    current += c;
  }
  if (current.trim() !== '') cells.push(current.trim());
  return cells;
}

function alignOf(spec: string): Align {
  const left = spec.startsWith(':');
  const right = spec.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return 'default';
}

function parseGrid(
  gridLines: { text: string; line: number; grid: GridLine }[],
): { columns: Column[]; rows: Row[] } {
  const headerCells = splitRow(gridLines[0]!.text);
  const delimiter = splitRow(gridLines[1]!.text);
  if (!delimiter.every(d => /^:?-+:?$/.test(d))) {
    throw new TableParseError('区切り行が正しくない', gridLines[1]!.line);
  }
  const columns: Column[] = headerCells.map((header, c) => ({
    header,
    align: alignOf(delimiter[c] ?? '-'),
  }));

  const rows: Row[] = [];
  /** The cell currently spanning into each column from above. */
  const spanningFromAbove: (Cell | undefined)[] = [];

  gridLines.slice(2).forEach((grid, r) => {
    const raw = splitRow(grid.text);
    const cells: Cell[] = [];
    let lastStarted: Cell | undefined;
    // A cell spanning several columns is marked '^' once per column on the row
    // below, but its rowspan must grow only once for that row.
    const extendedThisRow = new Set<Cell>();

    for (let c = 0; c < columns.length; c++) {
      const text = raw[c] ?? '';

      if (text === MERGE_UP) {
        const owner = spanningFromAbove[c];
        if (!owner) throw new TableParseError(`'${MERGE_UP}' の上に結合できるセルがない（${c + 1} 列目）`, grid.line);
        if (!extendedThisRow.has(owner)) {
          owner.rowspan++;
          extendedThisRow.add(owner);
        }
        continue;
      }
      if (text === MERGE_LEFT) {
        if (!lastStarted) throw new TableParseError(`'${MERGE_LEFT}' の左に結合できるセルがない（${c + 1} 列目）`, grid.line);
        lastStarted.colspan++;
        // Keep the owner here so that a '^' below this column finds it.
        spanningFromAbove[c] = lastStarted;
        continue;
      }

      const cell: Cell = { text, row: r, column: c, rowspan: 1, colspan: 1 };
      cells.push(cell);
      lastStarted = cell;
      spanningFromAbove[c] = cell;
    }
    rows.push({ cells, line: grid.grid });
  });

  // A cell stops spanning once its rowspan is exhausted.
  rows.forEach((row, r) => {
    for (const cell of row.cells) {
      for (let c = cell.column; c < cell.column + cell.colspan; c++) {
        if (cell.row + cell.rowspan - 1 <= r && spanningFromAbove[c] === cell) spanningFromAbove[c] = undefined;
      }
    }
  });

  return { columns, rows };
}

/** Returns the theme name when the block declares one. */
function parseStyle(body: string[], out: StyleRule[]): string | undefined {
  let theme: string | undefined;
  for (const line of body) {
    const themeDecl = /^theme\s*:\s*(\S+)\s*$/.exec(line);
    if (themeDecl) { theme = themeDecl[1]!; continue; }

    const rule = /^(\S+)\s*\{([^}]*)\}\s*$/.exec(line);
    if (!rule) continue;
    const declarations = new Map<string, string>();
    for (const part of rule[2]!.split(',')) {
      const kv = /^\s*([\w-]+)\s*:\s*(.+?)\s*$/.exec(part);
      if (kv) declarations.set(kv[1]!, kv[2]!);
    }
    out.push({ selector: parseSelector(rule[1]!), declarations });
  }
  return theme;
}

function parseSelector(text: string): Selector {
  if (text === 'header') return { kind: 'header' };
  const [prefix, rest] = splitOnce(text, ':');
  switch (prefix) {
    case 'col':  return { kind: 'column', name: rest };
    case 'row':  return { kind: 'row', which: rest === 'odd' || rest === 'even' ? rest : 'all' };
    case 'cell': {
      const [row, column] = splitOnce(rest, '/');
      return { kind: 'cell', row, column };
    }
    case 'range': {
      if (rest.includes('..')) {
        const [from, to] = splitOnce(rest, '..');
        return { kind: 'range', from, to };
      }
      return { kind: 'namedRange', name: rest };
    }
    default: return { kind: 'column', name: text };
  }
}

function splitOnce(text: string, separator: string): [string, string] {
  const at = text.indexOf(separator);
  if (at < 0) return [text, ''];
  return [text.slice(0, at), text.slice(at + separator.length)];
}

function parseRanges(body: string[], out: Map<string, NamedRange>): void {
  for (const line of body) {
    const m = /^([^:]+):\s*(.+?)\.\.(.+?)\s*$/.exec(line);
    if (m) out.set(m[1]!.trim(), { from: m[2]!.trim(), to: m[3]!.trim() });
  }
}
