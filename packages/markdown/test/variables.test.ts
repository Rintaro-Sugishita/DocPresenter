import { describe, expect, it } from 'vitest';
import {
  documentVariables, expandVariables, parseDocument, renderDocument, resolveDocument, withVariables,
} from '../src/index.js';

const today = new Date(2026, 10, 24);

describe('変数 {{名前}}', () => {
  it('ファイル名・日付・文書情報の値を差し込む', () => {
    const names = documentVariables({ title: '{{FileTitle}} 設計書', version: 1.2, document: 'SD-001' },
      { path: 'docs/auth/login.md', today });
    expect(names.get('FileName')).toBe('login.md');
    expect(names.get('FileTitle')).toBe('login');
    expect(names.get('Date')).toBe('2026-11-24');
    expect(names.get('title')).toBe('login 設計書');
    expect(names.get('Title')).toBe('login 設計書');
    expect(names.get('DocNumber')).toBe('SD-001');
    expect(names.get('version')).toBe('1.2');
  });

  it('コードの中と、知らない名前と、一重の波括弧はそのまま', () => {
    const names = new Map([['A', 'x']]);
    const text = '{{A}} と {A} と {{B}} と `{{A}}`\n\n```\n{{A}}\n```\n';
    expect(expandVariables(text, names)).toBe('x と {A} と {{B}} と `{{A}}`\n\n```\n{{A}}\n```\n');
  });

  it('本文と見出しに描かれ、値は文字として出る', () => {
    const source = '---\ntitle: 案内\nversion: "1.0*"\n---\n\n# {{Title}}\n\n版 {{version}}、`{{version}}`、{{FileName}}\n';
    const document = parseDocument(source);
    const html = renderDocument(document, resolveDocument(document, 'ja'), { loader: { read: () => undefined }, path: 'docs/a.md' });
    expect(html).toContain('案内</h1>');
    expect(html).toContain('版 1.0*、<code>{{version}}</code>、a.md');
  });

  it('文書情報の値の中の名前は、読み込むときに埋まる', () => {
    const document = withVariables(parseDocument('---\ntitle: "{{FileTitle}}"\n---\n\n本文\n'), { path: 'x/設計.md' });
    expect(document.frontmatter.raw['title']).toBe('設計');
  });
});
