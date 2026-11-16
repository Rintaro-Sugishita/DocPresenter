// A note the author writes on the editing screen and a review finding go into
// the same review file. The note says it is one, so it stays on the screen.

import { describe, expect, it } from 'vitest';
import { parseReviewFile } from '@docpresenter/markdown';
import { appendScreenComment } from '@docpresenter/pdf';

const base = {
  anchor: { file: 'docs/a.md', start: 0, end: 3, quote: '設計' },
  precision: 'text' as const, document: 'docs/a.md', date: '2026-11-11T00:00:00Z',
};

describe('画面で付けたコメントと指摘', () => {
  it('コメントは type: comment と書き、読み戻せる', () => {
    const { text } = appendScreenComment(undefined, { ...base, body: '後で図を足す', type: 'comment' }, '1');
    expect(text).toContain('    type:   comment');
    const [one] = parseReviewFile(text, 'reviews/r.review.yml');
    expect(one).toMatchObject({ body: '後で図を足す', type: 'comment' });
  });

  it('指摘には何も足さない', () => {
    const { text } = appendScreenComment(undefined, { ...base, body: '誰が解除するのか' }, '1');
    expect(text).not.toContain('type:');
    const [one] = parseReviewFile(text, 'reviews/r.review.yml');
    expect(one?.type).toBeUndefined();
  });
});
