// From where an annotation sits on a page to the bytes it is about.
//
// The anchor is the one the review model fixes: a file, a byte range in it as
// read with LF line breaks, and the text that range held (design/review-model.md
// §3). How close it gets depends on what the reviewer did:
//
// - marked words (a highlight, an underline) find those words in the source,
//   and the anchor is exactly them — `text`;
// - a note or a box over a paragraph, a figure or a table lands on that block,
//   and the anchor is the whole block — `block`;
// - something on nothing the map knows (a margin, a page with no map) has no
//   anchor — `none` — and is kept regardless (§7).

import { byteLength, sliceBytes } from '@docpresenter/base';
import { estimateWidth, type PdfAnnotation, type Rect, type ReviewBox, type ReviewMap, type ReviewPdf } from './review.js';

export interface ReviewAnchor {
  readonly file: string;
  /** Bytes of the file read as LF. */
  readonly start: number;
  readonly end: number;
  readonly quote: string;
}

export type Precision = 'text' | 'block' | 'none';

export interface ResolvedAnnotation {
  readonly annotation: PdfAnnotation;
  readonly anchor?: ReviewAnchor | undefined;
  readonly precision: Precision;
  /** The words under a highlight, as printed. */
  readonly marked?: string | undefined;
}

export function resolveAnnotations(review: ReviewPdf): ResolvedAnnotation[] {
  return review.annotations.map(annotation => resolveOne(annotation, review.map));
}

function resolveOne(annotation: PdfAnnotation, map: ReviewMap | undefined): ResolvedAnnotation {
  const page = map?.pages[annotation.page - 1];
  if (!map || !page) return { annotation, precision: 'none' };

  const targets = annotation.quads.length > 0 ? annotation.quads : [annotation.rect];
  let hits = page.boxes.filter(box => targets.some(target => covers(target, box, annotation.quads.length > 0)));
  // A sticky note is a small icon beside what it is about, often in the
  // margin. Failing a direct hit, it is about the nearest text on its line,
  // or failing that, the nearest below it.
  if (hits.length === 0 && annotation.quads.length === 0) {
    const near = nearest(page.boxes, annotation.rect);
    hits = near ? [near] : [];
  }
  if (hits.length === 0) return { annotation, precision: 'none' };

  const marked = annotation.quads.length > 0 ? markedText(hits, annotation.quads) : undefined;
  // The block most of the annotation lies on. A highlight across two
  // paragraphs is about where it starts.
  const first = hits[0]!;
  const block: ReviewAnchor = {
    file: first.file, start: first.start, end: first.end,
    quote: sliceBytes(map.files[first.file] ?? '', first.start, first.end),
  };

  if (marked && marked.trim() !== '') {
    const within = findIn(map.files[first.file] ?? '', first.start, first.end, marked);
    if (within) return { annotation, anchor: { file: first.file, ...within }, precision: 'text', marked };
    // Words in a figure or a table were printed from the file the import line
    // names, not from the line itself.
    const imported = importedPath(first.file, block.quote);
    const source = imported === undefined ? undefined : map.files[imported];
    if (imported && source !== undefined) {
      const found = findIn(source, 0, byteLength(source), marked);
      if (found) return { annotation, anchor: { file: imported, ...found }, precision: 'text', marked };
    }
  }
  return { annotation, anchor: block, precision: 'block', ...(marked ? { marked } : {}) };
}

/** Whether a mark covers a run: a marked line must sit on it, a box need only touch it. */
function covers(target: Rect, box: ReviewBox, line: boolean): boolean {
  const across = Math.min(target.x + target.w, box.x + box.w) - Math.max(target.x, box.x);
  const down = Math.min(target.y + target.h, box.y + box.h) - Math.max(target.y, box.y);
  if (across <= 0 || down <= 0) return false;
  return !line || (box.text !== '' && down >= Math.min(target.h, box.h) * 0.5);
}

function nearest(boxes: readonly ReviewBox[], at: Rect): ReviewBox | undefined {
  const middle = at.y + at.h / 2;
  const onLine = boxes.filter(box => box.text !== '' && box.y <= middle && middle <= box.y + box.h);
  const pool = onLine.length > 0 ? onLine : boxes.filter(box => box.text !== '' && box.y >= at.y - 4);
  let best: ReviewBox | undefined;
  let distance = Infinity;
  for (const box of pool) {
    const dx = Math.max(0, box.x - (at.x + at.w), at.x - (box.x + box.w));
    const dy = Math.max(0, box.y - (at.y + at.h), at.y - (box.y + box.h));
    const d = Math.hypot(dx, dy);
    if (d < distance) { distance = d; best = box; }
  }
  return distance <= 72 ? best : undefined;
}

/**
 * The words a highlight covers, read off the runs under it. Where a run is
 * only partly covered, the share of it is worked out from how wide its
 * characters are — the PDF does not say where each character sits, but the
 * run's width and its characters are enough to tell.
 */
function markedText(boxes: readonly ReviewBox[], quads: readonly Rect[]): string {
  const parts: string[] = [];
  for (const box of boxes) {
    if (box.text === '') continue;
    const quad = quads.find(one => covers(one, box, true));
    if (!quad) continue;
    const scale = box.w / Math.max(1, estimateWidth(box.text, 1));
    let x = box.x;
    let taken = '';
    for (const character of box.text) {
      const width = estimateWidth(character, 1) * scale;
      const centre = x + width / 2;
      if (centre >= quad.x && centre <= quad.x + quad.w) taken += character;
      x += width;
    }
    parts.push(taken);
  }
  return parts.join('');
}

/** Characters the page does not print: spaces, line breaks, and the marks of inline formatting. */
const UNPRINTED = /[\s*_`~]/u;

/**
 * Finds printed words in a stretch of source, ignoring what the source has
 * and the page does not (spaces, line breaks, `**`). Returns the bytes of the
 * match within the whole file, and the source text it covers.
 */
export function findIn(
  source: string, start: number, end: number, printed: string,
): { start: number; end: number; quote: string } | undefined {
  const wanted = [...printed].filter(character => !UNPRINTED.test(character)).join('');
  if (wanted === '') return undefined;
  const stretch = sliceBytes(source, start, end);
  const kept: string[] = [];
  const at: number[] = [];
  let offset = 0;
  for (const character of stretch) {
    if (!UNPRINTED.test(character)) { kept.push(character); at.push(offset); }
    offset += character.length;
  }
  const hay = kept.join('');
  const index = hay.indexOf(wanted);
  // Only an unambiguous match narrows the anchor: the same words twice in a
  // paragraph cannot be told apart by their text alone.
  if (index < 0 || hay.indexOf(wanted, index + 1) >= 0) return undefined;
  const characters = [...wanted].length;
  const keptIndex = [...hay.slice(0, index)].length;
  const from = at[keptIndex]!;
  const lastAt = at[keptIndex + characters - 1]!;
  const to = lastAt + String.fromCodePoint(stretch.codePointAt(lastAt)!).length;
  const quote = stretch.slice(from, to);
  const head = start + byteLength(stretch.slice(0, from));
  return { start: head, end: head + byteLength(quote), quote };
}

/** The file an `@import` line brings in, as a workspace path, when the block is one. */
function importedPath(document: string, line: string): string | undefined {
  const found = /^\s*@import\s+"([^"]+)"/.exec(line) ?? /^\s*!\[[^\]]*\]\(([^)]+)\)/.exec(line);
  if (!found) return undefined;
  const parts = document.split('/').slice(0, -1);
  for (const part of found[1]!.replace(/^\.\//, '').split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}
