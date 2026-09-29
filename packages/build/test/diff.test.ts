// What counts as a change.
//
// Most of these are about what must *not* be marked. A diff that marks too
// much is worse than none: the reader stops believing the colours, which is
// exactly how the hand-painted scheme this replaced used to fail.

import { describe, expect, it } from 'vitest';
import { parseDiagram } from '@docpresenter/diagram';
import { parseTable } from '@docpresenter/markdown';
import { diagramDiff, lineRanges, tableDiff } from '../src/diff.js';

const NL = String.fromCharCode(10);
const lines = (...rows: string[]): string => rows.join(NL);

describe('文章', () => {
  it('同じ文書には何の印も付かない', () => {
    const text = lines('# 見出し', '', '本文', '', '', 'もう一段落', '');
    expect(lineRanges(text, text, '')).toEqual([]);
  });

  it('空行が繰り返されても誤検知しない', () => {
    // 空行はどの文書にも何度も出る。「両方に一度だけ出る行」を手がかりに
    // すると、空行の間が全部「変更」になる。
    const before = lines('あ', '', 'い', '', 'う', '');
    const after = lines('あ', '', 'い', '', 'う', '');
    expect(lineRanges(before, after, '')).toEqual([]);
  });

  it('書き換えた行は変更、足した行は追加', () => {
    const before = lines('あ', 'い', 'う');
    const changed = lineRanges(before, lines('あ', 'イ', 'う'), '');
    expect(changed.map(range => range.change)).toEqual(['changed']);

    const added = lineRanges(before, lines('あ', 'い', 'え', 'う'), '');
    expect(added.map(range => range.change)).toEqual(['added']);
  });

  it('印はバイト範囲で返る', () => {
    const before = lines('あ', 'い');
    const after = lines('あ', 'イ');
    const [range] = lineRanges(before, after, 'docs/x.md');
    expect(range!.doc).toBe('docs/x.md');
    expect(Buffer.from(after, 'utf8').slice(range!.start, range!.end).toString()).toBe('イ');
  });

  it('消えた行はこの版に無いので範囲にならない', () => {
    expect(lineRanges(lines('あ', 'い', 'う'), lines('あ', 'う'), '')).toEqual([]);
  });
});

describe('表', () => {
  const before = parseTable(lines(
    '| 分類 | 値 | 備考 |', '|------|----|------|',
    '| 入力 | 1 | あ |', '| 操作 | 2 | い |'));

  it('変わったセルだけを指す', () => {
    const after = parseTable(lines(
      '| 分類 | 値 | 備考 |', '|------|----|------|',
      '| 入力 | 9 | あ |', '| 操作 | 2 | い |'));
    expect([...tableDiff(before, after).cells.entries()]).toEqual([['入力/値', 'changed']]);
  });

  it('行が増えても下の行は変更にならない', () => {
    const after = parseTable(lines(
      '| 分類 | 値 | 備考 |', '|------|----|------|',
      '| 表示 | 0 | う |', '| 入力 | 1 | あ |', '| 操作 | 2 | い |'));
    const marks = tableDiff(before, after);
    expect([...marks.rows.entries()]).toEqual([['表示', 'added']]);
    expect(marks.cells.size).toBe(0);
  });

  it('行が入れ替わっても変更ではない', () => {
    const after = parseTable(lines(
      '| 分類 | 値 | 備考 |', '|------|----|------|',
      '| 操作 | 2 | い |', '| 入力 | 1 | あ |'));
    const marks = tableDiff(before, after);
    expect(marks.cells.size).toBe(0);
    expect(marks.rows.size).toBe(0);
  });
});

describe('図', () => {
  const before = parseDiagram(lines(
    'free {', '  a [あ]', '  b [(い)]', '  a -> b "x"', '}',
    'layout {', '  a @ (0, 0)', '  b @ (0, 100)', '}'));

  it('ラベルを変えれば変更', () => {
    const after = parseDiagram(lines(
      'free {', '  a [あ]', '  b [(イ)]', '  a -> b "x"', '}',
      'layout {', '  a @ (0, 0)', '  b @ (0, 100)', '}'));
    expect([...diagramDiff(before, after).nodes.entries()]).toEqual([['b', 'changed']]);
  });

  it('動かしただけなら変更ではない', () => {
    // 意味の層とレイアウトの層を分けてあることが、ここで効く。
    const after = parseDiagram(lines(
      'free {', '  a [あ]', '  b [(い)]', '  a -> b "x"', '}',
      'layout {', '  a @ (40, 60)', '  b @ (300, 400)', '}'));
    const marks = diagramDiff(before, after);
    expect(marks.nodes.size).toBe(0);
    expect(marks.edges.size).toBe(0);
  });

  it('図形を足せば追加、線のラベルを変えれば変更', () => {
    const after = parseDiagram(lines(
      'free {', '  a [あ]', '  b [(い)]', '  c {う}', '  a -> b "y"', '}',
      'layout {', '  a @ (0, 0)', '  b @ (0, 100)', '  c @ (0, 200)', '}'));
    const marks = diagramDiff(before, after);
    expect([...marks.nodes.entries()]).toEqual([['c', 'added']]);
    expect([...marks.edges.entries()]).toEqual([['a->b', 'changed']]);
  });

  it('種類を変えれば変更', () => {
    const after = parseDiagram(lines(
      'free {', '  a {あ}', '  b [(い)]', '  a -> b "x"', '}',
      'layout {', '  a @ (0, 0)', '  b @ (0, 100)', '}'));
    expect([...diagramDiff(before, after).nodes.entries()]).toEqual([['a', 'changed']]);
  });
});
