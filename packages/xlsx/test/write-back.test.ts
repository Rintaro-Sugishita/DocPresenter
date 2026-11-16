import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { parseTable } from '@docpresenter/markdown';
import {
  gridOfSheet, gridOfTable, readWorkbook, roundTrip, writeBack, writeXlsx, type Grid, type GridCell,
} from '../src/index.js';

const lines = (...all: string[]): string => all.join('\n') + '\n';

const ITEMS = lines(
  '| 分類 | No | ID      | 項目名      | 型            | 桁数  |',
  '|------|---:|---------|-------------|---------------|------:|',
  '| 入力 |  # | idBox   | ログイン ID | `varchar(64)` | 1,000 |',
  '| ^    |  # | pwBox   | パスワード  | varchar       |  1.50 |',
  '| ^    |  # | keepBox | 保持        | bool          |   001 |',
  '| 操作 |  # | submit  | **送信**    | —             |       |',
);

/** The base a session keeps, and a copy of it to edit as Excel would. */
function opened(source: string): { base: Grid; excel: { header: string[]; rows: GridCell[][]; merges: Grid['merges'][number][]; widths: (number | undefined)[] } } {
  const base = roundTrip(parseTable(source));
  return {
    base,
    excel: {
      header: [...base.header], rows: base.rows.map(row => row.map(cell => ({ ...cell }))),
      merges: [...base.merges], widths: [...base.widths],
    },
  };
}

describe('Excel との往復', () => {
  it('Excel で何も変えなければ、ファイルは 1 バイトも変わらない', () => {
    const { base, excel } = opened(ITEMS);
    const result = writeBack(ITEMS, base, excel);
    expect(result.text).toBe(ITEMS);
    expect(result.cells).toBe(0);
  });

  it('数値・# の番号・コード・001 は、往復しても書いたとおりに戻る', () => {
    const { base } = opened(ITEMS);
    expect(base.rows[0]!.map(cell => cell.text)).toEqual(['入力', '1', 'idBox', 'ログイン ID', '`varchar(64)`', '1,000']);
    expect(base.rows[1]![5]!.text).toBe('1.50');
    expect(base.rows[2]![5]!.text).toBe('001');
    expect(base.rows[3]![3]!.text).toBe('**送信**');
    expect(base.merges).toEqual([{ row: 0, column: 0, rows: 3, columns: 1 }]);
  });

  it('1 セル直すと、その行のその欄だけが変わり、幅と # はそのまま', () => {
    const { base, excel } = opened(ITEMS);
    excel.rows[1]![3] = { text: 'パスワード（8 文字以上）' };
    const result = writeBack(ITEMS, base, excel);
    const before = ITEMS.split('\n');
    const after = result.text.split('\n');
    expect(after.filter((line, i) => line !== before[i])).toEqual([
      '| ^    |  # | pwBox   | パスワード（8 文字以上） | varchar       |  1.50 |',
    ]);
    expect(result.cells).toBe(1);
  });

  it('Excel で付けた太字・色・上付きは、セルの中の書き方で戻る', () => {
    const { base, excel } = opened(ITEMS);
    excel.rows[2]![3] = { text: '**保持**する' };
    excel.rows[2]![4] = { text: '[bool]{color=#c62828}' };
    excel.rows[3]![4] = { text: 'x^2^' };
    const text = writeBack(ITEMS, base, excel).text;
    expect(text).toContain('| **保持**する |');
    expect(text).toContain('[bool]{color=#c62828}');
    expect(text).toContain('x^2^');
  });

  it('背景色は、1 列目が ^ でも ID の列でセルを指す規則として書く', () => {
    const { base, excel } = opened(ITEMS);
    excel.rows[1]![4] = { ...excel.rows[1]![4]!, fill: '#fdf0d5' };
    const text = writeBack(ITEMS, base, excel).text;
    expect(text).toContain('style {');
    expect(text).toContain('cell:[ID=pwBox]/型 { fill: #fdf0d5 }');
    // 規則は書いた行にだけ効く
    const table = parseTable(text);
    const grid = gridOfTable(table);
    expect(grid.rows.map(row => row[4]!.fill)).toEqual([undefined, '#fdf0d5', undefined, undefined]);
  });

  it('列の全部を中央に揃えると、区切り行の寄せが変わる', () => {
    const { base, excel } = opened(ITEMS);
    excel.rows.forEach(row => { row[4] = { ...row[4]!, align: 'center' }; });
    const text = writeBack(ITEMS, base, excel).text;
    expect(text.split('\n')[1]).toContain(':-------------:');
    expect(text).not.toContain('align');
  });

  it('1 つだけ右寄せにすると、そのセルの規則になる', () => {
    const { base, excel } = opened(ITEMS);
    excel.rows[3]![3] = { ...excel.rows[3]![3]!, align: 'right' };
    expect(writeBack(ITEMS, base, excel).text).toContain('cell:操作/項目名 { align: right }');
  });

  it('Excel で結合すると ^ と < で書き戻す', () => {
    const { base, excel } = opened(ITEMS);
    excel.rows[3]![5] = { text: '' };
    excel.merges.push({ row: 2, column: 5, rows: 2, columns: 1 });
    const text = writeBack(ITEMS, base, excel).text;
    expect(text).toContain('| 操作 |  # | submit  | **送信**    | —             | ^     |');
    expect(parseTable(text).rows[2]!.cells.find(cell => cell.column === 5)!.rowspan).toBe(2);
  });

  it('行を挿入すると、その行だけが増える', () => {
    const { base, excel } = opened(ITEMS);
    // Excel puts the number it was given at the right, as it does the rest of the column.
    excel.rows.splice(3, 0, [...['', '', 'mailBox', 'メール', 'varchar'].map(text => ({ text })), { text: '255', align: 'right' as const }]);
    const result = writeBack(ITEMS, base, excel);
    const after = result.text.split('\n');
    expect(after).toHaveLength(ITEMS.split('\n').length + 1);
    expect(after[5]).toMatch(/^\|\s+\|\s+\| mailBox\s+\| メール\s+\| varchar\s+\| 255\s+\|$/);
    expect(after[6]).toBe('| 操作 |  # | submit  | **送信**    | —             |       |');
  });

  it('数値を書き換えると、元の表示形式で戻る', () => {
    const { base, excel } = opened(ITEMS);
    excel.rows[0]![5] = { ...excel.rows[0]![5]!, text: '2,000' };
    expect(writeBack(ITEMS, base, excel).text).toContain('| 2,000 |');
  });

  it('列幅を変えると、その列の幅の規則になる', () => {
    const { base, excel } = opened(ITEMS);
    excel.widths[3] = 30;
    expect(writeBack(ITEMS, base, excel).text).toContain('col:項目名 { width: 30ch }');
  });

  it('開いている間にファイル側でも直していたら、Excel で直したセルだけを戻す', () => {
    const { base, excel } = opened(ITEMS);
    excel.rows[0]![3] = { text: 'ログイン名' };
    const edited = ITEMS.replace('| 保持        |', '| 状態を保持  |');
    const result = writeBack(edited, base, excel);
    expect(result.text).toContain('ログイン名');
    expect(result.text).toContain('状態を保持');
    expect(result.conflicts).toEqual([]);
  });

  it('同じセルを両方で直していたら、ファイルの方を残して知らせる', () => {
    const { base, excel } = opened(ITEMS);
    excel.rows[2]![3] = { text: 'Excel 側' };
    const edited = ITEMS.replace('| 保持        |', '| ファイル側  |');
    const result = writeBack(edited, base, excel);
    expect(result.text).toContain('ファイル側');
    expect(result.text).not.toContain('Excel 側');
    expect(result.conflicts).toEqual(['D4']);
  });

  it('両方で行の数を変えていたら、何も書かない', () => {
    const { base, excel } = opened(ITEMS);
    excel.rows.pop();
    const edited = ITEMS + '| 表示 |  — |         | メッセージ  | —             |       |\n';
    const result = writeBack(edited, base, excel);
    expect(result.refused).toBe('shape');
    expect(result.text).toBe(edited);
  });
});

describe('Excel が保存した形のブック', () => {
  // Excel が保存し直すと、文字は sharedStrings に、色はテーマ色になる
  const book = (): Uint8Array => zipSync({
    'xl/workbook.xml': strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="項目" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/sharedStrings.xml': strToU8('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<si><t>名前</t></si><si><t>金額</t></si>'
      + '<si><r><t xml:space="preserve">普通と</t></r><r><rPr><b/><color theme="5"/><rFont val="游ゴシック"/></rPr><t>強調</t></r></si>'
      + '<si><r><t>H</t></r><r><rPr><strike/><vertAlign val="subscript"/></rPr><t>2</t></r><r><t>O</t></r></si></sst>'),
    'xl/styles.xml': strToU8('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<numFmts count="1"><numFmt numFmtId="176" formatCode="#,##0&quot;円&quot;"/></numFmts>'
      + '<fonts count="2"><font><sz val="11"/><name val="游ゴシック"/></font><font><strike/><sz val="11"/><color rgb="FF000000"/><name val="游ゴシック"/></font></fonts>'
      + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
      + '<fill><patternFill patternType="solid"><fgColor theme="7" tint="0.79998168889431442"/></patternFill></fill></fills>'
      + '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0"/><xf numFmtId="176" fontId="0" fillId="2"><alignment horizontal="right"/></xf>'
      + '<xf numFmtId="0" fontId="1" fillId="0"/><xf numFmtId="14" fontId="0" fillId="0"/></cellXfs></styleSheet>'),
    'xl/worksheets/sheet1.xml': strToU8('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<cols><col min="1" max="1" width="20.5" customWidth="1"/></cols><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><f>SUM(1,2)</f><v>1200</v></c></row>'
      + '<row r="3"><c r="A3" t="s" s="2"><v>3</v></c><c r="B3" s="3"><v>46024</v></c></row>'
      + '</sheetData></worksheet>'),
  });

  it('共有文字列・テーマ色・表示形式・数式の結果を、セルの見た目どおりに読む', () => {
    const workbook = readWorkbook(book());
    expect(workbook.sheets).toEqual(['項目']);
    const { grid, notes } = gridOfSheet(workbook.sheet()!);
    expect(grid.header).toEqual(['名前', '金額']);
    expect(grid.rows[0]![0]!.text).toBe('普通と[**強調**]{color=#ed7d31}');
    expect(grid.rows[0]![1]).toEqual({ text: '1,200円', fill: '#fff2cc', align: 'right' });
    expect(grid.rows[1]![0]!.text).toBe('~~H~2~O~~');
    expect(grid.rows[1]![1]!.text).toBe('2026/1/2');
    expect(grid.widths[0]).toBe(20.5);
    expect(notes.formulas).toBe(1);
  });

  it('誰も寄せていない数値は、Excel の画面どおり右寄せとして読む', () => {
    const { grid } = gridOfSheet(readWorkbook(book()).sheet()!);
    expect(grid.rows[1]![1]!.align).toBe('right');
    expect(grid.rows[1]![0]!.align).toBeUndefined();
  });
});

describe('数値の寄せ', () => {
  const PRICES = lines(
    '| 品目 | 金額  |',
    '|------|-------|',
    '| 設計 | 1,200 |',
    '| 実装 |       |',
  );

  it('寄せていない列の数値は、Excel でも左に置き、読み戻しても寄せは付かない', () => {
    const bytes = writeXlsx(gridOfTable(parseTable(PRICES)), { sheet: 'p' });
    const xml = new TextDecoder().decode(unzipSync(bytes)['xl/styles.xml']);
    expect(xml).toContain('horizontal="left"');
    const { grid } = gridOfSheet(readWorkbook(bytes).sheet()!);
    expect(grid.rows[0]![1]).toEqual({ text: '1,200' });
    const base = roundTrip(parseTable(PRICES));
    expect(writeBack(PRICES, base, grid).text).toBe(PRICES);
  });

  it('空いたセルに Excel で数値を入れると、右寄せが付いて戻る', () => {
    const { base, excel } = opened(PRICES);
    excel.rows[1]![1] = { text: '800', align: 'right' };
    const text = writeBack(PRICES, base, excel).text;
    expect(text).toContain('| 実装 | 800   |');
    expect(text).toContain('cell:実装/金額 { align: right }');
  });

  it('列の数値が全部右に寄ると、区切り行が右寄せになる', () => {
    const { base, excel } = opened(PRICES);
    excel.rows[0]![1] = { text: '1,200', align: 'right' };
    excel.rows[1]![1] = { text: '800', align: 'right' };
    const text = writeBack(PRICES, base, excel).text;
    expect(text.split('\n')[1]).toMatch(/\| -+: \|$/);
    expect(text).not.toContain('align');
  });

  it('右寄せの列で左に寄せたセルは、左寄せの規則になる', () => {
    const right = PRICES.replace('|------|-------|', '|------|------:|').replace('| 実装 |       |', '| 実装 |   800 |\n| 試験 |   300 |');
    const { base, excel } = opened(right);
    excel.rows[0]![1] = { text: '1,200' };
    expect(writeBack(right, base, excel).text).toContain('cell:設計/金額 { align: left }');
  });
});

describe('書き出したブック', () => {
  it('Excel で開ける形で、読み戻すと同じ表になる', () => {
    const table = parseTable(ITEMS);
    const bytes = writeXlsx(gridOfTable(table), { sheet: 'screen-items' });
    const workbook = readWorkbook(bytes);
    expect(workbook.sheets).toEqual(['screen-items']);
    const { grid } = gridOfSheet(workbook.sheet()!);
    expect(grid.header).toEqual(['分類', 'No', 'ID', '項目名', '型', '桁数']);
    expect(grid.rows[0]![5]!.text).toBe('1,000');
  });
});
