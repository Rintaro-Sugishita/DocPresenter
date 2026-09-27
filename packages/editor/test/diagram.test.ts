import { describe, expect, it } from 'vitest';
import { parseDiagram } from '@docpresenter/core';
import { applyEdit, DiagramEditError, pinNode, unpinNode, moveCallout } from '../src/index.js';

const FLOW = [
  '# 流れ',
  '',
  'flow {',
  '  start ([開始])',
  '  next  [次の画面]',
  '  done  [完了]',
  '',
  '  start --> next',
  '  next  --> done',
  '}',
  '',
  'layout {',
  '  done @ (320, 640)',
  '}',
  '',
  'style {',
  '  theme: default',
  '}',
].join('\n');

const SCREEN = [
  'free {',
  '  frame [ ]',
  '  title "見出し"',
  '}',
  '',
  'layout {',
  '  frame @ ( 40,  20) 380x330  z:-1',
  '  title @ ( 70,  50) 320x24',
  '}',
].join('\n');

const OVERLAY = [
  'overlay "../assets/login.png" {',
  '  ① @ (168, 126) -> (188, 132)  "ログイン ID"',
  '  ② @ (168, 186) -> (188, 192)  "パスワード"',
  '}',
].join('\n');

const run = (source: string, make: (f: ReturnType<typeof parseDiagram>) => ReturnType<typeof pinNode>) =>
  applyEdit(source, make(parseDiagram(source)));

const layout = (source: string) => {
  const from = source.indexOf('layout {');
  return source.slice(from, source.indexOf('}', from) + 1).split('\n');
};

describe('図形のピン留め', () => {
  it('既にある行だけが書き換わる', () => {
    const written = run(FLOW, f => pinNode(f, FLOW, 'done', { x: 300, y: 620 }));
    expect(layout(written)).toEqual(['layout {', '  done @ (300, 620)', '}']);
    expect(written.replace(/@ \(300, 620\)/, '@ (320, 640)')).toBe(FLOW);
  });

  it('自動配置の図形には行が 1 行足される', () => {
    const written = run(FLOW, f => pinNode(f, FLOW, 'next', { x: 16, y: 80 }));
    expect(layout(written)).toEqual(['layout {', '  done @ (320, 640)', '  next @ (16, 80)', '}']);
  });

  it('layout セクションが無ければ作る', () => {
    const source = 'flow {\n  a [A]\n}\n';
    const written = applyEdit(source, pinNode(parseDiagram(source), source, 'a', { x: 8, y: 8 }));
    expect(written).toBe('flow {\n  a [A]\n}\n\nlayout {\n  a @ (8, 8)\n}\n');
    expect(parseDiagram(written).layout.get('a')).toMatchObject({ x: 8, y: 8 });
  });

  it('手で揃えた桁が保たれる', () => {
    const written = run(SCREEN, f => pinNode(f, SCREEN, 'title', { x: 100, y: 8 }));
    expect(layout(written)).toContain('  title @ (100,   8) 320x24');
  });

  it('動かしても大きさと奥行きは残る', () => {
    const written = run(SCREEN, f => pinNode(f, SCREEN, 'frame', { x: 44, y: 24 }));
    expect(layout(written)).toContain('  frame @ ( 44,  24) 380x330  z:-1');
  });

  it('大きさを変える', () => {
    const written = run(SCREEN, f => pinNode(f, SCREEN, 'title', { x: 70, y: 50, width: 200, height: 30 }));
    expect(layout(written)).toContain('  title @ ( 70,  50) 200x30');
  });

  it('無い図形は止める', () => {
    expect(() => pinNode(parseDiagram(FLOW), FLOW, 'nope', { x: 0, y: 0 }))
      .toThrow(DiagramEditError);
  });
});

describe('ピンの解除', () => {
  it('行ごと消え、残りの行は動かない', () => {
    const written = run(SCREEN, f => unpinNode(f, SCREEN, 'frame'));
    expect(layout(written)).toEqual(['layout {', '  title @ ( 70,  50) 320x24', '}']);
  });

  it('最後の 1 行を消しても空の layout が残る', () => {
    const written = run(FLOW, f => unpinNode(f, FLOW, 'done'));
    expect(layout(written)).toEqual(['layout {', '}']);
    expect(parseDiagram(written).layout.size).toBe(0);
  });

  it('留めていない図形は解除できない', () => {
    expect(() => unpinNode(parseDiagram(FLOW), FLOW, 'next')).toThrow(DiagramEditError);
  });
});

describe('注釈の移動', () => {
  it('座標だけが変わり、文言はそのまま', () => {
    const written = applyEdit(
      OVERLAY,
      moveCallout(parseDiagram(OVERLAY), OVERLAY, '②', { x: 170, y: 200, targetX: 190, targetY: 206 }),
    );
    expect(written.split('\n')[2]).toBe('  ② @ (170, 200) -> (190, 206)  "パスワード"');
    expect(written.split('\n')[1]).toBe('  ① @ (168, 126) -> (188, 132)  "ログイン ID"');
  });
});
