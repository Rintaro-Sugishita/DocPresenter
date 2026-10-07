import { describe, expect, it } from 'vitest';
import { checkMessages } from '@docpresenter/base';
import { build, BUILD_MESSAGES, type Workspace } from '../src/index.js';

const workspace = (files: Record<string, string>): Workspace => ({
  list: () => Object.keys(files),
  read: path => files[path],
});

const FILES = {
  'themes/default/theme.css': '',
  'docs/a.md': '---\ntitle: A\ndocument: DOC-1\nversion: 1.0\noutput: [html]\ncontents: true\n---\n\n# A\n\n## 概要 {#sec-a}\n\n@import "t.table" {#tbl-t caption="一覧"}\n\n@tbl-t を見よ。\n',
  'docs/t.table': '| a |\n| - |\n| 1 |\n',
  'docs/stray.dgm': 'free {\n  a [A]\n}\n',
};

describe('build messages', () => {
  it('has every Japanese key in English, with the same placeholders', () => {
    expect(checkMessages(BUILD_MESSAGES)).toEqual([]);
  });

  it('writes the cover, the indexes and the numbers in Japanese unless told otherwise', async () => {
    const ja = await build(workspace(FILES));
    const html = ja.artifacts[0]?.text ?? '';
    expect(html).toContain('<html lang="ja">');
    expect(html).toContain('文書番号');
    expect(html).toContain('表 1');
    expect(ja.diagnostics.find(d => d.path === 'docs/stray.dgm')?.message).toBe('どの成果物にも含まれていない');
  });

  it('writes them in English for a builder who reads English', async () => {
    const en = await build(workspace(FILES), { locale: 'en' });
    const html = en.artifacts[0]?.text ?? '';
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Document No.');
    expect(html).toContain('Table 1');
    expect(html).not.toContain('文書番号');
    const orphan = en.diagnostics.find(d => d.path === 'docs/stray.dgm');
    expect(orphan?.message).toBe('Not part of any output');
    expect(orphan?.id).toBe('build.orphan');
  });
});
