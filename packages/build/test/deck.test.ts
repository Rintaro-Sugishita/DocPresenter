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

/** Where a slide's first table sits and how it is cut up, in EMU. */
function geometry(xml: string) {
  const frame = /<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/.exec(xml)![0];
  const ext = /<p:xfrm>[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"/.exec(frame)!;
  return {
    name: /<p:cNvPr[^>]*name="([^"]*)"/.exec(frame)![1]!,
    width: Number(ext[1]),
    height: Number(ext[2]),
    columns: [...frame.matchAll(/<a:gridCol w="(\d+)"/g)].map(found => Number(found[1])),
    rows: [...frame.matchAll(/<a:tr h="(\d+)"/g)].map(found => Number(found[1])),
  };
}

/** The slide's usable width, as write.ts lays it out: 16:9, less 0.55 in either side. */
const SLIDE_WIDTH = 12192000 - Math.round(914400 * 0.55) * 2;

describe('スライドの表の大きさ', () => {
  const doc = (body: string) => ({
    'docs/a.md': `---\ntitle: T\noutput: [pptx]\n---\n\n# A\n\n---\n\n## 表\n\n${body}\n`,
  });

  it('行が少ない表は、スライドの高さいっぱいに広がらない', async () => {
    const [, slide] = await slides(doc('| 版 | 日付 |\n|---|---|\n| 1.0 | 2026-10-08 |\n'));
    const table = geometry(slide!);
    // Two rows of one line each: well under an inch, not most of the slide.
    expect(table.rows).toHaveLength(2);
    expect(table.height).toBeLessThan(914400);
    expect(table.height).toBe(table.rows.reduce((a, b) => a + b, 0));
  });

  it('幅の指定の無い表は、中身の幅で、長い列ほど広い', async () => {
    const [, slide] = await slides(doc('| 版 | 変更点 |\n|---|---|\n| 1.0 | 画面の流れとロック回数の説明を追加した |\n'));
    const table = geometry(slide!);
    expect(table.width).toBeLessThan(SLIDE_WIDTH);
    expect(table.columns[1]!).toBeGreaterThan(table.columns[0]! * 3);
  });

  it('.table の % の幅は、そのとおりの割合になる。表はスライドの幅いっぱい', async () => {
    const [, slide] = await slides({
      ...doc('@import "a/t.table" {#tbl-t}'),
      'docs/a/t.table': '| 区分 | 説明 |\n|---|---|\n| A | 短い |\n\nstyle {\n  col:区分 { width: 20% }\n}\n',
    });
    const table = geometry(slide!);
    expect(Math.abs(table.width - SLIDE_WIDTH)).toBeLessThan(10);
    expect(table.columns[0]! / table.width).toBeCloseTo(0.2, 2);
    expect(table.columns[1]! / table.width).toBeCloseTo(0.8, 2);
  });

  it('長い文の行は折り返す分だけ高くなる', async () => {
    const long = 'とても長い説明。'.repeat(40);
    const [, slide] = await slides(doc(`| 項目 | 説明 |\n|---|---|\n| 短い | 一行 |\n| 長い | ${long} |\n`));
    const table = geometry(slide!);
    expect(table.rows[2]!).toBeGreaterThan(table.rows[1]! * 2);
  });

  it('表のあとの文は、表のすぐ下に来る', async () => {
    const [, slide] = await slides(doc('| 版 | 日付 |\n|---|---|\n| 1.0 | 2026-10-08 |\n\n以上。'));
    const table = geometry(slide!);
    const tableTop = Number(/<p:graphicFrame>[\s\S]*?<a:off x="\d+" y="(\d+)"/.exec(slide!)![1]);
    const after = [...slide!.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map(found => found[0]).find(shape => shape.includes('以上。'))!;
    const afterTop = Number(/<a:off x="\d+" y="(\d+)"/.exec(after)![1]);
    expect(afterTop - (tableTop + table.height)).toBeLessThan(914400 / 4);
  });

  it('表は書かれたファイルの名前で載る', async () => {
    const [, slide] = await slides(doc('| a | b |\n|---|---|\n| 1 | 2 |\n'));
    expect(geometry(slide!).name).toMatch(/^dp:table=docs\/a\.md;sum=[0-9a-f]{8}$/);
  });
});
