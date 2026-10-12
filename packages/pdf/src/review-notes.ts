// The review so far, written into the PDF as annotations.
//
// A customer reviews the PDF in their own viewer and has no Git and no VS Code
// to see what became of what they said. So the PDF they are sent carries it:
// each comment on the document as an annotation where its words are now, with
// its state, the answer and what was said since written into the annotation's
// own text. Not as replies threaded under it: a viewer that does not show
// threads (Edge does not) would show the comment and never the answer.
//
// The customer answers in the same annotation — in a viewer that threads, by
// replying; in one that does not, by writing on below what we wrote. The map
// keeps what we wrote in each, so an import can tell what was added and take
// it back under that comment (review-file.ts).
//
// Everything written here is named `dp-review:…`, so an import knows it for
// ours and does not take it back in as a new comment.

import { PDFArray, PDFHexString, PDFName, PDFString, type PDFDocument, type PDFPage, type PDFRef } from 'pdf-lib';
import { DEFAULT_LOCALE, importedPathOf, sliceBytes, type Locale } from '@docpresenter/base';
import { estimateWidth, type ReviewBox, type ReviewMap } from './review.js';
import { PDF_MESSAGES } from './messages.js';

/** A comment to show on the PDF, where its words are now. */
export interface ReviewPdfNote {
  /** `dp-review:<review file>#<id>` — what an import recognises as ours. */
  readonly key: string;
  /** Where its words are now, in the files as they were built. */
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly body: string;
  readonly status: string;
  readonly author?: string | undefined;
  readonly date?: string | undefined;
  /** Answers, the engineer's and the earlier replies, in order. */
  readonly replies: readonly { readonly key: string; readonly body: string; readonly author?: string | undefined; readonly date?: string | undefined }[];
}

/** The prefix every annotation written here carries in its name. */
export const REVIEW_NOTE_PREFIX = 'dp-review:';

/** Characters the page does not print. */
const UNPRINTED = /[\s*_`~]/u;

/**
 * Adds the notes to the pages, each beside the run its words were printed in.
 * A note whose words are on no page — a sheet that was left out, a file the
 * document no longer takes in — is left out; it is still in the review file.
 */
export function addReviewNotes(
  pdf: PDFDocument, map: ReviewMap, notes: readonly ReviewPdfNote[], locale: Locale = DEFAULT_LOCALE,
): number {
  const t = PDF_MESSAGES.in(locale);
  const pages = pdf.getPages();
  let placed = 0;
  for (const note of notes) {
    const found = place(map, note);
    if (!found) continue;
    const page = pages[found.page];
    if (!page) continue;
    const height = page.getHeight();
    const { box, quads } = found;
    const subject = t(`pdf.review.status.${statusKey(note.status)}`);
    const common = {
      Type: 'Annot', T: text(note.author ?? t('pdf.review.reviewer')), NM: text(note.key),
      Contents: text(noteContents(note, locale)), Subj: text(subject), ...(note.date ? { M: PDFString.of(pdfDate(note.date)) } : {}),
    };
    // The words themselves when they are on one run; the block's first line otherwise.
    const parent = quads
      ? pdf.context.obj({
        ...common, Subtype: 'Highlight', C: [1, 0.82, 0.2], CA: 0.45, F: 4,
        Rect: rect(quads, height), QuadPoints: quads.flatMap(quad => quadPoints(quad, height)),
      })
      : pdf.context.obj({
        ...common, Subtype: 'Text', Name: 'Comment', C: [1, 0.82, 0.2], Open: false,
        Rect: [Math.max(2, box.x - 22), height - box.y - 18, Math.max(2, box.x - 22) + 18, height - box.y],
      });
    annotsOf(pdf, page).push(pdf.context.register(parent));
    placed += 1;
  }
  return placed;
}

/**
 * What a comment's annotation says: the comment, its state, and the
 * conversation since — each part under a label, so it reads in any viewer.
 */
export function noteContents(note: ReviewPdfNote, locale: Locale = DEFAULT_LOCALE): string {
  const t = PDF_MESSAGES.in(locale);
  const parts = [
    note.body,
    `${t('pdf.review.label.status')}${t(`pdf.review.status.${statusKey(note.status)}`)}`,
    ...note.replies.map(reply => {
      const label = reply.key.endsWith('/answer') ? t('pdf.review.label.answer')
        : t('pdf.review.label.reply', { author: reply.author ?? t('pdf.review.reviewer') });
      return `${label}${reply.body}`;
    }),
  ];
  return parts.join('\n\n');
}

/** The page and the run a note goes on, and the marks over its words when they are on that run. */
function place(map: ReviewMap, note: ReviewPdfNote): { page: number; box: ReviewBox; quads?: { x: number; y: number; w: number; h: number }[] } | undefined {
  const source = map.files[note.file];
  if (source === undefined) return undefined;
  const words = [...sliceBytes(source, note.start, note.end)].filter(c => !UNPRINTED.test(c)).join('');
  // A run printed from the range itself (a paragraph, a heading), or one
  // printed from the line that takes the file in (a figure, a table).
  const fromFile = (box: ReviewBox): boolean => box.file === note.file && box.start <= note.start && note.end <= box.end;
  const fromImport = (box: ReviewBox): boolean => box.file !== note.file
    && importedPathOf(box.file, sliceBytes(map.files[box.file] ?? '', box.start, box.end)) === note.file;
  let fallback: { page: number; box: ReviewBox } | undefined;
  for (const [index, page] of map.pages.entries()) {
    for (const box of page.boxes) {
      if (!fromFile(box) && !fromImport(box)) continue;
      fallback ??= { page: index, box };
      if (box.text === '' || words === '') continue;
      const quads = quadsOf(box, words);
      if (quads) return { page: index, box, quads };
    }
    // Words that run over a line break: the lines of the block on this page,
    // read one after the other.
    const lines = page.boxes.filter(box => box.text !== '' && (fromFile(box) || fromImport(box)));
    const across = words === '' ? undefined : quadsAcross(lines, words);
    if (across) return { page: index, box: lines[0]!, quads: across };
  }
  return fallback;
}

/** The marks over words that start on one run and go on in the runs after it. */
function quadsAcross(lines: readonly ReviewBox[], words: string): { x: number; y: number; w: number; h: number }[] | undefined {
  const where: { line: number; char: number }[] = [];
  let printed = '';
  lines.forEach((box, line) => {
    [...box.text].forEach((character, char) => {
      if (UNPRINTED.test(character)) return;
      where.push({ line, char });
      printed += character;
    });
  });
  const at = printed.indexOf(words);
  if (at < 0) return undefined;
  const covered = where.slice(at, at + [...words].length);
  const quads: { x: number; y: number; w: number; h: number }[] = [];
  for (const [line, box] of lines.entries()) {
    const chars = covered.filter(one => one.line === line).map(one => one.char);
    if (chars.length === 0) continue;
    const characters = [...box.text];
    const scale = box.w / Math.max(1, estimateWidth(box.text, 1));
    const offset = (i: number): number => estimateWidth(characters.slice(0, i).join(''), 1) * scale;
    const x = box.x + offset(Math.min(...chars));
    quads.push({ x, y: box.y, w: box.x + offset(Math.max(...chars) + 1) - x, h: box.h });
  }
  return quads;
}

/** Where the printed words sit on a run, worked out from the run's width and its characters. */
function quadsOf(box: ReviewBox, words: string): { x: number; y: number; w: number; h: number }[] | undefined {
  const kept: number[] = [];
  let printed = '';
  [...box.text].forEach((character, i) => { if (!UNPRINTED.test(character)) { kept.push(i); printed += character; } });
  const at = printed.indexOf(words);
  if (at < 0) return undefined;
  const characters = [...box.text];
  const scale = box.w / Math.max(1, estimateWidth(box.text, 1));
  const offset = (i: number): number => estimateWidth(characters.slice(0, i).join(''), 1) * scale;
  const first = kept[at]!;
  const last = kept[at + [...words].length - 1]!;
  const x = box.x + offset(first);
  return [{ x, y: box.y, w: box.x + offset(last + 1) - x, h: box.h }];
}

function rect(quads: readonly { x: number; y: number; w: number; h: number }[], height: number): number[] {
  const x0 = Math.min(...quads.map(q => q.x));
  const x1 = Math.max(...quads.map(q => q.x + q.w));
  const top = Math.min(...quads.map(q => q.y));
  const bottom = Math.max(...quads.map(q => q.y + q.h));
  return [x0, height - bottom, x1, height - top];
}

/** Upper left, upper right, lower left, lower right — the order viewers read. */
function quadPoints(quad: { x: number; y: number; w: number; h: number }, height: number): number[] {
  const top = height - quad.y;
  const bottom = height - quad.y - quad.h;
  return [quad.x, top, quad.x + quad.w, top, quad.x, bottom, quad.x + quad.w, bottom];
}

/** The page's list of annotations, made when it has none yet. */
function annotsOf(pdf: PDFDocument, page: PDFPage): { push(...refs: PDFRef[]): void } {
  let annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) {
    annots = pdf.context.obj([]);
    page.node.set(PDFName.of('Annots'), annots);
  }
  const list = annots;
  return { push: (...refs) => { for (const ref of refs) list.push(ref); } };
}

/** Text a viewer shows in any script: UTF-16, as viewers write it themselves. */
function text(value: string): PDFHexString {
  return PDFHexString.fromText(value);
}

/** ISO 8601 as a PDF date: `D:20261009103000Z`. */
function pdfDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return `D:${iso.replace(/\D/g, '').slice(0, 14)}`;
  const two = (n: number): string => String(n).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}`
    + `${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}Z`;
}

function statusKey(status: string): 'open' | 'resolved' | 'wontfix' | 'question' {
  return (['open', 'resolved', 'wontfix', 'question'] as const).find(one => one === status) ?? 'open';
}
