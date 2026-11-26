// Turns a diagram into geometry. The three-layer model says the layout layer
// holds only what a human pinned, so everything else is computed here, on
// every render, from the semantics alone. Pinned coordinates always win: an
// automatic layout that moved a shape someone had placed by hand would make
// the pin meaningless.

import { arrangeContainers, containerOf, type Hole, type TableRules } from './arrange.js';
import { fontOf } from './states.js';
import { layoutEngine, type GraphEdge } from './engine.js';
// Puts the engine that ships with the tool in the register. Something has to
// import it for its registration to run, and `engine.js` cannot — the two
// would then depend on each other — so the layout, which is what needs an
// engine to exist at all, is where it is done.
import './layered.js';
import { lineText, parseLabel, parseRuns, type TextLine } from './inline.js';
import {
  DEFAULT_SIZE, type DiagramFile, type Edge, type FlowDirection, type Node, type Point,
} from './model.js';
import { isListing } from './draw/listing.js';
import { HOP_RADIUS } from './draw/geometry.js';
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
  /**
   * Where this line steps over another, drawn as a small arc so that a reader
   * at the crossing can see which of the two carries on through it.
   *
   * Only the line running across the flow steps over the one running along
   * it, so the spine of the drawing is never broken and a crossing is always
   * read the same way round.
   *
   * These are a drawing, not geometry: the line still goes straight through.
   * The screen and the PDF draw them; a deck cannot, because its connections
   * are PowerPoint's own bent-connector shapes and those have no such arc.
   * Leaving them out there is deliberate — a drawn-out line that someone can
   * no longer move with the shape would cost more than the arc is worth.
   */
  readonly hops: readonly Point[];
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
  /** Where the rules of each table go, in the drawing's own coordinates. */
  readonly tables: readonly TableRules[];
  /**
   * What a screen's item table adds to it: a number on each item and a mark
   * after the caption of each required one. Not shapes — nothing in the file
   * says where they are, so nothing on the canvas can move them.
   */
  readonly marks: readonly ItemMark[];
}

/** A number or a "required" drawn on a screen from its item table. */
export interface ItemMark {
  readonly kind: 'number' | 'required';
  /** The item it belongs to. */
  readonly id: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The `required` part's look; empty for a number, which the theme draws. */
  readonly style: ReadonlyMap<string, string>;
}

/** How big an item's number is drawn: a circle that sits on its top-left corner. */
export const ITEM_NUMBER = 18;

const PAD = 16;          // margin around the drawing
const RANK_GAP = 72;     // between rows of a graph
const NODE_GAP = 36;     // between shapes in the same row
const GROUP_PAD = 20;    // between a group's border and its contents
const GROUP_HEADER = 18; // room for the group's own label
const CHANNEL_GAP = 28;  // between the shapes and a detouring connection
const FONT = 14;
const LINE_HEIGHT = 20;
/** How far apart the lines of words of a size are: as the default is, scaled. */
export function lineHeightFor(size: number): number {
  return Math.round(LINE_HEIGHT * size / FONT);
}
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

  const sizes = new Map<string, { width: number; height: number; lines: readonly TextLine[]; natural?: number }>();
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
  const tables: TableRules[] = [];
  const hidden = arrangeContainers(
    diagram, id => sizes.get(id) ?? { width: 0, height: 0, lines: [] }, boxes, diagnostics, holes, tables,
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

  for (const note of diagram.itemLinks?.notes ?? []) diagnostics.push(note);
  const marks = itemMarks(diagram, boxes);

  const routes = route(diagram, boxes, auto.courses);
  const notes = diagnostics.map(one => ({ id: one.id, message: say(locale, one), span: placeOf(diagram, one) }));
  return normalize(boxes, routes, diagram, notes, holes, marks, tables);
}

/**
 * Where each item's number and "required" go. The number sits on the item's
 * top-left corner, as a callout on a screenshot does; "required" goes after
 * the last word of the caption the item is named by, because that is where a
 * reader of a form looks for it.
 */
function itemMarks(diagram: DiagramFile, boxes: ReadonlyMap<string, Box>): ItemMark[] {
  const links = diagram.itemLinks;
  if (!links) return [];
  const marks: ItemMark[] = [];
  const marked = new Set<string>();
  for (const link of links.links.values()) {
    // A column of a table is no one shape: its marks go on its heading.
    const box = boxes.get(link.at);
    if (!box) continue;
    if (link.number !== undefined) {
      // On a check box the corner is most of the box, so a small item has its
      // number beside it instead.
      const small = box.width <= ITEM_NUMBER * 2 && box.height <= ITEM_NUMBER * 2;
      // A child's number (`3-1`) is longer than a circle holds: it becomes a pill.
      const wide = Math.max(ITEM_NUMBER, textWidth(link.number, 11) + 8);
      // A column's number sits over the middle of its heading: the table's
      // own number has the table's corner, which is the first heading's too.
      const column = link.at !== link.id;
      marks.push({
        kind: 'number', id: link.id, text: link.number,
        x: column ? box.x + box.width / 2 - wide / 2 : small ? box.x - wide - 3 : box.x - ITEM_NUMBER / 2,
        y: small && !column ? box.y + box.height / 2 - ITEM_NUMBER / 2 : box.y - ITEM_NUMBER / 2,
        width: wide, height: ITEM_NUMBER, style: new Map(),
      });
    }
    const target = link.label ?? link.at;
    const caption = boxes.get(target);
    if (!link.required || !caption || marked.has(target)) continue;
    marked.add(target);
    const last = caption.lines[caption.lines.length - 1];
    const words = last === undefined ? '' : lineText(last);
    const wide = textWidth(words, FONT);
    const align = diagram.style.get(target)?.get('align');
    const end = words === '' ? caption.x + caption.width
      : align === 'left' ? caption.x + 8 + wide
        : align === 'right' ? caption.x + caption.width - 8
          : caption.x + caption.width / 2 + wide / 2;
    const middle = caption.y + caption.height / 2 + (Math.max(0, caption.lines.length - 1) * LINE_HEIGHT) / 2;
    const width = links.mark.width ?? Math.max(10, textWidth(links.mark.text, 13) + 4);
    const height = links.mark.height ?? 18;
    marks.push({
      kind: 'required', id: link.id, text: links.mark.text,
      x: end + 2, y: middle - height / 2, width, height, style: links.mark.style,
    });
  }
  return marks;
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

  // Where every line leaves, enters and turns, decided for all of them
  // together: one line cannot tell on its own whether it is about to be drawn
  // on top of another.
  const { places: placed, corridors } = channels(diagram, boxes, courses, frameOf, across, aside);

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
      routes.push({ edge, points: [a, ...bend.points, b], labelAt: undefined, hops: [] });
      continue;
    }
    if (edge.from === edge.to) {
      routes.push({ edge, points: selfLoop(from, across, byId.get(edge.from)?.shape === 'group'), labelAt: undefined, hops: [] });
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
      routes.push({ edge, points: [a, b], labelAt: undefined, hops: [] });
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
      routes.push({ edge, points: points.map(t), labelAt: undefined, hops: [] });
    };
    // Moved aside across the flow, ends and turn alike, so two connections
    // between the same shapes run side by side the whole way.
    const shift = clampShift(aside.get(edge) ?? 0, turnBox(from), turnBox(to), true);
    // And moved again to its own place on the side of each shape, so that
    // the lines leaving one shape do not all leave the same point.
    const port = placed.get(edge) ?? { tail: 0, head: 0, lane: undefined };
    const inset = (offset: number, box: Box): number => {
      const room = Math.max(0, turnBox(box).width / 2 - 6);
      return Math.max(-room, Math.min(room, offset));
    };
    const tail = { x: t(a).x + inset(shift + port.tail, from), y: t(a).y };
    const head = { x: t(b).x + inset(shift + port.head, to), y: t(b).y };

    const direct = elbow(tail, head, turnBox(frameOf(edge.from, edge.to)), turnBox(frameOf(edge.to, edge.from)));
    if (direct.length === 4) {
      if (port.lane !== undefined) {
        // Its own lane in the gap, worked out against every other line
        // crossing the same gap.
        direct[1] = { ...direct[1]!, y: port.lane };
        direct[2] = { ...direct[2]!, y: port.lane };
      } else {
        // The turn moves too, the way that keeps two side-by-side lines from
        // crossing: the one on the outside of the corner turns further out.
        // Worked out on the line's own course, so `a -> b` and `b -> a` agree.
        const step = -shift * Math.sign(head.x - tail.x || 1) * Math.sign(head.y - tail.y || 1);
        direct[1] = { ...direct[1]!, y: direct[1]!.y + step };
        direct[2] = { ...direct[2]!, y: direct[2]!.y + step };
      }
    }
    if (fits(direct)) { done(direct); continue; }

    // Going back is drawn on one side, going on on the other, so the two never
    // share a channel and the direction is readable at a glance.
    const back = course.back;
    const beside = back ? 'left' : 'right';
    const x = beside === 'right'
      ? edgeOf('right') + CHANNEL_GAP * lanes[side('right')]
      : edgeOf('left') - CHANNEL_GAP * lanes[side('left')];

    // Every way round is weighed rather than the first that is clear taken:
    // a way through nothing can still cross or run along the lines drawn
    // before it, and two lines wound round each other read as neither.
    // `lanes` are the outside channels a way takes up, kept for the next line.
    type Way = { points: Point[]; lanes: (keyof typeof lanes)[] };
    const turned = all.map(turnBox);
    const fromFrame = turnBox(frameOf(edge.from, edge.to));
    const toFrame = turnBox(frameOf(edge.to, edge.from));
    const end = back ? 'top' : 'bottom';
    const y = end === 'bottom'
      ? edgeOf('bottom') + CHANNEL_GAP * lanes[side('bottom')]
      : edgeOf('top') - CHANNEL_GAP * lanes[side('top')];
    // The channel at the other end of the drawing, for a line that leaves the
    // way the flow runs before going round.
    const far = back ? 'bottom' : 'top';
    const farY = far === 'bottom'
      ? edgeOf('bottom') + CHANNEL_GAP * lanes[side('bottom')]
      : edgeOf('top') - CHANNEL_GAP * lanes[side('top')];
    // A detour turns clear of every lane the lines above already took.
    const clearLane = (y: number, low: number, high: number): number =>
      clearOf(y, turn ? corridors.across : corridors.along, low, high);
    const outer = gapsOf(tail, head, fromFrame, toFrame, clearLane);

    // Between the shapes: leaving along the flow and turning in the gap
    // between rows, so the line does not cut across its neighbours.
    const between: Way[] = gapRoutes(tail, head, fromFrame, toFrame, turned, clearLane)
      .map(points => ({ points, lanes: [] }));
    // Outside: the channel beside the drawing, straight across or through the
    // gaps between rows.
    const outside: Way[] = [
      { points: [tail, { x, y: tail.y }, { x, y: head.y }, head], lanes: [beside] },
      { points: tidy([tail, { x: tail.x, y: outer.leave }, { x, y: outer.leave },
        { x, y: outer.enter }, { x: head.x, y: outer.enter }, head]), lanes: [beside] },
    ];
    const around: Way[] = [
      { points: [tail, { x, y: tail.y }, { x, y }, { x: head.x, y }, head], lanes: [beside, end] },
      { points: [tail, { x: tail.x, y }, { x: head.x, y }, head], lanes: [end] },
      // Out the way the flow runs, round the outside of everything, and in at
      // the far end. A connection from the foot of a drawing back to its head
      // has nowhere good to go through the middle: every row is in the way,
      // and the ways above leave sideways at the height of the shape they
      // start from, which on a crowded row is straight through its neighbour.
      // Going round is longer, and crosses nothing.
      {
        points: tidy([tail, { x: tail.x, y: farY }, { x, y: farY },
          { x, y }, { x: head.x, y }, head]),
        lanes: [beside, end, far],
      },
    ];
    // A line going back keeps to the outside when it can, so the direction
    // reads at a glance: the channel beside the drawing, or right round it.
    // Which of those is weighed below, not decided here — a line from the foot
    // of a drawing back to its head reaches the channel only by cutting
    // through the row it starts on, and going round is then both clear and,
    // once the crossings are counted, cheaper. A line going on takes the best
    // way there is.
    const tiers: Way[][] = back
      ? [[...outside, ...around], between]
      : [[...between, ...outside, ...around]];

    const ends = [frameOf(edge.from, edge.to), frameOf(edge.to, edge.from)];
    // Lines from or to the same shape may run together into it — they meet
    // there anyway; only crossing them counts.
    const drawn = routes.map(one => ({
      points: one.points,
      merges: [one.edge.from, one.edge.to].some(id => id === edge.from || id === edge.to),
    }));
    const cost = (way: Way): number => {
      const real = way.points.map(t);
      return pathLength(real) + BEND_COST * (real.length - 2) + tangle(real, drawn, ends) * TANGLE_COST;
    };
    const cheapest = (ways: readonly Way[]): Way | undefined => {
      let best: Way | undefined;
      let lowest = Infinity;
      for (const way of ways) {
        const value = cost(way);
        if (value < lowest) { best = way; lowest = value; }
      }
      return best;
    };

    let chosen: Way | undefined;
    for (const tier of tiers) {
      chosen = cheapest(tier.filter(way => fits(way.points)));
      if (chosen) break;
    }
    if (!chosen) {
      // Nothing is clear. The way that runs through the fewest shapes is the
      // least wrong; through the shapes between them is the most.
      const crossings = (points: readonly Point[]): number => {
        const real = points.map(t);
        let count = 0;
        for (const node of diagram.nodes) {
          if (node.shape === 'group' || node.id === edge.from || node.id === edge.to) continue;
          const box = boxes.get(node.id);
          if (!box) continue;
          for (let i = 0; i + 1 < real.length; i++) {
            if (crossesBox(real[i]!, real[i + 1]!, box)) { count++; break; }
          }
        }
        return count;
      };
      const every = tiers.flat();
      const fewest = Math.min(...every.map(way => crossings(way.points)));
      chosen = cheapest(every.filter(way => crossings(way.points) === fewest))!;
    }
    for (const one of chosen.lanes) lanes[side(one)]++;
    done(chosen.points);
  }
  // A group's frame is not a shape a line hides behind: a crossing inside one
  // is drawn, so it is stepped over like any other.
  const solid = new Map([...boxes].filter(([id]) => byId.get(id)?.shape !== 'group'));
  return placeLabels(stepOver(routes, solid, across));
}

/** Between two connections turning in the same gap between two rows. */
const LANE_GAP = 16;
/**
 * How far apart two runs sharing a lane must end. Lines that merely touch
 * there put three line-ends on one point, and a reader at that junction
 * cannot tell which of them carries on through it.
 */
const LANE_CLEAR = 14;
/** The room kept between the outermost lane and the rows on either side. */
const LANE_MARGIN = 10;
/** How much of a shape's width the connections leaving one side may spread over. */
const PORT_SPREAD = 0.7;

/**
 * Where one connection leaves its shape, where it enters the next, and where
 * it turns in between. All three are measured across the flow, in the drawing's
 * own pixels, as an offset from where the line would otherwise run.
 */
interface Channel {
  readonly tail: number;
  readonly head: number;
  /** Where it turns, along the flow; absent when it turns where it always did. */
  readonly lane: number | undefined;
}

/**
 * The places every line turns, and the heights those turns are at. A line
 * that has to detour round a shape is not placed here — which way it goes is
 * not known until the ways are weighed — but it still has to keep out of the
 * lanes these lines took, so the heights are kept for it.
 */
interface Channels {
  readonly places: ReadonlyMap<Edge, Channel>;
  readonly corridors: { readonly along: readonly number[]; readonly across: readonly number[] };
}

/**
 * Works out those three for every connection at once.
 *
 * None of them can be decided for one line on its own. Four lines leaving the
 * same shape all leave its centre unless they are told about each other, and
 * four lines crossing the same gap between rows all turn at the middle of it.
 * Either on its own puts several lines on top of one another, and lines drawn
 * on top of one another read as one line — which is the whole of what makes a
 * busy flow unreadable, far more than any crossing does.
 *
 * So: the lines on one side of one shape are spread along that side, and the
 * lines crossing one gap are given lanes within it. Lanes are shared wherever
 * two lines cannot be confused — two whose runs do not overlap at all can turn
 * at the same height — so a drawing uses as few lanes as it needs, and a
 * drawing that needed none is left exactly as it was.
 */
function channels(
  diagram: DiagramFile,
  boxes: ReadonlyMap<string, Box>,
  courses: ReadonlyMap<Edge, Course>,
  frameOf: (id: string, other: string) => Box,
  defaultAcross: boolean,
  aside: ReadonlyMap<Edge, number>,
): Channels {
  const byId = new Map(diagram.nodes.map(n => [n.id, n]));
  const flip = (box: Box): Box =>
    ({ ...box, x: box.y, y: box.x, width: box.height, height: box.width });

  /** One connection as this pass sees it, already turned so the flow runs down. */
  interface Run {
    readonly edge: Edge;
    readonly turn: boolean;
    readonly from: Box;
    readonly to: Box;
    /** Where the line starts and ends across the flow, before anything here. */
    readonly at: { tail: number; head: number };
    /** Which side of each shape it uses: the far side along the flow, or the near one. */
    readonly down: boolean;
    /** The middle of the gap it crosses, which is where it would turn. */
    readonly middle: number;
    /** How far the gap reaches either side of the middle. */
    readonly half: number;
    /** Whether a frame in the way moved the middle off the one between its two shapes. */
    readonly moved: boolean;
  }

  const runs: Run[] = [];
  for (const edge of diagram.edges) {
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    if (!from || !to) continue;
    if (edge.from === edge.to) continue;
    // A line whose corners the author wrote goes where they put it.
    if ((diagram.bends.get(`${edge.from}->${edge.to}`)?.points.length ?? 0) > 0) continue;

    const turn = (courses.get(edge) ?? { across: defaultAcross }).across;
    let a = centre(from);
    let b = centre(to);
    if (byId.get(edge.from)?.shape === 'group') a = meet(from, b, turn);
    if (byId.get(edge.to)?.shape === 'group') b = meet(to, a, turn);
    const t = (p: Point): Point => (turn ? { x: p.y, y: p.x } : p);
    const fromFrame = turn ? flip(frameOf(edge.from, edge.to)) : frameOf(edge.from, edge.to);
    const toFrame = turn ? flip(frameOf(edge.to, edge.from)) : frameOf(edge.to, edge.from);

    // Only the lines that run along the flow are placed here. One between two
    // shapes side by side turns across the flow instead, and one between
    // shapes that overlap has no gap to turn in at all.
    const below = toFrame.y >= fromFrame.y + fromFrame.height;
    const above = toFrame.y + toFrame.height <= fromFrame.y;
    if (!below && !above) continue;

    // The gap ends at whatever the turn would run into first: the shape at
    // the far end, or a frame standing in the way across the run. Measured
    // to the far shape alone, a line to a shape beside a group turned along
    // the group's border, where it read as part of the frame.
    let near = below ? fromFrame.y + fromFrame.height : fromFrame.y;
    let far = below ? toFrame.y : toFrame.y + toFrame.height;
    const low = Math.min(t(a).x, t(b).x);
    const high = Math.max(t(a).x, t(b).x);
    for (const [id, other] of boxes) {
      if (id === edge.from || id === edge.to || byId.get(id)?.shape !== 'group') continue;
      const box = turn ? flip(other) : other;
      if (box.x >= high || box.x + box.width <= low) continue;
      if (below) {
        if (box.y > near && box.y < far) far = box.y;
        if (box.y + box.height > near && box.y + box.height < far && box.y < near) near = box.y + box.height;
      } else {
        const bottom = box.y + box.height;
        if (bottom < near && bottom > far) far = bottom;
        if (box.y < near && box.y > far && bottom > near) near = box.y;
      }
    }
    const middle = (near + far) / 2;
    const plain = below
      ? (fromFrame.y + fromFrame.height + toFrame.y) / 2
      : (toFrame.y + toFrame.height + fromFrame.y) / 2;
    runs.push({
      edge, turn, from: turn ? flip(from) : from, to: turn ? flip(to) : to,
      at: { tail: t(a).x, head: t(b).x }, down: below, middle,
      half: Math.abs(far - near) / 2, moved: Math.abs(middle - plain) >= 1,
    });
  }

  const out = new Map<Edge, Channel>();
  const corridors = { along: [] as number[], across: [] as number[] };
  if (runs.length === 0) return { places: out, corridors };
  for (const run of runs) out.set(run.edge, { tail: 0, head: 0, lane: undefined });

  const offsets = new Map<Run, { tail: number; head: number }>(
    runs.map(run => [run, { tail: 0, head: 0 }]),
  );

  // Which side of which shape each end leaves by, so that the lines on one
  // side can be looked at together.
  const sideKey = (run: Run, end: 'tail' | 'head'): string => {
    const id = end === 'tail' ? run.edge.from : run.edge.to;
    const far = run.down === (end === 'tail');
    return `${id}\0${run.turn ? 'across' : 'along'}\0${far}`;
  };
  const sides = new Map<string, { run: Run; end: 'tail' | 'head' }[]>();
  for (const run of runs) {
    for (const end of ['tail', 'head'] as const) {
      const key = sideKey(run, end);
      const list = sides.get(key);
      if (list) list.push({ run, end }); else sides.set(key, [{ run, end }]);
    }
  }

  // The gaps between rows, and which lines cross each one.
  const gaps = new Map<string, Run[]>();
  for (const run of runs) {
    const key = `${run.turn ? 'across' : 'along'}\0${Math.round(run.middle)}`;
    const list = gaps.get(key);
    if (list) list.push(run); else gaps.set(key, [run]);
  }

  // A pair between the same two shapes — `a --> b` written beside `b --> a` —
  // is drawn as two lines a little apart, each turning to its own side of the
  // gap so that they do not cross at the corner. The pair takes one lane
  // between them and spreads inside it: the two belong together, and the lane
  // has to know how much room they take or the next line along lands on top
  // of one of them.
  const asideOf = (run: Run): number => aside.get(run.edge) ?? 0;
  const paired = (run: Run): boolean => asideOf(run) !== 0;
  /** Whether the layout had to run this one against the flow. */
  const goesBack = (run: Run): boolean => courses.get(run.edge)?.back === true;
  /** Which of the pair's two sides of the lane this one turns on. */
  const pairStep = (run: Run): number => {
    const shift = asideOf(run);
    if (shift === 0) return 0;
    const sideways = Math.sign((run.at.head + offsets.get(run)!.head)
      - (run.at.tail + offsets.get(run)!.tail) || 1);
    return -shift * sideways * (run.down ? 1 : -1);
  };
  /** What a pair holds the two of them together: one line needs no room. */
  const bandOf = (run: Run): number => Math.abs(pairStep(run));
  const endAt = (run: Run, end: 'tail' | 'head'): number =>
    (end === 'tail' ? run.at.tail : run.at.head) + offsets.get(run)![end];
  const span = (run: Run): [number, number] => {
    const tail = endAt(run, 'tail');
    const head = endAt(run, 'head');
    return tail <= head ? [tail, head] : [head, tail];
  };

  /**
   * Whether two lines crossing one gap may turn at the same height. They may
   * when their runs across the flow do not overlap and end well apart — and
   * also when they only meet at a column both of them leave by. Two lines out
   * of one shape fork from one stem there, which is how a tree is drawn: it
   * reads as one line splitting, not as two lines confused.
   */
  const shares = (one: Run, other: Run): boolean => {
    const [al, ah] = span(one);
    const [bl, bh] = span(other);
    const over = Math.min(ah, bh) - Math.max(al, bl);
    if (over > 0) return false;
    if (-over >= LANE_CLEAR) return true;
    return Math.abs(endAt(one, 'tail') - endAt(other, 'tail')) < 1
      || Math.abs(endAt(one, 'head') - endAt(other, 'head')) < 1;
  };

  /**
   * Which lines have to turn below which. Two lines crossing one gap each
   * reach it by a stub above their turn and leave by one below it, and a line
   * whose turn runs over another's stub cuts it. So: if one line's run spans
   * the column another arrives by, it has to turn below that other; if it
   * spans the column the other leaves by, it has to turn above it.
   *
   * That is a constraint, not a preference, and it cannot be had from sorting
   * on any one measure — the order that works for a fan out of one shape is
   * the wrong way round for two lines coming together on one shape. So the
   * demands are collected and the lines are stacked in an order that meets
   * them.
   */
  const below = new Map<Run, Run[]>();

  /**
   * The lines of one gap, in the order they must turn in.
   *
   * Where the demands contradict each other the lines genuinely cross, and no
   * order avoids it: the widest goes first and its own demands are dropped,
   * which leaves one crossing instead of several.
   */
  const stack = (rows: readonly Run[]): Run[] => {
    const reach = (run: Run): number => { const [low, high] = span(run); return high - low; };
    const rank = (p: Run, q: Run): number =>
      reach(q) - reach(p) || span(p)[0] - span(q)[0] || span(p)[1] - span(q)[1];
    if (rows.length < 2) return [...rows].sort(rank);

    const inside = (run: Run, x: number): boolean => {
      const [low, high] = span(run);
      return x > low + 0.5 && x < high - 0.5;
    };
    // The column a line comes in by, and the one it leaves by, either side of
    // where it turns. A line running against the flow has them the other way.
    const over = (run: Run): number => endAt(run, run.down ? 'tail' : 'head');
    const under = (run: Run): number => endAt(run, run.down ? 'head' : 'tail');

    const after = new Map<Run, Set<Run>>(rows.map(run => [run, new Set<Run>()]));
    const waiting = new Map<Run, number>(rows.map(run => [run, 0]));
    const demand = (first: Run, next: Run): void => {
      if (first === next || after.get(first)!.has(next)) return;
      after.get(first)!.add(next);
      waiting.set(next, waiting.get(next)! + 1);
    };
    for (const one of rows) {
      for (const other of rows) {
        if (one === other) continue;
        if (inside(other, over(one))) demand(one, other);
        if (inside(other, under(one))) demand(other, one);
      }
    }

    const left = new Set(rows);
    const out: Run[] = [];
    while (left.size > 0) {
      const ready = [...left].filter(run => (waiting.get(run) ?? 0) === 0);
      const pick = (ready.length > 0 ? ready : [...left]).sort(rank)[0]!;
      left.delete(pick);
      out.push(pick);
      for (const next of after.get(pick)!) {
        if (left.has(next)) waiting.set(next, waiting.get(next)! - 1);
      }
    }
    for (const run of out) below.set(run, [...after.get(run)!]);
    return out;
  };

  /** Which lane of its gap each turning line takes, and how many each gap needs. */
  const sortOut = (): {
    slot: Map<Run, number>;
    width: Map<string, number>;
    turning: Map<string, Run[]>;
  } => {
    const slot = new Map<Run, number>();
    const width = new Map<string, number>();
    const turning = new Map<string, Run[]>();
    for (const [key, group] of gaps) {
      const rows = stack(group.filter(run => {
        const [low, high] = span(run);
        return high - low > 1;
      }));
      turning.set(key, rows);
      // The two of a pair are one entry here, so that they take one lane.
      const unit = (run: Run): string =>
        (paired(run) ? [run.edge.from, run.edge.to].sort().join('\0') : '');
      const taken: Run[][] = [];
      const already = new Map<string, number>();
      // A line may not take a lane above one it has to stay below.
      const under = new Map<Run, number>();
      for (const run of rows) {
        const key2 = unit(run);
        const found = key2 === '' ? undefined : already.get(key2);
        if (found !== undefined) { taken[found]!.push(run); slot.set(run, found); continue; }
        const lowest = under.get(run) ?? 0;
        let at = taken.findIndex((used, i) => i >= lowest && used.every(one => shares(one, run)));
        if (at === -1) { at = Math.max(taken.length, lowest); while (taken.length <= at) taken.push([]); }
        taken[at]!.push(run);
        slot.set(run, at);
        if (key2 !== '') already.set(key2, at);
        for (const next of below.get(run) ?? []) {
          under.set(next, Math.max(under.get(next) ?? 0, at + 1));
        }
      }
      width.set(key, taken.length);
    }
    return { slot, width, turning };
  };

  // The lines on one side of one shape are spread along that side only where
  // they have to be. Lines that all turn in one lane leave by one stem and
  // fork, which is clear as it stands — and an end left on the middle of a
  // side is an end PowerPoint can glue a connector to, which an end moved
  // anywhere else is not. A drawing that was already clear is not rearranged
  // to make room for a problem it does not have.
  const crowded = new Set<string>();
  const first = sortOut();
  for (const [key, rows] of first.turning) {
    if ((first.width.get(key) ?? 0) < 2) continue;
    for (const run of rows) {
      crowded.add(sideKey(run, 'tail'));
      crowded.add(sideKey(run, 'head'));
    }
  }
  // A side where a line leaves along the flow and another arrives against it
  // is crowded however quiet its gap looks: the two meet at the middle of
  // that side, one going out and one coming in, and an arrowhead on each end
  // of one line is the hardest thing of all to read.
  for (const [key, list] of sides) {
    if (list.length > 1 && list.some(one => goesBack(one.run))) crowded.add(key);
  }

  for (const [key, list] of sides) {
    if (!crowded.has(key)) continue;
    const box = (one: { run: Run; end: 'tail' | 'head' }): Box =>
      (one.end === 'tail' ? one.run.from : one.run.to);
    const toward = (one: { run: Run; end: 'tail' | 'head' }): number =>
      (one.end === 'tail' ? one.run.at.head : one.run.at.tail);
    const other = (one: { run: Run; end: 'tail' | 'head' }): string =>
      (one.end === 'tail' ? one.run.edge.to : one.run.edge.from);

    // Every connection to the same shape shares one place on this side.
    // Two of them — `a --> b` written beside `b --> a` — are already drawn
    // side by side a label's width apart, and pulling them to opposite ends
    // of the shape would stop them reading as the pair they are.
    const slots = new Map<string, { run: Run; end: 'tail' | 'head' }[]>();
    for (const one of list) {
      const found = slots.get(other(one));
      if (found) found.push(one); else slots.set(other(one), [one]);
    }
    if (slots.size < 2) continue;

    const width = Math.min(...list.map(one => box(one).width));
    const room = Math.max(0, width * PORT_SPREAD) / 2;
    // In the order the other ends stand, so that lines fanning out of one
    // shape do not cross each other on the way.
    const sorted = [...slots.entries()].sort(([p, ps], [q, qs]) =>
      toward(ps[0]!) - toward(qs[0]!) || p.localeCompare(q));

    // A connection the layout had to run against the flow is drawn down the
    // channel beside the whole drawing, so it leaves and enters on that side
    // of the shape too — otherwise it crosses the shape's own outgoing line
    // on its way in. It is set against that edge rather than given a place in
    // the spread, so that the lines of the flow itself keep the room they had:
    // a shape with one line down and one coming back still sends its own line
    // straight out of the middle, where a connector in a deck can be glued to
    // it. A pair written both ways round is not one of these — it belongs
    // with the fan, not against the edge.
    const away = (slot: { run: Run; end: 'tail' | 'head' }[]): boolean => slot.every(one => goesBack(one.run));
    const aside2 = sorted.filter(([, group]) => away(group));
    const fan = sorted.filter(([, group]) => !away(group));

    // Which edge: away from where the rest of the side's lines come from. The
    // line set aside climbs straight out past them, and on their side it would
    // cut across every one of them on its way.
    const here = (one: { run: Run; end: 'tail' | 'head' }): number =>
      (one.end === 'tail' ? one.run.at.tail : one.run.at.head);
    const lean = fan.reduce((sum, [, group]) => sum + Math.sign(toward(group[0]!) - here(group[0]!)), 0);
    const edge = lean < 0 ? 1 : -1;
    aside2.forEach(([, group], i) => {
      const place = Math.round(edge * (room - i * LANE_CLEAR));
      for (const one of group) offsets.get(one.run)![one.end] = Math.max(-room, Math.min(room, place));
    });
    const kept = Math.max(0, room - aside2.length * LANE_CLEAR);
    fan.forEach(([, group], i) => {
      const place = fan.length === 1 ? 0 : ((i / (fan.length - 1)) * 2 - 1) * kept;
      for (const one of group) offsets.get(one.run)![one.end] = Math.round(place);
    });
  }

  // The lanes again, now that the ends have moved.
  const occupy = (run: Run, y: number): void => {
    (run.turn ? corridors.across : corridors.along).push(y);
  };
  const { slot, width: howMany, turning } = sortOut();
  for (const [key, group] of gaps) {
    const rows = turning.get(key) ?? [];
    if (rows.length === 0) continue;
    const count = howMany.get(key) ?? 1;
    if (count < 2) {
      for (const run of rows) {
        // A line whose gap a frame narrowed turns in what is left of it.
        if (run.moved) out.set(run.edge, { ...out.get(run.edge)!, lane: Math.round(run.middle + pairStep(run)) });
        occupy(run, run.middle + pairStep(run));
      }
      continue;
    }

    // How much room each lane needs: none for a single line, and the width of
    // the pair for a lane two of them share.
    const halves: number[] = Array.from({ length: count }, () => 0);
    for (const run of rows) {
      const at = slot.get(run)!;
      halves[at] = Math.max(halves[at]!, bandOf(run));
    }
    // Centred on the middle of the gap, so the lanes sit where the one line
    // used to, and kept clear of the rows on either side.
    const room = Math.max(0, Math.min(...rows.map(run => run.half - LANE_MARGIN)));
    const total = halves.reduce((sum, half) => sum + half * 2, 0) + LANE_GAP * (count - 1);
    const squeeze = total > room * 2 && total > 0 ? (room * 2) / total : 1;
    const centres: number[] = [];
    let at = -total / 2;
    for (const half of halves) {
      centres.push((at + half) * squeeze);
      at += half * 2 + LANE_GAP;
    }
    for (const run of rows) {
      const place = Math.round(run.middle + centres[slot.get(run)!]! + pairStep(run));
      out.set(run.edge, { ...out.get(run.edge)!, lane: place });
      occupy(run, place);
    }
  }

  // Spreading the lines along each side one shape at a time can still put two
  // of them in the same column: a shape directly above another gives both the
  // same room to spread into, so the line entering the lower one and the line
  // leaving the upper one can land on the same offset by coincidence. Two
  // lines running down one column read as one line however carefully their
  // ends were placed, so the later of the two is moved aside.
  for (let pass = 0; pass < 4; pass++) {
    const stubs = runs.flatMap(run => {
      const place = out.get(run.edge)!.lane ?? run.middle;
      const one = offsets.get(run)!;
      const at = (box: Box, end: 'tail' | 'head', x: number) => {
        const near = run.down === (end === 'tail') ? box.y + box.height : box.y;
        // Only as far as the gap beside the shape. Where a connection spans
        // several rows its turn is worked out half way along the whole of it,
        // which is nowhere near either end — and the line does not run down
        // that column at all, because a span like that detours. Measuring the
        // stub to there invents a line through the middle of the drawing and
        // shoves everything that meets it aside.
        const far = near + Math.sign(place - near || 1)
          * Math.min(Math.abs(place - near), RANK_GAP);
        return {
          run, end, x,
          low: Math.min(near, far), high: Math.max(near, far),
          side: `${end === 'tail' ? run.edge.from : run.edge.to}\0${run.down === (end === 'tail')}`,
        };
      };
      return [
        at(run.from, 'tail', run.at.tail + one.tail),
        at(run.to, 'head', run.at.head + one.head),
      ];
    });

    let moved = false;
    for (let i = 0; i < stubs.length; i++) {
      for (let j = i + 1; j < stubs.length; j++) {
        const p = stubs[i]!;
        const q = stubs[j]!;
        if (p.run.turn !== q.run.turn) continue;
        // Two lines leaving the same side of the same shape were spread on
        // purpose; they are as far apart as that side allows.
        if (p.side === q.side) continue;
        if (Math.abs(p.x - q.x) >= LANE_CLEAR) continue;
        if (Math.min(p.high, q.high) - Math.max(p.low, q.low) <= ALONGSIDE) continue;

        const box = q.end === 'tail' ? q.run.from : q.run.to;
        const room = Math.max(0, box.width / 2 - 6);
        const want = (p.x <= q.x ? 1 : -1) * LANE_CLEAR;
        const was = offsets.get(q.run)![q.end];
        const now = Math.max(-room, Math.min(room, was + want));
        if (now === was) continue;
        offsets.get(q.run)![q.end] = now;
        moved = true;
      }
    }
    if (!moved) break;
  }

  for (const run of runs) {
    const one = offsets.get(run)!;
    out.set(run.edge, { ...out.get(run.edge)!, tail: one.tail, head: one.head });
  }
  return { places: out, corridors };
}

/**
 * `y` moved off any height a line already turns at, by the smaller of the two
 * moves that clear it. A detour that turned where a placed line turns would
 * run along it, and two lines running along each other read as one.
 */
function clearOf(y: number, used: readonly number[], low: number, high: number): number {
  const blocked = (at: number): boolean => used.some(one => Math.abs(one - at) < LANE_GAP);
  if (!blocked(y)) return y;
  for (let step = 1; step <= used.length + 1; step++) {
    for (const way of [-1, 1]) {
      const at = y + way * step * LANE_GAP;
      // Outside the gap it is no longer a lane but a line through a row.
      if (at >= low && at <= high && !blocked(at)) return at;
    }
  }
  return y;
}

/** How much room a step over another line needs on either side of it. */
const HOP_ROOM = HOP_RADIUS + 3;

/**
 * Marks every place one connection crosses another, on the one of the two
 * that will step over it.
 *
 * Which one steps is not a choice made crossing by crossing: **the line
 * running across the flow steps over the line running along it**, always. The
 * drawing's spine is then never broken, and a reader who has learnt the rule
 * at one crossing can read every other crossing without looking twice. The
 * other way round — stepping whichever line was drawn second — would put the
 * breaks in different places on the same shape of drawing.
 *
 * Only square crossings are marked. A line drawn at an angle (a free drawing,
 * or two shapes with no gap to turn in) is not stepped over: the arc would sit
 * askew on it, and a crossing at an angle is not the one that confuses anyone.
 */
function stepOver(
  routes: readonly EdgeRoute[], boxes: ReadonlyMap<string, Box>, across: boolean,
): EdgeRoute[] {
  const flat = (a: Point, b: Point): boolean => Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 0.5;
  const upright = (a: Point, b: Point): boolean => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 0.5;
  // Across the flow is sideways in a drawing that runs down the page, and up
  // and down in one that runs across it.
  const crosses = (a: Point, b: Point): boolean => (across ? upright(a, b) : flat(a, b));
  const alongs = (a: Point, b: Point): boolean => (across ? flat(a, b) : upright(a, b));

  const shapes = [...boxes.values()];
  const hidden = (at: Point): boolean => shapes.some(box =>
    at.x > box.x - 1 && at.x < box.x + box.width + 1
    && at.y > box.y - 1 && at.y < box.y + box.height + 1);

  const found = routes.map(() => [] as Point[]);
  for (let i = 0; i < routes.length; i++) {
    const mine = routes[i]!.points;
    for (let j = 0; j < routes.length; j++) {
      if (i === j) continue;
      const theirs = routes[j]!.points;
      for (let p = 0; p + 1 < mine.length; p++) {
        if (!crosses(mine[p]!, mine[p + 1]!)) continue;
        for (let q = 0; q + 1 < theirs.length; q++) {
          if (!alongs(theirs[q]!, theirs[q + 1]!)) continue;
          const at = intersection(mine[p]!, mine[p + 1]!, theirs[q]!, theirs[q + 1]!);
          // A crossing at the very end of either run is two lines meeting,
          // not one passing the other; one inside a shape is not drawn at all.
          if (!at || hidden(at)) continue;
          if (near(at, mine[p]!) || near(at, mine[p + 1]!)) continue;
          if (near(at, theirs[q]!) || near(at, theirs[q + 1]!)) continue;
          found[i]!.push(at);
        }
      }
    }
  }

  return routes.map((route, i) => {
    const mine = found[i]!;
    if (mine.length === 0) return route;
    // In the order they are met along the line, and never so close together
    // that two arcs would run into each other.
    const sorted = [...mine].sort((a, b) => a.x - b.x || a.y - b.y);
    const kept: Point[] = [];
    for (const at of sorted) {
      if (kept.some(one => Math.abs(one.x - at.x) < HOP_ROOM * 2 && Math.abs(one.y - at.y) < HOP_ROOM * 2)) {
        continue;
      }
      kept.push(at);
    }
    return { ...route, hops: kept };
  });
}

/** Whether a crossing sits on top of one of the run's own ends. */
function near(at: Point, end: Point): boolean {
  return Math.abs(at.x - end.x) < HOP_ROOM && Math.abs(at.y - end.y) < HOP_ROOM;
}

/** What a corner adds to a way, in pixels of length: a straighter way reads easier. */
const BEND_COST = 24;
/** What crossing or running along a line already drawn adds to a way. */
const TANGLE_COST = 400;

function pathLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    total += Math.abs(points[i + 1]!.x - points[i]!.x) + Math.abs(points[i + 1]!.y - points[i]!.y);
  }
  return total;
}

/**
 * How many times a way crosses, or runs along, the lines drawn before it.
 * Inside the shapes at its two ends does not count: lines leaving the same
 * shape all start at its centre, and meeting there is not a tangle.
 */
function tangle(
  points: readonly Point[],
  drawn: readonly { readonly points: readonly Point[]; readonly merges: boolean }[],
  ends: readonly Box[],
): number {
  const within = (p: Point): boolean =>
    ends.some(box => p.x >= box.x - 1 && p.x <= box.x + box.width + 1 && p.y >= box.y - 1 && p.y <= box.y + box.height + 1);
  let count = 0;
  for (const { points: other, merges } of drawn) {
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      for (let j = 0; j + 1 < other.length; j++) {
        const c = other[j]!;
        const d = other[j + 1]!;
        const along = alongside(a, b, c, d);
        if (along) {
          if (!merges && !within(along)) count++;
          continue;
        }
        const at = intersection(a, b, c, d);
        // A line that joins one into the same shape meets it at a corner;
        // that is the two running together, not crossing.
        const corner = (p: Point): boolean => Math.abs(p.x - at!.x) < 0.5 && Math.abs(p.y - at!.y) < 0.5;
        if (at && !within(at) && !(merges && [a, b, c, d].some(corner))) count++;
      }
    }
  }
  return count;
}

/** Where two segments cross, if they do; parallel segments never cross. */
function intersection(a: Point, b: Point, c: Point, d: Point): Point | undefined {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) < 1e-9) return undefined;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denominator;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return undefined;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

/** How close two lines may run side by side before they read as one. */
const ALONGSIDE = 6;

/**
 * The middle of the stretch where two straight runs lie on top of each other
 * or nearly so, if they share more than a few pixels; otherwise nothing.
 */
function alongside(a: Point, b: Point, c: Point, d: Point): Point | undefined {
  const flat = (p: Point, q: Point): boolean => Math.abs(p.y - q.y) < 0.5;
  const upright = (p: Point, q: Point): boolean => Math.abs(p.x - q.x) < 0.5;
  const overlap = (p: number, q: number, r: number, s: number): [number, number] | undefined => {
    const low = Math.max(Math.min(p, q), Math.min(r, s));
    const high = Math.min(Math.max(p, q), Math.max(r, s));
    return high - low > ALONGSIDE ? [low, high] : undefined;
  };
  if (flat(a, b) && flat(c, d) && Math.abs(a.y - c.y) < ALONGSIDE) {
    const span = overlap(a.x, b.x, c.x, d.x);
    return span && { x: (span[0] + span[1]) / 2, y: a.y };
  }
  if (upright(a, b) && upright(c, d) && Math.abs(a.x - c.x) < ALONGSIDE) {
    const span = overlap(a.y, b.y, c.y, d.y);
    return span && { x: a.x, y: (span[0] + span[1]) / 2 };
  }
  return undefined;
}

/** How many places between the shapes a line is tried through before going outside. */
const GAP_TRIES = 16;

/**
 * Where a line in a flow turns when it cannot go straight: in the gap after
 * the row it leaves and the gap before the row it enters. Worked out on a flow
 * running down the page, as the routing is.
 */
function gapsOf(
  tail: Point, head: Point, from: Box, to: Box,
  clear: (y: number, low: number, high: number) => number = y => y,
): { leave: number; enter: number } {
  const half = RANK_GAP / 2;
  // A turn moved out of a lane still has to stay in the gap it turns in:
  // beyond that it is inside the next row, which is worse than any overlap.
  const after = (edge: number): [number, number] => [edge + LANE_MARGIN, edge + RANK_GAP - LANE_MARGIN];
  const before = (edge: number): [number, number] => [edge - RANK_GAP + LANE_MARGIN, edge - LANE_MARGIN];
  if (head.y > tail.y + 1) {
    return {
      leave: clear(from.y + from.height + half, ...after(from.y + from.height)),
      enter: clear(to.y - half, ...before(to.y)),
    };
  }
  if (head.y < tail.y - 1) {
    return {
      leave: clear(from.y - half, ...before(from.y)),
      enter: clear(to.y + to.height + half, ...after(to.y + to.height)),
    };
  }
  // Side by side in one row: under both of them.
  const under = Math.max(from.y + from.height, to.y + to.height);
  const at = clear(under + half, ...after(under));
  return { leave: at, enter: at };
}

/**
 * The ways between the shapes for a line that cannot go straight: turning in
 * the gap before the row it enters, or after the row it leaves; and failing
 * those, down a gap between two columns, nearest the middle first.
 */
function gapRoutes(
  tail: Point, head: Point, from: Box, to: Box, boxes: readonly Box[],
  clear: (y: number, low: number, high: number) => number = y => y,
): Point[][] {
  const { leave, enter } = gapsOf(tail, head, from, to, clear);
  const out: Point[][] = [
    tidy([tail, { x: tail.x, y: enter }, { x: head.x, y: enter }, head]),
    tidy([tail, { x: tail.x, y: leave }, { x: head.x, y: leave }, head]),
  ];
  const middle = (tail.x + head.x) / 2;
  const low = Math.min(leave, enter);
  const high = Math.max(leave, enter);
  // The gaps beside the shapes the line has to pass, in the rows between.
  const columns = new Set<number>();
  for (const box of boxes) {
    if (box.y + box.height < low || box.y > high) continue;
    columns.add(Math.round(box.x - NODE_GAP / 2));
    columns.add(Math.round(box.x + box.width + NODE_GAP / 2));
  }
  const xs = [...columns].sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle) || a - b);
  for (const x of xs.slice(0, GAP_TRIES)) {
    out.push(tidy([tail, { x: tail.x, y: leave }, { x, y: leave }, { x, y: enter }, { x: head.x, y: enter }, head]));
  }
  return out;
}

/** Drops corners that turn nowhere: repeated points, and points on a straight run. */
function tidy(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    const before = out[out.length - 2];
    if (before && last && ((Math.abs(before.x - last.x) < 0.5 && Math.abs(last.x - p.x) < 0.5)
      || (Math.abs(before.y - last.y) < 0.5 && Math.abs(last.y - p.y) < 0.5))) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
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
    if (ends.has(node.id)) continue;
    // A group is in the way of a line that has nothing to do with it: one
    // passing through its frame reads as a line of the group's. A line to or
    // from something inside it goes in and out, as it has to.
    if (node.shape === 'group') {
      const held = inside(diagram, node.id);
      if (held.has(edge.from) || held.has(edge.to)) continue;
    }
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
): { width: number; height: number; lines: readonly TextLine[]; natural?: number } {
  // A line has no inside, so nothing about it is measured from its words: it is
  // as long as the default width and flat, until a pin says otherwise.
  if (node.shape === 'line') return { width: DEFAULT_SIZE.width, height: 0, lines: [] };
  const pin = diagram.layout.get(node.id);
  // The size a part gives, for a shape with no pin to carry one — a shape in a
  // container is placed without a pin, and a text box is 34 tall because the
  // library says so.
  // A size written with no place is the author's, over the library's.
  const given = diagram.sizes?.get(node.id) ?? diagram.partSizes.get(node.id);
  const runs = parseLabel(node.text);
  const shown = lineText(runs);
  // Words in a size of their own (`font-size: 18`) are measured at that size,
  // and their lines are as far apart as that size needs.
  const font = fontOf(diagram.style.get(node.id)).size ?? FONT;
  const pitch = lineHeightFor(font);
  // A label broken by hand is as wide as its widest line, not as all of it.
  const natural = shown.includes('\n')
    ? Math.max(...shown.split('\n').map(line => textWidth(line, font)))
    : textWidth(node.text, font);
  // A diamond holds its words in the middle, where it is widest, so it wraps
  // them narrower than a box would and then grows round them.
  if (node.shape === 'diamond' && !given) return diamond(runs, natural, pin?.width, font);
  const inner = (pin?.width ?? given?.width) !== undefined
    ? (pin?.width ?? given!.width) - TEXT_PAD
    : Math.min(MAX_NODE_WIDTH, Math.max(DEFAULT_SIZE.width, natural + TEXT_PAD)) - TEXT_PAD;
  const lines = wrapRuns(runs, inner, font);
  const widest = lines.reduce((w, line) => Math.max(w, textWidth(lineText(line), font)), 0);
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
      height: lines.length > 1 || pitch > LINE_HEIGHT ? Math.max(given.height, lines.length * pitch) : given.height,
      lines,
      // A caption is as wide as the library says, but a column of captions
      // sized `auto` is as wide as the longest of their words.
      ...(node.shape === 'text' ? { natural: Math.ceil(natural) + TEXT_PAD } : {}),
    };
  }
  return {
    width: Math.max(DEFAULT_SIZE.width, Math.ceil(widest) + TEXT_PAD),
    height: Math.max(DEFAULT_SIZE.height, lines.length * pitch + TEXT_PAD + lid + art),
    lines,
  };
}

/** The widest a diamond's words run before they wrap. */
const DIAMOND_TEXT = 140;
/** Room kept between a diamond's words and its slanted sides. */
const DIAMOND_INSET = 4;
/**
 * How much of a diamond's width its words may take before it grows wider
 * rather than only taller. Past this, the height the words need climbs
 * steeply, and the diamond turns into a needle.
 */
const DIAMOND_SHARE = 0.65;

/**
 * The size of a diamond round its words.
 *
 * A diamond is a box with its corners cut off, so words sized for the box run
 * out through the slanted sides — a broken line most of all, since each line
 * adds height where the diamond has the least width. A block of text `tw`
 * wide and `th` tall fits when `tw / w + th / h <= 1`: the block's corner
 * then sits on the outline. The default width is kept while the words take
 * no more than `DIAMOND_SHARE` of it; past that the diamond is made twice as
 * wide as the words, the smallest that holds them. The height follows.
 *
 * The block is measured by the glyphs, not the line pitch: the room above the
 * first line and below the last is part of the pitch, not of the words.
 */
function diamond(
  runs: ReturnType<typeof parseLabel>, natural: number, pinned: number | undefined, font = FONT,
): { width: number; height: number; lines: readonly TextLine[] } {
  const pitch = lineHeightFor(font);
  const wrap = pinned !== undefined
    ? Math.max(1, pinned / 2 - DIAMOND_INSET * 2)
    : Math.min(DIAMOND_TEXT * font / FONT, Math.max(1, natural));
  const lines = wrapRuns(runs, wrap, font, true);
  const widest = lines.reduce((w, line) => Math.max(w, textWidth(lineText(line), font)), 0);
  const tw = Math.ceil(widest) + DIAMOND_INSET * 2;
  // Less room above and below than at the sides: a glyph's box already has
  // some room inside it there.
  const th = lines.length * pitch - (pitch - font) + DIAMOND_INSET;
  const width = pinned
    ?? (tw / DEFAULT_SIZE.width <= DIAMOND_SHARE ? DEFAULT_SIZE.width : Math.max(DEFAULT_SIZE.width, tw * 2));
  // A pinned width narrower than the words leaves no room to grow into; it is
  // the author's width, so the diamond grows tall instead, as far as reason.
  const share = Math.min(0.8, tw / width);
  const height = Math.max(DEFAULT_SIZE.height, Math.ceil(th / (1 - share)));
  return { width, height, lines };
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
  // Every group is laid out as one: a frame drawn afterwards round shapes
  // placed with no idea they belong together catches whatever the engine
  // happened to put between them, and a shape outside the group then reads
  // as one of its members. A group without a direction takes the direction
  // of whatever it sits in.
  const grouped = diagram.nodes.filter(n => n.shape === 'group' && !diagram.containers.has(n.id));
  const clusters = new Set(grouped.map(n => n.id));

  // Which directed group lays out each shape, and each directed group that
  // sits inside another. First come, first served: a shape is laid out once.
  const owner = new Map<string, string>();
  const holds = (outer: string, inner: string): boolean => {
    for (let at: string | undefined = outer, depth = 0; at !== undefined && depth < 64; at = owner.get(at), depth++) {
      if (at === inner) return true;
    }
    return false;
  };
  for (const group of grouped) {
    const seen = new Set<string>();
    const take = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      const node = byId.get(id);
      if (!present.has(id) && !clusters.has(id)) return;
      // A group named inside one it already holds would hold itself.
      if (holds(group.id, id)) return;
      const other = owner.get(id);
      if (other !== undefined) {
        // Two groups may share a shape; it is laid out in the first, and the
        // second's frame is drawn round it where it lands. Only two
        // directions pulling at one shape is worth saying.
        if (other !== group.id && group.direction !== undefined && byId.get(other)?.direction !== undefined) {
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
  // `edge` is the connection as the file wrote it, which the caller needs to
  // record the course on; `together` is the same object under the name the
  // engine knows it by, which is how the several edges of one connection to a
  // group are kept from being split between going forward and going back.
  interface Joined extends GraphEdge { readonly edge: Edge; readonly together: Edge }
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
        const one: Joined = {
          from: a[a.indexOf(level) - 1]!, to: b[b.indexOf(level) - 1]!, edge, together: edge,
        };
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

  /** The direction a layout runs in: its own, else the one it sits in. */
  function directionAt(level: string | undefined): FlowDirection | undefined {
    for (let at = level, depth = 0; at !== undefined && depth < 64; at = owner.get(at), depth++) {
      const direction = byId.get(at)?.direction;
      if (direction !== undefined) return direction;
    }
    return diagram.direction;
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
  const placed = new Map<string | undefined, ReadonlyMap<string, Point>>();

  // Inner groups first: a group is as big as its own drawing, and the layout
  // around it needs that size. A group with nothing to lay out takes no room.
  const lay = (level: string | undefined): boolean => {
    const done = placed.get(level);
    if (done) return done.size > 0 || level === undefined;
    placed.set(level, new Map());
    const members = (units.get(level) ?? []).filter(id => !clusters.has(id) || lay(id));
    if (level !== undefined && members.length === 0) return false;

    const axis = axisOf(directionAt(level));
    const inside = new Set(members);
    const joined = (joins.get(level) ?? []).filter(one => inside.has(one.from) && inside.has(one.to));
    const laid = layoutEngine().arrange({
      ids: members,
      edges: joined,
      size: id => unitSizes.get(id)!,
      axis,
      gap: { node: NODE_GAP, rank: RANK_GAP },
    });
    for (const one of joined) courses.set(one.edge, { across: axis.across, back: laid.back.has(one) });
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
  // A row of the item table that names no shape is written in the table; on
  // the screen, the line that names the table is the one to mark.
  if (phrase.id.startsWith('diagram.items.') && nodeAt(id) === undefined) return diagram.itemTable?.span;
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
  marks: readonly ItemMark[] = [], tables: readonly TableRules[] = [],
): LaidOutDiagram {
  // Detouring connections and their labels run outside the shapes, so they
  // move the origin and stretch the canvas too.
  const labels = routes.map(edgeLabelBox).filter((b): b is Box => b !== undefined);
  const all = [...boxes.values(), ...labels, ...marks];
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
    hops: r.hops.map(move),
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
    marks: marks.map(mark => ({ ...mark, ...move(mark) })),
    tables: tables.map(table => ({
      ...table,
      columns: table.columns.map(x => x - minX + PAD),
      rows: table.rows.map(y => y - minY + PAD),
    })),
  };
}
