// Zooming a drawing on screen.
//
// A drawing is printed at the width of the page, which is too small to read a
// large one. This lets the reader make it bigger (or smaller) where it stands:
// Ctrl/⌘ with the wheel or a pinch, or the buttons on its corner.
//
// The drawing's own width and height are changed rather than a CSS transform,
// so the frame around it scrolls by the right amount, and anything that
// measures the drawing on screen (the canvas turns screen pixels into drawing
// units from its bounding box) keeps measuring it right without being told.
//
// It is screen chrome only. Nothing here is written to a file, and the output
// never sees it: a PDF or a slide is laid out from the source, not from here.

import { DEFAULT_LOCALE, type Locale } from '../i18n.js';
import { BASE_MESSAGES } from '../messages.js';

/** The steps the buttons go through, in percent of the drawing's own size. */
export const ZOOM_STEPS = [25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400] as const;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/** A scale kept inside what the buttons offer. */
export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/** The next step up (`1`) or down (`-1`) from a scale that need not be a step. */
export function stepZoom(scale: number, direction: 1 | -1): number {
  const percent = scale * 100;
  if (direction > 0) {
    const next = ZOOM_STEPS.find(step => step > percent + 0.5);
    return (next ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!) / 100;
  }
  const lower = [...ZOOM_STEPS].reverse().find(step => step < percent - 0.5);
  return (lower ?? ZOOM_STEPS[0]) / 100;
}

/** The drawing's own size, from its viewBox (or its width and height). */
export function naturalSize(svg: Element): { width: number; height: number } | undefined {
  const box = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number);
  if (box && box.length === 4 && box[2]! > 0 && box[3]! > 0) return { width: box[2]!, height: box[3]! };
  const width = Number(svg.getAttribute('width'));
  const height = Number(svg.getAttribute('height'));
  return width > 0 && height > 0 ? { width, height } : undefined;
}

export interface ZoomOptions {
  readonly locale?: Locale | undefined;
  /** The scale to start at; undefined fits the drawing to the page as it is printed. */
  readonly initial?: number | undefined;
  /** Told whenever the scale changes, so it can be kept across redraws or saved. */
  readonly onChange?: ((scale: number | undefined) => void) | undefined;
  /**
   * Whether a plain drag pans. A canvas uses a drag to move shapes, so there
   * only Space with a drag, or the middle button, pans.
   */
  readonly plainDragPans?: boolean | undefined;
}

export interface Zoom {
  /** The buttons. Already on the frame; exposed so a host can move them. */
  readonly bar: HTMLElement;
  /** The scale now; undefined while the drawing fits the page. */
  get(): number | undefined;
  set(scale: number | undefined): void;
  /** Applies the scale again, to a drawing drawn anew inside the frame. */
  apply(): void;
  destroy(): void;
}

/**
 * Makes the drawing inside `frame` zoomable. The frame is what scrolls once
 * the drawing outgrows it; the buttons go on `host`, which holds the frame and
 * does not scroll, so they stay in its corner. `drawing` finds the drawing
 * each time, since a host may draw it anew; `apply()` after such a redraw puts
 * the scale back on.
 */
export function attachZoom(
  host: HTMLElement, frame: HTMLElement, drawing: () => SVGSVGElement | null, options: ZoomOptions = {},
): Zoom {
  const owner = frame.ownerDocument;
  const t = BASE_MESSAGES.in(options.locale ?? DEFAULT_LOCALE);
  let scale: number | undefined = options.initial === undefined ? undefined : clampZoom(options.initial);
  host.classList.add('dp-zoom-host');
  frame.classList.add('dp-zoom-frame');

  const bar = owner.createElement('span');
  bar.className = 'dp-zoom-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', t('base.zoom.label'));
  const button = (label: string, title: string, className: string, run: () => void): HTMLButtonElement => {
    const node = owner.createElement('button');
    node.type = 'button';
    node.className = className;
    node.textContent = label;
    node.title = title;
    // The figure under it opens an editor on a click; the bar is not the figure.
    node.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
    node.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); run(); });
    bar.append(node);
    return node;
  };
  button('−', t('base.zoom.out'), 'dp-zoom-out', () => set(stepZoom(current(), -1)));
  const reading = button('', t('base.zoom.reset'), 'dp-zoom-value', () => set(1));
  button('+', t('base.zoom.in'), 'dp-zoom-in', () => set(stepZoom(current(), 1)));
  const fit = button('⤢', t('base.zoom.fit'), 'dp-zoom-fit', () => set(undefined));
  host.append(bar);

  /** The scale the drawing is shown at, fitted or not. */
  function current(): number {
    if (scale !== undefined) return scale;
    const svg = drawing();
    const size = svg && naturalSize(svg);
    const shown = svg?.getBoundingClientRect().width ?? 0;
    return size && shown > 0 ? shown / size.width : 1;
  }

  function apply(): void {
    const svg = drawing();
    const size = svg && naturalSize(svg);
    frame.classList.toggle('dp-zoomed', scale !== undefined);
    host.classList.toggle('dp-zoomed', scale !== undefined);
    if (svg) {
      if (scale === undefined || !size) {
        svg.style.removeProperty('width');
        svg.style.removeProperty('height');
        svg.style.removeProperty('max-width');
      } else {
        svg.style.width = `${Math.round(size.width * scale)}px`;
        svg.style.height = `${Math.round(size.height * scale)}px`;
        svg.style.maxWidth = 'none';
      }
    }
    reading.textContent = `${Math.round(current() * 100)}%`;
    fit.setAttribute('aria-pressed', String(scale === undefined));
  }

  function set(next: number | undefined, around?: { x: number; y: number }): void {
    const before = current();
    const was = { left: frame.scrollLeft, top: frame.scrollTop };
    scale = next === undefined ? undefined : clampZoom(next);
    apply();
    // Zooming with the pointer keeps the point under it where it was.
    if (around && scale !== undefined) {
      const ratio = scale / before;
      const box = frame.getBoundingClientRect();
      const x = around.x - box.left;
      const y = around.y - box.top;
      frame.scrollLeft = (was.left + x) * ratio - x;
      frame.scrollTop = (was.top + y) * ratio - y;
    }
    options.onChange?.(scale);
  }

  const onWheel = (event: WheelEvent): void => {
    // A plain wheel scrolls the page, as it always has; only Ctrl/⌘ (and a
    // pinch, which browsers report as a wheel with Ctrl) zooms.
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0025));
    set(current() * factor, { x: event.clientX, y: event.clientY });
  };

  let space = false;
  let panning: { x: number; y: number; left: number; top: number } | undefined;
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === ' ' || event.code === 'Space') space = event.type === 'keydown';
  };
  const onDown = (event: PointerEvent): void => {
    if (scale === undefined) return;
    const wanted = event.button === 1 || (event.button === 0 && (space || options.plainDragPans === true));
    if (!wanted || (event.target as Element | null)?.closest?.('.dp-zoom-bar')) return;
    // A plain drag over a figure that opens on a click still opens it; a drag
    // only pans once it has moved.
    panning = { x: event.clientX, y: event.clientY, left: frame.scrollLeft, top: frame.scrollTop };
    if (event.button === 1 || space) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const onMove = (event: PointerEvent): void => {
    if (!panning) return;
    const dx = event.clientX - panning.x;
    const dy = event.clientY - panning.y;
    if (Math.abs(dx) + Math.abs(dy) < 4) return;
    frame.classList.add('dp-panning');
    frame.scrollLeft = panning.left - dx;
    frame.scrollTop = panning.top - dy;
  };
  const onUp = (): void => {
    if (!panning) return;
    panning = undefined;
    if (frame.classList.contains('dp-panning')) {
      // The click that ends a pan is not a click on the figure.
      const swallow = (event: Event): void => { event.stopPropagation(); event.preventDefault(); };
      owner.addEventListener('click', swallow, { capture: true, once: true });
      owner.defaultView?.setTimeout(() => owner.removeEventListener('click', swallow, { capture: true }), 0);
    }
    frame.classList.remove('dp-panning');
  };

  host.addEventListener('wheel', onWheel, { passive: false });
  frame.addEventListener('pointerdown', onDown, { capture: true });
  owner.addEventListener('pointermove', onMove);
  owner.addEventListener('pointerup', onUp);
  owner.addEventListener('keydown', onKey);
  owner.addEventListener('keyup', onKey);
  apply();

  return {
    bar,
    get: () => scale,
    set: next => set(next),
    apply,
    destroy() {
      host.removeEventListener('wheel', onWheel);
      frame.removeEventListener('pointerdown', onDown, { capture: true });
      owner.removeEventListener('pointermove', onMove);
      owner.removeEventListener('pointerup', onUp);
      owner.removeEventListener('keydown', onKey);
      owner.removeEventListener('keyup', onKey);
      bar.remove();
      frame.classList.remove('dp-zoom-frame', 'dp-zoomed', 'dp-panning');
      host.classList.remove('dp-zoom-host', 'dp-zoomed');
    },
  };
}

/** How the frame and its buttons look. Shared by every screen that zooms. */
export const ZOOM_STYLE = `
.dp-zoom-host { position: relative; }
.dp-zoom-frame.dp-zoomed { overflow: auto; max-height: 85vh; }
.dp-zoom-frame.dp-panning { cursor: grabbing; user-select: none; }
.dp-zoom-bar {
  position: absolute; top: 4px; right: 4px; z-index: 3;
  display: inline-flex; gap: 1px;
  background: rgba(45,49,56,.88); border-radius: 4px; padding: 2px;
  font-family: system-ui, sans-serif; font-size: 12px; line-height: 1;
  opacity: 0; transition: opacity .12s;
}
.dp-zoom-host:hover > .dp-zoom-bar, .dp-zoom-host.dp-zoomed > .dp-zoom-bar,
.dp-zoom-bar:focus-within { opacity: 1; }
.dp-zoom-bar button {
  border: none; background: transparent; color: #e6e8eb; cursor: pointer;
  padding: 0.4em 0.55em; border-radius: 3px; font: inherit; min-width: 2em;
}
.dp-zoom-bar button:hover { background: #454b54; }
.dp-zoom-bar .dp-zoom-value { min-width: 3.4em; }
.dp-zoom-bar button[aria-pressed="true"] { background: #fff; color: #1c1f24; }
@media print { .dp-zoom-bar { display: none; } }
`;
