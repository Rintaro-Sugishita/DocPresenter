// Connections whose ends are groups, and the link that is not drawn (`~~~`).

import { describe, expect, it } from 'vitest';
import {
  connectNodes, DiagramParseError, formatDiagram, layOutDiagram, parseDiagram, renderDiagram, type Box,
} from '../src/index.js';

const lines = (...text: string[]): string => [...text, ''].join('\n');
const overlap = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('グループを端にした接続', () => {
  const laid = layOutDiagram(parseDiagram(lines(
    'flow LR {',
    '  a [A]', '  b [B]', '  c [C]', '  d [D]', '  e [E]',
    '  group g1 "G1" { a; b }',
    '  group g2 "G2" { c; d }',
    '  g1 --> g2',
    '  e --> g1',
    '  a --> b',
    '}',
  )));
  const box = (id: string) => laid.boxes.get(id)!;

  it('グループ同士：後ろのグループの中身は、前のグループの中身より後に並ぶ', () => {
    for (const later of ['c', 'd']) {
      for (const earlier of ['a', 'b']) expect(box(later).x).toBeGreaterThan(box(earlier).x + box(earlier).width);
    }
    expect(overlap(box('g1'), box('g2'))).toBe(false);
  });

  it('ノードからグループ：ノードはグループの手前に並び、枠に重ならない', () => {
    expect(box('e').x + box('e').width).toBeLessThan(box('g1').x);
    expect(overlap(box('e'), box('g1'))).toBe(false);
  });

  it('グループの中身を避けて回り道をしない', () => {
    const route = laid.routes.find(r => r.edge.from === 'g1' && r.edge.to === 'g2')!;
    expect(route.points).toHaveLength(2);
  });

  it('グループと、その中身との接続は並び順を変えない', () => {
    const inner = layOutDiagram(parseDiagram(lines(
      'flow {', '  a [A]', '  b [B]', '  group g "G" { a; b }', '  g --> a', '  a --> b', '}',
    )));
    expect(inner.boxes.get('b')!.y).toBeGreaterThan(inner.boxes.get('a')!.y);
  });

  it('向きを持つグループにも、グループのまま繋がる', () => {
    const directed = layOutDiagram(parseDiagram(lines(
      'flow {', '  a [A]', '  b [B]', '  c [C]', '  group g "G" LR { a; b }', '  g --> c', '}',
    )));
    const g = directed.boxes.get('g')!;
    expect(directed.boxes.get('c')!.y).toBeGreaterThan(g.y + g.height);
  });
});

describe('行き来する接続', () => {
  it('g1 --> g2 と g2 --> g1 の両方があっても、グループの中身は混ざらない', () => {
    const laid = layOutDiagram(parseDiagram(lines(
      'flow {', '  a [A]', '  b [B]', '  c [C]', '  d [D]',
      '  group g1 "G1" { a; b }', '  group g2 "G2" { c; d }',
      '  g1 --> g2', '  g2 --> g1', '}',
    )));
    const box = (id: string) => laid.boxes.get(id)!;
    expect(overlap(box('g1'), box('g2'))).toBe(false);
    for (const id of ['c', 'd']) expect(box(id).y).toBeGreaterThan(box('a').y + box('a').height);
  });
});

describe('並び順に効かせない線 ~', () => {
  const order = (...edges: string[]) => {
    const laid = layOutDiagram(parseDiagram(lines('flow {', '  a [A]', '  b [B]', ...edges.map(e => `  ${e}`), '}')));
    return laid.boxes.get('a')!.y < laid.boxes.get('b')!.y ? 'a, b' : 'b, a';
  };

  it('行き来するとき、~ の付いていない方が並び順を決める', () => {
    expect(order('a --> b', 'b --> a ~')).toBe('a, b');
    // 書いた順でも図形の順でもなく、印で決まる。
    expect(order('b --> a ~', 'a --> b')).toBe('a, b');
    expect(order('a --> b ~', 'b --> a')).toBe('b, a');
  });

  it('~ の付いた線もラベルごと描く', () => {
    const file = parseDiagram(lines('flow {', '  a [A]', '  b [B]', '  a --> b', '  b --> a "戻る" ~', '}'));
    expect(file.edges[1]).toMatchObject({ from: 'b', to: 'a', label: '戻る', loose: true });
    const svg = renderDiagram(file);
    expect(svg).toContain('data-edge="b-&gt;a"');
    expect(svg).toContain('戻る');
  });

  it('グループへの線にも付けられる', () => {
    const laid = layOutDiagram(parseDiagram(lines(
      'flow {', '  a [A]', '  c [C]', '  group g1 "G1" { a }', '  group g2 "G2" { c }',
      '  g2 --> g1 ~', '  g1 --> g2', '}',
    )));
    expect(laid.boxes.get('c')!.y).toBeGreaterThan(laid.boxes.get('a')!.y);
  });

  it('整形しても ~ は残る', () => {
    expect(formatDiagram(lines('flow {', '  a [A]', '  b [B]', '  a-->b', '  b-->a "戻る"~', '}')).text)
      .toBe(lines('flow {', '  a [A]', '  b [B]', '', '  a --> b', '  b --> a "戻る" ~', '}'));
  });

  it('~~~ には付けられない', () => {
    expect(() => parseDiagram(lines('flow {', '  a [A]', '  b [B]', '  a ~~~ b ~', '}'))).toThrow(DiagramParseError);
  });
});

describe('線が入り乱れない', () => {
  // 報告にあった図そのもの。
  const laid = layOutDiagram(parseDiagram(lines(
    'flow LR {',
    '  db   [(データベース)]', '  web  [Webサーバー]', '  app  [DBアクセス層]', '  app2 [実行層]',
    '  group appServer "Applicationサーバー" { app2; app }',
    '  db --> app "return"', '  app --> db "query" ~',
    '  app --> app2 "return"', '  app2 --> app2 "aa"', '  app2 --> app',
    '  web --> appServer', '  appServer --> appServer',
    '}',
  )));
  const routeOf = (from: string, to: string) => laid.routes.find(r => r.edge.from === from && r.edge.to === to)!;
  type P = { x: number; y: number };
  const crosses = (p: P, q: P, r: P, s: P): boolean => {
    const d = (a: P, b: P, c: P) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    return d(p, q, r) * d(p, q, s) < 0 && d(r, s, p) * d(r, s, q) < 0;
  };
  const segments = (points: readonly P[]) => points.slice(1).map((p, i) => [points[i]!, p] as const);

  it('行き来する 2 本は交差しない', () => {
    for (const [p, q] of segments(routeOf('db', 'app').points)) {
      for (const [r, s] of segments(routeOf('app', 'db').points)) expect(crosses(p, q, r, s)).toBe(false);
    }
  });

  it('グループの枠の手前で曲がる（枠に沿って走らない）', () => {
    const frame = laid.boxes.get('appServer')!;
    const turn = routeOf('db', 'app').points[1]!.x;
    expect(frame.x - turn).toBeGreaterThanOrEqual(10);
  });

  it('グループへの線は、中心ではなく相手の高さで枠に入る', () => {
    const frame = laid.boxes.get('appServer')!;
    const end = routeOf('web', 'appServer').points.at(-1)!;
    const app = laid.boxes.get('app')!;
    // DBアクセス層への線と重ならないよう、その箱より下で入る。
    expect(end.y).toBeGreaterThan(app.y + app.height);
    expect(end.y).toBeLessThan(frame.y + frame.height);
  });

  it('グループの自分への線は、中の図形の間ではなく枠の端に付く', () => {
    const frame = laid.boxes.get('appServer')!;
    const app = laid.boxes.get('app')!;
    const xs = routeOf('appServer', 'appServer').points.map(p => p.x);
    expect(Math.max(...xs)).toBeLessThan(app.x + app.width);
    expect(Math.min(...xs)).toBeGreaterThan(frame.x);
  });
});

describe('自分への接続', () => {
  it('図形の横に輪を描いて戻る', () => {
    const laid = layOutDiagram(parseDiagram(lines('flow {', '  a [A]', '  b [B]', '  a --> b', '  a --> a', '}')));
    const a = laid.boxes.get('a')!;
    const loop = laid.routes.find(r => r.edge.from === 'a' && r.edge.to === 'a')!;
    expect(loop.points).toHaveLength(4);
    expect(Math.max(...loop.points.map(p => p.x))).toBeGreaterThan(a.x + a.width);
    // 輪は並び順を変えない。
    expect(laid.boxes.get('b')!.y).toBeGreaterThan(a.y);
  });

  it('横に流れる図では下に描く', () => {
    const laid = layOutDiagram(parseDiagram(lines('flow LR {', '  a [A]', '  a --> a', '}')));
    const a = laid.boxes.get('a')!;
    expect(Math.max(...laid.routes[0]!.points.map(p => p.y))).toBeGreaterThan(a.y + a.height);
  });

  it('キャンバスからも繋げる', () => {
    const source = lines('flow {', '  a [A]', '}');
    const edit = connectNodes(parseDiagram(source), source, 'a', 'a');
    expect(edit.text).toContain('a --> a');
  });
});

describe('描かない線 ~~~', () => {
  const source = lines('flow {', '  a [A]', '  b [B]', '  a ~~~ b', '}');

  it('並び順だけを決める', () => {
    const file = parseDiagram(source);
    expect(file.edges[0]).toMatchObject({ from: 'a', to: 'b', line: 'invisible', arrow: 'none' });
    const laid = layOutDiagram(file);
    expect(laid.boxes.get('b')!.y).toBeGreaterThan(laid.boxes.get('a')!.y);
  });

  it('文書には描かず、キャンバスでは薄く描く', () => {
    expect(renderDiagram(parseDiagram(source))).not.toContain('data-edge="a-&gt;b"');
    expect(renderDiagram(parseDiagram(source), undefined, undefined, 'ja', true))
      .toContain('class="dp-edge dp-line-invisible" data-edge="a-&gt;b"');
  });

  it('ラベルは付けられない', () => {
    expect(() => parseDiagram(lines('flow {', '  a [A]', '  b [B]', '  a ~~~ b "x"', '}')))
      .toThrow(DiagramParseError);
  });

  it('整形しても ~~~ のまま', () => {
    expect(formatDiagram(lines('flow {', '  a [A]', '  b [B]', '  a~~~b', '}')).text)
      .toBe(lines('flow {', '  a [A]', '  b [B]', '', '  a ~~~ b', '}'));
  });
});
