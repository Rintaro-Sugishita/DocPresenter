// Strikethrough, superscript, subscript and underline, written as Pandoc
// writes them: `~~消す~~`, `x^2^`, `H~2~O`, `[下線]{.underline}`.

import { describe, expect, it } from 'vitest';
import { inlineStateAt, toggleInline, type InlineMark } from '../src/index.js';

/** The text after pressing `mark` with `selected` selected. */
const press = (text: string, selected: string, mark: InlineMark, from = 0): string => {
  const start = text.indexOf(selected, from);
  const change = toggleInline(text, start, start + selected.length, mark);
  return text.slice(0, change.start) + change.text + text.slice(change.end);
};

describe('取り消し線・上付き・下付き・下線', () => {
  it('付けて、もう一度押すと外す', () => {
    expect(press('a b c', 'b', 'strike')).toBe('a ~~b~~ c');
    expect(press('a ~~b~~ c', 'b', 'strike')).toBe('a b c');
    expect(press('x2', '2', 'sup')).toBe('x^2^');
    expect(press('x^2^', '2', 'sup')).toBe('x2');
    expect(press('H2O', '2', 'sub')).toBe('H~2~O');
    expect(press('H~2~O', '2', 'sub')).toBe('H2O');
    expect(press('a b c', 'b', 'underline')).toBe('a [b]{.underline} c');
    expect(press('a [b]{.underline} c', 'b', 'underline')).toBe('a b c');
  });

  it('印ごと選んでも外せる', () => {
    expect(press('a ~~b~~ c', '~~b~~', 'strike')).toBe('a b c');
    expect(press('a [b]{.underline} c', '[b]{.underline}', 'underline')).toBe('a b c');
  });

  it('上付き・下付きの中の空白は \\ と書き、外すと戻す（Pandoc の決まり）', () => {
    expect(press('x a b', 'a b', 'sup')).toBe('x ^a\\ b^');
    expect(press('x ^a\\ b^', 'a\\ b', 'sup')).toBe('x a b');
  });

  it('いま付いているものが分かる。~~ の中は下付きではない', () => {
    const struck = 'a ~~b~~ c';
    const at = struck.indexOf('b');
    expect(inlineStateAt(struck, at, at + 1)).toMatchObject({ strike: true, sub: false });
    expect(inlineStateAt('H~2~O', 2, 3)).toMatchObject({ sub: true, strike: false });
    expect(inlineStateAt('x^2^', 2, 3)).toMatchObject({ sup: true });
    expect(inlineStateAt('[b]{.underline}', 1, 2)).toMatchObject({ underline: true });
  });
});
