// Markdown tables in prose, on a slide: a native table, not the pipes as text.

import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { build, type Workspace } from '../src/index.js';

const workspace = (files: Record<string, string>): Workspace => ({
  list: () => Object.keys(files),
  read: path => files[path],
  dataUrl: () => undefined,
});

const REVISION = [
  '## 改訂履歴 {#sec-revision}',
  '',
  '版と変更点は Git の履歴が正本である。',
  '',
  '| 版 | 日付 | 変更点 |',
  '|----|:----------:|------------------------------|',
  '| 1.0 | 2026-08-14 | 初版 |',
  '| 1.1 | 2026-09-03 | ロック回数を **5 回**に変更 |',
  '| 1.2 | 2026-09-21 | 区切りは \\| で書く |',
  '',
  '以上。',
  '',
].join('\n');

/** The slides of a built deck, as their XML, in order. */
async function slides(files: Record<string, string>): Promise<string[]> {
  const result = await build(workspace({ 'themes/default/theme.css': 'body {}', ...files }));
  const pptx = result.artifacts.find(one => one.format === 'pptx')!.bytes!;
  const parts = unzipSync(pptx);
  return Object.keys(parts)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)\.xml/.exec(a)![1]) - Number(/(\d+)\.xml/.exec(b)![1]))
    .map(name => strFromU8(parts[name]!));
}

/** The text of each cell of the first table on a slide, row by row. */
function cellsOf(xml: string): string[][] {
  const table = /<a:tbl>[\s\S]*?<\/a:tbl>/.exec(xml)?.[0] ?? '';
  return [...table.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map(row =>
    [...row[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map(cell =>
      [...cell[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(found => found[1]).join('')));
}

describe('スライドの Markdown の表', () => {
  it('取り込んだ文書の表は、スライドで表になる', async () => {
    const all = await slides({
      'docs/a.md': '---\ntitle: T\noutput: [pptx]\n---\n\n# A\n\n本文。\n\n---\n\n@import "a/revision.md"\n',
      'docs/a/revision.md': REVISION,
    });
    const slide = all.find(xml => xml.includes('改訂履歴'))!;
    expect(slide).toContain('<a:tbl>');
    expect(cellsOf(slide)).toEqual([
      ['版', '日付', '変更点'],
      ['1.0', '2026-08-14', '初版'],
      ['1.1', '2026-09-03', 'ロック回数を 5 回に変更'],
      ['1.2', '2026-09-21', '区切りは | で書く'],
    ]);
    // The pipes are not left on the slide as text.
    expect(slide).not.toContain('|----|');
    // The text either side stays text.
    expect(slide).toContain('版と変更点は Git の履歴が正本である。');
    expect(slide).toContain('以上。');
  });

  it('区切り行の : のとおりに寄せる。太字は太字のまま', async () => {
    const [, slide] = await slides({ 'docs/a.md': `---\ntitle: T\noutput: [pptx]\n---\n\n# A\n\n---\n\n${REVISION}` });
    const rows = [...slide!.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map(found => found[0]);
    // The date column is centred; the others take the theme's left.
    expect(rows[1]).toMatch(/<a:pPr algn="ctr"[^>]*\/?>(?:(?!<\/a:tc>)[\s\S])*2026-08-14/);
    expect(rows[2]).toMatch(/<a:rPr[^>]*\bb="1"[^>]*>(?:(?!<\/a:r>)[\s\S])*5 回/);
  });

  it('コードの中の | は表にしない', async () => {
    const [, slide] = await slides({
      'docs/a.md': '---\ntitle: T\noutput: [pptx]\n---\n\n# A\n\n---\n\n## コード\n\n```\n| a | b |\n|---|---|\n| 1 | 2 |\n```\n',
    });
    expect(slide).not.toContain('<a:tbl>');
    expect(slide).toContain('|---|---|');
  });
});
