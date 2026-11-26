import { describe, expect, it } from 'vitest';
import { parseDocument, renderDocument, resolveDocument, hasMath } from '../src/index.js';

const html = (src: string): string => {
  const doc = parseDocument(src);
  return renderDocument(doc, resolveDocument(doc, () => undefined), {});
};

describe('数式', () => {
  it('$…$ は文中の数式、$$…$$ は独立した行の数式', () => {
    const out = html('# T\n\n面積は $\\pi r^2$ になる。\n\n$$\n\\frac{a}{b}\n$$\n');
    expect(out).toContain('<span class="dp-math" data-tex="\\pi r^2">');
    expect(out).toContain('<div class="dp-math dp-math-block" data-tex="\\frac{a}{b}">');
    expect(out).toContain('class="katex"');
    expect(hasMath(out)).toBe(true);
  });

  it('お金の $ やコードの中、\\$ は数式にしない', () => {
    const out = html('# T\n\n$5 と $10 の差、`$x$`、\\$y\\$\n');
    expect(hasMath(out)).toBe(false);
  });

  it('読めない TeX は、そのまま印を付けて出す', () => {
    const out = html('# T\n\n$\\frac{a$ のつづき\n');
    expect(out).toContain('dp-math-error');
  });

  it('1 行の $$ x $$ も独立した数式', () => {
    expect(html('# T\n\n$$ E = mc^2 $$\n')).toContain('dp-math-block');
  });
});
