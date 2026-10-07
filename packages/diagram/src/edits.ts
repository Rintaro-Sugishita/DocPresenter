// Editing a diagram's layout layer. Dragging a shape writes one pin, which is
// one line, which is one byte range: the semantics section is never touched by
// a move, so a diff of a moved shape is a diff of a coordinate and nothing
// else. Un-pinning is just as important as pinning — a layer that only ever
// grows is a layout nobody can hand back to the engine.

import {
  byteLength, described, LocalizedError, pastLineBreak, sliceBytes,
  type ByteSpan, type Edit, type Phrase,
} from '@docpresenter/base';
import { dgm } from './messages.js';
import { containerOf, members, EMPTY_CELL } from './arrange.js';
import type { Container, DiagramFile, Item, Node, ShapeKind } from './model.js';

export class DiagramEditError extends LocalizedError {
  constructor(message: Phrase) {
    super(message);
    this.name = 'DiagramEditError';
  }
}

/** Where a shape sits, as the file records it. Sizes are optional as ever. */
export interface Pin {
  readonly x: number;
  readonly y: number;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly z?: number | undefined;
}

/**
 * Pins a shape where it now sits. An existing pin is rewritten in place, so the
 * line keeps the alignment the author gave it; a shape with none gains one line
 * at the end of the layout block.
 */
export function pinNode(file: DiagramFile, source: string, id: string, pin: Pin): Edit {
  return pinNodes(file, source, new Map([[id, pin]]));
}

/**
 * Pins several shapes at once — dragging a group moves everything inside it,
 * and that has to reach the file as one change. Lines that exist are rewritten
 * where they are; the rest are added together at the end of the layout block.
 */
export function pinNodes(
  file: DiagramFile, source: string, pins: ReadonlyMap<string, Pin>,
): Edit {
  if (pins.size === 0) throw new DiagramEditError(dgm('diagram.edit.nothingToMove'));
  const changes: Change[] = [];
  const added: string[] = [];
  let anyNew = false;

  for (const [id, pin] of pins) {
    if (!file.nodes.some(node => node.id === id)) {
      throw new DiagramEditError(dgm('diagram.edit.missingShape', { id }));
    }
    const existing = file.layout.get(id);
    if (existing) {
      const like = sliceBytes(source, existing.span.start, existing.span.end);
      // Moving a shape moves it. A size or a depth the author set stays set.
      const merged: Pin = {
        x: pin.x, y: pin.y,
        width: pin.width ?? existing.width,
        height: pin.height ?? existing.height,
        z: pin.z ?? existing.z,
      };
      changes.push({ span: existing.span, text: formatPlacement(id, merged, like) });
      continue;
    }
    anyNew = true;
    added.push(formatPlacement(id, pin, undefined, idWidth(file)));
  }

  if (added.length > 0) {
    if (file.layoutBlock) {
      const { insertAt, indent } = file.layoutBlock;
      changes.push({
        span: { start: insertAt, end: insertAt },
        text: added.map(line => `\n${indent}${line}`).join(''),
      });
    } else {
      // No layout block yet: start one after everything else in the file.
      const end = byteLength(source.replace(/\s+$/, ''));
      changes.push({
        span: { start: end, end: byteLength(source) },
        text: `\n\nlayout {\n${added.map(line => `  ${line}\n`).join('')}}\n`,
      });
    }
  }
  return splice(source, changes, anyNew ? dgm('diagram.did.pin') : dgm('diagram.did.move'));
}

/**
 * Writes the corners a connection turns through. An empty list removes the
 * line, which is how a bend is taken out again: the same gesture that made it
 * puts the connection back on a straight path.
 */
export function bendEdge(
  file: DiagramFile, source: string, from: string, to: string,
  points: readonly { readonly x: number; readonly y: number }[],
): Edit {
  if (!file.edges.some(e => e.from === from && e.to === to)) {
    throw new DiagramEditError(dgm('diagram.edit.missingLine', { from, to }));
  }
  const existing = file.bends.get(`${from}->${to}`);
  const line = `${from} -> ${to} @ `
    + points.map(p => `(${Math.round(p.x)}, ${Math.round(p.y)})`).join('; ');

  if (points.length === 0) {
    if (!existing) throw new DiagramEditError(dgm('diagram.edit.notBent', { from, to }));
    return splice(source, [whole(source, existing.span, '')], dgm('diagram.did.dropBend'));
  }
  if (existing) {
    return { span: existing.span, text: line, ...described(dgm('diagram.did.moveBend')) };
  }
  if (file.layoutBlock) {
    const { insertAt, indent } = file.layoutBlock;
    return {
      span: { start: insertAt, end: insertAt },
      text: `\n${indent}${line}`,
      ...described(dgm('diagram.did.bend')),
    };
  }
  const end = byteLength(source.replace(/\s+$/, ''));
  return {
    span: { start: end, end: byteLength(source) },
    text: `\n\nlayout {\n  ${line}\n}\n`,
    ...described(dgm('diagram.did.bend')),
  };
}

/** Everything a group holds, including what the groups inside it hold. */
export function groupMembers(file: DiagramFile, id: string): string[] {
  const seen = new Set<string>();
  const walk = (name: string): void => {
    const node = file.nodes.find(n => n.id === name);
    for (const child of node?.children ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      walk(child);
    }
  };
  walk(id);
  return [...seen];
}

/**
 * Hands a shape back to the layout engine by removing its line. Only a diagram
 * that has an engine can take it back: in a freely placed drawing the pin is
 * the only thing that says where the shape is, so removing it would leave the
 * shape with nowhere to be. A group is the exception in any mode — its box is
 * computed from what it contains.
 */
export function unpinNode(file: DiagramFile, source: string, id: string): Edit {
  const existing = file.layout.get(id);
  if (!existing) throw new DiagramEditError(dgm('diagram.edit.alreadyAuto', { id }));
  if (!canUnpin(file, id)) {
    throw new DiagramEditError(dgm('diagram.edit.freeNeedsPin', { id }));
  }
  // The span starts after the indent, so take the indent with it: leaving it
  // behind would push the next line sideways.
  const before = sliceBytes(source, 0, existing.span.start);
  const indent = /[ \t]*$/.exec(before)?.[0] ?? '';
  return {
    span: {
      start: existing.span.start - indent.length,
      end: pastLineBreak(source, existing.span.end),
    },
    text: '',
    ...described(dgm('diagram.did.unpin')),
  };
}

/** Whether a shape has somewhere to go once its pin is gone. */
export function canUnpin(file: DiagramFile, id: string): boolean {
  if (!file.layout.has(id)) return false;
  const node = file.nodes.find(n => n.id === id);
  // A shape a container holds has somewhere to go back to, even in a drawing
  // placed by hand: the container will put it where it belongs.
  return file.mode === 'flow' || node?.shape === 'group' || containerOf(file).has(id);
}

/** Where a callout's marker sits and what it points at, in image pixels. */
export interface CalloutAt {
  readonly x: number;
  readonly y: number;
  readonly targetX: number;
  readonly targetY: number;
}

/** Moves one callout. The wording is not touched, only the two points. */
export function moveCallout(
  file: DiagramFile, source: string, marker: string, to: CalloutAt,
): Edit {
  const callout = file.callouts.find(c => c.marker === marker);
  if (!callout) throw new DiagramEditError(dgm('diagram.edit.missingCallout', { marker }));
  const like = sliceBytes(source, callout.span.start, callout.span.end);
  const text = `${padTo(marker, markerWidth(file))}@ (${round(to.x)}, ${round(to.y)})`
    + ` -> (${round(to.targetX)}, ${round(to.targetY)})`
    + (callout.text === '' ? '' : `  "${callout.text}"`);
  return {
    span: callout.span,
    text: keepColumns(text, like),
    ...described(dgm('diagram.did.moveCallout')),
  };
}

/**
 * One pin as a line. `like` is the line being replaced: its spacing is copied
 * so that a hand-aligned layout block stays aligned after a drag.
 */
export function formatPlacement(
  id: string, pin: Pin, like?: string, idWidth?: number,
): string {
  const size = pin.width !== undefined && pin.height !== undefined
    ? ` ${round(pin.width)}x${round(pin.height)}` : '';
  const z = pin.z !== undefined ? `  z:${pin.z}` : '';
  const text = `${padTo(id, idWidth ?? id.length + 1)}@ (${round(pin.x)}, ${round(pin.y)})${size}${z}`;
  return like === undefined ? text : keepColumns(text, like);
}

/**
 * Rewrites the new line with the old one's columns: the name is padded to the
 * same width and each number is right-aligned in the field it had. Only spacing
 * is taken from the old line, never a value.
 */
function keepColumns(text: string, like: string): string {
  const name = /^(\S+\s*)(?=@)/.exec(like)?.[1];
  let out = name === undefined ? text : text.replace(/^\S+\s*(?=@)/, m => padTo(m.trim(), name.length));

  const fields = numberFields(like);
  if (fields.length === 0) return out;
  const original = out;
  let index = 0;
  // The generated line already carries one space after each comma, so the
  // whole space-and-number run is what gets widened to the old field.
  return original.replace(/(\s*)(-?\d+)/g, (whole, spaces: string, _number: string, offset: number) => {
    if (!inColumn(original, offset + spaces.length)) return whole;
    const field = fields[index++];
    if (field === undefined || whole.length >= field) return whole;
    return ' '.repeat(field - whole.length) + whole;
  });
}

/** The width each number occupies in a line, counting the spaces before it. */
function numberFields(like: string): readonly number[] {
  return [...like.matchAll(/(\s*)(-?\d+)/g)]
    .filter(m => inColumn(like, m.index + m[1]!.length))
    .map(m => m[1]!.length + m[2]!.length);
}

/**
 * True when a number stands in a column of its own. The height in `380x330` and
 * the depth in `z:-1` follow something else, so padding them would only push
 * the line about.
 */
function inColumn(line: string, at: number): boolean {
  return !/[A-Za-z:]$/.test(line.slice(0, at));
}

/** The width the names occupy in the layout block, so a new line lines up. */
function width(file: DiagramFile): number {
  let widest = 0;
  for (const id of file.layout.keys()) widest = Math.max(widest, id.length);
  return widest + 1;
}

function markerWidth(file: DiagramFile): number {
  let widest = 0;
  for (const callout of file.callouts) widest = Math.max(widest, callout.marker.length);
  return widest + 1;
}

function padTo(text: string, width: number): string {
  return text + ' '.repeat(Math.max(1, width - text.length));
}

/** Coordinates are whole numbers. Nobody drags a shape by half a pixel. */
function round(value: number): number {
  return Math.round(value);
}

// --- 図形の追加・削除・書き換え ------------------------------------------
//
// These touch the semantics layer, which is the part a human writes. So the
// rules are stricter than for a move: the line keeps the notation the author
// would have typed, and nothing else in the file is rewritten to suit it.

/** The brackets that say what a shape is, as the parser reads them back. */
const BRACKETS: Readonly<Record<ShapeKind, readonly [string, string]>> = {
  rect: ['[', ']'],
  'round-rect': ['(', ')'],
  stadium: ['([', '])'],
  cylinder: ['[(', ')]'],
  ellipse: ['((', '))'],
  diamond: ['{', '}'],
  note: ['>', ']'],
  text: ['"', '"'],
  group: ['[', ']'],
  parallelogram: ['[/', '/]'],
  hexagon: ['{{', '}}'],
  'loop-start': ['[/', '\\]'],
  'loop-end': ['[\\', '/]'],
  // A line is written as the connector it is drawn like, and has nothing to
  // put between a pair: the text it would hold is never drawn.
  line: ['--', ''],
};

/** What a new shape of each kind is called, before anyone renames it. */
const BASE: Readonly<Record<ShapeKind, string>> = {
  rect: 'box', 'round-rect': 'box', stadium: 'pill', cylinder: 'store',
  ellipse: 'oval', diamond: 'branch', note: 'note', text: 'label', group: 'group',
  parallelogram: 'io', hexagon: 'prep', 'loop-start': 'loop', 'loop-end': 'loopEnd',
  line: 'rule',
};

/** Parts are named for what they are, not for the shape that carries them. */
const PART_BASE = 'part';

export interface NewShape {
  readonly shape: ShapeKind;
  readonly text: string;
  /** Where to pin it. A freely placed drawing needs one; a flow does not. */
  readonly at?: { readonly x: number; readonly y: number } | undefined;
  /**
   * A picture to draw instead of an outline — a part from the library, or a
   * path to an image file. It is a look, so it goes in the style section.
   */
  readonly icon?: string | undefined;
  /**
   * A part of the library to write it as — `idBox textbox:"…"`.
   *
   * Not the same thing as an icon: a part says the shape, the look and the
   * size in one word the library owns, so nothing of it is written here.
   */
  readonly part?: string | undefined;
  /**
   * The container to put it in, instead of a pin: the arrangement decides
   * where it goes, the way it decides for everything else already in there.
   */
  readonly into?: { readonly container: string; readonly after?: string | undefined } | undefined;
}

/**
 * Adds a shape: one line in the semantics section, and — when the drawing
 * places by hand — one line in the layout section, since there is no engine to
 * decide where it goes. Both land in the same edit, so one gesture is one
 * change however many lines it took.
 */
export function addNode(file: DiagramFile, source: string, shape: NewShape): Edit {
  if (!file.body) throw new DiagramEditError(dgm('diagram.edit.noBody'));
  const named = shape.part !== undefined;
  const id = nextShapeId(file, shape.icon === undefined && !named ? shape.shape : 'part');
  const [open, close] = BRACKETS[shape.shape];
  // A line has nowhere to keep words, so it is written with none — whatever
  // placeholder the caller hands every other shape.
  const text = shape.shape === 'line' ? '' : shape.text;
  const written = named
    ? `${shape.part}:${text === '' ? '' : `"${text}"`}`
    : `${open}${text}${close}`;
  const changes: Change[] = [{
    span: { start: file.body.insertAt, end: file.body.insertAt },
    text: `\n${file.body.indent}${id} ${written}`,
  }];
  // Sections the file does not have yet are written once, after everything
  // else: two separate appends would both claim the end of the file.
  const tail: string[] = [];

  // Into an arrangement, or at a coordinate — never both: a pin would win
  // over the container that was just asked to place it.
  if (shape.into) {
    const container = file.containers.get(shape.into.container);
    if (!container) throw new DiagramEditError(dgm('diagram.edit.missingContainer', { id: shape.into.container }));
    changes.push({
      span: container.span,
      text: containerText(container,
        sliceBytes(source, container.span.start, container.span.end),
        joined(container, id, shape.into.after)),
    });
  } else if (shape.at) {
    const line = formatPlacement(id, shape.at, undefined, idWidth(file));
    if (file.layoutBlock) {
      changes.push({
        span: { start: file.layoutBlock.insertAt, end: file.layoutBlock.insertAt },
        text: `\n${file.layoutBlock.indent}${line}`,
      });
    } else {
      tail.push(`layout {\n  ${line}\n}`);
    }
  }

  if (shape.icon !== undefined) {
    const line = `${id} { icon: ${shape.icon} }`;
    if (file.styleBlock) {
      changes.push({
        span: { start: file.styleBlock.insertAt, end: file.styleBlock.insertAt },
        text: `\n${file.styleBlock.indent}${line}`,
      });
    } else {
      tail.push(`style {\n  ${line}\n}`);
    }
  }

  if (tail.length > 0) {
    const end = byteLength(source.replace(/\s+$/, ''));
    changes.push({
      span: { start: end, end: byteLength(source) },
      text: `\n\n${tail.join('\n\n')}\n`,
    });
  }
  return splice(source, changes,
    shape.icon === undefined && !named ? dgm('diagram.did.addShape') : dgm('diagram.did.addPart'));
}

/** Removes several shapes as one change. */
export function removeNodes(file: DiagramFile, source: string, ids: readonly string[]): Edit {
  if (ids.length === 0) throw new DiagramEditError(dgm('diagram.edit.nothingToDelete'));
  return splice(
    source, removalOf(file, source, ids),
    ids.length === 1 ? dgm('diagram.did.deleteShape') : dgm('diagram.did.deleteShapes'),
  );
}

/**
 * Makes a group of the shapes given. A group is a line in the semantics layer
 * like any other shape, holding the names of what it contains — so grouping
 * adds one line and moves nothing.
 */
export function groupNodes(
  file: DiagramFile, source: string, ids: readonly string[], text: string,
): Edit {
  if (!file.body) throw new DiagramEditError(dgm('diagram.edit.noBody'));
  if (ids.length < 2) throw new DiagramEditError(dgm('diagram.edit.pickTwo'));
  for (const id of ids) find(file, id);
  const id = nextShapeId(file, 'group');
  return splice(source, [{
    span: { start: file.body.insertAt, end: file.body.insertAt },
    text: `\n${file.body.indent}group ${id} "${text}" { ${ids.join('; ')} }`,
  }], dgm('diagram.did.group'));
}

/**
 * Removes a shape and everything that referred to it: its pin, the connections
 * at either end of it, and its name inside a group. A file left pointing at a
 * shape that is gone renders as a warning, which is not what "delete" means.
 */
export function removeNode(file: DiagramFile, source: string, id: string): Edit {
  return removeNodes(file, source, [id]);
}

/**
 * Every line that goes when these shapes go. The group lines are worked out
 * over the whole set at once: a group holding two of them has to lose both
 * names, and rewriting it once per name would put the other one back.
 */
function removalOf(file: DiagramFile, source: string, ids: readonly string[]): Change[] {
  const going = new Set<string>();
  for (const id of ids) {
    if (!file.nodes.some(n => n.id === id)) throw new DiagramEditError(dgm('diagram.edit.missingShape', { id }));
    going.add(id);
  }

  const changes: Change[] = [];
  for (const node of file.nodes) {
    if (going.has(node.id)) {
      changes.push(whole(source, node.span, ''));
      const pin = file.layout.get(node.id);
      if (pin) changes.push(whole(source, pin.span, ''));
      continue;
    }
    if (node.shape !== 'group' || !node.children.some(child => going.has(child))) continue;
    changes.push({
      span: node.span,
      text: groupLine(node, node.children.filter(child => !going.has(child))),
    });
  }
  for (const edge of file.edges) {
    if (!going.has(edge.from) && !going.has(edge.to)) continue;
    changes.push(whole(source, edge.span, ''));
    const bend = file.bends.get(`${edge.from}->${edge.to}`);
    if (bend) changes.push(whole(source, bend.span, ''));
  }
  // A container naming a shape that is gone is a container nobody can read.
  // The same rule as a group's membership and a connection's ends: deleting
  // means deleting what pointed at it.
  for (const container of file.containers.values()) {
    if (going.has(container.id)) {
      changes.push(whole(source, container.span, ''));
      continue;
    }
    if (!members(container).some(name => going.has(name))) continue;
    // A grid keeps its shape — a cell that lost its shape becomes an empty
    // cell, because the ones beside it did not move — while a stack is a list,
    // so the name simply goes.
    const left = container.cells.map(row =>
      row.map(cell => (going.has(cell) ? EMPTY_CELL : cell)));
    changes.push({
      span: container.span,
      text: containerText(
        container, sliceBytes(source, container.span.start, container.span.end), left),
    });
  }
  return changes;
}

/**
 * Puts a container's cells in a new order — what dragging one of the shapes it
 * holds to another place in it comes to.
 *
 * One line of the file, or one block of it: the shapes themselves are not
 * touched, because nothing about them changed. Where they sit was the
 * container's to say and it is still the container saying it.
 */
export function setContainerCells(
  file: DiagramFile, source: string, id: string, cells: readonly (readonly string[])[],
): Edit {
  const container = file.containers.get(id);
  if (!container) throw new DiagramEditError(dgm('diagram.edit.missingContainer', { id }));
  const text = sliceBytes(source, container.span.start, container.span.end);
  const written = containerText(container, text, cells);
  if (written === text) throw new DiagramEditError(dgm('diagram.edit.sameOrder'));
  return { span: container.span, text: written, ...described(dgm('diagram.did.reorder')) };
}

/**
 * The cells with one more name in them.
 *
 * A stack takes it after the one that was picked, which is where somebody
 * looking at that one expects the next thing to appear. A grid takes it into
 * the first cell nobody is using; with none free the grid grows by a row,
 * because the alternative is refusing to add anything at all to a full one.
 */
function joined(
  container: Container, id: string, after: string | undefined,
): readonly (readonly string[])[] {
  if (container.kind === 'grid') {
    const row = container.cells.findIndex(cells => cells.includes(EMPTY_CELL));
    if (row < 0) {
      const width = Math.max(1, ...container.cells.map(cells => cells.length));
      return [...container.cells,
        [id, ...Array.from({ length: width - 1 }, () => EMPTY_CELL)]];
    }
    const col = container.cells[row]!.indexOf(EMPTY_CELL);
    return container.cells.map((cells, r) =>
      cells.map((cell, c) => (r === row && c === col ? id : cell)));
  }
  const held = [...members(container)];
  const at = after === undefined ? -1 : held.indexOf(after);
  held.splice(at < 0 ? held.length : at + 1, 0, id);
  return container.flow === 'down' ? held.map(one => [one]) : [held];
}

/**
 * Puts a shape into a container: its name joins the cells, and its pin goes.
 *
 * The two go together or not at all. A name in the cells with a pin still on
 * the shape is the rule "a pin wins" applied to a shape somebody just dropped
 * into a row — it would land in the arrangement and be drawn somewhere else.
 */
export function putIntoContainer(
  file: DiagramFile, source: string, name: string,
  cells: readonly (readonly string[])[], id: string,
): Edit {
  const container = file.containers.get(name);
  if (!container) throw new DiagramEditError(dgm('diagram.edit.missingContainer', { id: name }));
  find(file, id);
  if (containerOf(file).get(id) === name) throw new DiagramEditError(dgm('diagram.edit.alreadyIn', { id, name }));
  const text = sliceBytes(source, container.span.start, container.span.end);
  const changes: Change[] = [
    { span: container.span, text: containerText(container, text, cells) },
  ];
  const pin = file.layout.get(id);
  if (pin) {
    // The indent goes with the line, as everywhere else: leaving it behind
    // would push whatever follows sideways.
    const indent = /[ \t]*$/.exec(sliceBytes(source, 0, pin.span.start))?.[0] ?? '';
    changes.push({
      span: {
        start: pin.span.start - indent.length,
        end: pastLineBreak(source, pin.span.end),
      },
      text: '',
    });
  }
  return splice(source, changes, dgm('diagram.did.putInto'));
}

/**
 * The container's own text with another set of cells in it.
 *
 * The settings and the way it was written are kept — one line stays one line,
 * a block stays a block at its own indent: this is a move, not a reformatting.
 */
function containerText(
  container: Container, text: string, cells: readonly (readonly string[])[],
): string {
  const open = text.indexOf('{');
  const head = text.slice(0, open + 1);
  const rows = cells
    .map(row => row.filter(cell => container.kind === 'grid' || cell !== EMPTY_CELL))
    .filter(row => row.length > 0 && row.some(cell => cell !== EMPTY_CELL));

  if (!text.includes('\n')) return `${head} ${rows.map(row => row.join(' ; ')).join(' ; ')} }`;
  const indent = /\n(\s*)\S/.exec(text)?.[1] ?? '  ';
  const close = /\n(\s*)\}$/.exec(text)?.[1] ?? '';
  return `${head}\n${rows.map(row => indent + row.join(' ; ')).join('\n')}\n${close}}`;
}

/**
 * Rewrites what a shape says. The shape and the id are left alone — and a
 * group is written as a group, not turned into a box with a list of names for
 * a label.
 */
export function setNodeText(
  file: DiagramFile, id: string, text: string, source?: string,
): Edit {
  const node = find(file, id);
  const line = node.shape === 'group'
    ? groupLine({ ...node, text }, node.children)
    : nodeLine(node, node.shape, text, gapOf(node, source));
  return { span: node.span, text: line, ...described(dgm('diagram.did.text')) };
}

/**
 * The spaces the author put between the id and the shape, so that renaming
 * something does not pull one line out of a column the rest of the block is
 * lined up in. Diffs are the point of this format; a line that moves sideways
 * for no reason is a line a reviewer has to read.
 */
function gapOf(node: Node, source: string | undefined): string {
  if (source === undefined) return ' ';
  const line = sliceBytes(source, node.span.start, node.span.end);
  const gap = new RegExp(`^${node.id}(\\s+)`).exec(line);
  return gap?.[1] ?? ' ';
}

/**
 * Changes a shape's look: declarations in, or out, of its own style rule.
 *
 * The style layer is where "how it is drawn" lives, so a canvas that lets
 * someone thicken a line or turn its arrow off writes here and nowhere else —
 * the semantics line keeps saying what the shape is. A value of `undefined`
 * takes a declaration out, and a rule with nothing left in it goes with it: a
 * shape carrying an empty `{ }` is a line a reviewer has to read for nothing.
 */
export function setNodeStyle(
  file: DiagramFile, source: string, id: string,
  declarations: Readonly<Record<string, string | undefined>>,
): Edit {
  find(file, id);
  const merged = new Map(file.style.get(id) ?? []);
  let moved = false;
  for (const [property, value] of Object.entries(declarations)) {
    // Written out rather than with `||=`: that short-circuits, and the thing on
    // its right is the deletion itself — the second one would never happen.
    if (value === undefined) {
      if (merged.delete(property)) moved = true;
      continue;
    }
    if (merged.get(property) !== value) moved = true;
    merged.set(property, value);
  }
  if (!moved) throw new DiagramEditError(dgm('diagram.edit.sameLook'));

  const span = file.styleSpans.get(id);
  const written = [...merged].map(([property, value]) => `${property}: ${value}`).join(', ');
  const line = `${id}${styleGap(file, source, id)}{ ${written} }`;

  if (span) {
    return splice(source, [merged.size === 0
      ? whole(source, span, '')
      : { span, text: line }], dgm('diagram.did.look'));
  }
  if (file.styleBlock) {
    return splice(source, [{
      span: { start: file.styleBlock.insertAt, end: file.styleBlock.insertAt },
      text: `\n${file.styleBlock.indent}${line}`,
    }], dgm('diagram.did.look'));
  }
  // No style section yet: one is written at the end, the way adding a shape to
  // a file with no layout section writes that one.
  const end = byteLength(source.replace(/\s+$/, ''));
  return splice(source, [{
    span: { start: end, end: byteLength(source) },
    text: `\n\nstyle {\n  ${line}\n}\n`,
  }], dgm('diagram.did.look'));
}

/** The spaces the author left between the id and its `{`, for the same reason. */
function styleGap(file: DiagramFile, source: string, id: string): string {
  const span = file.styleSpans.get(id);
  if (!span) return ' ';
  const line = sliceBytes(source, span.start, span.end);
  return new RegExp(`^${id}(\\s+)\\{`).exec(line)?.[1] ?? ' ';
}

/**
 * Rewrites the rows of a tree, a list or a menu.
 *
 * The rows are the one thing in this format that a single shape spans several
 * lines for, so they are written back together: the block from the `{` to the
 * `}` is one byte range, and a diff still shows only the lines that changed.
 * How the author indented is kept — two spaces or four, this is an edit, not a
 * reformatting.
 */
export function setItems(
  file: DiagramFile, source: string, id: string, items: readonly Item[],
): Edit {
  const node = find(file, id);
  const text = sliceBytes(source, node.span.start, node.span.end);
  const open = text.indexOf('{');
  const head = open < 0 ? `${text.trimEnd()} {` : text.slice(0, open + 1);
  // A list with nothing in it is written without a block at all: an empty pair
  // of braces is a thing someone would have to read and then ignore.
  if (items.length === 0) {
    const bare = head.replace(/\s*\{$/, '');
    if (bare === text) throw new DiagramEditError(dgm('diagram.edit.alreadyEmpty'));
    return { span: node.span, text: bare, ...described(dgm('diagram.did.items')) };
  }

  const lines = text.split('\n');
  const rows = lines.slice(1, -1).filter(one => one.trim() !== '');
  const indents = [...new Set(rows.map(one => one.length - one.trimStart().length))].sort(
    (a, b) => a - b);
  const own = /[ \t]*$/.exec(sliceBytes(source, 0, node.span.start))?.[0] ?? '';
  const base = indents[0] ?? own.length + 2;
  const step = (indents[1] ?? base + 2) - base;
  const close = lines.length > 1 ? /^\s*/.exec(lines[lines.length - 1] ?? '')?.[0] ?? own : own;

  const written = items.map(item =>
    ' '.repeat(base + Math.max(0, item.depth) * Math.max(1, step))
    + `${item.closed ? '+' : '-'} ${item.text}${item.picked ? ' *' : ''}`);
  const next = `${head}\n${written.join('\n')}\n${close}}`;
  if (next === text) throw new DiagramEditError(dgm('diagram.edit.sameItems'));
  return { span: node.span, text: next, ...described(dgm('diagram.did.items')) };
}

/** Rewrites which shape it is, by changing the brackets around the text. */
export function setNodeShape(file: DiagramFile, id: string, shape: ShapeKind): Edit {
  const node = find(file, id);
  if (node.shape === 'group') throw new DiagramEditError(dgm('diagram.edit.groupShape'));
  // The shape's range covers the rows as well, so writing one line over it
  // would take them with it. Rows belong to a part; stop rather than drop.
  if (node.items.length > 0) throw new DiagramEditError(dgm('diagram.edit.rowsShape'));
  // A shape written as a part stops being one: the part said what it looked
  // like, and what it looks like is what was just chosen. Said in the
  // description, because an edit that quietly drops a word is one nobody finds.
  return {
    span: node.span, text: nodeLine(node, shape, node.text),
    ...described(file.partOf.has(id) ? dgm('diagram.did.unpart') : dgm('diagram.did.shape')),
  };
}

/**
 * Rewrites which part a shape is written as — `select:` becomes `checkbox:`.
 *
 * One token on one line, so the words, the rows, the class and everything in
 * the other two layers stay exactly as they were. A shape that was not written
 * as a part becomes one, keeping its words: that is the same question asked
 * from the other side ("make this box a text field").
 */
export function setNodePart(file: DiagramFile, source: string, id: string, name: string): Edit {
  const node = find(file, id);
  if (node.shape === 'group') throw new DiagramEditError(dgm('diagram.edit.groupPart'));
  if (file.partOf.get(id) === name) throw new DiagramEditError(dgm('diagram.edit.alreadyPart', { id, name }));

  const whole = sliceBytes(source, node.span.start, node.span.end);
  const head = whole.slice(0, whole.indexOf('\n') < 0 ? whole.length : whole.indexOf('\n'));
  const written = head.slice(node.id.length);
  const gap = /^\s*/.exec(written)?.[0] ?? ' ';
  const rest = written.slice(gap.length);

  // A part is named by the one token before the colon, so changing it is
  // changing that token — whatever follows it (a label, the brace that opens
  // the rows) is this shape's own and stays.
  const token = file.partOf.has(id) ? /^[A-Za-z0-9_-]+:/.exec(rest) : undefined;
  const line = token
    ? `${node.id}${gap}${name}:${rest.slice(token[0].length)}`
    : `${node.id}${gap}${name}:${node.text === '' ? '' : `"${node.text}"`}`
      + (node.className === undefined ? '' : `:::${node.className}`);
  return {
    span: { start: node.span.start, end: node.span.start + byteLength(head) },
    text: line,
    ...described(token ? dgm('diagram.did.changePart') : dgm('diagram.did.makePart')),
  };
}

/** Draws a connection. One line at the end of the semantics section. */
export function connectNodes(file: DiagramFile, source: string, from: string, to: string): Edit {
  if (!file.body) throw new DiagramEditError(dgm('diagram.edit.noBody'));
  find(file, from);
  find(file, to);
  if (from === to) throw new DiagramEditError(dgm('diagram.edit.selfLoop'));
  if (file.edges.some(e => e.from === from && e.to === to)) {
    throw new DiagramEditError(dgm('diagram.edit.alreadyConnected', { from, to }));
  }
  return splice(source, [{
    span: { start: file.body.insertAt, end: file.body.insertAt },
    text: `\n${file.body.indent}${from} --> ${to}`,
  }], dgm('diagram.did.connect'));
}

/**
 * Moves one end of a connection to another shape. The line is rewritten from
 * its own text, so the connector, the label and the spacing the author chose
 * all survive a re-attachment.
 */
export function reconnect(
  file: DiagramFile, source: string, edge: { from: string; to: string },
  ends: { readonly from?: string; readonly to?: string },
): Edit {
  const found = file.edges.find(e => e.from === edge.from && e.to === edge.to);
  if (!found) throw new DiagramEditError(dgm('diagram.edit.missingLine', { from: edge.from, to: edge.to }));
  const from = ends.from ?? found.from;
  const to = ends.to ?? found.to;
  if (from === to) throw new DiagramEditError(dgm('diagram.edit.selfLoop'));
  find(file, from);
  find(file, to);
  if (from !== found.from || to !== found.to) {
    if (file.edges.some(e => e.from === from && e.to === to)) {
      throw new DiagramEditError(dgm('diagram.edit.alreadyConnected', { from, to }));
    }
  }
  const line = sliceBytes(source, found.span.start, found.span.end);
  const written = line.replace(
    /^(\S+)(\s*)(-->|->|--|-\.->)(\s*)(\S+)/,
    (_whole, _a, before: string, arrow: string, after: string) =>
      `${from}${before}${arrow}${after}${to}`,
  );
  const changes: Change[] = [{ span: found.span, text: written }];

  // The corners belong to this line, so they follow it to its new name. They
  // may want moving afterwards, but dropping them would be losing something
  // the author put there by hand.
  const bend = file.bends.get(`${found.from}->${found.to}`);
  if (bend) {
    changes.push({
      span: bend.span,
      text: `${from} -> ${to} @ ` + bend.points.map(p => `(${p.x}, ${p.y})`).join('; '),
    });
  }
  return splice(source, changes, dgm('diagram.did.reconnect'));
}

/** Removes one connection, named by its two ends. */
export function disconnectNodes(
  file: DiagramFile, source: string, from: string, to: string,
): Edit {
  const edge = file.edges.find(e => e.from === from && e.to === to);
  if (!edge) throw new DiagramEditError(dgm('diagram.edit.missingLine', { from, to }));
  const changes: Change[] = [whole(source, edge.span, '')];
  const bend = file.bends.get(`${from}->${to}`);
  // The corners were corners of this line. With the line gone they name
  // nothing, and a layout line naming nothing is a line nobody can read.
  if (bend) changes.push(whole(source, bend.span, ''));
  return splice(source, changes, dgm('diagram.did.disconnect'));
}

function find(file: DiagramFile, id: string): Node {
  const node = file.nodes.find(n => n.id === id);
  if (!node) throw new DiagramEditError(dgm('diagram.edit.missingShape', { id }));
  return node;
}

function nodeLine(node: Node, shape: ShapeKind, text: string, gap = ' '): string {
  const [open, close] = BRACKETS[shape];
  const name = node.className === undefined ? '' : `:::${node.className}`;
  return `${node.id}${gap}${open}${text}${close}${name}`;
}

function groupLine(group: Node, children: readonly string[]): string {
  return `group ${group.id} "${group.text}" { ${children.join('; ')} }`;
}

/**
 * The name the next shape of this kind will get: a name nobody else is using,
 * numbered so it stays readable in a diff. Exported so the caller can select
 * what it just added — the same file and the same kind always give the same
 * answer.
 */
export function nextShapeId(file: DiagramFile, shape: ShapeKind | 'part'): string {
  const base = shape === 'part' ? PART_BASE : BASE[shape];
  const taken = new Set(file.nodes.map(n => n.id));
  for (let n = 1; ; n++) {
    const id = `${base}${n}`;
    if (!taken.has(id)) return id;
  }
}

function idWidth(file: DiagramFile): number {
  let widest = 0;
  for (const id of file.layout.keys()) widest = Math.max(widest, id.length);
  return widest + 1;
}

/** One line with its indent and its newline, so removing it removes a line. */
function whole(source: string, span: ByteSpan, text: string): Change {
  const before = sliceBytes(source, 0, span.start);
  const indent = /[ \t]*$/.exec(before)?.[0] ?? '';
  return {
    span: {
      start: span.start - indent.length,
      end: pastLineBreak(source, span.end),
    },
    text,
  };
}

interface Change {
  readonly span: ByteSpan;
  readonly text: string;
}

/**
 * Several line changes as one edit. The range covers only what is touched, and
 * everything between the touched lines is carried over unchanged — so a diff
 * still shows the lines that changed and nothing else, while the write-back
 * stays a single byte range.
 */
function splice(source: string, changes: readonly Change[], description: Phrase): Edit {
  const sorted = [...changes].sort((a, b) => a.span.start - b.span.start);
  const first = sorted[0];
  if (!first) throw new DiagramEditError(dgm('diagram.edit.noChange'));
  const start = first.span.start;
  const end = Math.max(...sorted.map(c => c.span.end));

  let text = '';
  let at = start;
  for (const change of sorted) {
    if (change.span.start < at) throw new DiagramEditError(dgm('diagram.edit.overlap'));
    text += sliceBytes(source, at, change.span.start) + change.text;
    at = change.span.end;
  }
  text += sliceBytes(source, at, end);
  return { span: { start, end }, text, ...described(description) };
}
