import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDiagram } from '@docpresenter/core';
import { renderDiagram, renderOverlay } from '../src/index.js';

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

describe('画像注釈のレンダリング', () => {
  it('画像と注釈と凡例を出す', () => {
    const diagram = parseDiagram(
      readFileSync('sample/docs/auth-design/login-screen-overlay.dgm', 'utf8'));
    const html = renderOverlay(diagram);
    expect(html).toContain('src="../assets/login-screen.png"');
    expect(html).toContain('class="dp-callout" style="left:168px;top:126px"');
    expect(html).toContain('<ol class="dp-callouts">');
    expect(html).toContain('ログイン状態を保持');
  });
});
