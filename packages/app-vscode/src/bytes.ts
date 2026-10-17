// Byte ranges, in a world that counts UTF-16 code units.
//
// Every edit in this product is a byte range (design/decisions.md): that is
// what makes an edit a diff anybody can read. VS Code positions are lines and
// UTF-16 offsets; the conversion lives in @docpresenter/base, shared with the
// diagram extension.

export { unitsBefore } from '@docpresenter/base';

/** The text's length in bytes, which is what a span is measured against. */
export function byteLengthOf(text: string): number {
  return new TextEncoder().encode(text).length;
}
