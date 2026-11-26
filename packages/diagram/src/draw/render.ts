// Draws a diagram as SVG. Geometry comes from the layout pass, so this file
// only turns boxes into shapes; it emits class names rather than colours, the
// same way the table renderer does, so one theme styles both. Arrowheads are
// drawn as plain polygons rather than markers: a marker needs an id, and an id
// cannot be repeated across the many diagrams of one page.

import {
  EDGE_LABEL, edgeLabelBox, layOutDiagram, type Box, type EdgeRoute, type ItemMark, type LaidOutDiagram,
} from '../layout.js';
import { fontOf, isDisabled, isHidden } from '../states.js';
import { lineHeightFor } from '../layout.js';
import { lineText, type TextLine } from '../inline.js';
import { textWidth } from '../text.js';
import type { DiagramFile, Item, Node, Point, ShapeKind } from '../model.js';
import { DEFAULT_LOCALE, escapeAttr, escapeHtml, type Locale } from '@docpresenter/base';
import { isIconPath, stencilArt, textPlace } from './stencil.js';
import { isListing, listingArt } from './listing.js';
import { TABLE_PICTURE, type TableRules } from '../arrange.js';
import { members, scrollsAcross, scrollsDown, shownPage, tabPages, SCROLL_BAR, TAB_STRIP } from '../arrange.js';
import {
  arrowHead as arrowCorners, border, cylinderRadius, labelLayout, n, roundedPath, shapeOutlines,
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
  locale: Locale = DEFAULT_LOCALE,
  /**
   * Draws the links that are not drawn (`~~~`), for an editor: they have to
   * be seen to be picked. A document leaves them out.
   */
  hidden = false,
): string {
  const laid = layOutDiagram(diagram, locale);
  const byId = new Map(diagram.nodes.map(n => [n.id, n]));
  const tables = new Map(laid.tables.map(table => [table.container, table]));

  // A shape written `visible: false` keeps its room and is not drawn, nor is
  // what it holds, nor a connection to it — except for an editor, which draws
  // it faintly so it can be picked.
  const unseen = new Set<string>();
  const hide = (id: string, depth = 0): void => {
    if (unseen.has(id) || depth > 64) return;
    unseen.add(id);
    const container = diagram.containers.get(id);
    for (const one of container ? container.cells.flat() : byId.get(id)?.children ?? []) hide(one, depth + 1);
  };
  for (const node of diagram.nodes) if (isHidden(diagram.style.get(node.id))) hide(node.id);

  const behind: string[] = [];
  const front: string[] = [];
  for (const id of laid.order) {
    const node = byId.get(id);
    const box = laid.boxes.get(id);
    if (!node || !box) continue;
    if (unseen.has(id) && !hidden) continue;
    const drawn = renderNode(node, box, diagram, url, marks, tables.get(id));
    (box.z < 0 ? behind : front).push(unseen.has(id) ? drawn.replace('class="dp-node', 'class="dp-unseen dp-node') : drawn);
  }

  // Connections are drawn in two passes: every line and plate first, then every
  // label, so one connection's plate can never blank out another's label.
  const rounded = diagram.mode === 'flow';
  // A picture with its name under it is met at the picture: a line that
  // stopped at the box round both would end well short of the icon, out in
  // the words below it. Only where lines run straight between shapes — a
  // flow's square corners are worked out on the whole box.
  const ends = new Map<string, Box>();
  if (diagram.mode !== 'flow') {
    for (const node of diagram.nodes) {
      const box = laid.boxes.get(node.id);
      const art = box ? artBox(diagram, node, box) : undefined;
      if (art) ends.set(node.id, art);
    }
  }
  const drawn = laid.routes
    .filter(route => hidden || (route.edge.line !== 'invisible' && !unseen.has(route.edge.from) && !unseen.has(route.edge.to)))
    .map(route => renderEdge(route, byId, laid.boxes, rounded, marks, ends));
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
    ...laid.marks.map(renderMark),
    '</svg>',
  ].join('\n');
}

/**
 * A number or a "required" from the screen's item table. Drawn last, over
 * everything, and named by the item it belongs to rather than as a shape: it
 * is not in the file, so there is nothing to pick.
 */
function renderMark(mark: ItemMark): string {
  // Coloured here rather than by the theme: a workspace keeps its own copy of
  // the theme, made before these marks existed, and a mark it does not know
  // would be drawn as a black disc. The colours are the overlay callout's.
  const item = ` data-item="${escapeAttr(mark.id)}"`;
  const cx = mark.x + mark.width / 2;
  const cy = mark.y + mark.height / 2;
  const words = (fill: string, size: number, weight = ''): string =>
    `<text x="${n(cx)}" y="${n(cy)}" text-anchor="middle" dominant-baseline="central"`
    + ` fill="${escapeAttr(fill)}" font-size="${size}"${weight}>${escapeHtml(mark.text)}</text>`;
  if (mark.kind === 'number') {
    return `<g class="dp-item-number"${item}>`
      + (mark.width > mark.height
        ? `<rect x="${n(mark.x)}" y="${n(mark.y)}" width="${n(mark.width)}" height="${n(mark.height)}"`
          + ` rx="${n(mark.height / 2)}" fill="#ffffff" stroke="#b3261e" stroke-width="1.5"/>`
        : `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(mark.width / 2)}" fill="#ffffff" stroke="#b3261e" stroke-width="1.5"/>`)
      + `${words('#b3261e', 11)}</g>`;
  }
  // "Required" looks the way the library's `required` part says.
  const colour = (property: string): string | undefined => {
    const value = mark.style.get(property);
    return value !== undefined && COLOUR.test(value) ? value : undefined;
  };
  const fill = colour('fill');
  const line = colour('line');
  const plate = fill !== undefined || line !== undefined
    ? `<rect x="${n(mark.x)}" y="${n(mark.y)}" width="${n(mark.width)}" height="${n(mark.height)}" rx="2"`
      + ` fill="${fill ?? 'none'}" stroke="${line ?? 'none'}"/>` : '';
  return `<g class="dp-item-required"${item}>${plate}${words(colour('color') ?? '#b3261e', 14, ' font-weight="600"')}</g>`;
}

/** The diagnostics the layout pass produced, for callers that surface them. */
export function diagramDiagnostics(diagram: DiagramFile, locale: Locale = DEFAULT_LOCALE): readonly string[] {
  return layOutDiagram(diagram, locale).diagnostics;
}

function renderNode(
  node: Node, box: Box, diagram: DiagramFile, url?: (path: string) => string,
  marks?: DiagramMarks, table?: TableRules,
): string {
  const icon = diagram.style.get(node.id)?.get('icon');
  const classes = [
    'dp-node',
    `dp-shape-${node.shape}`,
    ...(icon ? ['dp-part'] : []),
    ...(node.className ? [`dp-class-${node.className}`] : []),
    ...styleClasses(diagram, node.id),
    ...(isDisabled(diagram.style.get(node.id)) ? ['dp-disabled'] : []),
    ...(marks?.nodes.get(node.id) ? [`dp-diff-${marks.nodes.get(node.id)!}`] : []),
  ];
  // A part is a picture, so no outline is drawn around it. Where its words go
  // is the picture's own business: under it for a thing with a name, inside it
  // for a control that holds a value, nowhere for a scrollbar.
  const shape = icon
    ? (table && icon === TABLE_PICTURE ? tableArt(box, table) : picture(icon, box, url, node.items))
    : shapeElement(node.shape, box, lineLook(diagram.style.get(node.id)));
  const place = textPlace(icon);
  const text = node.shape === 'group'
    ? groupLabel(box)
    : place === 'none' || node.shape === 'line' || tabPages(diagram).has(node.id)
      ? ''
      : label(withoutButton(box, icon), diagram.style.get(node.id)?.get('align'), node.shape, place === 'under', fontOf(diagram.style.get(node.id)));
  const colours = styleColours(diagram, node.id);
  const style = colours === '' ? '' : ` style="${escapeAttr(colours)}"`;
  // Words with no frame and no words — a table cell not written in yet — are
  // nothing at all, so nothing could be pressed. An unseen plate covers the
  // box. Words that are there are pressed on their letters, as before: a plate
  // under them would catch presses meant for a line drawn across their box.
  // A container's frame is the other kind of empty words; it stays see-through,
  // since what it holds and anything drawn across it are what is pressed.
  const plate = node.shape === 'text' && !icon && node.text.trim() === '' && !diagram.containers.has(node.id)
    ? `<rect class="dp-hit" x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}"`
      // Said in style, not attributes: a theme's rule for a shape's outline
      // would otherwise draw it.
      + ` style="fill: none; stroke: none" pointer-events="all"/>`
    : '';
  return `<g class="${escapeAttr(classes.join(' '))}" data-node="${escapeAttr(node.id)}"${style}>`
    + `${plate}${shape}${furniture(node, box, diagram, table)}${text}</g>`;
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
function furniture(node: Node, box: Box, diagram: DiagramFile, table?: TableRules): string {
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
  // A table's headings stay where they are while its rows scroll, so the bar
  // down the side starts under them; a footer stays under the rows, so the
  // bar ends over it.
  const down = scrollsDown(container);
  const across = scrollsAcross(container);
  const headings = table !== undefined && table.head > 0 ? table.rows[table.head - 1] : undefined;
  const footer = table !== undefined && table.foot > 0 ? table.rows[table.rows.length - table.foot] : undefined;
  const topOf = headings ?? box.y;
  const bottomOf = footer ?? box.y + box.height - (across ? SCROLL_BAR : 0);
  const bars: string[] = [];
  if (down) {
    const track = {
      x: box.x + box.width - SCROLL_BAR, y: topOf,
      width: SCROLL_BAR, height: Math.max(0, bottomOf - topOf),
    };
    const thumb = { x: track.x + 2.5, y: track.y + 3, width: SCROLL_BAR - 5, height: track.height * 0.5 };
    bars.push(scrollBar(track, thumb));
  }
  if (across) {
    const track = {
      x: box.x, y: box.y + box.height - SCROLL_BAR,
      width: box.width - (down ? SCROLL_BAR : 0), height: SCROLL_BAR,
    };
    const thumb = { x: track.x + 3, y: track.y + 2.5, width: track.width * 0.5, height: SCROLL_BAR - 5 };
    bars.push(scrollBar(track, thumb));
  }
  return `<g class="dp-scroll">${bars.join('')}</g>`;
}

/** One bar: its track and the thumb on it. */
function scrollBar(
  track: { x: number; y: number; width: number; height: number },
  thumb: { x: number; y: number; width: number; height: number },
): string {
  return `<rect class="dp-scroll-track" x="${n(track.x)}" y="${n(track.y)}"`
    + ` width="${n(track.width)}" height="${n(track.height)}"/>`
    + `<rect class="dp-scroll-thumb" x="${n(thumb.x)}" y="${n(thumb.y)}"`
    + ` width="${n(thumb.width)}" height="${n(thumb.height)}" rx="${(SCROLL_BAR - 5) / 2}"/>`;
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
    .filter(([property, value]) => !COLOUR.test(value) && !READ_HERE.includes(property)
      && !((property === 'fill' || property === 'line') && value === 'none'))
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

/**
 * A table that holds its cells: its frame, the heading rows shaded, and the
 * rules between the rows and columns where the cells say they are. The rule
 * under the headings and the one over a footer are drawn darker, and a footer
 * is shaded lightly, so a total reads as apart from the rows it sums. The
 * cells themselves are shapes, drawn on it like anything else in a container.
 */
function tableArt(box: Box, table: TableRules): string {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const headEnd = table.head > 0 ? table.rows[table.head - 1] : undefined;
  const footStart = table.foot > 0 ? table.rows[table.rows.length - table.foot] : undefined;
  const shade = headEnd === undefined ? ''
    : `<rect class="dp-table-head" x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}"`
      + ` height="${n(headEnd - box.y)}" fill="#eef0f3" stroke="none"/>`;
  const footShade = footStart === undefined ? ''
    : `<rect class="dp-table-foot" x="${n(box.x)}" y="${n(footStart)}" width="${n(box.width)}"`
      + ` height="${n(bottom - footStart)}" fill="#f6f7f9" stroke="none"/>`;
  const rows = table.rows.map((y, i) => {
    const strong = i === table.head - 1 || i === table.rows.length - table.foot;
    return `<path d="M${n(box.x)} ${n(y)} H${n(right)}"`
      + ` stroke="${strong ? '#aeb4bd' : '#d3d7dd'}" stroke-width="${strong ? 1.3 : 1}"/>`;
  }).join('');
  const columns = table.columns.map(x => `<path d="M${n(x)} ${n(box.y)} V${n(bottom)}"`
    + ` stroke="#d3d7dd" stroke-width="1"/>`).join('');
  return `<g class="dp-part-art dp-table-art">`
    + `<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}"`
    + ` fill="#ffffff" stroke="none"/>${shade}${footShade}${rows}${columns}`
    + `<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}"`
    + ` fill="none" stroke="#aeb4bd" stroke-width="1.3"/></g>`;
}

/** The room a part's picture takes at the top of its box. */
const ICON_ROOM = 44;

/**
 * How big a part's picture is drawn. The name is what a reader needs, so a
 * long name that has to wrap takes its room out of the picture rather than
 * running off the bottom of the box.
 */
/**
 * The square a part's picture is drawn in, when it is drawn as a picture over
 * its name. A control stretched over its whole box, a list drawn from its
 * rows and a shape with no picture are their whole box: undefined.
 */
function artBox(diagram: DiagramFile, node: Node, box: Box): Box | undefined {
  const icon = diagram.style.get(node.id)?.get('icon');
  if (icon === undefined || icon === TABLE_PICTURE) return undefined;
  if (isListing(icon) && node.items.length > 0) return undefined;
  if (!isIconPath(icon)) {
    const art = stencilArt(icon);
    if (!art || art.fit) return undefined;
  }
  // Only a picture with words under it is smaller than its box.
  if (box.lines.every(line => lineText(line) === '')) return undefined;
  const size = artSize(box);
  return {
    ...box,
    x: box.x + (box.width - size) / 2,
    y: box.y + Math.max(0, (box.height - LINE_HEIGHT * box.lines.length - size) / 2),
    width: size, height: size,
  };
}

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
    // How see-through a shape is: what a disabled control is faded with.
    if (property === 'opacity' && /^(0(\.\d+)?|1(\.0+)?|\.\d+)$/.test(value)) {
      parts.push(`opacity:${value}`);
      continue;
    }
    // `fill: none` lets what is behind show through — a frame round a screen.
    if (property === 'fill' && value === 'none') { parts.push('--dp-fill:none'); continue; }
    // `line: none`: no outline — a text box that only shows a value, say.
    if (property === 'line' && value === 'none') { parts.push('--dp-line:none'); continue; }
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

/** How much of a control's right end is its button — a drop-down's chevron, a spinner's arrows. */
const BUTTONS: Readonly<Record<string, number>> = { 'ui/select': 24, 'ui/spinner': 20 };

/**
 * The room a control's value has: the box less the button at its right end,
 * so a value set to the right stops before the chevron rather than under it.
 */
function withoutButton(box: Box, icon: string | undefined): Box {
  const button = icon === undefined ? 0 : BUTTONS[icon] ?? 0;
  return button === 0 ? box : { ...box, width: Math.max(0, box.width - button) };
}

function label(
  box: Box, align: string | undefined, shape: ShapeKind, underPicture = false,
  font: { size: number | undefined; family: string | undefined } = { size: undefined, family: undefined },
): string {
  const at = labelLayout(box, align, shape, underPicture ? artSize(box) : 0,
    font.size === undefined ? undefined : lineHeightFor(font.size));
  const spans = box.lines.map((line, i) =>
    `<tspan x="${n(at.x)}" y="${n(at.top + i * at.lineHeight)}">${runs(line)}</tspan>`);
  // Said in style, not attributes: the theme's size for labels would win over an attribute.
  const type = [
    ...(font.size === undefined ? [] : [`font-size:${font.size}px`]),
    ...(font.family === undefined ? [] : [`font-family:'${font.family}'`]),
  ];
  const style = type.length === 0 ? '' : ` style="${escapeAttr(type.join(';'))}"`;
  return `<text class="dp-label" text-anchor="${at.anchor}" dominant-baseline="central"${style}>`
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
      ...(run.strike || run.underline
        ? [`text-decoration="${[run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].filter(Boolean).join(' ')}"`]
        : []),
      ...(run.script ? [`baseline-shift="${run.script === 'sup' ? 'super' : 'sub'}" font-size="70%"`] : []),
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

/**
 * Where each connection is drawn: its route, with a straight line to a
 * picture moved to the picture's middle, as `renderEdge` draws it. An editor
 * picks lines by these points; the route's own runs to the middle of the box
 * round the picture and its name, below the line on screen.
 */
export function drawnRoutes(diagram: DiagramFile, laid: LaidOutDiagram): EdgeRoute[] {
  if (diagram.mode === 'flow') return [...laid.routes];
  const ends = new Map<string, Box>();
  for (const node of diagram.nodes) {
    const box = laid.boxes.get(node.id);
    const art = box ? artBox(diagram, node, box) : undefined;
    if (art) ends.set(node.id, art);
  }
  return laid.routes.map(route => {
    const from = laid.boxes.get(route.edge.from);
    const to = laid.boxes.get(route.edge.to);
    const fromArt = ends.get(route.edge.from);
    const toArt = ends.get(route.edge.to);
    if (!from || !to || route.points.length !== 2 || (!fromArt && !toArt)) return route;
    const moved = (point: Point, box: Box, art: Box | undefined): Point => (art ? {
      x: point.x + (art.x + art.width / 2) - (box.x + box.width / 2),
      y: point.y + (art.y + art.height / 2) - (box.y + box.height / 2),
    } : point);
    return { ...route, points: [moved(route.points[0]!, from, fromArt), moved(route.points[1]!, to, toArt)] };
  });
}

function renderEdge(
  route: EdgeRoute, byId: ReadonlyMap<string, Node>, boxes: ReadonlyMap<string, Box>,
  rounded: boolean, marks?: DiagramMarks, ends: ReadonlyMap<string, Box> = new Map(),
): DrawnEdge {
  const { edge } = route;
  let { points } = route;
  const from = boxes.get(edge.from);
  const to = boxes.get(edge.to);
  if (!from || !to || points.length < 2) return { geometry: '', label: '' };

  // A straight line to a picture runs to the picture's middle, keeping any
  // step aside it was given beside a second line between the same two.
  const fromArt = ends.get(edge.from);
  const toArt = ends.get(edge.to);
  if (points.length === 2 && (fromArt || toArt)) {
    const moved = (point: Point, box: Box, art: Box | undefined): Point => (art ? {
      x: point.x + (art.x + art.width / 2) - (box.x + box.width / 2),
      y: point.y + (art.y + art.height / 2) - (box.y + box.height / 2),
    } : point);
    points = [moved(points[0]!, from, fromArt), moved(points[1]!, to, toArt)];
  }
  const clipped = [...points];
  clipped[0] = border(fromArt ?? from, fromArt ? 'rect' : byId.get(edge.from)?.shape ?? 'rect', points[1]!, points[0]);
  clipped[clipped.length - 1] = border(
    toArt ?? to, toArt ? 'rect' : byId.get(edge.to)?.shape ?? 'rect',
    points[points.length - 2]!, points[points.length - 1]);

  const plate = edgeLabelBox(route);
  const change = marks?.edges.get(`${edge.from}->${edge.to}`);
  const open = `<g class="${['dp-edge', `dp-line-${edge.line}`,
    ...(change ? [`dp-diff-${change}`] : [])].join(' ')}"`
    + ` data-edge="${escapeAttr(`${edge.from}->${edge.to}`)}">`;
  const geometry = [
    open,
    // A flow turns its corners on a curve; a free drawing keeps the corners
    // its author put there.
    rounded
      ? `<path class="dp-edge-line" d="${roundedPath(clipped, undefined, route.hops)}"/>`
      : `<polyline points="${clipped.map(p => `${n(p.x)},${n(p.y)}`).join(' ')}"/>`,
    ...(edge.arrow !== 'none'
      ? [arrowHead(clipped[clipped.length - 2]!, clipped[clipped.length - 1]!)] : []),
    ...(edge.arrow === 'both' ? [arrowHead(clipped[1]!, clipped[0]!)] : []),
    ...(plate ? [labelPlate(plate)] : []),
    '</g>',
  ].join('');

  return {
    geometry,
    label: plate && route.labelAt ? open + labelText(plate, route.labelAt) + '</g>' : '',
  };
}

function arrowHead(start: Point, end: Point): string {
  const points = arrowCorners(start, end).map(p => `${n(p.x)},${n(p.y)}`).join(' ');
  return `<polygon class="dp-arrow" points="${points}"/>`;
}

/** The plate the label sits on, so the line does not run through the text. */
function labelPlate(plate: Box): string {
  return `<rect class="dp-edge-plate" x="${n(plate.x)}" y="${n(plate.y)}"`
    + ` width="${n(plate.width)}" height="${n(plate.height)}" rx="2"/>`;
}

/** The label's lines, centred on the plate as a block. */
function labelText(plate: Box, { x, y }: Point): string {
  const top = y - (plate.lines.length - 1) * EDGE_LABEL.lineHeight / 2;
  const spans = plate.lines.length === 1
    ? runs(plate.lines[0]!)
    : plate.lines.map((line, i) =>
      `<tspan x="${n(x)}" y="${n(top + i * EDGE_LABEL.lineHeight)}">${runs(line)}</tspan>`).join('');
  return `<text class="dp-edge-label" x="${n(x)}" y="${n(y)}"`
    + ` text-anchor="middle" dominant-baseline="central">${spans}</text>`;
}

