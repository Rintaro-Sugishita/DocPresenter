import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDiagram } from '@docpresenter/diagram';
import { renderDiagram, renderOverlay, withParts } from '../src/index.js';

const draw = (path: string): string => renderDiagram(parseDiagram(readFileSync(path, 'utf8')));

describe('作図のレンダリング', () => {
  it('自由配置の図を描く', () => {
    const svg = draw('sample/shared/system-architecture.dgm');
    expect(svg).toContain('data-mode="free"');
    expect(svg).toContain('data-node="browser"');
    expect(svg).toContain('利用者ブラウザ');
    expect(svg).toContain('data-edge="browser-&gt;web"');
  });

  it('図形の種類が要素の形に対応する', () => {
    const svg = renderDiagram(parseDiagram(
      'free {\n a {菱}\n b ((円))\n}\nlayout {\n a @ (0,0)\n b @ (200,0)\n}'));
    expect(svg).toContain('<polygon points=');
    expect(svg).toContain('<ellipse cx=');
  });

  it('値ではなくトークンを class として出す', () => {
    const svg = draw('sample/shared/system-architecture.dgm');
    expect(svg).toContain('dp-line-dashed');          // style{} の dmz / intra
    expect(svg).not.toMatch(/fill="#/);               // 色は theme が決める
  });

  it('文字列クラスが図形に付く', () => {
    const svg = draw('sample/docs/auth-design/login-flow.dgm');
    expect(svg).toContain('dp-class-pending');
  });

  it('矢印は marker ではなく図形として描く', () => {
    // 1 ページに複数の図が載るので、id を持つ marker は使えない。
    const svg = draw('sample/docs/auth-design/login-flow.dgm');
    expect(svg).toContain('<polygon class="dp-arrow"');
    expect(svg).not.toContain('<marker');
    expect(svg).not.toContain(' id="');
  });

  it('接続線は図形の外周で止まる', () => {
    const svg = renderDiagram(parseDiagram(
      'free {\n a [A]\n b [B]\n a --> b\n}\nlayout {\n a @ (0,0) 100x50\n b @ (0,200) 100x50\n}'));
    const points = /<polyline points="([^"]+)"/.exec(svg)![1]!.split(' ').map(
      p => p.split(',').map(Number));
    // 中心 (66,41) → (66,241)。上下の辺で止まるので y は 66 と 216。
    expect(points[0]).toEqual([66, 66]);
    expect(points[1]).toEqual([66, 216]);
  });

  it('接続のラベルを線の上に置く', () => {
    const svg = draw('sample/shared/system-architecture.dgm');
    expect(svg).toContain('<text class="dp-edge-label"');
    expect(svg).toContain('HTTPS');
  });

  it('自動レイアウトの図も描ける', () => {
    const svg = draw('sample/docs/auth-design/token-lifecycle.dgm');
    expect(svg).toContain('data-mode="flow"');
    expect(svg).toContain('24 時間経過');
  });

  it('描けなかったものは注記として残す', () => {
    const svg = renderDiagram(parseDiagram('free {\n a [A]\n b [B]\n}\nlayout {\n a @ (0,0)\n}'));
    expect(svg).toContain('<!-- 配置がない: b -->');
  });
});

describe('単独の線', () => {
  const drawLine = (body: string, style = ''): string => renderDiagram(parseDiagram(
    `free {\n  rule1 --\n}\n\nlayout {\n  rule1 ${body}\n}\n`
    + (style === '' ? '' : `\nstyle {\n  rule1 { ${style} }\n}\n`)));

  it('箱の対角線として引かれる', () => {
    // 幅も高さも持つ箱に、角から角へ。高さ 0 なら水平線になる。
    expect(drawLine('@ (0, 0) 240x0')).toContain('<path d="M 16 16 L 256 16"/>');
    expect(drawLine('@ (0, 0) 0x120')).toContain('<path d="M 16 16 L 16 136"/>');
  });

  it('傾きを逆にできる', () => {
    // 箱の対角線は 2 本ある。どちらかは「どこに置いたか」では決まらない。
    expect(drawLine('@ (0, 0) 100x60', 'slope: up'))
      .toContain('<path d="M 16 76 L 116 16"/>');
  });

  it('矢印は端に付き、両端にも付く', () => {
    expect(drawLine('@ (0, 0) 100x0', 'arrow: end'))
      .toContain('<polygon class="dp-arrow" points="116,16 106,20 106,12"/>');
    const both = drawLine('@ (0, 0) 100x0', 'arrow: both');
    expect(both.match(/dp-arrow/g)).toHaveLength(2);
    expect(drawLine('@ (0, 0) 100x0')).not.toContain('dp-arrow');
  });

  it('太さは値なので、class ではなく変数で渡す', () => {
    // 1.4 も 2.5 も 4 も書ける。class にすると、どの数があるかをテーマが
    // 先に決めることになる。
    expect(drawLine('@ (0, 0) 100x0', 'weight: 2.5')).toContain('--dp-weight:2.5');
    expect(drawLine('@ (0, 0) 100x0', 'weight: 2.5')).not.toContain('dp-weight-2.5');
  });

  it('文字は持たない', () => {
    const svg = renderDiagram(parseDiagram(
      'free {\n  rule1 --\n}\nlayout {\n  rule1 @ (0,0) 100x0\n}\n'));
    expect(svg).not.toContain('<text');
  });

  it('同梱の部品として使える', () => {
    const file = withParts(parseDiagram(
      'use "default"\n\nfree {\n  sep1 divider:\n}\n\nlayout {\n  sep1 @ (0,0)\n}\n'),
    () => undefined);
    const svg = renderDiagram(file);
    expect(svg).toContain('dp-shape-line');
    expect(svg).toContain('--dp-line:#d3d7dd');
    // 既定の大きさ（320x0）が効く：水平に 320 伸びている
    expect(svg).toContain('<path d="M 16 16 L 336 16"/>');
  });
});

describe('入れ物が自分で描くもの', () => {
  it('タブの見出しは全部出る。中身は選んだ頁だけ', () => {
    const svg = renderDiagram(parseDiagram(
      'free {\n  main [ ]\n  one "基本"\n  two "住所"\n  a [あ]\n}\n'
      + 'layout {\n  main @ (0,0) 300x200\n  tabs main (show: two) { one ; two }\n'
      + '  stack one (down; pad: 0) { a }\n}\n'));
    expect(svg).toContain('class="dp-page-tab-label"');
    expect(svg).toContain('基本');
    expect(svg).toContain('住所');
    expect(svg).toContain('dp-page-tab-on');
    expect(svg).not.toContain('data-node="a"');
  });

  it('頁の名前は見出しであって、頁の中には書かれない', () => {
    const svg = renderDiagram(parseDiagram(
      'free {\n  main [ ]\n  one "基本"\n}\nlayout {\n  main @ (0,0) 300x200\n'
      + '  tabs main { one }\n}\n'));
    // 「基本」は見出しの text に 1 回だけ出る
    expect((svg.match(/基本/g) ?? []).length).toBe(1);
  });

  it('切れている一覧には、縁にバーが出る', () => {
    const svg = renderDiagram(parseDiagram(
      'free {\n  list [ ]\n  a [あ]\n  b [い]\n}\n'
      + 'layout {\n  list @ (0,0) 200x60\n  stack list (down; pad: 0; scroll) { a ; b }\n}\n'));
    expect(svg).toContain('class="dp-scroll-track"');
    expect(svg).toContain('class="dp-scroll-thumb"');
  });
});

describe('画像注釈のレンダリング', () => {
  it('画像と注釈と凡例を出す', () => {
    const diagram = parseDiagram(
      readFileSync('sample/docs/auth-design/login-screen-overlay.dgm', 'utf8'));
    const html = renderOverlay(diagram);
    expect(html).toContain('src="../assets/login-screen.png"');
    // The marker carries its own name, so an editor can find the pair it draws.
    expect(html).toContain('class="dp-callout" data-callout="①" style="left:168px;top:126px"');
    expect(html).toContain('<ol class="dp-callouts">');
    expect(html).toContain('ログイン状態を保持');
  });
});

describe('部品', () => {
  const draw = (icon: string) => renderDiagram(parseDiagram(
    `free {\n  r [ルータ]\n}\n\nlayout {\n  r @ (0, 0) 100x90\n}\n\nstyle {\n  r { icon: ${icon} }\n}`,
  ));

  it('同梱の絵はその場に描かれる', () => {
    const svg = draw('net/router');
    expect(svg).toContain('dp-part-art');
    expect(svg).toContain('dp-part');
    // 絵が図形の代わりなので、枠は描かれない。
    expect(svg).not.toContain('<rect x="0" y="0" width="100" height="90"');
    expect(svg).toContain('ルータ');
  });

  it('パスを指せば画像として貼る', () => {
    expect(draw('./icons/ec2.svg')).toContain('<image class="dp-part-image" href="./icons/ec2.svg"');
  });

  it('知らない部品は黙って消えない', () => {
    expect(draw('net/nope')).toContain('dp-missing-part');
  });
});

describe('ラベルの書式', () => {
  const draw = (text: string) =>
    renderDiagram(parseDiagram(`free {\n  a [${text}]\n}\n\nlayout {\n  a @ (0, 0) 200x60\n}`));

  it('太字・斜体・コード・色が tspan になる', () => {
    expect(draw('**強い**')).toContain('font-weight="600"');
    expect(draw('*弱い*')).toContain('font-style="italic"');
    expect(draw('`code`')).toContain('class="dp-code"');
    expect(draw('[赤]{color=#c62828}')).toContain('fill="#c62828"');
  });

  it('印そのものは描かれない', () => {
    const svg = draw('**強い**');
    expect(svg).toContain('>強い<');
    expect(svg).not.toContain('**');
  });

  it('線のラベルにも効く', () => {
    const svg = renderDiagram(parseDiagram(
      'flow {\n  a [A]\n  b [B]\n  a --> b  "**必須**"\n}'));
    expect(svg).toContain('font-weight="600"');
  });
});
