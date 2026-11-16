// What a build was told has changed, and how it says so.
//
// The marks are computed elsewhere — from Git, or from another folder — and
// arrive here as ranges and ids. Nothing about them is stored in a file: the
// whole point of marking changes from the repository is that nobody has to
// remember to paint them, or to scrub them off afterwards.

import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';
import { MARKDOWN_MESSAGES } from '../messages.js';

export type Change = 'added' | 'removed' | 'changed';

/** A stretch of one source file that changed. */
export interface RangeMark {
  /** The file, as the build named it. Empty for the root document. */
  readonly doc: string;
  readonly start: number;
  readonly end: number;
  readonly change: Change;
}

/**
 * Lines of one source file that are gone: what they said, and where in the
 * file as it is now they used to be. Lines that were replaced are gone too, and
 * sit where their replacement starts.
 */
export interface RemovedText {
  readonly doc: string;
  /** The byte offset, in the file as it is now, the lines stood before. */
  readonly at: number;
  /** The lines as they were written, Markdown and all. */
  readonly text: string;
}

/** A row that is gone, with what it said under each column the table has now. */
export interface RemovedRow {
  /** The index, in the table as it is now, of the row it stood above; the row count when it was last. */
  readonly before: number;
  readonly cells: readonly string[];
}

export interface TableMarks {
  /** Keyed `row/column` by their indexes in the table as it is now. */
  readonly cells: ReadonlyMap<string, Change>;
  /** Rows added whole, by their index in the table as it is now. */
  readonly rows: ReadonlyMap<number, Change>;
  /** What a changed cell said before, keyed as `cells` is. */
  readonly was?: ReadonlyMap<string, string>;
  readonly removedRows?: readonly RemovedRow[];
  /** Columns that are gone, by their headers. */
  readonly removedColumns?: readonly string[];
}

export interface DiagramMarks {
  readonly nodes: ReadonlyMap<string, Change>;
  /** Keyed `from->to`. */
  readonly edges: ReadonlyMap<string, Change>;
  /** Shapes and connections that are gone, as their words: a drawing has no place left to put them. */
  readonly removed?: { readonly nodes: readonly string[]; readonly edges: readonly string[] };
}

export interface DiffMarks {
  readonly ranges: readonly RangeMark[];
  /** What is gone from the prose, drawn struck through when `showRemoved` asks. */
  readonly removed?: readonly RemovedText[];
  readonly tables: ReadonlyMap<string, TableMarks>;
  readonly diagrams: ReadonlyMap<string, DiagramMarks>;
  /** What to do with something that is gone: leave it out, or strike it through. */
  readonly showRemoved: 'none' | 'strike';
  /** What the marks are relative to, for the legend. */
  readonly from: string;
}

/** The mark covering a block, if any. A block is marked as a whole. */
export function markOf(
  marks: DiffMarks | undefined, doc: string | undefined,
  span: { readonly start: number; readonly end: number },
): Change | undefined {
  if (!marks) return undefined;
  let found: Change | undefined;
  for (const range of marks.ranges) {
    if (range.doc !== (doc ?? '')) continue;
    if (range.end <= span.start || range.start >= span.end) continue;
    if (range.change === 'changed') return 'changed';
    // A block that gained and lost lines is changed, not both.
    found = found === undefined || found === range.change ? range.change : 'changed';
  }
  return found;
}

/** `class="… dp-diff-added"`, or nothing. */
export function markClass(change: Change | undefined): string {
  return change === undefined ? '' : ` dp-diff-${change}`;
}

/** The legend. Written by the build, not by the author. */
export function legend(marks: DiffMarks, locale: Locale = DEFAULT_LOCALE): string {
  const t = MARKDOWN_MESSAGES.in(locale);
  const rows: [Change, string][] = [
    ['added', t('markdown.diff.added')], ['changed', t('markdown.diff.changed')],
  ];
  if (marks.showRemoved === 'strike') rows.push(['removed', t('markdown.diff.removed')]);
  return `<aside class="dp-diff-legend">`
    + `<span class="dp-diff-from">${escape(t('markdown.diff.from', { from: marks.from }))}</span>`
    + rows.map(([change, label]) =>
      `<span class="dp-diff-key dp-diff-${change}">${label}</span>`).join('')
    + `</aside>`;
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
