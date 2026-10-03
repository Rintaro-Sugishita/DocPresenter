// Draws a diagram as SVG. Geometry comes from the layout pass, so this file
// only turns boxes into shapes; it emits class names rather than colours, the
// same way the table renderer does, so one theme styles both. Arrowheads are
// drawn as plain polygons rather than markers: a marker needs an id, and an id
// cannot be repeated across the many diagrams of one page.

import { EDGE_LABEL, layOutDiagram, type Box, type EdgeRoute } from '../layout.js';
import { lineText, parseRuns, type TextLine } from '../inline.js';
import { textWidth } from '../text.js';
import type { DiagramFile, Item, Node, Point, ShapeKind } from '../model.js';
import { escapeAttr, escapeHtml } from '@docpresenter/base';
import { isIconPath, stencilArt, textPlace } from './stencil.js';
import { isListing, listingArt } from './listing.js';
import { members, shownPage, tabPages, SCROLL_BAR, TAB_STRIP } from '../arrange.js';
import {
  arrowHead as arrowCorners, border, cylinderRadius, labelLayout, n, shapeOutlines,
  LINE_HEIGHT, PLAIN_LINE, type LineLook, type Outline, type ShapePart,
} from './geometry.js';

/** What a build found changed since another version, for the drawing's parts. */
export interface DiagramMarks {
  readonly nodes: ReadonlyMap<string, string>;
  /** Keyed `from->to`. */
  readonly edges: ReadonlyMap<string, string>;
}

/**
 * Draws a diagram. `url` resolves a picture a part points at by path; without
 * it such a part is drawn as its name, which is at least visible.
 *
 * `marks` says which shapes and connections a build found changed. They are
 * class names, like everything else here: the theme decides what "added" looks
 * like, and a diagram with no marks is byte for byte what it always was.
 */
export function renderDiagram(
  diagram: DiagramFile, url?: (path: string) => string, marks?: DiagramMarks,
): string {
  const laid = layOutDiagram(diagram);
  const byId = new Map(diagram.nodes.map(n => [n.id, n]));

  const behind: string[] = [];
  const front: string[] = [];
  for (const id of laid.order) {
    const node = byId.get(id);
    const box = laid.boxes.get(id);
    if (!node || !box) continue;
    (box.z < 0 ? behind : front).push(renderNode(node, box, diagram, url, marks));
  }

  // Connections are drawn in two passes: every line and plate first, then every
  // label, so one connection's plate can never blank out another's label.
  const drawn = laid.routes.map(route => renderEdge(route, byId, laid.boxes, marks));
  const edges = [
    ...drawn.map(e => e.geometry),
    ...drawn.map(e => e.label),
  ].filter(svg => svg !== '');

  const warnings = laid.diagnostics.map(
    text => `<!-- ${escapeHtml(text).replace(/-->/g, '')} -->`,
  );

  return [
    `<svg class="dp-diagram" data-mode="${diagram.mode}"`
      + ` viewBox="0 0 ${laid.width} ${laid.height}" width="${laid.width}" height="${laid.height}"`
      + ` xmlns="http://www.w3.org/2000/svg" role="img">`,
    ...warnings,
    ...behind,
    ...edges,
    ...front,
    '</svg>',
  ].join('\n');
}

/** The diagnostics the layout pass produced, for callers that surface them. */
export function diagramDiagnostics(diagram: DiagramFile): readonly string[] {
  return layOutDiagram(diagram).diagnostics;
}

function renderNode(
  node: Node, box: Box, diagram: DiagramFile, url?: (path: string) => string,
  marks?: DiagramMarks,
): string {
  const icon = diagram.style.get(node.id)?.get('icon');
  const classes = [
    'dp-node',
    `dp-shape-${node.shape}`,
    ...(icon ? ['dp-part'] : []),
    ...(node.className ? [`dp-class-${node.className}`] : []),
    ...styleClasses(diagram, node.id),
    ...(marks?.nodes.get(node.id) ? [`dp-diff-${marks.nodes.get(node.id)!}`] : []),
  ];
  // A part is a picture, so no outline is drawn around it. Where its words go
  // is the picture's own business: under it for a thing with a name, inside it
  // for a control that holds a value, nowhere for a scrollbar.
  const shape = icon
    ? picture(icon, box, url, node.items)
    : shapeElement(node.shape, box, lineLook(diagram.style.get(node.id)));
  const place = textPlace(icon);
  const text = node.shape === 'group'
    ? groupLabel(box)
    : place === 'none' || node.shape === 'line' || tabPages(diagram).has(node.id)
      ? ''
      : label(box, diagram.style.get(node.id)?.get('align'), node.shape, place === 'under');
  const colours = styleColours(diagram, node.id);
  const style = colours === '' ? '' : ` style="${escapeAttr(colours)}"`;
  return `<g class="${escapeAttr(classes.join(' '))}" data-node="${escapeAttr(node.id)}"${style}>`
    + `${shape}${furniture(node, box, diagram)}${text}</g>`;
}

/**
 * What a container draws of itself: the headings of a tab control, the bar
 * down the edge of an area that is cut off.
 *
 * Neither is a shape anyone wrote, and neither is decoration: the headings are
 * the pages this screen has, and the bar is how a reader knows the list goes
 * on. They sit in a group of their own so the theme can style them apart from
 * the outline they are drawn on.
 */
function furniture(node: Node, box: Box, diagram: DiagramFile): string {
  const container = diagram.containers.get(node.id);
  if (!container) return '';
  const byId = new Map(diagram.nodes.map(one => [one.id, one]));
  const marks: string[] = [];

  if (container.kind === 'tabs') {
    const shown = shownPage(container);
    let x = box.x + container.pad;
    for (const page of members(container)) {
      const label = byId.get(page)?.text ?? page;
      const width = textWidth(label, TAB_FONT) + TAB_PAD * 2;
      marks.push(`<rect class="dp-page-tab${page === shown ? ' dp-page-tab-on' : ''}"`
        + ` x="${n(x)}" y="${n(box.y + container.pad)}"`
        + ` width="${n(width)}" height="${TAB_STRIP}" rx="3"/>`
        + `<text class="dp-page-tab-label" x="${n(x + width / 2)}"`
        + ` y="${n(box.y + container.pad + TAB_STRIP / 2)}"`
        + ` text-anchor="middle" dominant-baseline="central">${escapeHtml(label)}</text>`);
      x += width + 2;
    }
    return `<g class="dp-page-tabs">${marks.join('')}</g>`;
  }

  if (container.scroll === 'none') return '';
  // The thumb says "there is more", not how much: the drawing knows what is
  // cut off, and a bar drawn to scale would be a measurement nobody wrote.
  const down = container.scroll === 'down';
  const track = down
    ? { x: box.x + box.width - SCROLL_BAR, y: box.y, width: SCROLL_BAR, height: box.height }
    : { x: box.x, y: box.y + box.height - SCROLL_BAR, width: box.width, height: SCROLL_BAR };
  const thumb = down
    ? { x: track.x + 2.5, y: track.y + 3, width: SCROLL_BAR - 5, height: track.height * 0.5 }
    : { x: track.x + 3, y: track.y + 2.5, width: track.width * 0.5, height: SCROLL_BAR - 5 };
  return '<g class="dp-scroll">'
    + `<rect class="dp-scroll-track" x="${n(track.x)}" y="${n(track.y)}"`
    + ` width="${n(track.width)}" height="${n(track.height)}"/>`
    + `<rect class="dp-scroll-thumb" x="${n(thumb.x)}" y="${n(thumb.y)}"`
    + ` width="${n(thumb.width)}" height="${n(thumb.height)}" rx="${(SCROLL_BAR - 5) / 2}"/>`
    + '</g>';
}

/** The headings of a tab control are set smaller than a label, like a tab. */
const TAB_FONT = 12;
const TAB_PAD = 14;

/** `#abc` or `#aabbcc`. Anything else is not a colour and is not emitted. */
const COLOUR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

/** A thickness in drawing units: `2`, `1.4`. Anything else is not one. */
const WEIGHT = /^\d+(\.\d+)?$/;

/**
 * Declarations this file reads itself rather than handing to the theme as a
 * class: `icon` and `align` decide what is drawn and where the words go, and
 * the three below are the geometry of a line and its thickness.
 */
const READ_HERE = ['align', 'icon', 'arrow', 'slope', 'weight'];

/** `dmz { line: dashed }` becomes `dp-line-dashed`; the theme decides the rest. */
function styleClasses(diagram: DiagramFile, id: string): string[] {
  const rule = diagram.style.get(id);
  if (!rule) return [];
  return [...rule]
    .filter(([property, value]) => !COLOUR.test(value) && !READ_HERE.includes(property))
    .map(([property, value]) => `dp-${property}-${value}`);
}

/** How a line leans and where it points, as the style layer wrote it. */
function lineLook(rule: ReadonlyMap<string, string> | undefined): LineLook {
  const arrow = rule?.get('arrow');
  return {
    arrow: arrow === 'start' || arrow === 'end' || arrow === 'both' ? arrow : PLAIN_LINE.arrow,
    slope: rule?.get('slope') === 'up' ? 'up' : PLAIN_LINE.slope,
  };
}

/** The room a part's picture takes at the top of its box. */
const ICON_ROOM = 44;

/**
 * How big a part's picture is drawn. The name is what a reader needs, so a
 * long name that has to wrap takes its room out of the picture rather than
 * running off the bottom of the box.
 */
function artSize(box: Box): number {
  const room = Math.min(ICON_ROOM, box.height - LINE_HEIGHT * box.lines.length);
  return Math.max(16, Math.min(room, box.width));
}

/**
 * A part's picture, drawn to fit the box above its label. A name that ends in
 * a file extension is a file the author pointed at; anything else is one of the
 * pictures shipped with the tool.
 */
function picture(
  icon: string, box: Box, url?: (path: string) => string, items: readonly Item[] = [],
): string {
  // Three pictures are drawn from what the shape holds rather than from fixed
  // artwork: a tree with twenty rows is not the same drawing as one with four.
  if (isListing(icon) && items.length > 0) {
    return `<g class="dp-part-art dp-listing">${listingArt(icon, box, items)}</g>`;
  }
  const size = artSize(box);
  const x = box.x + (box.width - size) / 2;
  const y = box.y + Math.max(0, (box.height - LINE_HEIGHT * box.lines.length - size) / 2);

  // A control is as long as what it sits beside — a scrollbar is the height of
  // its list — so these are drawn onto the whole box rather than square in the
  // middle of it.
  const stretched = stencilArt(icon);
  if (stretched?.fit) {
    const sx = box.width / stretched.fit.width;
    const sy = box.height / stretched.fit.height;
    return `<g class="dp-part-art" transform="translate(${n(box.x)}, ${n(box.y)})`
      + ` scale(${n(sx)}, ${n(sy)})">${stretched.body}</g>`;
  }

  if (isIconPath(icon)) {
    const href = url ? url(icon) : icon;
    return `<image class="dp-part-image" href="${escapeAttr(href)}" x="${n(x)}" y="${n(y)}"`
      + ` width="${n(size)}" height="${n(size)}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  const part = stencilArt(icon);
  if (!part) {
    // P6: an unknown part is said out loud rather than drawn as nothing.
    return `<text class="dp-missing-part" x="${n(box.x + box.width / 2)}" y="${n(y + size / 2)}"`
      + ` text-anchor="middle" dominant-baseline="central">?</text>`;
  }
  const scale = size / 24;
  return `<g class="dp-part-art" transform="translate(${n(x)}, ${n(y)}) scale(${n(scale)})">`
    + `${part.body}</g>`;
}

/**
 * A colour the author picked, as CSS on the group. Drawn shapes inherit it, so
 * one declaration covers the outline, the fill and the label alike.
 */
function styleColours(diagram: DiagramFile, id: string): string {
  const rule = diagram.style.get(id);
  if (!rule) return '';
  const parts: string[] = [];
  for (const [property, value] of rule) {
    // A thickness is a number, so it travels the way the colours do: a class
    // per value would mean the theme deciding in advance which numbers exist.
    if (property === 'weight' && WEIGHT.test(value)) {
      parts.push(`--dp-weight:${value}`);
      continue;
    }
    if (!COLOUR.test(value)) continue;
    if (property === 'fill') parts.push(`--dp-fill:${value}`);
    if (property === 'line') parts.push(`--dp-line:${value}`);
    if (property === 'color') parts.push(`--dp-text:${value}`);
  }
  return parts.join(';');
}

/** The outline, as SVG. What the marks are is decided in `geometry.ts`. */
function shapeElement(shape: ShapeKind, box: Box, look: LineLook): string {
  return shapeOutlines(shape, box, look).map(markup).join('');
}

function markup(part: ShapePart): string {
  const className = part.detail === 'lid' ? ' class="dp-cylinder-lid"'
    : part.detail === 'fold' ? ' class="dp-note-fold"'
      : part.detail === 'arrow' ? ' class="dp-arrow"' : '';
  return element(part.outline, className);
}

function element(outline: Outline, className: string): string {
  switch (outline.kind) {
    case 'rect': {
      const radius = outline.radius > 0 ? ` rx="${n(outline.radius)}"` : '';
      return `<rect${className} x="${n(outline.x)}" y="${n(outline.y)}"`
        + ` width="${n(outline.width)}" height="${n(outline.height)}"${radius}/>`;
    }
    case 'ellipse':
      return `<ellipse${className} cx="${n(outline.cx)}" cy="${n(outline.cy)}"`
        + ` rx="${n(outline.rx)}" ry="${n(outline.ry)}"/>`;
    case 'polygon':
      return `<polygon${className} points="`
        + `${outline.points.map(p => `${n(p.x)},${n(p.y)}`).join(' ')}"/>`;
    case 'path':
      return `<path${className} d="${outline.d}"/>`;
  }
}

function label(
  box: Box, align: string | undefined, shape: ShapeKind, underPicture = false,
): string {
  const at = labelLayout(box, align, shape, underPicture ? artSize(box) : 0);
  const spans = box.lines.map((line, i) =>
    `<tspan x="${n(at.x)}" y="${n(at.top + i * at.lineHeight)}">${runs(line)}</tspan>`);
  return `<text class="dp-label" text-anchor="${at.anchor}" dominant-baseline="central">`
    + `${spans.join('')}</text>`;
}

/**
 * The runs of one line, as nested `tspan`s. A label takes the same inline
 * formatting as the rest of the document, and SVG says "part of this text is
 * different" the same way: a span inside the text.
 */
function runs(line: TextLine): string {
  return line.map(run => {
    const text = escapeHtml(run.text);
    const attributes = [
      ...(run.bold ? ['font-weight="600"'] : []),
      ...(run.italic ? ['font-style="italic"'] : []),
      ...(run.code ? ['class="dp-code"'] : []),
      ...(run.colour && COLOUR.test(run.colour) ? [`fill="${escapeAttr(run.colour)}"`] : []),
    ];
    return attributes.length === 0 ? text : `<tspan ${attributes.join(' ')}>${text}</tspan>`;
  }).join('');
}

/** A group is named in its top-left corner so the label never covers a shape. */
function groupLabel(box: Box): string {
  const line = box.lines.flatMap(one => [...one]);
  if (lineText(line) === '') return '';
  return `<text class="dp-group-label" x="${n(box.x + 8)}" y="${n(box.y + 14)}">${runs(line)}</text>`;
}

interface DrawnEdge { readonly geometry: string; readonly label: string }

function renderEdge(
  route: EdgeRoute, byId: ReadonlyMap<string, Node>, boxes: ReadonlyMap<string, Box>,
  marks?: DiagramMarks,
): DrawnEdge {
  const { edge, points } = route;
  const from = boxes.get(edge.from);
  const to = boxes.get(edge.to);
  if (!from || !to || points.length < 2) return { geometry: '', label: '' };

  const clipped = [...points];
  clipped[0] = border(from, byId.get(edge.from)?.shape ?? 'rect', points[1]!);
  clipped[clipped.length - 1] = border(to, byId.get(edge.to)?.shape ?? 'rect', points[points.length - 2]!);

  const change = marks?.edges.get(`${edge.from}->${edge.to}`);
  const open = `<g class="${['dp-edge', `dp-line-${edge.line}`,
    ...(change ? [`dp-diff-${change}`] : [])].join(' ')}"`
    + ` data-edge="${escapeAttr(`${edge.from}->${edge.to}`)}">`;
  const geometry = [
    open,
    `<polyline points="${clipped.map(p => `${n(p.x)},${n(p.y)}`).join(' ')}"/>`,
    ...(edge.arrow === 'arrow'
      ? [arrowHead(clipped[clipped.length - 2]!, clipped[clipped.length - 1]!)] : []),
    ...(edge.label && route.labelAt ? [labelPlate(edge.label, route.labelAt)] : []),
    '</g>',
  ].join('');

  return {
    geometry,
    label: edge.label && route.labelAt ? open + labelText(edge.label, route.labelAt) + '</g>' : '',
  };
}

function arrowHead(start: Point, end: Point): string {
  const points = arrowCorners(start, end).map(p => `${n(p.x)},${n(p.y)}`).join(' ');
  return `<polygon class="dp-arrow" points="${points}"/>`;
}

/** The plate the label sits on, so the line does not run through the text. */
function labelPlate(text: string, { x, y }: Point): string {
  const width = textWidth(text, EDGE_LABEL.fontSize) + EDGE_LABEL.padding;
  return `<rect class="dp-edge-plate" x="${n(x - width / 2)}" y="${n(y - EDGE_LABEL.height / 2)}"`
    + ` width="${n(width)}" height="${EDGE_LABEL.height}" rx="2"/>`;
}

function labelText(text: string, { x, y }: Point): string {
  return `<text class="dp-edge-label" x="${n(x)}" y="${n(y)}"`
    + ` text-anchor="middle" dominant-baseline="central">${runs(parseRuns(text))}</text>`;
}

