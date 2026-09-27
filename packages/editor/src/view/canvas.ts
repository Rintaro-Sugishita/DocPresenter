// Direct manipulation of a diagram. The drawing on screen is the drawing the
// renderer produces — the editor adds an outline, a handle and the guides, and
// nothing else — so what is dragged is what a reader will see.
//
// A drag is not a new kind of state: it ends as one pin, which is one line of
// the layout section. Automatic layout keeps the rest, which is the whole point
// of the three-layer model: the mouse is for the exceptions.

import { layOutDiagram, type Box, type DiagramFile, type ShapeKind } from '@docpresenter/core';
import { renderDiagram } from '@docpresenter/render';
import type { Edit } from '../edit.js';
import {
  addNode, canUnpin, connectNodes, groupMembers, groupNodes, nextShapeId, pinNode, pinNodes,
  removeNodes, setNodeShape, setNodeText, unpinNode,
} from '../diagram.js';
import { createMenu, type MenuItem } from './menu.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** How far a shape's edge may be from another's to be pulled into line. */
const SNAP = 5;
/** What a free coordinate is rounded to, so a diff shows round numbers. */
const GRID = 4;
/** A press this short of a move is a selection, not a drag. */
const THRESHOLD = 3;
const MIN_SIZE = 16;

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
];

export interface CanvasOptions {
  readonly owner: Document;
  readonly file: DiagramFile;
  /** The `.dgm` text. Edits are byte ranges in it. */
  readonly source: string;
  /** The shapes picked, in the order they were picked. */
  readonly selected: readonly string[];
  /** Runs one edit; the caller re-renders and mounts the canvas again. */
  readonly apply: (make: () => Edit, selected: readonly string[]) => void;
  /** Remembers the selection without writing anything. */
  readonly select: (ids: readonly string[]) => void;
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

  // Declared up here because the bar is built before the code below runs, and
  // a `let` reached early is an error rather than an empty box.
  let where: HTMLElement | undefined;
  let release: HTMLButtonElement | undefined;

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

    for (const id of picked) {
      const box = id === primary() ? preview?.box ?? boxOf(id) : shifted(id);
      if (!box) continue;
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
    if (ids.length === picked.length && ids.every((id, i) => picked[i] === id)) return;
    picked = [...ids];
    options.select(picked);
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

  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    const onHandle = target?.closest('.dp-canvas-handle') != null && picked.length === 1;
    const id = onHandle ? primary() : target?.closest('[data-node]')?.getAttribute('data-node');

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
      band = { from: pointIn(event), to: pointIn(event) };
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

    if (band) {
      band = { from: band.from, to: pointIn(event) };
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
    return PALETTE.map(([shape, label]) => ({
      label: `＋ ${label}`,
      run: () => addShape(shape, event),
    }));
  }

  function addShape(shape: ShapeKind, event?: MouseEvent): void {
    // A freely placed drawing has no engine to decide where a shape goes, so
    // the new one is pinned: at the pointer if it came from the drawing, and
    // under the drawing otherwise.
    const at = file.mode === 'free'
      ? (event ? pointIn(event) : emptySpot())
      : undefined;
    // Selected as soon as it exists, so the next gesture — dragging it, or
    // typing over its text — lands on the shape just added.
    options.apply(
      () => addNode(file, source, { shape, text: '図形', at }),
      [nextShapeId(file, shape)],
    );
  }

  /** The point a press landed on, in the file's coordinates. */
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
        separated: shape === PALETTE[0]![0],
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
    input.style.left = `${rect.left - stageAt.left + box.x * factor}px`;
    input.style.top = `${rect.top - stageAt.top + box.y * factor}px`;
    input.style.width = `${box.width * factor}px`;
    input.style.height = `${box.height * factor}px`;
    stage.append(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (keep: boolean): void => {
      if (done) return;
      done = true;
      const text = input.value;
      input.remove();
      stage.focus({ preventScroll: true });
      if (!keep || text === node.text) return;
      options.apply(() => setNodeText(file, id, text), [id]);
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
    if (!where) return;
    if (connecting !== undefined) {
      where.textContent = `${connecting} から線を引く先を選ぶ`;
      return;
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

    add('＋ 図形', 'この図に図形を足す', () => {
      const at = bar.getBoundingClientRect();
      menu.open(at.left + 8, at.bottom + 4, PALETTE.map(([shape, label]) => ({
        label: `＋ ${label}`,
        run: () => addShape(shape),
      })));
    });
    release = add('自動配置に戻す', '手で決めた位置を捨て、レイアウトエンジンに返す', () => {
      const id = primary();
      if (id === undefined || picked.length !== 1) return;
      options.apply(() => unpinNode(file, source, id), [id]);
    });
    add('ソース', '.dgm のソースを直接編集する', () => options.showSource());

    const hint = element('span', 'dp-canvas-hint');
    hint.textContent = 'ドラッグで移動 / 右下で大きさ / ダブルクリックで文字 / 右クリックで操作';
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
