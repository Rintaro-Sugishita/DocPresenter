// The diagram model. Free placement is the general case and a graph is the
// same model with its layout computed, so both share these types: the
// difference is only how much of the layout layer is filled in.

import type { ByteSpan } from '@docpresenter/base';

export type ShapeKind =
  | 'rect' | 'round-rect' | 'stadium' | 'cylinder' | 'diamond'
  | 'ellipse' | 'note' | 'text' | 'group'
  // The flowchart set. A loop needs a start and an end that are read as a
  // pair, which is what the two trapezoids are for.
  | 'parallelogram' | 'hexagon' | 'loop-start' | 'loop-end';

export interface Node {
  readonly id: string;
  readonly text: string;
  readonly shape: ShapeKind;
  /** Style class from `:::name`, resolved by the theme. */
  readonly className: string | undefined;
  /** Ids contained by a group. */
  readonly children: readonly string[];
  /** The shape's own line, so renaming one shape rewrites one line. */
  readonly span: ByteSpan;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type EdgeStyle = 'solid' | 'dashed';
export type ArrowStyle = 'none' | 'arrow';

export interface Edge {
  readonly from: string;
  readonly to: string;
  readonly label: string | undefined;
  readonly line: EdgeStyle;
  readonly arrow: ArrowStyle;
  /** The connection's own line. */
  readonly span: ByteSpan;
}

/** A position pinned by hand. Absent means the layout is computed. */
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly width: number | undefined;
  readonly height: number | undefined;
  readonly z: number | undefined;
  /** The pin's own line, so dragging one shape rewrites one line. */
  readonly span: ByteSpan;
}

/**
 * A `{ … }` section, so the editor can add a line to it. The same shape serves
 * the semantics section and the layout section; which one is meant is the name
 * of the field holding it.
 */
export interface Section {
  /** The whole block, from its opening line to its closing brace. */
  readonly span: ByteSpan;
  /** Just before the closing brace: where a new line goes. */
  readonly insertAt: number;
  /** The indent the existing lines use. */
  readonly indent: string;
}

/**
 * The corners a connection is made to turn through. Geometry, so it lives in
 * the layout layer beside the pins — the semantics section says what connects
 * to what and nothing about the path it takes.
 */
export interface Bend {
  readonly points: readonly Point[];
  /** The bend's own line. */
  readonly span: ByteSpan;
}

/** Where pins live, so dragging a shape that has none can add one. */
export interface LayoutBlock {
  /** The whole `layout { … }` block. */
  readonly span: ByteSpan;
  /** Just before the closing brace: where a new pin goes. */
  readonly insertAt: number;
  /** The indent the existing pins use. */
  readonly indent: string;
}

export type DiagramMode = 'free' | 'flow' | 'overlay';

/**
 * An annotation on an imported image. The image itself is a binary the diff
 * cannot show, so the numbering and the wording live here as text.
 */
export interface Callout {
  readonly marker: string;
  /** Where the marker sits, in image pixels. */
  readonly x: number;
  readonly y: number;
  /** What the marker points at. */
  readonly targetX: number;
  readonly targetY: number;
  readonly text: string;
  /** The callout's own line, for moving one marker. */
  readonly span: ByteSpan;
}

export interface DiagramFile {
  readonly mode: DiagramMode;
  readonly comments: readonly string[];
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
  /** The `free { … }` / `flow { … }` section, for adding a shape to it. */
  readonly body: Section | undefined;
  /** The layout layer: only what a human pinned. */
  readonly layout: ReadonlyMap<string, Placement>;
  /** Corners a connection turns through, keyed `from->to`. */
  readonly bends: ReadonlyMap<string, Bend>;
  /** Absent when the file has no `layout { … }` block yet. */
  readonly layoutBlock: LayoutBlock | undefined;
  /** The `style { … }` section, for adding a declaration to it. */
  readonly styleBlock: Section | undefined;
  readonly theme: string | undefined;
  readonly style: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Overlay only: the image the callouts annotate. */
  readonly image: string | undefined;
  readonly callouts: readonly Callout[];
}

export const DEFAULT_SIZE = { width: 150, height: 56 } as const;
