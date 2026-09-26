import { describe, expect, it } from 'vitest';
import { cellAt, parseTable } from '@docpresenter/core';
import { applyEdit } from '../src/index.js';
import {
  formatTable, insertColumn, insertRow, mergeDown, mergeRight, parseClipboardGrid,
  pasteGrid, removeColumn, removeRow, setAlign, setCell, setStyle, styleAt,
  mergeLoses, mergeRange, TableEditError, unmerge,
} from '../src/index.js';

const SOURCE = [
  '# 用語集',
  '',
  '| 用語     | 説明           |',
  '| -------- | -------------- |',
  '| トークン | 認可に用いる   |',
  '| 会員     | 登録済みの利用者 |',
  '',
  'style {',
  '  header { bottom: thick }',
  '}',
].join('\n');

const run = (source: string, make: (t: ReturnType<typeof parseTable>) => ReturnType<typeof setCell>) =>
  applyEdit(source, make(parseTable(source)));

const grid = (source: string) =>
  source.split('\n').filter(line => line.startsWith('|'));

describe('セルの編集', () => {
  it('編集した行だけが変わる', () => {
    const next = run(SOURCE, t => setCell(t, 0, 1, '認可に使う'));
    expect(grid(next)[2]).toContain('認可に使う');
    expect(grid(next)[3]).toBe('| 会員     | 登録済みの利用者 |');
    expect(next).toContain('# 用語集');
    expect(next).toContain('header { bottom: thick }');
  });

  it('短くなっても桁が崩れない', () => {
    // 1 セル編集のたびに表全体を整形しない方針なので、幅は自分で保つ。
    const next = run(SOURCE, t => setCell(t, 0, 0, 'トク'));
    expect(grid(next)[2]).toBe('| トク     | 認可に用いる   |');
  });

  it('見出し行も編集できる', () => {
    const next = run(SOURCE, t => setCell(t, -1, 1, '意味'));
    expect(grid(next)[0]).toContain('意味');
  });

  it('縦棒は書けるようにエスケープする', () => {
    const next = run(SOURCE, t => setCell(t, 0, 1, 'A | B'));
    expect(next).toContain('A \\| B');
    expect(parseTable(next).rows[0]!.cells[1]!.text).toBe('A | B');
  });
});

describe('行と列', () => {
  it('行を途中に足す', () => {
    const next = run(SOURCE, t => insertRow(t, 1));
    expect(parseTable(next).rows).toHaveLength(3);
    expect(parseTable(next).rows[2]!.cells[0]!.text).toBe('会員');
  });

  it('行を末尾に足す', () => {
    const next = run(SOURCE, t => insertRow(t, 2));
    expect(parseTable(next).rows).toHaveLength(3);
    expect(next).toContain('style {');
  });

  it('行を消す', () => {
    const next = run(SOURCE, t => removeRow(t, 0));
    expect(parseTable(next).rows).toHaveLength(1);
    expect(grid(next)).toHaveLength(3);
  });

  it('最後の 1 行は消せない', () => {
    const one = '| a |\n| - |\n| b |';
    expect(() => removeRow(parseTable(one), 0)).toThrow(TableEditError);
  });

  it('列を足すと全行に入る', () => {
    const next = run(SOURCE, t => insertColumn(t, 1, '区分'));
    const table = parseTable(next);
    expect(table.columns.map(c => c.header)).toEqual(['用語', '区分', '説明']);
    expect(table.rows.every(r => r.cells.length === 3)).toBe(true);
  });

  it('列を消す', () => {
    const next = run(SOURCE, t => removeColumn(t, 1));
    expect(parseTable(next).columns.map(c => c.header)).toEqual(['用語']);
  });

  it('寄せは区切り行で決まる', () => {
    const next = run(SOURCE, t => setAlign(t, 1, 'right'));
    expect(parseTable(next).columns[1]!.align).toBe('right');
    expect(parseTable(next).columns[0]!.align).toBe('default');
  });
});

describe('貼り付け', () => {
  it('Excel の TSV を読む', () => {
    expect(parseClipboardGrid('a\tb\nc\td\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('範囲に流し込む', () => {
    const next = run(SOURCE, t => pasteGrid(t, 0, 0, [['A', 'B'], ['C', 'D']]));
    const table = parseTable(next);
    expect(table.rows.map(r => r.cells.map(c => c.text))).toEqual([['A', 'B'], ['C', 'D']]);
  });

  it('はみ出したら表を広げる', () => {
    const next = run(SOURCE, t => pasteGrid(t, 1, 1, [['X', 'Y'], ['Z', 'W']]));
    const table = parseTable(next);
    expect(table.columns).toHaveLength(3);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[2]!.cells[2]!.text).toBe('W');
  });
});

describe('整形', () => {
  it('明示して初めて桁が揃う', () => {
    const ragged = '| a | 長い見出し |\n| --- | --- |\n| 会員 | x |';
    const next = applyEdit(ragged, formatTable(parseTable(ragged)));
    expect(next.split('\n')).toEqual([
      '| a    | 長い見出し |',
      '| ---- | ---------- |',
      '| 会員 | x          |',
    ]);
  });

  it('グリッド以外には触らない', () => {
    const next = run(SOURCE, t => formatTable(t));
    expect(next).toContain('# 用語集');
    expect(next).toContain('header { bottom: thick }');
  });
});

describe('スタイル', () => {
  const styled = (...rules: string[]) =>
    [...SOURCE.split('\n').slice(0, 6), 'style {', ...rules, '}'].join('\n');

  it('style 節が無ければ作る', () => {
    const bare = SOURCE.split('\n').slice(0, 6).join('\n');
    const next = applyEdit(bare, setStyle(parseTable(bare), { kind: 'header' }, 'bottom', 'thick'));
    expect(next).toContain('style {\n  header { bottom: thick }\n}');
    expect(parseTable(next).style).toHaveLength(1);
  });

  it('ある節には 1 行足すだけ', () => {
    const source = styled('  header { bottom: thick }');
    const next = applyEdit(source, setStyle(parseTable(source), { kind: 'column', name: '説明' }, 'fill', 'shade'));
    expect(next).toContain('  header { bottom: thick }');
    expect(next).toContain('  col:説明 { fill: shade }');
    expect(parseTable(next).style).toHaveLength(2);
  });

  it('同じセレクタには足さずに書き換える', () => {
    const source = styled('  col:説明 { fill: shade }');
    const next = applyEdit(source, setStyle(parseTable(source), { kind: 'column', name: '説明' }, 'bottom', 'thick'));
    const table = parseTable(next);
    expect(table.style).toHaveLength(1);
    expect([...table.style[0]!.declarations]).toEqual([['fill', 'shade'], ['bottom', 'thick']]);
  });

  it('解除すると宣言が消える', () => {
    const source = styled('  col:説明 { fill: shade, bottom: thick }');
    const next = applyEdit(source, setStyle(parseTable(source), { kind: 'column', name: '説明' }, 'fill', undefined));
    expect(parseTable(next).style[0]!.declarations.has('fill')).toBe(false);
    expect(parseTable(next).style[0]!.declarations.get('bottom')).toBe('thick');
  });

  it('空になった規則は行ごと消す', () => {
    const source = styled('  header { bottom: thick }', '  col:説明 { fill: shade }');
    const next = applyEdit(source, setStyle(parseTable(source), { kind: 'header' }, 'bottom', undefined));
    expect(parseTable(next).style).toHaveLength(1);
    expect(next).not.toContain('header {');
    expect(next).not.toContain('{  }');
  });

  it('セルは行と列の名前で指す', () => {
    const source = styled('  header { bottom: thick }');
    const next = applyEdit(source, setStyle(
      parseTable(source), { kind: 'cell', row: 'トークン', column: '説明' }, 'fill', 'changed'));
    expect(next).toContain('cell:トークン/説明 { fill: changed }');
  });

  it('いま付いているトークンを答える', () => {
    const source = styled('  col:説明 { fill: pending }');
    const table = parseTable(source);
    expect(styleAt(table, { kind: 'column', name: '説明' }, 'fill')).toBe('pending');
    expect(styleAt(table, { kind: 'column', name: '用語' }, 'fill')).toBeUndefined();
  });

  it('グリッドには触らない', () => {
    const source = styled('  header { bottom: thick }');
    const next = applyEdit(source, setStyle(parseTable(source), { kind: 'row', which: 'odd' }, 'fill', 'tint-1'));
    expect(next.split('\n').filter(l => l.startsWith('|'))).toEqual(
      source.split('\n').filter(l => l.startsWith('|')));
  });
});

describe('セルの結合', () => {
  const GRID = [
    '| A | B | C |',
    '| - | - | - |',
    '| 1 | 2 | 3 |',
    '| 4 | 5 | 6 |',
    '| 7 | 8 | 9 |',
  ].join('\n');
  const span = (source: string, row: number, column: number) => {
    const t = parseTable(source);
    const c = cellAt(t, row, column)!;
    return `${c.rowspan}x${c.colspan}`;
  };

  it('下のセルと結合する', () => {
    const next = run(GRID, t => mergeDown(t, 0, 0));
    expect(span(next, 0, 0)).toBe('2x1');
    expect(next.split('\n')[3]).toContain('| ^ |');
    expect(parseTable(next).rows[1]!.cells.map(c => c.text)).toEqual(['5', '6']);
  });

  it('右のセルと結合する', () => {
    const next = run(GRID, t => mergeRight(t, 0, 0));
    expect(span(next, 0, 0)).toBe('1x2');
    expect(parseTable(next).rows[0]!.cells.map(c => c.text)).toEqual(['1', '3']);
  });

  it('横に結合したセルを下へ伸ばすと、下の行に印が 2 つ付く', () => {
    const wide = run(GRID, t => mergeRight(t, 0, 0));
    const next = run(wide, t => mergeDown(t, 0, 0));
    expect(span(next, 0, 0)).toBe('2x2');
    expect(next.split('\n')[3]).toMatch(/\|\s*\^\s*\|\s*\^\s*\|/);
  });

  it('縦に結合したセルを右へ伸ばすと、両方の行に印が付く', () => {
    const tall = run(GRID, t => mergeDown(t, 0, 0));
    const next = run(tall, t => mergeRight(t, 0, 0));
    expect(span(next, 0, 0)).toBe('2x2');
  });

  it('解除すると元の位置が戻る', () => {
    const merged = run(run(GRID, t => mergeRight(t, 0, 0)), t => mergeDown(t, 0, 0));
    const next = run(merged, t => unmerge(t, 0, 0));
    expect(span(next, 0, 0)).toBe('1x1');
    expect(parseTable(next).rows[0]!.cells).toHaveLength(3);
    expect(parseTable(next).rows[1]!.cells).toHaveLength(3);
  });

  it('本体の文字は解除しても残る', () => {
    const merged = run(GRID, t => mergeDown(t, 0, 0));
    expect(parseTable(run(merged, t => unmerge(t, 0, 0))).rows[0]!.cells[0]!.text).toBe('1');
  });

  it('行や列が無い側へは結合できない', () => {
    expect(() => mergeDown(parseTable(GRID), 2, 0)).toThrow(TableEditError);
    expect(() => mergeRight(parseTable(GRID), 0, 2)).toThrow(TableEditError);
    expect(() => unmerge(parseTable(GRID), 0, 0)).toThrow(TableEditError);
  });

  it('グリッド以外には触らない', () => {
    const next = run(SOURCE, t => mergeDown(t, 0, 0));
    expect(next).toContain('# 用語集');
    expect(next).toContain('header { bottom: thick }');
  });
});

describe('範囲の結合', () => {
  const GRID = [
    '| A | B | C |',
    '| - | - | - |',
    '| 1 | 2 | 3 |',
    '| 4 | 5 | 6 |',
    '| 7 | 8 | 9 |',
  ].join('\n');
  const shape = (source: string, row = 0, column = 0) => {
    const c = cellAt(parseTable(source), row, column)!;
    return `${c.rowspan}x${c.colspan}`;
  };

  it('矩形をまとめて結合する', () => {
    const next = run(GRID, t => mergeRange(t, { top: 0, left: 0, bottom: 1, right: 1 }));
    expect(shape(next)).toBe('2x2');
    expect(parseTable(next).rows[0]!.cells.map(c => c.text)).toEqual(['1', '3']);
    expect(parseTable(next).rows[1]!.cells.map(c => c.text)).toEqual(['6']);
  });

  it('3 行 3 列でも結合できる', () => {
    const next = run(GRID, t => mergeRange(t, { top: 0, left: 0, bottom: 2, right: 2 }));
    expect(shape(next)).toBe('3x3');
    expect(parseTable(next).rows[1]!.cells).toHaveLength(0);
  });

  it('既にある結合をまたぐ範囲は、その結合を丸ごと含む', () => {
    const merged = run(GRID, t => mergeRange(t, { top: 0, left: 0, bottom: 0, right: 1 }));
    // (1,1) だけを指しても、2 列にまたがるセルごと取り込む
    const next = run(merged, t => mergeRange(t, { top: 0, left: 1, bottom: 1, right: 1 }));
    expect(shape(next)).toBe('2x2');
  });

  it('消える文字を先に数えられる', () => {
    const table = parseTable(GRID);
    expect(mergeLoses(table, { top: 0, left: 0, bottom: 1, right: 1 })).toEqual(['2', '4', '5']);
  });

  it('空のセルばかりなら何も消えない', () => {
    const blank = ['| A | B |', '| - | - |', '| 1 |   |', '|   |   |'].join('\n');
    expect(mergeLoses(parseTable(blank), { top: 0, left: 0, bottom: 1, right: 1 })).toEqual([]);
  });

  it('1 セルだけの範囲は結合しない', () => {
    expect(() => mergeRange(parseTable(GRID), { top: 0, left: 0, bottom: 0, right: 0 }))
      .toThrow(TableEditError);
  });

  it('結合したあと解除すると元の形に戻る', () => {
    const merged = run(GRID, t => mergeRange(t, { top: 0, left: 0, bottom: 1, right: 1 }));
    const next = run(merged, t => unmerge(t, 0, 0));
    expect(shape(next)).toBe('1x1');
    expect(parseTable(next).rows[0]!.cells).toHaveLength(3);
    expect(parseTable(next).rows[1]!.cells).toHaveLength(3);
  });
});
