import { describe, expect, it } from 'vitest';
import { layOutDiagram, parseDiagram, renderDiagram, type LaidOutDiagram } from '../src/index.js';

/** 交差する線が必ず出る図。a と f が b と e を逆の順に指す。 */
const CROSSING = `flow TB {
  a [aa]
  b [bb]
  c [cc]
  d [d]
  e [e]
  f [f]

  a --> b
  a --> c
  a --> d
  a --> e
  f --> e
  f --> b
}`;

/** その跨ぎが乗っている区間。無ければ undefined。 */
function runUnder(laid: LaidOutDiagram, at: { x: number; y: number }) {
  for (const route of laid.routes) {
    if (!route.hops.some(hop => hop.x === at.x && hop.y === at.y)) continue;
    for (let i = 0; i + 1 < route.points.length; i++) {
      const p = route.points[i]!;
      const q = route.points[i + 1]!;
      const between = (lo: number, hi: number, v: number) => v >= Math.min(lo, hi) && v <= Math.max(lo, hi);
      if (Math.abs(p.y - q.y) < 0.5 && Math.abs(p.y - at.y) < 0.5 && between(p.x, q.x, at.x)) {
        return { route, flat: true };
      }
      if (Math.abs(p.x - q.x) < 0.5 && Math.abs(p.x - at.x) < 0.5 && between(p.y, q.y, at.y)) {
        return { route, flat: false };
      }
    }
  }
  return undefined;
}

describe('交差点では片方が跨ぐ', () => {
  it('流れを横切るほうが跨ぎ、流れに沿うほうは切れない', () => {
    const laid = layOutDiagram(parseDiagram(CROSSING));
    const all = laid.routes.flatMap(r => r.hops);
    expect(all.length).toBeGreaterThan(0);
    // 上から下へ流れる図なので、跨ぐのは横に走る区間だけ。
    for (const hop of all) expect(runUnder(laid, hop)?.flat).toBe(true);
  });

  it('ひとつの交差点で跨ぐのは片方だけ', () => {
    const laid = layOutDiagram(parseDiagram(CROSSING));
    const seen = new Map<string, number>();
    for (const route of laid.routes) {
      for (const hop of route.hops) {
        const key = `${hop.x},${hop.y}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    for (const [, count] of seen) expect(count).toBe(1);
  });

  it('横に流れる図では、縦に走るほうが跨ぐ', () => {
    const laid = layOutDiagram(parseDiagram(CROSSING.replace('flow TB {', 'flow LR {')));
    const all = laid.routes.flatMap(r => r.hops);
    expect(all.length).toBeGreaterThan(0);
    for (const hop of all) expect(runUnder(laid, hop)?.flat).toBe(false);
  });

  it('交差しない図には跨ぎを描かない', () => {
    const laid = layOutDiagram(parseDiagram('flow {\n  a [A]\n  b [B]\n  c [C]\n  a --> b\n  a --> c\n}'));
    expect(laid.routes.flatMap(r => r.hops)).toEqual([]);
    expect(renderDiagram(parseDiagram('flow {\n  a [A]\n  b [B]\n  a --> b\n}'))).not.toContain(' A 5 5 ');
  });

  it('跨ぎは弧として描かれ、線はその先へ続く', () => {
    const svg = renderDiagram(parseDiagram(CROSSING));
    const hop = /<path class="dp-edge-line" d="[^"]*?L (\d+) (\d+) A 5 5 0 0 ([01]) (\d+) \2[^"]*"/.exec(svg);
    expect(hop).not.toBeNull();
    // 弧は線の上を直径 2 分だけ進む。線の向きが変われば回り方も変わる。
    expect(Number(hop![4]) - Number(hop![1])).toBe(hop![3] === '1' ? 10 : -10);
  });

  it('図形の中に隠れる交差には描かない', () => {
    const laid = layOutDiagram(parseDiagram(CROSSING));
    for (const hop of laid.routes.flatMap(r => r.hops)) {
      for (const box of laid.boxes.values()) {
        const inside = hop.x > box.x && hop.x < box.x + box.width
          && hop.y > box.y && hop.y < box.y + box.height;
        expect(inside).toBe(false);
      }
    }
  });
});

describe('戻る線は、ほかの線が来る側の反対から出る', () => {
  it('グループの中の分岐を横切らずに上がる', () => {
    const source = [
      'flow {',
      '  login ([ログイン])', '  q ([特殊画面])', '  stop [中断]', '  done [完了]', '  again [再開]',
      '  group g "グループ" { q; stop; done; again }',
      '  login --> q', '  q --> stop', '  q --> done', '  q --> again', '  again --> login',
      '}',
    ].join('\n');
    const laid = layOutDiagram(parseDiagram(source), 'ja');
    const into = laid.routes.find(r => r.edge.from === 'q' && r.edge.to === 'again')!.points;
    const back = laid.routes.find(r => r.edge.from === 'again' && r.edge.to === 'login')!.points;
    // The line coming in turns across at the height of its first corner; the
    // line going back climbs on the far side of where that one arrives.
    const arrives = into[into.length - 1]!.x;
    const from = into[0]!.x;
    const leaves = back[0]!.x;
    expect(Math.sign(leaves - arrives)).toBe(Math.sign(arrives - from) || 1);
  });
});
