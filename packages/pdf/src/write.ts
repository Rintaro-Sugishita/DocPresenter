// Writes a page plan as PDF.
//
// Everything is drawn through one coordinate translation: the plan counts from
// the top-left with y downwards, as the browser does, and PDF counts from the
// bottom-left. Doing that conversion in one place — here — is what keeps the
// measurement side free to think in the coordinates it actually sees.

import fontkit from '@pdf-lib/fontkit';
import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef,
  rgb, type PDFContext, type PDFFont, type PDFPage,
} from 'pdf-lib';
import {
  codePointsByFace, faceOf,
  type Item, type OutlineEntry, type PagePlan,
} from './plan.js';
import {
  FALLBACK, drawsGlyphs, isCff, missingGlyphs,
  type FontOptions, type FontSource, type FontStyle, type MissingGlyph,
} from './fonts.js';

export interface WriteResult {
  readonly bytes: Uint8Array;
  /** Characters no font could draw. See `fonts.ts`. */
  readonly missing: readonly MissingGlyph[];
}

export class FontError extends Error {}

/** Two sources naming the same face of the same file are one face. */
function faceKey(source: FontSource): string {
  return `${source.name}#${source.faceIndex ?? 0}#${source.bytes.length}`;
}

export async function writePdf(plan: PagePlan, options: FontOptions): Promise<WriteResult> {
  const byFace = codePointsByFace(plan);
  const missing: MissingGlyph[] = [];

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  // Styles that name the same face are one font in the file. A machine with
  // one Japanese face hands it in for body, bold and code alike, and three cuts
  // of it carrying the same name are three fonts a viewer takes for one: every
  // style but the first was drawn with the first one's glyph numbers, and came
  // out blank. So the characters are gathered per face, cut once, and shared.
  const faces = new Map<string, { source: FontSource; characters: Set<number>; styles: string[] }>();
  for (const [style, characters] of byFace) {
    const source = options.fonts[style as keyof typeof options.fonts];
    if (!source) continue;                      // the reader falls back below
    const key = faceKey(source);
    const face = faces.get(key) ?? { source, characters: new Set<number>(), styles: [] };
    for (const one of characters) face.characters.add(one);
    face.styles.push(style);
    faces.set(key, face);
  }

  const embedded: Record<string, PDFFont> = {};
  for (const { source, characters, styles } of faces.values()) {
    if (isCff(source.bytes) && !options.subset) {
      // Not a warning. pdf-lib's subsetter would produce a file whose text
      // extracts and whose glyphs are blank, and every check that reads the
      // text back would pass it.
      throw new FontError(
        `${source.name} は CFF フォントで、pdf-lib のサブセット化では字が描かれない。`
        + 'subset を渡すこと（design/pdf-engine.md §6.4）',
      );
    }
    missing.push(...missingGlyphs(source, characters));
    // Each face is cut down to what it actually carries, not to what the
    // document uses in total: the monospaced face has no use for the prose.
    const bytes = options.subset
      ? options.subset(source.bytes, characters, source.faceIndex ?? 0)
      : source.bytes;
    if (options.subset && !drawsGlyphs(bytes, characters)) {
      // The subsetter said nothing and produced a font with no outlines. Left
      // alone it would make a PDF whose text extracts and whose pages are
      // blank — the one failure this whole path is arranged to prevent.
      throw new FontError(
        `${source.name} を削った結果に字形が入っていない`
        + `（${characters.size} 字は多すぎる可能性がある）`,
      );
    }
    const font = await pdf.embedFont(bytes, { subset: !options.subset });
    for (const style of styles) embedded[style] = font;
  }

  if (plan.title) pdf.setTitle(plan.title);
  if (plan.subject) pdf.setSubject(plan.subject);
  pdf.setCreator('DocPresenter');
  pdf.setProducer('DocPresenter');
  // The commit the artifact was built from, so a printed page can be traced
  // back to the source it came from.
  if (plan.commit) pdf.setKeywords([`commit:${plan.commit}`]);

  // Where every destination sits, gathered as the pages are drawn: a link and a
  // bookmark both need a page and a height, and only the plan knows them.
  const anchors = new Map<string, Spot>();
  const wanted: { readonly page: PDFPage; readonly item: Item & { kind: 'link' } }[] = [];

  for (const page of plan.pages) {
    const width = page.width ?? plan.width;
    const height = page.height ?? plan.height;
    const sheet = pdf.addPage([width, height]);
    for (const item of page.items) {
      if (item.kind === 'anchor') {
        if (!anchors.has(item.id)) anchors.set(item.id, { page: sheet, top: height - item.y });
        continue;
      }
      if (item.kind === 'link') { wanted.push({ page: sheet, item }); continue; }
      await draw(pdf, sheet, item, height, embedded);
    }
  }

  for (const { page, item } of wanted) link(pdf, page, item, anchors);
  if (plan.outline) bookmarks(pdf, plan.outline, anchors);

  // The same character missing from two faces is one thing to say once.
  const said = new Set<string>();
  return {
    bytes: await pdf.save(),
    missing: missing.filter(one => {
      const key = `${one.font}/${one.codePoint}`;
      if (said.has(key)) return false;
      said.add(key);
      return true;
    }),
  };
}

/** A destination: which page, and how far up it. */
interface Spot {
  readonly page: PDFPage;
  /** In PDF coordinates, from the foot of the page. */
  readonly top: number;
}

/** `[page /XYZ left top null]` — open that page with that point at the top. */
function destination(context: PDFContext, spot: Spot): PDFArray {
  const array = PDFArray.withContext(context);
  array.push(spot.page.ref);
  array.push(PDFName.of('XYZ'));
  array.push(PDFNumber.of(0));
  array.push(PDFNumber.of(spot.top));
  array.push(PDFNumber.of(0));
  return array;
}

/**
 * A clickable area leading to an anchor. A link whose target is not in this
 * document draws nothing rather than a rectangle that does nothing: a box the
 * reader can click that goes nowhere is worse than no box.
 */
function link(
  pdf: PDFDocument, page: PDFPage, item: Item & { kind: 'link' },
  anchors: ReadonlyMap<string, Spot>,
): void {
  const spot = anchors.get(item.target);
  if (!spot) return;
  const height = page.getHeight();
  const annotation = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [item.x, height - item.y - item.height, item.x + item.width, height - item.y],
    // The reader draws no frame: the theme already shows what is a link, and a
    // yellow box around every cross-reference is how a PDF announces itself.
    Border: [0, 0, 0],
    Dest: destination(pdf.context, spot),
  });
  const existing = page.node.lookup(PDFName.of('Annots'));
  const list = existing instanceof PDFArray ? existing : PDFArray.withContext(pdf.context);
  list.push(pdf.context.register(annotation));
  page.node.set(PDFName.of('Annots'), list);
}

/**
 * The bookmark tree, from the document's own sections.
 *
 * pdf-lib has no outline of its own, so the dictionaries are written here.
 * Nesting comes from the heading levels: a deeper heading is a child of the
 * last shallower one, which is what the reader's pane shows.
 */
function bookmarks(
  pdf: PDFDocument, entries: readonly OutlineEntry[], anchors: ReadonlyMap<string, Spot>,
): void {
  const known = entries.filter(entry => anchors.has(entry.id));
  if (known.length === 0) return;

  const root = pdf.context.obj({ Type: 'Outlines' }) as PDFDict;
  const rootRef = pdf.context.register(root);

  interface Node { readonly ref: PDFRef; readonly dict: PDFDict; readonly level: number; }
  const open: Node[] = [];                     // the path from the root, deepest last
  const children = new Map<string, PDFRef[]>();
  const add = (parent: PDFRef, child: PDFRef): void => {
    const key = String(parent);
    children.set(key, [...(children.get(key) ?? []), child]);
  };

  for (const entry of known) {
    while (open.length > 0 && open[open.length - 1]!.level >= entry.level) open.pop();
    const parent = open.length === 0 ? rootRef : open[open.length - 1]!.ref;
    const dict = pdf.context.obj({
      // A title is text, not bytes: a hexadecimal string carries the Japanese
      // that a PDF's own Latin-1 strings cannot.
      Title: PDFHexString.fromText(entry.title),
      Parent: parent,
      Dest: destination(pdf.context, anchors.get(entry.id)!),
    }) as PDFDict;
    const ref = pdf.context.register(dict);
    add(parent, ref);
    open.push({ ref, dict, level: entry.level });
  }

  // Each level is a doubly linked list, and every parent says how many are
  // under it. A reader that finds one of these missing shows nothing at all.
  const close = (parent: PDFRef, dict: PDFDict): number => {
    const list = children.get(String(parent)) ?? [];
    if (list.length === 0) return 0;
    let total = 0;
    list.forEach((ref, i) => {
      const child = pdf.context.lookup(ref, PDFDict);
      if (i > 0) child.set(PDFName.of('Prev'), list[i - 1]!);
      if (i < list.length - 1) child.set(PDFName.of('Next'), list[i + 1]!);
      total += 1 + close(ref, child);
    });
    dict.set(PDFName.of('First'), list[0]!);
    dict.set(PDFName.of('Last'), list[list.length - 1]!);
    // Closed, as a negative count: a document of any size opens with its
    // sections listed, not with every sub-section unfolded.
    dict.set(PDFName.of('Count'), PDFNumber.of(dict === root ? total : -list.length));
    return total;
  };
  close(rootRef, root);

  pdf.catalog.set(PDFName.of('Outlines'), rootRef);
  pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

async function draw(
  pdf: PDFDocument, page: PDFPage, item: Item, height: number,
  fonts: Record<string, PDFFont>,
): Promise<void> {
  switch (item.kind) {
    case 'anchor':
    case 'link':
      return;                                   // taken out before drawing
    case 'text': {
      const face = faceOf(item);
      const font = fonts[face] ?? fonts[FALLBACK[face as FontStyle] ?? 'body'] ?? fonts['body']!;
      // The browser decided how wide this run is, with its own kerning and its
      // own idea of how a proportional Latin face sits beside CJK. Rather than
      // hope the PDF metrics agree, the difference is spread across the gaps.
      const natural = widthOf(font, item.text, item.size);
      const spacing = item.width !== undefined && item.text.length > 1
        ? (item.width - natural) / item.text.length
        : 0;
      page.drawText(item.text, {
        x: item.x, y: height - item.y, size: item.size, font,
        color: colour(item.colour),
        ...(Math.abs(spacing) > 0.01 ? { characterSpacing: spacing } : {}),
      });
      return;
    }
    case 'fill':
      page.drawRectangle({
        x: item.x, y: height - item.y - item.height,
        width: item.width, height: item.height, color: colour(item.colour),
      });
      return;
    case 'shape': {
      const d = item.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
        + (item.closed ? ' Z' : '');
      svg(page, d, height, item.fill, item.stroke, item.lineWidth, item.dash);
      return;
    }
    case 'path':
      svg(page, item.d, height, item.fill, item.stroke, item.lineWidth);
      return;
    case 'ellipse':
      page.drawEllipse({
        x: item.cx, y: height - item.cy, xScale: item.rx, yScale: item.ry,
        ...(item.fill ? { color: colour(item.fill) } : { opacity: 0 }),
        ...(item.stroke
          ? { borderColor: colour(item.stroke), borderWidth: item.lineWidth ?? 1 }
          : {}),
      });
      return;
    case 'picture': {
      const image = await embed(pdf, item.data);
      if (!image) return;
      page.drawImage(image, {
        x: item.x, y: height - item.y - item.height, width: item.width, height: item.height,
      });
      return;
    }
  }
}

/** An SVG path in plan coordinates: the origin is the page's top-left corner. */
function svg(
  page: PDFPage, d: string, height: number,
  fill: string | undefined, stroke: string | undefined,
  lineWidth: number | undefined, dash?: readonly number[],
): void {
  page.drawSvgPath(d, {
    x: 0, y: height,
    ...(fill ? { color: colour(fill) } : {}),
    ...(stroke ? { borderColor: colour(stroke), borderWidth: lineWidth ?? 1 } : {}),
    ...(dash && dash.length ? { borderDashArray: [...dash] } : {}),
    // pdf-lib fills a path black unless told otherwise, which turns every
    // outline into a blot.
    ...(fill ? {} : { opacity: 0 }),
  });
}

async function embed(
  pdf: PDFDocument, data: string,
): Promise<Awaited<ReturnType<PDFDocument['embedPng']>> | undefined> {
  const comma = data.indexOf(',');
  if (!data.startsWith('data:') || comma < 0) return undefined;
  const header = data.slice(5, comma);
  const bytes = decode(data.slice(comma + 1));
  if (header.startsWith('image/png')) return pdf.embedPng(bytes);
  if (header.startsWith('image/jpeg') || header.startsWith('image/jpg')) return pdf.embedJpg(bytes);
  // P6: an image in a format PDF cannot hold is not quietly dropped — the
  // caller is told by the absence being visible, and the measurement side
  // reports it as a diagnostic.
  return undefined;
}

function decode(base64: string): Uint8Array {
  // `atob` in a browser, `Buffer` in Node; neither is assumed.
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let at = 0;
  let buffer = 0;
  let bits = 0;
  for (const character of clean) {
    buffer = (buffer << 6) | CHARS.indexOf(character);
    bits += 6;
    if (bits < 8) continue;
    bits -= 8;
    out[at++] = (buffer >> bits) & 0xff;
  }
  return out.slice(0, at);
}

function widthOf(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return 0;
  }
}

function colour(value: string): ReturnType<typeof rgb> {
  const hex = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  const parts = long
    ? [long[1]!, long[2]!, long[3]!].map(p => parseInt(p, 16))
    : short
      ? [short[1]!, short[2]!, short[3]!].map(p => parseInt(p + p, 16))
      : [0, 0, 0];
  return rgb(parts[0]! / 255, parts[1]! / 255, parts[2]! / 255);
}
