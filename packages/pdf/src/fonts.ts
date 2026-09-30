// Fonts, and the two ways they go wrong.
//
// The first is silent: a font that has no glyph for a character draws a box a
// person can see, but the character disappears from the text layer entirely —
// so it cannot be selected, searched, or used as an anchor for a review
// comment. A name quietly missing from a design document is not acceptable, so
// every code point is checked before anything is written.
//
// The second is worse, because the automated test passes: pdf-lib's own
// subsetter produces a CFF font whose text extracts perfectly and whose glyphs
// do not draw at all. A PDF with no visible Japanese passes any check that
// only reads the text back. So a CFF font is refused here unless the caller
// brings its own subsetter.

import fontkit from '@pdf-lib/fontkit';

/**
 * The faces a document can ask for. They are the theme's three families, with
 * bold as a face of its own: a CJK font has no synthetic bold worth having, so
 * the bold weight is a different file.
 */
export type FontStyle = 'body' | 'bodyBold' | 'heading' | 'headingBold' | 'mono';

export interface FontSource {
  readonly bytes: Uint8Array;
  /** Named in diagnostics, so a missing glyph can be traced to a file. */
  readonly name: string;
  /** Which face of a collection (`.ttc`) this is. */
  readonly faceIndex?: number;
}

export type FontSet = Readonly<Record<FontStyle, FontSource>>;

/** The face a run falls back to when the caller supplied none for it. */
export const FALLBACK: Readonly<Record<FontStyle, FontStyle>> = {
  body: 'body', bodyBold: 'body', heading: 'body', headingBold: 'heading', mono: 'body',
};

/**
 * Cuts a font down to the glyphs actually used. See the file comment, and
 * `subset.ts` for the one this product uses.
 *
 * `faceIndex` picks a face out of a collection (`.ttc`): the Noto CJK fonts
 * ship as one file holding the Japanese, Korean and both Chinese faces.
 */
export type Subsetter = (
  bytes: Uint8Array, codePoints: ReadonlySet<number>, faceIndex?: number,
) => Uint8Array;

export interface FontOptions {
  readonly fonts: FontSet;
  /** Required for a CFF font; ignored for TrueType, which pdf-lib subsets correctly. */
  readonly subset?: Subsetter;
}

/** True when the font's outlines are CFF (`.otf`) rather than TrueType glyf. */
export function isCff(bytes: Uint8Array): boolean {
  return tablesOf(bytes).includes('CFF ');
}

/**
 * The face to read. A collection (`.ttc`) is not a font: it holds several, and
 * the one that is meant is the one the source names by index.
 */
function faceIn(source: FontSource): Readable | undefined {
  const opened = fontkit.create(source.bytes) as Readable & { fonts?: Readable[] };
  if (!opened.fonts) return opened;
  return opened.fonts[source.faceIndex ?? 0];
}

/** The four-character tags of a font's tables. */
export function tablesOf(bytes: Uint8Array): readonly string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12) return [];
  const count = view.getUint16(4);
  const tags: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    if (at + 4 > bytes.byteLength) break;
    tags.push(String.fromCharCode(...bytes.slice(at, at + 4)));
  }
  return tags;
}

export interface MissingGlyph {
  readonly character: string;
  readonly codePoint: number;
  readonly font: string;
}

interface Readable {
  hasGlyphForCodePoint(codePoint: number): boolean;
  glyphForCodePoint?(codePoint: number): { path?: { commands?: readonly unknown[] } } | undefined;
}

/** The characters the font cannot draw. Empty is the only acceptable answer. */
export function missingGlyphs(
  source: FontSource, codePoints: ReadonlySet<number>,
): readonly MissingGlyph[] {
  const font = faceIn(source);
  if (!font) return [];
  const missing: MissingGlyph[] = [];
  for (const codePoint of codePoints) {
    if (codePoint < 0x20) continue;             // a control character draws nothing
    if (font.hasGlyphForCodePoint(codePoint)) continue;
    missing.push({ character: String.fromCodePoint(codePoint), codePoint, font: source.name });
  }
  return missing;
}

/**
 * Whether a cut-down font can actually draw what it was asked to.
 *
 * A subsetter can fail without saying so. Asked for twenty thousand CJK
 * glyphs, HarfBuzz returns a font of the right shape — the tables are there,
 * the character map answers — whose outlines are empty. Embedded, that is the
 * same blank page pdf-lib's own subsetter produces, and the same tests pass.
 * So the result is looked at rather than trusted.
 */
export function drawsGlyphs(
  bytes: Uint8Array, codePoints: ReadonlySet<number>, sample = 8,
): boolean {
  const font = faceIn({ bytes, name: '' });
  if (!font?.glyphForCodePoint) return true;          // cannot tell; do not cry wolf
  let looked = 0;
  for (const codePoint of codePoints) {
    if (codePoint < 0x21) continue;                   // a space draws nothing, correctly
    // A character the font says it does not have is a missing glyph, which is
    // reported elsewhere; what is being looked for here is a character the
    // font claims and cannot draw.
    if (!font.hasGlyphForCodePoint(codePoint)) continue;
    const glyph = font.glyphForCodePoint(codePoint);
    if ((glyph?.path?.commands?.length ?? 0) > 0) return true;
    if (++looked >= sample) return false;
  }
  return true;
}
