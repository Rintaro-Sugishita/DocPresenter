import { describe, expect, it } from 'vitest';
import { layOutDiagram, parseDiagram, type EdgeRoute, type LaidOutDiagram } from '../src/index.js';

/** How close two lines may run side by side before they read as one. */
const TOGETHER = 6;
/** How much of a shared run it takes before the two cannot be told apart. */
const ENOUGH = 8;

function segments(route: EdgeRoute): { a: { x: number; y: number }; b: { x: number; y: number } }[] {
  return route.points.slice(1).map((b, i) => ({ a: route.points[i]!, b }));
}

/**
 * Every place two connections are drawn on top of each other: two straight
 * runs along the same line, overlapping for long enough to read as one.
 *
 * Two things that look like this are left out, because both are how a drawing
 * is meant to read. A pair written both ways round runs side by side on
 * purpose, a label's width apart. And two lines leaving one shape by the same
 * point share a stem before they fork, which is how a tree is drawn — so an
 * overlap that covers the point both of them start or end at is the fork, not
 * two lines confused.
 */
function doubled(laid: LaidOutDiagram): string[] {
  const out: string[] = [];
  const name = (r: EdgeRoute): string => `${r.edge.from}->${r.edge.to}`;
  const same = (p: { x: number; y: number }, q: { x: number; y: number }): boolean =>
    Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
  for (let i = 0; i < laid.routes.length; i++) {
    for (let j = i + 1; j < laid.routes.length; j++) {
      const one = laid.routes[i]!;
      const other = laid.routes[j]!;
      if ([one.edge.from, one.edge.to].sort().join() === [other.edge.from, other.edge.to].sort().join()) {
        continue;
      }
      // The points the two of them share, if any: where a stem forks.
      const stems = [
        same(one.points[0]!, other.points[0]!) ? one.points[0]! : undefined,
        same(one.points.at(-1)!, other.points.at(-1)!) ? one.points.at(-1)! : undefined,
      ].filter(p => p !== undefined);
      // The stretch is the fork itself only when the shared point lies on it.
      const forked = (low: number, high: number, flat: boolean, at: number): boolean =>
        stems.some(p => Math.abs((flat ? p.y : p.x) - at) < TOGETHER
          && (flat ? p.x : p.y) >= low - 0.5 && (flat ? p.x : p.y) <= high + 0.5);

      for (const p of segments(one)) {
        for (const q of segments(other)) {
          const isFlat = (s: typeof p): boolean => Math.abs(s.a.y - s.b.y) < 0.5;
          const isUpright = (s: typeof p): boolean => Math.abs(s.a.x - s.b.x) < 0.5;
          const overlap = (pl: number, ph: number, ql: number, qh: number): [number, number] =>
            [Math.max(Math.min(pl, ph), Math.min(ql, qh)), Math.min(Math.max(pl, ph), Math.max(ql, qh))];
          if (isFlat(p) && isFlat(q) && Math.abs(p.a.y - q.a.y) < TOGETHER) {
            const [low, high] = overlap(p.a.x, p.b.x, q.a.x, q.b.x);
            if (high - low > ENOUGH && !forked(low, high, true, p.a.y)) {
              out.push(`${name(one)} along ${name(other)} at y=${p.a.y}`);
            }
          }
          if (isUpright(p) && isUpright(q) && Math.abs(p.a.x - q.a.x) < TOGETHER) {
            const [low, high] = overlap(p.a.y, p.b.y, q.a.y, q.b.y);
            if (high - low > ENOUGH && !forked(low, high, false, p.a.x)) {
              out.push(`${name(one)} along ${name(other)} at x=${p.a.x}`);
            }
          }
        }
      }
    }
  }
  return [...new Set(out)];
}

describe('連なる線が重ならない', () => {
  it('同じ段へ向かう何本もの線が、互いの上に描かれない', () => {
    // 2 枚目の報告: どの矢印がどこへ向かうのか読めなくなっていた図。
    const laid = layOutDiagram(parseDiagram(`flow TB {
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
}`));
    expect(doubled(laid)).toEqual([]);
  });

  it('戻る線と出ていく線が、同じ縦の線の上で向き合わない', () => {
    // 1 枚目の報告: loginSc から出る線と loginSc へ戻る線が重なり、
    // 矢印の向きが読めなくなっていた図。
    const laid = layOutDiagram(parseDiagram(`flow {
  loginSc ([ログイン画面])
  inputId [社員コード入力]
  isInProcess {作業中？}
  qrSc ([特殊画面])
  startBtn [スタートボタン]
  stopBtn [中断]
  completeBtn [完了]
  restartBtn [再開]
  stopReasonSc ([停止理由選択])
  completeSc ([完了入力])

  loginSc --> inputId
  inputId --> isInProcess
  isInProcess --> qrSc "No"
  qrSc --> startBtn
  qrSc --> stopBtn
  qrSc --> completeBtn
  qrSc --> restartBtn
  startBtn --> qrSc
  stopBtn --> stopReasonSc
  completeBtn --> completeSc
  stopReasonSc --> qrSc
  completeSc --> loginSc
}`));
    expect(doubled(laid)).toEqual([]);

    const of = (from: string, to: string): EdgeRoute =>
      laid.routes.find(r => r.edge.from === from && r.edge.to === to)!;
    // 同じ図形に出入りする 2 本が、同じ点から出入りしない。
    expect(of('loginSc', 'inputId').points[0]!.x)
      .not.toBe(of('completeSc', 'loginSc').points.at(-1)!.x);
  });

  it('枝分かれするだけの図は、辺の中央から出たままにする', () => {
    // 1 本の幹から分かれる形は、重ならないので動かす理由がない。
    // 端が辺の中央にあることは PowerPoint のコネクタが図形に付く条件でもある。
    const laid = layOutDiagram(parseDiagram('flow {\n  a [A]\n  b [B]\n  c [C]\n  a --> b\n  a --> c\n}'));
    const a = laid.boxes.get('a')!;
    for (const route of laid.routes) {
      expect(route.points[0]!.x).toBe(a.x + a.width / 2);
      expect(route.points[0]!.y).toBe(a.y + a.height / 2);
    }
    expect(doubled(laid)).toEqual([]);
  });

  it('同じ図形を結ぶ行き帰りは、離れたまま揃って曲がる', () => {
    const laid = layOutDiagram(parseDiagram('flow {\n  a [A]\n  b [B]\n  a --> b\n  b --> a\n}'));
    const [there, back] = laid.routes.map(r => r.points);
    expect(Math.abs(there![0]!.x - back![0]!.x)).toBe(18);
  });
});

/** Every pair of connections that cross, as `a->b × c->d`. */
function crossings(laid: LaidOutDiagram): string[] {
  const out: string[] = [];
  const name = (r: EdgeRoute): string => `${r.edge.from}->${r.edge.to}`;
  for (let i = 0; i < laid.routes.length; i++) {
    for (let j = i + 1; j < laid.routes.length; j++) {
      const one = laid.routes[i]!;
      const other = laid.routes[j]!;
      for (const p of segments(one)) {
        for (const q of segments(other)) {
          const r = { x: p.b.x - p.a.x, y: p.b.y - p.a.y };
          const s = { x: q.b.x - q.a.x, y: q.b.y - q.a.y };
          const den = r.x * s.y - r.y * s.x;
          if (Math.abs(den) < 1e-9) continue;
          const u = ((q.a.x - p.a.x) * s.y - (q.a.y - p.a.y) * s.x) / den;
          const v = ((q.a.x - p.a.x) * r.y - (q.a.y - p.a.y) * r.x) / den;
          if (u > 0.001 && u < 0.999 && v > 0.001 && v < 0.999) {
            out.push(`${name(one)} × ${name(other)}`);
          }
        }
      }
    }
  }
  return [...new Set(out)];
}

describe('交わらずに済む線は交わらない', () => {
  it('同じ図形から出た 2 本は交差しない（遠い先ほど手前で曲がる）', () => {
    // qrSc から 4 つのボタンへ出る線。近いほうが先に曲がると、遠いほうが
    // その縦線を横切ってしまう。遠いほうを手前のレーンに置けば入れ子になる。
    const laid = layOutDiagram(parseDiagram(`flow {
  qrSc ([特殊画面])
  startBtn [スタートボタン]
  stopBtn [中断]
  completeBtn [完了]
  restartBtn [再開]
  qrSc --> startBtn
  qrSc --> stopBtn
  qrSc --> completeBtn
  qrSc --> restartBtn
}`));
    expect(crossings(laid)).toEqual([]);

    const of = (to: string): number => {
      const route = laid.routes.find(r => r.edge.to === to)!;
      return route.points[1]!.y;
    };
    // 遠い先へ向かう線のほうが、図形に近いところで曲がる。
    expect(of('restartBtn')).toBeLessThan(of('completeBtn'));
    expect(of('startBtn')).toBeLessThan(of('stopBtn'));
  });

  it('同じ段へ扇形に出る線どうしも交差しない', () => {
    // 2 枚目の報告から。a から出る 4 本は互いに交わらない。
    const laid = layOutDiagram(parseDiagram(`flow TB {
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
}`));
    const sameSource = crossings(laid).filter(one => {
      const [p, q] = one.split(' × ');
      return p!.split('->')[0] === q!.split('->')[0];
    });
    expect(sameSource).toEqual([]);
  });

  it('同じ図形へ集まる 2 本も、順番を選べば交わらない', () => {
    // a と f が揃って e へ向かう。a が先に曲がると f の出口の縦線を横切り、
    // そのうえ f が a の入口の縦線を横切って、2 回も交差してしまう。
    // f が先に曲がれば、どちらも相手の縦線に触れない。
    const laid = layOutDiagram(parseDiagram(`flow TB {
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
}`));
    const both = crossings(laid).filter(one => one.includes('a->e') && one.includes('f->e'));
    expect(both).toEqual([]);

    const turnOf = (from: string, to: string): number =>
      laid.routes.find(r => r.edge.from === from && r.edge.to === to)!.points[1]!.y;
    expect(turnOf('f', 'e')).toBeLessThan(turnOf('a', 'e'));
  });

  it('図の端から端へ戻る線は、図の外側を回る', () => {
    // 下から先頭へ戻る線が図の中を通ると、どの行も邪魔になる。横へ出ようにも
    // 自分がいる行の隣の図形にぶつかる。外を回れば長いが、何も横切らない。
    const laid = layOutDiagram(parseDiagram(`flow {
  loginSc ([ログイン画面])
  inputId [社員コード入力]
  isInProcess {作業中？}
  qrSc ([特殊画面])
  startBtn [スタートボタン]
  stopBtn [中断]
  completeBtn [完了]
  restartBtn [再開]
  stopReasonSc ([停止理由選択])
  completeSc ([完了入力])

  loginSc --> inputId
  inputId --> isInProcess
  isInProcess --> qrSc "No"
  qrSc --> startBtn
  qrSc --> stopBtn
  qrSc --> completeBtn
  qrSc --> restartBtn
  startBtn --> qrSc
  stopBtn --> stopReasonSc
  completeBtn --> completeSc
  stopReasonSc --> qrSc
  completeSc --> loginSc
}`));
    const shapes = [...laid.boxes.values()];
    const top = Math.min(...shapes.map(b => b.y));
    const bottom = Math.max(...shapes.map(b => b.y + b.height));
    const left = Math.min(...shapes.map(b => b.x));
    const home = laid.routes.find(r => r.edge.to === 'loginSc')!;

    expect(home.points.some(p => p.y > bottom)).toBe(true);
    expect(home.points.some(p => p.y < top)).toBe(true);
    expect(home.points.some(p => p.x < left)).toBe(true);
    expect(crossings(laid)).toEqual([]);
  });

  it('近くへ戻るだけの線は、外まで回らない', () => {
    // 行き先が近く、脇の通路が空いているなら、そちらが短くて済む。
    const laid = layOutDiagram(parseDiagram(
      'flow {\n  a [A]\n  b [B]\n  c [C]\n  a --> b\n  b --> c\n  c --> a\n}',
    ));
    const shapes = [...laid.boxes.values()];
    const top = Math.min(...shapes.map(b => b.y));
    const bottom = Math.max(...shapes.map(b => b.y + b.height));
    const home = laid.routes.find(r => r.edge.to === 'a' && r.edge.from === 'c')!;
    expect(home.points.every(p => p.y >= top && p.y <= bottom)).toBe(true);
  });

  it('戻る線は、自分が通る側から図形に入る', () => {
    // 左の通路を上ってきた線が右端から入ると、その図形自身の出ていく線を
    // 横切ってしまう。戻る線は通路の側に寄せ、本流は中央に残す。
    const laid = layOutDiagram(parseDiagram(`flow {
  loginSc ([ログイン画面])
  inputId [社員コード入力]
  qrSc ([特殊画面])
  completeSc ([完了入力])
  loginSc --> inputId
  inputId --> qrSc
  qrSc --> completeSc
  completeSc --> loginSc
}`));
    const out = laid.routes.find(r => r.edge.from === 'loginSc')!;
    const home = laid.routes.find(r => r.edge.to === 'loginSc')!;
    const loginSc = laid.boxes.get('loginSc')!;

    // 本流は辺の中央からまっすぐ出る（PowerPoint のコネクタが付く条件）。
    expect(out.points[0]!.x).toBe(loginSc.x + loginSc.width / 2);
    expect(out.points).toHaveLength(2);
    // 戻る線は左の通路を使うので、左側から入る。
    expect(home.points.at(-1)!.x).toBeLessThan(out.points[0]!.x);
    expect(crossings(laid)).toEqual([]);
  });
});
