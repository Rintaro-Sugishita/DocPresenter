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

const decoder = new TextDecoder();

/** The text in a byte range. Ranges come from anchors, so they are byte-based. */
export function sliceBytes(text: string, start: number, end: number): string {
  return decoder.decode(encoder.encode(text).slice(start, end));
}

/**
 * Replaces a byte range with new text. This is the only way the editor writes:
 * everything outside the range stays byte-for-byte as the author left it, so a
 * diff shows the edit and nothing else.
 */
export function replaceBytes(text: string, start: number, end: number, replacement: string): string {
  const bytes = encoder.encode(text);
  return decoder.decode(bytes.slice(0, start))
    + replacement
    + decoder.decode(bytes.slice(end));
}
