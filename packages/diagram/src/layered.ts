// The engine that ships with the tool: a layered layout.
//
// Rank by longest path, order each rank by the average position of its
// neighbours, then space the ranks out along the flow. It is not TALA, but it
// is deterministic, which is what a diff needs: the same file has to give the
// same drawing on every machine and in every build, or a pin stops meaning
// anything and the picture in a review stops matching the one in the PDF.
//
// Everything here is worked out along the flow and across it, so one piece of
// code serves all four directions; a reversed flow is the same layout read
// from the far end.

import {
  registerLayoutEngine,
  type GraphEdge, type GraphLayout, type GraphToLayOut, type LayoutEngine,
} from './engine.js';
import type { Point } from './model.js';

export const LAYERED_ENGINE = 'layered';

export const layeredEngine: LayoutEngine = {
  name: LAYERED_ENGINE,
  arrange: layered,
};

registerLayoutEngine(layeredEngine);

function layered<E extends GraphEdge>(graph: GraphToLayOut<E>): GraphLayout<E> {
  const { ids, edges, size: sizeOf, axis, gap } = graph;
  const forward = forwardEdges(ids, edges);

  const rank = new Map<string, number>(ids.map(id => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const edge of forward) {
      const next = rank.get(edge.from)! + 1;
      if (rank.get(edge.to)! < next) { rank.set(edge.to, next); moved = true; }
    }
    if (!moved) break;
  }

  const ranks: string[][] = [];
  for (const id of ids) {
    const r = rank.get(id)!;
    (ranks[r] ??= []).push(id);
  }
  for (let i = 0; i < ranks.length; i++) ranks[i] ??= [];

  orderRanks(ranks, forward);

  // `along` is the way the flow runs, `side` the way a rank spreads.
  const along = (id: string): number => (axis.across ? sizeOf(id).width : sizeOf(id).height);
  const side = (id: string): number => (axis.across ? sizeOf(id).height : sizeOf(id).width);
  const flat = new Map<string, { along: number; side: number }>();
  let at = 0;
  for (const row of ranks) {
    const total = row.reduce((sum, id) => sum + side(id), 0) + gap.node * Math.max(0, row.length - 1);
    const deepest = row.reduce((h, id) => Math.max(h, along(id)), 0);
    let across = -total / 2;
    for (const id of row) {
      flat.set(id, { along: Math.round(at + (deepest - along(id)) / 2), side: Math.round(across) });
      across += side(id) + gap.node;
    }
    at += deepest + gap.rank;
  }
  const length = Math.max(0, at - gap.rank);

  const positions = new Map<string, Point>();
  for (const [id, one] of flat) {
    const main = axis.reversed ? length - one.along - along(id) : one.along;
    positions.set(id, axis.across ? { x: main, y: one.side } : { x: one.side, y: main });
  }

  // The computed coordinates start at the origin so that a pinned coordinate,
  // which a human reads off the drawing, means the same thing in both layers.
  const all = [...positions.values()];
  const minX = Math.min(...all.map(p => p.x), 0);
  const minY = Math.min(...all.map(p => p.y), 0);
  let width = 0;
  let height = 0;
  for (const [id, p] of positions) {
    const moved = { x: p.x - minX, y: p.y - minY };
    positions.set(id, moved);
    width = Math.max(width, moved.x + sizeOf(id).width);
    height = Math.max(height, moved.y + sizeOf(id).height);
  }

  const back = new Set(edges.filter(edge => rank.get(edge.to)! < rank.get(edge.from)!));
  return { positions, width, height, back };
}

/**
 * The edges the ranking follows: all of them but the ones that would close a
 * cycle. A connection to a group stands for several edges here, one to each
 * shape it holds, and they go one way together — taking some of `g1 --> g2`
 * and some of `g2 --> g1` would interleave the two groups. So a connection is
 * taken whole or set aside whole: first the ones the walk below finds going
 * forward, then the rest, each only if none of its edges closes a cycle.
 */
function forwardEdges<E extends GraphEdge>(ids: readonly string[], edges: readonly E[]): E[] {
  const closing = backEdges(ids, edges);
  const whole = new Map<unknown, E[]>();
  for (const edge of edges) {
    const key = edge.together ?? edge;
    const list = whole.get(key);
    if (list) list.push(edge); else whole.set(key, [edge]);
  }
  const sets = [...whole.values()];
  const order = [
    ...sets.filter(list => !list.some(e => closing.has(e))),
    ...sets.filter(list => list.some(e => closing.has(e))),
  ];

  const next = new Map<string, string[]>();
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length > 0) {
      const at = queue.shift()!;
      if (at === to) return true;
      for (const one of next.get(at) ?? []) if (!seen.has(one)) { seen.add(one); queue.push(one); }
    }
    return false;
  };
  const out: E[] = [];
  for (const list of order) {
    if (list.some(e => e.from === e.to || reaches(e.to, e.from))) continue;
    for (const e of list) {
      const after = next.get(e.from);
      if (after) after.push(e.to); else next.set(e.from, [e.to]);
      out.push(e);
    }
  }
  return out;
}

/** The edges that close a cycle; ranking through them would never terminate. */
function backEdges<E extends GraphEdge>(ids: readonly string[], edges: readonly E[]): Set<E> {
  const out = new Map<string, E[]>();
  for (const edge of edges) {
    const list = out.get(edge.from);
    if (list) list.push(edge); else out.set(edge.from, [edge]);
  }

  const found = new Set<E>();
  const visiting = new Set<string>();
  const done = new Set<string>();
  const walk = (id: string): void => {
    visiting.add(id);
    for (const edge of out.get(id) ?? []) {
      if (visiting.has(edge.to)) found.add(edge);
      else if (!done.has(edge.to)) walk(edge.to);
    }
    visiting.delete(id);
    done.add(id);
  };
  const targets = new Set(edges.map(e => e.to));
  for (const id of ids) if (!targets.has(id) && !done.has(id)) walk(id);
  for (const id of ids) if (!done.has(id)) walk(id);
  return found;
}

/** Barycenter sweeps: a node sits above the average of what it points at. */
function orderRanks(ranks: string[][], edges: readonly GraphEdge[]): void {
  const neighbours = (id: string, up: boolean): string[] =>
    edges.filter(e => (up ? e.to : e.from) === id).map(e => (up ? e.from : e.to));

  for (let sweep = 0; sweep < 4; sweep++) {
    const up = sweep % 2 === 0;
    const sequence = up ? ranks.map((_, i) => i) : ranks.map((_, i) => ranks.length - 1 - i);
    for (const r of sequence) {
      const fixed = up ? ranks[r - 1] : ranks[r + 1];
      if (!fixed) continue;
      const index = new Map(fixed.map((id, i) => [id, i]));
      const row = ranks[r]!;
      const original = new Map(row.map((id, i) => [id, i]));
      const key = (id: string): number => {
        const near = neighbours(id, up).map(n => index.get(n)).filter((i): i is number => i !== undefined);
        if (near.length === 0) return original.get(id)!;
        return near.reduce((x, y) => x + y, 0) / near.length;
      };
      row.sort((a, b) => key(a) - key(b));
    }
  }
}
