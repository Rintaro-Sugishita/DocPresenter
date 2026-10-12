// Where a review comment's words are: narrowed from what was marked, and
// followed into the file as it has been edited since.

import { describe, expect, it } from 'vitest';
import { byteLength, locateAnchor, narrowAnchor } from '../src/index.js';

const at = (text: string, piece: string) => {
  const start = byteLength(text.slice(0, text.indexOf(piece)));
  return { start, end: start + byteLength(piece), quote: piece };
};

describe('指摘の今の位置', () => {
  const before = '# 設計\n\nロックの解除は管理者による手動操作のみとする。\n';

  it('範囲がそのままなら same', () => {
    const { start, end } = at(before, '管理者');
    expect(locateAnchor(at(before, '管理者'), before)).toEqual({ start, end, state: 'same' });
  });

  it('上に行が足されても、同じ語を指す（moved）', () => {
    const now = '# 設計\n\n概要を一段落足した。\n\nロックの解除は管理者による手動操作のみとする。\n';
    expect(locateAnchor(at(before, '管理者'), now)).toEqual({ ...at(now, '管理者'), quote: undefined, state: 'moved' });
  });

  it('同じ語がいくつもあっても、指摘した版から差分をたどれば、そのものを指す', () => {
    const text = '管理者 A。\n\n管理者 B。\n';
    const second = at(text, '管理者 B');
    const anchor = { start: second.start, end: second.start + byteLength('管理者'), quote: '管理者' };
    const now = `前置きを長く書いた。\n\n${text}`;
    const found = locateAnchor(anchor, now, text);
    expect(found.state).toBe('moved');
    expect(found.start).toBe(at(now, '管理者 B').start);
  });

  it('指摘した版が無ければ、元の位置にいちばん近いものを指す', () => {
    const text = '管理者 A。\n\n管理者 B。\n';
    const second = at(text, '管理者 B');
    const anchor = { start: second.start, end: second.start + byteLength('管理者'), quote: '管理者' };
    expect(locateAnchor(anchor, `前。\n${text}`).start).toBe(at(`前。\n${text}`, '管理者 B').start);
  });

  it('範囲の行が書き換えられていれば、差分ではなく語で探す', () => {
    const anchor = at(before, '手動操作');
    const now = '# 設計\n\nロックの解除は、管理者による手動操作のみ。\n';
    expect(locateAnchor(anchor, now, before)).toMatchObject({ state: 'moved', start: at(now, '手動操作').start });
  });

  it('語が書き換えられたら、残っている部分を指して changed', () => {
    const quote = 'ロックの解除は管理者による手動操作のみとする';
    const now = '# 設計\n\nロックの解除は管理者による操作か、24 時間の経過による。\n';
    const found = locateAnchor(at(before, quote), now);
    expect(found.state).toBe('changed');
    expect(now.slice(0, 40)).toContain('ロックの解除');
  });

  it('何も残っていなければ lost。位置は元のまま', () => {
    const anchor = at(before, '手動操作のみ');
    expect(locateAnchor(anchor, '# 設計\n\n全面的に書き直した。\n')).toEqual({ start: anchor.start, end: anchor.end, state: 'lost' });
  });
});

describe('選んだ語のアンカー', () => {
  const files: Record<string, string> = {
    'docs/a.md': '本文の **管理者** による。\n\n@import "a/flow.dgm" {#fig-x}\n',
    'docs/a/flow.dgm': 'flow {\n  api [認証 API]\n}\n',
  };
  const read = (path: string) => files[path];

  it('段落の中の語は、その語だけ（書式の記号ごと）', () => {
    const block = { file: 'docs/a.md', ...at(files['docs/a.md']!, '本文の **管理者** による。') };
    expect(narrowAnchor(block, '管理者', read)).toEqual({
      anchor: { file: 'docs/a.md', ...at(files['docs/a.md']!, '管理者') }, precision: 'text',
    });
  });

  it('図の中の語は、図のファイルの中', () => {
    const block = { file: 'docs/a.md', ...at(files['docs/a.md']!, '@import "a/flow.dgm" {#fig-x}') };
    expect(narrowAnchor(block, '認証 API', read)).toEqual({
      anchor: { file: 'docs/a/flow.dgm', ...at(files['docs/a/flow.dgm']!, '認証 API') }, precision: 'text',
    });
  });

  it('見つからなければ段落の全体', () => {
    const block = { file: 'docs/a.md', ...at(files['docs/a.md']!, '本文の **管理者** による。') };
    expect(narrowAnchor(block, 'ほかの語', read).precision).toBe('block');
  });
});
