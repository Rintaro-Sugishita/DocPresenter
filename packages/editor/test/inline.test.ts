import { describe, expect, it } from 'vitest';
import { inlineStateAt, toggleInline, type InlineMark } from '../src/index.js';

/** Applies a toggle the way a text box would, and marks the new selection. */
function apply(text: string, mark: InlineMark): string {
  const start = text.indexOf('«');
  const end = text.indexOf('»') - 1;
  const plain = text.replace(/[«»]/g, '');
  const r = toggleInline(plain, start, end, mark);
  const next = plain.slice(0, r.start) + r.text + plain.slice(r.end);
  return next.slice(0, r.select.start) + '«' + next.slice(r.select.start, r.select.end)
    + '»' + next.slice(r.select.end);
}

const stateOf = (text: string) => {
  const start = text.indexOf('«');
  const end = text.indexOf('»') - 1;
  return inlineStateAt(text.replace(/[«»]/g, ''), start, end);
};

describe('太字・斜体・コード', () => {
  it('選択範囲を囲む', () => {
    expect(apply('これは«重要»な点', 'bold')).toBe('これは**«重要»**な点');
    expect(apply('これは«重要»な点', 'italic')).toBe('これは*«重要»*な点');
    expect(apply('これは«重要»な点', 'code')).toBe('これは`«重要»`な点');
  });

  it('もう一度押すと外れる', () => {
    expect(apply('これは**«重要»**な点', 'bold')).toBe('これは«重要»な点');
    expect(apply('これは`«code»`だ', 'code')).toBe('これは«code»だ');
  });

  it('太字の中で斜体を押しても記号を食わない', () => {
    // `**` の内側の `*` を「斜体の印」と誤認すると、記法が壊れる。
    expect(apply('これは**«重要»**な点', 'italic')).toBe('これは***«重要»***な点');
  });

  it('選択の端の空白は無視する', () => {
    expect(apply('これは« 重要 »だ', 'bold')).toBe('これは **«重要»** だ');
  });

  it('いま効いている書式を答える', () => {
    expect(stateOf('a**«b»**c')).toMatchObject({ bold: true, italic: false });
    expect(stateOf('a*«b»*c')).toMatchObject({ bold: false, italic: true });
    expect(stateOf('a«b»c')).toMatchObject({ bold: false, italic: false, code: false });
  });
});

describe('意味トークン', () => {
  it('Pandoc 記法の span になる', () => {
    expect(apply('ここは«要確認»です', 'pending')).toBe('ここは[«要確認»]{.pending}です');
  });

  it('同じトークンをもう一度押すと外れる', () => {
    expect(apply('ここは[«要確認»]{.pending}です', 'pending')).toBe('ここは«要確認»です');
  });

  it('別のトークンを押すと置き換わる。二重には付かない', () => {
    expect(apply('ここは[«要確認»]{.pending}です', 'changed'))
      .toBe('ここは[«要確認»]{.changed}です');
  });

  it('いま付いているトークンを答える', () => {
    expect(stateOf('a[«b»]{.removed}c').token).toBe('removed');
    expect(stateOf('a[«b»]{.unknown}c').token).toBeUndefined();
    expect(stateOf('a«b»c').token).toBeUndefined();
  });
});
