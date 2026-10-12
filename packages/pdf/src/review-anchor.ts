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

import { narrowAnchor, type Anchor, type Precision } from '@docpresenter/base';
import { estimateWidth, type PdfAnnotation, type Rect, type ReviewBox, type ReviewMap, type ReviewPdf } from './review.js';

/** The anchor the review model fixes (base/src/anchor.ts). */
export type ReviewAnchor = Anchor;
export type { Precision };

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
  // paragraphs is about where it starts. Words in a figure or a table were
  // printed from the file the import line names, not from the line itself.
  const first = hits[0]!;
  const { anchor, precision } = narrowAnchor(first, marked, path => map.files[path]);
  return { annotation, anchor, precision, ...(marked ? { marked } : {}) };
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
