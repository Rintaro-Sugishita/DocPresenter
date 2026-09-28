// Editing a diagram's layout layer. Dragging a shape writes one pin, which is
// one line, which is one byte range: the semantics section is never touched by
// a move, so a diff of a moved shape is a diff of a coordinate and nothing
// else. Un-pinning is just as important as pinning — a layer that only ever
// grows is a layout nobody can hand back to the engine.

import {
  byteLength, sliceBytes, type ByteSpan, type DiagramFile, type Node, type ShapeKind,
} from '@docpresenter/core';
import type { Edit } from './edit.js';

export class DiagramEditError extends Error {
  constructor(message: string) {
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
  if (pins.size === 0) throw new DiagramEditError('動かす図形が無い');
  const changes: Change[] = [];
  const added: string[] = [];
  let anyNew = false;

  for (const [id, pin] of pins) {
    if (!file.nodes.some(node => node.id === id)) {
      throw new DiagramEditError(`図形が見つからない: ${id}`);
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
  return splice(source, changes, anyNew ? '配置を固定' : '配置を変更');
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
    throw new DiagramEditError(`${from} から ${to} への線が無い`);
  }
  const existing = file.bends.get(`${from}->${to}`);
  const line = `${from} -> ${to} @ `
    + points.map(p => `(${Math.round(p.x)}, ${Math.round(p.y)})`).join('; ');

  if (points.length === 0) {
    if (!existing) throw new DiagramEditError(`${from} から ${to} の線は折れていない`);
    return splice(source, [whole(source, existing.span, '')], '折れ点を消す');
  }
  if (existing) {
    return { span: existing.span, text: line, description: '折れ点を動かす' };
  }
  if (file.layoutBlock) {
    const { insertAt, indent } = file.layoutBlock;
    return {
      span: { start: insertAt, end: insertAt },
      text: `\n${indent}${line}`,
      description: '線を折る',
    };
  }
  const end = byteLength(source.replace(/\s+$/, ''));
  return {
    span: { start: end, end: byteLength(source) },
    text: `\n\nlayout {\n  ${line}\n}\n`,
    description: '線を折る',
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
  if (!existing) throw new DiagramEditError(`${id} は自動配置のまま`);
  if (!canUnpin(file, id)) {
    throw new DiagramEditError(`自由配置の図では位置を外せない（${id} の置き場所が無くなる）`);
  }
  // The span starts after the indent, so take the indent with it: leaving it
  // behind would push the next line sideways.
  const before = sliceBytes(source, 0, existing.span.start);
  const indent = /[ \t]*$/.exec(before)?.[0] ?? '';
  return {
    span: {
      start: existing.span.start - indent.length,
      end: Math.min(existing.span.end + 1, byteLength(source)),
    },
    text: '',
    description: '配置を自動に戻す',
  };
}

/** Whether a shape has somewhere to go once its pin is gone. */
export function canUnpin(file: DiagramFile, id: string): boolean {
  if (!file.layout.has(id)) return false;
  const node = file.nodes.find(n => n.id === id);
  return file.mode === 'flow' || node?.shape === 'group';
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
  if (!callout) throw new DiagramEditError(`注釈が見つからない: ${marker}`);
  const like = sliceBytes(source, callout.span.start, callout.span.end);
  const text = `${padTo(marker, markerWidth(file))}@ (${round(to.x)}, ${round(to.y)})`
    + ` -> (${round(to.targetX)}, ${round(to.targetY)})`
    + (callout.text === '' ? '' : `  "${callout.text}"`);
  return {
    span: callout.span,
    text: keepColumns(text, like),
    description: '注釈を移動',
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
};

/** What a new shape of each kind is called, before anyone renames it. */
const BASE: Readonly<Record<ShapeKind, string>> = {
  rect: 'box', 'round-rect': 'box', stadium: 'pill', cylinder: 'store',
  ellipse: 'oval', diamond: 'branch', note: 'note', text: 'label', group: 'group',
  parallelogram: 'io', hexagon: 'prep', 'loop-start': 'loop', 'loop-end': 'loopEnd',
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
}

/**
 * Adds a shape: one line in the semantics section, and — when the drawing
 * places by hand — one line in the layout section, since there is no engine to
 * decide where it goes. Both land in the same edit, so one gesture is one
 * change however many lines it took.
 */
export function addNode(file: DiagramFile, source: string, shape: NewShape): Edit {
  if (!file.body) throw new DiagramEditError('図形を書くセクションが無い');
  const id = nextShapeId(file, shape.icon === undefined ? shape.shape : 'part');
  const [open, close] = BRACKETS[shape.shape];
  const changes: Change[] = [{
    span: { start: file.body.insertAt, end: file.body.insertAt },
    text: `\n${file.body.indent}${id} ${open}${shape.text}${close}`,
  }];
  // Sections the file does not have yet are written once, after everything
  // else: two separate appends would both claim the end of the file.
  const tail: string[] = [];

  if (shape.at) {
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
  return splice(source, changes, shape.icon === undefined ? '図形を追加' : '部品を追加');
}

/** Removes several shapes as one change. */
export function removeNodes(file: DiagramFile, source: string, ids: readonly string[]): Edit {
  if (ids.length === 0) throw new DiagramEditError('消す図形が無い');
  return splice(
    source, removalOf(file, source, ids),
    ids.length === 1 ? '図形を削除' : '図形をまとめて削除',
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
  if (!file.body) throw new DiagramEditError('図形を書くセクションが無い');
  if (ids.length < 2) throw new DiagramEditError('2 つ以上の図形を選ぶ');
  for (const id of ids) find(file, id);
  const id = nextShapeId(file, 'group');
  return splice(source, [{
    span: { start: file.body.insertAt, end: file.body.insertAt },
    text: `\n${file.body.indent}group ${id} "${text}" { ${ids.join('; ')} }`,
  }], 'グループにする');
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
    if (!file.nodes.some(n => n.id === id)) throw new DiagramEditError(`図形が見つからない: ${id}`);
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
  return changes;
}

/**
 * Rewrites what a shape says. The shape and the id are left alone — and a
 * group is written as a group, not turned into a box with a list of names for
 * a label.
 */
export function setNodeText(file: DiagramFile, id: string, text: string): Edit {
  const node = find(file, id);
  const line = node.shape === 'group'
    ? groupLine({ ...node, text }, node.children)
    : nodeLine(node, node.shape, text);
  return { span: node.span, text: line, description: '文字を変更' };
}

/** Rewrites which shape it is, by changing the brackets around the text. */
export function setNodeShape(file: DiagramFile, id: string, shape: ShapeKind): Edit {
  const node = find(file, id);
  if (node.shape === 'group') throw new DiagramEditError('グループの種類は変えられない');
  return { span: node.span, text: nodeLine(node, shape, node.text), description: '図形の種類を変更' };
}

/** Draws a connection. One line at the end of the semantics section. */
export function connectNodes(file: DiagramFile, source: string, from: string, to: string): Edit {
  if (!file.body) throw new DiagramEditError('図形を書くセクションが無い');
  find(file, from);
  find(file, to);
  if (from === to) throw new DiagramEditError('同じ図形どうしは繋げない');
  if (file.edges.some(e => e.from === from && e.to === to)) {
    throw new DiagramEditError(`${from} から ${to} へは既に繋がっている`);
  }
  return splice(source, [{
    span: { start: file.body.insertAt, end: file.body.insertAt },
    text: `\n${file.body.indent}${from} --> ${to}`,
  }], '線を引く');
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
  if (!found) throw new DiagramEditError(`${edge.from} から ${edge.to} への線が無い`);
  const from = ends.from ?? found.from;
  const to = ends.to ?? found.to;
  if (from === to) throw new DiagramEditError('同じ図形どうしは繋げない');
  find(file, from);
  find(file, to);
  if (from !== found.from || to !== found.to) {
    if (file.edges.some(e => e.from === from && e.to === to)) {
      throw new DiagramEditError(`${from} から ${to} へは既に繋がっている`);
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
  return splice(source, changes, '線をつなぎ替え');
}

/** Removes one connection, named by its two ends. */
export function disconnectNodes(
  file: DiagramFile, source: string, from: string, to: string,
): Edit {
  const edge = file.edges.find(e => e.from === from && e.to === to);
  if (!edge) throw new DiagramEditError(`${from} から ${to} への線が無い`);
  const changes: Change[] = [whole(source, edge.span, '')];
  const bend = file.bends.get(`${from}->${to}`);
  // The corners were corners of this line. With the line gone they name
  // nothing, and a layout line naming nothing is a line nobody can read.
  if (bend) changes.push(whole(source, bend.span, ''));
  return splice(source, changes, '線を消す');
}

function find(file: DiagramFile, id: string): Node {
  const node = file.nodes.find(n => n.id === id);
  if (!node) throw new DiagramEditError(`図形が見つからない: ${id}`);
  return node;
}

function nodeLine(node: Node, shape: ShapeKind, text: string): string {
  const [open, close] = BRACKETS[shape];
  const name = node.className === undefined ? '' : `:::${node.className}`;
  return `${node.id} ${open}${text}${close}${name}`;
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
      end: Math.min(span.end + 1, byteLength(source)),
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
function splice(source: string, changes: readonly Change[], description: string): Edit {
  const sorted = [...changes].sort((a, b) => a.span.start - b.span.start);
  const first = sorted[0];
  if (!first) throw new DiagramEditError('変更が無い');
  const start = first.span.start;
  const end = Math.max(...sorted.map(c => c.span.end));

  let text = '';
  let at = start;
  for (const change of sorted) {
    if (change.span.start < at) throw new DiagramEditError('重なった変更');
    text += sliceBytes(source, at, change.span.start) + change.text;
    at = change.span.end;
  }
  text += sliceBytes(source, at, end);
  return { span: { start, end }, text, description };
}
