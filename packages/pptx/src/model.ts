// What goes on a slide.
//
// A deck is not a document with page breaks. The point of the PPTX output is
// that the person who receives it can edit the drawing in PowerPoint — so a
// slide holds a title and one thing worth showing, and the drawing arrives as
// native shapes rather than as a picture of itself.

import type { Run } from '@docpresenter/diagram';

/** English Metric Units: 914400 to the inch. All slide geometry is in them. */
export const EMU_PER_INCH = 914400;
export const EMU_PER_PX = EMU_PER_INCH / 96;
export const EMU_PER_PT = EMU_PER_INCH / 72;

/** 16:9, because the drawing is the point and a drawing is wide. */
export const SLIDE = { width: 12192000, height: 6858000 } as const;

export interface TextBlock {
  readonly kind: 'text';
  /** Each paragraph as its runs, so bold and colour survive. */
  readonly paragraphs: readonly (readonly Run[])[];
}

export interface TableBlock {
  readonly kind: 'table';
  readonly columns: readonly number[];          // relative widths
  readonly rows: readonly TableRow[];
}

export interface TableRow {
  readonly header: boolean;
  readonly cells: readonly TableCell[];
}

export interface TableCell {
  readonly runs: readonly Run[];
  readonly rowSpan: number;
  readonly colSpan: number;
  /** A position covered by a merged cell, which OOXML still requires. */
  readonly covered: 'none' | 'horizontal' | 'vertical';
  readonly fill?: string;
  readonly align?: 'left' | 'center' | 'right';
}

export interface PictureBlock {
  readonly kind: 'picture';
  readonly data: string;                        // a data: URL
  readonly width: number;                       // px
  readonly height: number;
}

/** A drawing, as shapes PowerPoint can edit. */
export interface DrawingBlock {
  readonly kind: 'drawing';
  /** The `.dgm` it came from, so an edited slide can be read back into it. */
  readonly source?: string;
  readonly width: number;                       // px, the drawing's own size
  readonly height: number;
  readonly shapes: readonly DrawnShape[];
  readonly connectors: readonly DrawnConnector[];
}

export interface DrawnShape {
  readonly id: string;
  /** A DrawingML preset name, so PowerPoint hands it back as a real shape. */
  readonly preset: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly lines: readonly (readonly Run[])[];
  readonly fill?: string;
  readonly line?: string;
  readonly colour?: string;
  readonly dashed: boolean;
  /** Outline thickness in drawing units; the default is the theme's. */
  readonly weight?: number;
  readonly fontSize: number;                    // pt
  readonly align: 'left' | 'center' | 'right';
  /** Behind everything else: a group's container. */
  readonly behind: boolean;
  /** A part's picture, when the shape carries one. */
  readonly picture?: string;
}

export interface DrawnConnector {
  readonly points: readonly { readonly x: number; readonly y: number }[];
  /** A head at the far end. */
  readonly arrow: boolean;
  /** A head at the near end as well, which only a line drawn alone asks for. */
  readonly startArrow?: boolean;
  readonly dashed: boolean;
  readonly line?: string;
  /** Thickness in drawing units; the default is the one the theme draws with. */
  readonly weight?: number;
  readonly label?: readonly Run[];
  /** The shape and side each end leaves through, so PowerPoint keeps the line on it. */
  readonly start?: Attachment;
  readonly end?: Attachment;
}

/** Which side of which shape a connection's end is fixed to. */
export interface Attachment {
  /** The `DrawnShape` id. */
  readonly shape: string;
  readonly side: 'top' | 'left' | 'bottom' | 'right';
}

export type Block = TextBlock | TableBlock | PictureBlock | DrawingBlock;

export interface Slide {
  readonly title: string | undefined;
  readonly blocks: readonly Block[];
  /** Printed small at the foot: document number, version, slide number. */
  readonly foot?: string;
}

export interface Deck {
  readonly title: string;
  readonly slides: readonly Slide[];
  readonly diagnostics: readonly string[];
}
