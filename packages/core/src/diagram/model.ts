// The diagram model. Free placement is the general case and a graph is the
// same model with its layout computed, so both share these types: the
// difference is only how much of the layout layer is filled in.

import type { ByteSpan } from '../document/model.js';

export type ShapeKind =
  | 'rect' | 'round-rect' | 'stadium' | 'cylinder' | 'diamond'
  | 'ellipse' | 'note' | 'text' | 'group';

export interface Node {
  readonly id: string;
  readonly text: string;
  readonly shape: ShapeKind;
  /** Style class from `:::name`, resolved by the theme. */
  readonly className: string | undefined;
  /** Ids contained by a group. */
  readonly children: readonly string[];
}

export type EdgeStyle = 'solid' | 'dashed';
export type ArrowStyle = 'none' | 'arrow';

export interface Edge {
  readonly from: string;
  readonly to: string;
  readonly label: string | undefined;
  readonly line: EdgeStyle;
  readonly arrow: ArrowStyle;
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
  /** The layout layer: only what a human pinned. */
  readonly layout: ReadonlyMap<string, Placement>;
  /** Absent when the file has no `layout { … }` block yet. */
  readonly layoutBlock: LayoutBlock | undefined;
  readonly theme: string | undefined;
  readonly style: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Overlay only: the image the callouts annotate. */
  readonly image: string | undefined;
  readonly callouts: readonly Callout[];
}

export const DEFAULT_SIZE = { width: 150, height: 56 } as const;
