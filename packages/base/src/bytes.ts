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

/**
 * How many UTF-16 code units come before this byte in the text.
 *
 * Counted by decoding the bytes rather than by arithmetic on code points: a
 * Japanese design document is full of characters that are 3 bytes and 1 unit,
 * and emoji that are 4 bytes and 2 units, and getting that wrong moves every
 * edit after it by a character.
 *
 * A byte offset that lands inside a character is a bug upstream, so it is
 * rounded down to the character that holds it rather than quietly accepted.
 */
export function unitsBefore(text: string, byteOffset: number): number {
  if (byteOffset <= 0) return 0;
  const bytes = new TextEncoder().encode(text);
  const at = Math.min(byteOffset, bytes.length);
  // A continuation byte (10xxxxxx) is not the start of a character.
  let start = at;
  while (start > 0 && (bytes[start]! & 0xc0) === 0x80) start -= 1;
  return new TextDecoder().decode(bytes.subarray(0, start)).length;
}
