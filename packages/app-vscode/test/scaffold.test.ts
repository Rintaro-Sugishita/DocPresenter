// Setting a folder up: what is written, what is left alone, and whether what is
// written is a document the build accepts as it stands.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { build, type Workspace } from '@docpresenter/build';
import { parseDiagram } from '@docpresenter/diagram';
import { parseTable } from '@docpresenter/markdown';
import {
  documentFiles, ensureNumber, planScaffold, renderTemplate, type ScaffoldAnswers, type Shipped,
} from '@docpresenter/build';

const GUIDE = readFileSync(new URL('../templates/guide.md', import.meta.url), 'utf-8');
const SHIPPED: Shipped = { guide: GUIDE, specs: { 'dgm.md': '# dgm\n', 'table.md': '# table\n' }, theme: 'body { color: #111 }\n' };
const ANSWERS: ScaffoldAnswers = {
  name: 'auth-design', title: '認証機能 設計書', number: 'SD-AUTH-001', today: '2026-10-06', outDir: 'out/build',
};

const plan = (existing: Record<string, string> = {}, answers = ANSWERS) =>
  planScaffold(answers, SHIPPED, path => existing[path]);

/** The folder after the plan has been written into it. */
function after(existing: Record<string, string>, answers = ANSWERS): Record<string, string> {
  const files = { ...existing };
  for (const file of plan(existing, answers).files) {
    files[file.path] = file.mode === 'append' ? `${files[file.path] ?? ''}${file.text}` : file.text;
  }
  return files;
}

describe('作業場の初期化', () => {
  it('推奨のフォルダ分けで、最初の文書と書き方の仕様書を置く', () => {
    const result = plan();
    expect(result.document).toBe('docs/auth-design.md');
    expect(result.files.map(file => file.path).sort()).toEqual([
      '.docpresenter/guide.md',
      '.docpresenter/spec/dgm.md',
      '.docpresenter/spec/table.md',
      '.docpresenter/templates/document.md',
      '.docpresenter/templates/revision.md',
      '.docpresenter/themes/default/theme.css',
      '.gitignore',
      'AGENTS.md',
      'CLAUDE.md',
      'docs/assets/.gitkeep',
      'docs/auth-design.md',
      'docs/auth-design/revision.md',
      'shared/glossary.table',
    ]);
    expect(result.kept).toEqual([]);
  });

  it('最初の文書は、そのままビルドが通る', async () => {
    const files = { ...after({}), 'themes/default/theme.css': 'body {}' };
    const workspace: Workspace = {
      list: () => Object.keys(files), read: path => files[path], dataUrl: () => undefined,
    };
    const result = await build(workspace, { formats: ['html'] });
    expect(result.diagnostics).toEqual([]);
    const html = result.artifacts[0]!.text!;
    expect(html).toContain('SD-AUTH-001');
    expect(html).toContain('改訂履歴');
    expect(html).toContain('表 1');
  });

  it('frontmatter は打たれた題を壊さない', () => {
    const text = after({}, { ...ANSWERS, title: '設計: 認証', number: undefined })['docs/auth-design.md']!;
    expect(text).toContain('title: "設計: 認証"');
    expect(text).not.toContain('document:');
    expect(text).toContain('# 設計: 認証');
  });

  it('テンプレートは差し込み口を残して置かれ、最初の文書はそれから作られる', () => {
    const files = after({});
    const template = files['.docpresenter/templates/document.md']!;
    expect(template).toContain('document: {{number}}');
    expect(template).toContain('title: {{title}}');
    expect(template).toContain('# {{title}}');
    expect(template).toContain('@import "{{name}}/revision.md"');
    expect(files['.docpresenter/templates/revision.md']).toContain('| 0.1 | {{today}} |');
    expect(files['docs/auth-design.md']).toBe(documentFiles(ANSWERS)[0]!.text);
    expect(files['.docpresenter/themes/default/theme.css']).toBe(SHIPPED.theme);
  });

  it('チームが書き換えたテンプレートが既にあれば、それを残し、最初の文書もそれから作る', () => {
    const team = '---\ntitle: {{title}}\nowner: 開発部\n---\n\n# {{title}}\n\n## 背景\n';
    const result = plan({ '.docpresenter/templates/document.md': team, '.docpresenter/themes/default/theme.css': 'h1 {}' });
    expect(result.kept).toEqual(['.docpresenter/templates/document.md', '.docpresenter/themes/default/theme.css']);
    const document = result.files.find(file => file.path === 'docs/auth-design.md')!.text;
    // The number goes in even though the team's template forgot it.
    expect(document).toBe('---\ndocument: SD-AUTH-001\ntitle: 認証機能 設計書\nowner: 開発部\n---\n\n# 認証機能 設計書\n\n## 背景\n');
  });
});

describe('テンプレートの差し込み', () => {
  const VALUES = { title: '設計: 認証', number: 'SD-001', name: 'auth', today: '2026-10-12' };

  it('frontmatter の値まるごとの差し込みは YAML として正しく、本文にはそのまま入る', () => {
    const text = renderTemplate('---\ntitle: {{title}}\nupdated: {{today}}\n---\n\n# {{title}}（{{number}}）\n', VALUES);
    expect(text).toBe('---\ntitle: "設計: 認証"\nupdated: 2026-10-12\n---\n\n# 設計: 認証（SD-001）\n');
  });

  it('知らない差し込み口はそのまま残す', () => {
    expect(renderTemplate('{{author}} / {{name}}', VALUES)).toBe('{{author}} / auth');
  });

  it('文書番号は、テンプレートに無くても空でも入る', () => {
    expect(ensureNumber('---\ntitle: a\n---\n', 'X-1')).toBe('---\ndocument: X-1\ntitle: a\n---\n');
    expect(ensureNumber('---\ndocument: ""\n---\n', 'X-1')).toBe('---\ndocument: X-1\n---\n');
    expect(ensureNumber('---\ndocument: Y-2\n---\n', 'X-1')).toBe('---\ndocument: Y-2\n---\n');
    expect(ensureNumber('# 見出しだけ\n', 'X-1')).toBe('---\ndocument: X-1\n---\n\n# 見出しだけ\n');
  });

  it('新しい文書は、リポジトリのテンプレートから作られる', () => {
    const [document, history] = documentFiles(
      { name: 'auth', title: '認証', number: 'SD-001', today: '2026-10-12' },
      { document: '---\ndocument: {{number}}\ntitle: {{title}}\n---\n\n@import "{{name}}/revision.md"\n', revision: '| {{today}} |\n' },
    );
    expect(document).toEqual({ path: 'docs/auth.md', text: '---\ndocument: SD-001\ntitle: 認証\n---\n\n@import "auth/revision.md"\n' });
    expect(history).toEqual({ path: 'docs/auth/revision.md', text: '| 2026-10-12 |\n' });
  });
});

describe('作業場の初期化（続き）', () => {
  it('既にあるファイルは書き換えず、そのままと報告する', () => {
    const result = plan({ 'docs/auth-design.md': '# 先にある\n', 'shared/glossary.table': '| a |\n|---|\n' });
    expect(result.files.some(file => file.path === 'docs/auth-design.md')).toBe(false);
    expect(result.kept).toEqual(['docs/auth-design.md', 'shared/glossary.table']);
  });

  it('CLAUDE.md と .gitignore には一度だけ追記する', () => {
    const before = { 'CLAUDE.md': '# 自分の指示', '.gitignore': 'node_modules/\n' };
    const once = after(before);
    expect(once['CLAUDE.md']).toMatch(/^# 自分の指示\n\n<!-- docpresenter:init -->/);
    expect(once['CLAUDE.md']).toContain('.docpresenter/guide.md');
    expect(once['.gitignore']).toBe('node_modules/\n\n# DocPresenter の書き出し\nout/\n*.pdf\n*.pptx\n');

    const again = plan(once);
    expect(again.files.filter(file => file.mode === 'append')).toEqual([]);
    expect(again.kept).toEqual(expect.arrayContaining(['CLAUDE.md', 'AGENTS.md', '.gitignore']));
  });

  it('書き出し先・PDF・PPTX が既に Git から外れていれば、.gitignore に足さない', () => {
    expect(plan({ '.gitignore': '/out\n*.pdf\n*.pptx\n' }).kept).toContain('.gitignore');
  });

  it('足りない行だけを足す。SVG と PNG は外さない', () => {
    const text = after({ '.gitignore': '/out\n*.pdf\n' })['.gitignore'];
    expect(text).toBe('/out\n*.pdf\n\n# DocPresenter の書き出し\n*.pptx\n');
    expect(text).not.toMatch(/svg|png/);
  });
});

describe('書き方の仕様書', () => {
  /** The fenced blocks under one heading of the guide. */
  const blocks = (heading: string): string[] => {
    const section = GUIDE.split(/^## /m).find(part => part.startsWith(heading))!;
    return [...section.matchAll(/```\n([\s\S]*?)```/g)].map(match => match[1]!);
  };

  it('図の見本は、そのまま読める', () => {
    const diagram = parseDiagram(blocks('3.')[0]!);
    expect(diagram.mode).toBe('flow');
    expect(diagram.nodes).toHaveLength(5);
    expect(diagram.edges).toHaveLength(4);
  });

  it('表の見本は、そのまま読める', () => {
    const table = parseTable(blocks('4.')[0]!);
    expect(table.columns.map(column => column.header)).toEqual(['用語', '分類', '説明']);
    expect(table.rows).toHaveLength(3);
  });
});
