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

export type Item = TextItem | FillItem | ShapeItem | PathItem | EllipseItem | PictureItem;

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

export interface PagePlan {
  readonly width: number;
  readonly height: number;
  readonly pages: readonly Page[];
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
  let command = '';
  let numbers: number[] = [];

  const emit = (): void => {
    if (command === '') return;
    if (command === 'M' || command === 'L') {
      for (let i = 0; i + 1 < numbers.length; i += 2) {
        const point = to(numbers[i]!, numbers[i + 1]!);
        out.push(i === 0 ? command : 'L', round(point.x), round(point.y));
      }
    } else if (command === 'A') {
      for (let i = 0; i + 6 < numbers.length; i += 7) {
        const point = to(numbers[i + 5]!, numbers[i + 6]!);
        out.push('A', round(numbers[i]! * scale), round(numbers[i + 1]! * scale),
          String(numbers[i + 2]), String(numbers[i + 3]), String(numbers[i + 4]),
          round(point.x), round(point.y));
      }
    } else if (command === 'Z') {
      out.push('Z');
    }
    numbers = [];
  };

  for (const token of tokens) {
    if (/[A-Za-z]/.test(token)) { emit(); command = token.toUpperCase(); continue; }
    numbers.push(Number(token));
  }
  emit();
  return out.join(' ');
}

function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}
