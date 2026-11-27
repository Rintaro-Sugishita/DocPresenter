import { describe, expect, it } from 'vitest';
import { formatMarkdownTables, markdownTables, splitMarkdownTables, tableFromTsv } from '../src/index.js';

describe('文書に直接書いた表の整形', () => {
  it('表だけを揃え、ほかの行はそのまま返す', () => {
    const source = [
      '# 見出し',
      '',
      '本文 | 縦棒を含む',
      '',
      '|項目|金額|',
      '|---|--:|',
      '|交通費|35,000円|',
      '|宿泊|8,000円|',
      '',
      '```',
      '|a|b|',
      '|-|-|',
      '```',
      '',
    ].join('\n');
    const formatted = formatMarkdownTables(source);
    expect(formatted).toContain([
      '| 項目   | 金額     |',
      '| ------ | -------: |',
      '| 交通費 | 35,000円 |',
      '| 宿泊   | 8,000円  |',
    ].join('\n'));
    expect(formatted.startsWith('# 見出し\n\n本文 | 縦棒を含む\n\n')).toBe(true);
    // A table in a code block is code, not a table.
    expect(formatted).toContain('```\n|a|b|\n|-|-|\n```');
    expect(formatMarkdownTables(formatted)).toBe(formatted);
  });

  it('リストの下に字下げした表は字下げを保つ', () => {
    const source = '- 一覧\n\n  |a|b|\n  |-|-|\n  |1|2|\n';
    expect(markdownTables(source)).toEqual([{ first: 2, last: 4 }]);
    expect(formatMarkdownTables(source)).toContain('  | a   | b   |\n  | --- | --- |\n  | 1   | 2   |');
  });
});

describe('文書に直接書いた表を .table に分ける', () => {
  it('表ごとに連番のファイルにし、取り込み行に置き換える', () => {
    const source = '# 題\n\n|a|b|\n|-|-|\n|1|2|\n\n本文\n\n|c|\n|-|\n|3|\n';
    const split = splitMarkdownTables(source, 'docs/design.md', new Set(['docs/design/table-1.table']));
    expect(split.tables.map(one => one.path)).toEqual(['docs/design/table-2.table', 'docs/design/table-3.table']);
    expect(split.tables[0]!.text).toBe('| a   | b   |\n| --- | --- |\n| 1   | 2   |\n');
    expect(split.text).toBe('# 題\n\n@import "design/table-2.table"\n\n本文\n\n@import "design/table-3.table"\n');
  });

  it('選んだ表だけを分ける', () => {
    const source = '|a|\n|-|\n\n|b|\n|-|\n';
    const split = splitMarkdownTables(source, 'x.md', new Set(), [3]);
    expect(split.text).toBe('|a|\n|-|\n\n@import "x/table-1.table"\n');
  });
});

describe('Excel からコピーした表', () => {
  it('タブ区切りを md の表にする。改行を含むセルは引用符で囲まれて来る', () => {
    const tsv = '項目\t金額\r\n交通費\t35,000円\r\n"備考\r\n2 行"\ta|b\r\n';
    expect(tableFromTsv(tsv)).toBe([
      '| 項目         | 金額     |',
      '| ------------ | -------- |',
      '| 交通費       | 35,000円 |',
      '| 備考<br>2 行 | a\\|b     |',
    ].join('\n'));
  });

  it('タブの無い文字は表にしない', () => {
    expect(tableFromTsv('ただの文')).toBeUndefined();
  });
});
