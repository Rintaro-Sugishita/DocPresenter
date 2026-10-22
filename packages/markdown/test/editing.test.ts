// Writing Markdown by hand: lists that carry on and move, and what to offer.

import { describe, expect, it } from 'vitest';
import { completionContext, enterInList, indentListItems, labelCandidates, type TextChange } from '../src/index.js';

/** The text after a change, with `|` where the cursor lands. */
function applied(text: string, change: TextChange | undefined): string | undefined {
  if (!change) return undefined;
  const after = text.slice(0, change.start) + change.text + text.slice(change.end);
  return after.slice(0, change.select.start) + '|' + after.slice(change.select.end);
}

/** Runs `fn` with the cursor at `|`. */
function at(marked: string, fn: (text: string, start: number, end: number) => TextChange | undefined): string | undefined {
  const start = marked.indexOf('|');
  const text = marked.replace('|', '');
  return applied(text, fn(text, start, start));
}

describe('Enter で箇条書きを続ける', () => {
  const enter = (marked: string, eol?: string) => at(marked, (text, s, e) => enterInList(text, s, e, eol));

  it('同じ字下げと記号で次の項目を始める', () => {
    expect(enter('- 一つ目|')).toBe('- 一つ目\n- |');
    expect(enter('  * 子|')).toBe('  * 子\n  * |');
  });

  it('番号は次の番号にし、区切りの記号も揃える', () => {
    expect(enter('9. 九|')).toBe('9. 九\n10. |');
    expect(enter('1) 一|')).toBe('1) 一\n2) |');
  });

  it('タスクの箱は空にして引き継ぐ', () => {
    expect(enter('- [x] 済み|')).toBe('- [x] 済み\n- [ ] |');
  });

  it('カーソルの後ろの文字は次の項目に移る', () => {
    expect(enter('- 前|後')).toBe('- 前\n- |後');
  });

  it('空の項目で Enter すると箇条書きを終える', () => {
    expect(enter('- 一\n- |')).toBe('- 一\n|');
  });

  it('箇条書きでない行・記号の中・コードの中では何もしない', () => {
    expect(enter('ふつうの文|')).toBeUndefined();
    expect(enter('-| 項目')).toBeUndefined();
    expect(enter('```\n- コード|\n```')).toBeUndefined();
  });

  it('CRLF のファイルでは CRLF で改行する', () => {
    expect(enter('- 一|\r\n', '\r\n')).toBe('- 一\r\n- |\r\n');
  });
});

describe('Tab で項目を下げ・上げる', () => {
  const tab = (marked: string, outdent = false) => at(marked, (text, s, e) => indentListItems(text, s, e, outdent));

  it('上の項目の本文が始まる位置まで下げる', () => {
    expect(tab('- 親\n- |子')).toBe('- 親\n  - |子');
    expect(tab('1. 親\n2. |子')).toBe('1. 親\n   1. |子');
  });

  it('Shift+Tab で親の記号の位置まで上げ、番号は続きにする', () => {
    expect(tab('- 親\n  - |子', true)).toBe('- 親\n- |子');
    expect(tab('1. 親\n   1. |子', true)).toBe('1. 親\n2. |子');
  });

  it('下げる先が無い（最初の項目）・上げる先が無いときは何もしない', () => {
    expect(tab('- |一つ目')).toBeUndefined();
    expect(tab('- |一つ目', true)).toBeUndefined();
  });

  it('選んだ項目をまとめて動かす', () => {
    const text = '- a\n- b\n- c';
    const change = indentListItems(text, text.indexOf('b'), text.length, false)!;
    const after = text.slice(0, change.start) + change.text + text.slice(change.end);
    expect(after).toBe('- a\n  - b\n  - c');
    // The selection still covers the same words.
    expect(after.slice(change.select.start, change.select.end)).toBe('b\n  - c');
  });

  it('箇条書きでない行が混ざれば何もしない', () => {
    expect(tab('ふつう|')).toBeUndefined();
  });
});

describe('補完するもの', () => {
  const context = (marked: string) => completionContext(marked.replace('|', ''), marked.indexOf('|'));

  it('@ の後ろはラベル、@import "…" の中はパス', () => {
    expect(context('図は @fig-lo|')).toMatchObject({ kind: 'reference', typed: 'fig-lo' });
    expect(context('@import "../shared/gl|')).toMatchObject({ kind: 'import', typed: '../shared/gl' });
  });

  it('メールアドレス・コードの中では出さない', () => {
    expect(context('a@b|')).toBeUndefined();
    expect(context('`@fig|')).toBeUndefined();
    expect(context('```\n@fig|\n```')).toBeUndefined();
  });

  it('文書と取り込んだ文書のラベルを、ビルドと同じ番号で挙げる', () => {
    const files: Record<string, string> = {
      'part.md': '## 共有の節 {#sec-shared}\n',
    };
    const source = '# 本 {#sec-top}\n\n@import "a.dgm" {#fig-a caption="図 A"}\n\n@import "part.md"\n';
    const found = labelCandidates(source, path => files[path]);
    expect(found.map(one => [one.label, one.kind])).toEqual(expect.arrayContaining([
      ['sec-top', 'section'], ['fig-a', 'figure'], ['sec-shared', 'section'],
    ]));
    expect(found.find(one => one.label === 'fig-a')).toMatchObject({ number: '1', caption: '図 A' });
  });
});
