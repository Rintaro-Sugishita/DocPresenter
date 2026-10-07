import { describe as group, expect, it } from 'vitest';
import { checkMessages, describeError } from '@docpresenter/base';
import {
  MARKDOWN_MESSAGES, parseDocument, parseTable, renderDocument, resolveDocument, sheetsOf,
} from '../src/index.js';

group('markdown messages', () => {
  it('has every Japanese key in English, with the same placeholders', () => {
    expect(checkMessages(MARKDOWN_MESSAGES)).toEqual([]);
  });

  it('numbers references in the locale it is given, Japanese by default', () => {
    const source = '# 題\n\n@import "a.table" {#tbl-a caption="一覧"}\n\n@tbl-a を見よ。@sec-x も。\n\n## 節 {#sec-x}\n';
    const document = parseDocument(source);
    const loader = { read: () => '| a |\n| - |\n| 1 |\n' };
    const ja = renderDocument(document, resolveDocument(document), { loader });
    expect(ja).toContain('表 1');
    expect(ja).toContain('1 節');
    const en = renderDocument(document, resolveDocument(document, 'en'), { loader });
    expect(en).toContain('Table 1');
    expect(en).toContain('Section 1');
    expect(resolveDocument(parseDocument('@fig-none'), 'en').diagnostics[0]?.message)
      .toBe('Reference not found: @fig-none');
  });

  it('names an untitled sheet in the locale', () => {
    const document = parseDocument('本文\n');
    expect(sheetsOf(document)[0]?.title).toBe('シート 1');
    expect(sheetsOf(document, undefined, 'en')[0]?.title).toBe('Sheet 1');
  });

  it('says a parse error in either language', () => {
    let caught: unknown;
    try { parseTable('just text\n'); } catch (error) { caught = error; }
    expect((caught as Error).message).toMatch(/表のグリッドが見つからない（\d+ 行目）/);
    expect(describeError(caught, 'en')).toMatch(/No table grid found \(line \d+\)/);
  });
});
