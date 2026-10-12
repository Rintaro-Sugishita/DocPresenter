// Document numbers: `document: SD-AUTH-001` in a document's frontmatter.
//
// A number is what a design document is called by — on its cover, in a
// meeting, in a review file. It outlives a file name, so review comments are
// tied to it as well as to the path, and two documents of a repository must
// never share one.
//
// A repository already has its own scheme, and this does not impose another:
// a number is a series (everything before its last run of digits) and a
// count, and the next number of a series is one more than the highest there,
// written as wide as the widest. A repository with no numbers yet starts at
// `DOC-001`.

import { parseDocument } from './parse.js';

export interface NumberSeries {
  /** Everything before the count: `SD-AUTH-`. */
  readonly prefix: string;
  /** The next free number of the series. */
  readonly next: string;
  /** How many documents are in it. */
  readonly count: number;
}

/** The series a repository's numbers fall into, the largest first. */
export function numberSeries(numbers: readonly string[]): NumberSeries[] {
  const series = new Map<string, { highest: number; width: number; count: number }>();
  for (const number of numbers) {
    const found = /^(.*?)(\d+)$/.exec(number.trim());
    if (!found) continue;
    const [, prefix, digits] = found;
    const now = series.get(prefix!) ?? { highest: -1, width: 0, count: 0 };
    series.set(prefix!, {
      highest: Math.max(now.highest, Number(digits)), width: Math.max(now.width, digits!.length), count: now.count + 1,
    });
  }
  return [...series].map(([prefix, { highest, width, count }]) => ({
    prefix, count, next: `${prefix}${String(highest + 1).padStart(width, '0')}`,
  })).sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix));
}

/** The first number of a new series: `SD-PAY-` → `SD-PAY-001`. */
export function firstNumber(prefix: string, width = 3): string {
  return `${prefix}${'1'.padStart(width, '0')}`;
}

/** The number a repository should give its next document, in its largest series. */
export function suggestNumber(numbers: readonly string[]): string {
  return numberSeries(numbers)[0]?.next ?? firstNumber('DOC-');
}

/** A document's number, from its frontmatter, or undefined. */
export function documentNumberOf(source: string): string | undefined {
  try {
    const value = parseDocument(source).frontmatter.raw['document'];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
  } catch {
    return undefined;
  }
}

/** Numbers used by more than one document, with the documents that use them. */
export function duplicateNumbers(documents: readonly { path: string; number?: string | undefined }[]): Map<string, string[]> {
  const byNumber = new Map<string, string[]>();
  for (const { path, number } of documents) {
    if (!number) continue;
    byNumber.set(number, [...(byNumber.get(number) ?? []), path]);
  }
  return new Map([...byNumber].filter(([, paths]) => paths.length > 1));
}
