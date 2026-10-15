// The geometry of a drawing, with no output format in it.
//
// There are two renderers — SVG for the screen and HTML, and the PDF writer
// that draws the same diagram onto a page — and there will be a third for
// PPTX. What they must agree on is where things are: a shape's outline, where
// a line leaves it, where the arrowhead sits, where the label's baselines
// fall. That agreement is this file. Each renderer turns these numbers into
// its own marks and nothing else.

import type { Box } from '../layout.js';
import type { Point, ShapeKind } from '../model.js';

export const LINE_HEIGHT = 20;
export const ARROW_LENGTH = 10;
export const ARROW_HALF_WIDTH = 4;
/** How far the slanted side of a trapezoid or a hexagon comes in. */
export const NOTE_FOLD = 14;

/** One mark of a shape's outline. */
export type Outline =
  | { readonly kind: 'rect'; readonly x: number; readonly y: number;
      readonly width: number; readonly height: number; readonly radius: number }
  | { readonly kind: 'ellipse'; readonly cx: number; readonly cy: number;
      readonly rx: number; readonly ry: number }
  | { readonly kind: 'polygon'; readonly points: readonly Point[] }
  /** Anything with an arc in it, as SVG path data — both renderers speak it. */
  | { readonly kind: 'path'; readonly d: string };

export interface ShapePart {
  readonly outline: Outline;
  /**
   * A mark that is not the body itself: a cylinder's lid and a note's folded
   * corner are stroked on top of it, an arrowhead is filled with the line's
   * own colour. The renderer names each one so the theme can tell them apart.
   */
  readonly detail?: 'lid' | 'fold' | 'arrow';
}

/**
 * How a line on its own is drawn: which way it leans, and which ends it points.
 *
 * Both are look rather than meaning, so both arrive from the style layer — the
 * same place the colour and the thickness come from. A part can therefore carry
 * them, which is what makes "the arrow we point things out with" a thing a
 * library can name.
 */
export interface LineLook {
  readonly arrow: 'none' | 'start' | 'end' | 'both';
  /**
   * `down` runs from the box's top-left corner to its bottom-right, `up` from
   * the bottom-left to the top-right. A box has two diagonals and a line can
   * only be one of them; neither is a matter of where the box is.
   */
  readonly slope: 'down' | 'up';
}

export const PLAIN_LINE: LineLook = { arrow: 'none', slope: 'down' };

/** The marks that make up a shape. Empty for `text`, which is only its label. */
export function shapeOutlines(
  shape: ShapeKind, box: Box, look: LineLook = PLAIN_LINE,
): readonly ShapePart[] {
  const { x, y, width: w, height: h } = box;
  switch (shape) {
    case 'rect':       return [{ outline: { kind: 'rect', x, y, width: w, height: h, radius: 0 } }];
    case 'group':      return [{ outline: { kind: 'rect', x, y, width: w, height: h, radius: 4 } }];
    case 'round-rect': return [{ outline: { kind: 'rect', x, y, width: w, height: h, radius: 8 } }];
    case 'stadium':    return [{ outline: { kind: 'rect', x, y, width: w, height: h, radius: h / 2 } }];
    case 'ellipse':
      return [{ outline: { kind: 'ellipse', cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 } }];
    case 'diamond':
      return [polygon([
        { x: x + w / 2, y }, { x: x + w, y: y + h / 2 },
        { x: x + w / 2, y: y + h }, { x, y: y + h / 2 },
      ])];
    case 'parallelogram': {
      const slant = slantOf(w);
      return [polygon([
        { x: x + slant, y }, { x: x + w, y },
        { x: x + w - slant, y: y + h }, { x, y: y + h },
      ])];
    }
    case 'hexagon': {
      const cut = slantOf(w);
      return [polygon([
        { x: x + cut, y }, { x: x + w - cut, y }, { x: x + w, y: y + h / 2 },
        { x: x + w - cut, y: y + h }, { x: x + cut, y: y + h }, { x, y: y + h / 2 },
      ])];
    }
    // The two ends of a loop. Read as a pair, so they are mirror images: the
    // one that opens a loop narrows at the top, the one that closes it at the
    // bottom.
    case 'loop-start': {
      const cut = slantOf(w);
      return [polygon([
        { x: x + cut, y }, { x: x + w - cut, y }, { x: x + w, y: y + h }, { x, y: y + h },
      ])];
    }
    case 'loop-end': {
      const cut = slantOf(w);
      return [polygon([
        { x, y }, { x: x + w, y }, { x: x + w - cut, y: y + h }, { x: x + cut, y: y + h },
      ])];
    }
    case 'cylinder': {
      const ry = cylinderRadius(h);
      return [
        { outline: { kind: 'path', d:
          `M ${n(x)} ${n(y + ry)}`
          + ` A ${n(w / 2)} ${n(ry)} 0 0 1 ${n(x + w)} ${n(y + ry)}`
          + ` L ${n(x + w)} ${n(y + h - ry)}`
          + ` A ${n(w / 2)} ${n(ry)} 0 0 1 ${n(x)} ${n(y + h - ry)} Z` } },
        { detail: 'lid', outline: { kind: 'path', d:
          `M ${n(x)} ${n(y + ry)} A ${n(w / 2)} ${n(ry)} 0 0 0 ${n(x + w)} ${n(y + ry)}` } },
      ];
    }
    case 'note': {
      const fold = NOTE_FOLD;
      return [
        { outline: { kind: 'path', d:
          `M ${n(x)} ${n(y)} L ${n(x + w - fold)} ${n(y)} L ${n(x + w)} ${n(y + fold)}`
          + ` L ${n(x + w)} ${n(y + h)} L ${n(x)} ${n(y + h)} Z` } },
        { detail: 'fold', outline: { kind: 'path', d:
          `M ${n(x + w - fold)} ${n(y)}`
          + ` L ${n(x + w - fold)} ${n(y + fold)} L ${n(x + w)} ${n(y + fold)}` } },
      ];
    }
    case 'text':
      // Nothing is drawn: the label is the shape.
      return [];
    // A line is the one shape with no inside, so it is the one shape drawn as a
    // stroke from corner to corner rather than as an outline around the box.
    case 'line': {
      const [from, to] = look.slope === 'up'
        ? [{ x, y: y + h }, { x: x + w, y }]
        : [{ x, y }, { x: x + w, y: y + h }];
      return [
        { outline: { kind: 'path', d: `M ${n(from.x)} ${n(from.y)} L ${n(to.x)} ${n(to.y)}` } },
        ...(look.arrow === 'end' || look.arrow === 'both' ? [head(from, to)] : []),
        ...(look.arrow === 'start' || look.arrow === 'both' ? [head(to, from)] : []),
      ];
    }
  }
}

/** The arrowhead at one end of a line, as a mark of the shape itself. */
function head(from: Point, to: Point): ShapePart {
  return { detail: 'arrow', outline: { kind: 'polygon', points: arrowHead(from, to) } };
}

function polygon(points: readonly Point[]): ShapePart {
  return { outline: { kind: 'polygon', points } };
}

export function slantOf(width: number): number {
  return Math.min(18, width / 6);
}

/** How deep the lid of a cylinder is. The body and the text both need it. */
export function cylinderRadius(height: number): number {
  return Math.min(12, height / 4);
}

export type Anchor = 'start' | 'middle' | 'end';

export interface LabelLayout {
  readonly x: number;
  readonly anchor: Anchor;
  /** The middle of the first line. Lines are `LINE_HEIGHT` apart. */
  readonly top: number;
  readonly lineHeight: number;
}

/**
 * Where a shape's label sits. Centred unless the author said otherwise: a box
 * in a flowchart is centred; a label on a screen mock-up is not, and a screen
 * made of centred labels reads as nothing anyone would build.
 */
export function labelLayout(
  box: Box, align: string | undefined, shape: ShapeKind, pictureHeight = 0,
): LabelLayout {
  const anchor: Anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
  const inset = 8;
  const x = anchor === 'start' ? box.x + inset
    : anchor === 'end' ? box.x + box.width - inset
    : box.x + box.width / 2;
  // A cylinder's lid takes the top of the box, so the middle of the box is not
  // the middle of the space the text has. Centring there runs the text into
  // the curve.
  const lid = shape === 'cylinder' ? cylinderRadius(box.height) : 0;
  // A part's name sits under its picture, which is where a network drawing
  // puts it; everything else centres in its shape.
  const top = pictureHeight > 0
    ? box.y + Math.max(0, (box.height - LINE_HEIGHT * box.lines.length - pictureHeight) / 2)
      + pictureHeight + LINE_HEIGHT * 0.65
    : box.y + (box.height + lid) / 2 - ((box.lines.length - 1) * LINE_HEIGHT) / 2;
  return { x, anchor, top, lineHeight: LINE_HEIGHT };
}

/** Where the line from the centre towards `towards` leaves the shape. */
export function border(box: Box, shape: ShapeKind, towards: Point, from?: Point): Point {
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // A line that does not start at the centre — one of two drawn side by side
  // between the same shapes — leaves along its own course, not along the ray
  // from the centre, or it would kink as it reached the outline.
  if (from && (Math.abs(from.x - c.x) > 0.5 || Math.abs(from.y - c.y) > 0.5)) {
    return exitPoint(box, shape, from, towards);
  }
  const dx = towards.x - c.x;
  const dy = towards.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const rx = box.width / 2;
  const ry = box.height / 2;

  let t: number;
  if (shape === 'ellipse') {
    t = 1 / Math.hypot(dx / rx, dy / ry);
  } else if (shape === 'diamond') {
    t = 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry);
  } else {
    t = Math.min(rx / Math.abs(dx || Number.EPSILON), ry / Math.abs(dy || Number.EPSILON));
  }
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/**
 * Where the segment from `from` (inside the shape) towards `towards` crosses
 * its outline. A rectangle is solved exactly; the round and pointed outlines
 * are found by halving, which is exact to well under a pixel.
 */
function exitPoint(box: Box, shape: ShapeKind, from: Point, towards: Point): Point {
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const rx = box.width / 2;
  const ry = box.height / 2;
  const inside = (p: Point): boolean => {
    const dx = Math.abs(p.x - c.x) / rx;
    const dy = Math.abs(p.y - c.y) / ry;
    if (shape === 'ellipse') return dx * dx + dy * dy <= 1;
    if (shape === 'diamond') return dx + dy <= 1;
    return dx <= 1 && dy <= 1;
  };
  if (!inside(from)) return from;
  let lo = 0;
  let hi = 1;
  const at = (t: number): Point => ({ x: from.x + (towards.x - from.x) * t, y: from.y + (towards.y - from.y) * t });
  if (inside(at(hi))) return at(hi);
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (inside(at(mid))) lo = mid; else hi = mid;
  }
  return at(lo);
}

/** The three corners of the arrowhead at the end of a line. */
export function arrowHead(start: Point, end: Point): readonly Point[] {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const back = {
    x: end.x - Math.cos(angle) * ARROW_LENGTH,
    y: end.y - Math.sin(angle) * ARROW_LENGTH,
  };
  const nx = -Math.sin(angle) * ARROW_HALF_WIDTH;
  const ny = Math.cos(angle) * ARROW_HALF_WIDTH;
  return [end, { x: back.x + nx, y: back.y + ny }, { x: back.x - nx, y: back.y - ny }];
}

/** How far back from a corner a connection in a flow starts to turn. */
export const CORNER_RADIUS = 8;

/**
 * A connection through its corners, as SVG path data with each corner turned
 * on a short curve. Only the drawing is rounded: the corners are still the
 * points the route and the file hold. A corner on a short segment turns
 * tighter, so two turns never overlap and the ends stay where they were.
 */
export function roundedPath(points: readonly Point[], radius = CORNER_RADIUS): string {
  if (points.length === 0) return '';
  const parts = [`M ${n(points[0]!.x)} ${n(points[0]!.y)}`];
  for (let i = 1; i + 1 < points.length; i++) {
    const before = points[i - 1]!;
    const corner = points[i]!;
    const after = points[i + 1]!;
    const inLength = Math.hypot(corner.x - before.x, corner.y - before.y);
    const outLength = Math.hypot(after.x - corner.x, after.y - corner.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (r <= 0) { parts.push(`L ${n(corner.x)} ${n(corner.y)}`); continue; }
    const start = {
      x: corner.x - ((corner.x - before.x) / inLength) * r,
      y: corner.y - ((corner.y - before.y) / inLength) * r,
    };
    const end = {
      x: corner.x + ((after.x - corner.x) / outLength) * r,
      y: corner.y + ((after.y - corner.y) / outLength) * r,
    };
    parts.push(`L ${n(start.x)} ${n(start.y)}`,
      `Q ${n(corner.x)} ${n(corner.y)} ${n(end.x)} ${n(end.y)}`);
  }
  const last = points[points.length - 1]!;
  parts.push(`L ${n(last.x)} ${n(last.y)}`);
  return parts.join(' ');
}

/** Coordinates are rounded: a diff of a rendered SVG should stay readable. */
export function n(value: number): string {
  return String(Math.round(value * 100) / 100);
}
