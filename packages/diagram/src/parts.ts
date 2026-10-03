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

import {
  DEFAULT_LIBRARY, DEFAULT_PARTS, ICON_LIBRARY, iconParts,
} from './default-parts.js';
import { DiagramParseError, notationOf, parseDiagram } from './parse.js';
import type { DiagramFile, Node, Part, Placement, ShapeKind } from './model.js';

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
  const open: string[] = [];

  // A library may rest on another: a system's own set says what it does
  // differently and leaves the rest to the one it was built on.
  const gather = (file: DiagramFile): void => {
    for (const path of file.uses) {
      if (open.includes(path)) {
        throw new DiagramParseError(`部品の参照が循環している: ${[...open, path].join(' → ')}`, 1);
      }
      // `use "default"` names the set shipped with the tool. It is not a file,
      // so nothing is read for it and it is there in every shell.
      const source = path === DEFAULT_LIBRARY ? DEFAULT_PARTS
        : path === ICON_LIBRARY ? iconParts()
          : read(path);
      if (source === undefined) throw new DiagramParseError(`部品の定義が読めない: ${path}`, 1);
      open.push(path);
      gather(parseDiagram(source));
      open.pop();
    }
    for (const [name, part] of file.parts) found.set(name, part);
  };

  gather(diagram);
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

  // The same size, for the shapes that have no pin to carry it. A shape in a
  // container is placed by the container and pinned nowhere, and "how big is a
  // textbox in this system" is a question only the library can answer.
  const partSizes = new Map<string, { width: number; height: number }>();
  for (const [id, name] of diagram.partOf) {
    const part = parts.get(name);
    if (part?.width === undefined || part.height === undefined) continue;
    partSizes.set(id, { width: part.width, height: part.height });
  }

  return { ...diagram, nodes, style, layout, partSizes };
}

/**
 * How big a part may be drawn on the specimen sheet, whatever its own size.
 *
 * Wide enough that the ordinary parts of a screen are shown at their true size
 * and only the outliers — a frame three hundred pixels tall — are cut down; the
 * real measurements are printed beside each one either way.
 */
const SHOWN = { width: 320, height: 56 } as const;
const ROW = { name: 130, written: 118, gap: 12, size: 76, lead: 10 } as const;
/**
 * How many parts go in one column before the sheet starts another.
 *
 * A figure is drawn whole or not at all, so a list long enough to outgrow the
 * page is a list nobody sees. Twenty-odd parts is an ordinary size for a set
 * that covers a system, so the sheet has to fold rather than the set stay small.
 */
const COLUMN = 14;

/**
 * A parts library, as a drawing of itself.
 *
 * A library has nothing to place, so there is nothing to draw — unless the
 * thing drawn is the library: each part once, at its own size, with its name
 * and its measurements beside it. That is what a reader of a design document
 * wants from the page anyway, and it keeps the question of what a part looks
 * like answered by the same renderer that draws the screens.
 */
export function specimenOf(library: DiagramFile, read: PartReader = () => undefined): DiagramFile {
  // Everything this library offers, not only what it declares. A set built on
  // another is mostly what it inherited, and a reader asking "what can I use
  // here" means all of it.
  const parts = partsOf(library, read);
  const nodes: Node[] = [];
  const layout = new Map<string, Placement>();
  const style = new Map<string, ReadonlyMap<string, string>>();
  const span = { start: 0, end: 0 };

  const all = [...parts.values()];
  const columns = Math.ceil(all.length / COLUMN);
  const rows = Math.ceil(all.length / columns);
  const columnWidth = ROW.name + ROW.gap + ROW.written + ROW.gap
    + SHOWN.width + ROW.gap + ROW.size + 36;

  let top = 0;
  let column = 0;
  let placed = 0;
  for (const part of all) {
    if (placed === rows) { placed = 0; column += 1; top = 0; }
    placed += 1;
    const indent = column * columnWidth;
    const width = Math.min(part.width ?? SHOWN.width, SHOWN.width);
    const height = Math.min(part.height ?? SHOWN.height, SHOWN.height);
    const row = Math.max(height, 20);

    const quiet = new Map([['color', '#8b929c'], ['align', 'left']]);
    const write = (suffix: string, text: string, x: number, w: number,
      declarations: ReadonlyMap<string, string>): void => {
      nodes.push({
        id: `${part.name}${suffix}`, text, shape: 'text',
        className: undefined, children: [], items: [], span,
      });
      layout.set(`${part.name}${suffix}`, {
        x: indent + x, y: top + (row - 16) / 2, width: w, height: 16, z: undefined, span,
      });
      style.set(`${part.name}${suffix}`, declarations);
    };

    write('-name', part.name, 0, ROW.name,
      new Map([['color', '#3a4048'], ['align', 'left']]));
    // How it is written. Three rectangles in three colours tell a reader
    // nothing about what decided that; `[ ]` and `ui/radio-on` do.
    write('-written', part.style.get('icon') ?? notationOf(part.shape),
      ROW.name + ROW.gap, ROW.written, quiet);

    const left = ROW.name + ROW.gap + ROW.written + ROW.gap;
    nodes.push({
      id: part.name, text: sampleOf(part.name, part.shape), shape: part.shape,
      className: undefined, children: [], items: [], span,
    });
    // Centred in its row rather than sitting at the top of it: a part shorter
    // than a row — a checkbox, a line — should line up with its own name.
    layout.set(part.name, {
      x: indent + left, y: top + (row - height) / 2, width, height, z: undefined, span,
    });
    style.set(part.name, part.style);

    write('-size', `${part.width ?? '—'}×${part.height ?? '—'}`,
      left + width + ROW.gap, ROW.size, quiet);

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
function sampleOf(name: string, shape: ShapeKind): string {
  // A line holds no words at all, so a sample sentence in one is not a sample.
  if (shape === 'line') return '';
  if (/check|radio|frame|banner|alert|panel|icon|scroll|slider|image|net-|ui-/.test(name)) return '';
  if (/^required$/.test(name)) return '*';
  if (/button|primary|secondary|danger/.test(name)) return 'ボタン';
  if (/box|field|input|area|select|spinner/.test(name)) return '入力された文字';
  return 'テキスト';
}
