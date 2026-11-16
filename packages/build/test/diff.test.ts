// What counts as a change.
//
// Most of these are about what must *not* be marked. A diff that marks too
// much is worse than none: the reader stops believing the colours, which is
// exactly how the hand-painted scheme this replaced used to fail.

import { describe, expect, it } from 'vitest';
import { parseDiagram } from '@docpresenter/diagram';
import { parseTable } from '@docpresenter/markdown';
import { diagramDiff, lineRanges, removedLines, tableDiff } from '../src/diff.js';

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
    expect([...tableDiff(before, after).cells.entries()]).toEqual([['0/1', 'changed']]);
  });

  it('行が増えても下の行は変更にならない', () => {
    const after = parseTable(lines(
      '| 分類 | 値 | 備考 |', '|------|----|------|',
      '| 表示 | 0 | う |', '| 入力 | 1 | あ |', '| 操作 | 2 | い |'));
    const marks = tableDiff(before, after);
    expect([...marks.rows.entries()]).toEqual([[0, 'added']]);
    expect(marks.cells.size).toBe(0);
  });

  it('先頭の列が結合（^）や連番（#）でも、変わったセルだけを指す', () => {
    const merged = parseTable(lines(
      '| 分類 | No | 項目名 | 型 |', '|------|---:|--------|----|',
      '| 入力 | # | ログイン ID | varchar |', '| ^ | # | パスワード | varchar |', '| ^ | # | 保持 | bool |'));
    const edited = parseTable(lines(
      '| 分類 | No | 項目名 | 型 |', '|------|---:|--------|----|',
      '| 入力 | # | ログイン名 | varchar |', '| ^ | # | パスワード | varchar |', '| ^ | # | 保持 | bool |'));
    const marks = tableDiff(merged, edited);
    expect([...marks.cells.entries()]).toEqual([['0/2', 'changed']]);
    expect(marks.rows.size).toBe(0);
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

describe('消えたもの（--show-removed strike）', () => {
  it('消えた行は、次に続く行の位置に、書いてあったとおりの文字で返る', () => {
    const before = lines('# 見出し', '', 'あ', '', 'い', '', 'う');
    const after = lines('# 見出し', '', 'あ', '', 'う');
    const gone = removedLines(before, after, '');
    expect(gone).toEqual([{ doc: '', at: Buffer.byteLength(after.slice(0, after.indexOf('う'))), text: 'い' }]);
  });

  it('書き換えた行は、新しい行の頭に古い文字が置かれる', () => {
    const gone = removedLines(lines('あ', '古い文', 'う'), lines('あ', '新しい文', 'う'), '');
    expect(gone).toEqual([{ doc: '', at: 4, text: '古い文' }]);
  });

  it('末尾で消えた行は文書の終わりに、空行だけの削除と前付けの設定は出さない', () => {
    const before = lines('---', 'title: 旧', '---', '', 'あ', '', '', 'い');
    const after = lines('---', 'title: 新', '---', '', 'あ');
    const gone = removedLines(before, after, '');
    expect(gone).toEqual([{ doc: '', at: Buffer.byteLength(after), text: 'い' }]);
  });

  it('表は、変わったセルの元の文字と、消えた行・列を返す', () => {
    const before = parseTable(lines(
      '| 分類 | 値 | 備考 |', '|------|----|------|',
      '| 入力 | 1 | あ |', '| 表示 | 3 | え |', '| 操作 | 2 | い |'));
    const after = parseTable(lines(
      '| 分類 | 値 |', '|------|----|',
      '| 入力 | 9 |', '| 操作 | 2 |'));
    const marks = tableDiff(before, after);
    expect([...marks.was!.entries()]).toEqual([['0/1', '1']]);
    expect(marks.removedRows).toEqual([{ before: 1, cells: ['表示', '3'] }]);
    expect(marks.removedColumns).toEqual(['備考']);
  });

  it('図は、消えた図形と線をその文字で返す', () => {
    const before = parseDiagram(lines(
      'free {', '  a [あ]', '  b [(い)]', '  c [う]', '  a -> b "x"', '  b -> c', '}'));
    const after = parseDiagram(lines('free {', '  a [あ]', '  b [(い)]', '  a -> b "x"', '}'));
    expect(diagramDiff(before, after).removed).toEqual({ nodes: ['う'], edges: ['い → う'] });
  });
});
