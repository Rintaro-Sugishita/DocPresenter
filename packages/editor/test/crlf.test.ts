// Table and sheet edits on a file checked out with CRLF line endings. Each one
// comes out as the same edit made on the LF file — with CRLF, and no LF line
// mixed in.

import { describe, expect, it } from 'vitest';
import { applyEdit, type Edit } from '@docpresenter/base';
import { parseDocument, parseTable, type TableFile } from '@docpresenter/markdown';
import {
  clearRange, formatTable, insertColumn, insertRow, insertSheet, mergeDown, moveSheet, pasteGrid,
  removeColumn, removeRow, removeSheet, renameSheet, setCell, setStyle,
} from '../src/index.js';

const crlf = (text: string): string => text.replace(/\r?\n/g, '\r\n');
const noLoneLf = /(?<!\r)\n/;

const TABLE = [
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
  '',
].join('\n');

const TABLE_EDITS: Record<string, (table: TableFile) => Edit> = {
  'セルを書く': t => setCell(t, 1, 1, '登録した人'),
  '行を足す': t => insertRow(t, 1),
  '最初の行を消す': t => removeRow(t, 0),
  '最後の行を消す': t => removeRow(t, 1),
  '列を足す': t => insertColumn(t, 1, '備考'),
  '列を消す': t => removeColumn(t, 1),
  '貼り付ける': t => pasteGrid(t, 0, 0, [['A', 'B'], ['C', 'D']]),
  '消去する': t => clearRange(t, { top: 0, left: 1, bottom: 1, right: 1 }),
  '結合する': t => mergeDown(t, 0, 0),
  '整形する': t => formatTable(t),
  '書式を足す': t => setStyle(t, { kind: 'column', name: '説明' }, 'fill', 'shade'),
  '最後の書式を外す': t => setStyle(t, { kind: 'header' }, 'bottom', undefined),
};

describe('CRLF の表を編集する', () => {
  for (const [name, make] of Object.entries(TABLE_EDITS)) {
    it(`${name}: LF の表で同じことをしたのと同じになり、CRLF のまま`, () => {
      const expected = crlf(applyEdit(TABLE, make(parseTable(TABLE))));
      const source = crlf(TABLE);
      const written = applyEdit(source, make(parseTable(source)));
      expect(written).toBe(expected);
      expect(written).not.toMatch(noLoneLf);
    });
  }
});

const DOC = ['# 題名', '', '---', '', '## 二枚目', '', '本文。', '', '---', '', '## 三枚目', ''].join('\n');

const SHEET_EDITS: Record<string, (source: string) => Edit> = {
  'シートを動かす': s => moveSheet(parseDocument(s), s, 3, 1),
  'シートを足す': s => insertSheet(parseDocument(s), s, 2),
  'シートを消す': s => removeSheet(parseDocument(s), s, 2),
  'シートの名前を変える': s => renameSheet(parseDocument(s), s, 2, '改めた名前'),
};

describe('CRLF の文書でシートを編集する', () => {
  for (const [name, make] of Object.entries(SHEET_EDITS)) {
    it(`${name}: LF の文書で同じことをしたのと同じになり、CRLF のまま`, () => {
      const expected = crlf(applyEdit(DOC, make(DOC)));
      const source = crlf(DOC);
      const written = applyEdit(source, make(source));
      expect(written).toBe(expected);
      expect(written).not.toMatch(noLoneLf);
    });
  }
});
