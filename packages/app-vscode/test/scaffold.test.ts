// Setting a folder up: what is written, what is left alone, and whether what is
// written is a document the build accepts as it stands.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { build, type Workspace } from '@docpresenter/build';
import { parseDiagram } from '@docpresenter/diagram';
import { parseTable } from '@docpresenter/markdown';
import { planScaffold, type ScaffoldAnswers, type Shipped } from '../src/scaffold.js';

const GUIDE = readFileSync(new URL('../templates/guide.md', import.meta.url), 'utf-8');
const SHIPPED: Shipped = { guide: GUIDE, specs: { 'dgm.md': '# dgm\n', 'table.md': '# table\n' } };
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
    expect(once['.gitignore']).toBe('node_modules/\n\n# DocPresenter の書き出し\nout/\n');

    const again = plan(once);
    expect(again.files.filter(file => file.mode === 'append')).toEqual([]);
    expect(again.kept).toEqual(expect.arrayContaining(['CLAUDE.md', 'AGENTS.md', '.gitignore']));
  });

  it('書き出し先が既に Git から外れていれば、.gitignore に足さない', () => {
    expect(plan({ '.gitignore': '/out\n' }).kept).toContain('.gitignore');
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
