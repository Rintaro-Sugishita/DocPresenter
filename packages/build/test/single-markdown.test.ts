import { describe, expect, it } from 'vitest';
import { readGraph, singleMarkdown, type Workspace } from '../src/index.js';

const workspace = (files: Record<string, string>): Workspace => ({
  list: () => Object.keys(files),
  read: path => files[path],
});

describe('1 つの md に書き出す', () => {
  it('章・表・図を取り込み、番号を文字で書く', () => {
    const files = {
      'docs/a.md': '---\ntitle: 案内\noutput: [html]\n---\n\n# {{Title}}\n\n## 概要 {#sec-a}\n\n@tbl-x と @fig-y を見る。`@tbl-x` はそのまま。\n\n@import "a/x.table" {#tbl-x caption="一覧"}\n\n@import "a/y.dgm" {#fig-y caption="流れ"}\n\n@import "a/part.md"\n',
      'docs/a/x.table': '|項目|値|\n|-|-|\n|a|1|\n',
      'docs/a/y.dgm': 'flow {\n  a --> b\n}\n',
      'docs/a/part.md': '## 詳細\n\n本文\n',
    };
    const ws = workspace(files);
    const root = readGraph(ws).roots.find(one => one.path === 'docs/a.md')!;
    const result = singleMarkdown(ws, root, { out: 'out/a.md', theme: '.dp-diagram { color: red }', locale: 'ja' });
    expect(result.text).toContain('# 案内');
    expect(result.text).toContain('## 1 概要');
    expect(result.text).toContain('表 1 と 図 1 を見る。`@tbl-x` はそのまま。');
    expect(result.text).toContain('**表 1　一覧**\n\n| 項目 | 値  |');
    expect(result.text).toContain('![表 1　一覧'.replace('表 1　一覧', '図 1　流れ') + '](a-figures/y.svg)\n\n**図 1　流れ**');
    expect(result.text).toContain('## 2 詳細\n\n本文');
    expect([...result.files.keys()]).toEqual(['out/a-figures/y.svg']);
    expect(result.files.get('out/a-figures/y.svg')).toContain('<svg');
  });
});
