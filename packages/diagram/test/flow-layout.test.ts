import { describe, expect, it } from 'vitest';
import { layOutDiagram, parseDiagram, type LaidOutDiagram } from '../src/index.js';
import { lineText } from '../src/inline.js';
import { textWidth } from '../src/text.js';

const BREAK = String.fromCharCode(92) + 'n';

/** The shapes a connection runs through, other than its own two ends. */
function crossed(laid: LaidOutDiagram, shapes: readonly { id: string; shape: string }[]): string[] {
  const out: string[] = [];
  for (const route of laid.routes) {
    for (const node of shapes) {
      if (node.shape === 'group' || node.id === route.edge.from || node.id === route.edge.to) continue;
      const box = laid.boxes.get(node.id);
      if (!box) continue;
      const hit = route.points.slice(1).some((b, i) => {
        const a = route.points[i]!;
        for (let s = 1; s < 64; s++) {
          const x = a.x + (b.x - a.x) * s / 64;
          const y = a.y + (b.y - a.y) * s / 64;
          if (x > box.x + 1 && x < box.x + box.width - 1 && y > box.y + 1 && y < box.y + box.height - 1) return true;
        }
        return false;
      });
      if (hit) out.push(`${route.edge.from}->${route.edge.to} through ${node.id}`);
    }
  }
  return out;
}

describe('ひし形の大きさ', () => {
  const labels = [
    `在庫は${BREAK}十分にあるか`,
    `承認者が${BREAK}不在の場合は${BREAK}代理を立てるか`,
    `一${BREAK}二${BREAK}三${BREAK}四行目のテキスト`,
    '入力された金額が上限を超えているかどうか',
  ];

  for (const label of labels) {
    it(`文字がひし形の内側に収まる: ${label}`, () => {
      const laid = layOutDiagram(parseDiagram(`flow {\n  d {${label}}\n}`));
      const box = laid.boxes.get('d')!;
      const widest = Math.max(...box.lines.map(line => textWidth(lineText(line), 14)));
      // 文字の塊の角が輪郭の内側にある: |x|/(w/2) + |y|/(h/2) <= 1
      const half = { x: widest / 2, y: (box.lines.length * 20 - 6) / 2 };
      expect(half.x / (box.width / 2) + half.y / (box.height / 2)).toBeLessThanOrEqual(1);
    });
  }

  it('長い英単語はひし形の中で折り返し、横に伸びすぎない', () => {
    const box = layOutDiagram(parseDiagram(
      `flow {\n  d {erg${BREAK}gergreg${BREAK}regjriegjiroejgiorjgiorjeiogjrioevgmjrie}\n}`)).boxes.get('d')!;
    expect(box.width).toBeLessThanOrEqual(300);
    expect(box.lines.length).toBe(4);
  });

  it('短い 1 行のひし形は既定の大きさのまま', () => {
    const box = layOutDiagram(parseDiagram('flow {\n  d {入力チェック}\n}')).boxes.get('d')!;
    expect([box.width, box.height]).toEqual([150, 56]);
  });
});

describe('フローの線は図形を貫かない', () => {
  it('隣に図形がある行から 2 段先へ伸びる線', () => {
    const diagram = parseDiagram(
      'flow {\n  s [S]\n  a [A]\n  x [X]\n  b [B]\n  c [C]\n  s --> a\n  s --> x\n  a --> b\n  b --> c\n  a --> c\n}');
    expect(crossed(layOutDiagram(diagram), diagram.nodes)).toEqual([]);
  });

  it('同じ行で間に図形を挟む 2 つをつなぐ線', () => {
    const diagram = parseDiagram(
      'flow {\n  s [S]\n  a [A]\n  b [B]\n  c [C]\n  s --> a\n  s --> b\n  s --> c\n  a --> c ~\n}');
    expect(crossed(layOutDiagram(diagram), diagram.nodes)).toEqual([]);
  });

  it('戻る線と回り込む線が絡み合わない', () => {
    const diagram = parseDiagram(`flow {\n  a [A]\n  b {erg${BREAK}gergreg${BREAK}regjriegjiroejgiorjgiorjeiogjrioevgmjrie}\n`
      + '  c []\n  d [D]\n  c --> a\n  a --> b\n  b --> c\n  c --> d\n  a --> d\n}');
    const laid = layOutDiagram(diagram);
    const back = laid.routes.find(route => route.edge.from === 'c' && route.edge.to === 'a')!.points;
    const around = laid.routes.find(route => route.edge.from === 'a' && route.edge.to === 'd')!.points;
    // 2 本の線の線分どうしが交わらない
    const crosses = around.slice(1).some((q, i) => back.slice(1).some((s, j) => {
      const p = around[i]!;
      const r = back[j]!;
      const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
      if (d === 0) return false;
      const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d;
      const u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
      return t > 0 && t < 1 && u > 0 && u < 1;
    }));
    expect(crosses).toBe(false);
    expect(crossed(laid, diagram.nodes)).toEqual([]);
  });

  it('いろいろな形のフローで、どの線も図形を貫かない', () => {
    let seed = 7;
    const random = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const found: string[] = [];
    for (let g = 0; g < 150; g++) {
      const count = 4 + Math.floor(random() * 9);
      const direction = ['', ' LR', ' TD', ' BT', ' RL'][Math.floor(random() * 5)];
      const lines = [`flow${direction} {`];
      for (let i = 0; i < count; i++) lines.push(random() < 0.3 ? `  n${i} {判定${i}}` : `  n${i} [処理${i}]`);
      for (let k = 0; k < count * 1.5; k++) {
        const a = Math.floor(random() * count);
        const b = Math.floor(random() * count);
        if (a === b) continue;
        const [from, to] = random() < 0.85 ? [Math.min(a, b), Math.max(a, b)] : [Math.max(a, b), Math.min(a, b)];
        lines.push(`  n${from} --> n${to}`);
      }
      lines.push('}');
      const diagram = parseDiagram(lines.join('\n'));
      for (const one of crossed(layOutDiagram(diagram), diagram.nodes)) found.push(`#${g}: ${one}`);
    }
    expect(found).toEqual([]);
  });
});
