// Writes a page plan as PDF.
//
// Everything is drawn through one coordinate translation: the plan counts from
// the top-left with y downwards, as the browser does, and PDF counts from the
// bottom-left. Doing that conversion in one place — here — is what keeps the
// measurement side free to think in the coordinates it actually sees.

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { codePointsOf, type Item, type PagePlan } from './plan.js';
import { isCff, missingGlyphs, type FontOptions, type MissingGlyph } from './fonts.js';

export interface WriteResult {
  readonly bytes: Uint8Array;
  /** Characters no font could draw. See `fonts.ts`. */
  readonly missing: readonly MissingGlyph[];
}

export class FontError extends Error {}

export async function writePdf(plan: PagePlan, options: FontOptions): Promise<WriteResult> {
  const used = codePointsOf(plan);
  const missing = missingGlyphs(options.fonts.regular, used);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const embedded: Record<string, PDFFont> = {};
  for (const [style, source] of Object.entries(options.fonts)) {
    const cff = isCff(source.bytes);
    if (cff && !options.subset) {
      // Not a warning. pdf-lib's subsetter would produce a file whose text
      // extracts and whose glyphs are blank, and every check that reads the
      // text back would pass it.
      throw new FontError(
        `${source.name} は CFF フォントで、pdf-lib のサブセット化では字が描かれない。`
        + 'subset を渡すこと（design/pdf-engine.md §6.4）',
      );
    }
    const bytes = options.subset ? options.subset(source.bytes, used) : source.bytes;
    embedded[style] = await pdf.embedFont(bytes, { subset: !options.subset });
  }

  if (plan.title) pdf.setTitle(plan.title);
  if (plan.subject) pdf.setSubject(plan.subject);
  pdf.setCreator('DocPresenter');
  pdf.setProducer('DocPresenter');
  // The commit the artifact was built from, so a printed page can be traced
  // back to the source it came from.
  if (plan.commit) pdf.setKeywords([`commit:${plan.commit}`]);

  for (const page of plan.pages) {
    const sheet = pdf.addPage([plan.width, plan.height]);
    for (const item of page.items) await draw(pdf, sheet, item, plan.height, embedded);
  }

  return { bytes: await pdf.save(), missing };
}

async function draw(
  pdf: PDFDocument, page: PDFPage, item: Item, height: number,
  fonts: Record<string, PDFFont>,
): Promise<void> {
  switch (item.kind) {
    case 'text': {
      const font = fonts[item.mono ? 'mono' : item.bold ? 'bold' : 'regular'] ?? fonts['regular']!;
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
