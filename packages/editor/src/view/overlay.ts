// Moving the callouts on a screenshot. The picture underneath is a binary that
// no diff can show, so the numbers and the wording are the whole reviewable
// part of the file — and where a number points is exactly the thing people
// argue about in a review. Dragging one writes one line.
//
// Unlike a drawing, an overlay is already on the page as HTML at the image's
// own scale, so this takes over what the renderer produced rather than drawing
// its own copy.

import type { Callout, DiagramFile } from '@docpresenter/core';
import type { Edit } from '../edit.js';
import { moveCallout } from '../diagram.js';

const STEP = 4;
const THRESHOLD = 3;

export interface OverlayEditorOptions {
  readonly owner: Document;
  readonly file: DiagramFile;
  /** The `.dgm` text. Edits are byte ranges in it. */
  readonly source: string;
  /** The figure's body, holding the rendered overlay. */
  readonly host: HTMLElement;
  /** The callouts picked. An overlay only ever picks one, but the canvas and
   *  the overlay are mounted through the same options. */
  readonly selected: readonly string[];
  readonly apply: (make: () => Edit, selected: readonly string[]) => void;
  readonly select: (markers: readonly string[]) => void;
  readonly showSource: () => void;
  readonly close: () => void;
  readonly onError?: (message: string) => void;
}

export interface OverlayEditor {
  focus(): void;
}

export function createOverlayEditor(options: OverlayEditorOptions): OverlayEditor {
  const { owner, file, source, host } = options;
  const stage = host.querySelector<HTMLElement>('.dp-overlay');
  // Pressing inside belongs to this editor, not to the page behind it.
  host.classList.add('dp-canvas-host');

  let selected = options.selected[0];
  let where: HTMLElement | undefined;
  const bar = createBar();
  host.prepend(bar);
  if (!stage) return { focus: () => {} };
  stage.tabIndex = 0;
  stage.classList.add('dp-overlay-editing');

  const byMarker = new Map(file.callouts.map(c => [c.marker, c]));
  const markerOf = (name: string): HTMLElement | null =>
    stage.querySelector(`.dp-callout[data-callout="${cssEscape(name)}"]`);
  const leaderOf = (name: string): SVGElement | null =>
    stage.querySelector(`.dp-callout-leader[data-callout="${cssEscape(name)}"]`);

  /** The handle for the end of the leader: editor chrome, added on top. */
  const handle = owner.createElement('span');
  handle.className = 'dp-callout-handle';
  handle.hidden = true;
  stage.append(handle);

  function paint(): void {
    for (const callout of file.callouts) {
      markerOf(callout.marker)?.classList.toggle('dp-picked', callout.marker === selected);
    }
    const at = selected === undefined ? undefined : byMarker.get(selected);
    handle.hidden = at === undefined;
    if (at) {
      handle.style.left = `${at.targetX}px`;
      handle.style.top = `${at.targetY}px`;
    }
    describe();
  }

  function describe(): void {
    if (!where) return;
    const at = selected === undefined ? undefined : byMarker.get(selected);
    where.textContent = at === undefined
      ? '注釈を選ぶ'
      : `${at.marker}  ${at.x}, ${at.y} → ${at.targetX}, ${at.targetY}`;
  }

  function pick(marker: string | undefined): void {
    selected = marker;
    options.select(marker === undefined ? [] : [marker]);
    paint();
  }

  // --- ドラッグ ----------------------------------------------------------

  interface Drag {
    readonly callout: Callout;
    readonly end: 'marker' | 'target';
    readonly from: { x: number; y: number };
    moved: boolean;
    at: { x: number; y: number; targetX: number; targetY: number };
  }
  let drag: Drag | undefined;

  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    const onHandle = target?.closest('.dp-callout-handle') != null;
    const name = onHandle ? selected : target?.closest<HTMLElement>('.dp-callout')?.dataset['callout'];
    event.preventDefault();
    event.stopPropagation();
    stage.focus({ preventScroll: true });

    if (name === undefined || name === null) { pick(undefined); return; }
    pick(name);
    const callout = byMarker.get(name);
    if (!callout) return;
    drag = {
      callout, end: onHandle ? 'target' : 'marker',
      from: { x: event.clientX, y: event.clientY },
      moved: false,
      at: { x: callout.x, y: callout.y, targetX: callout.targetX, targetY: callout.targetY },
    };
    stage.setPointerCapture(event.pointerId);
  });

  stage.addEventListener('pointermove', event => {
    const current = drag;
    if (!current) return;
    const dx = event.clientX - current.from.x;
    const dy = event.clientY - current.from.y;
    if (!current.moved && Math.hypot(dx, dy) < THRESHOLD) return;
    current.moved = true;
    const c = current.callout;
    current.at = current.end === 'marker'
      ? { x: round(c.x + dx), y: round(c.y + dy), targetX: c.targetX, targetY: c.targetY }
      : { x: c.x, y: c.y, targetX: round(c.targetX + dx), targetY: round(c.targetY + dy) };
    place(c.marker, current.at);
  });

  const finish = (event: PointerEvent): void => {
    const current = drag;
    if (!current) return;
    drag = undefined;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (!current.moved) return;
    const marker = current.callout.marker;
    options.apply(() => moveCallout(file, source, marker, current.at), [marker]);
  };
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);

  /**
   * Draws one callout where it is being dragged to. The leader is an SVG the
   * size of the box between the two ends, so moving either end resizes it —
   * the same arithmetic the renderer does, kept here so the line follows the
   * pointer instead of waiting for the write-back.
   */
  function place(
    name: string, at: { x: number; y: number; targetX: number; targetY: number },
  ): void {
    const marker = markerOf(name);
    if (marker) {
      marker.style.left = `${at.x}px`;
      marker.style.top = `${at.y}px`;
    }
    if (name === selected) {
      handle.style.left = `${at.targetX}px`;
      handle.style.top = `${at.targetY}px`;
    }
    const leader = leaderOf(name);
    if (leader) {
      const left = Math.min(at.x, at.targetX);
      const top = Math.min(at.y, at.targetY);
      const width = Math.max(1, Math.abs(at.targetX - at.x));
      const height = Math.max(1, Math.abs(at.targetY - at.y));
      leader.setAttribute('style', `left:${left}px;top:${top}px`);
      leader.setAttribute('width', String(width));
      leader.setAttribute('height', String(height));
      leader.setAttribute('viewBox', `0 0 ${width} ${height}`);
      const line = leader.querySelector('line');
      line?.setAttribute('x1', String(at.x - left));
      line?.setAttribute('y1', String(at.y - top));
      line?.setAttribute('x2', String(at.targetX - left));
      line?.setAttribute('y2', String(at.targetY - top));
    }
    if (where) {
      where.textContent = `${name}  ${at.x}, ${at.y} → ${at.targetX}, ${at.targetY}`;
    }
  }

  // --- キーボード --------------------------------------------------------

  stage.addEventListener('keydown', event => {
    const names = file.callouts.map(c => c.marker);
    if (event.key === 'Escape') { event.preventDefault(); options.close(); return; }
    if (event.key === 'Tab') {
      event.preventDefault();
      if (names.length === 0) return;
      const index = selected === undefined ? -1 : names.indexOf(selected);
      pick(names[(index + (event.shiftKey ? -1 : 1) + names.length * 2) % names.length]);
      return;
    }
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const move = step[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    const callout = selected === undefined ? undefined : byMarker.get(selected);
    if (!callout) return;
    const by = event.shiftKey ? 1 : STEP;
    const marker = callout.marker;
    // The marker moves; what it points at stays where it points.
    options.apply(() => moveCallout(file, source, marker, {
      x: callout.x + move[0]! * by, y: callout.y + move[1]! * by,
      targetX: callout.targetX, targetY: callout.targetY,
    }), [marker]);
  });

  function createBar(): HTMLElement {
    const node = owner.createElement('div');
    node.className = 'dp-canvas-bar';
    where = owner.createElement('span');
    where.className = 'dp-canvas-where';
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
    add('ソース', '.dgm のソースを直接編集する', () => options.showSource());

    const hint = owner.createElement('span');
    hint.className = 'dp-canvas-hint';
    hint.textContent = '丸をドラッグで移動 / 先端の点で指す位置 / 矢印キーで微調整';
    node.append(hint);
    return node;
  }

  paint();
  return { focus: () => stage.focus({ preventScroll: true }) };
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function round(value: number): number {
  return Math.round(value);
}
