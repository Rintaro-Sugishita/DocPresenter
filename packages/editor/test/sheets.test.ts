import { describe, expect, it } from 'vitest';
import { parseDocument, sheetsOf } from '@docpresenter/core';
import { applyEdit, insertSheet, moveSheet, removeSheet, renameSheet, SheetEditError } from '../src/index.js';

const DOC = ['# 題名', '', '---', '', '## 二枚目', '', '本文。', '', '---', '', '## 三枚目'].join('\n');

const titles = (source: string): string[] =>
  sheetsOf(parseDocument(source)).map(sheet => sheet.title);

const run = (source: string, edit: ReturnType<typeof moveSheet>): string =>
  applyEdit(source, edit);

describe('シートの並べ替え', () => {
  it('前へ動かす', () => {
    const source = run(DOC, moveSheet(parseDocument(DOC), DOC, 3, 1));
    expect(titles(source)).toEqual(['三枚目', '題名', '二枚目']);
  });

  it('後ろへ動かす', () => {
    const source = run(DOC, moveSheet(parseDocument(DOC), DOC, 1, 3));
    expect(titles(source)).toEqual(['二枚目', '三枚目', '題名']);
  });

  it('動かさなかったシートの本文には触らない', () => {
    const source = run(DOC, moveSheet(parseDocument(DOC), DOC, 1, 2));
    expect(source).toContain('## 二枚目\n\n本文。');
  });

  it('触らない範囲はバイト単位でそのまま残る', () => {
    // 3 枚目だけを動かすなら、1 枚目は 1 バイトも変わってはならない。
    const source = '# 題名\n\n\n本文。\n\n---\n\n## 二\n\n---\n\n## 三';
    const moved = run(source, moveSheet(parseDocument(source), source, 3, 2));
    expect(moved.startsWith('# 題名\n\n\n本文。')).toBe(true);
  });

  it('無いシートを指したら落ちる', () => {
    expect(() => moveSheet(parseDocument(DOC), DOC, 4, 1)).toThrow(SheetEditError);
  });
});

describe('シートの追加', () => {
  it('指定したシートの後ろに空のシートができる', () => {
    const source = run(DOC, insertSheet(parseDocument(DOC), DOC, 1));
    expect(titles(source)).toEqual(['題名', 'シート 2', '二枚目', '三枚目']);
  });

  it('末尾にも足せる', () => {
    const source = run(DOC, insertSheet(parseDocument(DOC), DOC, 3));
    expect(titles(source)).toEqual(['題名', '二枚目', '三枚目', 'シート 4']);
  });
});

describe('シートの削除', () => {
  it('間のシートを消しても区切りは 1 個のまま', () => {
    const source = run(DOC, removeSheet(parseDocument(DOC), DOC, 2));
    expect(titles(source)).toEqual(['題名', '三枚目']);
    expect(source).not.toContain('---\n\n---');
  });

  it('先頭のシートも消せる', () => {
    const source = run(DOC, removeSheet(parseDocument(DOC), DOC, 1));
    expect(titles(source)).toEqual(['二枚目', '三枚目']);
    expect(source.startsWith('## 二枚目')).toBe(true);
  });

  it('最後の 1 枚は消せない', () => {
    const one = '# 題名';
    expect(() => removeSheet(parseDocument(one), one, 1)).toThrow(SheetEditError);
  });
});

describe('シートの改名', () => {
  it('名前の出どころである見出しを書き換える', () => {
    const source = run(DOC, renameSheet(parseDocument(DOC), DOC, 2, '認証方式'));
    expect(titles(source)).toEqual(['題名', '認証方式', '三枚目']);
  });

  it('ラベルは保たれる', () => {
    const doc = '# T\n\n---\n\n## 旧 {#sec-x}';
    const source = run(doc, renameSheet(parseDocument(doc), doc, 2, '新'));
    expect(source).toContain('## 新 {#sec-x}');
  });

  it('見出しの無いシートは改名できない', () => {
    const doc = '# T\n\n---\n\n本文だけ。';
    expect(() => renameSheet(parseDocument(doc), doc, 2, '名前')).toThrow(SheetEditError);
  });
});
