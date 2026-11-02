// Every change the editor makes is one byte-range replacement. Nothing is
// re-serialised from the model, so whatever the author wrote outside the range
// — their spacing, their line breaks, their comments — survives untouched, and
// the diff shows the edit and nothing else.

import { replaceBytes } from './bytes.js';
import { lineEndingOf, withLineEnding } from './line-ending.js';
import type { ByteSpan } from './span.js';
import { DEFAULT_LOCALE, say, type Locale, type Phrase } from './i18n.js';

export interface Edit {
  /** The bytes to replace. An empty range inserts. */
  readonly span: ByteSpan;
  readonly text: string;
  /** What the author asked for, for the undo stack and the commit message. */
  readonly description: string;
  /**
   * The description as a phrase, when the code that made the edit had no
   * locale to hand. `description` is its Japanese; the view puts it into the
   * author's language with `localizeEdit` before the edit leaves it.
   */
  readonly phrase?: Phrase | undefined;
  /**
   * The referenced file the range belongs to, relative to the document.
   * Absent means the document itself. A diagram and a table live in their own
   * files, so editing one is a byte range in that file, not in this one.
   */
  readonly path?: string | undefined;
  /**
   * An edit to another file that the same gesture made — the item table's
   * name for a label just renamed on the screen. It is written with this one
   * and taken back with it. Its range is in that file as it stands before.
   */
  readonly also?: Edit | undefined;
}

/**
 * Writes an edit into the text it was measured on.
 *
 * The new text takes the line ending the text already has: an edit is written
 * with LF, and a file of CRLF lines with one LF line in it is a file nobody
 * meant to write.
 */
export function applyEdit(source: string, edit: Edit): string {
  return replaceBytes(source, edit.span.start, edit.span.end,
    withLineEnding(edit.text, lineEndingOf(source)));
}

export function applyEdits(source: string, edits: readonly Edit[]): string {
  return edits.reduce(applyEdit, source);
}

/** A description and the phrase it came from, for code that makes edits. */
export function described(phrase: Phrase): { description: string; phrase: Phrase } {
  return { description: say(DEFAULT_LOCALE, phrase), phrase };
}

/** The edit with its description in the author's language. */
export function localizeEdit<E extends Edit>(edit: E, locale: Locale): E {
  const said = edit.phrase ? { ...edit, description: say(locale, edit.phrase) } : edit;
  return edit.also ? { ...said, also: localizeEdit(edit.also, locale) } : said;
}
