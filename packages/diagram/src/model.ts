// The diagram model. Free placement is the general case and a graph is the
// same model with its layout computed, so both share these types: the
// difference is only how much of the layout layer is filled in.

import type { ByteSpan } from '@docpresenter/base';

export type ShapeKind =
  | 'rect' | 'round-rect' | 'stadium' | 'cylinder' | 'diamond'
  | 'ellipse' | 'note' | 'text' | 'group'
  // The flowchart set. A loop needs a start and an end that are read as a
  // pair, which is what the two trapezoids are for.
  | 'parallelogram' | 'hexagon' | 'loop-start' | 'loop-end'
  // A line standing on its own, as opposed to a connection between two
  // shapes. A screen is full of rules that divide it and arrows that point at
  // it, and neither of those joins one thing to another — so neither can be
  // written as an edge, which exists to say that two shapes are related.
  | 'line';

/**
 * One row of a shape that holds a list rather than a sentence — a tree, a list
 * box, a menu bar.
 *
 * These are not shapes of their own. A screen's tree has twenty rows and
 * nobody writes a specification for each one: what the item list needs a line
 * for is the tree, so the rows are text the shape holds, not shapes with ids.
 */
export interface Item {
  readonly text: string;
  /** How far in it sits. Zero is the top level. */
  readonly depth: number;
  /** A branch drawn closed, written `+` rather than `-`. */
  readonly closed: boolean;
  /** The row that is chosen, written with a `*` after it. */
  readonly picked: boolean;
}

export interface Node {
  readonly id: string;
  readonly text: string;
  readonly shape: ShapeKind;
  /**
   * The rows of a tree, a list or a menu, when the shape is one of those.
   * Empty for every other shape.
   */
  readonly items: readonly Item[];
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

export type DiagramMode = 'free' | 'flow' | 'overlay' | 'parts';

/**
 * A named look: a shape, a style, and how big it usually is.
 *
 * A part is not a drawing. The vocabulary of shapes is fixed and small; a part
 * says "an input box in this system looks like this", which is a decision about
 * one system rather than about diagrams. Drawing three screens by hand is what
 * produced the list — eleven looks, eight of them written more than once.
 */
export interface Part {
  readonly name: string;
  readonly shape: ShapeKind;
  readonly style: ReadonlyMap<string, string>;
  /** Used when the pin gives none; a pin that gives one wins. */
  readonly width: number | undefined;
  readonly height: number | undefined;
  /** The part's own line, so editing one part rewrites one line. */
  readonly span: ByteSpan;
  /**
   * The heading this part was written under (`# --- ボタン ---`), if any.
   *
   * A library of forty parts is read by its headings, not by its order, and
   * the author already wrote them. So a menu of the parts can be grouped the
   * way the file is, instead of inventing a grouping of its own.
   */
  readonly group: string | undefined;
}

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

/**
 * An arrangement: a shape that decides where the shapes it holds go.
 *
 * The layout layer used to hold pins and nothing else, which meant a form of
 * eight fields was eight coordinates — when the facts were "down the page, 12
 * apart, full width". Those three are what a container says; the coordinates
 * are computed from them. A pin still wins, so one field can be put somewhere
 * else without giving up the arrangement for the rest.
 */
export interface Container {
  /** The shape whose inside is being arranged — a frame, a panel, a group. */
  readonly id: string;
  /**
   * How it arranges: in a line, in rows and columns, or one page of several.
   *
   * `tabs` is a kind of its own rather than a setting because it is the one
   * that does not show everything it holds — a reader sees the headings and
   * one page, which is what a tab control is.
   */
  readonly kind: 'stack' | 'grid' | 'tabs';
  /** `stack` only: down the page or across it. */
  readonly flow: 'down' | 'right';
  /**
   * Which way it runs out of room, if it does. A scrolling area's job in a
   * design document is to say "this is cut off and there is more", so what
   * does not fit is left undrawn and a bar is drawn down the edge.
   */
  readonly scroll: 'none' | 'down' | 'right';
  /** `tabs` only: which page this drawing shows. The first, unless it says. */
  readonly show: string | undefined;
  /**
   * How wide each column is: a number of units, `1fr` for a share of what is
   * left, or `auto` for as wide as its widest member. Empty means an even
   * share each, which is what a form of labels and fields wants.
   */
  readonly cols: readonly string[];
  /** Between the rows and between the columns. */
  readonly gap: { readonly x: number; readonly y: number };
  /** Between the container's edge and what it holds. */
  readonly pad: number;
  /**
   * What is in each cell, row by row. `.` is an empty cell, and a name written
   * in two neighbouring cells occupies both — the way `grid-template-areas`
   * says it, so the written shape is the shape on the screen.
   */
  readonly cells: readonly (readonly string[])[];
  /** The whole block, so one gesture rewrites one byte range. */
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
  /**
   * Where each shape's style rule is written, so one declaration can be changed
   * where it stands. Without it a colour set from the canvas would have to be
   * appended as a second rule for the same shape.
   */
  readonly styleSpans: ReadonlyMap<string, ByteSpan>;
  /** Overlay only: the image the callouts annotate. */
  readonly image: string | undefined;
  readonly callouts: readonly Callout[];
  /** Files of parts this one uses, as written (relative to this file). */
  readonly uses: readonly string[];
  /** Parts declared in this file, by name. */
  readonly parts: ReadonlyMap<string, Part>;
  /** Which part each shape was written as, for the ones that name one. */
  readonly partOf: ReadonlyMap<string, string>;
  /**
   * Every part this drawing can reach — what it uses, under what it declares.
   *
   * `parts` is what the file itself says; this is what a writer of the file
   * may choose from, which is the question the editor asks. Filled in when the
   * parts are applied, empty before that.
   */
  readonly library: ReadonlyMap<string, Part>;
  /**
   * The size a part gives a shape, for the shapes that are not pinned.
   *
   * A pin carries its own size and wins; a shape inside a container has no pin
   * at all, and "how big is a textbox here" is a question only the library can
   * answer. Filled in when the parts are applied, empty before that.
   */
  readonly partSizes: ReadonlyMap<string, { readonly width: number; readonly height: number }>;
  /** How each container arranges what it holds, by the container's id. */
  readonly containers: ReadonlyMap<string, Container>;
  /** The `parts { … }` section, for adding one. */
  readonly partsBlock: Section | undefined;
}

export const DEFAULT_SIZE = { width: 150, height: 56 } as const;
