// What a reviewer wrote on a PDF, traced back to the source it was printed from.
//
// A PDF annotation is pinned to a place on a page, and a page is not a file.
// But we made the page, so we can say what is where: when the PDF is written
// it carries a review map — every run of text with the file and byte range it
// came from, and the text of those files as they were built — as an ordinary
// attachment, which viewers keep when they save annotations. Reading it back,
// an annotation's rectangle finds the runs under it, and the words it covers
// find the bytes (design/review-model.md §3.4, §6).
//
// Nothing here guesses silently. An annotation that lands on nothing the map
// knows is still read, and comes back with no anchor so the caller can keep it
// (§7: a reviewer's comment is never dropped).

import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef,
  PDFString, decodePDFRawStream, type PDFObject,
} from 'pdf-lib';
import type { Item, PagePlan } from './plan.js';

/** The attachment the map travels as. */
export const REVIEW_ATTACHMENT = 'docpresenter-review.json';

/** What the build knows about where a PDF came from. */
export interface ReviewSource {
  /** The document the PDF was built from, as a workspace path. */
  readonly document: string;
  readonly commit?: string | undefined;
  /** False when the working tree had changes the commit does not hold. */
  readonly clean?: boolean | undefined;
  /** Every file the document was built from, by workspace path, read as LF. */
  readonly files: Readonly<Record<string, string>>;
}

/** One run of the page and where it came from. Coordinates in points, from the top left. */
export interface ReviewBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly file: string;
  readonly start: number;
  readonly end: number;
  /** The words as printed; empty for a drawn mark (a box in a figure). */
  readonly text: string;
}

export interface ReviewMap extends ReviewSource {
  readonly version: 1;
  readonly pages: readonly { readonly width: number; readonly height: number; readonly boxes: readonly ReviewBox[] }[];
}

/** The map for a plan: what is printed where, and what it was printed from. */
export function reviewMapOf(plan: PagePlan, source: ReviewSource): ReviewMap {
  return {
    version: 1,
    ...source,
    pages: plan.pages.map(page => ({
      width: page.width ?? plan.width,
      height: page.height ?? plan.height,
      boxes: page.items.flatMap(item => boxOf(item, source.document)),
    })),
  };
}

function boxOf(item: Item, document: string): ReviewBox[] {
  if (!item.span) return [];
  const from = { file: item.doc ?? document, start: item.span.start, end: item.span.end };
  const round = (n: number): number => Math.round(n * 10) / 10;
  switch (item.kind) {
    case 'text': {
      // From the baseline up to the ascender, and a little below for descenders.
      const width = item.width ?? estimateWidth(item.text, item.size);
      return [{ x: round(item.x), y: round(item.y - item.size * 0.88), w: round(width), h: round(item.size * 1.12), ...from, text: item.text }];
    }
    case 'fill':
    case 'picture':
      return [{ x: round(item.x), y: round(item.y), w: round(item.width), h: round(item.height), ...from, text: '' }];
    case 'shape': {
      const xs = item.points.map(point => point.x);
      const ys = item.points.map(point => point.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return [{ x: round(x), y: round(y), w: round(Math.max(...xs) - x), h: round(Math.max(...ys) - y), ...from, text: '' }];
    }
    case 'ellipse':
      return [{ x: round(item.cx - item.rx), y: round(item.cy - item.ry), w: round(item.rx * 2), h: round(item.ry * 2), ...from, text: '' }];
    default:
      return [];
  }
}

/** A full-width character is about an em wide; anything narrower about half. */
export function estimateWidth(text: string, size: number): number {
  let width = 0;
  for (const character of text) width += character.codePointAt(0)! > 0xff ? size : size * 0.55;
  return width;
}

/** A rectangle on a page, in points from the top left. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One annotation as the reviewer left it. */
export interface PdfAnnotation {
  /** 1 for the first page. */
  readonly page: number;
  /** `Highlight`, `Underline`, `Text` (a sticky note), `FreeText`, `Square`, … */
  readonly kind: string;
  readonly rect: Rect;
  /** The marked words, for highlights and the like; empty otherwise. */
  readonly quads: readonly Rect[];
  readonly body: string;
  readonly author?: string | undefined;
  /** As the PDF writes it (`D:20261007…`), turned into ISO 8601 when it can be. */
  readonly date?: string | undefined;
  /** Stable across imports of the same file: the annotation's own name, or one made from what it is. */
  readonly key: string;
  /** The key of the annotation this one answers, for a reply. */
  readonly replyTo?: string | undefined;
}

export interface ReviewPdf {
  readonly map?: ReviewMap | undefined;
  /** The commit in the PDF's own metadata, when the map is missing. */
  readonly commit?: string | undefined;
  readonly annotations: readonly PdfAnnotation[];
}

/** Kinds that are not comments: the pop-up that shows another's text, a link, a form field. */
const NOT_COMMENTS = new Set(['Popup', 'Link', 'Widget']);

/** Reads the annotations and the review map out of a PDF. */
export async function readReviewPdf(bytes: Uint8Array): Promise<ReviewPdf> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const map = readMap(pdf);
  const commit = map?.commit ?? /commit:([0-9a-f]{7,40})/.exec(pdf.getKeywords() ?? '')?.[1];

  const found: { annotation: Omit<PdfAnnotation, 'replyTo'>; ref?: PDFRef; replyRef?: PDFRef }[] = [];
  pdf.getPages().forEach((page, index) => {
    const height = page.getHeight();
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) return;
    for (let i = 0; i < annots.size(); i += 1) {
      const raw = annots.get(i);
      const dict = raw instanceof PDFRef ? pdf.context.lookupMaybe(raw, PDFDict) : raw instanceof PDFDict ? raw : undefined;
      if (!dict) continue;
      const kind = nameOf(dict.get(PDFName.of('Subtype')));
      if (!kind || NOT_COMMENTS.has(kind)) continue;
      const rect = rectOf(numbers(dict.lookupMaybe(PDFName.of('Rect'), PDFArray)), height);
      if (!rect) continue;
      const quads = quadsOf(numbers(dict.lookupMaybe(PDFName.of('QuadPoints'), PDFArray)), height);
      const body = textOf(dict.get(PDFName.of('Contents')));
      const author = textOf(dict.get(PDFName.of('T'))) || undefined;
      const date = dateOf(textOf(dict.get(PDFName.of('M'))) || textOf(dict.get(PDFName.of('CreationDate'))));
      const name = textOf(dict.get(PDFName.of('NM')));
      const key = name || `p${index + 1}-${kind}-${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)},${Math.round(rect.h)}-${hash(body)}`;
      const reply = dict.get(PDFName.of('IRT'));
      found.push({
        annotation: { page: index + 1, kind, rect, quads, body, author, date, key },
        ...(raw instanceof PDFRef ? { ref: raw } : {}),
        ...(reply instanceof PDFRef ? { replyRef: reply } : {}),
      });
    }
  });

  const keyOfRef = new Map(found.filter(one => one.ref).map(one => [one.ref!.toString(), one.annotation.key]));
  const annotations = found.map(({ annotation, replyRef }) => ({
    ...annotation,
    ...(replyRef && keyOfRef.has(replyRef.toString()) ? { replyTo: keyOfRef.get(replyRef.toString()) } : {}),
  }));
  return { map, commit, annotations };
}

function readMap(pdf: PDFDocument): ReviewMap | undefined {
  const names = pdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const files = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  if (!files) return undefined;
  const spec = findName(pdf, files, REVIEW_ATTACHMENT);
  const stream = spec?.lookupMaybe(PDFName.of('EF'), PDFDict)?.lookup(PDFName.of('F'));
  if (!(stream instanceof PDFRawStream)) return undefined;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodePDFRawStream(stream).decode())) as ReviewMap;
    return parsed.version === 1 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Walks a name tree for one name. */
function findName(pdf: PDFDocument, node: PDFDict, wanted: string): PDFDict | undefined {
  const leaves = node.lookupMaybe(PDFName.of('Names'), PDFArray);
  for (let i = 0; leaves && i + 1 < leaves.size(); i += 2) {
    if (textOf(leaves.get(i)) !== wanted) continue;
    const value = leaves.get(i + 1);
    return value instanceof PDFRef ? pdf.context.lookupMaybe(value, PDFDict) : value instanceof PDFDict ? value : undefined;
  }
  const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
  for (let i = 0; kids && i < kids.size(); i += 1) {
    const kid = pdf.context.lookupMaybe(kids.get(i) as PDFRef, PDFDict);
    const found = kid && findName(pdf, kid, wanted);
    if (found) return found;
  }
  return undefined;
}

function nameOf(object: PDFObject | undefined): string | undefined {
  return object instanceof PDFName ? object.decodeText() : undefined;
}

function textOf(object: PDFObject | undefined): string {
  return object instanceof PDFString || object instanceof PDFHexString ? object.decodeText() : '';
}

function numbers(array: PDFArray | undefined): number[] {
  if (!array) return [];
  const out: number[] = [];
  for (let i = 0; i < array.size(); i += 1) {
    const one = array.get(i);
    if (one instanceof PDFNumber) out.push(one.asNumber());
  }
  return out;
}

/** A PDF rectangle (x1 y1 x2 y2, from the bottom left) as one from the top left. */
function rectOf(values: readonly number[], height: number): Rect | undefined {
  if (values.length < 4) return undefined;
  const [a, b, c, d] = values as [number, number, number, number];
  return { x: Math.min(a, c), y: height - Math.max(b, d), w: Math.abs(c - a), h: Math.abs(d - b) };
}

/** QuadPoints, eight numbers to a marked line, as rectangles from the top left. */
function quadsOf(values: readonly number[], height: number): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i + 7 < values.length; i += 8) {
    const xs = [values[i]!, values[i + 2]!, values[i + 4]!, values[i + 6]!];
    const ys = [values[i + 1]!, values[i + 3]!, values[i + 5]!, values[i + 7]!];
    const x = Math.min(...xs);
    const top = Math.max(...ys);
    out.push({ x, y: height - top, w: Math.max(...xs) - x, h: top - Math.min(...ys) });
  }
  return out;
}

/** `D:20261007123456+09'00'` → `2026-10-07T12:34:56+09:00`. */
function dateOf(value: string): string | undefined {
  const found = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz]|[+-]\d{2}'?\d{2}'?)?/.exec(value);
  if (!found) return value || undefined;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', zone] = found;
  const offset = !zone ? '' : /^[Zz]$/.test(zone) ? 'Z' : `${zone.slice(0, 3)}:${zone.replace(/'/g, '').slice(3, 5)}`;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`;
}

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}
