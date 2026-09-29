// A drawing, as shapes PowerPoint can edit.
//
// This is the one output that reads the drawing model rather than the picture
// the browser made of it: a slide has to carry shapes with handles, and a
// handle is something only the model knows about. The vocabulary was
// restricted to DrawingML presets from the start for this, so the mapping
// below is a table rather than an approximation.

import {
  layOutDiagram, type Box, type DiagramFile, type Run, type ShapeKind,
} from '@docpresenter/diagram';
import type { DrawingBlock, DrawnConnector, DrawnShape } from './model.js';

/** A colour an author wrote, as opposed to a token only the theme can resolve. */
const COLOUR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

const PRESETS: Readonly<Record<ShapeKind, { preset: string; adjust?: number; flipV?: boolean }>> = {
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
  /** Colours the theme resolves, which the model cannot. Keyed by style token. */
  readonly tokens?: Readonly<Record<string, string>>;
  readonly diagnostics?: string[];
}

export function drawingOf(diagram: DiagramFile, options: DrawingOptions = {}): DrawingBlock {
  const laid = layOutDiagram(diagram);
  const byId = new Map(diagram.nodes.map(node => [node.id, node]));
  const shapes: DrawnShape[] = [];

  for (const id of laid.order) {
    const node = byId.get(id);
    const box = laid.boxes.get(id);
    if (!node || !box) continue;
    const style = diagram.style.get(id);
    const fill = resolve(style?.get('fill'), options);
    const line = resolve(style?.get('line'), options);
    const colour = resolve(style?.get('color'), options);
    const align = style?.get('align');
    const preset = PRESETS[node.shape];

    if (style?.get('icon') !== undefined) {
      // A part is a picture, not a shape (design/diagram-model.md §10.2). It
      // is said out loud rather than drawn as an empty box.
      options.diagnostics?.push(`部品の絵は PPTX にまだ出せない: ${id}`);
    }

    shapes.push({
      id,
      preset: preset.preset,
      x: box.x, y: box.y, width: box.width, height: box.height,
      lines: node.shape === 'group' ? groupLabel(box) : box.lines.map(line => [...line]),
      ...(node.shape === 'text' ? {} : { fill: fill ?? (node.shape === 'group' ? '#f7f8fa' : '#ffffff') }),
      ...(node.shape === 'text' ? {} : { line: line ?? '#3a4048' }),
      ...(colour ? { colour } : {}),
      dashed: style?.get('line') === 'dashed',
      fontSize: node.shape === 'group' ? 9 : 10.5,
      align: align === 'left' ? 'left' : align === 'right' ? 'right' : 'center',
      behind: box.z < 0 || node.shape === 'group',
    });
  }

  const connectors: DrawnConnector[] = laid.routes.map(route => ({
    points: route.points.map(point => ({ x: point.x, y: point.y })),
    arrow: route.edge.arrow === 'arrow',
    dashed: route.edge.line === 'dashed',
    ...(route.edge.label ? { label: [{ text: route.edge.label, bold: false, italic: false, code: false, colour: undefined }] as Run[] } : {}),
  }));

  for (const message of laid.diagnostics) options.diagnostics?.push(message);

  return { kind: 'drawing', width: laid.width, height: laid.height, shapes, connectors };
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
