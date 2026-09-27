// Turns a diagram into geometry. The three-layer model says the layout layer
// holds only what a human pinned, so everything else is computed here, on
// every render, from the semantics alone. Pinned coordinates always win: an
// automatic layout that moved a shape someone had placed by hand would make
// the pin meaningless.

import { DEFAULT_SIZE, type DiagramFile, type Edge, type Node } from './model.js';
import { textWidth, wrapText } from './text.js';

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: number;
  /** The label already broken into lines that fit the box. */
  readonly lines: readonly string[];
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The centre-to-centre path of one connection, with any bends it needs to get
 * round the shapes between its ends. The renderer clips the two end segments
 * at the shapes' outlines; routing is decided here so that the PDF and PPTX
 * writers draw the same line as the screen.
 */
export interface EdgeRoute {
  readonly edge: Edge;
  readonly points: readonly Point[];
  /** Where the label sits: half way along, or nudged aside to keep it legible. */
  readonly labelAt: Point | undefined;
}

export interface LaidOutDiagram {
  readonly boxes: ReadonlyMap<string, Box>;
  readonly routes: readonly EdgeRoute[];
  readonly width: number;
  readonly height: number;
  /** Ids from back to front: groups before the shapes they contain. */
  readonly order: readonly string[];
  readonly diagnostics: readonly string[];
  /**
   * The shift applied to fit the drawing on the canvas. A box on screen sits at
   * its own coordinate plus this, so an editor subtracts it to turn a position
   * the pointer landed on back into a pin the file can hold.
   */
  readonly origin: Point;
}

const PAD = 16;          // margin around the drawing
const RANK_GAP = 72;     // between rows of a graph
const NODE_GAP = 36;     // between shapes in the same row
const GROUP_PAD = 20;    // between a group's border and its contents
const GROUP_HEADER = 18; // room for the group's own label
const CHANNEL_GAP = 28;  // between the shapes and a detouring connection
const FONT = 14;
const LINE_HEIGHT = 20;
const TEXT_PAD = 24;
const MAX_NODE_WIDTH = 260;

/** The plate a connection's label sits on. The renderer draws it; the layout
 *  has to know its size so the label is not left outside the canvas. */
export const EDGE_LABEL = { fontSize: 12, padding: 8, height: 18 } as const;

export function layOutDiagram(diagram: DiagramFile): LaidOutDiagram {
  const diagnostics: string[] = [];
  const byId = new Map(diagram.nodes.map(n => [n.id, n]));
  const plain = diagram.nodes.filter(n => n.shape !== 'group');
  const groups = diagram.nodes.filter(n => n.shape === 'group');

  const sizes = new Map<string, { width: number; height: number; lines: readonly string[] }>();
  for (const node of plain) sizes.set(node.id, measure(node, diagram));

  const auto = diagram.mode === 'flow'
    ? autoPositions(diagram, plain, sizes)
    : { positions: new Map<string, { x: number; y: number }>(), rank: new Map<string, number>() };

  const boxes = new Map<string, Box>();
  for (const node of plain) {
    const size = sizes.get(node.id)!;
    const pin = diagram.layout.get(node.id);
    const at = pin ?? auto.positions.get(node.id);
    if (!at) {
      diagnostics.push(`配置がない: ${node.id}`);
      continue;
    }
    boxes.set(node.id, {
      x: at.x, y: at.y,
      width: pin?.width ?? size.width,
      height: pin?.height ?? size.height,
      z: pin?.z ?? 0,
      lines: size.lines,
    });
  }

  for (const group of groups) {
    const box = groupBox(group, diagram, boxes, diagnostics);
    if (box) boxes.set(group.id, box);
  }

  for (const edge of diagram.edges) {
    for (const end of [edge.from, edge.to]) {
      if (!byId.has(end)) diagnostics.push(`接続先が見つからない: ${end}`);
    }
  }

  const routes = route(diagram, boxes, auto.rank);
  return normalize(boxes, routes, diagram, diagnostics);
}

/**
 * Routes every connection. A straight line is used whenever it is clear; when
 * it would run through a shape — which pinning makes possible even between
 * neighbouring rows — the line detours through a channel beside the drawing,
 * and if that is still blocked, all the way round it.
 */
function route(
  diagram: DiagramFile, boxes: ReadonlyMap<string, Box>, rank: ReadonlyMap<string, number>,
): EdgeRoute[] {
  const all = [...boxes.values()];
  const bounds = {
    left: all.length ? Math.min(...all.map(b => b.x)) - CHANNEL_GAP : 0,
    right: all.length ? Math.max(...all.map(b => b.x + b.width)) + CHANNEL_GAP : 0,
    top: all.length ? Math.min(...all.map(b => b.y)) - CHANNEL_GAP : 0,
    bottom: all.length ? Math.max(...all.map(b => b.y + b.height)) + CHANNEL_GAP : 0,
  };
  const lanes = { left: 0, right: 0, top: 0, bottom: 0 };

  const routes: EdgeRoute[] = [];
  for (const edge of diagram.edges) {
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    if (!from || !to) continue;
    const a = centre(from);
    const b = centre(to);

    const clear = (points: readonly Point[]): boolean => {
      for (let i = 0; i + 1 < points.length; i++) {
        if (blocked(diagram, boxes, edge, points[i]!, points[i + 1]!)) return false;
      }
      return true;
    };

    if (diagram.mode !== 'flow' || clear([a, b])) {
      routes.push({ edge, points: [a, b], labelAt: undefined });
      continue;
    }

    // Going back up is drawn on the left, going on down on the right, so the
    // two never share a channel and the direction is readable at a glance.
    const back = (rank.get(edge.to) ?? b.y) < (rank.get(edge.from) ?? a.y);
    const side = back ? 'left' : 'right';
    const x = side === 'right'
      ? bounds.right + CHANNEL_GAP * lanes.right
      : bounds.left - CHANNEL_GAP * lanes.left;

    const beside = [a, { x, y: a.y }, { x, y: b.y }, b];
    if (clear(beside)) {
      lanes[side]++;
      routes.push({ edge, points: beside, labelAt: undefined });
      continue;
    }

    const vertical = back ? 'top' : 'bottom';
    const y = vertical === 'bottom'
      ? bounds.bottom + CHANNEL_GAP * lanes.bottom
      : bounds.top - CHANNEL_GAP * lanes.top;

    const around = [a, { x, y: a.y }, { x, y }, { x: b.x, y }, b];
    if (clear(around)) {
      lanes[side]++;
      lanes[vertical]++;
      routes.push({ edge, points: around, labelAt: undefined });
      continue;
    }

    lanes[vertical]++;
    routes.push({ edge, points: [a, { x: a.x, y }, { x: b.x, y }, b], labelAt: undefined });
  }
  return placeLabels(routes);
}

/**
 * Two connections that leave the same shape meet again near their middles, so
 * their labels would sit on top of each other. A label that cannot stay in the
 * middle slides along its own line instead — still unambiguously on that line,
 * which a label moved sideways would not be.
 */
function placeLabels(routes: readonly EdgeRoute[]): EdgeRoute[] {
  const placed: Box[] = [];
  const overlap = (a: Box, b: Box): boolean =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  return routes.map(route => {
    const label = route.edge.label;
    if (!label) return route;
    const width = textWidth(label, EDGE_LABEL.fontSize) + EDGE_LABEL.padding;
    const boxAt = (at: Point): Box => ({
      x: at.x - width / 2, y: at.y - EDGE_LABEL.height / 2,
      width, height: EDGE_LABEL.height, z: 0, lines: [label],
    });

    for (const t of [0.5, 0.36, 0.64, 0.24, 0.76]) {
      const at = pointAlong(route.points, t);
      const box = boxAt(at);
      if (!placed.some(other => overlap(other, box))) {
        placed.push(box);
        return { ...route, labelAt: at };
      }
    }
    const at = pointAlong(route.points, 0.5);
    placed.push(boxAt(at));
    return { ...route, labelAt: at };
  });
}

/** True when the segment runs through a shape that is not one of its ends. */
function blocked(
  diagram: DiagramFile, boxes: ReadonlyMap<string, Box>, edge: Edge, a: Point, b: Point,
): boolean {
  for (const node of diagram.nodes) {
    if (node.id === edge.from || node.id === edge.to || node.shape === 'group') continue;
    const box = boxes.get(node.id);
    if (box && crossesBox(a, b, box)) return true;
  }
  return false;
}

/** Samples the segment rather than solving it: the boxes are large and few. */
function crossesBox(a: Point, b: Point, box: Box): boolean {
  const steps = 48;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height) return true;
  }
  return false;
}

function centre(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A point a given fraction of the way along a route, measured by length. */
export function pointAlong(points: readonly Point[], fraction: number): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  const half = lengths.reduce((a, b) => a + b, 0) * fraction;
  let walked = 0;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (walked + length >= half && length > 0) {
      const t = (half - walked) / length;
      const a = points[i]!;
      const b = points[i + 1]!;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    walked += length;
  }
  return points[0] ?? { x: 0, y: 0 };
}

/** The rectangle a connection's label occupies. */
export function edgeLabelBox(route: EdgeRoute): Box | undefined {
  if (!route.edge.label || !route.labelAt) return undefined;
  const width = textWidth(route.edge.label, EDGE_LABEL.fontSize) + EDGE_LABEL.padding;
  return {
    x: route.labelAt.x - width / 2, y: route.labelAt.y - EDGE_LABEL.height / 2,
    width, height: EDGE_LABEL.height, z: 0, lines: [route.edge.label],
  };
}

function measure(node: Node, diagram: DiagramFile): { width: number; height: number; lines: readonly string[] } {
  const pin = diagram.layout.get(node.id);
  const inner = pin?.width !== undefined
    ? pin.width - TEXT_PAD
    : Math.min(MAX_NODE_WIDTH, Math.max(DEFAULT_SIZE.width, textWidth(node.text, FONT) + TEXT_PAD)) - TEXT_PAD;
  const lines = wrapText(node.text, inner, FONT);
  const widest = lines.reduce((w, line) => Math.max(w, textWidth(line, FONT)), 0);
  return {
    width: Math.max(DEFAULT_SIZE.width, Math.ceil(widest) + TEXT_PAD),
    height: Math.max(DEFAULT_SIZE.height, lines.length * LINE_HEIGHT + TEXT_PAD),
    lines,
  };
}

/**
 * A layered layout: rank by longest path, order each rank by the average
 * position of its neighbours, then space the ranks out. It is not TALA, but it
 * is deterministic, which is what a diff needs.
 */
function autoPositions(
  diagram: DiagramFile,
  plain: readonly Node[],
  sizes: ReadonlyMap<string, { width: number; height: number }>,
): { positions: Map<string, { x: number; y: number }>; rank: ReadonlyMap<string, number> } {
  const ids = plain.map(n => n.id);
  const present = new Set(ids);
  const edges = diagram.edges.filter(e => present.has(e.from) && present.has(e.to));
  const back = backEdges(ids, edges);
  const forward = edges.filter(e => !back.has(e));

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

  const positions = new Map<string, { x: number; y: number }>();
  let y = 0;
  for (const row of ranks) {
    const widths = row.map(id => sizes.get(id)!.width);
    const total = widths.reduce((a, b) => a + b, 0) + NODE_GAP * Math.max(0, row.length - 1);
    const tallest = row.reduce((h, id) => Math.max(h, sizes.get(id)!.height), 0);
    let x = -total / 2;
    row.forEach((id, index) => {
      positions.set(id, { x: Math.round(x), y: Math.round(y + (tallest - sizes.get(id)!.height) / 2) });
      x += widths[index]! + NODE_GAP;
    });
    y += tallest + RANK_GAP;
  }

  // The computed coordinates start at the origin so that a pinned coordinate,
  // which a human reads off the drawing, means the same thing in both layers.
  const minX = Math.min(...[...positions.values()].map(p => p.x), 0);
  for (const [id, at] of positions) positions.set(id, { x: at.x - minX, y: at.y });
  return { positions, rank };
}

/** The edges that close a cycle; ranking through them would never terminate. */
function backEdges<E extends { from: string; to: string }>(
  ids: readonly string[], edges: readonly E[],
): Set<E> {
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
function orderRanks(ranks: string[][], edges: readonly { from: string; to: string }[]): void {
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

function groupBox(
  group: Node, diagram: DiagramFile, boxes: ReadonlyMap<string, Box>, diagnostics: string[],
): Box | undefined {
  const pin = diagram.layout.get(group.id);
  const children = group.children.map(id => boxes.get(id)).filter((b): b is Box => b !== undefined);
  for (const id of group.children) {
    if (!boxes.has(id)) diagnostics.push(`グループ ${group.id} の要素が見つからない: ${id}`);
  }
  if (pin) {
    return {
      x: pin.x, y: pin.y,
      width: pin.width ?? spread(children, 'x'),
      height: pin.height ?? spread(children, 'y'),
      z: pin.z ?? -1,
      lines: [group.text],
    };
  }
  if (children.length === 0) return undefined;
  const left = Math.min(...children.map(b => b.x)) - GROUP_PAD;
  const top = Math.min(...children.map(b => b.y)) - GROUP_PAD - GROUP_HEADER;
  const right = Math.max(...children.map(b => b.x + b.width)) + GROUP_PAD;
  const bottom = Math.max(...children.map(b => b.y + b.height)) + GROUP_PAD;
  return { x: left, y: top, width: right - left, height: bottom - top, z: -1, lines: [group.text] };
}

function spread(boxes: readonly Box[], axis: 'x' | 'y'): number {
  if (boxes.length === 0) return DEFAULT_SIZE.width;
  const size = axis === 'x' ? 'width' : 'height';
  const min = Math.min(...boxes.map(b => b[axis]));
  const max = Math.max(...boxes.map(b => b[axis] + b[size]));
  return max - min + GROUP_PAD * 2;
}

/** Shifts everything into positive coordinates and reports the canvas size. */
function normalize(
  boxes: Map<string, Box>, routes: readonly EdgeRoute[],
  diagram: DiagramFile, diagnostics: string[],
): LaidOutDiagram {
  // Detouring connections and their labels run outside the shapes, so they
  // move the origin and stretch the canvas too.
  const labels = routes.map(edgeLabelBox).filter((b): b is Box => b !== undefined);
  const all = [...boxes.values(), ...labels];
  const bends = routes.flatMap(r => r.points.slice(1, -1));
  const minX = all.length ? Math.min(...all.map(b => b.x), ...bends.map(p => p.x)) : 0;
  const minY = all.length ? Math.min(...all.map(b => b.y), ...bends.map(p => p.y)) : 0;
  const shifted = new Map<string, Box>();
  for (const [id, box] of boxes) {
    shifted.set(id, { ...box, x: box.x - minX + PAD, y: box.y - minY + PAD });
  }
  const move = (p: Point): Point => ({ x: p.x - minX + PAD, y: p.y - minY + PAD });
  const shiftedRoutes = routes.map(r => ({
    edge: r.edge,
    points: r.points.map(move),
    labelAt: r.labelAt ? move(r.labelAt) : undefined,
  }));

  const xs = [
    ...all.map(b => b.x + b.width - minX + PAD),
    ...bends.map(p => p.x - minX + PAD),
  ];
  const ys = [
    ...all.map(b => b.y + b.height - minY + PAD),
    ...bends.map(p => p.y - minY + PAD),
  ];
  const width = xs.length ? Math.max(...xs) + PAD : PAD * 2;
  const height = ys.length ? Math.max(...ys) + PAD : PAD * 2;

  const declared = new Map(diagram.nodes.map((n, i) => [n.id, i]));
  const order = [...shifted.keys()].sort((a, b) => {
    const dz = shifted.get(a)!.z - shifted.get(b)!.z;
    return dz !== 0 ? dz : declared.get(a)! - declared.get(b)!;
  });

  return {
    boxes: shifted, routes: shiftedRoutes,
    width: Math.ceil(width), height: Math.ceil(height), order, diagnostics,
    origin: { x: -minX + PAD, y: -minY + PAD },
  };
}
