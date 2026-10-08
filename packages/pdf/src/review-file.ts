// Comments read off a PDF, written into a review file.
//
// A review file (`reviews/*.review.yml`) is the 指摘管理表: one round of review,
// one comment per entry, and an engineer's answer beside each. It is only ever
// added to (design/review-model.md §3): a new import appends entries after the
// last one, and nothing already in the file is rewritten — not its comments,
// not its spacing, not the answers somebody typed into it.
//
// The YAML is written by hand rather than through a serializer for the same
// reason: a serializer would re-emit the whole file, and the diff of an import
// should be the comments it added.

import { LocalizedError } from '@docpresenter/base';
import { pdf as says } from './messages.js';
import type { ResolvedAnnotation } from './review-anchor.js';

export interface ReviewRound {
  /** What the round is called, for a new file. */
  readonly round: string;
  /** The PDF the comments came from, as a workspace path or a file name. */
  readonly pdf: string;
  /** The document the reviewer was reading. */
  readonly document: string;
  /** The review file, for the message when it cannot be appended to. */
  readonly path?: string | undefined;
  readonly commit?: string | undefined;
  /** False when the PDF was built from changes that were not committed. */
  readonly clean?: boolean | undefined;
}

export interface ReviewAppend {
  /** The whole file after the import. */
  readonly text: string;
  /** How many comments were added. */
  readonly added: number;
  /** Annotations already in the file from an earlier import, left out. */
  readonly skipped: number;
}

/**
 * Appends the comments to a review file, or starts one. Replies go under the
 * comment they answer; an annotation imported before (the same PDF and the
 * same annotation) is not added twice.
 */
export function appendReview(
  existing: string | undefined, resolved: readonly ResolvedAnnotation[], round: ReviewRound,
): ReviewAppend {
  const before = existing ?? '';
  if (existing !== undefined && !endsInComments(existing)) {
    throw new LocalizedError(says('pdf.review.notLast', { path: round.path ?? '' }));
  }
  const seen = new Set([...before.matchAll(/^\s*annotation:\s*("(?:[^"\\]|\\.)*"|\S+)/gm)]
    .map(found => found[1]!.startsWith('"') ? JSON.parse(found[1]!) as string : found[1]!));
  let id = Math.max(0, ...[...before.matchAll(/^\s*-\s*id:\s*(\d+)/gm)].map(found => Number(found[1])));

  const top = resolved.filter(one => !one.annotation.replyTo || !resolved.some(other => other.annotation.key === one.annotation.replyTo));
  const repliesTo = (key: string): ResolvedAnnotation[] => resolved.filter(one => one.annotation.replyTo === key);

  const entries: string[] = [];
  let skipped = 0;
  for (const one of top) {
    if (seen.has(one.annotation.key)) { skipped += 1; continue; }
    id += 1;
    entries.push(entry(id, one, repliesTo(one.annotation.key), round));
  }

  if (entries.length === 0) return { text: before, added: 0, skipped };
  const head = existing === undefined ? header(round) : '';
  const joint = existing === undefined ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  return { text: `${before}${joint}${head}${entries.join('\n')}`, added: entries.length, skipped };
}

function header(round: ReviewRound): string {
  return [
    `# ${round.round}。PDF の注釈から取り込んだ指摘（指摘管理表）。`,
    '# 取り込んだ行は書き換えない。回答は reply:、対応状況は status:（open / resolved / wontfix / question）に書く。',
    `round: ${q(round.round)}`,
    'via:   pdf',
    '',
    'comments:',
    '',
  ].join('\n');
}

function entry(id: number, one: ResolvedAnnotation, replies: readonly ResolvedAnnotation[], round: ReviewRound): string {
  const { annotation, anchor } = one;
  const lines = [`  - id: ${id}`, '    anchor:'];
  if (round.commit) lines.push(`      commit: ${round.commit}`);
  // The ranges are in the files as they were built. A build from changes that
  // were not committed is not that commit, and saying so is the honest answer.
  if (round.clean === false) lines.push('      uncommitted: true');
  if (anchor) {
    lines.push(
      `      file:   ${anchor.file}`,
      `      start:  ${anchor.start}`,
      `      end:    ${anchor.end}`,
      `      quote:  ${q(anchor.quote)}`,
    );
  } else {
    // Nothing on the page under it was printed from a file. Kept, and said to
    // be orphaned, so a build can warn about it rather than it being lost.
    lines.push(`      page:   ${annotation.page}`, `      rect:   [${[annotation.rect.x, annotation.rect.y, annotation.rect.w, annotation.rect.h].map(n => Math.round(n)).join(', ')}]`);
  }
  lines.push('    context:', `      document: ${round.document}`);
  lines.push(`    body:   ${q(annotation.body)}`);
  if (one.marked && (!anchor || one.precision !== 'text')) lines.push(`    marked: ${q(one.marked)}`);
  lines.push(`    status: ${anchor ? 'open' : 'orphaned'}`);
  if (annotation.author) lines.push(`    author: ${q(annotation.author)}`);
  if (annotation.date) lines.push(`    date:   ${q(annotation.date)}`);
  lines.push(
    '    source:',
    `      pdf:        ${q(round.pdf)}`,
    `      page:       ${annotation.page}`,
    `      kind:       ${annotation.kind}`,
    `      precision:  ${one.precision}`,
    `      annotation: ${q(annotation.key)}`,
  );
  if (replies.length > 0) {
    lines.push('    replies:');
    for (const reply of replies) {
      lines.push(`      - body:   ${q(reply.annotation.body)}`);
      if (reply.annotation.author) lines.push(`        author: ${q(reply.annotation.author)}`);
      if (reply.annotation.date) lines.push(`        date:   ${q(reply.annotation.date)}`);
      lines.push(`        annotation: ${q(reply.annotation.key)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** A double-quoted YAML scalar. JSON's escapes are YAML's, so JSON writes it. */
function q(text: string): string {
  return JSON.stringify(text);
}

/** Whether the last top-level key is `comments:`, so entries can go after it. */
function endsInComments(text: string): boolean {
  const keys = [...text.matchAll(/^([A-Za-z_][\w-]*):/gm)].map(found => found[1]);
  return keys[keys.length - 1] === 'comments';
}
