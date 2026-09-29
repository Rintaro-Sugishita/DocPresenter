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

export type FontStyle = 'regular' | 'bold' | 'mono';

export interface FontSource {
  readonly bytes: Uint8Array;
  /** Named in diagnostics, so a missing glyph can be traced to a file. */
  readonly name: string;
}

export type FontSet = Readonly<Record<FontStyle, FontSource>>;

/** Cuts a font down to the glyphs actually used. See the file comment. */
export type Subsetter = (bytes: Uint8Array, codePoints: ReadonlySet<number>) => Uint8Array;

export interface FontOptions {
  readonly fonts: FontSet;
  /** Required for a CFF font; ignored for TrueType, which pdf-lib subsets correctly. */
  readonly subset?: Subsetter;
}

/** True when the font's outlines are CFF (`.otf`) rather than TrueType glyf. */
export function isCff(bytes: Uint8Array): boolean {
  return tablesOf(bytes).includes('CFF ');
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

/** The characters the font cannot draw. Empty is the only acceptable answer. */
export function missingGlyphs(
  source: FontSource, codePoints: ReadonlySet<number>,
): readonly MissingGlyph[] {
  const font = fontkit.create(source.bytes) as {
    hasGlyphForCodePoint(codePoint: number): boolean;
  };
  const missing: MissingGlyph[] = [];
  for (const codePoint of codePoints) {
    if (codePoint < 0x20) continue;             // a control character draws nothing
    if (font.hasGlyphForCodePoint(codePoint)) continue;
    missing.push({ character: String.fromCodePoint(codePoint), codePoint, font: source.name });
  }
  return missing;
}
