// The review so far, as the PDF of a document carries it: the comments made on
// that document, where their words are now, with their answers.

import { describe, expect, it } from 'vitest';
import { byteLength } from '@docpresenter/base';
import { reviewNotesOf, type Workspace } from '../src/index.js';

const DOC = '# 設計\n\n追記した段落。\n\nロックの解除は管理者による手動操作のみ。\n';
const OLD = '# 設計\n\nロックの解除は管理者による手動操作のみ。\n';
const at = (text: string, piece: string) => {
  const start = byteLength(text.slice(0, text.indexOf(piece)));
  return { start, end: start + byteLength(piece) };
};
const was = at(OLD, '管理者');

const REVIEW = [
  'round: "1"', 'via: pdf', '', 'comments:',
  '  - id: 1', '    anchor:', '      file: docs/a.md', `      start: ${was.start}`, `      end: ${was.end}`, '      quote: "管理者"',
  '    context:', '      document: docs/a.md',
  '    body: "誰が解除するのか"', '    status: question', '    reply: "運用チーム"',
  '    replies:', '      - body: "了解"', '        author: "発注者"',
  '  - id: 2', '    anchor:', '      file: docs/a.md', '      start: 0', '      end: 4', '      quote: "もう無い"',
  '    context:', '      document: docs/a.md', '    body: "消えた箇所"', '    status: open',
  '  - id: 3', '    anchor:', '      file: docs/b.md', '      start: 0', '      end: 1', '      quote: "#"',
  '    context:', '      document: docs/b.md', '    body: "別の文書"', '    status: open',
  '',
].join('\n');

const workspace = (files: Record<string, string>): Workspace => ({
  list: () => Object.keys(files), read: path => files[path], dataUrl: () => undefined,
});

describe('PDF に載せる指摘', () => {
  it('その文書への指摘を、今の位置で、回答と返信を付けて出す', () => {
    const notes = reviewNotesOf(workspace({ 'docs/a.md': DOC, 'reviews/r.review.yml': REVIEW }), 'docs/a.md');
    expect(notes).toEqual([{
      key: 'dp-review:reviews/r.review.yml#1', file: 'docs/a.md', ...at(DOC, '管理者'),
      body: '誰が解除するのか', status: 'question',
      replies: [
        { key: 'dp-review:reviews/r.review.yml#1/answer', body: '運用チーム' },
        { key: 'dp-review:reviews/r.review.yml#1/r1', body: '了解', author: '発注者' },
      ],
    }]);
  });

  it('文書を動かしても、文書番号でつながり、今の場所の語を指す', () => {
    const review = [
      'round: "1"', 'comments:',
      '  - id: 1', '    anchor:', '      file: docs/old.md', `      start: ${was.start}`, `      end: ${was.end}`, '      quote: "管理者"',
      '    context:', '      document: docs/old.md', '      number: "SD-9"',
      '    body: "誰が解除するのか"', '    status: open', '',
    ].join('\n');
    const files = { 'docs/new.md': DOC, 'reviews/r.review.yml': review };
    expect(reviewNotesOf(workspace(files), 'docs/new.md')).toEqual([]);
    const [note] = reviewNotesOf(workspace(files), 'docs/new.md', 'SD-9');
    expect(note).toMatchObject({ file: 'docs/new.md', ...at(DOC, '管理者'), body: '誰が解除するのか' });
  });
});
