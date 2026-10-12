// Review anchors: a file, a byte range in it, and the text that range held
// (design/review-model.md §3).
//
// Two questions are answered here, for every place a comment comes from — a
// PDF annotation, a selection on the screen:
//
// - where, exactly, the words someone marked are in the source (`narrowAnchor`):
//   what they marked was printed, and the source has more in it than the page
//   shows — line breaks, `**`, the `@import` line a figure was drawn from;
// - where a comment made on an earlier version is now (`locateAnchor`, §3.2):
//   the file has been edited since, and the comment has to follow its words.

import { byteLength, sliceBytes } from './bytes.js';

export interface Anchor {
  /** The file, as a workspace path. */
  readonly file: string;
  /** Bytes of the file read as LF. */
  readonly start: number;
  readonly end: number;
  /** What the range held when the comment was made. */
  readonly quote: string;
}

/** How closely an anchor was taken: the marked words, the block they are in, or nowhere. */
export type Precision = 'text' | 'block' | 'none';

/** Characters the page does not print: spaces, line breaks, and the marks of inline formatting. */
const UNPRINTED = /[\s*_`~]/u;

/**
 * Finds printed words in a stretch of source, ignoring what the source has
 * and the page does not (spaces, line breaks, `**`). Returns the bytes of the
 * match within the whole file, and the source text it covers. Only an
 * unambiguous match counts: the same words twice cannot be told apart.
 */
export function findPrinted(
  source: string, start: number, end: number, printed: string,
): { start: number; end: number; quote: string } | undefined {
  const found = printedMatches(source, start, end, printed);
  return found.length === 1 ? found[0] : undefined;
}

/** Every place the printed words occur in a stretch of source. */
function printedMatches(
  source: string, start: number, end: number, printed: string,
): { start: number; end: number; quote: string }[] {
  const wanted = [...printed].filter(character => !UNPRINTED.test(character)).join('');
  if (wanted === '') return [];
  const stretch = sliceBytes(source, start, end);
  const kept: string[] = [];
  const at: number[] = [];
  let offset = 0;
  for (const character of stretch) {
    if (!UNPRINTED.test(character)) { kept.push(character); at.push(offset); }
    offset += character.length;
  }
  const hay = kept.join('');
  const out: { start: number; end: number; quote: string }[] = [];
  const characters = [...wanted].length;
  for (let index = hay.indexOf(wanted); index >= 0; index = hay.indexOf(wanted, index + 1)) {
    const keptIndex = [...hay.slice(0, index)].length;
    const from = at[keptIndex]!;
    const lastAt = at[keptIndex + characters - 1]!;
    const to = lastAt + String.fromCodePoint(stretch.codePointAt(lastAt)!).length;
    const quote = stretch.slice(from, to);
    const head = start + byteLength(stretch.slice(0, from));
    out.push({ start: head, end: head + byteLength(quote), quote });
  }
  return out;
}

/** The file an `@import` line brings in, as a workspace path, when the line is one. */
export function importedPathOf(document: string, line: string): string | undefined {
  const found = /^\s*@import\s+"([^"]+)"/.exec(line) ?? /^\s*!\[[^\]]*\]\(([^)]+)\)/.exec(line);
  if (!found) return undefined;
  const parts = document.split('/').slice(0, -1);
  for (const part of found[1]!.replace(/^\.\//, '').split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/**
 * The anchor for words someone marked inside a block — a paragraph, a
 * heading, a figure's `@import` line. The words themselves when they can be
 * found in the block, or in the file a figure or a table was drawn from; the
 * whole block otherwise.
 */
export function narrowAnchor(
  block: { readonly file: string; readonly start: number; readonly end: number },
  marked: string | undefined,
  read: (path: string) => string | undefined,
): { anchor: Anchor; precision: Precision } {
  const source = read(block.file) ?? '';
  const whole: Anchor = {
    file: block.file, start: block.start, end: block.end, quote: sliceBytes(source, block.start, block.end),
  };
  if (marked && marked.trim() !== '') {
    const within = findPrinted(source, block.start, block.end, marked);
    if (within) return { anchor: { file: block.file, ...within }, precision: 'text' };
    const imported = importedPathOf(block.file, whole.quote);
    const drawn = imported === undefined ? undefined : read(imported);
    if (imported && drawn !== undefined) {
      const found = findPrinted(drawn, 0, byteLength(drawn), marked);
      if (found) return { anchor: { file: imported, ...found }, precision: 'text' };
    }
  }
  return { anchor: whole, precision: 'block' };
}

/**
 * Where an anchor is in the file as it stands now.
 *
 * - `same`: the range still holds the quote.
 * - `moved`: the quote is there, elsewhere — lines were added or removed
 *   above it. Where the quote occurs more than once, the nearest wins.
 * - `changed`: the words themselves were edited. The anchor follows the part
 *   of the quote that is still there (§3.2 `stale`): the reader is told the
 *   text changed after the comment was made.
 * - `lost`: nothing of it is left (§7 `orphaned`). Kept, never dropped.
 */
export type AnchorState = 'same' | 'moved' | 'changed' | 'lost';

export function locateAnchor(
  anchor: Pick<Anchor, 'start' | 'end' | 'quote'>, current: string,
  /** The file at the commit the comment was made on, when it can be had. */
  before?: string,
): { start: number; end: number; state: AnchorState } {
  if (anchor.quote === '') return { start: anchor.start, end: anchor.end, state: 'lost' };
  // The version the comment was made on, carried through the edits since: the
  // exact answer, where the quote alone could only guess between two copies.
  if (before !== undefined && sliceBytes(before, anchor.start, anchor.end) === anchor.quote) {
    const mapped = mapRange(before, current, anchor.start, anchor.end);
    if (mapped && sliceBytes(current, mapped.start, mapped.end) === anchor.quote) {
      return { ...mapped, state: mapped.start === anchor.start ? 'same' : 'moved' };
    }
  }
  if (sliceBytes(current, anchor.start, anchor.end) === anchor.quote) {
    return { start: anchor.start, end: anchor.end, state: 'same' };
  }
  const nearest = (found: readonly { start: number; end: number }[]) =>
    found.reduce((best, one) => Math.abs(one.start - anchor.start) < Math.abs(best.start - anchor.start) ? one : best);

  const exact: { start: number; end: number }[] = [];
  for (let at = current.indexOf(anchor.quote); at >= 0; at = current.indexOf(anchor.quote, at + 1)) {
    const start = byteLength(current.slice(0, at));
    exact.push({ start, end: start + byteLength(anchor.quote) });
  }
  if (exact.length > 0) return { ...nearest(exact), state: 'moved' };

  // The same words with the spacing or the marks changed read the same.
  const printed = printedMatches(current, 0, byteLength(current), anchor.quote);
  if (printed.length > 0) return { ...nearest(printed), state: 'moved' };

  // Edited inside: follow the longest piece of the quote still there.
  const characters = [...anchor.quote];
  for (const parts of [2, 3, 4]) {
    const size = Math.ceil(characters.length / parts);
    if (size < 4) break;
    const pieces = Array.from({ length: parts }, (_, i) => characters.slice(i * size, (i + 1) * size).join(''))
      .filter(piece => [...piece].filter(c => !UNPRINTED.test(c)).length >= 4);
    const found = pieces.flatMap(piece => printedMatches(current, 0, byteLength(current), piece));
    if (found.length > 0) return { ...nearest(found), state: 'changed' };
  }
  return { start: anchor.start, end: anchor.end, state: 'lost' };
}

/**
 * A byte range of `before`, where it is in `after`, when the lines it sits on
 * were not edited — only moved by lines added or removed around them. Lines
 * are matched by a longest common subsequence: design documents are a few
 * hundred lines, and an exact answer is worth the quadratic table.
 */
export function mapRange(
  before: string, after: string, start: number, end: number,
): { start: number; end: number } | undefined {
  const a = before.split('\n');
  const b = after.split('\n');
  // Which line of `after` each unchanged line of `before` became.
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const to = new Map<number, number>();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { to.set(i, j); i += 1; j += 1; } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i += 1; else j += 1;
  }
  const startsA = lineStarts(a);
  const startsB = lineStarts(b);
  const lineOf = (offset: number): number => {
    let line = 0;
    while (line + 1 < startsA.length && startsA[line + 1]! <= offset) line += 1;
    return line;
  };
  const first = lineOf(start);
  const last = lineOf(Math.max(start, end - 1));
  // Every line the range touches has to have come through unedited.
  for (let line = first; line <= last; line += 1) {
    if (!to.has(line) || to.get(line)! - to.get(first)! !== line - first) return undefined;
  }
  const shift = startsB[to.get(first)!]! - startsA[first]!;
  return { start: start + shift, end: end + shift };
}

function lineStarts(lines: readonly string[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) { starts.push(at); at += byteLength(line) + 1; }
  return starts;
}
