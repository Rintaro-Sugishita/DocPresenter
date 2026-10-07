// Turns a diagram into geometry. The three-layer model says the layout layer
// holds only what a human pinned, so everything else is computed here, on
// every render, from the semantics alone. Pinned coordinates always win: an
// automatic layout that moved a shape someone had placed by hand would make
// the pin meaningless.

import { arrangeContainers, containerOf, type Hole } from './arrange.js';
import { lineText, parseRuns, type TextLine } from './inline.js';
import { DEFAULT_SIZE, type DiagramFile, type Edge, type Node, type Point } from './model.js';
import { isListing } from './draw/listing.js';
import { textPlace } from './draw/stencil.js';
import { textWidth, wrapRuns } from './text.js';
import { DEFAULT_LOCALE, say, type Locale, type Phrase } from '@docpresenter/base';
import { dgm } from './messages.js';

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: number;
  /**
   * The label already broken into lines that fit the box. Each line is a list
   * of runs, because a label takes the same inline formatting the rest of the
   * document does.
   */
  readonly lines: readonly TextLine[];
}

export type { Point } from './model.js';

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
  /**
   * The empty cells of the grids, in the drawing's own coordinates.
   *
   * Nothing is drawn for one. They are here because a cell kept empty is a
   * place something can be put, and an editor has no other way to find a
   * place that holds nothing.
   */
  readonly holes: readonly Hole[];
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
/** The room a cylinder's lid takes out of its box. */
const CYLINDER_LID = 24;
/** The room a part's picture takes above its name. */
const PART_ART = 44;

/** The plate a connection's label sits on. The renderer draws it; the layout
 *  has to know its size so the label is not left outside the canvas. */
export const EDGE_LABEL = { fontSize: 12, padding: 8, height: 18 } as const;

export function layOutDiagram(diagram: DiagramFile, locale: Locale = DEFAULT_LOCALE): LaidOutDiagram {
  const diagnostics: Phrase[] = [];
  const byId = new Map(diagram.nodes.map(n => [n.id, n]));
  const plain = diagram.nodes.filter(n => n.shape !== 'group');
  const groups = diagram.nodes.filter(n => n.shape === 'group');

  const sizes = new Map<string, { width: number; height: number; lines: readonly TextLine[] }>();
  for (const node of plain) sizes.set(node.id, measure(node, diagram));

  const auto = diagram.mode === 'flow'
    ? autoPositions(diagram, plain, sizes)
    : { positions: new Map<string, { x: number; y: number }>(), rank: new Map<string, number>() };

  const boxes = new Map<string, Box>();
  const inside = containerOf(diagram);
  for (const node of plain) {
    // P6: a scrollbar has nowhere to put words, and neither has a line, so
    // words written into one are not drawn. Saying so is the difference
    // between a decision and a loss.
    if (node.text !== '' && (node.shape === 'line'
      || textPlace(diagram.style.get(node.id)?.get('icon')) === 'none')) {
      diagnostics.push(dgm('diagram.layout.noText', { id: node.id }));
    }
    for (const problem of lookProblems(node, diagram.style.get(node.id))) {
      diagnostics.push(problem);
    }
    // P6 again: rows written into a part that does not draw rows are rows
    // nobody sees. A tree holds them; a text box has nowhere to put them.
    if (node.items.length > 0 && !isListing(diagram.style.get(node.id)?.get('icon'))) {
      diagnostics.push(dgm('diagram.layout.noItems', { id: node.id }));
    }
    const size = sizes.get(node.id)!;
    const pin = diagram.layout.get(node.id);
    const at = pin ?? auto.positions.get(node.id);
    if (!at) {
      // A shape in a container is placed by the container, not by a pin; a
      // container with nowhere to be is reported by the arranging pass, which
      // can say the useful thing about it.
      if (!inside.has(node.id) && !diagram.containers.has(node.id)) {
        diagnostics.push(dgm('diagram.layout.unplaced', { id: node.id }));
      }
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

  // What the containers hold, in the room the containers have. Before parking,
  // because a shape a container placed is not a shape with nowhere to be.
  const holes: Hole[] = [];
  const hidden = arrangeContainers(
    diagram, id => sizes.get(id) ?? { width: 0, height: 0, lines: [] }, boxes, diagnostics, holes,
  );
  // A tab page nobody is shown, and anything cut off by a scrolling area, is
  // deliberately not drawn — so it is not a shape with nowhere to be.
  park(plain.filter(node => !boxes.has(node.id) && !hidden.has(node.id)), sizes, boxes);

  for (const group of groups) {
    // A group that arranges its own contents already has its box: it decided
    // where they went, so it cannot also be whatever shape they ended up in.
    if (diagram.containers.has(group.id)) continue;
    const box = groupBox(group, diagram, boxes, diagnostics);
    if (box) boxes.set(group.id, box);
  }

  for (const edge of diagram.edges) {
    for (const end of [edge.from, edge.to]) {
      if (!byId.has(end)) diagnostics.push(dgm('diagram.layout.missingEnd', { id: end }));
    }
  }
  for (const key of diagram.bends.keys()) {
    if (!diagram.edges.some(edge => `${edge.from}->${edge.to}` === key)) {
      diagnostics.push(dgm('diagram.layout.missingBendLine', { key }));
    }
  }

  const routes = route(diagram, boxes, auto.rank);
  return normalize(boxes, routes, diagram, diagnostics.map(one => say(locale, one)), holes);
}

/**
 * Puts the shapes that have nowhere to be in a row under the drawing. A shape
 * with no position is still in the file, and a drawing that answers that by
 * showing nothing is a drawing that lies about its own contents: it has to be
 * visible to be draggable, and draggable to be fixed.
 */
function park(
  missing: readonly Node[],
  sizes: ReadonlyMap<string, { width: number; height: number; lines: readonly TextLine[] }>,
  boxes: Map<string, Box>,
): void {
  if (missing.length === 0) return;
  const placed = [...boxes.values()];
  let x = placed.length ? Math.min(...placed.map(b => b.x)) : 0;
  const y = (placed.length ? Math.max(...placed.map(b => b.y + b.height)) : 0) + RANK_GAP;
  for (const node of missing) {
    const size = sizes.get(node.id);
    if (!size) continue;
    boxes.set(node.id, { x, y, width: size.width, height: size.height, z: 0, lines: size.lines });
    x += size.width + NODE_GAP;
  }
}

/**
 * Routes every connection. In a `free` drawing a straight line is used. In a
 * `flow`, a connection runs only up, down and across — down out of one shape,
 * across at the middle of the gap, down into the next — because a design
 * document is read as rows, and a diagonal reads as a third direction that is
 * not in the chart. When that path would run through a shape — which pinning
 * makes possible even between neighbouring rows — the line detours through a
 * channel beside the drawing, and if that is still blocked, all the way round.
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

    // Corners the author put in win over anything computed here, for the same
    // reason a pinned shape does: the point of writing them down is that they
    // are not decided again on the next render.
    const bend = diagram.bends.get(`${edge.from}->${edge.to}`);
    if (bend && bend.points.length > 0) {
      routes.push({ edge, points: [a, ...bend.points, b], labelAt: undefined });
      continue;
    }

    const clear = (points: readonly Point[]): boolean => {
      for (let i = 0; i + 1 < points.length; i++) {
        if (blocked(diagram, boxes, edge, points[i]!, points[i + 1]!)) return false;
      }
      return true;
    };

    if (diagram.mode !== 'flow') {
      routes.push({ edge, points: [a, b], labelAt: undefined });
      continue;
    }

    const direct = elbow(a, b, from, to);
    if (clear(direct)) {
      routes.push({ edge, points: direct, labelAt: undefined });
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
 * The path of a connection in a flow, centre to centre with only square turns.
 *
 * Between shapes one above the other it leaves through the bottom, turns
 * across half way down the gap and enters through the top; between shapes side
 * by side it does the same sideways. Ends already in line are joined straight.
 * Where the two shapes overlap on both axes there is no gap to turn in, and a
 * straight line is the honest answer.
 */
function elbow(a: Point, b: Point, from: Box, to: Box): Point[] {
  if (Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) return [a, b];
  const below = to.y >= from.y + from.height;
  const above = to.y + to.height <= from.y;
  if (below || above) {
    const y = below ? (from.y + from.height + to.y) / 2 : (to.y + to.height + from.y) / 2;
    return [a, { x: a.x, y }, { x: b.x, y }, b];
  }
  const right = to.x >= from.x + from.width;
  const left = to.x + to.width <= from.x;
  if (right || left) {
    const x = right ? (from.x + from.width + to.x) / 2 : (to.x + to.width + from.x) / 2;
    return [a, { x, y: a.y }, { x, y: b.y }, b];
  }
  return [a, b];
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
      width, height: EDGE_LABEL.height, z: 0, lines: [parseRuns(label)],
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
    width, height: EDGE_LABEL.height, z: 0, lines: [parseRuns(route.edge.label)],
  };
}

/**
 * Declarations only a line has, and what each one may say.
 *
 * P6: an `arrow: left` nobody drew is worse than an arrow drawn the wrong way,
 * because nothing says the word was not understood. The same for a declaration
 * on a shape that cannot use it.
 */
const LINE_ONLY: Readonly<Record<string, readonly string[]>> = {
  arrow: ['none', 'start', 'end', 'both'],
  slope: ['down', 'up'],
};

function lookProblems(node: Node, rule: ReadonlyMap<string, string> | undefined): Phrase[] {
  if (!rule) return [];
  const found: Phrase[] = [];
  for (const [property, choices] of Object.entries(LINE_ONLY)) {
    const value = rule.get(property);
    if (value === undefined) continue;
    if (node.shape !== 'line') found.push(dgm('diagram.layout.lineOnly', { property, id: node.id }));
    else if (!choices.includes(value)) {
      found.push(dgm('diagram.layout.choices', { property, choices: choices.join(' / '), value, id: node.id }));
    }
  }
  const weight = rule.get('weight');
  if (weight !== undefined && !(Number(weight) > 0)) {
    found.push(dgm('diagram.layout.weight', { value: weight, id: node.id }));
  }
  return found;
}

function measure(
  node: Node, diagram: DiagramFile,
): { width: number; height: number; lines: readonly TextLine[] } {
  // A line has no inside, so nothing about it is measured from its words: it is
  // as long as the default width and flat, until a pin says otherwise.
  if (node.shape === 'line') return { width: DEFAULT_SIZE.width, height: 0, lines: [] };
  const pin = diagram.layout.get(node.id);
  // The size a part gives, for a shape with no pin to carry one — a shape in a
  // container is placed without a pin, and a text box is 34 tall because the
  // library says so.
  const given = diagram.partSizes.get(node.id);
  const inner = (pin?.width ?? given?.width) !== undefined
    ? (pin?.width ?? given!.width) - TEXT_PAD
    : Math.min(MAX_NODE_WIDTH, Math.max(DEFAULT_SIZE.width, textWidth(node.text, FONT) + TEXT_PAD)) - TEXT_PAD;
  const lines = wrapRuns(parseRuns(node.text), inner, FONT);
  const widest = lines.reduce((w, line) => Math.max(w, textWidth(lineText(line), FONT)), 0);
  // A cylinder spends the top of its box on the lid, so the text needs the
  // room back; otherwise two lines run into the curve.
  const lid = node.shape === 'cylinder' ? CYLINDER_LID : 0;
  // A part is a picture with its name under it, so it needs the picture's room
  // on top of the room the name takes.
  const art = diagram.style.get(node.id)?.has('icon') ? PART_ART : 0;
  // The library's height is what one line of this part is. Words that had to
  // wrap need more than that, and a part is a starting point rather than a cap.
  if (given) {
    return {
      width: given.width,
      height: lines.length > 1 ? Math.max(given.height, lines.length * LINE_HEIGHT) : given.height,
      lines,
    };
  }
  return {
    width: Math.max(DEFAULT_SIZE.width, Math.ceil(widest) + TEXT_PAD),
    height: Math.max(DEFAULT_SIZE.height, lines.length * LINE_HEIGHT + TEXT_PAD + lid + art),
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
  group: Node, diagram: DiagramFile, boxes: ReadonlyMap<string, Box>, diagnostics: Phrase[],
): Box | undefined {
  const pin = diagram.layout.get(group.id);
  const children = group.children.map(id => boxes.get(id)).filter((b): b is Box => b !== undefined);
  for (const id of group.children) {
    if (!boxes.has(id)) diagnostics.push(dgm('diagram.layout.missingMember', { group: group.id, id }));
  }
  if (pin) {
    return {
      x: pin.x, y: pin.y,
      width: pin.width ?? spread(children, 'x'),
      height: pin.height ?? spread(children, 'y'),
      z: pin.z ?? -1,
      lines: [parseRuns(group.text)],
    };
  }
  if (children.length === 0) return undefined;
  const left = Math.min(...children.map(b => b.x)) - GROUP_PAD;
  const top = Math.min(...children.map(b => b.y)) - GROUP_PAD - GROUP_HEADER;
  const right = Math.max(...children.map(b => b.x + b.width)) + GROUP_PAD;
  const bottom = Math.max(...children.map(b => b.y + b.height)) + GROUP_PAD;
  return {
    x: left, y: top, width: right - left, height: bottom - top, z: -1,
    lines: [parseRuns(group.text)],
  };
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
  diagram: DiagramFile, diagnostics: readonly string[], holes: readonly Hole[],
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
  // A container is drawn before what it holds, whatever order the file names
  // them in: it is the surface they sit on, and a surface painted afterwards
  // covers them. Depth does this for any nesting; `z` still decides first,
  // because that is the author's own say.
  const held = containerOf(diagram);
  const depthOf = (id: string): number => {
    let depth = 0;
    for (let at = held.get(id); at !== undefined && depth < 32; at = held.get(at)) depth += 1;
    return depth;
  };
  const order = [...shifted.keys()].sort((a, b) => {
    const dz = shifted.get(a)!.z - shifted.get(b)!.z;
    if (dz !== 0) return dz;
    const dd = depthOf(a) - depthOf(b);
    return dd !== 0 ? dd : declared.get(a)! - declared.get(b)!;
  });

  return {
    boxes: shifted, routes: shiftedRoutes,
    width: Math.ceil(width), height: Math.ceil(height), order, diagnostics,
    origin: { x: -minX + PAD, y: -minY + PAD },
    // The same shift the boxes took: an empty cell sits among them, so it has
    // to be measured in the same numbers.
    holes: holes.map(hole => ({
      ...hole, box: { ...hole.box, ...move({ x: hole.box.x, y: hole.box.y }) },
    })),
  };
}
