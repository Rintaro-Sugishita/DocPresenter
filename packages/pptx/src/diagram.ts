// A drawing, as shapes PowerPoint can edit.
//
// This is the one output that reads the drawing model rather than the picture
// the browser made of it: a slide has to carry shapes with handles, and a
// handle is something only the model knows about. The vocabulary was
// restricted to DrawingML presets from the start for this, so the mapping
// below is a table rather than an approximation.

import {
  border, layOutDiagram, type Box, type DiagramFile, type Point, type Run, type ShapeKind,
} from '@docpresenter/diagram';
import type { Attachment, DrawingBlock, DrawnConnector, DrawnShape } from './model.js';

/** A colour an author wrote, as opposed to a token only the theme can resolve. */
const COLOUR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

/** The default theme's diff colours, for a deck that cannot read a stylesheet. */
const DIFF: Readonly<Record<string, string>> = {
  added: '#e6f4e9', changed: '#fdf0d5', removed: '#fde8e8',
};

/**
 * A preset per shape — except the line, which is not a shape here at all: a
 * slide draws a lone line with the same connector it draws a connection with,
 * so that PowerPoint hands it back with two draggable ends.
 */
const PRESETS: Readonly<Record<
  Exclude<ShapeKind, 'line'>, { preset: string; adjust?: number; flipV?: boolean }
>> = {
  'rect':          { preset: 'rect' },
  'round-rect':    { preset: 'roundRect', adjust: 12000 },
  'stadium':       { preset: 'roundRect', adjust: 50000 },
  'cylinder':      { preset: 'can' },
  'diamond':       { preset: 'diamond' },
  'ellipse':       { preset: 'ellipse' },
  'note':          { preset: 'foldedCorner' },
  'text':          { preset: 'rect' },
  'group':         { preset: 'rect' },
  'parallelogram': { preset: 'parallelogram' },
  'hexagon':       { preset: 'hexagon' },
  // A trapezoid in DrawingML is wide at the bottom, which is the shape a
  // flowchart uses to open a loop; the one that closes it is the same shape
  // turned over.
  'loop-start':    { preset: 'trapezoid' },
  'loop-end':      { preset: 'trapezoid', flipV: true },
};

export interface DrawingOptions {
  /** The file the drawing was read from; carried into the slide (§8.1). */
  readonly source?: string;
  /**
   * What a build found changed since another version, by node id. A slide has
   * no CSS to resolve a class, so the colour is decided here — the one place
   * this output has to hold a colour of its own.
   */
  readonly marks?: ReadonlyMap<string, 'added' | 'removed' | 'changed'>;
  /** Colours the theme resolves, which the model cannot. Keyed by style token. */
  readonly tokens?: Readonly<Record<string, string>>;
  readonly diagnostics?: string[];
}

export function drawingOf(diagram: DiagramFile, options: DrawingOptions = {}): DrawingBlock {
  const laid = layOutDiagram(diagram);
  const byId = new Map(diagram.nodes.map(node => [node.id, node]));
  const shapes: DrawnShape[] = [];
  const lines: DrawnConnector[] = [];

  for (const id of laid.order) {
    const node = byId.get(id);
    const box = laid.boxes.get(id);
    if (!node || !box) continue;
    const style = diagram.style.get(id);
    const fill = resolve(style?.get('fill'), options);
    const line = resolve(style?.get('line'), options);
    const colour = resolve(style?.get('color'), options);
    const align = style?.get('align');
    const weight = Number(style?.get('weight'));

    if (node.shape === 'line') {
      const arrow = style?.get('arrow');
      const up = style?.get('slope') === 'up';
      lines.push({
        points: [
          { x: box.x, y: up ? box.y + box.height : box.y },
          { x: box.x + box.width, y: up ? box.y : box.y + box.height },
        ],
        arrow: arrow === 'end' || arrow === 'both',
        startArrow: arrow === 'start' || arrow === 'both',
        dashed: style?.get('line') === 'dashed',
        ...(line ? { line } : {}),
        ...(weight > 0 ? { weight } : {}),
      });
      continue;
    }
    const preset = PRESETS[node.shape];

    if (style?.get('icon') !== undefined) {
      // A part is a picture, not a shape (design/diagram-model.md §10.2). It
      // is said out loud rather than drawn as an empty box.
      options.diagnostics?.push(`部品の絵は PPTX にまだ出せない: ${id}`);
    }
    // What a container draws of itself — the headings of a tab control, the bar
    // down a list that is cut off — is drawn by the SVG renderer and not here.
    // The arrangement itself does arrive: the boxes were computed in common.
    const container = diagram.containers.get(id);
    if (container?.kind === 'tabs') {
      options.diagnostics?.push(`タブの見出しは PPTX にまだ出せない: ${id}`);
    } else if (container && container.scroll !== 'none') {
      options.diagnostics?.push(`スクロールの印は PPTX にまだ出せない: ${id}`);
    }

    const marked = options.marks?.get(id);
    shapes.push({
      id,
      preset: preset.preset,
      x: box.x, y: box.y, width: box.width, height: box.height,
      lines: node.shape === 'group' ? groupLabel(box) : box.lines.map(line => [...line]),
      ...(node.shape === 'text'
        ? {}
        : { fill: (marked ? DIFF[marked] : undefined)
            ?? fill ?? (node.shape === 'group' ? '#f7f8fa' : '#ffffff') }),
      ...(node.shape === 'text' ? {} : { line: line ?? '#3a4048' }),
      ...(colour ? { colour } : {}),
      dashed: style?.get('line') === 'dashed',
      ...(weight > 0 ? { weight } : {}),
      fontSize: node.shape === 'group' ? 9 : 10.5,
      align: align === 'left' ? 'left' : align === 'right' ? 'right' : 'center',
      behind: box.z < 0 || node.shape === 'group',
    });
  }

  const drawn = new Set(shapes.map(shape => shape.id));
  const connectors: DrawnConnector[] = laid.routes.map((route): DrawnConnector => {
    // Ends stop at the outlines, as on screen: a line run to the centre would
    // put its arrowhead under the shape it points at.
    const points = route.points.map(point => ({ x: point.x, y: point.y }));
    const from = laid.boxes.get(route.edge.from);
    const to = laid.boxes.get(route.edge.to);
    if (from && to && points.length >= 2) {
      points[0] = border(from, byId.get(route.edge.from)?.shape ?? 'rect', points[1]!);
      points[points.length - 1] = border(
        to, byId.get(route.edge.to)?.shape ?? 'rect', points[points.length - 2]!);
    }
    const start = from && drawn.has(route.edge.from) ? sideOf(from, points[0]!) : undefined;
    const end = to && drawn.has(route.edge.to) ? sideOf(to, points[points.length - 1]!) : undefined;
    return {
      points,
      arrow: route.edge.arrow === 'arrow',
      dashed: route.edge.line === 'dashed',
      ...(route.edge.label ? { label: [{ text: route.edge.label, bold: false, italic: false, code: false, colour: undefined }] as Run[] } : {}),
      ...(start ? { start: { shape: route.edge.from, side: start } } : {}),
      ...(end ? { end: { shape: route.edge.to, side: end } } : {}),
    };
  });

  for (const message of laid.diagnostics) options.diagnostics?.push(message);

  return {
    kind: 'drawing',
    ...(options.source === undefined ? {} : { source: options.source }),
    width: laid.width, height: laid.height, shapes,
    // The lines someone drew on their own come first, so a connection between
    // two shapes is never hidden under a rule drawn across them.
    connectors: [...lines, ...connectors],
  };
}

/**
 * The side an end leaves through, when it leaves through the middle of one.
 * Only then is it the point PowerPoint would put it back on; an end anywhere
 * else is left unattached rather than moved.
 */
function sideOf(box: Box, at: Point): Attachment['side'] | undefined {
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (near(at.x, cx) && near(at.y, box.y)) return 'top';
  if (near(at.x, cx) && near(at.y, box.y + box.height)) return 'bottom';
  if (near(at.y, cy) && near(at.x, box.x)) return 'left';
  if (near(at.y, cy) && near(at.x, box.x + box.width)) return 'right';
  return undefined;
}

/** A group's own label sits at its top-left; it is not the label of a box. */
function groupLabel(box: Box): readonly (readonly Run[])[] {
  return box.lines.map(line => [...line]);
}

/**
 * A style value is either a colour the author wrote or a token the theme
 * resolves. Only the first can be carried into a deck on its own; a token
 * needs the theme, which is CSS and does not travel to PowerPoint.
 */
function resolve(value: string | undefined, options: DrawingOptions): string | undefined {
  if (value === undefined) return undefined;
  if (COLOUR.test(value)) return value;
  const known = options.tokens?.[value];
  if (known !== undefined) return known;
  return undefined;
}
