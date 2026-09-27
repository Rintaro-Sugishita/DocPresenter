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

describe('意味トークンの span', () => {
  it('[…]{.pending} が class 付きの span になる', () => {
    const html = render('# T\n\nここは[要確認]{.pending}です。');
    expect(html).toContain('<span class="dp-text-pending">要確認</span>');
  });

  it('中身の markdown も解釈される', () => {
    const html = render('# T\n\n[**強い**変更]{.changed}');
    expect(html).toContain('<span class="dp-text-changed"><strong>強い</strong>変更</span>');
  });

  it('語彙にないクラスは span にしない', () => {
    // 直値の色や任意のクラスを持ち込ませない。
    const html = render('# T\n\n[赤]{.red} と [青]{color:#00f}');
    expect(html).not.toContain('<span');
    expect(html).toContain('{.red}');
  });

  it('通常のリンクを壊さない', () => {
    const html = render('# T\n\n[本文](./a.md) を見よ。');
    expect(html).toContain('<a href="./a.md">本文</a>');
  });

  it('見出しの中でも効く', () => {
    const html = render('# T\n\n## [検討中]{.pending} の章');
    expect(html).toContain('<span class="dp-text-pending">検討中</span>');
  });
});

describe('範囲セレクタ', () => {
  const table = (style: string) => parseTable([
    '| 用語 | 説明 |',
    '| --- | --- |',
    '| a | 1 |',
    '| b | 2 |',
    '| c | 3 |',
    '',
    'style {',
    style,
    '}',
  ].join('\n'));

  it('範囲に塗りつぶしが効く', () => {
    const html = renderTable(table('  range:a..b { fill: changed }'));
    const rows = html.split('<tr').slice(2);
    expect(rows[0]).toContain('dp-fill-changed');
    expect(rows[1]).toContain('dp-fill-changed');
    expect(rows[2]).not.toContain('dp-fill-changed');
  });

  it('1 行だけの範囲も指せる', () => {
    const html = renderTable(table('  range:b..b { fill: pending }'));
    const rows = html.split('<tr').slice(2);
    expect(rows[0]).not.toContain('dp-fill-pending');
    expect(rows[1]).toContain('dp-fill-pending');
  });

  it('手で書いた縞は今も描画される（GUI から出さなくなっても捨てない）', () => {
    const html = renderTable(table('  row:odd { fill: #f7f8fa }'));
    const rows = html.split('<tr').slice(2);
    expect(rows[0]).toContain('background:#f7f8fa');
    expect(rows[1]).not.toContain('background:#f7f8fa');
    expect(rows[2]).toContain('background:#f7f8fa');
  });

  it('名前付き範囲でも効く', () => {
    const named = parseTable([
      '| 用語 | 説明 |', '| --- | --- |', '| a | 1 |', '| b | 2 |', '',
      'range {', '  前半: a..a', '}', '',
      'style {', '  range:前半 { fill: shade }', '}',
    ].join('\n'));
    const rows = renderTable(named).split('<tr').slice(2);
    expect(rows[0]).toContain('dp-fill-shade');
    expect(rows[1]).not.toContain('dp-fill-shade');
  });
});

describe('自由な色', () => {
  it('[…]{color=#c62828} が色付きの span になる', () => {
    const html = render('# T\n\nここは[目立たせたい]{color=#c62828}。');
    expect(html).toContain('<span style="color:#c62828">目立たせたい</span>');
  });

  it('3 桁でも書ける', () => {
    expect(render('# T\n\n[赤]{color=#f00}')).toContain('style="color:#f00"');
  });

  it('色でない値は span にしない', () => {
    // style 属性に任意の CSS が入り込む道を開けない。
    const html = render('# T\n\n[x]{color=red} [y]{color=expression(1)}');
    expect(html).not.toContain('<span');
  });

  it('表のセルにも色を直接書ける', () => {
    const table = parseTable([
      '| 用語 | 説明 |', '| --- | --- |', '| a | 1 |', '',
      'style {', '  cell:a/説明 { fill: #ffe0b2, color: #7a4a00 }', '}',
    ].join('\n'));
    const html = renderTable(table);
    expect(html).toContain('background:#ffe0b2');
    expect(html).toContain('color:#7a4a00');
    expect(html).not.toContain('dp-fill-#');
  });

  it('列幅は col に書く', () => {
    const table = parseTable([
      '| 用語 | 説明 |', '| --- | --- |', '| a | 1 |', '',
      'style {', '  col:用語 { width: 30% }', '}',
    ].join('\n'));
    const html = renderTable(table);
    expect(html).toContain('<colgroup><col style="width:30%"><col></colgroup>');
  });
});

describe('セルの中の色', () => {
  const cellWith = (body: string) => renderTable(parseTable(
    ['| 用語 | 説明 |', '| --- | --- |', `| a | ${body} |`].join('\n')));

  it('セルの一部にも色が付く', () => {
    expect(cellWith('ここは[目立つ]{color=#c62828}とする'))
      .toContain('<span style="color:#c62828">目立つ</span>');
  });

  it('色の中の markdown も効く', () => {
    expect(cellWith('[**強い**]{color=#1f5fa8}'))
      .toContain('<span style="color:#1f5fa8"><strong>強い</strong></span>');
  });

  it('色でない値は記法のまま残す', () => {
    const html = cellWith('[x]{color=red}');
    expect(html).not.toContain('<span');
    expect(html).toContain('{color=red}');
  });
});

describe('入れ子の色', () => {
  const cellWith = (body: string) => renderTable(parseTable(
    ['| 用語 | 説明 |', '| --- | --- |', `| a | ${body} |`].join('\n')));

  it('色の中の色も解釈する（セル）', () => {
    const html = cellWith('[外[内]{color=#c62828}側]{color=#1f5fa8}');
    expect(html).toContain('<span style="color:#1f5fa8">外<span style="color:#c62828">内</span>側</span>');
    expect(html).not.toContain('{color=');
  });

  it('色の中の色も解釈する（本文）', () => {
    const html = render('# T\n\n[外[内]{color=#c62828}側]{color=#1f5fa8}');
    expect(html).toContain('<span style="color:#1f5fa8">外<span style="color:#c62828">内</span>側</span>');
  });

  it('セルと本文で同じ結果になる', () => {
    const body = '**強い**と`コード`と[色]{color=#2e7d32}';
    const cell = cellWith(body);
    const prose = render(`# T\n\n${body}`);
    for (const part of ['<strong>強い</strong>', '<code>コード</code>',
      '<span style="color:#2e7d32">色</span>']) {
      expect(cell, `セル: ${part}`).toContain(part);
      expect(prose, `本文: ${part}`).toContain(part);
    }
  });
});

describe('見出しの扱い', () => {
  const styled = (...rules: string[]) => parseTable([
    '| 項目 | 値 |', '| --- | ---: |', '| a | 1.5 |', '',
    'style {', ...rules, '}',
  ].join('\n'));

  it('見出しにも inline markdown が効く', () => {
    const table = parseTable(['| 濃度 [**mol/L**] | 値 |', '| --- | --- |', '| a | 1 |'].join('\n'));
    expect(renderTable(table)).toContain('<strong>mol/L</strong>');
  });

  it('見出しにも色が付く', () => {
    const table = parseTable(
      ['| [注目]{color=#ff0000} | 値 |', '| --- | --- |', '| a | 1 |'].join('\n'));
    expect(renderTable(table)).toContain('<span style="color:#ff0000">注目</span>');
  });

  it('既定では見出しも列の寄せに従う', () => {
    const html = renderTable(styled('  header { fill: #eceef1 }'));
    expect(html).toMatch(/<th[^>]*dp-align-right[^>]*>値/);
  });

  it('見出しだけ別の寄せにできる', () => {
    // 数値は右寄せ、見出しは中央。理科系の表でよくある組み合わせ。
    const html = renderTable(styled('  header { align: center }'));
    expect(html).toMatch(/<th[^>]*dp-align-center/);
    expect(html).toMatch(/<td[^>]*dp-align-right/);
  });

  it('寄せは class を二つ出さない', () => {
    const html = renderTable(styled('  header { align: center }'));
    const th = /<th\s[^>]*>/.exec(html)![0];   // <thead> に引っかからないように
    expect(th.match(/dp-align-/g)).toHaveLength(1);
  });
});
