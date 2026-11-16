// A sheet of an existing workbook, imported into a document as a table.

import { describe, expect, it } from 'vitest';
import { writeXlsx } from '@docpresenter/xlsx';
import { build, type Workspace } from '../src/index.js';

const BOOK = writeXlsx({
  header: ['品目', '数量', '金額'],
  rows: [
    [{ text: '設計' }, { text: '3' }, { text: '1,200,000', fill: '#fdf0d5' }],
    [{ text: '**実装**' }, { text: '5' }, { text: '2,500,000' }],
  ],
  merges: [],
  widths: [20, 8, 14],
}, { sheet: '内訳' });

const workspace = (files: Record<string, string>): Workspace => ({
  list: () => [...Object.keys(files), 'docs/見積.xlsx'],
  read: path => files[path],
  dataUrl: () => undefined,
  bytes: path => (path === 'docs/見積.xlsx' ? BOOK : undefined),
});

const THEME = { 'themes/default/theme.css': 'body { color: #000 }' };
const doc = (body: string): string => `---\ntitle: T\noutput: [html]\n---\n\n${body}\n`;

describe('xlsx のシートを表として取り込む', () => {
  it('シートを名指しすると、表として番号と見出しが付き、書式も載る', async () => {
    const result = await build(workspace({
      'docs/a.md': doc('# 見積\n\n@import "見積.xlsx#内訳" {#tbl-cost caption="費用の内訳"}\n\n@tbl-cost のとおり。'),
      ...THEME,
    }));
    expect(result.diagnostics.filter(one => one.severity === 'error')).toEqual([]);
    const html = result.artifacts[0]!.text!;
    expect(html).toContain('<table class="dp-table"');
    expect(html).toContain('費用の内訳');
    expect(html).toContain('表 1');
    expect(html).toContain('<strong>実装</strong>');
    expect(html).toContain('1,200,000');
    expect(html).toContain('#fdf0d5');
  });

  it('範囲を指すと、その範囲の 1 行目を見出しにする', async () => {
    const result = await build(workspace({ 'docs/a.md': doc('@import "見積.xlsx#内訳!A1:B2"'), ...THEME }));
    const html = result.artifacts[0]!.text!;
    expect(html).toContain('品目');
    expect(html).toContain('設計');
    expect(html).not.toContain('金額');
    expect(html).not.toContain('実装');
  });

  it('無いシートは、表の場所でそう言う', async () => {
    const result = await build(workspace({ 'docs/a.md': doc('@import "見積.xlsx#無い"'), ...THEME }));
    expect(result.artifacts[0]!.text!).toContain('no sheet');
  });

  it('無いファイルは、ほかの取り込みと同じく見つからないと言う', async () => {
    const result = await build(workspace({ 'docs/a.md': doc('@import "別.xlsx#内訳"'), ...THEME }));
    expect(result.diagnostics.some(one => one.severity === 'error' && one.message.includes('別.xlsx'))).toBe(true);
  });
});
