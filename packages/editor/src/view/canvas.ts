// Direct manipulation of a diagram. The drawing on screen is the drawing the
// renderer produces — the editor adds an outline, a handle and the guides, and
// nothing else — so what is dragged is what a reader will see.
//
// A drag is not a new kind of state: it ends as one pin, which is one line of
// the layout section. Automatic layout keeps the rest, which is the whole point
// of the three-layer model: the mouse is for the exceptions.

import { layOutDiagram, type Box, type DiagramFile, type ShapeKind } from '@docpresenter/core';
import { renderDiagram, stencilParts } from '@docpresenter/render';
import type { Edit } from '../edit.js';
import {
  addNode, bendEdge, canUnpin, connectNodes, disconnectNodes, groupMembers, groupNodes,
  nextShapeId, pinNode, pinNodes, reconnect, removeNodes, setNodeShape, setNodeText, unpinNode,
} from '../diagram.js';
import { toggleInline, type InlineMark } from '../inline.js';
import { createMenu, type MenuItem } from './menu.js';
import { createToolbar } from './toolbar.js';
import { alignIcon, partIcon, shapeIcon } from './shape-icon.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
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

  // Declared up here because the bar is built before the code below runs, and
  // a `let` reached early is an error rather than an empty box.
  let where: HTMLElement | undefined;
  let release: HTMLButtonElement | undefined;
  let aligners: HTMLElement | undefined;
  let hint: HTMLElement | undefined;
  let spreaders: readonly HTMLButtonElement[] = [];

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
      place(outline, box);
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
   * The connection under a point, if one is near enough. Lines are found by
   * distance rather than by a wide invisible shape over them: an invisible
   * shape would have to sit above the drawing, and would then take the presses
   * meant for whatever it crosses.
   */
  function lineAt(at: { x: number; y: number }): string | undefined {
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
    return best?.name;
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
    const id = onHandle ? primary() : target?.closest('[data-node]')?.getAttribute('data-node');
    // A shape under the pointer wins; only then is a line looked for.
    const onLine = id === undefined || id === null ? lineAt(pointOn(event)) : undefined;

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
    } else {
      const width = Math.max(MIN_SIZE, round(box.width + dx));
      const height = Math.max(MIN_SIZE, round(box.height + dy));
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
    drawing.classList.remove('dp-canvas-dragging');
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);

    if (bending) {
      const which = bending;
      const route = lineOf(line);
      bending = undefined;
      if (!route || !current.moved) { paint(); return; }
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
      if (!chosen || !current.moved) { paint(); return; }
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
    const id = (event.target as Element | null)?.closest('[data-node]')?.getAttribute('data-node');
    if (id === null || id === undefined) return;
    event.preventDefault();
    beginText(id);
  });

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
    const overShape = (event.target as Element | null)?.closest('[data-node]');
    const onLine = overShape ? undefined : lineAt(pointOn(event));
    if (onLine !== undefined) {
      pickLine(onLine);
      const edge = lineOf(onLine)?.edge;
      if (!edge) return;
      menu.open(event.clientX, event.clientY, [{
        label: '線を消す',
        run: () => options.apply(() => disconnectNodes(file, source, edge.from, edge.to), []),
      }]);
      return;
    }
    const id = (event.target as Element | null)?.closest('[data-node]')?.getAttribute('data-node');
    if (id === null || id === undefined) {
      menu.open(event.clientX, event.clientY, addItems(event));
      return;
    }
    if (!picked.includes(id)) pick([id]);
    menu.open(event.clientX, event.clientY, shapeItems(id));
  });

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
   */
  function partItems(event?: MouseEvent): MenuItem[] {
    return stencilParts().map(part => ({
      label: part.label,
      icon: partIcon(part.body),
      run: () => addShape('text', event, part.name, part.label),
    }));
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
    items.push(
      { label: '文字を変える', run: () => beginText(id) },
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
        disabled: node?.shape === shape || node?.shape === 'group',
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
    if (!node || !box) return;
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
      options.apply(() => setNodeText(file, id, text), [id]);
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
      release.title = picked.length === 1 && at !== undefined && !canUnpin(file, at)
        && file.mode !== 'flow'
        ? '自由配置の図では外せない（外すと置き場所が無くなる）'
        : '手で決めた位置を捨て、レイアウトエンジンに返す';
    }
    if (aligners) aligners.hidden = picked.length < 2;
    for (const button of spreaders) button.disabled = picked.length < 3;
    if (!where) return;
    if (connecting !== undefined) {
      where.textContent = `${connecting} から線を引く先を選ぶ`;
      return;
    }
    const chosen = lineOf(line);
    if (chosen) {
      where.textContent = `${chosen.edge.from} → ${chosen.edge.to}  (線)`;
      if (hint) hint.textContent = '線の途中の○をドラッグすると曲がる / 端の○でつなぎ替え / Delete で消す';
      return;
    }
    if (hint) hint.textContent = HINT;
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
