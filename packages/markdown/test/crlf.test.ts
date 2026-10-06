// Documents and tables checked out with CRLF line endings (core.autocrlf on
// Windows). Every range points at the bytes of the text the parser was given,
// and a range that ends a line ends before its CR.

import { describe, expect, it } from 'vitest';
import { sliceBytes } from '@docpresenter/base';
import { parseDocument, parseTable } from '../src/index.js';

const crlf = (text: string): string => text.replace(/\r?\n/g, '\r\n');

const DOC = [
  '---',
  'title: 認証設計',
  'output: [html, pdf]',
  '---',
  '',
  '# 認証設計 {#sec-auth}',
  '',
  '一行目の段落。',
  '二行目で @fig-login を見る。',
  '',
  '```yaml',
  '# 見出しではない',
  '---',
  '```',
  '',
  '@import "auth/login.dgm" {#fig-login}',
  '',
  '---',
  '',
  '## 二枚目',
  '',
].join('\n');

describe('CRLF の文書を読む', () => {
  const source = crlf(DOC);
  const file = parseDocument(source);

  it('front matter の値に CR が混ざらない', () => {
    expect(file.frontmatter.raw['title']).toBe('認証設計');
    expect(file.frontmatter.output).toEqual(['html', 'pdf']);
    expect(sliceBytes(source, file.frontmatter.span!.start, file.frontmatter.span!.end))
      .toBe(crlf('---\ntitle: 認証設計\noutput: [html, pdf]\n---'));
  });

  it('ブロックの範囲は、そのバイトを指し、行末の CR を含まない', () => {
    const texts = file.blocks.map(block => sliceBytes(source, block.span.start, block.span.end));
    expect(texts).toEqual([
      '# 認証設計 {#sec-auth}',
      '一行目の段落。\r\n二行目で @fig-login を見る。\r\n\r\n```yaml\r\n# 見出しではない\r\n---\r\n```',
      '@import "auth/login.dgm" {#fig-login}',
      '---',
      '## 二枚目',
    ]);
  });

  it('段落の 2 行目にある参照も、そのバイトを指す', () => {
    const prose = file.blocks.find(block => block.kind === 'prose');
    if (prose?.kind !== 'prose') throw new Error('段落が無い');
    expect(prose.references.map(ref => sliceBytes(source, ref.span.start, ref.span.end)))
      .toEqual(['@fig-login']);
  });

  it('読んだ中身は、LF の文書と同じ', () => {
    const lf = parseDocument(DOC);
    const shape = (doc: typeof lf) => doc.blocks.map(block => ({
      kind: block.kind,
      ...(block.kind === 'heading' ? { text: block.text, label: block.label } : {}),
      ...(block.kind === 'import' ? { path: block.path, label: block.label } : {}),
      ...(block.kind === 'prose' ? { text: block.text.replace(/\r/g, '') } : {}),
    }));
    expect(shape(file)).toEqual(shape(lf));
  });
});

const TABLE = [
  '# 用語集',
  '',
  '| 用語     | 説明           |',
  '| -------- | -------------- |',
  '| トークン | 認可に用いる   |',
  '| 会員     | 登録済みの利用者 |',
  '',
  'style {',
  '  header { bottom: thick }',
  '}',
  '',
].join('\n');

describe('CRLF の表を読む', () => {
  const source = crlf(TABLE);
  const table = parseTable(source);

  it('行の範囲は、後ろの行でもずれない', () => {
    expect(table.rows.map(row => sliceBytes(source, row.line.span.start, row.line.span.end)))
      .toEqual(['| トークン | 認可に用いる   |', '| 会員     | 登録済みの利用者 |']);
    expect(sliceBytes(source, table.style[0]!.span.start, table.style[0]!.span.end))
      .toBe('header { bottom: thick }');
  });

  it('セルの文字に CR が混ざらない', () => {
    expect(table.rows[1]!.cells.map(cell => cell.text)).toEqual(['会員', '登録済みの利用者']);
  });

  it('改行の種類を覚えている', () => {
    expect(table.lineEnding).toBe('\r\n');
    expect(parseTable(TABLE).lineEnding).toBe('\n');
  });
});
