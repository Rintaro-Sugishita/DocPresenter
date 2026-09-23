import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { parseDocument, resolveDocument } from '@docpresenter/core';
import { renderDocument, renderTable } from '../src/index.js';
import { parseTable } from '@docpresenter/core';

/** Loads referenced files relative to the document, as the CLI will. */
const loaderFor = (documentPath: string) => ({
  read(path: string) {
    try { return readFileSync(resolvePath(dirname(documentPath), path), 'utf8'); }
    catch { return undefined; }
  },
});

const render = (source: string, loader = { read: () => undefined }) => {
  const doc = parseDocument(source);
  return renderDocument(doc, resolveDocument(doc), { loader });
};

describe('文書のレンダリング', () => {
  it('見出しに算出した番号が付く', () => {
    const html = render('# 題名\n\n## 概要 {#sec-o}');
    expect(html).toContain('<h2 id="sec-o"');
    expect(html).toContain('<span class="dp-number">1</span> 概要');
  });

  it('本文の改行はそのまま改行になる', () => {
    // 設計書は意図的に短い行で書く。行を勝手につなぐと、読む文と書いた文が食い違う。
    const html = render('# T\n\n一行目\n二行目');
    expect(html).toContain('一行目<br>\n二行目');
  });

  it('参照が「図 N」のリンクになる', () => {
    const html = render('# T\n\n@import "a.dgm" {#fig-a}\n\n遷移を @fig-a に示す。');
    expect(html).toContain('href="#fig-a"');
    expect(html).toContain('>図 1</a>');
  });

  it('参照の data-span が置換後でなく元の @label を指す', () => {
    const source = '# T\n\n@import "a.dgm" {#fig-a}\n\n遷移を @fig-a に示す。';
    const html = render(source);
    const m = /data-ref="fig-a" data-span="(\d+),(\d+)"/.exec(html)!;
    const bytes = new TextEncoder().encode(source);
    const sliced = new TextDecoder().decode(bytes.slice(Number(m[1]), Number(m[2])));
    expect(sliced).toBe('@fig-a');
  });

  it('--- は罫線ではなくシートの境界になる', () => {
    const html = render('前。\n\n---\n\n後。');
    expect(html).toContain('<section class="dp-sheet" data-sheet="1"');
    expect(html).toContain('<section class="dp-sheet" data-sheet="2"');
    expect(html).not.toContain('<hr');
  });

  it('シート名は最初の見出しから計算する', () => {
    const html = render('# 題名\n\n---\n\n## 認証方式\n\n本文。');
    expect(html).toContain('data-title="題名"');
    expect(html).toContain('data-title="1 認証方式"');
  });

  it('見出しの無いシートには通し番号を付ける', () => {
    const html = render('本文だけ。');
    expect(html).toContain('data-title="シート 1"');
  });

  it('参照先が無ければ黙って消さず、見つからないと出す', () => {
    const html = render('# T\n\n@import "missing.table" {#tbl-x}');
    expect(html).toContain('dp-missing');
    expect(html).toContain('missing.table');
  });

  it('data-span でソースを切り出せる', () => {
    const source = '# 認証機能 設計書\n\n本文です。\n\n## 概要 {#sec-o}';
    const html = render(source);
    const bytes = new TextEncoder().encode(source);
    for (const m of html.matchAll(/data-span="(\d+),(\d+)"/g)) {
      const text = new TextDecoder().decode(bytes.slice(Number(m[1]), Number(m[2])));
      expect(text.length).toBeGreaterThan(0);
    }
    const heading = /<h2[^>]*data-span="(\d+),(\d+)"/.exec(html)!;
    expect(new TextDecoder().decode(bytes.slice(Number(heading[1]), Number(heading[2]))))
      .toBe('## 概要 {#sec-o}');
  });
});

describe('表のレンダリング', () => {
  const table = parseTable([
    '| 分類 | 項目 | 説明 |', '|------|------|:----:|',
    '| 認証 | 方式 | **OAuth** |', '| ^    | 期限 | `int` |',
    '', 'style {', '  theme: grid', '  header { bottom: thick }',
    '  col:分類 { right: thick }', '  cell:認証/説明 { fill: changed }', '}',
  ].join('\n'));

  it('結合が rowspan になる', () => {
    const html = renderTable(table);
    expect(html).toContain('rowspan="2"');
    const body = html.slice(html.indexOf('<tbody>'));
    expect(body.match(/<tr[ >]/g)).toHaveLength(2);
    expect(body.match(/<td/g)).toHaveLength(5);    // 2x3 から結合で 1 つ減る
  });

  it('寄せが区切り行から来る', () => {
    expect(renderTable(table)).toContain('dp-align-center');
  });

  it('スタイルの値がトークンのままクラスになる（直値を出さない）', () => {
    const html = renderTable(table);
    expect(html).toContain('dp-bottom-thick');
    expect(html).toContain('dp-right-thick');
    expect(html).toContain('dp-fill-changed');
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it('セル内のインライン Markdown を描く', () => {
    const html = renderTable(table);
    expect(html).toContain('<strong>OAuth</strong>');
    expect(html).toContain('<code>int</code>');
  });
});

describe('サンプルの実ファイル', () => {
  it('auth-design.md を丸ごと描ける', () => {
    const path = 'sample/docs/auth-design.md';
    const source = readFileSync(path, 'utf8');
    const doc = parseDocument(source);
    const html = renderDocument(doc, resolveDocument(doc), { loader: loaderFor(path) });

    expect(html).toContain('>図 2</a>');                    // 本文の @fig-login-flow
    expect(html).toContain('図 2</span> ログイン画面遷移');   // その図のキャプション
    expect(html).toContain('rowspan="3"');                  // 項目定義表の結合
    expect(html).not.toContain('dp-missing');               // 参照はすべて解決
  });
});

describe('名前付き範囲による部分参照', () => {
  const glossary = readFileSync('sample/shared/glossary.table', 'utf8');
  const loader = { read: () => glossary };

  it('rows で指定した範囲だけを描く', () => {
    const html = render('# T\n\n@import "g.table" {#tbl-g rows="認証関連"}', loader);
    expect(html).toContain('アクセストークン');
    expect(html).toContain('セッションキャッシュ');
    expect(html).not.toContain('IdP');           // 範囲外は出さない
    expect(html).not.toContain('DMZ');
  });

  it('範囲が無ければ黙って全部出さず、見つからないと出す', () => {
    const html = render('# T\n\n@import "g.table" {#tbl-g rows="無い範囲"}', loader);
    expect(html).toContain('dp-missing');
    expect(html).toContain('無い範囲');
  });
});

describe('未知の属性', () => {
  it('黙って無視せず警告する', () => {
    const doc = parseDocument('# T\n\n@import "a.dgm" {#fig-a typo-attr=1}');
    const r = resolveDocument(doc);
    expect(r.diagnostics.map(d => d.message)).toContain("未知の属性 'typo-attr' は無視される");
  });
});
