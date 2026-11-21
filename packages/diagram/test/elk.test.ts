import { afterEach, describe, expect, it } from 'vitest';
import {
  LAYERED_ENGINE, layOutDiagram, layoutEngine, layoutEngineNames, parseDiagram, useLayoutEngine,
} from '../src/index.js';
import { ELK_ENGINE } from '../src/elk.js';

afterEach(() => { useLayoutEngine(LAYERED_ENGINE); });

/** The shapes in the order the flow reaches them, row by row down the page. */
function rows(source: string): string[][] {
  const laid = layOutDiagram(parseDiagram(source));
  const by = new Map<number, string[]>();
  for (const [id, box] of laid.boxes) {
    const list = by.get(box.y);
    if (list) list.push(id); else by.set(box.y, [id]);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, list]) => list);
}

const LOOP = `flow {
  login ([ログイン])
  pick [選ぶ]
  work [作業]
  done ([完了])
  login --> pick
  pick --> work
  work --> done
  done --> login
}`;

describe('ELK エンジン', () => {
  it('読み込むだけで登録され、名前で選べる', () => {
    expect(layoutEngineNames()).toContain(ELK_ENGINE);
    // 既定は同梱エンジンのまま。読み込んでも図は変わらない。
    expect(layoutEngine().name).toBe(LAYERED_ENGINE);
    expect(useLayoutEngine(ELK_ENGINE)).toBe(true);
    expect(layoutEngine().name).toBe(ELK_ENGINE);
  });

  it('ELK を同期で呼べる（elkjs の内部に触れているので、壊れたら落とす）', () => {
    useLayoutEngine(ELK_ENGINE);
    // layOutDiagram は同期である。elkjs の公開 API は Promise なので、
    // これが通ること自体が「内部の dispatcher を同期で叩けている」証拠になる。
    const laid = layOutDiagram(parseDiagram('flow {\n  a [A]\n  b [B]\n  a --> b\n}'));
    expect(laid.boxes.get('a')).toBeDefined();
    expect(laid.boxes.get('b')!.y).toBeGreaterThan(laid.boxes.get('a')!.y);
  });

  it('同じ図は何度置いても同じ場所に置かれる', () => {
    useLayoutEngine(ELK_ENGINE);
    const where = (): string => [...layOutDiagram(parseDiagram(LOOP)).boxes.entries()]
      .map(([id, b]) => `${id}:${b.x},${b.y}`).sort().join(' ');
    const first = where();
    for (let i = 0; i < 5; i++) expect(where()).toBe(first);
  });

  it('最初の画面へ戻る流れでも、上から下へ読める向きに置く', () => {
    // ELK の既定の循環の切り方では、この図は上下が逆になる。
    // cycleBreaking=MODEL_ORDER を渡しているので、入口が最上段に来る。
    useLayoutEngine(ELK_ENGINE);
    const laid = rows(LOOP);
    expect(laid[0]).toEqual(['login']);
    expect(laid.at(-1)).toEqual(['done']);
  });

  it('同じ段の並びは、ほかに決め手がなければ書いた順になる', () => {
    useLayoutEngine(ELK_ENGINE);
    const laid = rows('flow {\n  s[S]\n  a[A]\n  b[B]\n  c[C]\n  s-->a\n  s-->b\n  s-->c\n}');
    expect(laid[1]).toEqual(['a', 'b', 'c']);
  });

  it('向きの指定が ELK にも伝わる', () => {
    useLayoutEngine(ELK_ENGINE);
    const across = layOutDiagram(parseDiagram('flow LR {\n  a [A]\n  b [B]\n  a --> b\n}'));
    expect(across.boxes.get('b')!.x).toBeGreaterThan(across.boxes.get('a')!.x);
    expect(across.boxes.get('b')!.y).toBe(across.boxes.get('a')!.y);

    const back = layOutDiagram(parseDiagram('flow BT {\n  a [A]\n  b [B]\n  a --> b\n}'));
    expect(back.boxes.get('b')!.y).toBeLessThan(back.boxes.get('a')!.y);
  });

  it('ピンで置いた図形は ELK でも動かない', () => {
    useLayoutEngine(ELK_ENGINE);
    const laid = layOutDiagram(parseDiagram(
      'flow {\n  a [A]\n  b [B]\n  a --> b\n}\nlayout {\n  b @ (400, 300)\n}',
    ));
    const b = laid.boxes.get('b')!;
    expect([b.x, b.y]).toEqual([400 + laid.origin.x, 300 + laid.origin.y]);
  });
});
