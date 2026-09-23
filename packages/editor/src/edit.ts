// Every change the editor makes is one byte-range replacement. Nothing is
// re-serialised from the model, so whatever the author wrote outside the range
// — their spacing, their line breaks, their comments — survives untouched, and
// the diff shows the edit and nothing else.

import { replaceBytes, type ByteSpan } from '@docpresenter/core';

export interface Edit {
  /** The bytes to replace. An empty range inserts. */
  readonly span: ByteSpan;
  readonly text: string;
  /** What the author asked for, for the undo stack and the commit message. */
  readonly description: string;
}

export function applyEdit(source: string, edit: Edit): string {
  return replaceBytes(source, edit.span.start, edit.span.end, edit.text);
}

export function applyEdits(source: string, edits: readonly Edit[]): string {
  return edits.reduce(applyEdit, source);
}
