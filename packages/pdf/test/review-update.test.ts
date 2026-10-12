// An engineer's two lines of a review file — the state and the answer — set
// from the screen, and nothing else in the file moved.

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { updateReviewEntry } from '../src/index.js';

const REVIEW = [
  '# 指摘管理表',
  'round: "第 1 回"',
  'comments:',
  '  - id: 1',
  '    anchor:',
  '      file: docs/a.md',
  '    body:   "最小長を 12 文字に"',
  '    status: open',
  '    author: "発注者"',
  '',
  '  - id: 2',
  '    body: "枠の外に見える"',
  '    status: resolved',
  '    reply: |',
  '      intra グループに api を含めた。',
  '      枠の位置も直した。',
  '    replies:',
  '      - body: "確認しました"',
  '',
].join('\n');

/** The lines that differ between two texts. */
const changed = (before: string, after: string) => {
  const a = before.split('\n');
  const b = after.split('\n');
  return b.filter(line => !a.includes(line)).concat(a.filter(line => !b.includes(line)).map(line => `-${line}`));
};

describe('指摘の状態と回答', () => {
  it('状態を変えると、その 1 行だけが変わる', () => {
    const after = updateReviewEntry(REVIEW, 1, { status: 'question' })!;
    expect(changed(REVIEW, after)).toEqual(['    status: question', '-    status: open']);
    expect(parse(after).comments[0].status).toBe('question');
  });

  it('回答の無い指摘に回答を書くと、状態の下に足される', () => {
    const after = updateReviewEntry(REVIEW, 1, { status: 'resolved', reply: '12 文字に変えました。\n版 1.3 で反映。' })!;
    const yaml = parse(after);
    expect(yaml.comments[0]).toMatchObject({ status: 'resolved', reply: '12 文字に変えました。\n版 1.3 で反映。', author: '発注者' });
    const lines = after.split('\n');
    expect(lines[lines.indexOf('    status: resolved') + 1]).toMatch(/^ {4}reply: "/);
  });

  it('複数行の回答も、まるごと置き換わる。返信の一覧は残る', () => {
    const after = updateReviewEntry(REVIEW, 2, { reply: '枠を直しました' })!;
    const yaml = parse(after);
    expect(yaml.comments[1].reply).toBe('枠を直しました');
    expect(yaml.comments[1].replies).toEqual([{ body: '確認しました' }]);
    expect(after).not.toContain('intra グループに');
  });

  it('回答を空にすると、回答の行が消える', () => {
    const after = updateReviewEntry(REVIEW, 2, { reply: '' })!;
    expect(parse(after).comments[1].reply).toBeUndefined();
    expect(parse(after).comments[1].status).toBe('resolved');
  });

  it('無い番号には何もしない', () => {
    expect(updateReviewEntry(REVIEW, 9, { status: 'resolved' })).toBeUndefined();
  });
});
