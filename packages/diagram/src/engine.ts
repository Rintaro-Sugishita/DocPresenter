// Where a graph's shapes go, and nothing else.
//
// The layout layer does a great deal that is particular to this tool —
// containers, pins, groups that are only a frame, items, tables — and almost
// none of it is graph drawing. What is graph drawing is one question: given
// shapes of known size and the connections between them, where does each
// shape go? That question is the whole of this file's interface, so that the
// answer can be swapped for a better one without disturbing the rest.
//
// The three-layer model says the layout layer holds only what a human pinned,
// so a drawing's coordinates are computed on every render and never stored.
// That is what makes swapping an engine cheap: no file has to be rewritten,
// because no file holds an engine's output. It is also what makes it
// dangerous — a pin is an absolute coordinate, and the shapes a different
// engine puts around it will land somewhere else. Changing the engine under a
// drawing that has pins moves everything but the pins.
//
// An engine is synchronous. One that is not — an engine that runs in a worker,
// or one compiled from another language — is fitted by computing its answer
// ahead of the render and handing the result to a small engine that only
// reads it, rather than by making every caller of `layOutDiagram` wait.

import type { Point } from './model.js';

/** A connection as an engine sees it: two ends, and nothing it has to read. */
export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  /**
   * What this connection is part of, when several edges stand for one written
   * connection. A connection to a group is one line in the file but an edge
   * to each shape the group holds, and those edges have to go one way
   * together: taking some of `g1 --> g2` and some of `g2 --> g1` would
   * interleave the two groups. Edges that share a `together` are taken whole
   * or set aside whole. Absent means the edge stands only for itself.
   */
  readonly together?: unknown;
}

export interface GraphSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Which way the flow runs. `across` means the ranks advance along x rather
 * than y; `reversed` means they advance towards the origin rather than away
 * from it. The four flow directions are these two flags, so that an engine
 * can solve one direction and read the answer back in any of them.
 */
export interface FlowAxis {
  readonly across: boolean;
  readonly reversed: boolean;
}

/** The room to leave: between shapes in one rank, and between ranks. */
export interface GraphGaps {
  readonly node: number;
  readonly rank: number;
}

/**
 * The graph to place. `ids` is in the order the file names the shapes, which
 * is the tie-break an engine should fall back on: two shapes with nothing to
 * tell them apart must come out in the order they were written, or an edit
 * somewhere else in the file would move them.
 */
export interface GraphToLayOut<E extends GraphEdge = GraphEdge> {
  readonly ids: readonly string[];
  readonly edges: readonly E[];
  readonly size: (id: string) => GraphSize;
  readonly axis: FlowAxis;
  readonly gap: GraphGaps;
}

/**
 * Where everything went. Coordinates start at the origin, because a pinned
 * coordinate is one a human read off the drawing and both layers have to
 * agree what it means.
 */
export interface GraphLayout<E extends GraphEdge = GraphEdge> {
  readonly positions: ReadonlyMap<string, Point>;
  readonly width: number;
  readonly height: number;
  /**
   * The connections the layout could not run along the flow — the ones that
   * close a cycle, and so are drawn going back. Routing draws these on their
   * own side of the drawing, so that the direction reads at a glance. An
   * engine that has no notion of rank may return an empty set: the router
   * then decides from the coordinates alone, which is the same answer in
   * every case but a tie.
   */
  readonly back: ReadonlySet<E>;
}

/**
 * One way of answering the question. `name` is what a file or a setting would
 * have to say to ask for it; it is also what a diagnostic names, so it is a
 * word, not a sentence.
 */
export interface LayoutEngine {
  readonly name: string;
  arrange: <E extends GraphEdge>(graph: GraphToLayOut<E>) => GraphLayout<E>;
}

const engines = new Map<string, LayoutEngine>();
let fallback: LayoutEngine | undefined;

/**
 * Adds an engine under its own name. The first one registered is the default,
 * so the built-in engine — which is registered when this package is loaded —
 * stays the default until someone deliberately changes it.
 */
export function registerLayoutEngine(engine: LayoutEngine): void {
  engines.set(engine.name, engine);
  fallback ??= engine;
}

/** Makes `name` the engine used when a drawing does not ask for one. */
export function useLayoutEngine(name: string): boolean {
  const engine = engines.get(name);
  if (!engine) return false;
  fallback = engine;
  return true;
}

/** The names of every engine registered, in the order they were added. */
export function layoutEngineNames(): string[] {
  return [...engines.keys()];
}

/**
 * The engine to use. An unknown name falls back to the default rather than
 * throwing: a drawing that asks for an engine this build does not have is
 * still a drawing, and the layout says so as a diagnostic instead.
 */
export function layoutEngine(name?: string): LayoutEngine {
  if (name !== undefined) {
    const asked = engines.get(name);
    if (asked) return asked;
  }
  if (!fallback) throw new Error('no layout engine is registered');
  return fallback;
}
