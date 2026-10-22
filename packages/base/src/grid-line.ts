// One line of a `.table` grid, as text.
//
// The table belongs to the document side, but a screen drawing reads its item
// list and writes one cell of it back — and the drawing side is installed
// without the document side. Splitting a line and substituting one field are
// the only parts both need, so they live here; the rest of the table stays
// where it was.

import { displayWidth } from './width.js';

/** Splits a grid line into cells, trimmed, honouring `\|` as a literal pipe. */
export function splitGridRow(text: string): string[] {
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

/** The fields of a grid line, padding included, `\|` kept as written. */
export function splitFields(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  for (let i = 1; i < line.length; i++) {
    const char = line[i]!;
    if (char === '\\' && line[i + 1] === '|') { current += '\\|'; i++; continue; }
    if (char === '|') { fields.push(current); current = ''; continue; }
    current += char;
  }
  if (current.trim() !== '') fields.push(current);
  return fields;
}

export function joinFields(fields: readonly string[]): string {
  return `|${fields.join('|')}|`;
}

/** A literal pipe has to be escaped, and a cell is one line. */
export function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Substitutes one field, keeping the line's width where the new value fits.
 * A field shorter than the old one is padded back out; a longer one grows.
 */
export function replaceField(line: string, index: number, text: string): string {
  const fields = splitFields(line);
  while (fields.length <= index) fields.push(' ');
  const was = fields[index]!;
  const written = ` ${escapeCell(text.trim())} `;
  const room = displayWidth(was) - displayWidth(written);
  fields[index] = room > 0 ? written + ' '.repeat(room) : written;
  return joinFields(fields);
}
