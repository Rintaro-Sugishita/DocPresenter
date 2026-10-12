// The faces a PDF is written in, from the reader's own computer.
//
// The page ships no Japanese font: one is megabytes, and every reader's PC has
// one already (design/web-viewer.md §2.6). A browser hands them over through
// local font access (`queryLocalFonts`, Chrome and Edge); elsewhere the page
// says the PDF cannot be made here rather than writing one with boxes in it.

import fontkit from '@pdf-lib/fontkit';
import type { FontSet, FontSource } from '@docpresenter/pdf';
import { ViewerError } from './github.js';

/** What `queryLocalFonts` hands back, as far as this file needs it. */
export interface LocalFont {
  readonly postscriptName: string;
  readonly family: string;
  blob(): Promise<Blob>;
}

/** Body faces, best first, each with the bold that goes with it. Same list as the extension's. */
const BODY: readonly { regular: string; bold: readonly string[] }[] = [
  { regular: 'YuGothic-Regular', bold: ['YuGothic-Bold'] },
  { regular: 'YuGothic-Medium', bold: ['YuGothic-Bold'] },
  { regular: 'Meiryo', bold: ['Meiryo-Bold'] },
  { regular: 'HiraginoSans-W3', bold: ['HiraginoSans-W6'] },
  { regular: 'HiraKakuProN-W3', bold: ['HiraKakuProN-W6'] },
  { regular: 'NotoSansCJKjp-Regular', bold: ['NotoSansCJKjp-Bold'] },
  { regular: 'NotoSansJP-Regular', bold: ['NotoSansJP-Bold'] },
  { regular: 'IPAPGothic', bold: [] },
  { regular: 'MS-PGothic', bold: [] },
];

/** Monospaced faces for code. */
const MONO: readonly string[] = ['MS-Gothic', 'NotoSansMonoCJKjp-Regular', 'Osaka-Mono', 'IPAGothic'];

/** The faces chosen, by PostScript name, before any bytes are read. */
export interface Choice {
  readonly body: LocalFont;
  readonly bold: LocalFont;
  readonly mono: LocalFont;
}

/** Picks the faces from what the computer has. Undefined when it has no Japanese face. */
export function chooseFaces(fonts: readonly LocalFont[]): Choice | undefined {
  const named = new Map(fonts.map(font => [font.postscriptName, font]));
  for (const candidate of BODY) {
    const body = named.get(candidate.regular);
    if (!body) continue;
    const bold = candidate.bold.map(name => named.get(name)).find(found => found !== undefined) ?? body;
    const mono = MONO.map(name => named.get(name)).find(found => found !== undefined) ?? body;
    return { body, bold, mono };
  }
  return undefined;
}

/** The family each style is laid out in, so the page and the PDF use one face. */
export interface LocalFonts {
  readonly set: FontSet;
  readonly families: { readonly body: string; readonly mono: string };
  /** For the report. */
  readonly name: string;
}

/** Reads the chosen faces off this computer. Throws a ViewerError when it cannot. */
export async function localFonts(win: Window): Promise<LocalFonts> {
  const query = (win as Window & { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts;
  if (typeof query !== 'function') throw new ViewerError('web.pdf.noFontAccess');
  let fonts: LocalFont[];
  try {
    fonts = await query.call(win);
  } catch (error) {
    throw new ViewerError('web.pdf.fontDenied', {}, error);
  }
  // Asked and refused can also come back as an empty list.
  if (fonts.length === 0) throw new ViewerError('web.pdf.fontDenied');
  const choice = chooseFaces(fonts);
  if (!choice) throw new ViewerError('web.pdf.noFont');

  const read = new Map<string, Promise<FontSource>>();
  const source = (font: LocalFont): Promise<FontSource> => {
    let found = read.get(font.postscriptName);
    if (!found) {
      found = font.blob().then(async blob => sourceOf(new Uint8Array(await blob.arrayBuffer()), font.postscriptName));
      read.set(font.postscriptName, found);
    }
    return found;
  };
  const [body, bold, mono] = await Promise.all([source(choice.body), source(choice.bold), source(choice.mono)]);
  return {
    set: { body, bodyBold: bold, heading: body, headingBold: bold, mono },
    families: { body: choice.body.family, mono: choice.mono.family },
    name: choice.mono === choice.body ? choice.body.postscriptName
      : `${choice.body.postscriptName} ＋ ${choice.mono.postscriptName}`,
  };
}

/**
 * A face as the PDF writer wants it. A collection (`.ttc`) holds several faces,
 * and the browser hands over the whole file: the one meant is found by name.
 */
export function sourceOf(bytes: Uint8Array, postscriptName: string): FontSource {
  const opened = fontkit.create(bytes) as { fonts?: { postscriptName?: string }[] };
  if (!opened.fonts) return { bytes, name: postscriptName };
  const index = opened.fonts.findIndex(face => face.postscriptName === postscriptName);
  return { bytes, name: postscriptName, faceIndex: Math.max(index, 0) };
}
