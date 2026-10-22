// Turns a diagram into geometry. The three-layer model says the layout layer
// holds only what a human pinned, so everything else is computed here, on
// every render, from the semantics alone. Pinned coordinates always win: an
// automatic layout that moved a shape someone had placed by hand would make
// the pin meaningless.

import { arrangeContainers, containerOf, type Hole } from './arrange.js';
import { lineText, parseLabel, parseRuns, type TextLine } from './inline.js';
import {
  DEFAULT_SIZE, type DiagramFile, type Edge, type FlowDirection, type Node, type Point,
} from './model.js';
import { isListing } from './draw/listing.js';
import { textPlace } from './draw/stencil.js';
import { textWidth, wrapRuns } from './text.js';
import { DEFAULT_LOCALE, say, type ByteSpan, type Locale, type Phrase } from '@docpresenter/base';
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

/** One thing the layout could not do as written, and where it was written. */
export interface DiagramNote {
  /** Which message it is, so a host can weigh one differently from another. */
  readonly id: string;
  readonly message: string;
  /** The line it is about; absent when no one line is. */
  readonly span: ByteSpan | undefined;
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
   * The same, each with the line of the file it is about, so an editor can
   * mark that line instead of saying only that something somewhere is wrong.
   */
  readonly notes: readonly DiagramNote[];
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
export const EDGE_LABEL = { fontSize: 12, padding: 8, height: 18, lineHeight: 15 } as const;

export function layOutDiagram(diagram: DiagramFile, locale: Locale = DEFAULT_LOCALE): LaidOutDiagram {
  const diagnostics: Phrase[] = [];
  const byId = new Map(diagram.nodes.map(n => [n.id, n]));
  const plain = diagram.nodes.filter(n => n.shape !== 'group');
  const groups = diagram.nodes.filter(n => n.shape === 'group');

  const sizes = new Map<string, { width: number; height: number; lines: readonly TextLine[] }>();
  for (const node of plain) sizes.set(node.id, measure(node, diagram));

  const auto = diagram.mode === 'flow'
    ? autoPositions(diagram, plain, sizes, diagnostics)
    : { positions: new Map<string, { x: number; y: number }>(), courses: new Map<Edge, Course>() };
  // P6: a direction in a drawing that is not laid out is a word nobody acted on.
  if (diagram.mode !== 'flow') {
    if (diagram.direction !== undefined) diagnostics.push(dgm('diagram.layout.directionFree', { id: diagram.mode }));
    for (const group of groups) {
      if (group.direction !== undefined) diagnostics.push(dgm('diagram.layout.directionFree', { id: group.id }));
    }
  }

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

  const routes = route(diagram, boxes, auto.courses);
  const notes = diagnostics.map(one => ({ id: one.id, message: say(locale, one), span: placeOf(diagram, one) }));
  return normalize(boxes, routes, diagram, notes, holes);
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
 * `flow`, a connection runs only along the flow and across it — out of one
 * shape, across at the middle of the gap, into the next — because a design
 * document is read as rows, and a diagonal reads as a third direction that is
 * not in the chart. When that path would run through a shape — which pinning
 * makes possible even between neighbouring rows — the line detours through a
 * channel beside the drawing, and if that is still blocked, all the way round.
 *
 * The routing is written for a flow that runs down the page. A flow that runs
 * across it is the same routing with the page turned on its side: x and y
 * swap on the way in and swap back on the way out.
 */
function route(
  diagram: DiagramFile, boxes: ReadonlyMap<string, Box>, courses: ReadonlyMap<Edge, Course>,
): EdgeRoute[] {
  const all = [...boxes.values()];
  const bounds = {
    left: all.length ? Math.min(...all.map(b => b.x)) - CHANNEL_GAP : 0,
    right: all.length ? Math.max(...all.map(b => b.x + b.width)) + CHANNEL_GAP : 0,
    top: all.length ? Math.min(...all.map(b => b.y)) - CHANNEL_GAP : 0,
    bottom: all.length ? Math.max(...all.map(b => b.y + b.height)) + CHANNEL_GAP : 0,
  };
  const lanes = { left: 0, right: 0, top: 0, bottom: 0 };
  const across = axisOf(diagram.direction).across;
  const aside = parallels(diagram);
  const byId = new Map(diagram.nodes.map(n => [n.id, n]));
  // The group each shape is drawn in, to turn between frames rather than
  // between the shapes inside them: a line turning midway between a shape and
  // one inside a group runs hard against the group's frame.
  const holder = new Map<string, string>();
  for (const node of diagram.nodes) {
    if (node.shape !== 'group') continue;
    for (const child of node.children) if (!holder.has(child)) holder.set(child, node.id);
  }
  const frameOf = (id: string, other: string): Box => {
    let box = boxes.get(id)!;
    for (let at = holder.get(id), depth = 0; at !== undefined && depth < 64; at = holder.get(at), depth++) {
      if (inside(diagram, at).has(other)) break;
      box = boxes.get(at) ?? box;
    }
    return box;
  };

  const routes: EdgeRoute[] = [];
  for (const edge of diagram.edges) {
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    if (!from || !to) continue;
    let a = centre(from);
    let b = centre(to);

    // Corners the author put in win over anything computed here, for the same
    // reason a pinned shape does: the point of writing them down is that they
    // are not decided again on the next render.
    const bend = diagram.bends.get(`${edge.from}->${edge.to}`);
    if (bend && bend.points.length > 0) {
      routes.push({ edge, points: [a, ...bend.points, b], labelAt: undefined });
      continue;
    }
    if (edge.from === edge.to) {
      routes.push({ edge, points: selfLoop(from, across, byId.get(edge.from)?.shape === 'group'), labelAt: undefined });
      continue;
    }

    const clear = (points: readonly Point[]): boolean => {
      for (let i = 0; i + 1 < points.length; i++) {
        if (blocked(diagram, boxes, edge, points[i]!, points[i + 1]!)) return false;
      }
      return true;
    };

    if (diagram.mode !== 'flow') {
      // Moved aside square to the line, measured from the end with the
      // smaller name, so that `a -> b` and `b -> a` go to opposite sides.
      const shift = clampShift(aside.get(edge) ?? 0, from, to);
      if (shift !== 0) {
        const [p, q] = edge.from < edge.to ? [a, b] : [b, a];
        const length = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        const normal = { x: -(q.y - p.y) / length, y: (q.x - p.x) / length };
        a = { x: a.x + normal.x * shift, y: a.y + normal.y * shift };
        b = { x: b.x + normal.x * shift, y: b.y + normal.y * shift };
      }
      routes.push({ edge, points: [a, b], labelAt: undefined });
      continue;
    }

    // A connection the layout did not place — one to a group, or to a pinned
    // shape — runs the way the drawing does.
    const course = courses.get(edge)
      ?? { across, back: across ? b.x < a.x : b.y < a.y };
    const turn = course.across;
    // A group is met level with the other end, inside its frame, rather than
    // at its centre — where the lines to what it holds already run.
    if (byId.get(edge.from)?.shape === 'group') a = meet(from, b, turn);
    if (byId.get(edge.to)?.shape === 'group') b = meet(to, a, turn);
    const t = (p: Point): Point => (turn ? { x: p.y, y: p.x } : p);
    const turnBox = (box: Box): Box => (turn ? { ...box, x: box.y, y: box.x, width: box.height, height: box.width } : box);
    const side = (name: keyof typeof lanes): keyof typeof lanes =>
      (turn ? ({ left: 'top', right: 'bottom', top: 'left', bottom: 'right' } as const)[name] : name);
    const edgeOf = (name: keyof typeof lanes): number => bounds[side(name)];
    const fits = (points: readonly Point[]): boolean => clear(points.map(t));
    const done = (points: readonly Point[]): void => {
      routes.push({ edge, points: points.map(t), labelAt: undefined });
    };
    // Moved aside across the flow, ends and turn alike, so two connections
    // between the same shapes run side by side the whole way.
    const shift = clampShift(aside.get(edge) ?? 0, turnBox(from), turnBox(to), true);
    const tail = { x: t(a).x + shift, y: t(a).y };
    const head = { x: t(b).x + shift, y: t(b).y };

    const direct = elbow(tail, head, turnBox(frameOf(edge.from, edge.to)), turnBox(frameOf(edge.to, edge.from)));
    if (direct.length === 4) {
      // The turn moves too, the way that keeps two side-by-side lines from
      // crossing: the one on the outside of the corner turns further out.
      // Worked out on the line's own course, so `a -> b` and `b -> a` agree.
      const step = -shift * Math.sign(head.x - tail.x || 1) * Math.sign(head.y - tail.y || 1);
      direct[1] = { ...direct[1]!, y: direct[1]!.y + step };
      direct[2] = { ...direct[2]!, y: direct[2]!.y + step };
    }
    if (fits(direct)) { done(direct); continue; }

    // Going back is drawn on one side, going on on the other, so the two never
    // share a channel and the direction is readable at a glance.
    const back = course.back;
    const beside = back ? 'left' : 'right';
    const x = beside === 'right'
      ? edgeOf('right') + CHANNEL_GAP * lanes[side('right')]
      : edgeOf('left') - CHANNEL_GAP * lanes[side('left')];

    const besides = [tail, { x, y: tail.y }, { x, y: head.y }, head];
    if (fits(besides)) {
      lanes[side(beside)]++;
      done(besides);
      continue;
    }

    const end = back ? 'top' : 'bottom';
    const y = end === 'bottom'
      ? edgeOf('bottom') + CHANNEL_GAP * lanes[side('bottom')]
      : edgeOf('top') - CHANNEL_GAP * lanes[side('top')];

    const around = [tail, { x, y: tail.y }, { x, y }, { x: head.x, y }, head];
    if (fits(around)) {
      lanes[side(beside)]++;
      lanes[side(end)]++;
      done(around);
      continue;
    }

    lanes[side(end)]++;
    done([tail, { x: tail.x, y }, { x: head.x, y }, head]);
  }
  return placeLabels(routes);
}

/** Between two connections that join the same two shapes. */
const PARALLEL_GAP = 18;

/**
 * How far each connection is moved off the line between the centres. Two
 * connections between the same shapes — `a -> b` and `b -> a`, or the same
 * one written twice with different labels — would otherwise be drawn on top of
 * each other, and read as one line (two dashed lines out of step even read as
 * a solid one). A connection whose corners were written by hand is left where
 * its author put it.
 */
function parallels(diagram: DiagramFile): Map<Edge, number> {
  const groups = new Map<string, Edge[]>();
  for (const edge of diagram.edges) {
    // A link that is not drawn takes no room beside the ones that are.
    if (edge.from === edge.to || edge.line === 'invisible') continue;
    if ((diagram.bends.get(`${edge.from}->${edge.to}`)?.points.length ?? 0) > 0) continue;
    const key = [edge.from, edge.to].sort().join('\0');
    const list = groups.get(key);
    if (list) list.push(edge); else groups.set(key, [edge]);
  }
  const out = new Map<Edge, number>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    // Labels sit on their lines, so labelled lines need the room of a label.
    const gap = list.some(edge => edge.label) ? EDGE_LABEL.height + 8 : PARALLEL_GAP;
    list.forEach((edge, i) => out.set(edge, (i - (list.length - 1) / 2) * gap));
  }
  return out;
}

/**
 * The shift, kept inside both shapes: a line moved off the side of the shape
 * it leaves would look as if it came from nowhere. `across` measures only the
 * width (a flow's lines are moved sideways); otherwise the narrower side.
 */
function clampShift(shift: number, from: Box, to: Box, across = false): number {
  if (shift === 0) return 0;
  const room = (box: Box): number => (across ? box.width : Math.min(box.width, box.height)) / 2 - 6;
  const limit = Math.max(0, Math.min(room(from), room(to)));
  return Math.max(-limit, Math.min(limit, shift));
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
    const boxAt = (at: Point): Box => plateAt(label, at);

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
  // A connection to a group starts inside its frame, among what it holds: those
  // are not in the way of it.
  const ends = new Set([...inside(diagram, edge.from), ...inside(diagram, edge.to)]);
  for (const node of diagram.nodes) {
    if (ends.has(node.id) || node.shape === 'group') continue;
    const box = boxes.get(node.id);
    if (box && crossesBox(a, b, box)) return true;
  }
  return false;
}

/**
 * How far a connection from a shape to itself stands out from the shape. Less
 * than a group's padding, so the loop of a shape in a group stays in its frame.
 */
const LOOP_REACH = 16;

/**
 * A connection from a shape to itself: out of one side and back in a little
 * further along, on the side the flow does not use — the right of a flow down
 * the page, the bottom of one across it. The ends start inside the shape and
 * are cut at its outline when drawn, like any other.
 *
 * A group's loop is put near the start of that side rather than its middle:
 * from the middle it hangs between two of the shapes inside, and reads as a
 * line of theirs.
 */
function selfLoop(box: Box, across: boolean, group: boolean): Point[] {
  if (across) {
    const q = Math.min(box.width / 4, 24);
    const x = group ? box.x + GROUP_PAD + q : box.x + box.width / 2;
    const from = group ? box.y + box.height - 4 : box.y + box.height / 2;
    const y = box.y + box.height + LOOP_REACH;
    return [{ x: x - q, y: from }, { x: x - q, y }, { x: x + q, y }, { x: x + q, y: from }];
  }
  const q = Math.min(box.height / 4, 24);
  const y = group ? box.y + GROUP_HEADER + GROUP_PAD + q : box.y + box.height / 2;
  const from = group ? box.x + box.width - 4 : box.x + box.width / 2;
  const x = box.x + box.width + LOOP_REACH;
  return [{ x: from, y: y - q }, { x, y: y - q }, { x, y: y + q }, { x: from, y: y + q }];
}

/**
 * Where a connection meets a group in a flow: across the flow, level with the
 * other end as far as the frame allows; along it, the group's middle, so the
 * line leaves through the side that faces the other end.
 */
function meet(group: Box, other: Point, across: boolean): Point {
  const c = centre(group);
  const clamp = (value: number, low: number, high: number): number =>
    low > high ? (low + high) / 2 : Math.min(Math.max(value, low), high);
  return across
    ? { x: c.x, y: clamp(other.y, group.y + GROUP_HEADER + GROUP_PAD / 2, group.y + group.height - GROUP_PAD / 2) }
    : { x: clamp(other.x, group.x + GROUP_PAD / 2, group.x + group.width - GROUP_PAD / 2), y: c.y };
}

/** A shape, or a group and everything inside it, however deep. */
function inside(diagram: DiagramFile, id: string): Set<string> {
  const out = new Set<string>();
  const take = (one: string): void => {
    if (out.has(one)) return;
    out.add(one);
    const node = diagram.nodes.find(n => n.id === one);
    if (node?.shape === 'group') for (const child of node.children) take(child);
  };
  take(id);
  return out;
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
  return plateAt(route.edge.label, route.labelAt);
}

/**
 * The plate a label sits on, centred at `at`. A connection's label is not
 * wrapped — it runs along a line, not inside a box — so it breaks only where
 * `\n` says, and the plate is as wide as its widest line.
 */
function plateAt(label: string, at: Point): Box {
  const lines = wrapRuns(parseLabel(label), Infinity, EDGE_LABEL.fontSize);
  // An unbroken label keeps the width it always had.
  const natural = lines.length > 1
    ? Math.max(...lines.map(line => textWidth(lineText(line), EDGE_LABEL.fontSize)))
    : textWidth(label, EDGE_LABEL.fontSize);
  const width = natural + EDGE_LABEL.padding;
  const height = EDGE_LABEL.height + (lines.length - 1) * EDGE_LABEL.lineHeight;
  return { x: at.x - width / 2, y: at.y - height / 2, width, height, z: 0, lines };
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
  const runs = parseLabel(node.text);
  const shown = lineText(runs);
  // A label broken by hand is as wide as its widest line, not as all of it.
  const natural = shown.includes('\n')
    ? Math.max(...shown.split('\n').map(line => textWidth(line, FONT)))
    : textWidth(node.text, FONT);
  const inner = (pin?.width ?? given?.width) !== undefined
    ? (pin?.width ?? given!.width) - TEXT_PAD
    : Math.min(MAX_NODE_WIDTH, Math.max(DEFAULT_SIZE.width, natural + TEXT_PAD)) - TEXT_PAD;
  const lines = wrapRuns(runs, inner, FONT);
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

/** How one connection runs, decided where its two ends were laid out. */
interface Course {
  /** Its flow runs across the page, so it leaves and enters through the sides. */
  readonly across: boolean;
  /** It goes against its flow, so a detour takes the other side. */
  readonly back: boolean;
}

/** A flow's direction as two questions: which axis it runs along, and which way. */
function axisOf(direction: FlowDirection | undefined): { across: boolean; reversed: boolean } {
  return {
    across: direction === 'LR' || direction === 'RL',
    reversed: direction === 'BT' || direction === 'RL',
  };
}

/**
 * Lays out a flow, and a group that names its own direction as a flow of its
 * own inside it.
 *
 * Such a group is laid out first, on its own, and then takes part in the
 * drawing around it as one shape the size of its frame — which is what lets a
 * left-to-right group sit in a top-to-bottom drawing without the two
 * directions pulling at the same shapes. Mermaid drops a subgraph's direction
 * as soon as one of its shapes is joined to something outside; here it holds,
 * because a direction written down and then ignored is a decision lost (P6).
 */
function autoPositions(
  diagram: DiagramFile,
  plain: readonly Node[],
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  diagnostics: Phrase[],
): { positions: Map<string, { x: number; y: number }>; courses: ReadonlyMap<Edge, Course> } {
  const present = new Set(plain.map(n => n.id));
  const byId = new Map(diagram.nodes.map(n => [n.id, n]));

  // A container arranges its own inside, so a direction on one is not a layout.
  const directed = diagram.nodes.filter(n => n.shape === 'group' && n.direction !== undefined);
  for (const group of directed) {
    if (diagram.containers.has(group.id)) {
      diagnostics.push(dgm('diagram.layout.directionContainer', { id: group.id }));
    }
  }
  const clusters = new Set(directed.filter(n => !diagram.containers.has(n.id)).map(n => n.id));

  // Which directed group lays out each shape, and each directed group that
  // sits inside another. First come, first served: a shape is laid out once.
  const owner = new Map<string, string>();
  const holds = (outer: string, inner: string): boolean => {
    for (let at: string | undefined = outer, depth = 0; at !== undefined && depth < 64; at = owner.get(at), depth++) {
      if (at === inner) return true;
    }
    return false;
  };
  for (const group of directed) {
    if (!clusters.has(group.id)) continue;
    const seen = new Set<string>();
    const take = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      const node = byId.get(id);
      // A plain group inside is a frame drawn round what it holds, not a
      // layout of its own: what it holds is laid out here.
      if (node?.shape === 'group' && !clusters.has(id)) {
        for (const child of node.children) take(child);
        return;
      }
      if (!present.has(id) && !clusters.has(id)) return;
      // A group named inside one it already holds would hold itself.
      if (holds(group.id, id)) return;
      const other = owner.get(id);
      if (other !== undefined) {
        if (other !== group.id) {
          diagnostics.push(dgm('diagram.layout.twoDirections', { id, group: other, other: group.id }));
        }
        return;
      }
      owner.set(id, group.id);
    };
    for (const child of group.children) take(child);
  }

  // From a shape up through the groups laying it out, to the drawing itself.
  const chain = (id: string): (string | undefined)[] => {
    const out: (string | undefined)[] = [id];
    for (let at = owner.get(id); at !== undefined && out.length < 64; at = owner.get(at)) out.push(at);
    out.push(undefined);
    return out;
  };

  // A connection belongs to the innermost layout that holds both its ends,
  // and there it joins whatever stands for each end — the shape itself, or
  // the group the shape is inside.
  interface Joined { readonly from: string; readonly to: string; readonly edge: Edge }
  const joins = new Map<string | undefined, Joined[]>();
  for (const edge of diagram.edges) {
    // `b --> a ~` is drawn but does not order the flow: it goes whichever way
    // the others put its ends.
    if (edge.loose) continue;
    // A connection to a group joins everything the group holds: `g1 --> g2`
    // puts all of g2 after all of g1, so the two frames do not land on top of
    // each other.
    for (const from of laidOutAs(edge.from)) {
      for (const to of laidOutAs(edge.to)) {
        const a = chain(from);
        const b = chain(to);
        // A group joined to what it holds says nothing about the order.
        if (a.includes(to) || b.includes(from)) continue;
        const level = a.slice(1).find(one => b.includes(one));
        const one = { from: a[a.indexOf(level) - 1]!, to: b[b.indexOf(level) - 1]!, edge };
        const list = joins.get(level);
        if (list) list.push(one); else joins.set(level, [one]);
      }
    }
  }

  /**
   * What a connection's end stands for in the layout: a shape, or a group
   * laid out as one shape, is itself; a group that is only a frame is what it
   * holds.
   */
  function laidOutAs(id: string, seen = new Set<string>()): string[] {
    if (present.has(id) || clusters.has(id)) return [id];
    const node = byId.get(id);
    if (node?.shape !== 'group' || seen.has(id)) return [];
    seen.add(id);
    return node.children.flatMap(child => laidOutAs(child, seen));
  }

  // What each layout places, in the order the file names it.
  const units = new Map<string | undefined, string[]>();
  const add = (level: string | undefined, id: string): void => {
    const list = units.get(level);
    if (list) list.push(id); else units.set(level, [id]);
  };
  for (const node of plain) add(owner.get(node.id), node.id);
  for (const id of clusters) add(owner.get(id), id);

  const courses = new Map<Edge, Course>();
  const unitSizes = new Map<string, { width: number; height: number }>(sizes);
  const placed = new Map<string | undefined, Map<string, { x: number; y: number }>>();

  // Inner groups first: a group is as big as its own drawing, and the layout
  // around it needs that size. A group with nothing to lay out takes no room.
  const lay = (level: string | undefined): boolean => {
    const done = placed.get(level);
    if (done) return done.size > 0 || level === undefined;
    placed.set(level, new Map());
    const members = (units.get(level) ?? []).filter(id => !clusters.has(id) || lay(id));
    if (level !== undefined && members.length === 0) return false;

    const axis = axisOf(level === undefined ? diagram.direction : byId.get(level)!.direction);
    const inside = new Set(members);
    const joined = (joins.get(level) ?? []).filter(one => inside.has(one.from) && inside.has(one.to));
    const laid = layered(members, joined, id => unitSizes.get(id)!, axis);
    for (const one of joined) courses.set(one.edge, { across: axis.across, back: laid.back(one) });
    placed.set(level, laid.positions);
    if (level !== undefined) {
      unitSizes.set(level, {
        width: laid.width + GROUP_PAD * 2,
        height: laid.height + GROUP_PAD * 2 + GROUP_HEADER,
      });
    }
    return true;
  };
  lay(undefined);

  // The offsets the frames give, the same `GROUP_PAD` and header the frame is
  // drawn round its members with — so the frame lands where the room was kept.
  const positions = new Map<string, { x: number; y: number }>();
  const put = (level: string | undefined, dx: number, dy: number): void => {
    for (const [id, at] of placed.get(level) ?? []) {
      if (clusters.has(id)) put(id, dx + at.x + GROUP_PAD, dy + at.y + GROUP_PAD + GROUP_HEADER);
      else positions.set(id, { x: dx + at.x, y: dy + at.y });
    }
  };
  put(undefined, 0, 0);
  return { positions, courses };
}

/**
 * A layered layout: rank by longest path, order each rank by the average
 * position of its neighbours, then space the ranks out along the flow. It is
 * not TALA, but it is deterministic, which is what a diff needs.
 *
 * Worked out along the flow and across it, so one piece of code serves all
 * four directions; a reversed flow is the same layout read from the far end.
 */
function layered<E extends { from: string; to: string; edge?: Edge }>(
  ids: readonly string[],
  edges: readonly E[],
  sizeOf: (id: string) => { width: number; height: number },
  axis: { across: boolean; reversed: boolean },
): {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
  back: (edge: E) => boolean;
} {
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
    const total = row.reduce((sum, id) => sum + side(id), 0) + NODE_GAP * Math.max(0, row.length - 1);
    const deepest = row.reduce((h, id) => Math.max(h, along(id)), 0);
    let across = -total / 2;
    for (const id of row) {
      flat.set(id, { along: Math.round(at + (deepest - along(id)) / 2), side: Math.round(across) });
      across += side(id) + NODE_GAP;
    }
    at += deepest + RANK_GAP;
  }
  const length = Math.max(0, at - RANK_GAP);

  const positions = new Map<string, { x: number; y: number }>();
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

  return { positions, width, height, back: edge => rank.get(edge.to)! < rank.get(edge.from)! };
}

/**
 * The edges the ranking follows: all of them but the ones that would close a
 * cycle. A connection to a group stands for several edges here, one to each
 * shape it holds, and they go one way together — taking some of `g1 --> g2`
 * and some of `g2 --> g1` would interleave the two groups. So a connection is
 * taken whole or set aside whole: first the ones the walk below finds going
 * forward, then the rest, each only if none of its edges closes a cycle.
 */
function forwardEdges<E extends { from: string; to: string; edge?: Edge }>(
  ids: readonly string[], edges: readonly E[],
): E[] {
  const closing = backEdges(ids, edges);
  const whole = new Map<unknown, E[]>();
  for (const edge of edges) {
    const key = edge.edge ?? edge;
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

/**
 * The line a diagnostic is about, read from the names it mentions: the shape
 * it names, else the bend, the group, the container, or a connection that
 * names it. A name nothing declares — a typo, which is what most of these
 * are — is found where it was written, not where it was meant.
 */
function placeOf(diagram: DiagramFile, phrase: Phrase): ByteSpan | undefined {
  const params = phrase.params ?? {};
  const word = (name: string): string | undefined => {
    const value = params[name];
    return typeof value === 'string' ? value : undefined;
  };
  const id = word('id');
  const nodeAt = (name: string | undefined): ByteSpan | undefined =>
    name === undefined ? undefined : diagram.nodes.find(node => node.id === name)?.span;
  const key = word('key');
  // A cell is written in its container's block, so that is the line to mark.
  const cell = word('cell');
  if (cell !== undefined) {
    const holder = [...diagram.containers.values()]
      .find(one => one.id === id || one.cells.some(row => row.includes(cell)));
    if (holder) return holder.span;
  }
  return nodeAt(id)
    ?? (key === undefined ? undefined : diagram.bends.get(key)?.span)
    ?? nodeAt(word('group'))
    ?? (id === undefined ? undefined : diagram.containers.get(id)?.span)
    ?? diagram.edges.find(edge => edge.from === id || edge.to === id)?.span
    ?? diagram.body?.span;
}

/** Shifts everything into positive coordinates and reports the canvas size. */
function normalize(
  boxes: Map<string, Box>, routes: readonly EdgeRoute[],
  diagram: DiagramFile, notes: readonly DiagramNote[], holes: readonly Hole[],
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
  // A group inside a group is the same: it has to be written first so the
  // outer frame can be drawn round it, and painted first it would be covered.
  const held = new Map(containerOf(diagram));
  for (const group of diagram.nodes) {
    if (group.shape !== 'group') continue;
    for (const child of group.children) if (!held.has(child)) held.set(child, group.id);
  }
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
    width: Math.ceil(width), height: Math.ceil(height), order,
    diagnostics: notes.map(note => note.message), notes,
    origin: { x: -minX + PAD, y: -minY + PAD },
    // The same shift the boxes took: an empty cell sits among them, so it has
    // to be measured in the same numbers.
    holes: holes.map(hole => ({
      ...hole, box: { ...hole.box, ...move({ x: hole.box.x, y: hole.box.y }) },
    })),
  };
}
