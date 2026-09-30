// The build, over a workspace held in memory. Everything here is about what a
// build says when something is wrong — which is most of what a build is for.

import { describe, expect, it } from 'vitest';
import { build, readGraph, type Workspace } from '../src/index.js';

const workspace = (files: Record<string, string>): Workspace => ({
  list: () => Object.keys(files),
  read: path => files[path],
  dataUrl: () => undefined,
});

const THEME = { 'themes/default/theme.css': 'body { color: #000 }' };

const root = (body: string, output = '[html]'): string =>
  `---\ntitle: T\noutput: ${output}\n---\n\n${body}\n`;

describe('ルート探索', () => {
  it('output: を持つ文書だけがルートになる', async () => {
    const graph = readGraph(workspace({
      'a.md': root('# A'),
      'b.md': '# B だけ\n',
      ...THEME,
    }));
    expect(graph.roots.map(r => r.path)).toEqual(['a.md']);
    expect(graph.roots[0]!.formats).toEqual(['html']);
  });

  it('ルートが 1 つも無ければ警告する', async () => {
    const graph = readGraph(workspace({ 'a.md': '# A\n' }));
    expect(graph.diagnostics.some(d => d.message.includes('ビルドするものが何も無い'))).toBe(true);
  });

  it('読めない文書は警告で、他のビルドを止めない', async () => {
    const graph = readGraph(workspace({
      'a.md': root('# A'),
      'broken.md': '# 見出し\n---\n',            // setext と区別できない `---`
      ...THEME,
    }));
    expect(graph.roots.map(r => r.path)).toEqual(['a.md']);
    expect(graph.diagnostics.some(d => d.severity === 'warning' && d.path === 'broken.md')).toBe(true);
  });
});

describe('収集', () => {
  it('参照を推移的に辿る', async () => {
    const graph = readGraph(workspace({
      'docs/a.md': root('@import "b.md"'),
      'docs/b.md': '# B\n\n@import "../shared/t.table"\n',
      'shared/t.table': '| a |\n|---|\n| 1 |\n',
      ...THEME,
    }));
    expect(graph.closure.get('docs/a.md')).toEqual(['docs/a.md', 'docs/b.md', 'shared/t.table']);
  });

  it('どのルートからも届かないファイルを警告する', async () => {
    const graph = readGraph(workspace({
      'a.md': root('# A'),
      'orphan.table': '| a |\n|---|\n| 1 |\n',
      ...THEME,
    }));
    expect(graph.orphans).toEqual(['orphan.table']);
  });

  it('注釈図が指す画像は孤児ではない', async () => {
    const graph = readGraph(workspace({
      'a.md': root('@import "shot.dgm"'),
      'shot.dgm': 'overlay "screen.png" {\n  1 @ (0, 0) -> (1, 1) "x"\n}\n',
      'screen.png': '',
      ...THEME,
    }));
    expect(graph.orphans).toEqual([]);
    expect(graph.closure.get('a.md')).toContain('screen.png');
  });

  it('参照先が無ければエラー', async () => {
    const graph = readGraph(workspace({ 'a.md': root('@import "missing.table"'), ...THEME }));
    expect(graph.diagnostics.some(d =>
      d.severity === 'error' && d.message.includes('missing.table'))).toBe(true);
  });

  it('循環参照はエラー', async () => {
    const graph = readGraph(workspace({
      'a.md': root('@import "b.md"'),
      'b.md': '# B\n\n@import "a.md"\n',
      ...THEME,
    }));
    expect(graph.diagnostics.some(d =>
      d.severity === 'error' && d.message.includes('循環'))).toBe(true);
  });
});

describe('成果物', () => {
  it('HTML は 1 枚で完結する', async () => {
    const result = await build(workspace({ 'docs/a.md': root('# A\n\n本文'), ...THEME }));
    expect(result.artifacts.map(a => a.path)).toEqual(['dist/a.html']);
    const html = result.artifacts[0]!.text!;
    expect(html).toContain('body { color: #000 }');     // テーマは埋め込む
    expect(html).not.toContain('<link');                // 外を参照しない
  });

  it('取り込んだ文書は畳まれ、出自のファイルを持つ', async () => {
    const result = await build(workspace({
      'docs/a.md': root('# A\n\n@import "../shared/part.md"'),
      'shared/part.md': '## 共有の節 {#sec-shared}\n\n本文\n',
      ...THEME,
    }));
    const html = result.artifacts[0]!.text!;
    expect(html).toContain('id="sec-shared"');
    expect(html).toContain('data-doc="shared/part.md"');
  });

  it('同じ節が、置かれた文書ごとに別の番号を得る', async () => {
    const files = {
      'one.md': root('# 一\n\n## 章 {#sec-x}\n\n@import "part.md"'),
      'two.md': root('# 二\n\n@import "part.md"'),
      'part.md': '## 共有 {#sec-shared}\n\n本文\n',
      ...THEME,
    };
    const result = await build(workspace(files));
    const numberIn = (name: string): string => {
      const html = result.artifacts.find(a => a.path.endsWith(name))!.text!;
      return /id="sec-shared"[^>]*><span class="dp-number">([\d.]+)</.exec(html)![1]!;
    };
    expect(numberIn('one.html')).toBe('2');
    expect(numberIn('two.html')).toBe('1');
  });

  it('書けない形式は黙って落とさず、そう言う', async () => {
    const result = await build(workspace({ 'a.md': root('# A', '[pdf]'), ...THEME }));
    expect(result.artifacts).toEqual([]);
    expect(result.diagnostics.some(d => d.message.includes('pdf 出力はこの環境では書けない'))).toBe(true);
  });

  it('テーマが無ければエラー', async () => {
    const result = await build(workspace({ 'a.md': root('# A') }));
    expect(result.diagnostics.some(d =>
      d.severity === 'error' && d.message.includes('テーマが見つからない'))).toBe(true);
  });

  it('ルートでないものを名指しされたらそう言う', async () => {
    const result = await build(workspace({ 'a.md': root('# A'), 'b.md': '# B\n', ...THEME }),
      { only: ['b.md'] });
    expect(result.artifacts).toEqual([]);
    expect(result.diagnostics.some(d => d.message.includes('ビルドルートではない'))).toBe(true);
  });
});

describe('目次', () => {
  const sections = (count: number): string =>
    Array.from({ length: count }, (_, i) => `## 節 ${i + 1} {#sec-${i + 1}}\n\n本文。`).join('\n\n');
  const html = async (body: string, front = ''): Promise<string> => {
    const source = `---\ntitle: T\noutput: [html]\n${front}---\n\n${body}\n`;
    const result = await build(workspace({ 'a.md': source, ...THEME }));
    return result.artifacts[0]!.text!;
  };

  it('節が揃えば見出しから組み立てる', async () => {
    const page = await html(sections(6));
    expect(page).toContain('class="dp-toc"');
    // 番号は組版が入れる。HTML には画面のページ番号が無いので、欄だけが空で立つ
    expect(page).toContain('<span class="dp-toc-page" data-page-of="sec-1"></span>');
    expect((page.match(/class="dp-toc-line"/g) ?? []).length).toBe(6);
  });

  it('節が少なければ出さない', async () => {
    expect(await html(sections(3))).not.toContain('class="dp-toc"');
  });

  it('要ると書いてあれば少なくても出す', async () => {
    expect(await html(sections(2), 'contents: true\n')).toContain('class="dp-toc"');
  });

  it('要らないと書いてあれば出さない', async () => {
    expect(await html(sections(9), 'contents: false\n')).not.toContain('class="dp-toc"');
  });

  it('見出しの無い文書では前付けも空にならない', async () => {
    // 表紙の事実は残る。目次だけが出ない
    const page = await html('本文だけ。');
    expect(page).not.toContain('class="dp-toc"');
  });

  it('深い見出しは載せない', async () => {
    const page = await html(`${sections(5)}\n\n#### 細目 {#sec-deep}\n\n本文。`);
    expect(page).not.toContain('data-page-of="sec-deep"');
  });
});
