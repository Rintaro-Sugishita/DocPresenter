// Turns a laid-out subtree into marks.
//
// Nothing here decides what anything looks like. The theme has already been
// applied by the browser, so every colour, weight and rule width is read back
// through `getComputedStyle` — which is the reason the PDF can share one theme
// with the HTML instead of reimplementing it.

import { mapPathData } from './plan.js';
import type { Item, TextItem } from './plan.js';

export interface Offset {
  readonly left: number;
  readonly top: number;
}

/**
 * A mark, with the top of the thing it belongs to. The vertical position is
 * kept alongside rather than derived from the mark, because a path's own
 * numbers do not say where its top is and a page break has to know.
 */
export interface Placed {
  readonly item: Item;
  readonly top: number;
  /**
   * The cell this mark belongs to, when that cell is merged down several rows.
   * A page break may fall inside such a cell, and the continuation has to say
   * what it is a continuation of.
   */
  readonly cell?: {
    readonly top: number; readonly bottom: number;
    /** What the text has to fit into, so a continuation can be dropped if it does not. */
    readonly room: number;
  };
}

/** Every mark inside `element`, in document pixels. */
export function collect(
  element: HTMLElement, left: number, top: number, diagnostics: string[],
): Placed[] {
  const at: Offset = { left, top };
  const items: Placed[] = [];
  walk(element, at, items, diagnostics);
  return items;
}

function walk(node: Element, at: Offset, items: Placed[], diagnostics: string[]): void {
  if (node instanceof SVGSVGElement) {
    // A drawing is one unit: every mark in it belongs to the drawing's top, so
    // it travels to a page whole rather than being cut through the middle.
    const top = rectOf(node, at).y;
    items.push(...svgItems(node, at).map(item => ({ item, top })));
    return;                                   // its contents are drawn, not walked
  }
  if (node instanceof HTMLImageElement) {
    const box = rectOf(node, at);
    if (node.currentSrc.startsWith('data:')) {
      items.push({ item: { kind: 'picture', ...box, data: node.currentSrc, ...marks(node) }, top: box.y });
    } else {
      diagnostics.push(`PDF に入れられない画像がある: ${node.currentSrc.slice(0, 60)}`);
    }
    return;
  }
  if (node instanceof HTMLElement) {
    for (const item of background(node, at)) {
      items.push({ item, top: item.kind === 'fill' ? item.y : rectOf(node, at).y });
    }
    for (const child of node.childNodes) {
      if (child instanceof Element) walk(child, at, items, diagnostics);
      else if (child instanceof Text) {
        const cell = mergedCell(node, at);
        for (const run of textRuns(child, node, at)) {
          items.push({ item: run, top: run.y - run.size, ...(cell ? { cell } : {}) });
        }
      }
    }
  }
}

/** The fill and the rules of one element. A border edge is a thin filled box. */
function background(element: HTMLElement, at: Offset): Item[] {
  const style = getComputedStyle(element);
  const box = rectOf(element, at);
  if (box.width <= 0 || box.height <= 0) return [];
  const items: Item[] = [];

  const fill = colourOf(style.backgroundColor);
  if (fill) items.push({ kind: 'fill', ...box, colour: fill, ...marks(element) });

  const edges: [string, string, string, { x: number; y: number; width: number; height: number }][] = [
    ['borderTopWidth', 'borderTopColor', 'borderTopStyle',
      { x: box.x, y: box.y, width: box.width, height: 0 }],
    ['borderBottomWidth', 'borderBottomColor', 'borderBottomStyle',
      { x: box.x, y: box.y + box.height, width: box.width, height: 0 }],
    ['borderLeftWidth', 'borderLeftColor', 'borderLeftStyle',
      { x: box.x, y: box.y, width: 0, height: box.height }],
    ['borderRightWidth', 'borderRightColor', 'borderRightStyle',
      { x: box.x + box.width, y: box.y, width: 0, height: box.height }],
  ];
  for (const [widthKey, colourKey, styleKey, edge] of edges) {
    const width = parseFloat(style[widthKey as 'borderTopWidth']);
    const colour = colourOf(style[colourKey as 'borderTopColor']);
    if (!(width > 0) || !colour || style[styleKey as 'borderTopStyle'] === 'none') continue;
    items.push({
      kind: 'fill', colour,
      x: edge.width === 0 ? edge.x - width / 2 : edge.x,
      y: edge.height === 0 ? edge.y - width / 2 : edge.y,
      width: edge.width === 0 ? width : edge.width,
      height: edge.height === 0 ? width : edge.height,
    });
  }
  return items;
}

/**
 * The runs of one text node. A run is a stretch on one line: the browser has
 * already decided where the line broke, and each run is placed where it put
 * it, so the PDF wraps exactly as the HTML does.
 */
function textRuns(node: Text, parent: HTMLElement, at: Offset): TextItem[] {
  if (node.data.trim() === '') return [];
  const style = getComputedStyle(parent);
  if (style.visibility === 'hidden' || style.display === 'none') return [];
  const size = parseFloat(style.fontSize);
  const colour = colourOf(style.color) ?? '#000000';
  const bold = Number(style.fontWeight) >= 600 || style.fontWeight === 'bold';
  const italic = style.fontStyle === 'italic';
  const mono = /mono/i.test(style.fontFamily);
  const ascent = ascentOf(style);
  const mark = marks(parent);

  const runs: TextItem[] = [];
  const range = document.createRange();
  let start = -1;
  let lineTop = 0;
  let x = 0;
  let right = 0;

  const flush = (end: number): void => {
    if (start < 0) return;
    const text = node.data.slice(start, end);
    if (text.trim() !== '') {
      runs.push({
        kind: 'text', text, x, y: lineTop + ascent, size, bold, italic, mono, colour,
        width: right - x, ...mark,
      });
    }
    start = -1;
  };

  for (let i = 0; i < node.data.length; i++) {
    // A newline inside a `<pre>` is a character with a position and no glyph.
    // Left in a run it reaches the font as a code point nothing can draw, and
    // is then reported as a missing glyph — which is true and useless.
    if (/[\n\r\t]/.test(node.data[i]!)) { flush(i); continue; }
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) { flush(i); continue; }
    const y = rect.top + window.scrollY - at.top;
    if (start < 0 || Math.abs(y - lineTop) > 1) {
      flush(i);
      start = i;
      lineTop = y;
      x = rect.left + window.scrollX - at.left;
    }
    right = rect.right + window.scrollX - at.left;
  }
  flush(node.data.length);
  return runs;
}

/**
 * How far below the top of a line box its baseline sits. Measured from the
 * font itself rather than guessed from the line height, because the two differ
 * for every face and the text would sit visibly wrong.
 */
const ASCENTS = new Map<string, number>();
function ascentOf(style: CSSStyleDeclaration): number {
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const known = ASCENTS.get(font);
  if (known !== undefined) return known;
  const context = document.createElement('canvas').getContext('2d');
  let ascent = parseFloat(style.fontSize) * 0.88;
  if (context) {
    context.font = font;
    const metrics = context.measureText('あA');
    if (metrics.fontBoundingBoxAscent) ascent = metrics.fontBoundingBoxAscent;
  }
  ASCENTS.set(font, ascent);
  return ascent;
}

/** The box of the merged cell this text is in, if it is in one. */
function mergedCell(
  element: HTMLElement, at: Offset,
): { top: number; bottom: number; room: number } | undefined {
  const cell = element.closest('td, th');
  if (!(cell instanceof HTMLTableCellElement) || cell.rowSpan <= 1) return undefined;
  const box = rectOf(cell, at);
  const style = getComputedStyle(cell);
  const room = box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return { top: box.y, bottom: box.y + box.height, room };
}

/** The source range an element carries, so the plan can point back at the file. */
function marks(element: Element): { span?: { start: number; end: number }; doc?: string } {
  const owner = element.closest('[data-span]');
  if (!owner) return {};
  const [start, end] = (owner.getAttribute('data-span') ?? '').split(',').map(Number);
  if (start === undefined || end === undefined || Number.isNaN(start)) return {};
  const doc = owner.getAttribute('data-doc');
  return { span: { start, end }, ...(doc ? { doc } : {}) };
}

function rectOf(element: Element, at: Offset): { x: number; y: number; width: number; height: number } {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + window.scrollX - at.left,
    y: rect.top + window.scrollY - at.top,
    width: rect.width, height: rect.height,
  };
}

// --- drawings -------------------------------------------------------------

/**
 * A drawing, read out of the SVG the browser has already laid out and styled.
 *
 * The drawing model could be asked for these shapes directly, but the theme
 * decides their colours in CSS — `.dp-class-pending`, `--dp-fill`, the dashed
 * line of a group — and resolving that a second time here would be a second
 * implementation of the theme. Reading the laid-out picture keeps one.
 */
function svgItems(svg: SVGSVGElement, at: Offset): Item[] {
  const items: Item[] = [];
  const mark = marks(svg);
  for (const element of svg.querySelectorAll('*')) {
    if (!(element instanceof SVGGraphicsElement)) continue;
    const matrix = element.getScreenCTM();
    if (!matrix) continue;
    const to = (x: number, y: number): { x: number; y: number } => ({
      x: matrix.a * x + matrix.c * y + matrix.e + window.scrollX - at.left,
      y: matrix.b * x + matrix.d * y + matrix.f + window.scrollY - at.top,
    });
    const scale = Math.abs(matrix.a);
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const fill = colourOf(style.fill);
    const stroke = colourOf(style.stroke);
    const lineWidth = parseFloat(style.strokeWidth || '1') * scale;
    const dash = style.strokeDasharray && style.strokeDasharray !== 'none'
      ? style.strokeDasharray.split(/[\s,]+/).map(v => parseFloat(v) * scale).filter(v => v > 0)
      : undefined;
    const paint = {
      ...(fill ? { fill } : {}), ...(stroke ? { stroke, lineWidth } : {}),
      ...(dash && dash.length ? { dash } : {}), ...mark,
    };

    if (element instanceof SVGTextContentElement && element.textContent) {
      items.push(...svgText(element, to, scale, style, mark));
      continue;
    }
    if (element instanceof SVGRectElement) {
      const x = element.x.baseVal.value;
      const y = element.y.baseVal.value;
      const w = element.width.baseVal.value;
      const h = element.height.baseVal.value;
      const r = element.rx.baseVal.value * scale;
      const a = to(x, y);
      const b = to(x + w, y + h);
      if (r > 0) {
        items.push({ kind: 'path', d: roundedRect(a.x, a.y, b.x - a.x, b.y - a.y, r), ...paint });
      } else {
        items.push({
          kind: 'shape', closed: true,
          points: [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], ...paint,
        });
      }
      continue;
    }
    if (element instanceof SVGEllipseElement || element instanceof SVGCircleElement) {
      const cx = 'cx' in element ? element.cx.baseVal.value : 0;
      const cy = 'cy' in element ? element.cy.baseVal.value : 0;
      const rx = element instanceof SVGEllipseElement
        ? element.rx.baseVal.value : element.r.baseVal.value;
      const ry = element instanceof SVGEllipseElement
        ? element.ry.baseVal.value : element.r.baseVal.value;
      const c = to(cx, cy);
      items.push({ kind: 'ellipse', cx: c.x, cy: c.y, rx: rx * scale, ry: ry * scale, ...paint });
      continue;
    }
    if (element instanceof SVGPolygonElement || element instanceof SVGPolylineElement) {
      const points = [...element.points].map(p => to(p.x, p.y));
      items.push({ kind: 'shape', points, closed: element instanceof SVGPolygonElement, ...paint });
      continue;
    }
    if (element instanceof SVGLineElement) {
      items.push({
        kind: 'shape', closed: false,
        points: [
          to(element.x1.baseVal.value, element.y1.baseVal.value),
          to(element.x2.baseVal.value, element.y2.baseVal.value),
        ], ...paint,
      });
      continue;
    }
    if (element instanceof SVGPathElement) {
      const d = element.getAttribute('d');
      if (d) items.push({ kind: 'path', d: mapPathData(d, to, scale), ...paint });
    }
  }
  return items;
}

/** A label inside a drawing. `text-anchor` is already in the reported position. */
function svgText(
  element: SVGTextContentElement,
  to: (x: number, y: number) => { x: number; y: number },
  scale: number, style: CSSStyleDeclaration,
  mark: ReturnType<typeof marks>,
): TextItem[] {
  // A `<text>` holding `<tspan>`s is drawn by the spans; drawing both doubles it.
  if (element.querySelector('tspan')) return [];
  const text = element.textContent ?? '';
  if (text.trim() === '') return [];
  let start: { x: number; y: number };
  try {
    const point = element.getStartPositionOfChar(0);
    start = to(point.x, point.y);
  } catch {
    const rect = element.getBoundingClientRect();
    start = { x: rect.left + window.scrollX, y: rect.bottom + window.scrollY };
  }
  const size = parseFloat(style.fontSize) * scale;
  return [{
    kind: 'text', text, x: start.x, y: start.y, size,
    bold: Number(style.fontWeight) >= 600, italic: style.fontStyle === 'italic',
    mono: /mono/i.test(style.fontFamily),
    colour: colourOf(style.fill) ?? '#000000',
    width: element.getComputedTextLength() * scale,
    ...mark,
  }];
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h / 2);
  return `M ${x + radius} ${y} L ${x + w - radius} ${y}`
    + ` A ${radius} ${radius} 0 0 1 ${x + w} ${y + radius}`
    + ` L ${x + w} ${y + h - radius}`
    + ` A ${radius} ${radius} 0 0 1 ${x + w - radius} ${y + h}`
    + ` L ${x + radius} ${y + h}`
    + ` A ${radius} ${radius} 0 0 1 ${x} ${y + h - radius}`
    + ` L ${x} ${y + radius}`
    + ` A ${radius} ${radius} 0 0 1 ${x + radius} ${y} Z`;
}

function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** `rgb(…)` as the browser reports it, or nothing when it paints nothing. */
export function colourOf(value: string): string | undefined {
  const text = value.trim();
  if (text === '' || text === 'none' || text === 'transparent') return undefined;
  const found = /^rgba?\(([^)]+)\)$/.exec(text);
  if (!found) return text.startsWith('#') ? text : undefined;
  const parts = found[1]!.split(/[\s,/]+/).filter(p => p !== '').map(Number);
  if (parts.length >= 4 && parts[3] === 0) return undefined;       // fully transparent
  const hex = parts.slice(0, 3)
    .map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  return `#${hex}`;
}
