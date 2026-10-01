// Applying a parts library to a drawing.
//
// A part is a name for "what an input box looks like in this system". The
// drawing says `idBox textbox:"…"` and nothing about colour or size; this is
// where that becomes a shape, a style and a box. Reading the library off a disk
// is the host's business, as everywhere else in this package, so the caller
// passes a reader and resolves the path.
//
// Applying before anything else sees the file means the renderer, the canvas,
// the PPTX writer and the PDF all work unchanged: by the time they are handed
// the drawing, a part is already an ordinary shape with an ordinary style.

import { DiagramParseError, parseDiagram } from './parse.js';
import type { DiagramFile, Node, Part, Placement } from './model.js';

/** Reads a file named by a `use` line, as written in the drawing. */
export type PartReader = (path: string) => string | undefined;

/**
 * The parts a drawing can see: the ones it uses, then the ones it declares.
 *
 * Nearest wins. A drawing that declares a part of its own overrides the
 * library's, and a later `use` overrides an earlier one — the same order a
 * reader goes down the file in.
 */
export function partsOf(diagram: DiagramFile, read: PartReader): ReadonlyMap<string, Part> {
  const found = new Map<string, Part>();
  for (const path of diagram.uses) {
    const source = read(path);
    if (source === undefined) throw new DiagramParseError(`部品の定義が読めない: ${path}`, 1);
    for (const [name, part] of parseDiagram(source).parts) found.set(name, part);
  }
  for (const [name, part] of diagram.parts) found.set(name, part);
  return found;
}

/**
 * The drawing with its parts resolved: shapes take the part's shape, styles
 * take the part's declarations under the drawing's own, and a pin with no size
 * takes the part's.
 *
 * Nothing about the file's text changes, so every byte range still points where
 * it did — a shape written as a part is still edited, moved and written back as
 * the one line it is.
 */
export function withParts(diagram: DiagramFile, read: PartReader): DiagramFile {
  if (diagram.uses.length === 0 && diagram.parts.size === 0) return diagram;
  const parts = partsOf(diagram, read);

  const nodes = diagram.nodes.map(node => {
    const name = diagram.partOf.get(node.id);
    if (name === undefined) return node;
    const part = parts.get(name);
    // A name nobody declared is a typo, and a typo that draws a plain box is a
    // typo nobody finds. The whole figure says it cannot be read, which is what
    // every other unreadable line in this format does.
    if (!part) throw new DiagramParseError(`部品が見つからない: ${name}（${node.id}）`, 1);
    return { ...node, shape: part.shape };
  });

  const style = new Map(diagram.style);
  for (const [id, name] of diagram.partOf) {
    const part = parts.get(name);
    if (!part) continue;
    // The drawing's own declarations win: a part is a starting point, not a
    // rule. (A drawing that overrides most of what it uses is telling you the
    // part is wrong.)
    style.set(id, new Map([...part.style, ...(diagram.style.get(id) ?? new Map())]));
  }

  const layout = new Map<string, Placement>(diagram.layout);
  for (const [id, placement] of diagram.layout) {
    const part = parts.get(diagram.partOf.get(id) ?? '');
    if (!part) continue;
    if (placement.width !== undefined && placement.height !== undefined) continue;
    layout.set(id, {
      ...placement,
      width: placement.width ?? part.width,
      height: placement.height ?? part.height,
    });
  }

  return { ...diagram, nodes, style, layout };
}

/**
 * How big a part may be drawn on the specimen sheet, whatever its own size.
 *
 * Wide enough that the ordinary parts of a screen are shown at their true size
 * and only the outliers — a frame three hundred pixels tall — are cut down; the
 * real measurements are printed beside each one either way.
 */
const SHOWN = { width: 320, height: 56 } as const;
const ROW = { name: 150, gap: 14, size: 76, lead: 10 } as const;

/**
 * A parts library, as a drawing of itself.
 *
 * A library has nothing to place, so there is nothing to draw — unless the
 * thing drawn is the library: each part once, at its own size, with its name
 * and its measurements beside it. That is what a reader of a design document
 * wants from the page anyway, and it keeps the question of what a part looks
 * like answered by the same renderer that draws the screens.
 */
export function specimenOf(library: DiagramFile): DiagramFile {
  const nodes: Node[] = [];
  const layout = new Map<string, Placement>();
  const style = new Map<string, ReadonlyMap<string, string>>();
  const span = { start: 0, end: 0 };

  let top = 0;
  for (const part of library.parts.values()) {
    const width = Math.min(part.width ?? SHOWN.width, SHOWN.width);
    const height = Math.min(part.height ?? SHOWN.height, SHOWN.height);
    const row = Math.max(height, 20);

    nodes.push({
      id: `${part.name}-name`, text: part.name, shape: 'text',
      className: undefined, children: [], span,
    });
    layout.set(`${part.name}-name`, {
      x: 0, y: top + (row - 18) / 2, width: ROW.name, height: 18, z: undefined, span,
    });
    style.set(`${part.name}-name`, new Map([['color', '#3a4048'], ['align', 'left']]));

    nodes.push({
      id: part.name, text: sampleOf(part.name), shape: part.shape,
      className: undefined, children: [], span,
    });
    layout.set(part.name, {
      x: ROW.name + ROW.gap, y: top, width, height, z: undefined, span,
    });
    style.set(part.name, part.style);

    const measured = `${part.width ?? '—'}×${part.height ?? '—'}`;
    nodes.push({
      id: `${part.name}-size`, text: measured, shape: 'text',
      className: undefined, children: [], span,
    });
    layout.set(`${part.name}-size`, {
      x: ROW.name + ROW.gap + width + ROW.gap, y: top + (row - 16) / 2,
      width: ROW.size, height: 16, z: undefined, span,
    });
    style.set(`${part.name}-size`, new Map([['color', '#8b929c'], ['align', 'left']]));

    top += row + ROW.lead;
  }

  return {
    ...library, mode: 'free', nodes, layout, style,
    edges: [], bends: new Map(), partOf: new Map(),
  };
}

/**
 * What to write inside a specimen, so the look can be judged with words in it.
 *
 * The parts that hold nothing come first: a checkbox is 16 pixels square, and a
 * sample sentence in it is not a sample of anything.
 */
function sampleOf(name: string): string {
  if (/check|radio|frame|banner|alert|panel|icon/.test(name)) return '';
  if (/button|primary|secondary/.test(name)) return 'ボタン';
  if (/box|field|input|area/.test(name)) return '入力された文字';
  return 'テキスト';
}
