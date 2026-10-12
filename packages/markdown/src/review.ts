// Reading a review file (`reviews/*.review.yml`), the 指摘管理表.
//
// The file is written by people as much as by the tool — an engineer types
// `reply:` and `status:` into it — so it is read forgivingly: an entry missing
// a field is still a comment, and one this reader cannot make sense of is
// skipped rather than taking the file down with it.

import { parse as parseYaml } from 'yaml';

export interface StoredComment {
  /** The review file it is in, as a workspace path. */
  readonly round: string;
  readonly id: number;
  /** The anchor (design/review-model.md §3). Absent for one that never had a place. */
  readonly file?: string | undefined;
  readonly start?: number | undefined;
  readonly end?: number | undefined;
  readonly quote?: string | undefined;
  readonly commit?: string | undefined;
  readonly uncommitted?: boolean | undefined;
  /** The document the reviewer was reading (§3.5): comments show only there. */
  readonly document?: string | undefined;
  /** Its number: the comment follows the document even when its file is moved. */
  readonly number?: string | undefined;
  readonly body: string;
  /** `open`, `resolved`, `wontfix`, `question`, `orphaned`… */
  readonly status: string;
  readonly reply?: string | undefined;
  readonly author?: string | undefined;
  readonly date?: string | undefined;
  readonly replies: readonly { readonly body: string; readonly author?: string | undefined; readonly date?: string | undefined }[];
}

/**
 * Whether a comment is about a document: made on it by path, or by number —
 * a document renamed or moved since keeps its number, and its comments.
 */
export function isAbout(comment: Pick<StoredComment, 'document' | 'number'>, path: string, number?: string): boolean {
  return comment.document === path || (number !== undefined && number !== '' && comment.number === number);
}

/**
 * The file a comment's words are in now. A comment on the document's own text
 * names the document's path as it was; when the document has moved since (and
 * was found by its number), its words are in the document where it is now.
 */
export function anchorFileOf(comment: Pick<StoredComment, 'file' | 'document'>, path: string): string | undefined {
  return comment.file !== undefined && comment.file === comment.document ? path : comment.file;
}

/** The comments in a review file, in the order they were written. */
export function parseReviewFile(text: string, round: string): StoredComment[] {
  let data: unknown;
  try { data = parseYaml(text); } catch { return []; }
  const comments = (data as { comments?: unknown } | null)?.comments;
  if (!Array.isArray(comments)) return [];
  const str = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
  const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

  return comments.flatMap((raw: unknown, index): StoredComment[] => {
    if (!raw || typeof raw !== 'object') return [];
    const entry = raw as Record<string, unknown>;
    const anchor = (entry['anchor'] ?? {}) as Record<string, unknown>;
    const context = (entry['context'] ?? {}) as Record<string, unknown>;
    const replies = Array.isArray(entry['replies']) ? entry['replies'] as Record<string, unknown>[] : [];
    return [{
      round,
      id: num(entry['id']) ?? index + 1,
      file: str(anchor['file']),
      start: num(anchor['start']),
      end: num(anchor['end']),
      quote: str(anchor['quote']),
      commit: str(anchor['commit']),
      uncommitted: anchor['uncommitted'] === true,
      document: str(context['document']),
      number: str(context['number']),
      body: str(entry['body']) ?? '',
      status: str(entry['status']) ?? 'open',
      reply: str(entry['reply']),
      author: str(entry['author']),
      date: str(entry['date']),
      replies: replies.filter(one => one && typeof one === 'object').map(one => ({
        body: str(one['body']) ?? '', author: str(one['author']), date: str(one['date']),
      })),
    }];
  });
}
