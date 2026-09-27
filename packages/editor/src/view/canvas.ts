// Direct manipulation of a diagram. The drawing on screen is the drawing the
// renderer produces — the editor adds an outline, a handle and the guides, and
// nothing else — so what is dragged is what a reader will see.
//
// A drag is not a new kind of state: it ends as one pin, which is one line of
// the layout section. Automatic layout keeps the rest, which is the whole point
// of the three-layer model: the mouse is for the exceptions.

import { layOutDiagram, type Box, type DiagramFile } from '@docpresenter/core';
import { renderDiagram } from '@docpresenter/render';
import type { Edit } from '../edit.js';
import { pinNode, unpinNode } from '../diagram.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** How far a shape's edge may be from another's to be pulled into line. */
const SNAP = 5;
/** What a free coordinate is rounded to, so a diff shows round numbers. */
const GRID = 4;
/** A press this short of a move is a selection, not a drag. */
const THRESHOLD = 3;
const MIN_SIZE = 16;

export interface CanvasOptions {
  readonly owner: Document;
  readonly file: DiagramFile;
  /** The `.dgm` text. Edits are byte ranges in it. */
  readonly source: string;
  readonly selected: string | undefined;
  /** Runs one edit; the caller re-renders and mounts the canvas again. */
  readonly apply: (make: () => Edit, selected: string | undefined) => void;
  /** Remembers the selection without writing anything. */
  readonly select: (id: string | undefined) => void;
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
  let selected = options.selected !== undefined && laid.boxes.has(options.selected)
    ? options.selected : undefined;

  // Declared up here because the bar is built before the code below runs, and
  // a `let` reached early is an error rather than an empty box.
  let where: HTMLElement | undefined;

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
    const box = preview?.box ?? boxOf(selected);
    if (!box) return;

    const outline = shape('rect', 'dp-canvas-outline');
    place(outline, box);
    overlay.append(outline);

    // The handle is drawn at a fixed size on screen, so it stays grabbable on
    // a drawing the pane had to shrink.
    const size = 9 / scale();
    const handle = shape('rect', 'dp-canvas-handle');
    handle.setAttribute('x', String(box.x + box.width - size / 2));
    handle.setAttribute('y', String(box.y + box.height - size / 2));
    handle.setAttribute('width', String(size));
    handle.setAttribute('height', String(size));
    overlay.append(handle);

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

  function pick(id: string | undefined): void {
    if (selected === id) return;
    selected = id;
    options.select(id);
    describe();
    paint();
  }

  // --- ドラッグ ----------------------------------------------------------

  interface Drag {
    readonly id: string;
    readonly kind: 'move' | 'resize';
    readonly from: { x: number; y: number };
    readonly box: Box;
    moved: boolean;
    pin: { x: number; y: number; width?: number; height?: number };
  }
  let drag: Drag | undefined;

  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    const onHandle = target?.closest('.dp-canvas-handle') != null && selected !== undefined;
    const id = onHandle ? selected : target?.closest('[data-node]')?.getAttribute('data-node');

    // Keep the press: it belongs to the canvas, not to the page behind it.
    event.preventDefault();
    event.stopPropagation();
    stage.focus();

    if (id === undefined || id === null) { pick(undefined); return; }
    pick(id);

    const box = boxOf(id);
    if (!box) return;
    if (!movable(id)) return;
    drag = {
      id, kind: onHandle ? 'resize' : 'move',
      from: { x: event.clientX, y: event.clientY },
      box, moved: false,
      pin: { x: box.x - laid.origin.x, y: box.y - laid.origin.y },
    };
    stage.setPointerCapture(event.pointerId);
  });

  /**
   * A group's box is computed from what it contains, so dragging one would be
   * dragging a result. A group the author already pinned is theirs to move.
   */
  function movable(id: string): boolean {
    const node = file.nodes.find(n => n.id === id);
    if (node?.shape !== 'group' || file.layout.has(id)) return true;
    options.onError?.(`${id} は中身に合わせて自動で決まる（先に位置を固定する）`);
    return false;
  }

  stage.addEventListener('pointermove', event => {
    const current = drag;
    if (!current) return;
    const factor = scale();
    const dx = (event.clientX - current.from.x) / factor;
    const dy = (event.clientY - current.from.y) / factor;
    if (!current.moved && Math.hypot(dx, dy) * factor < THRESHOLD) return;
    current.moved = true;
    drawing.classList.add('dp-canvas-dragging');

    const box = current.box;
    if (current.kind === 'move') {
      const snapped = snap(box.x + dx, box.y + dy, box.width, box.height, current.id);
      current.pin = { x: snapped.x - laid.origin.x, y: snapped.y - laid.origin.y };
      preview = { box: { ...box, x: snapped.x, y: snapped.y }, guides: snapped.guides };
      // The shape itself follows the pointer; its connections are re-routed
      // when it lands, which is why they fade rather than stretch.
      const node = drawing.querySelector(`[data-node="${cssEscape(current.id)}"]`);
      node?.setAttribute('transform', `translate(${snapped.x - box.x}, ${snapped.y - box.y})`);
    } else {
      const width = Math.max(MIN_SIZE, round(box.width + dx));
      const height = Math.max(MIN_SIZE, round(box.height + dy));
      current.pin = { x: box.x - laid.origin.x, y: box.y - laid.origin.y, width, height };
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
    if (!current.moved) { preview = undefined; paint(); return; }
    const pin = current.pin;
    // The redraw that follows builds the canvas again, so the preview is left
    // in place: taking it off first would show the shape jumping back.
    options.apply(() => pinNode(file, source, current.id, pin), current.id);
  };
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);

  /**
   * Pulls an edge, a centre or a midline into line with another shape's. This
   * is what makes a drawn screen look drawn rather than sprinkled; a coordinate
   * that lines up with nothing falls back to a round number.
   */
  function snap(
    x: number, y: number, width: number, height: number, id: string,
  ): { x: number; y: number; guides: { axis: 'x' | 'y'; at: number }[] } {
    const others = [...laid.boxes].filter(([other]) => other !== id).map(([, box]) => box);
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

  // --- キーボード --------------------------------------------------------
  //
  // Everything the mouse does, the keyboard does too. A shape nudged by 4 is
  // still the same one line of the file.

  stage.addEventListener('keydown', event => {
    const ids = [...laid.boxes.keys()];
    if (event.key === 'Escape') {
      event.preventDefault();
      options.close();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      if (ids.length === 0) return;
      const index = selected === undefined ? -1 : ids.indexOf(selected);
      const step = event.shiftKey ? -1 : 1;
      pick(ids[(index + step + ids.length * 2) % ids.length]);
      return;
    }
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const move = step[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    const box = boxOf(selected);
    if (!box || selected === undefined || !movable(selected)) return;
    // Shift is the fine adjustment: one unit, for the last pixel of a screen.
    const by = event.shiftKey ? 1 : GRID;
    const id = selected;
    options.apply(() => pinNode(file, source, id, {
      x: box.x - laid.origin.x + move[0]! * by,
      y: box.y - laid.origin.y + move[1]! * by,
    }), id);
  });

  // --- 操作列 ------------------------------------------------------------

  function describe(): void {
    if (!where) return;
    const box = preview?.box ?? boxOf(selected);
    if (selected === undefined || !box) {
      where.textContent = '図形を選ぶ';
      return;
    }
    const pinned = file.layout.has(selected) ? '固定' : '自動';
    where.textContent = `${selected}  ${round(box.x - laid.origin.x)}, `
      + `${round(box.y - laid.origin.y)}  ${round(box.width)}×${round(box.height)}  (${pinned})`;
  }

  function createBar(): HTMLElement {
    const node = element('div', 'dp-canvas-bar');
    where = element('span', 'dp-canvas-where');
    node.append(where);

    const add = (label: string, title: string, run: () => void): void => {
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
    };

    add('自動配置に戻す', '手で決めた位置を捨て、レイアウトエンジンに返す', () => {
      const id = selected;
      if (id === undefined) return;
      if (!file.layout.has(id)) { options.onError?.(`${id} は自動配置のまま`); return; }
      options.apply(() => unpinNode(file, source, id), id);
    });
    add('ソース', '.dgm のソースを直接編集する', () => options.showSource());

    const hint = element('span', 'dp-canvas-hint');
    hint.textContent = 'ドラッグで移動 / 右下で大きさ / 矢印キーで微調整（Shift で 1）';
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
