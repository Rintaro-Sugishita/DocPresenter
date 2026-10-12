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
import type { Anchor, Precision } from '@docpresenter/base';
import type { ResolvedAnnotation } from './review-anchor.js';

export interface ReviewRound {
  /** What the round is called, for a new file. */
  readonly round: string;
  /** The PDF the comments came from, as a workspace path or a file name. */
  readonly pdf: string;
  /** The document the reviewer was reading. */
  readonly document: string;
  /** Its number, which the comment is tied to as well as to the path. */
  readonly number?: string | undefined;
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

function header(round: { round: string }, via: 'pdf' | 'editor' = 'pdf'): string {
  return [
    via === 'pdf'
      ? `# ${round.round}。PDF の注釈から取り込んだ指摘（指摘管理表）。`
      : `# ${round.round}。DocPresenter の閲覧モードで付けた指摘（指摘管理表）。`,
    '# 書いた行は書き換えない。回答は reply:、対応状況は status:（open / resolved / wontfix / question）に書く。',
    `round: ${q(round.round)}`,
    `via:   ${via}`,
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
  if (round.number) lines.push(`      number:   ${q(round.number)}`);
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

/** A comment made on the screen, on a selection or a block of the document. */
export interface ScreenComment {
  readonly anchor: Anchor;
  readonly precision: Precision;
  readonly body: string;
  /** The document the reviewer was reading. */
  readonly document: string;
  /** Its number, which the comment is tied to as well as to the path. */
  readonly number?: string | undefined;
  readonly author?: string | undefined;
  /** ISO 8601. */
  readonly date: string;
  readonly commit?: string | undefined;
  /** True when the anchored file differs from the commit: the range is in the working copy. */
  readonly uncommitted?: boolean | undefined;
}

/**
 * Appends one comment made on the screen to a review file, or starts one
 * named `round`. As with an import, only the end of the file is written.
 */
export function appendScreenComment(
  existing: string | undefined, comment: ScreenComment, round: string, path = '',
): { text: string; id: number } {
  const before = existing ?? '';
  if (existing !== undefined && !endsInComments(existing)) {
    throw new LocalizedError(says('pdf.review.notLast', { path }));
  }
  const id = 1 + Math.max(0, ...[...before.matchAll(/^\s*-\s*id:\s*(\d+)/gm)].map(found => Number(found[1])));
  const { anchor } = comment;
  const lines = [`  - id: ${id}`, '    anchor:'];
  if (comment.commit) lines.push(`      commit: ${comment.commit}`);
  if (comment.uncommitted) lines.push('      uncommitted: true');
  lines.push(
    `      file:   ${anchor.file}`,
    `      start:  ${anchor.start}`,
    `      end:    ${anchor.end}`,
    `      quote:  ${q(anchor.quote)}`,
    '    context:', `      document: ${comment.document}`,
    ...(comment.number ? [`      number:   ${q(comment.number)}`] : []),
    `    body:   ${q(comment.body)}`,
    '    status: open',
  );
  if (comment.author) lines.push(`    author: ${q(comment.author)}`);
  lines.push(`    date:   ${q(comment.date)}`, '    source:', '      via:        editor', `      precision:  ${comment.precision}`);
  const head = existing === undefined ? header({ round }, 'editor') : '';
  const joint = existing === undefined ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  return { text: `${before}${joint}${head}${lines.join('\n')}\n`, id };
}

/** A reply a customer wrote in the PDF to a comment the PDF carried. */
export interface PdfReply {
  /** The comment's id in its review file. */
  readonly id: number;
  readonly body: string;
  readonly author?: string | undefined;
  readonly date?: string | undefined;
  /** The annotation's key, so the same reply is not taken in twice. */
  readonly key: string;
}

/** What an imported PDF holds, sorted by where each part goes. */
export interface ImportPlan {
  /** New comments: annotations that are not ours and answer nothing of ours. */
  readonly fresh: readonly ResolvedAnnotation[];
  /** Replies to the comments the PDF carried, by the review file each comment is in. */
  readonly replies: ReadonlyMap<string, readonly PdfReply[]>;
  /** How many annotations were ours (the comments and answers the PDF was sent with). */
  readonly ours: number;
}

const OURS = /^dp-review:(.+)#(\d+)(?:\/.*)?$/;

/**
 * Sorts the annotations of a PDF that came back. Ours — the review so far,
 * written into the PDF — are left out. A reply to one of ours belongs to that
 * comment, in that comment's review file. Everything else is a new comment.
 */
export function planImport(
  resolved: readonly ResolvedAnnotation[],
  /** What the PDF's map says was written into each of our annotations. */
  written: readonly { readonly key: string; readonly text: string; readonly author?: string | undefined }[] = [],
): ImportPlan {
  const replies = new Map<string, PdfReply[]>();
  const fresh: ResolvedAnnotation[] = [];
  let ours = 0;
  const add = (round: string, reply: PdfReply): void => { replies.set(round, [...(replies.get(round) ?? []), reply]); };
  const wrote = new Map(written.map(one => [one.key, one]));
  for (const one of resolved) {
    const mine = OURS.exec(one.annotation.key);
    if (mine) {
      ours += 1;
      // Written on below what we wrote — the way to answer in a viewer that
      // does not thread replies. What was added is the reply.
      const was = wrote.get(one.annotation.key);
      const added = was === undefined ? undefined : addedTo(was.text, one.annotation.body);
      if (added) {
        add(mine[1]!, {
          id: Number(mine[2]), body: added, key: `${one.annotation.key}/added-${shortHash(added)}`,
          ...(one.annotation.author && one.annotation.author !== was!.author ? { author: one.annotation.author } : {}),
          ...(one.annotation.date ? { date: one.annotation.date } : {}),
        });
      }
      continue;
    }
    const to = one.annotation.replyTo === undefined ? undefined : OURS.exec(one.annotation.replyTo);
    if (to) {
      add(to[1]!, {
        id: Number(to[2]), body: one.annotation.body, key: one.annotation.key,
        ...(one.annotation.author ? { author: one.annotation.author } : {}),
        ...(one.annotation.date ? { date: one.annotation.date } : {}),
      });
      continue;
    }
    fresh.push(one);
  }
  return { fresh, replies, ours };
}

/**
 * What a reader added to the text we wrote: what follows it when they wrote
 * on below, or their whole text when they changed ours. Nothing when the text
 * is as we wrote it (line breaks and surrounding space aside).
 */
function addedTo(wrote: string, now: string): string | undefined {
  const flat = (text: string): string => text.replace(/\r\n?/g, '\n').trim();
  const before = flat(wrote);
  const after = flat(now);
  if (after === before || after === '') return undefined;
  if (after.startsWith(before)) return after.slice(before.length).trim() || undefined;
  return after;
}

function shortHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/**
 * Puts replies under the comments they answer, in a review file. Lines are
 * only inserted — under the comment's `replies:`, made when it has none —
 * and nothing written before is changed. A reply taken in before is skipped,
 * and so is one to a comment the file does not have.
 */
export function appendReplies(
  existing: string, replies: readonly PdfReply[],
): { text: string; added: number; skipped: number } {
  const seen = new Set([...existing.matchAll(/^\s*annotation:\s*("(?:[^"\\]|\\.)*"|\S+)/gm)]
    .map(found => found[1]!.startsWith('"') ? JSON.parse(found[1]!) as string : found[1]!));
  const lines = existing.split('\n');
  let added = 0;
  let skipped = 0;
  for (const reply of replies) {
    if (seen.has(reply.key)) { skipped += 1; continue; }
    const start = lines.findIndex(line => new RegExp(`^\\s*-\\s*id:\\s*${reply.id}\\s*$`).test(line));
    if (start < 0) { skipped += 1; continue; }
    // The entry runs to the next entry, the next top-level key, or the end.
    let end = start + 1;
    while (end < lines.length && !/^\s*-\s*id:/.test(lines[end]!) && !/^\S/.test(lines[end]!)) end += 1;
    while (end > start + 1 && lines[end - 1]!.trim() === '') end -= 1;
    const item = [
      `      - body:   ${q(reply.body)}`,
      ...(reply.author ? [`        author: ${q(reply.author)}`] : []),
      ...(reply.date ? [`        date:   ${q(reply.date)}`] : []),
      `        annotation: ${q(reply.key)}`,
    ];
    const list = lines.slice(start, end).findIndex(line => /^\s*replies:\s*$/.test(line));
    if (list >= 0) {
      // After the last line of the list: the lines indented under it.
      let at = start + list + 1;
      while (at < end && /^ {6,}\S/.test(lines[at]!)) at += 1;
      lines.splice(at, 0, ...item);
    } else {
      lines.splice(end, 0, '    replies:', ...item);
    }
    seen.add(reply.key);
    added += 1;
  }
  return { text: lines.join('\n'), added, skipped };
}

/** What an engineer sets on a comment: its state, and the answer to it. */
export interface ReviewEntryUpdate {
  readonly status?: string | undefined;
  /** The answer. An empty one takes the answer off. */
  readonly reply?: string | undefined;
}

/**
 * Sets a comment's `status:` and `reply:` — the two lines of a review file
 * that are an engineer's to write (design/review-model.md §8). Only those
 * lines change: the comment, its anchor and everything around it stay as they
 * are. A line that is not there yet is added at the end of the comment. An
 * answer written over several lines (`reply: |`) is replaced whole.
 *
 * Returns undefined when the file has no comment with that id.
 */
export function updateReviewEntry(existing: string, id: number, update: ReviewEntryUpdate): string | undefined {
  const lines = existing.split('\n');
  const start = lines.findIndex(line => new RegExp(`^\\s*-\\s*id:\\s*${id}\\s*$`).test(line));
  if (start < 0) return undefined;
  const indent = /^(\s*)-/.exec(lines[start]!)![1]!.length + 2;
  const pad = ' '.repeat(indent);
  const field = new RegExp(`^ {${indent}}([A-Za-z_][\\w-]*):`);
  /** The comment's lines run to the next comment, the next top-level key, or the end. */
  const endOf = (): number => {
    let end = start + 1;
    while (end < lines.length && !/^\s*-\s*id:/.test(lines[end]!) && !/^\S/.test(lines[end]!)) end += 1;
    while (end > start + 1 && lines[end - 1]!.trim() === '') end -= 1;
    return end;
  };
  /** Where a field of the comment is, and how many lines its value takes. */
  const find = (name: string): { at: number; count: number } | undefined => {
    const end = endOf();
    for (let at = start + 1; at < end; at += 1) {
      if (field.exec(lines[at]!)?.[1] !== name) continue;
      // A block value (`|`, `>`) or a nested map goes on in the lines indented further.
      let count = 1;
      while (at + count < end && (lines[at + count]!.trim() === '' || new RegExp(`^ {${indent + 1},}\\S`).test(lines[at + count]!))
        && !field.test(lines[at + count]!)) count += 1;
      while (count > 1 && lines[at + count - 1]!.trim() === '') count -= 1;
      return { at, count };
    }
    return undefined;
  };
  const set = (name: string, value: string | undefined, after?: string): void => {
    const now = find(name);
    if (value === undefined) {
      if (now) lines.splice(now.at, now.count);
      return;
    }
    const written = `${pad}${name}: ${name === 'status' ? value : q(value)}`;
    if (now) { lines.splice(now.at, now.count, written); return; }
    const anchor = after === undefined ? undefined : find(after);
    lines.splice(anchor ? anchor.at + anchor.count : endOf(), 0, written);
  };
  if (update.status !== undefined) set('status', update.status, 'body');
  if (update.reply !== undefined) set('reply', update.reply.trim() === '' ? undefined : update.reply, 'status');
  return lines.join('\n');
}
