// A drawing as an SVG file of its own carries the theme's drawing rules.

import { describe, expect, it } from 'vitest';
import { drawingRules, standaloneSvg } from '../src/index.js';

const THEME = [
  '/* 文書 */',
  ':root { --font-heading: "Noto Sans JP", sans-serif; }',
  'body { margin: 0; }',
  '@media print { .dp-diagram { display: none; } }',
  '.dp-diagram { max-width: 100%; margin: 0 auto; font-family: var(--font-heading); }',
  '.dp-diagram .dp-label { font-size: 14px; }',
  '.dp-diagram .a, .dp-diagram .b { fill: none; }',
  '.dp-diagram .dp-edge :is(polyline, .dp-edge-line) { stroke: #3a4048; }',
  '.dp-table .dp-diagram-ish { color: red; }',
].join('\n');

describe('単独の SVG', () => {
  it('テーマの変数と図の規則だけを取り出す', () => {
    expect(drawingRules(THEME).split('\n')).toEqual([
      ':root { --font-heading: "Noto Sans JP", sans-serif; }',
      '.dp-diagram { font-family: var(--font-heading); }',
      '.dp-diagram .dp-label { font-size: 14px; }',
      '.dp-diagram .a, .dp-diagram .b { fill: none; }',
      '.dp-diagram .dp-edge :is(polyline, .dp-edge-line) { stroke: #3a4048; }',
    ]);
  });

  it('規則は svg の中に入る', () => {
    const svg = standaloneSvg('<svg class="dp-diagram" viewBox="0 0 1 1"><g/></svg>', THEME);
    expect(svg).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<svg class="dp-diagram" viewBox="0 0 1 1">\n<style>\n:root/);
    expect(svg).toContain('</style><g/></svg>');
  });
});
