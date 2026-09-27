// Draws a diagram as SVG. Geometry comes from the layout pass, so this file
// only turns boxes into shapes; it emits class names rather than colours, the
// same way the table renderer does, so one theme styles both. Arrowheads are
// drawn as plain polygons rather than markers: a marker needs an id, and an id
// cannot be repeated across the many diagrams of one page.

import {
  EDGE_LABEL, layOutDiagram, textWidth,
  type Box, type DiagramFile, type EdgeRoute, type Node, type Point, type ShapeKind,
} from '@docpresenter/core';
import { escapeAttr, escapeHtml } from '../html/table.js';

const LINE_HEIGHT = 20;
const ARROW_LENGTH = 10;
const ARROW_HALF_WIDTH = 4;

export function renderDiagram(diagram: DiagramFile): string {
  const laid = layOutDiagram(diagram);
  const byId = new Map(diagram.nodes.map(n => [n.id, n]));

  const behind: string[] = [];
  const front: string[] = [];
  for (const id of laid.order) {
    const node = byId.get(id);
    const box = laid.boxes.get(id);
    if (!node || !box) continue;
    (box.z < 0 ? behind : front).push(renderNode(node, box, diagram));
  }

  // Connections are drawn in two passes: every line and plate first, then every
  // label, so one connection's plate can never blank out another's label.
  const drawn = laid.routes.map(route => renderEdge(route, byId, laid.boxes));
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

function renderNode(node: Node, box: Box, diagram: DiagramFile): string {
  const classes = [
    'dp-node',
    `dp-shape-${node.shape}`,
    ...(node.className ? [`dp-class-${node.className}`] : []),
    ...styleClasses(diagram, node.id),
  ];
  const shape = shapeElement(node.shape, box);
  const text = node.shape === 'group'
    ? groupLabel(box)
    : label(box, diagram.style.get(node.id)?.get('align'), node.shape);
  const colours = styleColours(diagram, node.id);
  const style = colours === '' ? '' : ` style="${escapeAttr(colours)}"`;
  return `<g class="${escapeAttr(classes.join(' '))}" data-node="${escapeAttr(node.id)}"${style}>`
    + `${shape}${text}</g>`;
}

/** `#abc` or `#aabbcc`. Anything else is not a colour and is not emitted. */
const COLOUR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

/** `dmz { line: dashed }` becomes `dp-line-dashed`; the theme decides the rest. */
function styleClasses(diagram: DiagramFile, id: string): string[] {
  const rule = diagram.style.get(id);
  if (!rule) return [];
  return [...rule]
    .filter(([property, value]) => !COLOUR.test(value) && property !== 'align')
    .map(([property, value]) => `dp-${property}-${value}`);
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
    if (!COLOUR.test(value)) continue;
    if (property === 'fill') parts.push(`--dp-fill:${value}`);
    if (property === 'line') parts.push(`--dp-line:${value}`);
    if (property === 'color') parts.push(`--dp-text:${value}`);
  }
  return parts.join(';');
}

function shapeElement(shape: ShapeKind, box: Box): string {
  const { x, y, width: w, height: h } = box;
  switch (shape) {
    case 'rect':
      return rect(x, y, w, h, 0);
    case 'group':
      return rect(x, y, w, h, 4);
    case 'round-rect':
      return rect(x, y, w, h, 8);
    case 'stadium':
      return rect(x, y, w, h, h / 2);
    case 'ellipse':
      return `<ellipse cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}"/>`;
    case 'diamond':
      return `<polygon points="${[
        [x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2],
      ].map(([px, py]) => `${n(px!)},${n(py!)}`).join(' ')}"/>`;
    case 'cylinder': {
      const ry = cylinderRadius(h);
      return `<path d="M ${n(x)} ${n(y + ry)}`
        + ` A ${n(w / 2)} ${n(ry)} 0 0 1 ${n(x + w)} ${n(y + ry)}`
        + ` L ${n(x + w)} ${n(y + h - ry)}`
        + ` A ${n(w / 2)} ${n(ry)} 0 0 1 ${n(x)} ${n(y + h - ry)} Z"/>`
        + `<path class="dp-cylinder-lid" d="M ${n(x)} ${n(y + ry)}`
        + ` A ${n(w / 2)} ${n(ry)} 0 0 0 ${n(x + w)} ${n(y + ry)}"/>`;
    }
    case 'text':
      // Nothing is drawn: the label is the shape.
      return '';
    case 'note': {
      const fold = 14;
      return `<path d="M ${n(x)} ${n(y)} L ${n(x + w - fold)} ${n(y)} L ${n(x + w)} ${n(y + fold)}`
        + ` L ${n(x + w)} ${n(y + h)} L ${n(x)} ${n(y + h)} Z"/>`
        + `<path class="dp-note-fold" d="M ${n(x + w - fold)} ${n(y)}`
        + ` L ${n(x + w - fold)} ${n(y + fold)} L ${n(x + w)} ${n(y + fold)}"/>`;
    }
  }
}

function rect(x: number, y: number, w: number, h: number, r: number): string {
  const radius = r > 0 ? ` rx="${n(r)}"` : '';
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${radius}/>`;
}

/**
 * Centred unless the author said otherwise. A box in a flowchart is centred; a
 * label on a screen mock-up is not, and a screen made of centred labels reads
 * as nothing anyone would build.
 */
function label(box: Box, align: string | undefined, shape: ShapeKind): string {
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
  const inset = 8;
  const x = anchor === 'start' ? box.x + inset
    : anchor === 'end' ? box.x + box.width - inset
    : box.x + box.width / 2;
  // A cylinder's lid takes the top of the box, so the middle of the box is not
  // the middle of the space the text has. Centring there runs the text into
  // the curve.
  const lid = shape === 'cylinder' ? cylinderRadius(box.height) : 0;
  const top = box.y + (box.height + lid) / 2 - ((box.lines.length - 1) * LINE_HEIGHT) / 2;
  const spans = box.lines.map((line, i) =>
    `<tspan x="${n(x)}" y="${n(top + i * LINE_HEIGHT)}">${escapeHtml(line)}</tspan>`);
  return `<text class="dp-label" text-anchor="${anchor}" dominant-baseline="central">${spans.join('')}</text>`;
}

/** How deep the lid of a cylinder is. The body and the text both need it. */
function cylinderRadius(height: number): number {
  return Math.min(12, height / 4);
}

/** A group is named in its top-left corner so the label never covers a shape. */
function groupLabel(box: Box): string {
  const text = box.lines.join(' ');
  if (text === '') return '';
  return `<text class="dp-group-label" x="${n(box.x + 8)}" y="${n(box.y + 14)}">${escapeHtml(text)}</text>`;
}

interface DrawnEdge { readonly geometry: string; readonly label: string }

function renderEdge(
  route: EdgeRoute, byId: ReadonlyMap<string, Node>, boxes: ReadonlyMap<string, Box>,
): DrawnEdge {
  const { edge, points } = route;
  const from = boxes.get(edge.from);
  const to = boxes.get(edge.to);
  if (!from || !to || points.length < 2) return { geometry: '', label: '' };

  const clipped = [...points];
  clipped[0] = border(from, byId.get(edge.from)?.shape ?? 'rect', points[1]!);
  clipped[clipped.length - 1] = border(to, byId.get(edge.to)?.shape ?? 'rect', points[points.length - 2]!);

  const open = `<g class="${['dp-edge', `dp-line-${edge.line}`].join(' ')}"`
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

function centre(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Where the line from the centre towards `towards` leaves the shape. */
function border(box: Box, shape: ShapeKind, towards: Point): Point {
  const c = centre(box);
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

function arrowHead(start: Point, end: Point): string {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const back = { x: end.x - Math.cos(angle) * ARROW_LENGTH, y: end.y - Math.sin(angle) * ARROW_LENGTH };
  const nx = -Math.sin(angle) * ARROW_HALF_WIDTH;
  const ny = Math.cos(angle) * ARROW_HALF_WIDTH;
  const points = [
    [end.x, end.y], [back.x + nx, back.y + ny], [back.x - nx, back.y - ny],
  ].map(([x, y]) => `${n(x!)},${n(y!)}`).join(' ');
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
    + ` text-anchor="middle" dominant-baseline="central">${escapeHtml(text)}</text>`;
}

/** Coordinates are rounded: a diff of a rendered SVG should stay readable. */
function n(value: number): string {
  return String(Math.round(value * 100) / 100);
}
