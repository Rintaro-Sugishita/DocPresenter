// Strikethrough, superscript, subscript and underline in a document and in a
// table cell, written as Pandoc writes them.

import { describe, expect, it } from 'vitest';
import { parseDocument, parseTable, resolveDocument } from '@docpresenter/markdown';
import { renderDocument, renderTable } from '../src/index.js';

const html = (body: string): string => {
  const doc = parseDocument(`# 書式\n\n${body}\n`);
  return renderDocument(doc, resolveDocument(doc), { loader: { read: () => undefined } });
};

describe('取り消し線・上付き・下付き・下線（文書）', () => {
  it('HTML の要素になる', () => {
    const out = html('H~2~O と x^2^ と ~~消す~~ と [下線]{.underline}');
    expect(out).toContain('H<sub>2</sub>O');
    expect(out).toContain('x<sup>2</sup>');
    expect(out).toContain('<s>消す</s>');
    expect(out).toContain('<u>下線</u>');
  });

  it('空白の入る ^ や、対になっていない ~ は文字のまま。\\ で空白を書ける', () => {
    expect(html('3^2 and 4^2')).toContain('3^2 and 4^2');
    expect(html('約 10~20 件')).toContain('約 10~20 件');
    expect(html('x^a\\ b^')).toContain('x<sup>a b</sup>');
  });

  it('色や太字と重ねられる', () => {
    const out = html('**[[重ね]{.underline}]{color=#c62828} と x^2^**');
    expect(out).toContain('<span style="color:#c62828"><u>重ね</u></span>');
    expect(out).toContain('<sup>2</sup></strong>');
  });

  it('表のセルでも効く', () => {
    const out = renderTable(parseTable('| 式 |\n| - |\n| H~2~O ~~旧~~ |\n'));
    expect(out).toContain('H<sub>2</sub>O');
    expect(out).toContain('<s>旧</s>');
  });
});
