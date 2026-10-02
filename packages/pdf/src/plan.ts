// What a page holds, with no HTML and no PDF in it.
//
// The pipeline has a seam here on purpose. On one side the browser lays the
// document out and something reads the result; on the other side the PDF is
// written from these numbers alone. The seam is plain data, so the writer can
// be tested without a browser and the measurement can be checked without
// reading a PDF — and the same plan will feed the source map a review comment
// anchors through.
//
// Coordinates are in points (1/72 inch), measured from the top-left of the
// page, y downwards — the way the browser reports them. The writer flips them
// for PDF, which counts from the bottom, in one place.

export interface Span {
  readonly start: number;
  readonly end: number;
}

interface Marked {
  /** The byte range in the source this mark came from. */
  readonly span?: Span;
  /** The file that range is in, when it is not the document itself. */
  readonly doc?: string;
}

/** Which of the theme's faces a run is set in. */
export type FontFamily = 'body' | 'heading' | 'mono';

export interface TextItem extends Marked {
  readonly kind: 'text';
  readonly text: string;
  /** Left edge and baseline. */
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly family: FontFamily;
  /** `#rrggbb`. */
  readonly colour: string;
  /** What the browser made the text this wide; the writer keeps it there. */
  readonly width?: number;
}

export interface FillItem extends Marked {
  readonly kind: 'fill';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly colour: string;
}

/** A polyline or polygon. Straight lines only; curves go through `path`. */
export interface ShapeItem extends Marked {
  readonly kind: 'shape';
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly closed: boolean;
  readonly fill?: string;
  readonly stroke?: string;
  readonly lineWidth?: number;
  readonly dash?: readonly number[];
  readonly radius?: number;
}

/** Anything with an arc in it, as SVG path data. */
export interface PathItem extends Marked {
  readonly kind: 'path';
  readonly d: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly lineWidth?: number;
}

export interface EllipseItem extends Marked {
  readonly kind: 'ellipse';
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly fill?: string;
  readonly stroke?: string;
  readonly lineWidth?: number;
}

export interface PictureItem extends Marked {
  readonly kind: 'picture';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** A `data:` URL. The writer decodes it; nothing here reads a file. */
  readonly data: string;
}

/**
 * Somewhere a link can land: an element that carries an `id`.
 *
 * It draws nothing. It travels with the marks so that it is cut to a page the
 * same way they are — a destination is a page and a height, and only the
 * pagination knows those.
 */
export interface AnchorItem extends Marked {
  readonly kind: 'anchor';
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A clickable area pointing at an `AnchorItem` elsewhere in the document. */
export interface LinkItem extends Marked {
  readonly kind: 'link';
  /** The `id` of the anchor it leads to. */
  readonly target: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type Item =
  | TextItem | FillItem | ShapeItem | PathItem | EllipseItem | PictureItem
  | AnchorItem | LinkItem;

export interface Page {
  readonly items: readonly Item[];
  /**
   * The paper this page is on, when it is not the document's. A table too wide
   * to read down the page is turned sideways, and one page of a PDF may be a
   * different shape from the one before it.
   */
  readonly width?: number;
  readonly height?: number;
}

/** One line of the document's structure, for the reader's bookmark pane. */
export interface OutlineEntry {
  /** 1 for a top-level section; nesting is read from this. */
  readonly level: number;
  /** As the reader sees it, number included. */
  readonly title: string;
  /** The anchor it leads to. */
  readonly id: string;
}

export interface PagePlan {
  readonly width: number;
  readonly height: number;
  readonly pages: readonly Page[];
  /** The sections, in reading order. Empty when the document has none. */
  readonly outline?: readonly OutlineEntry[];
  /** For the PDF's own metadata. */
  readonly title?: string;
  readonly subject?: string;
  readonly commit?: string;
}

/** Every character the plan needs a glyph for. */
export function codePointsOf(plan: PagePlan): Set<number> {
  const found = new Set<number>();
  for (const page of plan.pages) {
    for (const item of page.items) {
      if (item.kind !== 'text') continue;
      for (const character of item.text) found.add(character.codePointAt(0)!);
    }
  }
  return found;
}

/**
 * The characters each face has to carry. A document sets its prose in one face
 * and its headings in another, and cutting each one down to what it is actually
 * used for is the difference between a file of tens of kilobytes and one of
 * tens of megabytes.
 */
export function codePointsByFace(plan: PagePlan): Map<string, Set<number>> {
  const found = new Map<string, Set<number>>();
  for (const page of plan.pages) {
    for (const item of page.items) {
      if (item.kind !== 'text') continue;
      const face = faceOf(item);
      const set = found.get(face) ?? new Set<number>();
      for (const character of item.text) set.add(character.codePointAt(0)!);
      found.set(face, set);
    }
  }
  return found;
}

/** Which face a run is drawn in: the family, and bold as a face of its own. */
export function faceOf(item: TextItem): string {
  if (item.family === 'mono') return 'mono';
  return item.bold ? `${item.family}Bold` : item.family;
}

/**
 * Maps SVG path data through a point transform.
 *
 * The numbers in an arc are not all coordinates: two are radii, and three are
 * flags that mean nothing when multiplied. An earlier version scaled every
 * number in the string, which turned a sweep flag of 1 into 0.75 and left the
 * renderer reading the rest of the path off by one — visible as a shape whose
 * straight sides simply vanished. Only the commands the drawing renderer emits
 * are handled — move, line and arc, all absolute.
 */
export function mapPathData(
  d: string, to: (x: number, y: number) => { x: number; y: number }, scale: number,
): string {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const out: string[] = [];

  // Where the pen is, in the drawing's own coordinates. A relative command says
  // how far to go from here, so there is no way to map one without knowing
  // where here is — which is why they cannot simply be upper-cased.
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The last curve's second control point, reflected by `S` and `T`.
  let controlX = 0;
  let controlY = 0;
  let curved = '';

  const point = (px: number, py: number): string => {
    const mapped = to(px, py);
    return `${round(mapped.x)} ${round(mapped.y)}`;
  };

  let at = 0;
  let command = '';
  const take = (): number => Number(tokens[at++] ?? 0);

  while (at < tokens.length) {
    const token = tokens[at]!;
    if (/[A-Za-z]/.test(token)) { command = token; at++; }
    else if (command === '') { at++; continue; }
    // A repeated run of numbers continues the last command, and a repeated
    // `M` is a `L` — both are in the grammar and both appear in real files.
    const relative = command === command.toLowerCase();
    const kind = command.toUpperCase();

    if (kind === 'Z') {
      out.push('Z');
      x = startX; y = startY;
      curved = '';
      if (!/[A-Za-z]/.test(tokens[at] ?? 'A')) continue;
      continue;
    }
    if (kind === 'M' || kind === 'L') {
      const nx = (relative ? x : 0) + take();
      const ny = (relative ? y : 0) + take();
      out.push(kind === 'M' ? 'M' : 'L', point(nx, ny));
      if (kind === 'M') { startX = nx; startY = ny; command = relative ? 'l' : 'L'; }
      x = nx; y = ny;
      curved = '';
      continue;
    }
    if (kind === 'H' || kind === 'V') {
      const value = take();
      const nx = kind === 'H' ? (relative ? x : 0) + value : x;
      const ny = kind === 'V' ? (relative ? y : 0) + value : y;
      out.push('L', point(nx, ny));
      x = nx; y = ny;
      curved = '';
      continue;
    }
    if (kind === 'C' || kind === 'S') {
      const base = relative ? { x, y } : { x: 0, y: 0 };
      let c1x: number;
      let c1y: number;
      if (kind === 'C') {
        c1x = base.x + take();
        c1y = base.y + take();
      } else {
        // The first control point mirrors the previous curve's second one.
        c1x = curved === 'C' ? 2 * x - controlX : x;
        c1y = curved === 'C' ? 2 * y - controlY : y;
      }
      const c2x = base.x + take();
      const c2y = base.y + take();
      const nx = base.x + take();
      const ny = base.y + take();
      out.push('C', point(c1x, c1y), point(c2x, c2y), point(nx, ny));
      controlX = c2x; controlY = c2y;
      x = nx; y = ny;
      curved = 'C';
      continue;
    }
    if (kind === 'Q' || kind === 'T') {
      const base = relative ? { x, y } : { x: 0, y: 0 };
      let cx: number;
      let cy: number;
      if (kind === 'Q') {
        cx = base.x + take();
        cy = base.y + take();
      } else {
        cx = curved === 'Q' ? 2 * x - controlX : x;
        cy = curved === 'Q' ? 2 * y - controlY : y;
      }
      const nx = base.x + take();
      const ny = base.y + take();
      // Written as a cubic: the writer draws cubics, and the two are the same
      // curve with the control points moved two thirds of the way out.
      out.push('C',
        point(x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y)),
        point(nx + (2 / 3) * (cx - nx), ny + (2 / 3) * (cy - ny)),
        point(nx, ny));
      controlX = cx; controlY = cy;
      x = nx; y = ny;
      curved = 'Q';
      continue;
    }
    if (kind === 'A') {
      const rx = take();
      const ry = take();
      const angle = take();
      const large = take();
      const sweep = take();
      const nx = (relative ? x : 0) + take();
      const ny = (relative ? y : 0) + take();
      // Radii are lengths and the flags are flags: only the end point goes
      // through the transform, and only the radii are scaled.
      out.push('A', round(rx * scale), round(ry * scale),
        String(angle), String(large), String(sweep), point(nx, ny));
      x = nx; y = ny;
      curved = '';
      continue;
    }
    // Something this does not know. Skipping one number keeps the walk moving
    // rather than spinning on it.
    at++;
  }

  return out.join(' ');
}

function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}
