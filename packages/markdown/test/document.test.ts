import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DocumentParseError, expandDocument, headingsOf, importAttribute, isBuildRoot,
  parseDocument, resolveDocument, setImportAttribute, sheetsOf,
} from '../src/index.js';
import type { Heading, Import, Prose } from '../src/index.js';

/** Slices the source by byte range the way a review anchor would. */
function sliceBytes(source: string, start: number, end: number): string {
  return new TextDecoder().decode(new TextEncoder().encode(source).slice(start, end));
}

describe('frontmatter', () => {
  it('output と theme を読み、ビルドルートと判定する', () => {
    const doc = parseDocument([
      '---', 'document: SD-AUTH-001', 'theme: corporate-a4',
      'output: [pdf, html]', '---', '', '本文。',
    ].join('\n'));
    expect(doc.frontmatter.output).toEqual(['pdf', 'html']);
    expect(doc.frontmatter.theme).toBe('corporate-a4');
    expect(doc.frontmatter.raw['document']).toBe('SD-AUTH-001');
    expect(isBuildRoot(doc)).toBe(true);
  });

  it('output が無ければ部品と判定する', () => {
    expect(isBuildRoot(parseDocument('---\ntitle: x\n---\n\n本文。'))).toBe(false);
    expect(isBuildRoot(parseDocument('本文だけ。'))).toBe(false);
  });
});

describe('見出し', () => {
  it('階層とラベルを読む', () => {
    const doc = parseDocument('# 題名\n\n## 概要 {#sec-overview}');
    const [title, overview] = doc.blocks as Heading[];
    expect(title!.level).toBe(1);
    expect(title!.label).toBeUndefined();
    expect(overview!.level).toBe(2);
    expect(overview!.text).toBe('概要');
    expect(overview!.label).toBe('sec-overview');
  });
});

describe('@import', () => {
  it('パス・ラベル・属性を読む', () => {
    const doc = parseDocument('@import "a/b.dgm" {#fig-x caption="ログイン画面遷移" page=landscape}');
    const im = doc.blocks[0] as Import;
    expect(im.kind).toBe('import');
    expect(im.path).toBe('a/b.dgm');
    expect(im.label).toBe('fig-x');
    expect(im.attributes.get('caption')).toBe('ログイン画面遷移');
    expect(im.attributes.get('page')).toBe('landscape');
  });

  it('画像記法も受理する（書き戻しはしない）', () => {
    const doc = parseDocument('![認証フロー](a/b.dgm){#fig-y}');
    const im = doc.blocks[0] as Import;
    expect(im.path).toBe('a/b.dgm');
    expect(im.label).toBe('fig-y');
    expect(im.attributes.get('alt')).toBe('認証フロー');
  });

  it('旗だけの属性も読む', () => {
    const doc = parseDocument('@import "x.table" {keep-together}');
    expect((doc.blocks[0] as Import).attributes.get('keep-together')).toBe('true');
  });
});

describe('区切り', () => {
  it('--- を区切りとして読む', () => {
    const doc = parseDocument('前。\n\n---\n\n後。');
    expect(doc.blocks.map(b => b.kind)).toEqual(['prose', 'separator', 'prose']);
  });

  it('前に空行が無ければ setext 見出しと区別できないので失敗する', () => {
    expect(() => parseDocument('概要\n---\n')).toThrow(DocumentParseError);
    expect(() => parseDocument('概要\n---\n')).toThrow(/空行が必要/);
  });
});

describe('参照', () => {
  it('本文中の @fig-… を拾う', () => {
    const doc = parseDocument('遷移を @fig-login-flow に示す。用語は @tbl-glossary を参照。');
    const prose = doc.blocks[0] as Prose;
    expect(prose.references.map(r => r.label)).toEqual(['fig-login-flow', 'tbl-glossary']);
    expect(prose.references[0]!.document).toBeUndefined();
  });

  it('文書をまたぐ参照を読む', () => {
    const doc = parseDocument('詳細は @SD-LINK-002:sec-idp に定める。');
    const ref = (doc.blocks[0] as Prose).references[0]!;
    expect(ref.document).toBe('SD-LINK-002');
    expect(ref.label).toBe('sec-idp');
  });

  it('コードスパンの中は参照として拾わない', () => {
    const doc = parseDocument('`@fig-not-a-ref` は参照ではない。@fig-real は参照。');
    expect((doc.blocks[0] as Prose).references.map(r => r.label)).toEqual(['fig-real']);
  });
});

describe('バイト範囲', () => {
  it('日本語を含んでも見出しの範囲が一致する', () => {
    const source = '# 認証機能 設計書\n\n本文です。\n\n## 概要 {#sec-overview}\n';
    const doc = parseDocument(source);
    const heading = doc.blocks.find(b => b.kind === 'heading' && b.level === 2) as Heading;
    expect(sliceBytes(source, heading.span.start, heading.span.end)).toBe('## 概要 {#sec-overview}');
  });

  it('参照の範囲がその語そのものを指す', () => {
    const source = 'ログイン時の画面遷移を @fig-login-flow に示す。';
    const doc = parseDocument(source);
    const ref = (doc.blocks[0] as Prose).references[0]!;
    expect(sliceBytes(source, ref.span.start, ref.span.end)).toBe('@fig-login-flow');
  });

  it('@import の範囲が行そのものを指す', () => {
    const source = '前書き。\n\n@import "図/構成.dgm" {#fig-arch}\n\n後書き。';
    const doc = parseDocument(source);
    const im = doc.blocks.find(b => b.kind === 'import')!;
    expect(sliceBytes(source, im.span.start, im.span.end)).toBe('@import "図/構成.dgm" {#fig-arch}');
  });
});

describe('サンプルの実ファイル', () => {
  it('auth-design.md を読める', () => {
    const source = readFileSync('sample/docs/auth-design.md', 'utf8');
    const doc = parseDocument(source);

    expect(doc.frontmatter.raw['document']).toBe('SD-AUTH-001');
    expect(isBuildRoot(doc)).toBe(true);            // output: [html] を持つ
    expect(doc.frontmatter.output).toEqual(['html', 'pdf']);
    expect(doc.frontmatter.theme).toBe('default');

    const imports = doc.blocks.filter(b => b.kind === 'import') as Import[];
    // 並び全部を書き写すと、標本に 1 つ足すたびにここが壊れる。見たいのは
    // 「取り込みがラベルを持って読めている」ことなので、性質で確かめる。
    const labels = imports.map(i => i.label);
    expect(labels).toContain('fig-architecture');
    expect(labels).toContain('tbl-screen-items');
    expect(labels.indexOf('fig-login-flow')).toBeLessThan(labels.indexOf('fig-login-design'));
    // ラベルを持たないのは、図表ではない取り込み（改訂履歴）だけ
    expect(labels.filter(label => label === undefined).length).toBe(1);
    expect(new Set(labels).size).toBe(labels.length);   // 重複は無い
    // 画像も図表の 1 つ。取り込み方は作図や表と変わらない
    expect(imports.map(i => i.path)).toContain('assets/login-screen.png');
    // 委譲した図も同じ経路で読める
    expect(imports.map(i => i.path)).toContain('auth-design/login-sequence.mmd');
    expect(imports.map(i => i.path)).toContain('../shared/customer-domain.ermlx');
    // 名前付き範囲による部分参照
    expect(imports.find(i => i.label === 'tbl-glossary')!.attributes.get('rows')).toBe('認証関連');
    // 文書が文書を取り込む
    expect(imports.at(-1)!.path).toBe('auth-design/revision.md');

    const headings = doc.blocks.filter(b => b.kind === 'heading') as Heading[];
    expect(headings.filter(h => h.label !== undefined).length).toBeGreaterThan(5);

    // 本文の参照がすべてバイト範囲で指せる
    const refs = doc.blocks.flatMap(b => (b.kind === 'prose' || b.kind === 'heading') ? b.references : []);
    expect(refs.length).toBeGreaterThan(5);
    for (const r of refs) {
      expect(sliceBytes(source, r.span.start, r.span.end)).toBe(
        r.document ? `@${r.document}:${r.label}` : `@${r.label}`,
      );
    }
  });
});

describe('シート分割', () => {
  it('--- で区切られた範囲が 1 シートになる', () => {
    const doc = parseDocument('# 題名\n\n本文。\n\n---\n\n## 次\n\n本文。');
    const sheets = sheetsOf(doc);
    expect(sheets).toHaveLength(2);
    expect(sheets[0]!.blocks).toHaveLength(2);
    expect(sheets[1]!.title).toBe('次');
  });

  it('シート名は採番の結果を含む', () => {
    const doc = parseDocument('# 題名\n\n---\n\n## 認証方式\n\n---\n\n## 画面');
    const sheets = sheetsOf(doc, resolveDocument(doc));
    expect(sheets.map(s => s.title)).toEqual(['題名', '1 認証方式', '2 画面']);
  });

  it('末尾の --- も 1 枚と数える', () => {
    // 空のシートを捨てると、シートを足した直後にタブが消える。
    // 先頭の `---` は front matter の開始なので、ここでは扱わない。
    const sheets = sheetsOf(parseDocument('本文。\n\n---\n'));
    expect(sheets).toHaveLength(2);
    expect(sheets[1]!.title).toBe('シート 2');
  });

  it('シートの範囲は区切り記号そのものを含まない', () => {
    const source = '本文。\n\n---\n\n次。';
    const sheets = sheetsOf(parseDocument(source));
    expect(sliceBytes(source, sheets[0]!.span.start, sheets[0]!.span.end)).toBe('本文。');
    expect(sliceBytes(source, sheets[1]!.span.start, sheets[1]!.span.end)).toBe('次。');
  });
});

describe('見出しの一覧', () => {
  it('採番と id を添えて、読む順に返す', () => {
    const source = '# 題\n\n## 一 {#sec-one}\n\n### 一の一 {#sec-one-one}\n\n## 二 {#sec-two}\n';
    const document = parseDocument(source);
    const headings = headingsOf(document, resolveDocument(document));
    expect(headings.map(h => `${h.level}:${h.number ?? '-'}:${h.text}:${h.id ?? '-'}`)).toEqual([
      '1:-:題:-',
      '2:1:一:sec-one',
      '3:1.1:一の一:sec-one-one',
      '2:2:二:sec-two',
    ]);
  });

  it('取り込んだ文書の見出しも入る', () => {
    const root = parseDocument('# 題\n\n@import "other.md"\n');
    const expanded = expandDocument(root, 'a.md', path =>
      path === 'other.md' ? '## 別の節 {#sec-other}\n' : undefined).document;
    const headings = headingsOf(expanded, resolveDocument(expanded));
    expect(headings.map(h => h.text)).toEqual(['題', '別の節']);
  });
});

describe('@import 行の属性', () => {
  it('無いところに足す', () => {
    expect(setImportAttribute('@import "a.png"', 'width', '60%'))
      .toBe('@import "a.png" {width="60%"}');
  });

  it('あるものを書き換え、他はそのまま残す', () => {
    const line = '@import "a.png" {#fig-a caption="ログイン画面" width="40%"}';
    expect(setImportAttribute(line, 'width', '60%'))
      .toBe('@import "a.png" {#fig-a caption="ログイン画面" width="60%"}');
  });

  it('消すと属性ごと消える', () => {
    expect(setImportAttribute('@import "a.png" {width="60%" align="center"}', 'align', undefined))
      .toBe('@import "a.png" {width="60%"}');
  });

  it('最後の 1 つを消すと中括弧も消える', () => {
    expect(setImportAttribute('@import "a.png" {width="60%"}', 'width', undefined))
      .toBe('@import "a.png"');
  });

  it('空白を含む値を壊さない', () => {
    const line = '@import "a.png" {caption="ログイン 画面" width="40%"}';
    expect(setImportAttribute(line, 'align', 'center'))
      .toBe('@import "a.png" {caption="ログイン 画面" width="40%" align="center"}');
  });

  it('画像記法でも効く', () => {
    expect(setImportAttribute('![図](a.png)', 'align', 'right'))
      .toBe('![図](a.png) {align="right"}');
  });

  it('取り込み行でなければ触らない', () => {
    expect(setImportAttribute('ただの本文', 'width', '60%')).toBe('ただの本文');
  });

  it('読み出せる', () => {
    const line = '@import "a.png" {#fig-a width="60%" align="center"}';
    expect(importAttribute(line, 'width')).toBe('60%');
    expect(importAttribute(line, 'align')).toBe('center');
    expect(importAttribute(line, 'page')).toBeUndefined();
  });
});
