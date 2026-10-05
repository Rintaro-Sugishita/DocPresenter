// Byte ranges, in a world that counts UTF-16 code units.
//
// Every edit in this product is a byte range (design/decisions.md): that is
// what makes an edit a diff anybody can read. VS Code positions are lines and
// UTF-16 offsets. The two meet here, and nowhere else.

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

/** The text's length in bytes, which is what a span is measured against. */
export function byteLengthOf(text: string): number {
  return new TextEncoder().encode(text).length;
}
