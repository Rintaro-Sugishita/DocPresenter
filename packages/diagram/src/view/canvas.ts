// Direct manipulation of a diagram. The drawing on screen is the drawing the
// renderer produces — the editor adds an outline, a handle and the guides, and
// nothing else — so what is dragged is what a reader will see.
//
// A drag is not a new kind of state: it ends as one pin, which is one line of
// the layout section. Automatic layout keeps the rest, which is the whole point
// of the three-layer model: the mouse is for the exceptions.

import { layOutDiagram, type Box } from '../layout.js';
import { containerOf, dropInto } from '../arrange.js';
import type { DiagramFile, Item, ShapeKind } from '../model.js';
import { renderDiagram } from '../draw/render.js';
import { stencilParts } from '../draw/stencil.js';
import type { Edit } from '@docpresenter/base';
import {
  addNode, bendEdge, canUnpin, connectNodes, disconnectNodes, groupMembers, groupNodes,
  nextShapeId, pinNode, pinNodes, reconnect, removeNodes, setContainerCells, setItems,
  setNodeShape, setNodeStyle, setNodeText, unpinNode,
} from '../edits.js';
import { toggleInline, type InlineMark } from '@docpresenter/base';
import { createMenu, createToolbar, type MenuItem } from '@docpresenter/base';
import { alignIcon, lineIcon, partIcon, rowIcon, shapeIcon } from './shape-icon.js';
import { isListing, rowBoxes, rowTextAt, type Listing } from '../draw/listing.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/**
 * The row of a listing that was picked, kept per document.
 *
 * Every edit builds the canvas again, and the selection the host remembers is
 * a list of shapes — it has no room for "the third row of the tree". Keeping it
 * here means pressing "add a row" twice adds two rows, which is what anybody
 * pressing it twice meant.
 */
const rowPicks = new WeakMap<Document, { id: string; index: number }>();
/** How far a shape's edge may be from another's to be pulled into line. */
const SNAP = 5;
/** What a free coordinate is rounded to, so a diff shows round numbers. */
const GRID = 4;
/** A press this short of a move is a selection, not a drag. */
const THRESHOLD = 3;
const MIN_SIZE = 16;

/** What the bar says when nothing in particular is picked. */
const HINT = 'ドラッグで移動 / 右下で大きさ / ダブルクリックで文字 / 右クリックで操作';

/**
 * The shapes on offer. Fewer than the notation has: a palette is a set of
 * choices someone has to make every time, and the ones left out (`group`, and
 * the stadium's near-twin) are either not a shape you draw or are one keystroke
 * away in the source.
 */
const PALETTE: readonly (readonly [ShapeKind, string])[] = [
  ['rect', '四角'],
  ['round-rect', '角丸'],
  ['stadium', '端丸'],
  ['ellipse', '楕円'],
  ['diamond', 'ひし形'],
  ['cylinder', '円柱'],
  ['note', '付箋'],
  ['text', '文字だけ'],
  // A line on its own. Not a connection: it divides a screen or points at a
  // part of it, and neither of those joins two shapes together.
  ['line', '線'],
  // The flowchart set. Kept together at the end, after the shapes that get
  // used in any kind of drawing.
  ['parallelogram', '入出力'],
  ['hexagon', '六角形'],
  ['loop-start', 'ループ開始'],
  ['loop-end', 'ループ終了'],
];

export interface CanvasOptions {
  readonly owner: Document;
  readonly file: DiagramFile;
  /** The `.dgm` text. Edits are byte ranges in it. */
  readonly source: string;
  /** The shapes picked, in the order they were picked. */
  readonly selected: readonly string[];
  /** The connection picked, as `from->to`. A line or shapes, never both. */
  readonly selectedEdge: string | undefined;
  /** Runs one edit; the caller re-renders and mounts the canvas again. */
  readonly apply: (
    make: () => Edit, selected: readonly string[], edge?: string | undefined,
  ) => void;
  /** Remembers the selection without writing anything. */
  readonly select: (ids: readonly string[], edge?: string | undefined) => void;
  readonly showSource: () => void;
  readonly close: () => void;
  readonly onError?: (message: string) => void;
}

export interface Canvas {
  readonly element: HTMLElement;
  /**
   * Takes the keyboard. The caller calls this after putting the element on the
   * page: focusing a node that is not in the document yet does nothing, and a
   * redraw that lost the focus would swallow the next arrow key.
   */
  focus(): void;
}

export function createCanvas(options: CanvasOptions): Canvas {
  const { owner, file, source } = options;
  const laid = layOutDiagram(file);
  // The selection is a list rather than one id: grouping and moving several
  // shapes at once both need to know what was picked, in what order.
  let picked = options.selected.filter(id => laid.boxes.has(id));
  const primary = (): string | undefined => picked[picked.length - 1];
  const nameOf = (edge: { from: string; to: string }): string => `${edge.from}->${edge.to}`;
  /** The connection picked, if it is a connection that is picked. */
  let line = laid.routes.some(r => nameOf(r.edge) === options.selectedEdge)
    ? options.selectedEdge : undefined;
  const lineOf = (name: string | undefined) =>
    laid.routes.find(r => nameOf(r.edge) === name);

  /** Which rows a shape holds, if it is a tree, a list or a menu. */
  const listingOf = (
    id: string | undefined,
  ): { icon: Listing; items: readonly Item[] } | undefined => {
    if (id === undefined) return undefined;
    const node = file.nodes.find(one => one.id === id);
    const icon = file.style.get(id)?.get('icon');
    return node && isListing(icon) && node.items.length > 0 ? { icon, items: node.items } : undefined;
  };
  /**
   * The row picked before the last edit, if that row is still there. A row
   * that is no longer drawn — the list was shortened, or a branch above it was
   * closed — is not picked either: the buttons would be acting on something
   * nobody can see.
   */
  let row = ((): { id: string; index: number } | undefined => {
    const kept = rowPicks.get(owner);
    const held = listingOf(kept?.id);
    const box = kept && laid.boxes.get(kept.id);
    if (!kept || !held || !box || !picked.includes(kept.id)) return undefined;
    return rowBoxes(held.icon, box, held.items)[kept.index] ? kept : undefined;
  })();
  const pickRow = (next: { id: string; index: number } | undefined): void => {
    row = next;
    if (next) rowPicks.set(owner, next); else rowPicks.delete(owner);
  };

  // Declared up here because the bar is built before the code below runs, and
  // a `let` reached early is an error rather than an empty box.
  let where: HTMLElement | undefined;
  let release: HTMLButtonElement | undefined;
  let aligners: HTMLElement | undefined;
  let liners: HTMLElement | undefined;
  let hint: HTMLElement | undefined;
  let spreaders: readonly HTMLButtonElement[] = [];
  let lookButtons: readonly HTMLButtonElement[] = [];
  let rowButtons: readonly HTMLButtonElement[] = [];
  let rows: HTMLElement | undefined;

  const root = element('div', 'dp-canvas');
  const stage = element('div', 'dp-canvas-stage');
  stage.tabIndex = 0;
  stage.innerHTML = renderDiagram(file);
  const svg = stage.querySelector('svg');
  const bar = createBar();
  root.append(bar, stage);

  function element(tag: string, className: string): HTMLElement {
    const node = owner.createElement(tag);
    node.className = className;
    return node;
  }

  function shape(tag: string, className: string): SVGElement {
    const node = owner.createElementNS(SVG_NS, tag) as SVGElement;
    node.setAttribute('class', className);
    return node;
  }

  if (!svg) return { element: root, focus: () => stage.focus({ preventScroll: true }) };
  // A local the narrowing survives into: the handlers below are declarations,
  // and a declaration's body does not inherit the check above.
  const drawing = svg;

  // The handles live inside the SVG, so they are in the drawing's own
  // coordinates and scale with it. Nothing here is ever written to a file.
  const overlay = shape('g', 'dp-canvas-overlay');
  drawing.append(overlay);

  /** Screen pixels per drawing unit: the SVG may be shown smaller than it is. */
  function scale(): number {
    const width = drawing.getBoundingClientRect().width;
    return width > 0 && laid.width > 0 ? width / laid.width : 1;
  }

  const boxOf = (id: string | undefined): Box | undefined =>
    id === undefined ? undefined : laid.boxes.get(id);

  // --- 選択と目印 --------------------------------------------------------

  interface Preview {
    readonly box: Box;
    readonly guides: readonly { readonly axis: 'x' | 'y'; readonly at: number }[];
  }
  let preview: Preview | undefined;

  function paint(): void {
    overlay.replaceChildren();

    if (band) {
      const rect = shape('rect', 'dp-canvas-band');
      place(rect, bandBox());
      overlay.append(rect);
    }

    const chosen = lineOf(line);
    if (chosen) {
      const path = livePath(chosen.points);
      const mark = shape('polyline', 'dp-canvas-edge-picked');
      mark.setAttribute('points', points(path));
      overlay.append(mark);

      // A hollow circle in the middle of every segment. Dragging the line
      // anywhere bends it, but nothing on screen said so; a handle does.
      for (let i = 0; i + 1 < path.length; i++) {
        const a = path[i]!;
        const b = path[i + 1]!;
        if (Math.hypot(b.x - a.x, b.y - a.y) < 40 / scale()) continue;
        const spot = shape('circle', 'dp-canvas-bend-new');
        spot.setAttribute('cx', String((a.x + b.x) / 2));
        spot.setAttribute('cy', String((a.y + b.y) / 2));
        spot.setAttribute('r', String(4.5 / scale()));
        spot.setAttribute('data-segment', String(i));
        overlay.append(spot);
      }

      // A square for every corner the line turns through: drag one to move it,
      // drop it back on the straight line to take it out.
      for (let i = 1; i + 1 < path.length; i++) {
        const corner = path[i]!;
        const size = 7 / scale();
        const handle = shape('rect', 'dp-canvas-bend');
        handle.setAttribute('x', String(corner.x - size / 2));
        handle.setAttribute('y', String(corner.y - size / 2));
        handle.setAttribute('width', String(size));
        handle.setAttribute('height', String(size));
        handle.setAttribute('data-bend', String(i - 1));
        overlay.append(handle);
      }
      // The two ends are draggable: that is how a line is re-attached.
      const ends = [path[0], path[path.length - 1]];
      ends.forEach((at, index) => {
        if (!at) return;
        const end = shape('circle', 'dp-canvas-end');
        end.setAttribute('cx', String(reaching && index === (reaching.end === 'from' ? 0 : 1)
          ? reaching.at.x : at.x));
        end.setAttribute('cy', String(reaching && index === (reaching.end === 'from' ? 0 : 1)
          ? reaching.at.y : at.y));
        end.setAttribute('r', String(5 / scale()));
        end.setAttribute('data-end', index === 0 ? 'from' : 'to');
        overlay.append(end);
      });
      if (reaching) {
        const rubber = shape('line', 'dp-canvas-rubber');
        const fixed = reaching.end === 'from' ? path[path.length - 1]! : path[0]!;
        rubber.setAttribute('x1', String(fixed.x));
        rubber.setAttribute('y1', String(fixed.y));
        rubber.setAttribute('x2', String(reaching.at.x));
        rubber.setAttribute('y2', String(reaching.at.y));
        overlay.append(rubber);
      }
    }

    for (const id of picked) {
      const box = id === primary() ? preview?.box ?? boxOf(id) : shifted(id);
      if (!box) continue;
      // Every picked shape is washed over, not merely outlined: with several
      // picked, an outline alone is a thin line among many other thin lines.
      const outline = shape('rect', 'dp-canvas-outline');
      place(outline, thick(box));
      overlay.append(outline);
    }

    const box = preview?.box ?? boxOf(primary());
    // Resizing is one shape's business: a handle on a selection of several
    // would have to mean something, and nothing it could mean is obvious.
    if (box && picked.length === 1) {
      // The handle is drawn at a fixed size on screen, so it stays grabbable on
      // a drawing the pane had to shrink.
      const size = 9 / scale();
      const handle = shape('rect', 'dp-canvas-handle');
      handle.setAttribute('x', String(box.x + box.width - size / 2));
      handle.setAttribute('y', String(box.y + box.height - size / 2));
      handle.setAttribute('width', String(size));
      handle.setAttribute('height', String(size));
      overlay.append(handle);
    }

    const held = listingOf(row?.id);
    const listBox = boxOf(row?.id);
    if (row && held && listBox) {
      const one = rowBoxes(held.icon, listBox, held.items)[row.index];
      if (one) {
        const mark = shape('rect', 'dp-canvas-row');
        place(mark, one);
        overlay.append(mark);
      }
    }

    if (dropping) {
      const mark = shape('rect', 'dp-canvas-drop');
      place(mark, dropping.mark);
      overlay.append(mark);
    }

    for (const guide of preview?.guides ?? []) {
      const line = shape('line', 'dp-canvas-guide');
      line.setAttribute('x1', String(guide.axis === 'x' ? guide.at : 0));
      line.setAttribute('x2', String(guide.axis === 'x' ? guide.at : laid.width));
      line.setAttribute('y1', String(guide.axis === 'y' ? guide.at : 0));
      line.setAttribute('y2', String(guide.axis === 'y' ? guide.at : laid.height));
      overlay.append(line);
    }
  }

  /**
   * The picked line as it is right now: the route it was laid out on, with the
   * corner being dragged moved to where the pointer is, or a new corner put in
   * where the line was grabbed.
   */
  function livePath(
    laidPoints: readonly { x: number; y: number }[],
  ): { x: number; y: number }[] {
    const path = laidPoints.map(p => ({ x: p.x, y: p.y }));
    if (!bending) return path;
    const at = { x: bending.at.x, y: bending.at.y };
    if (bending.fresh) path.splice(bending.index + 1, 0, at);
    else path[bending.index + 1] = at;
    return path;
  }

  function points(list: readonly { x: number; y: number }[]): string {
    return list.map(p => `${p.x},${p.y}`).join(' ');
  }

  /**
   * A line of the drawing itself — one that joins nothing — nearest the
   * pointer, if one is near enough. Found by distance for the same reason a
   * connection is, below.
   */
  function ruleAt(at: { x: number; y: number }): { id: string; distance: number } | undefined {
    const near = 6 / scale();
    let best: { id: string; distance: number } | undefined;
    for (const node of file.nodes) {
      if (node.shape !== 'line') continue;
      const box = laid.boxes.get(node.id);
      if (!box) continue;
      const up = file.style.get(node.id)?.get('slope') === 'up';
      const from = { x: box.x, y: up ? box.y + box.height : box.y };
      const to = { x: box.x + box.width, y: up ? box.y : box.y + box.height };
      const distance = toSegment(at, from, to);
      if (distance <= near && (!best || distance < best.distance)) {
        best = { id: node.id, distance };
      }
    }
    return best;
  }

  /**
   * The connection under a point, if one is near enough. Lines are found by
   * distance rather than by a wide invisible shape over them: an invisible
   * shape would have to sit above the drawing, and would then take the presses
   * meant for whatever it crosses.
   */
  function edgeAt(at: { x: number; y: number }): { name: string; distance: number } | undefined {
    const near = 6 / scale();
    let best: { name: string; distance: number } | undefined;
    for (const route of laid.routes) {
      for (let i = 0; i + 1 < route.points.length; i++) {
        const distance = toSegment(at, route.points[i]!, route.points[i + 1]!);
        if (distance <= near && (!best || distance < best.distance)) {
          best = { name: nameOf(route.edge), distance };
        }
      }
    }
    return best;
  }

  /**
   * What the pointer means where it is not on a shape: the nearer of the
   * drawing's own lines and the connections. They cross — a line marking a
   * boundary is drawn across the connections that pass through it — so at the
   * crossing the one being pointed at is the one nearer the pointer.
   */
  function nearest(at: { x: number; y: number }): { rule?: string; line?: string } {
    const rule = ruleAt(at);
    const edge = edgeAt(at);
    if (rule && (!edge || rule.distance <= edge.distance)) return { rule: rule.id };
    return edge ? { line: edge.name } : {};
  }

  /** Which segment of a path a point is nearest to, counted from zero. */
  function segmentAt(path: readonly { x: number; y: number }[], at: { x: number; y: number }): number {
    let best = 0;
    let distance = Infinity;
    for (let i = 0; i + 1 < path.length; i++) {
      const found = toSegment(at, path[i]!, path[i + 1]!);
      if (found < distance) { distance = found; best = i; }
    }
    return best;
  }

  /**
   * Pulls a corner into line with the points on either side of it. A drawing of
   * a system is drawn with right angles; the alternative is a line that misses
   * being square by two pixels, which is worse than no corner at all.
   */
  function square(
    at: { x: number; y: number },
    before: { x: number; y: number }, after: { x: number; y: number },
  ): { x: number; y: number } {
    const near = SNAP;
    const x = Math.abs(at.x - before.x) <= near ? before.x
      : Math.abs(at.x - after.x) <= near ? after.x : round(at.x);
    const y = Math.abs(at.y - before.y) <= near ? before.y
      : Math.abs(at.y - after.y) <= near ? after.y : round(at.y);
    return { x, y };
  }

  /** Distance from a point to a segment. */
  function toSegment(
    p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number },
  ): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }

  /** Where a press landed, in the coordinates the laid-out boxes use. */
  function pointOn(event: MouseEvent): { x: number; y: number } {
    const rect = drawing.getBoundingClientRect();
    const factor = scale();
    return { x: (event.clientX - rect.left) / factor, y: (event.clientY - rect.top) / factor };
  }

  /**
   * A box with enough of it to see. A line's box is flat, and a wash over
   * nothing is a wash nobody sees — so the mark, not the line, is given room.
   */
  function thick(box: Box): Box {
    const least = 5 / scale();
    const grow = (size: number): number => Math.max(size, least);
    return {
      ...box,
      x: box.x - (grow(box.width) - box.width) / 2,
      y: box.y - (grow(box.height) - box.height) / 2,
      width: grow(box.width), height: grow(box.height),
    };
  }

  function place(node: SVGElement, box: Box): void {
    node.setAttribute('x', String(box.x));
    node.setAttribute('y', String(box.y));
    node.setAttribute('width', String(box.width));
    node.setAttribute('height', String(box.height));
  }

  /** Where a shape is being shown while the selection is dragged. */
  function shifted(id: string): Box | undefined {
    const box = boxOf(id);
    if (!box || !drag?.moved || !moving.has(id)) return box;
    return { ...box, x: box.x + drag.by.x, y: box.y + drag.by.y };
  }

  function bandBox(): Box {
    const from = band?.from ?? { x: 0, y: 0 };
    const to = band?.to ?? from;
    return {
      x: Math.min(from.x, to.x), y: Math.min(from.y, to.y),
      width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y),
      z: 0, lines: [],
    };
  }

  function pick(ids: readonly string[]): void {
    if (line === undefined && ids.length === picked.length
      && ids.every((id, i) => picked[i] === id)) return;
    if (row && !ids.includes(row.id)) pickRow(undefined);
    picked = [...ids];
    line = undefined;
    options.select(picked, undefined);
    describe();
    paint();
  }

  /** Picking a line unpicks the shapes: an operation acts on one or the other. */
  function pickLine(name: string | undefined): void {
    line = name;
    picked = [];
    options.select([], name);
    describe();
    paint();
  }

  /** Shift adds to the selection and takes away again, as a list does. */
  function toggle(id: string): void {
    pick(picked.includes(id) ? picked.filter(other => other !== id) : [...picked, id]);
  }

  // --- ドラッグ ----------------------------------------------------------

  interface Drag {
    readonly kind: 'move' | 'resize';
    readonly from: { x: number; y: number };
    readonly pointerId: number;
    /** The shape under the pointer: the one that snaps and resizes. */
    readonly id: string;
    readonly box: Box;
    moved: boolean;
    /** How far everything being dragged has moved, in the drawing's units. */
    by: { x: number; y: number };
    size: { width: number; height: number } | undefined;
  }
  let drag: Drag | undefined;
  /** What moves with the pointer: the picked shapes and what they contain. */
  let moving = new Set<string>();
  /** The rubber band, in the drawing's coordinates. */
  let band: { from: { x: number; y: number }; to: { x: number; y: number } } | undefined;
  /**
   * Where the shape being dragged would land inside its own container. Set
   * while the pointer is still inside it; letting go anywhere else means the
   * shape is leaving the arrangement, which is a pin.
   */
  let dropping: { container: string; cells: string[][]; mark: Box } | undefined;
  /** An end of the picked line being dragged onto another shape. */
  let reaching: { end: 'from' | 'to'; at: { x: number; y: number } } | undefined;
  /**
   * A corner of the picked line being dragged. `index` counts the corners the
   * file holds, so 0 is the first one after the shape the line leaves.
   */
  let bending: { index: number; at: { x: number; y: number }; fresh: boolean } | undefined;

  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    // The text box and its bar sit over the drawing but are not part of it.
    if (target?.closest('.dp-canvas-text, .dp-format-bar')) return;
    const onHandle = target?.closest('.dp-canvas-handle') != null && picked.length === 1;
    const onEnd = target?.closest('.dp-canvas-end')?.getAttribute('data-end');
    // A shape under the pointer wins; only then is a line looked for.
    const onShape = onHandle ? primary() : target?.closest('[data-node]')?.getAttribute('data-node');
    const near = onShape === undefined || onShape === null ? nearest(pointOn(event)) : {};
    const id = onShape ?? near.rule;
    const onLine = near.line;

    if (onEnd === 'from' || onEnd === 'to') {
      event.stopPropagation();
      stage.focus({ preventScroll: true });
      reaching = { end: onEnd, at: pointOn(event) };
      drag = {
        kind: 'move', from: { x: event.clientX, y: event.clientY },
        pointerId: event.pointerId, id: '', box: bandBox(), moved: false,
        by: { x: 0, y: 0 }, size: undefined,
      };
      return;
    }
    const onSegment = target?.closest('.dp-canvas-bend-new')?.getAttribute('data-segment');
    if (onSegment !== undefined && onSegment !== null) {
      event.stopPropagation();
      stage.focus({ preventScroll: true });
      bending = { index: Number(onSegment), at: pointOn(event), fresh: true };
      drag = {
        kind: 'move', from: { x: event.clientX, y: event.clientY },
        pointerId: event.pointerId, id: '', box: bandBox(), moved: false,
        by: { x: 0, y: 0 }, size: undefined,
      };
      return;
    }
    const onBend = target?.closest('.dp-canvas-bend')?.getAttribute('data-bend');
    if (onBend !== undefined && onBend !== null) {
      event.stopPropagation();
      stage.focus({ preventScroll: true });
      bending = { index: Number(onBend), at: pointOn(event), fresh: false };
      drag = {
        kind: 'move', from: { x: event.clientX, y: event.clientY },
        pointerId: event.pointerId, id: '', box: bandBox(), moved: false,
        by: { x: 0, y: 0 }, size: undefined,
      };
      return;
    }
    if (onLine !== undefined) {
      event.stopPropagation();
      stage.focus({ preventScroll: true });
      // A line is picked first and bent second: a drag that both selected and
      // bent would put a corner in every time someone reached for the line.
      if (onLine !== line) { pickLine(onLine); return; }
      const route = lineOf(onLine);
      if (!route) return;
      bending = { index: segmentAt(route.points, pointOn(event)), at: pointOn(event), fresh: true };
      drag = {
        kind: 'move', from: { x: event.clientX, y: event.clientY },
        pointerId: event.pointerId, id: '', box: bandBox(), moved: false,
        by: { x: 0, y: 0 }, size: undefined,
      };
      return;
    }

    // The press belongs to the canvas, not to the page behind it — but the
    // default is cancelled on the mouse event below rather than here:
    // cancelling a pointerdown also cancels the click and the double click the
    // browser would have made from it, and renaming a shape is a double click.
    event.stopPropagation();
    stage.focus({ preventScroll: true });

    if (id === undefined || id === null) {
      if (connecting !== undefined) { connecting = undefined; describe(); }
      if (!event.shiftKey) pick([]);
      // An empty press starts a rubber band. Nothing is selected until it is
      // let go, so a stray click still just clears the selection.
      band = { from: pointOn(event), to: pointOn(event) };
      drag = {
        kind: 'move', from: { x: event.clientX, y: event.clientY },
        pointerId: event.pointerId, id: '', box: bandBox(), moved: false,
        by: { x: 0, y: 0 }, size: undefined,
      };
      return;
    }
    // A connection is drawn by picking its two ends, so the second press is
    // the line rather than a selection.
    if (connecting !== undefined && connecting !== id) {
      const from = connecting;
      connecting = undefined;
      options.apply(() => connectNodes(file, source, from, id), [id]);
      return;
    }
    if (event.shiftKey) { toggle(id); return; }
    // Pressing something already picked keeps the rest of the selection: that
    // is how a group of shapes is dragged as one.
    if (!picked.includes(id)) pick([id]);
    // A press inside a tree or a list is also a press on one of its rows. The
    // shape stays picked — it still moves and resizes — and the row becomes
    // what the row buttons act on.
    const onRow = rowAt(id, pointOn(event));
    pickRow(onRow === undefined ? undefined : { id, index: onRow });
    describe();

    const box = boxOf(id);
    if (!box) return;
    moving = movingSet();
    if (moving.size === 0) {
      options.onError?.(`${id} は中身が無いので動かせない`);
      return;
    }
    drag = {
      kind: onHandle ? 'resize' : 'move',
      from: { x: event.clientX, y: event.clientY },
      pointerId: event.pointerId,
      id, box, moved: false,
      by: { x: 0, y: 0 }, size: undefined,
    };
  });

  /**
   * What a drag moves on screen: everything picked, and everything a picked
   * group contains. A group's box is computed from its contents, so moving the
   * box without the contents would move nothing at all.
   */
  function movingSet(): Set<string> {
    const ids = new Set<string>();
    for (const id of picked) {
      const node = file.nodes.find(n => n.id === id);
      if (node?.shape === 'group') {
        for (const child of groupMembers(file, id)) ids.add(child);
        // A group the author pinned keeps its own line; one that is computed
        // from its contents follows them without being written down.
        if (file.layout.has(id)) ids.add(id);
        else if (groupMembers(file, id).length > 0) ids.add(id);
        continue;
      }
      ids.add(id);
    }
    return ids;
  }

  /** What a drag writes: the moved shapes, minus the groups that are computed. */
  function pinnedSet(): string[] {
    return [...moving].filter(id => {
      const node = file.nodes.find(n => n.id === id);
      return node?.shape !== 'group' || file.layout.has(id);
    });
  }

  stage.addEventListener('pointermove', event => {
    const current = drag;
    if (!current) return;
    const factor = scale();
    const dx = (event.clientX - current.from.x) / factor;
    const dy = (event.clientY - current.from.y) / factor;
    if (!current.moved && Math.hypot(dx, dy) * factor < THRESHOLD) return;
    if (!current.moved) {
      // Captured only once the press has become a drag. Capturing on the press
      // itself would retarget the click the browser makes from it, and a double
      // click that lands on the canvas instead of the shape renames nothing.
      stage.setPointerCapture(current.pointerId);
      current.moved = true;
    }

    if (bending) {
      const route = lineOf(line);
      if (route) {
        const path = route.points;
        const before = bending.fresh ? path[bending.index]! : path[bending.index]!;
        const after = bending.fresh ? path[bending.index + 1]! : path[bending.index + 2]!;
        bending = { ...bending, at: square(pointOn(event), before, after) };
        // The drawn line follows too, so what is being made is what is seen.
        const drawn = drawing.querySelector(`[data-edge="${cssEscape(line ?? '')}"] polyline`);
        drawn?.setAttribute('points', points(livePath(path)));
      }
      paint();
      return;
    }
    if (reaching) {
      reaching = { end: reaching.end, at: pointOn(event) };
      paint();
      return;
    }
    if (band) {
      band = { from: band.from, to: pointOn(event) };
      paint();
      return;
    }

    drawing.classList.add('dp-canvas-dragging');
    const box = current.box;
    if (current.kind === 'move') {
      // Only the shape under the pointer snaps; the others keep their offsets
      // from it, so a selection that was aligned stays aligned.
      const snapped = snap(box.x + dx, box.y + dy, box.width, box.height, moving);
      current.by = { x: snapped.x - box.x, y: snapped.y - box.y };
      preview = { box: { ...box, x: snapped.x, y: snapped.y }, guides: snapped.guides };
      for (const id of moving) {
        const node = drawing.querySelector(`[data-node="${cssEscape(id)}"]`);
        // The shapes follow the pointer; their connections are re-routed when
        // they land, which is why they fade rather than stretch.
        node?.setAttribute('transform', `translate(${current.by.x}, ${current.by.y})`);
      }
      dropping = landing(current.id, pointOn(event));
    } else {
      // A line is allowed to be flat — that is what a horizontal rule is — so
      // the floor every other shape has would make one impossible to draw.
      const flat = file.nodes.find(n => n.id === primary())?.shape === 'line';
      const least = flat ? 0 : MIN_SIZE;
      const width = Math.max(least, round(box.width + dx));
      const height = Math.max(least, round(box.height + dy));
      current.size = { width, height };
      preview = { box: { ...box, width, height }, guides: [] };
    }
    describe();
    paint();
  });

  const finish = (event: PointerEvent): void => {
    const current = drag;
    if (!current) return;
    drag = undefined;
    // Taken now so that every way out of this clears it: a mark left behind
    // would say the next drag lands where the last one would have.
    const landed = dropping;
    dropping = undefined;
    drawing.classList.remove('dp-canvas-dragging');
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);

    if (bending) {
      const which = bending;
      const route = lineOf(line);
      bending = undefined;
      // Nothing moved, so nothing is redrawn: repainting here would replace the
      // handle under the pointer, and the browser makes no double click out of
      // two presses on two different elements.
      if (!route || !current.moved) return;
      const edge = route.edge;
      const path = route.points.map(p => ({ x: p.x, y: p.y }));
      if (which.fresh) path.splice(which.index + 1, 0, which.at);
      else path[which.index + 1] = which.at;
      // A corner dropped back onto the straight line between its neighbours is
      // a corner nobody wants: the gesture that made it takes it away again.
      const corners = path.slice(1, -1).filter((corner, i) => {
        const before = path[i]!;
        const after = path[i + 2]!;
        return toSegment(corner, before, after) > 6 / scale();
      });
      options.apply(
        () => bendEdge(file, source, edge.from, edge.to,
          corners.map(p => ({ x: p.x - laid.origin.x, y: p.y - laid.origin.y }))),
        [], nameOf(edge),
      );
      return;
    }

    if (reaching) {
      const end = reaching.end;
      const at = reaching.at;
      reaching = undefined;
      const chosen = lineOf(line);
      if (!chosen || !current.moved) return;
      // Whatever shape the end was let go over is the new end. Let go over
      // nothing and the line stays as it was.
      const onto = [...laid.boxes].find(([, box]) =>
        at.x >= box.x && at.x <= box.x + box.width
        && at.y >= box.y && at.y <= box.y + box.height)?.[0];
      if (onto === undefined) { paint(); return; }
      const edge = { from: chosen.edge.from, to: chosen.edge.to };
      const ends = end === 'from' ? { from: onto } : { to: onto };
      options.apply(
        () => reconnect(file, source, edge, ends), [],
        end === 'from' ? `${onto}->${edge.to}` : `${edge.from}->${onto}`,
      );
      return;
    }

    if (band) {
      const box = bandBox();
      const inside = band.to.x !== band.from.x || band.to.y !== band.from.y
        ? [...laid.boxes].filter(([, other]) => within(other, box)).map(([id]) => id)
        : [];
      band = undefined;
      if (inside.length > 0) pick(inside); else paint();
      return;
    }

    if (!current.moved) {
      // A press on something already picked keeps the selection, so that a
      // selection can be dragged as one. Letting go without moving means it
      // was a click after all: the selection comes down to what was clicked.
      if (current.id !== '' && picked.length > 1) pick([current.id]);
      preview = undefined;
      paint();
      return;
    }
    if (current.kind === 'resize') {
      const box = current.box;
      const size = current.size;
      const id = current.id;
      if (!size) { preview = undefined; paint(); return; }
      options.apply(() => pinNode(file, source, id, {
        x: box.x - laid.origin.x, y: box.y - laid.origin.y, ...size,
      }), [id]);
      return;
    }
    // Dropped inside its own container: the arrangement changes and nothing
    // gets a coordinate. One block of the file is rewritten.
    if (landed) {
      options.apply(
        () => setContainerCells(file, source, landed.container, landed.cells), [current.id],
      );
      return;
    }

    // The redraw that follows builds the canvas again, so the preview is left
    // in place: taking it off first would show the shapes jumping back.
    const by = current.by;
    const pins = new Map(pinnedSet().map(id => {
      const box = laid.boxes.get(id)!;
      return [id, { x: box.x - laid.origin.x + by.x, y: box.y - laid.origin.y + by.y }];
    }));
    options.apply(() => pinNodes(file, source, pins), picked);
  };
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);

  /** True when a box is wholly inside the rubber band. */
  function within(box: Box, area: Box): boolean {
    return box.x >= area.x && box.y >= area.y
      && box.x + box.width <= area.x + area.width
      && box.y + box.height <= area.y + area.height;
  }

  // Keeps the browser from moving the focus or starting a text selection,
  // while leaving click and double click to be made as usual.
  stage.addEventListener('mousedown', event => {
    if ((event.target as Element | null)?.closest('.dp-canvas-text, .dp-format-bar')) return;
    event.preventDefault();
    event.stopPropagation();
  });

  stage.addEventListener('dblclick', event => {
    const target = event.target as Element | null;
    // Double clicking a corner takes it out. Dragging it back onto the line
    // does too, but that asks someone to aim at a line that is not drawn any
    // more — the corner is where the line goes now.
    const corner = target?.closest('.dp-canvas-bend')?.getAttribute('data-bend');
    if (corner !== undefined && corner !== null) {
      event.preventDefault();
      dropCorner(Number(corner));
      return;
    }
    const id = target?.closest('[data-node]')?.getAttribute('data-node');
    if (id === null || id === undefined) return;
    event.preventDefault();
    // A tree holds rows rather than one label, so a double click on a row is
    // about that row. Which row is the one under the pointer, not the one that
    // happened to be picked: people aim at what they want to change.
    const onRow = rowAt(id, pointOn(event));
    if (onRow !== undefined) { beginRow(id, onRow); return; }
    beginText(id);
  });

  /** Removes one corner from the picked line, or all of them. */
  function dropCorner(index: number | 'all'): void {
    const chosen = lineOf(line);
    if (!chosen) return;
    const edge = chosen.edge;
    const corners = [...file.bends.get(nameOf(edge))?.points ?? []];
    if (corners.length === 0) return;
    const left = index === 'all' ? [] : corners.filter((_, i) => i !== index);
    options.apply(
      () => bendEdge(file, source, edge.from, edge.to, left), [], nameOf(edge),
    );
  }

  /**
   * Pulls an edge, a centre or a midline into line with another shape's. This
   * is what makes a drawn screen look drawn rather than sprinkled; a coordinate
   * that lines up with nothing falls back to a round number.
   */
  function snap(
    x: number, y: number, width: number, height: number, ignore: ReadonlySet<string>,
  ): { x: number; y: number; guides: { axis: 'x' | 'y'; at: number }[] } {
    // Shapes moving with the pointer are not something to line up against.
    const others = [...laid.boxes].filter(([id]) => !ignore.has(id)).map(([, box]) => box);
    const guides: { axis: 'x' | 'y'; at: number }[] = [];

    const axis = (
      start: number, size: number, edgesOf: (box: Box) => [number, number, number],
      which: 'x' | 'y',
    ): number => {
      const mine: [number, number, number] = [start, start + size / 2, start + size];
      let best: { at: number; delta: number } | undefined;
      for (const box of others) {
        const theirs = edgesOf(box);
        // An edge lines up with an edge and a centre with a centre. Letting a
        // left edge stick to the middle of a checkbox is a line nobody drew.
        const pairs: [number, number[]][] = [
          [mine[0], [theirs[0], theirs[2]]],
          [mine[1], [theirs[1]]],
          [mine[2], [theirs[0], theirs[2]]],
        ];
        for (const [own, candidates] of pairs) {
          for (const edge of candidates) {
            const delta = edge - own;
            if (Math.abs(delta) <= SNAP && (!best || Math.abs(delta) < Math.abs(best.delta))) {
              best = { at: edge, delta };
            }
          }
        }
      }
      if (!best) return round(start);
      guides.push({ axis: which, at: best.at });
      return start + best.delta;
    };

    return {
      x: axis(x, width, box => [box.x, box.x + box.width / 2, box.x + box.width], 'x'),
      y: axis(y, height, box => [box.y, box.y + box.height / 2, box.y + box.height], 'y'),
      guides,
    };
  }

  // --- 図形の追加・削除・書き換え ----------------------------------------
  //
  // These are edits to the semantics layer, which is the layer a person writes
  // by hand. They live in a context menu for the same reason the grid's row and
  // column operations do: they are used now and then, and putting them in the
  // bar would push out what is used constantly.

  const menu = createMenu(owner);
  /** While drawing a connection: the shape it starts from. */
  let connecting: string | undefined;

  stage.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.target as Element | null;
    const corner = target?.closest('.dp-canvas-bend')?.getAttribute('data-bend');
    if (corner !== undefined && corner !== null) {
      menu.open(event.clientX, event.clientY, [
        { label: 'この折れ点を消す', run: () => dropCorner(Number(corner)) },
        { label: 'まっすぐに戻す（折れ点を全部消す）', run: () => dropCorner('all') },
      ]);
      return;
    }
    const under = target?.closest('[data-node]')?.getAttribute('data-node');
    const near = under ? {} : nearest(pointOn(event));
    const overShape = under ?? near.rule;
    const onLine = near.line;
    if (onLine !== undefined) {
      pickLine(onLine);
      const edge = lineOf(onLine)?.edge;
      if (!edge) return;
      const bent = (file.bends.get(onLine)?.points.length ?? 0) > 0;
      menu.open(event.clientX, event.clientY, [
        ...(bent ? [{
          label: 'まっすぐに戻す（折れ点を全部消す）',
          run: () => dropCorner('all'),
        }] : []),
        {
          label: '線を消す',
          separated: bent,
          run: () => options.apply(() => disconnectNodes(file, source, edge.from, edge.to), []),
        },
      ]);
      return;
    }
    if (overShape === undefined || overShape === null) {
      menu.open(event.clientX, event.clientY, addItems(event));
      return;
    }
    if (!picked.includes(overShape)) pick([overShape]);
    // Right clicking a row is about that row, the same as pressing it.
    const onRow = rowAt(overShape, pointOn(event));
    if (onRow !== undefined) { pickRow({ id: overShape, index: onRow }); paint(); describe(); }
    menu.open(event.clientX, event.clientY, shapeItems(overShape));
  });

  /**
   * Where the dragged shape would land in the container that holds it.
   *
   * Only while the pointer is still inside that container, and only when one
   * shape is being dragged: moving several at once is moving them somewhere
   * else, which is what a pin is for.
   */
  function landing(
    id: string, at: { x: number; y: number },
  ): { container: string; cells: string[][]; mark: Box } | undefined {
    if (picked.length !== 1) return undefined;
    const name = containerOf(file).get(id);
    const container = name === undefined ? undefined : file.containers.get(name);
    const box = name === undefined ? undefined : laid.boxes.get(name);
    if (!container || !box || name === undefined) return undefined;
    if (at.x < box.x || at.x > box.x + box.width || at.y < box.y || at.y > box.y + box.height) {
      return undefined;
    }
    const found = dropInto(container, box, one => laid.boxes.get(one), id, at);
    return found ? { container: name, ...found } : undefined;
  }

  /** Which row of a listing the pointer is on, if any. */
  function rowAt(id: string, at: { x: number; y: number }): number | undefined {
    const held = listingOf(id);
    const box = boxOf(id);
    if (!held || !box) return undefined;
    // The far edge belongs to the next row, not to both: rows touch, and a
    // press on the line between two of them has to mean one of them.
    const found = rowBoxes(held.icon, box, held.items)
      .findIndex(one => one !== undefined
        && at.x >= one.x && at.x < one.x + one.width
        && at.y >= one.y && at.y < one.y + one.height);
    return found < 0 ? undefined : found;
  }

  /**
   * Where the branch starting at a row ends: the first row after it that is
   * not nested under it. A row with nothing under it is a branch of one.
   */
  function branch(items: readonly Item[], at: number): number {
    const depth = items[at]?.depth ?? 0;
    let end = at + 1;
    while (end < items.length && items[end]!.depth > depth) end += 1;
    return end;
  }

  /** Moves a whole branch one step in or out, keeping its own shape. */
  function deepen(items: Item[], at: number, by: number): Item[] {
    const end = branch(items, at);
    for (let i = at; i < end; i += 1) {
      items[i] = { ...items[i]!, depth: items[i]!.depth + by };
    }
    return items;
  }

  /**
   * One change to the rows of the picked listing. The whole list is handed to
   * the edit, which writes the block back as one byte range; what the author
   * is told is "the list changed", because that is what happened.
   */
  function changeRows(
    make: (items: Item[], at: number) => { items: Item[]; at: number } | undefined,
  ): void {
    const current = row;
    const held = listingOf(current?.id);
    if (!current || !held) return;
    const next = make([...held.items], current.index);
    if (!next) return;
    pickRow(next.items.length === 0
      ? undefined
      : { id: current.id, index: Math.max(0, Math.min(next.at, next.items.length - 1)) });
    options.apply(() => setItems(file, source, current.id, next.items), [current.id]);
  }

  /** Where a new shape goes: under the drawing, in the file's own numbers. */
  function emptySpot(): { x: number; y: number } {
    const boxes = [...laid.boxes.values()];
    if (boxes.length === 0) return { x: 0, y: 0 };
    return {
      x: round(Math.min(...boxes.map(b => b.x)) - laid.origin.x),
      y: round(Math.max(...boxes.map(b => b.y + b.height)) - laid.origin.y + 24),
    };
  }

  function addItems(event: MouseEvent): MenuItem[] {
    return PALETTE.map(([shape, label]): MenuItem => ({
      label,
      icon: shapeIcon(shape),
      separated: shape === 'parallelogram',
      run: () => addShape(shape, event),
    }));
  }

  /**
   * The parts library, on its own list. There are many of them and they are
   * pictures of particular things, so putting them among the shapes would bury
   * "四角" under a hundred routers.
   *
   * One row per kind, each opening the pictures of that kind. The whole set is
   * longer than a screen, and a screen's worth of scrolling is what the reader
   * pays whether the list is labelled or not; a row per kind is as long as the
   * number of kinds, and only the kind that was picked is ever shown.
   */
  function partItems(event?: MouseEvent): MenuItem[] {
    const kinds = new Map<string, MenuItem[]>();
    for (const part of stencilParts()) {
      const one: MenuItem = {
        label: part.label,
        icon: partIcon(part.body),
        run: () => addShape('text', event, part.name, part.label),
      };
      const kind = kinds.get(part.group);
      if (kind) kind.push(one);
      else kinds.set(part.group, [one]);
    }
    return [...kinds].map(([group, items]): MenuItem => ({ label: group, items }));
  }

  function addShape(
    shape: ShapeKind, event?: MouseEvent, icon?: string, text = '図形',
  ): void {
    // A freely placed drawing has no engine to decide where a shape goes, so
    // the new one is pinned: at the pointer if it came from the drawing, and
    // under the drawing otherwise.
    const at = file.mode === 'free'
      ? (event ? pointIn(event) : emptySpot())
      : undefined;
    // Selected as soon as it exists, so the next gesture — dragging it, or
    // typing over its text — lands on the shape just added.
    options.apply(
      () => addNode(file, source, { shape, text, at, icon }),
      [nextShapeId(file, icon === undefined ? shape : 'part')],
    );
  }

  /**
   * The point a press landed on, in the file's coordinates — what a pin holds.
   * Everything drawn on screen uses `pointOn` instead: the drawing is laid out
   * with a shift applied, and mixing the two puts the band and the line's ends
   * that shift away from the pointer.
   */
  function pointIn(event: MouseEvent): { x: number; y: number } {
    const rect = drawing.getBoundingClientRect();
    const factor = scale();
    return {
      x: round((event.clientX - rect.left) / factor - laid.origin.x),
      y: round((event.clientY - rect.top) / factor - laid.origin.y),
    };
  }

  function shapeItems(id: string): MenuItem[] {
    const node = file.nodes.find(n => n.id === id);
    const items: MenuItem[] = [];
    if (picked.length > 1) {
      // Grouping adds one line naming what is inside. Nothing moves, so the
      // drawing looks the same the moment after.
      const ids = [...picked];
      items.push({
        label: `${ids.length} 個をグループにする`,
        run: () => options.apply(() => groupNodes(file, source, ids, 'グループ'), ids),
      });
    }
    // A shape that holds rows has no label of its own: what the menu offers is
    // the row that is picked, and only once one is.
    const held = listingOf(id);
    const onRow = held && row?.id === id ? row.index : undefined;
    items.push(
      // A line holds no words, so there is nothing for a text box to edit.
      {
        label: held ? '行の文字を変える' : '文字を変える',
        run: () => (onRow === undefined ? beginText(id) : beginRow(id, onRow)),
        disabled: node?.shape === 'line' || (held !== undefined && onRow === undefined),
      },
      {
        label: connecting === undefined ? '線を引く' : '線を引く（引き先を選ぶ）',
        run: () => { connecting = id; describe(); },
        disabled: node?.shape === 'group' || picked.length > 1,
      },
    );
    for (const [shape, label] of PALETTE) {
      items.push({
        label,
        icon: shapeIcon(shape),
        separated: shape === PALETTE[0]![0] || shape === 'parallelogram',
        // Becoming a line means losing the words: the notation has nowhere to
        // keep them. So it is offered for a shape that has none, and a shape
        // with words is left to be emptied first — rather than quietly emptied.
        disabled: node?.shape === shape || node?.shape === 'group'
          || (node?.items.length ?? 0) > 0
          || (shape === 'line' && (node?.text ?? '') !== ''),
        run: () => options.apply(() => setNodeShape(file, id, shape), [id]),
      });
    }
    items.push({
      label: '自動配置に戻す',
      separated: true,
      disabled: !canUnpin(file, id),
      run: () => options.apply(() => unpinNode(file, source, id), [id]),
    });
    items.push({
      label: deleteLabel(),
      run: () => options.apply(() => removeNodes(file, source, [...picked]), []),
    });
    return items;
  }

  /**
   * Says what else goes with it. There is no undo, so it is said beforehand.
   * Deleting a group is an ungrouping: the line that names its contents goes,
   * and the contents stay where they are.
   */
  function deleteLabel(): string {
    const ids = new Set(picked);
    if (picked.length === 1 && file.nodes.find(n => n.id === picked[0])?.shape === 'group') {
      return 'グループを解除（中身は残る）';
    }
    const lines = file.edges.filter(e => ids.has(e.from) || ids.has(e.to)).length;
    const what = picked.length > 1 ? `${picked.length} 個を削除` : '削除';
    return lines === 0 ? what : `${what}（線 ${lines} 本も消える）`;
  }

  /**
   * Opens a text box over the shape. A box over the thing being renamed is not
   * decoration: it is where the IME needs somewhere to compose from, the same
   * reason the grid keeps one over the selected cell.
   */
  function beginText(id: string): void {
    const node = file.nodes.find(n => n.id === id);
    const box = boxOf(id);
    if (!node || !box || node.shape === 'line' || node.items.length > 0) return;
    const rect = drawing.getBoundingClientRect();
    const stageAt = stage.getBoundingClientRect();
    const factor = scale();

    const input = owner.createElement('input');
    input.className = 'dp-canvas-text';
    input.value = node.text;
    input.spellcheck = false;
    const left = rect.left - stageAt.left + box.x * factor;
    const top = rect.top - stageAt.top + box.y * factor;
    input.style.left = `${left}px`;
    input.style.top = `${top}px`;
    input.style.width = `${box.width * factor}px`;
    input.style.height = `${box.height * factor}px`;
    stage.append(input);

    // The same bar a paragraph and a table cell get: a label holds the same
    // inline Markdown they do, so it gets the same way of writing it.
    const toolbar = createToolbar(owner, mark => applyMark(mark));
    toolbar.element.classList.add('dp-canvas-format');
    stage.append(toolbar.element);
    const bar = toolbar.element.getBoundingClientRect();
    // Above the shape, or below it when the shape is against the top edge.
    const above = top - bar.height - 4;
    toolbar.element.style.left = `${Math.max(0, left)}px`;
    toolbar.element.style.top = `${above >= 0 ? above : top + box.height * factor + 4}px`;

    input.focus();
    input.select();
    const sync = (): void =>
      toolbar.sync(input.value, input.selectionStart ?? 0, input.selectionEnd ?? 0);
    sync();

    function applyMark(mark: InlineMark): void {
      const change = toggleInline(
        input.value, input.selectionStart ?? 0, input.selectionEnd ?? 0, mark);
      input.setRangeText(change.text, change.start, change.end, 'preserve');
      input.setSelectionRange(change.select.start, change.select.end);
      input.focus();
      sync();
    }

    let done = false;
    const finish = (keep: boolean): void => {
      if (done) return;
      done = true;
      const text = input.value;
      input.remove();
      toolbar.element.remove();
      stage.focus({ preventScroll: true });
      if (!keep || text === node.text) return;
      options.apply(() => setNodeText(file, id, text, options.source), [id]);
    };
    input.addEventListener('blur', () => finish(true));
    for (const event of ['input', 'select', 'keyup', 'click']) {
      input.addEventListener(event, sync);
    }
    input.addEventListener('keydown', event => {
      // Every key here belongs to the text, including the ones the canvas uses.
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        applyMark('bold');
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        applyMark('italic');
      }
    });
  }

  /**
   * Opens a text box over one row of a tree, a list or a menu.
   *
   * The row has no id, so there is no shape to place the box over: it goes
   * where `rowTextAt` says the words are drawn, which is the only way the box
   * and the picture can agree. Confirming writes the whole block back, because
   * one row is not a byte range the file has a line of its own for.
   */
  function beginRow(id: string, index: number): void {
    const held = listingOf(id);
    const box = boxOf(id);
    const item = held?.items[index];
    if (!held || !box || !item) return;
    const at = rowTextAt(held.icon, box, held.items, index);
    const rect = drawing.getBoundingClientRect();
    const stageAt = stage.getBoundingClientRect();
    const factor = scale();

    const input = owner.createElement('input');
    input.className = 'dp-canvas-text dp-canvas-row-text';
    input.value = item.text;
    input.spellcheck = false;
    input.style.left = `${rect.left - stageAt.left + at.x * factor}px`;
    input.style.top = `${rect.top - stageAt.top + at.y * factor}px`;
    input.style.width = `${Math.max(40, at.width * factor)}px`;
    input.style.height = `${at.height * factor}px`;
    stage.append(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (keep: boolean): void => {
      if (done) return;
      done = true;
      const text = input.value.trim();
      input.remove();
      stage.focus({ preventScroll: true });
      // Emptying the box is not how a row is removed — the button next to it
      // is — so an empty box leaves the row as it was rather than writing a
      // bullet with nothing after it.
      if (!keep || text === '' || text === item.text) return;
      const rows = held.items.map((one, i) => (i === index ? { ...one, text } : one));
      options.apply(() => setItems(file, source, id, rows), [id]);
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', event => {
      // Every key here belongs to the text, including the ones the canvas uses.
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
  }

  // --- キーボード --------------------------------------------------------
  //
  // Everything the mouse does, the keyboard does too. A shape nudged by 4 is
  // still the same one line of the file.

  stage.addEventListener('keydown', event => {
    const ids = [...laid.boxes.keys()];
    const at = primary();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (connecting !== undefined) { connecting = undefined; describe(); return; }
      options.close();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      if (ids.length === 0) return;
      const index = at === undefined ? -1 : ids.indexOf(at);
      const step = event.shiftKey ? -1 : 1;
      const next = ids[(index + step + ids.length * 2) % ids.length];
      pick(next === undefined ? [] : [next]);
      return;
    }
    const chosen = lineOf(line);
    if ((event.key === 'Delete' || event.key === 'Backspace') && chosen) {
      event.preventDefault();
      const edge = chosen.edge;
      options.apply(() => disconnectNodes(file, source, edge.from, edge.to), []);
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && picked.length > 0) {
      event.preventDefault();
      const ids = [...picked];
      const going = new Set(ids);
      // Nothing here can be undone, so a deletion that takes connections with
      // it is confirmed where the shape is, the way the grid confirms a merge.
      if (file.edges.some(e => going.has(e.from) || going.has(e.to))) {
        const box = boxOf(at);
        const rect = drawing.getBoundingClientRect();
        const factor = scale();
        menu.open(
          rect.left + ((box?.x ?? 0) + (box?.width ?? 0) / 2) * factor,
          rect.top + ((box?.y ?? 0) + (box?.height ?? 0)) * factor,
          [
            {
              label: deleteLabel(),
              run: () => options.apply(() => removeNodes(file, source, ids), []),
            },
            { label: 'やめる', run: () => {} },
          ],
        );
        return;
      }
      options.apply(() => removeNodes(file, source, ids), []);
      return;
    }
    if (event.key === 'F2' && at !== undefined) {
      event.preventDefault();
      beginText(at);
      return;
    }
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const move = step[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    if (picked.length === 0) return;
    // Shift is the fine adjustment: one unit, for the last pixel of a screen.
    const by = event.shiftKey ? 1 : GRID;
    moving = movingSet();
    const targets = pinnedSet();
    if (targets.length === 0) return;
    const pins = new Map(targets.map(id => {
      const box = laid.boxes.get(id)!;
      return [id, {
        x: box.x - laid.origin.x + move[0]! * by,
        y: box.y - laid.origin.y + move[1]! * by,
      }];
    }));
    options.apply(() => pinNodes(file, source, pins), [...picked]);
  });

  // --- 整列 --------------------------------------------------------------
  //
  // Lining shapes up by hand is what the snapping is for when there are two of
  // them; with six it is a command. Each shape gets its own offset, and they
  // all land in one write.

  type Edge = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';

  function align(edge: Edge): void {
    const boxes = picked
      .map(id => [id, laid.boxes.get(id)] as const)
      .filter((pair): pair is readonly [string, Box] => pair[1] !== undefined);
    if (boxes.length < 2) return;

    const lefts = boxes.map(([, box]) => box.x);
    const rights = boxes.map(([, box]) => box.x + box.width);
    const tops = boxes.map(([, box]) => box.y);
    const bottoms = boxes.map(([, box]) => box.y + box.height);
    const target = {
      left: Math.min(...lefts),
      right: Math.max(...rights),
      centre: (Math.min(...lefts) + Math.max(...rights)) / 2,
      top: Math.min(...tops),
      bottom: Math.max(...bottoms),
      middle: (Math.min(...tops) + Math.max(...bottoms)) / 2,
    }[edge];

    const deltas = new Map<string, { x: number; y: number }>();
    for (const [id, box] of boxes) {
      switch (edge) {
        case 'left': deltas.set(id, { x: target - box.x, y: 0 }); break;
        case 'right': deltas.set(id, { x: target - (box.x + box.width), y: 0 }); break;
        case 'centre': deltas.set(id, { x: target - (box.x + box.width / 2), y: 0 }); break;
        case 'top': deltas.set(id, { x: 0, y: target - box.y }); break;
        case 'bottom': deltas.set(id, { x: 0, y: target - (box.y + box.height) }); break;
        case 'middle': deltas.set(id, { x: 0, y: target - (box.y + box.height / 2) }); break;
      }
    }
    shiftAll(deltas, '整列');
  }

  /** Spreads the picked shapes so the gaps between them are equal. */
  function spread(axis: 'x' | 'y'): void {
    const boxes = picked
      .map(id => [id, laid.boxes.get(id)] as const)
      .filter((pair): pair is readonly [string, Box] => pair[1] !== undefined)
      .sort((a, b) => a[1][axis] - b[1][axis]);
    if (boxes.length < 3) return;
    const size = axis === 'x' ? 'width' : 'height';
    const first = boxes[0]![1];
    const last = boxes[boxes.length - 1]![1];
    const room = (last[axis] + last[size]) - first[axis]
      - boxes.reduce((total, [, box]) => total + box[size], 0);
    const gap = room / (boxes.length - 1);

    const deltas = new Map<string, { x: number; y: number }>();
    let at = first[axis];
    for (const [id, box] of boxes) {
      deltas.set(id, axis === 'x' ? { x: at - box.x, y: 0 } : { x: 0, y: at - box.y });
      at += box[size] + gap;
    }
    shiftAll(deltas, '等間隔に並べる');
  }

  /**
   * Moves each shape by its own offset. A group moves what it holds, the same
   * way dragging it does.
   */
  function shiftAll(deltas: ReadonlyMap<string, { x: number; y: number }>, what: string): void {
    const pins = new Map<string, { x: number; y: number }>();
    const add = (id: string, by: { x: number; y: number }): void => {
      const node = file.nodes.find(n => n.id === id);
      if (node?.shape === 'group') {
        for (const child of groupMembers(file, id)) add(child, by);
        if (!file.layout.has(id)) return;
      }
      const box = laid.boxes.get(id);
      if (!box) return;
      pins.set(id, {
        x: round(box.x - laid.origin.x + by.x),
        y: round(box.y - laid.origin.y + by.y),
      });
    };
    for (const [id, by] of deltas) add(id, by);
    if (pins.size === 0) return;
    options.apply(() => ({ ...pinNodes(file, source, pins), description: what }), [...picked]);
  }

  // --- 操作列 ------------------------------------------------------------

  function describe(): void {
    // A shape that cannot be handed back says so before it is pressed, not
    // after: in a freely placed drawing there is no engine to hand it to.
    const at = primary();
    if (release) {
      release.disabled = picked.length !== 1 || at === undefined || !canUnpin(file, at);
      // A shape a container holds has somewhere to go back to, and saying
      // "the layout engine" about a form's own frame would mean nothing.
      const inContainer = at !== undefined && containerOf(file).has(at);
      release.textContent = inContainer ? '入れ物に戻す' : '自動配置に戻す';
      release.title = picked.length === 1 && at !== undefined && !canUnpin(file, at)
        && file.mode !== 'flow'
        ? '自由配置の図では外せない（外すと置き場所が無くなる）'
        : inContainer
          ? '手で決めた位置を捨て、入れ物の並びに返す'
          : '手で決めた位置を捨て、レイアウトエンジンに返す';
    }
    if (aligners) aligners.hidden = picked.length < 2;
    for (const button of spreaders) button.disabled = picked.length < 3;
    const alone = picked.length === 1 ? file.nodes.find(n => n.id === picked[0]) : undefined;
    if (liners) liners.hidden = alone?.shape !== 'line';
    const inRow = listingOf(row?.id);
    if (rows) rows.hidden = row === undefined || inRow === undefined;
    for (const button of rowButtons) {
      button.disabled = button.dataset.rowOnly === 'tree' && inRow?.icon !== 'ui/tree';
    }
    for (const button of lookButtons) {
      const [property, value] = (button.dataset.look ?? '=').split('=');
      button.classList.toggle('dp-canvas-on',
        alone !== undefined
        && lookOf(property ?? '', alone.id) === (value === '' ? undefined : value));
    }
    if (!where) return;
    if (connecting !== undefined) {
      where.textContent = `${connecting} から線を引く先を選ぶ`;
      return;
    }
    const chosen = lineOf(line);
    if (chosen) {
      where.textContent = `${chosen.edge.from} → ${chosen.edge.to}  (線)`;
      if (hint) {
        hint.textContent = '線の途中の○をドラッグすると曲がる / □をダブルクリックでその折れ点を消す / '
          + '端の○でつなぎ替え / Delete で線を消す';
      }
      return;
    }
    if (hint) {
      // A row is picked inside a shape, so the line about the shape would be
      // answering a question nobody asked. The buttons are small pictures;
      // this is where they are named.
      hint.textContent = row !== undefined
        ? '行：ダブルクリックで文字 / 左のボタンで足す・消す・深さ・選択・開閉'
        : alone?.shape === 'line'
          ? 'ドラッグで移動 / 右下で長さと向き / 左のボタンで矢印と太さ'
          : HINT;
    }
    if (picked.length > 1) {
      where.textContent = `${picked.length} 個を選択`;
      return;
    }
    const box = preview?.box ?? boxOf(at);
    if (at === undefined || !box) {
      where.textContent = '図形を選ぶ';
      return;
    }
    const pinned = file.layout.has(at) ? '固定' : '自動';
    where.textContent = `${at}  ${round(box.x - laid.origin.x)}, `
      + `${round(box.y - laid.origin.y)}  ${round(box.width)}×${round(box.height)}  (${pinned})`;
  }

  /**
   * What a declaration says for this shape now. `arrow: none` and no `arrow` at
   * all are the same drawing, so they are the same answer: a button should be
   * marked for what is on screen, not for which words happen to be in the file.
   */
  function lookOf(property: string, id: string): string | undefined {
    const value = file.style.get(id)?.get(property);
    return property === 'arrow' && value === 'none' ? undefined : value;
  }

  function createBar(): HTMLElement {
    const node = element('div', 'dp-canvas-bar');
    where = element('span', 'dp-canvas-where');
    node.append(where);

    const add = (label: string, title: string, run: () => void): HTMLButtonElement => {
      const button = owner.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.title = title;
      button.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
        run();
      });
      node.append(button);
      return button;
    };

    // Lining up is a command once there are more than two shapes, so the row
    // appears with the selection that makes it mean something.
    aligners = element('span', 'dp-canvas-aligners');
    const spread_: HTMLButtonElement[] = [];
    const icon = (picture: string, title: string, run: () => void, keep = false): void => {
      const button = owner.createElement('button');
      button.type = 'button';
      button.className = 'dp-canvas-icon';
      button.innerHTML = picture;
      button.title = title;
      button.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
        run();
      });
      aligners?.append(button);
      if (keep) spread_.push(button);
    };
    icon(alignIcon('left'), '左を揃える', () => align('left'));
    icon(alignIcon('centre'), '左右の中心を揃える', () => align('centre'));
    icon(alignIcon('right'), '右を揃える', () => align('right'));
    icon(alignIcon('top'), '上を揃える', () => align('top'));
    icon(alignIcon('middle'), '上下の中心を揃える', () => align('middle'));
    icon(alignIcon('bottom'), '下を揃える', () => align('bottom'));
    icon(alignIcon('spread-x'), '横に等間隔で並べる', () => spread('x'), true);
    icon(alignIcon('spread-y'), '縦に等間隔で並べる', () => spread('y'), true);
    spreaders = spread_;
    node.append(aligners);

    // The look of a line: where it points, how thick it is. It appears with a
    // line picked, the way the lining-up row appears with several shapes — and
    // it writes to the style section, which is where every other look lives.
    liners = element('span', 'dp-canvas-liners');
    const looks: HTMLButtonElement[] = [];
    const look = (
      picture: string, title: string, property: string, value: string | undefined,
    ): void => {
      const button = owner.createElement('button');
      button.type = 'button';
      button.className = 'dp-canvas-icon';
      button.innerHTML = picture;
      button.title = title;
      button.dataset.look = `${property}=${value ?? ''}`;
      button.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
        const id = primary();
        if (id === undefined || lookOf(property, id) === value) return;
        options.apply(() => setNodeStyle(file, source, id, { [property]: value }), [id]);
      });
      liners?.append(button);
      looks.push(button);
    };
    look(lineIcon('arrow-none'), '矢印なし', 'arrow', undefined);
    look(lineIcon('arrow-end'), '終点に矢印', 'arrow', 'end');
    look(lineIcon('arrow-start'), '始点に矢印', 'arrow', 'start');
    look(lineIcon('arrow-both'), '両端に矢印', 'arrow', 'both');
    look(lineIcon('weight-1'), '細い線', 'weight', undefined);
    look(lineIcon('weight-2'), '中くらいの太さ', 'weight', '2.5');
    look(lineIcon('weight-4'), '太い線', 'weight', '4');
    lookButtons = looks;
    node.append(liners);

    // The rows of a tree, a list or a menu. One row at a time, because that is
    // how they are read and how they are written.
    rows = element('span', 'dp-canvas-rows');
    const rowed: HTMLButtonElement[] = [];
    const onRow = (
      picture: string, title: string, run: () => void, only?: 'tree',
    ): void => {
      const button = owner.createElement('button');
      button.type = 'button';
      button.className = 'dp-canvas-icon';
      button.innerHTML = picture;
      button.title = title;
      if (only) button.dataset.rowOnly = only;
      button.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
        run();
      });
      rows?.append(button);
      rowed.push(button);
    };
    // Every one of these acts on the branch, not on the line: a row and what
    // is nested under it are one thing on the screen, and moving or removing
    // the row alone would leave its children hanging off whatever came before
    // — a different tree than the one anybody asked for, and sometimes one
    // with a gap in its depths that cannot be drawn at all.
    onRow(rowIcon('add'), '下に行を足す', () => changeRows((items, at) => {
      const after = branch(items, at);
      items.splice(after, 0, {
        text: '項目', depth: items[at]?.depth ?? 0, closed: false, picked: false,
      });
      return { items, at: after };
    }));
    onRow(rowIcon('drop'), 'この行を消す', () => changeRows((items, at) => {
      items.splice(at, branch(items, at) - at);
      return { items, at: Math.max(0, at - 1) };
    }));
    onRow(rowIcon('in'), '一段深くする', () => changeRows((items, at) => {
      // A row can only be as deep as one step past the row above it: a gap in
      // the depths is a tree nobody can draw.
      const most = at === 0 ? 0 : (items[at - 1]?.depth ?? 0) + 1;
      const one = items[at];
      if (!one || one.depth >= most) return undefined;
      return { items: deepen(items, at, 1), at };
    }), 'tree');
    onRow(rowIcon('out'), '一段浅くする', () => changeRows((items, at) => {
      const one = items[at];
      if (!one || one.depth === 0) return undefined;
      return { items: deepen(items, at, -1), at };
    }), 'tree');
    onRow(rowIcon('pick'), '選択中にする', () => changeRows((items, at) => {
      const was = items[at]?.picked ?? false;
      // One row at a time is chosen, as on the screen being drawn.
      return { items: items.map((one, i) => ({ ...one, picked: i === at && !was })), at };
    }));
    onRow(rowIcon('fold'), '枝を開く / 閉じる', () => changeRows((items, at) => {
      const one = items[at];
      if (!one) return undefined;
      items[at] = { ...one, closed: !one.closed };
      return { items, at };
    }), 'tree');
    rowButtons = rowed;
    node.append(rows);

    add('＋ 部品', 'ルータやサーバなどの絵を足す', () => {
      const at = bar.getBoundingClientRect();
      menu.open(at.left + 8, at.bottom + 4, partItems());
    });
    add('＋ 図形', 'この図に図形を足す', () => {
      const at = bar.getBoundingClientRect();
      menu.open(at.left + 8, at.bottom + 4, PALETTE.map(([shape, label]) => ({
        label,
        icon: shapeIcon(shape),
        separated: shape === 'parallelogram',
        run: () => addShape(shape),
      })));
    });
    release = add('自動配置に戻す', '手で決めた位置を捨て、レイアウトエンジンに返す', () => {
      const id = primary();
      if (id === undefined || picked.length !== 1) return;
      options.apply(() => unpinNode(file, source, id), [id]);
    });
    add('ソース', '.dgm のソースを直接編集する', () => options.showSource());

    hint = element('span', 'dp-canvas-hint');
    hint.textContent = HINT;
    node.append(hint);
    return node;
  }

  describe();
  paint();
  return { element: root, focus: () => stage.focus({ preventScroll: true }) };
}

/** Ids come from the file, so they may hold anything a quoted name can. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function round(value: number): number {
  return Math.round(value);
}
