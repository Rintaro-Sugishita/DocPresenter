// Cutting a font down to the characters a document actually uses.
//
// A Japanese font is 4 to 24 MB and a design document uses a few hundred of
// its characters, so a PDF that embeds the whole of one is a PDF nobody wants
// to send. Subsetting is not an optimisation here; it is what makes embedding
// possible at all.
//
// pdf-lib has a subsetter of its own and it cannot be used for the fonts this
// product ships. Noto Sans CJK holds its outlines in a `CFF ` table, and what
// comes out of that subsetter is a font whose text extracts perfectly and
// whose glyphs draw nothing at all — a blank PDF that passes every check that
// reads the text back (prototype/pdf-text/FINDINGS.md). So the cutting is done
// by HarfBuzz, compiled to WebAssembly, which is the same code that does it in
// every browser and in fontTools' competitors.
//
// The module holds no file access: the caller hands over the WebAssembly, the
// same way it hands over the fonts.

import { LocalizedError } from '@docpresenter/base';
import type { Subsetter } from './fonts.js';
import { pdf } from './messages.js';

/** What HarfBuzz's subsetter exports. Only what is used is named. */
interface Harfbuzz {
  readonly memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(pointer: number): void;
  hb_blob_create(data: number, length: number, mode: number, userData: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, length: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, code: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_input_set(input: number, which: number): number;
  hb_subset_or_fail(face: number, input: number): number;
}

/** The blob owns the memory it was given and frees it with the blob. */
const WRITABLE = 2;
/** `hb_subset_sets_t`: the set of table tags to leave out. */
const DROP_TABLES = 3;

/**
 * The shaping tables, which this pipeline must not keep.
 *
 * The browser has already broken the lines and decided the spacing; the PDF
 * writer places runs where the browser put them. If the embedded font keeps its
 * layout tables, the PDF library shapes the text again on the way in and
 * substitutes glyphs — Noto CJK swaps the Latin digits for variants of their
 * own — and those substituted glyphs are not the ones the library's character
 * map covers. The result is a PDF that looks right and whose digits extract as
 * control characters: `SD-AUTH-001` comes back as `SD-AUTH-\x13\x13\x14`.
 *
 * Dropping the tables makes the mapping from character to glyph the only one
 * there is, which is what a pipeline that shapes elsewhere wants. It also makes
 * the subset several times smaller.
 */
const SHAPING = ['GSUB', 'GPOS', 'GDEF'];

function tagOf(name: string): number {
  return ((name.charCodeAt(0) << 24) | (name.charCodeAt(1) << 16)
    | (name.charCodeAt(2) << 8) | name.charCodeAt(3)) >>> 0;
}

export class SubsetError extends LocalizedError {}

/**
 * Builds a subsetter from HarfBuzz's WebAssembly.
 *
 * Asynchronous because compiling half a megabyte of WebAssembly synchronously
 * is refused on a browser's main thread, and this has to run in a browser as
 * well as in Node.
 */
export async function createSubsetter(wasm: BufferSource): Promise<Subsetter> {
  const { instance } = await WebAssembly.instantiate(wasm, {});
  const hb = instance.exports as unknown as Harfbuzz;

  return (bytes: Uint8Array, codePoints: ReadonlySet<number>, faceIndex = 0): Uint8Array => {
    const fontPointer = hb.malloc(bytes.byteLength);
    if (fontPointer === 0) throw new SubsetError(pdf('pdf.subset.memory'));
    // The heap is re-read after every allocation: growing it detaches the old
    // view, and writing through a detached view silently does nothing.
    new Uint8Array(hb.memory.buffer, fontPointer, bytes.byteLength).set(bytes);

    // A blob created WRITABLE borrows the memory; it does not take it over. So
    // the block is freed here, and it has to be freed — a 20 MB font per face
    // exhausts the heap by the third one, and what comes back then is not an
    // error about memory but a subsetter that simply fails.
    let blob = 0;
    let face = 0;
    let input = 0;
    let subset = 0;
    let result = 0;
    try {
      blob = hb.hb_blob_create(fontPointer, bytes.byteLength, WRITABLE, 0, 0);
      face = hb.hb_face_create(blob, faceIndex);
      input = hb.hb_subset_input_create_or_fail();
      if (input === 0) throw new SubsetError(pdf('pdf.subset.input'));

      const unicodes = hb.hb_subset_input_unicode_set(input);
      for (const codePoint of codePoints) hb.hb_set_add(unicodes, codePoint);

      const dropped = hb.hb_subset_input_set(input, DROP_TABLES);
      for (const table of SHAPING) hb.hb_set_add(dropped, tagOf(table));

      subset = hb.hb_subset_or_fail(face, input);
      if (subset === 0) {
        throw new SubsetError(pdf('pdf.subset.failed'));
      }

      result = hb.hb_face_reference_blob(subset);
      const length = hb.hb_blob_get_length(result);
      const data = hb.hb_blob_get_data(result, 0);
      const out = new Uint8Array(length);
      out.set(new Uint8Array(hb.memory.buffer, data, length));
      return out;
    } finally {
      if (result !== 0) hb.hb_blob_destroy(result);
      if (subset !== 0) hb.hb_face_destroy(subset);
      if (input !== 0) hb.hb_subset_input_destroy(input);
      if (face !== 0) hb.hb_face_destroy(face);
      if (blob !== 0) hb.hb_blob_destroy(blob);
      hb.free(fontPointer);
    }
  };
}
