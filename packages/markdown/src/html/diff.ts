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

export interface TableMarks {
  /** Keyed `row/column` by the texts that name them, as a selector does. */
  readonly cells: ReadonlyMap<string, Change>;
  /** Rows added or removed whole, by the text of their leading cell. */
  readonly rows: ReadonlyMap<string, Change>;
}

export interface DiagramMarks {
  readonly nodes: ReadonlyMap<string, Change>;
  /** Keyed `from->to`. */
  readonly edges: ReadonlyMap<string, Change>;
}

export interface DiffMarks {
  readonly ranges: readonly RangeMark[];
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
