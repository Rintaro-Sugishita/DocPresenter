// The four marks added to the inline notation, in a drawing's labels and in
// the runs a slide is written from.

import { describe, expect, it } from 'vitest';
import { parseDiagram, parseRuns, renderDiagram } from '../src/index.js';

describe('取り消し線・上付き・下付き・下線（図の文字・スライド）', () => {
  it('runs に印が付く', () => {
    const runs = parseRuns('H~2~O と x^2^ と ~~消す~~ と [下線]{.underline}');
    expect(runs.find(run => run.text === '2' && run.script === 'sub')).toBeDefined();
    expect(runs.find(run => run.text === '2' && run.script === 'sup')).toBeDefined();
    expect(runs.find(run => run.text === '消す')?.strike).toBe(true);
    expect(runs.find(run => run.text === '下線')?.underline).toBe(true);
  });

  it('空白の入る ^ や、対になっていない ~ は文字のまま', () => {
    expect(parseRuns('3^2 and 4^2').map(run => run.text).join('')).toBe('3^2 and 4^2');
    expect(parseRuns('約 10~20 件').map(run => run.text).join('')).toBe('約 10~20 件');
    expect(parseRuns('x^a\\ b^').find(run => run.script === 'sup')?.text).toBe('a b');
  });

  it('SVG では線と上下の位置で描く', () => {
    const svg = renderDiagram(parseDiagram('flow {\n  a (H~2~O ~~旧~~ [新]{.underline})\n}\n'));
    expect(svg).toContain('baseline-shift="sub"');
    expect(svg).toContain('text-decoration="line-through"');
    expect(svg).toContain('text-decoration="underline"');
  });
});
