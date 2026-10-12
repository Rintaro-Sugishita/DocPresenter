// The build, over a workspace held in memory. Everything here is about what a
// build says when something is wrong — which is most of what a build is for.

import { describe, expect, it } from 'vitest';
import { build, outputStem, readGraph, themeOf, type Workspace } from '../src/index.js';

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
    expect(page).toContain('class="dp-index dp-index-contents"');
    // 番号は組版が入れる。HTML には画面のページ番号が無いので、欄だけが空で立つ
    expect(page).toContain('<span class="dp-index-page" data-page-of="sec-1"></span>');
    expect((page.match(/class="dp-index-line"/g) ?? []).length).toBe(6);
  });

  it('節が少なければ出さない', async () => {
    expect(await html(sections(3))).not.toContain('class="dp-index dp-index-contents"');
  });

  it('要ると書いてあれば少なくても出す', async () => {
    expect(await html(sections(2), 'contents: true\n')).toContain('class="dp-index dp-index-contents"');
  });

  it('要らないと書いてあれば出さない', async () => {
    expect(await html(sections(9), 'contents: false\n')).not.toContain('class="dp-index dp-index-contents"');
  });

  it('見出しの無い文書では前付けも空にならない', async () => {
    // 表紙の事実は残る。目次だけが出ない
    const page = await html('本文だけ。');
    expect(page).not.toContain('class="dp-index dp-index-contents"');
  });

  it('深い見出しは載せない', async () => {
    const page = await html(`${sections(5)}\n\n#### 細目 {#sec-deep}\n\n本文。`);
    expect(page).not.toContain('data-page-of="sec-deep"');
  });
});

describe('図表一覧', () => {
  const TABLE = '| 見出し |\n| ------ |\n| 値     |\n';
  const imports = (count: number): string =>
    Array.from({ length: count }, (_, i) =>
      `@import "t${i + 1}.table" {#tbl-${i + 1} caption="表 ${i + 1} の説明"}`).join('\n\n');
  const files = (count: number): Record<string, string> =>
    Object.fromEntries(Array.from({ length: count }, (_, i) => [`t${i + 1}.table`, TABLE]));

  const html = async (count: number, front = ''): Promise<string> => {
    const source = `---\ntitle: T\noutput: [html]\n${front}---\n\n# 題\n\n${imports(count)}\n`;
    const result = await build(workspace({ 'a.md': source, ...files(count), ...THEME }));
    return result.artifacts[0]!.text!;
  };

  it('採番された図表から組み立てる', async () => {
    const page = await html(5);
    expect(page).toContain('class="dp-index dp-index-figures"');
    expect(page).toContain('<span class="dp-index-number">表 1</span>');
    expect(page).toContain('<span class="dp-index-text">表 1 の説明</span>');
    expect(page).toContain('<span class="dp-index-page" data-page-of="tbl-1"></span>');
  });

  it('数えるほど無ければ出さない', async () => {
    expect(await html(2)).not.toContain('class="dp-index dp-index-figures"');
  });

  it('要ると書いてあれば少なくても出す', async () => {
    expect(await html(2, 'figures: true\n')).toContain('class="dp-index dp-index-figures"');
  });

  it('要らないと書いてあれば出さない', async () => {
    expect(await html(7, 'figures: false\n')).not.toContain('class="dp-index dp-index-figures"');
  });
});

describe('web 上の画像', () => {
  const ADDRESS = 'https://example.com/diagram.png';
  const DATA = 'data:image/png;base64,iVBORw0KGgo=';
  const source = `---\ntitle: T\noutput: [html]\n---\n\n# 題\n\n@import "${ADDRESS}"\n`;

  it('ビルド時に取り込み、成果物には住所を残さない', async () => {
    const files = { 'a.md': source, ...THEME };
    const asked: string[] = [];
    const result = await build({
      ...workspace(files),
      inline: async address => { asked.push(address); return DATA; },
    });
    const page = result.artifacts[0]!.text!;
    expect(asked).toEqual([ADDRESS]);
    expect(page).toContain(`src="${DATA}"`);
    // 配ったファイルが外に取りに行かないことが、取り込む理由のすべてである
    expect(page).not.toContain(`src="${ADDRESS}"`);
  });

  it('取り込めなければ黙らず、図がそう言う', async () => {
    const result = await build({
      ...workspace({ 'a.md': source, ...THEME }),
      inline: async () => undefined,
    });
    const page = result.artifacts[0]!.text!;
    expect(page).toContain('取り込めなかった画像がある');
    expect(page).not.toContain(`src="${ADDRESS}"`);
    expect(result.diagnostics.some(d => d.message.includes('外部の画像を取り込めなかった'))).toBe(true);
  });

  it('取り込む手段の無い器では、そう報告する', async () => {
    const result = await build(workspace({ 'a.md': source, ...THEME }));
    expect(result.diagnostics.some(d =>
      d.message.includes('外部の画像を取り込めない器'))).toBe(true);
  });

  it('同じ住所を二度取りに行かない', async () => {
    const twice = `---\ntitle: T\noutput: [html]\n---\n\n# 題\n\n@import "${ADDRESS}"\n\n@import "${ADDRESS}"\n`;
    let calls = 0;
    await build({
      ...workspace({ 'a.md': twice, ...THEME }),
      inline: async () => { calls += 1; return DATA; },
    });
    expect(calls).toBe(1);
  });

  it('作業フォルダの画像は data URL で入る', async () => {
    const files = { 'a.md': `---\ntitle: T\noutput: [html]\n---\n\n# 題\n\n@import "shot.png"\n`, ...THEME };
    const result = await build({
      ...workspace(files),
      dataUrl: path => (path === 'shot.png' ? DATA : undefined),
    });
    expect(result.artifacts[0]!.text!).toContain(`src="${DATA}"`);
  });

  it('無い画像は黙って消えず、そう言う', async () => {
    const files = { 'a.md': `---\ntitle: T\noutput: [html]\n---\n\n# 題\n\n@import "none.png"\n`, ...THEME };
    expect((await build(workspace(files))).artifacts[0]!.text!).toContain('参照先が見つからない');
  });

  it('幅と寄せは文書の指示として出る', async () => {
    const files = {
      'a.md': `---\ntitle: T\noutput: [html]\n---\n\n# 題\n\n@import "shot.png" {width="55%" align="center"}\n`,
      ...THEME,
    };
    const page = (await build({ ...workspace(files), dataUrl: () => DATA })).artifacts[0]!.text!;
    expect(page).toContain('data-align="center"');
    expect(page).toContain('style="width: 55%"');
  });

  it('幅に書けない値は無視する', async () => {
    const files = {
      'a.md': `---\ntitle: T\noutput: [html]\n---\n\n# 題\n\n@import "shot.png" {width="url(javascript:alert(1))"}\n`,
      ...THEME,
    };
    const page = (await build({ ...workspace(files), dataUrl: () => DATA })).artifacts[0]!.text!;
    expect(page).not.toContain('javascript');
    expect(page).not.toContain('style="width');
  });
});

describe('書き出しのボタン（文書と形式を名指しする）', () => {
  it('output: の無い文書も、形式を言えば書ける', async () => {
    const result = await build(workspace({ 'note.md': '# メモ\n', ...THEME }), {
      only: ['note.md'], formats: ['html'],
    });
    expect(result.artifacts.map(a => a.path)).toEqual(['dist/note.html']);
  });

  it('形式を言えば output: より優先する', async () => {
    const result = await build(workspace({ 'a.md': root('# A', '[html, pptx]'), ...THEME }), {
      only: ['a.md'], formats: ['pptx'],
    });
    expect(result.artifacts.map(a => a.format)).toEqual(['pptx']);
  });

  it('形式を言わなければ、これまでどおりルートでない文書は断る', async () => {
    const result = await build(workspace({ 'note.md': '# メモ\n', ...THEME }), { only: ['note.md'] });
    expect(result.diagnostics.some(d => d.message.includes('ビルドルートではない'))).toBe(true);
  });
});

describe('Mermaid', () => {
  const doc = root(['```mermaid', 'flowchart TD', '  A --> B', '```', '',
    '```mermaid {view="code"}', 'flowchart TD', '  C --> D', '```'].join('\n'), '[html, pptx]');

  it('HTML は描くスクリプトを持つ（Mermaid が無い文書は持たない）', async () => {
    const result = await build(workspace({ 'a.md': doc, 'b.md': root('# B'), ...THEME }), {
      mermaidScript: 'window.__drawn = true;',
    });
    const html = (path: string) => result.artifacts.find(a => a.path === path)?.text ?? '';
    expect(html('dist/a.html')).toContain('<script>window.__drawn = true;</script>');
    expect(html('dist/b.html')).not.toContain('<script>');
  });

  it('スクリプトが無ければ、コードのまま出ると言う', async () => {
    const result = await build(workspace({ 'a.md': doc, ...THEME }), { formats: ['html'] });
    expect(result.diagnostics.some(d => d.message.includes('Mermaid を描くスクリプト'))).toBe(true);
  });

  it('スライドには図を絵として載せ、コード指定のものは描かない', async () => {
    const drawn: string[] = [];
    await build(workspace({ 'a.md': doc, ...THEME }), {
      formats: ['pptx'],
      mermaidPicture: async source => {
        drawn.push(source);
        return { data: 'data:image/png;base64,iVBORw0KGgo=', width: 10, height: 10 };
      },
    });
    expect(drawn).toEqual(['flowchart TD\n  A --> B']);
  });
});

describe('チームのテーマ', () => {
  it('.docpresenter/themes/ のテーマが、ルートの themes/ より先に使われる', async () => {
    const result = await build(workspace({
      'a.md': root('# A'),
      ...THEME,
      '.docpresenter/themes/default/theme.css': 'body { color: #123456 }',
    }), { formats: ['html'] });
    const html = result.artifacts[0]!.text!;
    expect(html).toContain('#123456');
    expect(html).not.toContain('color: #000');
  });

  it('文書が選んだテーマも、.docpresenter/themes/ から探す', () => {
    const files: Record<string, string> = { '.docpresenter/themes/print/theme.css': 'p {}' };
    expect(themeOf(path => files[path], 'print')).toBe('p {}');
    expect(themeOf(path => files[path], 'default')).toBeUndefined();
  });
});

describe('フォルダ分けした文書の書き出し先', () => {
  it('フォルダの構成を保つので、別のフォルダの同じ名前の文書が上書きし合わない', async () => {
    const result = await build(workspace({
      'docs/order/design.md': root('# A'),
      'docs/billing/design.md': root('# B'),
      'docs/top.md': root('# C'),
      'specs/other.md': root('# D'),
      ...THEME,
    }), { formats: ['html'] });
    expect(result.artifacts.map(a => a.path).sort()).toEqual([
      'dist/billing/design.html', 'dist/order/design.html', 'dist/specs/other.html', 'dist/top.html',
    ]);
  });

  it('docs/ は書き出し先に含めない', () => {
    expect(outputStem('docs/auth-design.md')).toBe('auth-design');
    expect(outputStem('docs/order/v1.2/design.md')).toBe('order/v1.2/design');
    expect(outputStem('README.md')).toBe('README');
  });
});
