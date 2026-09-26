// Grid operations on a `.table` file.
//
// Every one is a byte-range edit in that file, and the range is as small as
// the change: editing a cell rewrites its line, adding a row inserts one line.
// Only a column operation has to touch every line, because a column runs down
// all of them — that is the change, not a side effect of how it is stored.

import {
  delimiterField, displayWidth, formatGrid, formatRule, insertField, joinFields,
  removeField, replaceField, sameSelector, splitFields,
  type Align, type Selector, type TableFile,
} from '@docpresenter/core';
import type { Edit } from './edit.js';

export class TableEditError extends Error {}

/** Every line of the grid, in order, with the range it occupies. */
function gridLines(table: TableFile): { text: string; start: number; end: number }[] {
  return [table.header, table.delimiter, ...table.rows.map(r => r.line)]
    .map(line => ({ text: line.text, start: line.span.start, end: line.span.end }));
}

/** Row -1 is the header; 0 and up are body rows. The delimiter is not a row. */
function lineOf(table: TableFile, row: number): { text: string; start: number; end: number } {
  const line = row < 0 ? table.header : table.rows[row]?.line;
  if (!line) throw new TableEditError(`${row + 1} 行目は無い`);
  return { text: line.text, start: line.span.start, end: line.span.end };
}

export function setCell(table: TableFile, row: number, column: number, text: string): Edit {
  const line = lineOf(table, row);
  return {
    span: { start: line.start, end: line.end },
    text: replaceField(line.text, column, text),
    description: 'セルを編集',
  };
}

export function setAlign(table: TableFile, column: number, align: Align): Edit {
  const fields = splitFields(table.delimiter.text);
  const width = displayWidth((fields[column] ?? '   ').trim());
  fields[column] = delimiterField(align, width);
  return {
    span: table.delimiter.span,
    text: joinFields(fields),
    description: '寄せを変更',
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
      description: '行を追加',
    };
  }
  const line = lineOf(table, at);
  return {
    span: { start: line.start, end: line.start },
    text: `${blank}\n`,
    description: '行を追加',
  };
}

export function removeRow(table: TableFile, at: number): Edit {
  if (table.rows.length <= 1) throw new TableEditError('最後の行は削除できない');
  const line = lineOf(table, at);
  // Take the newline on one side so no blank line is left behind.
  const span = at > 0
    ? { start: lineOf(table, at - 1).end, end: line.end }
    : { start: line.start, end: line.end + 1 };
  return { span, text: '', description: '行を削除' };
}

export function insertColumn(table: TableFile, at: number, header = ''): Edit {
  return rewriteGrid(table, (text, index) => {
    if (index === 0) return insertField(text, at, header);
    if (index === 1) return insertField(text, at, '---');
    return insertField(text, at, '');
  }, '列を追加');
}

export function removeColumn(table: TableFile, at: number): Edit {
  if (table.columns.length <= 1) throw new TableEditError('最後の列は削除できない');
  return rewriteGrid(table, text => removeField(text, at), '列を削除');
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
      source.forEach((value, i) => { fields[column + i] = ` ${value.trim()} `; });
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
    description: '貼り付け',
  };
}

/** The explicit format command. Never run on its own. */
export function formatTable(table: TableFile): Edit {
  const lines = gridLines(table);
  return {
    span: { start: lines[0]!.start, end: lines[lines.length - 1]!.end },
    text: formatGrid(table),
    description: '表を整形',
  };
}

/** Parses what a spreadsheet puts on the clipboard. */
export function parseClipboardGrid(text: string): string[][] {
  return text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(line => line.split('\t'));
}

function rewriteGrid(
  table: TableFile, rewrite: (text: string, index: number) => string, description: string,
): Edit {
  const lines = gridLines(table);
  return {
    span: { start: lines[0]!.start, end: lines[lines.length - 1]!.end },
    text: lines.map((line, i) => rewrite(line.text, i)).join('\n'),
    description,
  };
}

// --- スタイル -----------------------------------------------------------
//
// Ruling and fills are recorded only where they deviate from the theme, so a
// style change adds, rewrites or removes one rule line. The selectors are the
// ones the file already uses — a cell by the names of its row and column, a
// range by the names of its first and last row — so a rule keeps pointing at
// the same thing when rows move.

/** The properties a rule may carry. Values are tokens; never a literal. */
export type StyleProperty = 'fill' | 'bottom' | 'right' | 'top' | 'left' | 'width';

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
      return { span: table.header.span, text: table.header.text, description: '変更なし' };
    }
    return addRule(table, selector, new Map([[property, value]]));
  }

  const declarations = new Map(existing.declarations);
  if (value === undefined) declarations.delete(property);
  else declarations.set(property, value);

  if (declarations.size === 0) {
    return {
      span: { start: existing.span.start, end: existing.span.end + 1 },
      text: '',
      description: 'スタイルを解除',
    };
  }
  return {
    span: existing.span,
    text: formatRule(selector, declarations),
    description: value === undefined ? 'スタイルを解除' : 'スタイルを設定',
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

function addRule(
  table: TableFile, selector: Selector, declarations: ReadonlyMap<string, string>,
): Edit {
  const line = formatRule(selector, declarations);
  if (table.styleBlock) {
    const { insertAt, indent } = table.styleBlock;
    return {
      span: { start: insertAt, end: insertAt },
      text: `\n${indent}${line}`,
      description: 'スタイルを設定',
    };
  }
  // No style block yet: start one after everything else in the file.
  const end = lastByte(table);
  return {
    span: { start: end, end },
    text: `\n\nstyle {\n  ${line}\n}`,
    description: 'スタイルを設定',
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
