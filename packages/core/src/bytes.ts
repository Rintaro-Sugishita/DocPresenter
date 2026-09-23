// Byte offsets are the anchor currency of this system: review comments, source
// maps and diffs all speak UTF-8 byte ranges, so the conversion lives in one
// place rather than being repeated per package.

const encoder = new TextEncoder();

export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/** Byte offset of a character index within `text`. */
export function byteOffsetOf(text: string, charIndex: number): number {
  return byteLength(text.slice(0, charIndex));
}
