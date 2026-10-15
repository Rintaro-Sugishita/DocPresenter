import { describe, expect, it } from 'vitest';
import { applyEdit } from '@docpresenter/base';
import { completeDiagram, layOutDiagram, parseDiagram, reconnect, renderDiagram } from '../src/index.js';

const heads = (svg: string, edge: string): number => {
  const group = new RegExp(`<g [^>]*data-edge="${edge.replace('>', '&gt;')}"[^>]*>(.*?)</g>`).exec(svg)
    ?? new RegExp(`<g [^>]*data-edge="${edge}"[^>]*>(.*?)</g>`).exec(svg);
  return (group?.[1]!.match(/class="dp-arrow"/g) ?? []).length;
};

describe('両端の矢印', () => {
  it('<-->・<->・<-.-> は両端に矢印のある 1 本の線', () => {
    const { edges } = parseDiagram('flow {\n  a [A]\n  b [B]\n  c [C]\n  a <--> b "双方向"\n  b <-.-> c\n  a <-> c\n}');
    expect(edges.map(e => [e.from, e.to, e.line, e.arrow, e.label ?? '']))
      .toEqual([['a', 'b', 'solid', 'both', '双方向'], ['b', 'c', 'dashed', 'both', ''], ['a', 'c', 'solid', 'both', '']]);
  });

  it('空白を挟まなくても読める', () => {
    expect(parseDiagram('flow {\n  a [A]\n  b [B]\n  a<-->b\n}').edges[0]!.arrow).toBe('both');
  });

  it('矢印は書いたとおりの数だけ描く', () => {
    const svg = renderDiagram(parseDiagram('flow {\n  a [A]\n  b [B]\n  c [C]\n  a <--> b\n  b --> c\n  a -- c\n}'));
    expect([heads(svg, 'a->b'), heads(svg, 'b->c'), heads(svg, 'a->c')]).toEqual([2, 1, 0]);
  });

  it('端を付け替えても、書いた接続記号は残る', () => {
    const source = 'flow {\n  a [A]\n  b [B]\n  c [C]\n  a <-.-> b "x"\n}';
    const written = applyEdit(source, reconnect(parseDiagram(source), source, { from: 'a', to: 'b' }, { to: 'c' }));
    expect(written).toContain('a <-.-> c "x"');
  });

  it('補完に両端の矢印も出る。< から打ち始めても絞り込める', () => {
    const at = (marked: string): string[] => {
      const lines = marked.split('\n');
      const line = lines.findIndex(one => one.includes('|'));
      return completeDiagram(marked.replace('|', ''), line, lines[line]!.indexOf('|'), {}).map(one => one.label);
    };
    expect(at('flow {\n  a [A]\n  a <|\n}')).toEqual(['<-->', '<-.->']);
    expect(at('flow {\n  a [A]\n  b [B]\n  a <--> |\n}')).toEqual(['b']);
  });
});

describe('同じ 2 つの図形を結ぶ線', () => {
  const PAIR = 'flow TD {\n  b {{B}}\n  c [/C/]\n  c -.-> b\n  b -.-> c\n}';

  it('行きと帰りは重ねずに並べて描く（重なった破線は実線に見えてしまう）', () => {
    const { routes } = layOutDiagram(parseDiagram(PAIR));
    const [there, back] = routes.map(route => route.points);
    // 縦の流れなので横にずらす。どちらもまっすぐのまま
    expect(there![0]!.x).not.toBe(back![0]!.x);
    expect(there![0]!.x).toBe(there![there!.length - 1]!.x);
    expect(back![0]!.x).toBe(back![back!.length - 1]!.x);
    expect(Math.abs(there![0]!.x - back![0]!.x)).toBe(18);
  });

  it('ラベルがあれば、ラベルの分だけ離す', () => {
    const { routes } = layOutDiagram(parseDiagram('flow LR {\n  a [A]\n  b [B]\n  a --> b "行き"\n  b --> a "帰り"\n}'));
    const [there, back] = routes.map(route => route.points);
    expect(Math.abs(there![0]!.y - back![0]!.y)).toBe(26);
  });

  it('1 本だけなら中心を結ぶ', () => {
    const { routes, boxes } = layOutDiagram(parseDiagram('flow {\n  a [A]\n  b [B]\n  a --> b\n}'));
    const a = boxes.get('a')!;
    expect(routes[0]!.points[0]!.x).toBe(a.x + a.width / 2);
  });

  it('自由配置でも、斜めの線に対して横に並べる', () => {
    const { routes } = layOutDiagram(parseDiagram(
      'free {\n  a [A]\n  b [B]\n  a --> b\n  b --> a\n}\nlayout {\n  a @ (0, 0)\n  b @ (300, 200)\n}'));
    const [there, back] = routes.map(route => route.points);
    // 平行で、互いに離れている
    const slope = (p: { x: number; y: number }[]): number => (p[1]!.y - p[0]!.y) / (p[1]!.x - p[0]!.x);
    expect(slope(there! as never)).toBeCloseTo(slope(back! as never), 6);
    expect(Math.hypot(there![0]!.x - back![1]!.x, there![0]!.y - back![1]!.y)).toBeGreaterThan(10);
  });

  it('ずらした線も、図形の縁でまっすぐ止まる', () => {
    const svg = renderDiagram(parseDiagram(PAIR));
    const lines = [...svg.matchAll(/class="dp-edge-line" d="([^"]+)"/g)];
    expect(lines).toHaveLength(2);
    for (const [, d] of lines) {
      const xs = [...d!.matchAll(/[ML]\s*([\d.-]+)[ ,]([\d.-]+)/g)].map(m => Number(m[1]));
      expect(new Set(xs).size).toBe(1);
    }
  });
});
