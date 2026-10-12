// Document numbers: the series a repository already uses, the next free number
// of each, and the numbers two documents share.

import { describe, expect, it } from 'vitest';
import { documentNumberOf, duplicateNumbers, firstNumber, numberSeries, suggestNumber } from '../src/index.js';

describe('文書番号', () => {
  const numbers = ['SD-AUTH-000', 'SD-AUTH-001', 'SD-ORDER-001', 'SD-SAMPLE-002', 'SD-AUTH-007'];

  it('系列ごとに、いちばん大きい番号の次を出す。桁はそろえる', () => {
    expect(numberSeries(numbers)).toEqual([
      { prefix: 'SD-AUTH-', next: 'SD-AUTH-008', count: 3 },
      { prefix: 'SD-ORDER-', next: 'SD-ORDER-002', count: 1 },
      { prefix: 'SD-SAMPLE-', next: 'SD-SAMPLE-003', count: 1 },
    ]);
  });

  it('いちばん大きい系列の次を薦める。番号が無ければ DOC-001', () => {
    expect(suggestNumber(numbers)).toBe('SD-AUTH-008');
    expect(suggestNumber([])).toBe('DOC-001');
    expect(firstNumber('SD-PAY-')).toBe('SD-PAY-001');
  });

  it('frontmatter から番号を読む', () => {
    expect(documentNumberOf('---\ndocument: SD-AUTH-001\ntitle: T\n---\n\n# T\n')).toBe('SD-AUTH-001');
    expect(documentNumberOf('# 番号の無い文書\n')).toBeUndefined();
  });

  it('同じ番号の文書を見つける', () => {
    expect(duplicateNumbers([
      { path: 'docs/a.md', number: 'SD-1' }, { path: 'docs/b.md', number: 'SD-1' }, { path: 'docs/c.md', number: 'SD-2' },
    ])).toEqual(new Map([['SD-1', ['docs/a.md', 'docs/b.md']]]));
  });
});
