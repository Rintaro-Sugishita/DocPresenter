// Line endings, and the byte ranges that must not depend on them.
//
// A review comment is anchored to a commit, a file and a byte range
// (design/review-model.md §3). The same commit checked out on Linux has LF
// line endings and on Windows (core.autocrlf) has CRLF, so the same sentence
// sits at different byte offsets in the two working trees. An anchor measured
// on either one would point somewhere else on the other.
//
// So every range the product speaks — source maps, anchors, edits — is
// measured on the text with its line breaks as LF, which is also what the
// repository stores. A file is turned into that text as it is read, and an
// edit is restated in the file's own terms only as it is written back.

import { byteLength, sliceBytes } from './bytes.js';
import type { ByteSpan } from './span.js';

export type LineEnding = '\n' | '\r\n';

/** How a text ends its lines, decided by its first line break. LF when it has none. */
export function lineEndingOf(text: string): LineEnding {
  const at = text.indexOf('\n');
  return at > 0 && text[at - 1] === '\r' ? '\r\n' : '\n';
}

/** The text the product measures: every CRLF read as LF. */
export function toLf(text: string): string {
  return text.includes('\r\n') ? text.replace(/\r\n/g, '\n') : text;
}

/** The text with every line break written as `ending`. */
export function withLineEnding(text: string, ending: LineEnding): string {
  return text.replace(/\r?\n/g, ending);
}

/**
 * A replacement measured on the LF text, restated for the file as it is.
 *
 * The range moves past each CRLF before it, and the new text takes the file's
 * line ending, so a CRLF file stays CRLF and an LF file stays LF. A range
 * that ends a line ends before the CR, so the CRLF stays whole.
 */
export function spanInFile(
  file: string, change: { readonly span: ByteSpan; readonly text: string },
): { readonly span: ByteSpan; readonly text: string } {
  const text = withLineEnding(change.text, lineEndingOf(file));
  if (!file.includes('\r\n')) return { span: change.span, text };

  const wanted = [change.span.start, change.span.end];
  const found: number[] = [];
  let lf = 0;
  let bytes = 0;
  for (let i = 0; i < file.length && found.length < 2;) {
    while (found.length < 2 && wanted[found.length]! <= lf) found.push(bytes);
    if (file[i] === '\r' && file[i + 1] === '\n') { bytes += 1; i += 1; continue; }
    const code = file.codePointAt(i)!;
    const char = String.fromCodePoint(code);
    const size = byteLength(char);
    lf += size;
    bytes += size;
    i += char.length;
  }
  // A range at (or past) the end of the text ends where the file does.
  while (found.length < 2) found.push(bytes + Math.max(0, wanted[found.length]! - lf));
  return { span: { start: found[0]!, end: found[1]! }, text };
}

/**
 * Past the end of a line: the spaces left after `at` (a byte offset) and the
 * line break, CRLF or LF. Removing a line removes up to here, so a CRLF file
 * is not left with a CR on a line of its own.
 */
export function pastLineBreak(text: string, at: number): number {
  const rest = sliceBytes(text, at, at + 256);
  const found = /^[ \t]*(\r\n|\n)?/.exec(rest)![0];
  return at + byteLength(found);
}
