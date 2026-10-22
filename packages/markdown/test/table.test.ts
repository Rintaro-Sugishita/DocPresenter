import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cellAt, parseTable, renderTable, selectRows, shownText, TableParseError } from '../src/index.js';

const basic = `
| 分類 | 項目     | 型            | 必須 |
|------|---------|---------------|:----:|
| 認証 | 方式     | \`varchar(32)\` | ○    |
| ^    | 有効期限 | \`int\`         | ○    |
| 権限 | ロール   | \`varchar(16)\` | ○    |
`.trim();

describe('グリッド', () => {
  it('ヘッダと寄せを読む', () => {
    const t = parseTable(basic);
    expect(t.columns.map(c => c.header)).toEqual(['分類', '項目', '型', '必須']);
    expect(t.columns.map(c => c.align)).toEqual(['default', 'default', 'default', 'center']);
  });

  it('区切り行の : で寄せが決まる', () => {
    const t = parseTable('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
    expect(t.columns.map(c => c.align)).toEqual(['left', 'center', 'right']);
  });

  it('エスケープしたパイプをセルの文字として読む', () => {
    const t = parseTable('| a |\n|---|\n| x \\| y |');
    expect(t.rows[0]!.cells[0]!.text).toBe('x | y');
  });
});

describe('セル結合', () => {
  it('^ が上のセルの rowspan を増やす', () => {
    const t = parseTable(basic);
    const 認証 = t.rows[0]!.cells[0]!;
    expect(認証.text).toBe('認証');
    expect(認証.rowspan).toBe(2);
    // 結合された位置にはセルが立たない
    expect(t.rows[1]!.cells.map(c => c.text)).toEqual(['有効期限', '`int`', '○']);
  });

  it('結合をまたいでもセルの所在を引ける', () => {
    const t = parseTable(basic);
    expect(cellAt(t, 1, 0)?.text).toBe('認証');   // ^ の位置は上のセルが覆う
    expect(cellAt(t, 2, 0)?.text).toBe('権限');
  });

  it('< が左のセルの colspan を増やす', () => {
    const t = parseTable('| a | b | c |\n|---|---|---|\n| 横に結合 | < | 単独 |');
    const first = t.rows[0]!.cells[0]!;
    expect(first.text).toBe('横に結合');
    expect(first.colspan).toBe(2);
    expect(t.rows[0]!.cells.map(c => c.text)).toEqual(['横に結合', '単独']);
  });

  it('結合先が無ければ行番号付きで失敗する', () => {
    expect(() => parseTable('| a |\n|---|\n| ^ |')).toThrow(TableParseError);
    expect(() => parseTable('| a |\n|---|\n| < |')).toThrow(/左に結合できるセルがない/);
  });
});

describe('ブロック参照', () => {
  it('@1 の定義を複数行で読む', () => {
    const t = parseTable([
      '| a | b |', '|---|---|', '| x | @1 |', '',
      '[@1]:', '- 一つ目', '- 二つ目',
    ].join('\n'));
    expect(t.blocks.get('1')).toBe('- 一つ目\n- 二つ目');
  });
});

describe('style セクション', () => {
  it('テーマとセレクタを読む', () => {
    const t = parseTable([
      '| 分類 | 説明 |', '|---|---|', '| 認証 | x |', '',
      'style {', '  theme: grid', '  header { bottom: thick }',
      '  col:分類 { right: thick, width: 6em }', '  row:odd { fill: tint-1 }',
      '  cell:認証/説明 { fill: changed }', '  range:認証..権限 { fill: tint-2 }', '}',
    ].join('\n'));
    expect(t.theme).toBe('grid');
    expect(t.style).toHaveLength(5);
    expect(t.style[0]!.selector).toEqual({ kind: 'header' });
    expect(t.style[1]!.selector).toEqual({ kind: 'column', name: '分類' });
    expect(t.style[1]!.declarations.get('width')).toBe('6em');
    expect(t.style[2]!.selector).toEqual({ kind: 'row', which: 'odd' });
    expect(t.style[3]!.selector).toEqual({ kind: 'cell', row: '認証', column: '説明' });
    expect(t.style[4]!.selector).toEqual({ kind: 'range', from: '認証', to: '権限' });
  });
});

describe('range セクション', () => {
  it('名前付き範囲を読む（行番号を使わない部分参照のため）', () => {
    const t = parseTable([
      '| 用語 | 説明 |', '|---|---|', '| ア | x |', '',
      'range {', '  認証関連: アクセストークン..セッションキャッシュ', '}',
    ].join('\n'));
    expect(t.ranges.get('認証関連')).toEqual({
      from: 'アクセストークン', to: 'セッションキャッシュ',
    });
  });
});

describe('サンプルの実ファイル', () => {
  it('screen-items.table を読める', () => {
    const t = parseTable(readFileSync('sample/docs/auth-design/screen-items.table', 'utf8'));
    expect(t.comments[0]).toContain('ログイン画面 項目定義');
    expect(t.columns.map(c => c.header)).toEqual(['分類', 'No', 'ID', '項目名', '型', '必須', '寄せ', '初期値', '説明']);
    expect(t.columns[1]!.align).toBe('right');    // No は右寄せ
    expect(t.columns[5]!.align).toBe('center');   // 必須は中央
    expect(t.rows).toHaveLength(6);
    // No は画面の項目の順に振られ、番号の無い行は飛ばす
    expect(t.rows.map(row => shownText(row.cells.find(cell => cell.column === 1)!))).toEqual(['1', '2', '3', '4', '—', '—']);

    const 入力 = t.rows[0]!.cells[0]!;
    expect(入力.text).toBe('入力');
    expect(入力.rowspan).toBe(3);                 // ^ が 2 つ続く
    expect(cellAt(t, 2, 0)?.text).toBe('入力');

    expect(t.blocks.get('1')).toContain('大文字小文字は区別しない');
    expect(t.blocks.get('2')).toContain('ID またはパスワードが違います');
    expect(t.theme).toBe('grid');
    expect(t.style.map(r => r.selector.kind)).toContain('cell');
  });

  it('glossary.table の名前付き範囲を読める', () => {
    const t = parseTable(readFileSync('sample/shared/glossary.table', 'utf8'));
    expect(t.ranges.get('認証関連')?.from).toBe('アクセストークン');
    expect(t.ranges.get('ネットワーク')?.to).toBe('IdP');
  });
});

describe('矩形の結合（縦横の組み合わせ）', () => {
  it('横に結合したセルを、さらに縦に伸ばせる', () => {
    const t = parseTable([
      '| a | b | c |', '|---|---|---|',
      '| X | < | y |',
      '| ^ | ^ | z |',
    ].join('\n'));
    const x = t.rows[0]!.cells[0]!;
    expect(x.text).toBe('X');
    expect(x.colspan).toBe(2);
    expect(x.rowspan).toBe(2);   // 2 つの ^ で 2 重に伸びない
    expect(t.rows[1]!.cells.map(c => c.text)).toEqual(['z']);
    expect(cellAt(t, 1, 0)?.text).toBe('X');
    expect(cellAt(t, 1, 1)?.text).toBe('X');
  });
});

describe('2 方向の結合', () => {
  const shape = (source: string) => {
    const table = parseTable(source);
    const cell = cellAt(table, 0, 0)!;
    return `${cell.rowspan}x${cell.colspan}`;
  };

  it('右へ広げてから下へ伸ばした形', () => {
    expect(shape(['| A | B | C |', '| - | - | - |',
      '| 1 | < | 3 |', '| ^ | ^ | 6 |'].join('\n'))).toBe('2x2');
  });

  it('下へ伸ばしてから右へ広げた形', () => {
    // 同じ 2x2 でも印の置き方が違う。どちらも読めなければならない。
    expect(shape(['| A | B | C |', '| - | - | - |',
      '| 1 | < | 3 |', '| ^ | < | 6 |'].join('\n'))).toBe('2x2');
  });

  it('下の行の < は幅を二重に数えない', () => {
    const table = parseTable(['| A | B | C |', '| - | - | - |',
      '| 1 | < | 3 |', '| ^ | < | 6 |'].join('\n'));
    expect(table.rows[1]!.cells.map(c => c.text)).toEqual(['6']);
  });

  it('左に何も無い < は読めないと言う', () => {
    expect(() => parseTable(['| A | B |', '| - | - |', '| < | 2 |'].join('\n')))
      .toThrow(TableParseError);
  });
});

describe('a cell written #', () => {
  const numbered = [
    '| 項目 | No |',
    '|------|---:|',
    '| ID   |  # |',
    '| 補足 |  — |',
    '| 名前 |  # |',
  ].join('\n');

  // The number is computed from the row's place, so it is in no line of the
  // file: a row inserted above changes one line, not every number below it.
  it('shows its place among the # cells of its column', () => {
    const table = parseTable(numbered);
    expect(table.rows.map(row => shownText(row.cells[1]!))).toEqual(['1', '—', '2']);
    expect(table.rows[2]!.cells[1]!.text).toBe('#');
    expect(renderTable(table)).toMatch(/<td[^>]*>名前<\/td><td[^>]*>2<\/td>/);
  });

  it('keeps its number in a partial reference', () => {
    const table = parseTable(`${numbered}\n\nrange {\n  後半: 補足..名前\n}\n`);
    expect(selectRows(table, '後半')!.rows.map(row => shownText(row.cells[1]!))).toEqual(['—', '2']);
  });
});
