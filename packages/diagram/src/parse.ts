// Parses a .dgm file. The notation follows Mermaid's flowchart syntax closely,
// so someone who writes Mermaid can write this, and the layout and style
// sections stay separate so that moving a shape never touches the semantics.

import { byteLength } from '@docpresenter/base';
import type {
  ArrowStyle, Bend, Callout, DiagramFile, DiagramMode, Edge, EdgeStyle, LayoutBlock, Node,
  Part, Placement, Point, Section, ShapeKind,
} from './model.js';

/** One source line, trimmed, with the bytes it occupies. */
interface SourceLine {
  readonly text: string;
  readonly span: { readonly start: number; readonly end: number };
  /** 1-based, for error messages. */
  readonly number: number;
}

export class DiagramParseError extends Error {
  constructor(message: string, readonly line: number) {
    super(`${message}（${line} 行目）`);
    this.name = 'DiagramParseError';
  }
}

/** Bracket pairs decide the shape, as in Mermaid. */
const SHAPES: readonly { open: string; close: string; shape: ShapeKind }[] = [
  // Mermaid's own bracket pairs, including the two trapezoids it draws for
  // what a flowchart calls the start and the end of a loop.
  { open: '[/', close: '\\]', shape: 'loop-start' },
  { open: '[\\', close: '/]', shape: 'loop-end' },
  { open: '[/', close: '/]', shape: 'parallelogram' },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '([', close: '])', shape: 'stadium' },
  { open: '[(', close: ')]', shape: 'cylinder' },
  { open: '((', close: '))', shape: 'ellipse' },
  { open: '>',  close: ']',  shape: 'note' },
  { open: '[',  close: ']',  shape: 'rect' },
  { open: '{',  close: '}',  shape: 'diamond' },
  { open: '(',  close: ')',  shape: 'round-rect' },
  // A label with no outline. Screen mock-ups are mostly text sitting on
  // something else, so it needs a shape of its own rather than a borderless
  // rectangle nobody can tell apart from a missing one.
  { open: '"',  close: '"',  shape: 'text' },
];

const NODE = /^([A-Za-z0-9_぀-鿿-]+)\s*(.+?)(?::::([\w-]+))?$/;
const EDGE = /^([A-Za-z0-9_぀-鿿-]+)\s*(-->|->|--|-\.->)\s*([A-Za-z0-9_぀-鿿-]+)\s*(?:"([^"]*)")?\s*$/;
const GROUP = /^group\s+([A-Za-z0-9_぀-鿿-]+)\s*(?:"([^"]*)")?\s*\{([^}]*)\}\s*$/;
const PLACEMENT = /^([A-Za-z0-9_぀-鿿-]+)\s*@\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)\s*(?:(\d+)x(\d+))?\s*(?:z\s*:\s*(-?\d+))?\s*$/;
/** `a -> b @ (120, 200); (320, 200)` — the corners a connection turns through. */
const BEND = /^([A-Za-z0-9_぀-鿿-]+)\s*-+>\s*([A-Za-z0-9_぀-鿿-]+)\s*@\s*(.+)$/;
const POINT = /\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g;

const CALLOUT = /^(\S+)\s*@\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)\s*->\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)\s*(?:"([^"]*)")?\s*$/;

export function parseDiagram(source: string): DiagramFile {
  const raw = source.split(/\r?\n/);

  // Byte offset of the start of each line, built once so every pin can carry
  // the range it occupies: dragging a shape rewrites that range and nothing
  // else.
  const lines: SourceLine[] = [];
  let at = 0;
  raw.forEach((line, index) => {
    const lead = line.length - line.trimStart().length;
    const start = at + byteLength(line.slice(0, lead));
    const text = line.trim();
    lines.push({ text, span: { start, end: start + byteLength(text) }, number: index + 1 });
    at += byteLength(line) + 1;
  });

  const comments: string[] = [];
  const uses: string[] = [];
  const parts = new Map<string, Part>();
  const partOf = new Map<string, string>();
  let partsBlock: Section | undefined;
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const layout = new Map<string, Placement>();
  const bends = new Map<string, Bend>();
  const style = new Map<string, ReadonlyMap<string, string>>();
  const callouts: Callout[] = [];
  let theme: string | undefined;
  let mode: DiagramMode | undefined;
  let image: string | undefined;
  let layoutBlock: LayoutBlock | undefined;
  let body: Section | undefined;
  let styleBlock: Section | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const text = line.text;
    if (text === '') continue;
    if (text.startsWith('#')) { comments.push(text.replace(/^#\s?/, '')); continue; }

    // `use "…"` names a file of parts. It is not a section, and it is resolved
    // outside the parser — reading files is the host's business, not this
    // package's.
    const used = /^use\s+"([^"]+)"\s*$/.exec(text);
    if (used) { uses.push(used[1]!); continue; }

    const section = /^(free|flow|overlay|layout|style|parts)\b([^{]*)\{$/.exec(text);
    if (!section) throw new DiagramParseError(`解釈できない行: ${text}`, line.number);

    const kind = section[1]!;
    const header = (section[2] ?? '').trim();
    const inner: SourceLine[] = [];
    let depth = 1;
    const start = i;
    while (++i < lines.length) {
      const line = lines[i]!;
      depth += countChar(line.text, '{') - countChar(line.text, '}');
      if (depth === 0) break;
      inner.push(line);
    }
    if (depth !== 0) throw new DiagramParseError(`'${kind}' が閉じられていない`, lines[start]!.number);

    if (kind === 'free' || kind === 'flow') {
      mode = kind;
      parseBody(inner, nodes, edges, partOf);
      body = blockOf(lines, raw, start, i, inner);
    } else if (kind === 'parts') {
      // A file may hold nothing but parts. It is then a library, not a drawing,
      // and has no shapes of its own to place.
      mode = mode ?? 'parts';
      parseParts(inner, parts);
      partsBlock = blockOf(lines, raw, start, i, inner);
    } else if (kind === 'overlay') {
      mode = kind;
      const quoted = /^"([^"]*)"$/.exec(header);
      if (!quoted) throw new DiagramParseError('overlay には画像のパスが要る', lines[start]!.number);
      image = quoted[1]!;
      parseCallouts(inner, callouts);
    } else if (kind === 'layout') {
      parseLayout(inner, layout, bends);
      layoutBlock = blockOf(lines, raw, start, i, inner);
    } else {
      theme = parseStyle(inner.map(l => l.text), style) ?? theme;
      styleBlock = blockOf(lines, raw, start, i, inner);
    }
  }

  if (!mode) throw new DiagramParseError('free / flow / overlay のいずれのセクションも無い', 1);
  return {
    mode, comments, nodes, edges, body, layout, bends, layoutBlock, styleBlock,
    theme, style, image, callouts, uses, parts, partOf, partsBlock,
  };
}

/** A section's extent, and where a new line inside it would go. */
function blockOf(
  lines: readonly SourceLine[], raw: readonly string[],
  open: number, close: number, inner: readonly SourceLine[],
): Section {
  const last = lines[Math.min(close, lines.length - 1)]!;
  return {
    span: { start: lines[open]!.span.start, end: last.span.end },
    insertAt: inner[inner.length - 1]?.span.end ?? lines[open]!.span.end,
    indent: indentOf(raw[open + 1] ?? '  '),
  };
}

/** The indent of the first line inside a block, so a new line matches it. */
function indentOf(line: string): string {
  const found = /^\s*/.exec(line)?.[0] ?? '';
  return found === '' ? '  ' : found;
}

function countChar(text: string, char: string): number {
  let n = 0;
  for (const c of text) if (c === char) n++;
  return n;
}

/**
 * `textbox [ ] { fill: …, line: … } 320x34` — a name, a shape, a look, a size.
 *
 * The size is last and optional because it is the part people change least: a
 * system's input boxes are all one height long before anyone argues about it.
 */
const PART_NAME = /^([A-Za-z0-9_-]+)\s+(.*)$/;
const PART_STYLE = /\{([^}]*)\}/;
const PART_SIZE = /(\d+)x(\d+)\s*$/;

function parseParts(body: readonly SourceLine[], out: Map<string, Part>): void {
  for (const source of body) {
    const text = source.text;
    if (text === '' || text.startsWith('#')) continue;
    const named = PART_NAME.exec(text);
    if (!named) throw new DiagramParseError(`部品として読めない行: ${text}`, source.number);

    // Taken apart from the outside in: the style is the only part with braces,
    // the size is the only part at the end, and a shape such as `[ ]` holds a
    // space — so none of the three can be found by splitting on whitespace.
    let rest = named[2]!;
    const style = new Map<string, string>();
    const styled = PART_STYLE.exec(rest);
    if (styled) {
      for (const one of styled[1]!.split(/[,;]/)) {
        const kv = /^\s*([\w-]+)\s*:\s*(.+?)\s*$/.exec(one);
        if (kv) style.set(kv[1]!, kv[2]!);
      }
      rest = `${rest.slice(0, styled.index)} ${rest.slice(styled.index + styled[0].length)}`;
    }
    const sized = PART_SIZE.exec(rest);
    if (sized) rest = rest.slice(0, sized.index);

    const written = rest.trim();
    const shape = shapeOf(written);
    if (!shape) throw new DiagramParseError(`部品の図形が分からない: ${written}`, source.number);
    out.set(named[1]!, {
      name: named[1]!, shape, style,
      width: sized === null ? undefined : Number(sized[1]),
      height: sized === null ? undefined : Number(sized[2]),
      span: source.span,
    });
  }
}

/** The shape a bracket pair means, with nothing inside it. */
function shapeOf(written: string): ShapeKind | undefined {
  for (const { open, close, shape } of SHAPES) {
    if (written.startsWith(open) && written.endsWith(close)
      && written.length >= open.length + close.length) return shape;
  }
  return undefined;
}

/** `idBox textbox:"yamada@example.co.jp"` — a shape written as a part. */
const PART_USE = /^([A-Za-z0-9_-]+):\s*(?:"([^"]*)")?$/;

function parseBody(
  body: readonly SourceLine[], nodes: Node[], edges: Edge[], partOf: Map<string, string>,
): void {
  body.forEach(source => {
    const span = source.span;
    const text = source.text;
    if (text === '' || text.startsWith('#')) return;
    const line = source.number;

    const group = GROUP.exec(text);
    if (group) {
      nodes.push({
        id: group[1]!,
        text: group[2] ?? group[1]!,
        shape: 'group',
        className: undefined,
        children: group[3]!.split(';').map(s => s.trim()).filter(s => s !== ''),
        span,
      });
      return;
    }

    const edge = EDGE.exec(text);
    if (edge) {
      const connector = edge[2]!;
      const line: EdgeStyle = connector.includes('.') ? 'dashed' : 'solid';
      const arrow: ArrowStyle = connector.endsWith('>') ? 'arrow' : 'none';
      edges.push({ from: edge[1]!, to: edge[3]!, label: edge[4], line, arrow, span });
      return;
    }

    const node = NODE.exec(text);
    if (node) {
      const written = node[2]!.trim();
      // A shape written as a part carries no shape of its own: the part says
      // what it looks like. Resolution happens later, so the parser keeps the
      // name and leaves a plain rectangle in its place until then.
      const used = PART_USE.exec(written);
      if (used) {
        partOf.set(node[1]!, used[1]!);
        nodes.push({
          id: node[1]!, text: used[2] ?? '', shape: 'rect', className: node[3],
          children: [], span,
        });
        return;
      }
      const shaped = readShape(written);
      if (!shaped) throw new DiagramParseError(`図形の記法が読めない: ${text}`, line);
      nodes.push({
        id: node[1]!, text: shaped.text, shape: shaped.shape, className: node[3],
        children: [], span,
      });
      return;
    }

    throw new DiagramParseError(`解釈できない行: ${text}`, line);
  });
}

function readShape(text: string): { text: string; shape: ShapeKind } | undefined {
  for (const { open, close, shape } of SHAPES) {
    if (text.startsWith(open) && text.endsWith(close) && text.length >= open.length + close.length) {
      return { text: text.slice(open.length, text.length - close.length).trim(), shape };
    }
  }
  return undefined;
}

function parseCallouts(body: readonly SourceLine[], out: Callout[]): void {
  body.forEach(source => {
    const text = source.text;
    if (text === '' || text.startsWith('#')) return;
    const m = CALLOUT.exec(text);
    if (!m) throw new DiagramParseError(`注釈の記法が読めない: ${text}`, source.number);
    out.push({
      marker: m[1]!,
      x: Number(m[2]), y: Number(m[3]),
      targetX: Number(m[4]), targetY: Number(m[5]),
      text: m[6] ?? '',
      span: source.span,
    });
  });
}

function parseLayout(
  body: readonly SourceLine[], out: Map<string, Placement>, bends: Map<string, Bend>,
): void {
  body.forEach(source => {
    const text = source.text;
    if (text === '' || text.startsWith('#')) return;

    const bend = BEND.exec(text);
    if (bend) {
      const points: Point[] = [];
      POINT.lastIndex = 0;
      for (let found = POINT.exec(bend[3]!); found; found = POINT.exec(bend[3]!)) {
        points.push({ x: Number(found[1]), y: Number(found[2]) });
      }
      if (points.length === 0) {
        throw new DiagramParseError(`折れ点が読めない: ${text}`, source.number);
      }
      bends.set(`${bend[1]}->${bend[2]}`, { points, span: source.span });
      return;
    }

    const m = PLACEMENT.exec(text);
    if (!m) throw new DiagramParseError(`配置の記法が読めない: ${text}`, source.number);
    out.set(m[1]!, {
      x: Number(m[2]), y: Number(m[3]),
      width: m[4] ? Number(m[4]) : undefined,
      height: m[5] ? Number(m[5]) : undefined,
      z: m[6] ? Number(m[6]) : undefined,
      span: source.span,
    });
  });
}

function parseStyle(
  body: string[], out: Map<string, ReadonlyMap<string, string>>,
): string | undefined {
  let theme: string | undefined;
  for (const text of body) {
    if (text === '' || text.startsWith('#')) continue;
    const themeDecl = /^theme\s*:\s*(\S+)\s*$/.exec(text);
    if (themeDecl) { theme = themeDecl[1]!; continue; }
    const rule = /^([A-Za-z0-9_぀-鿿-]+)\s*\{([^}]*)\}\s*$/.exec(text);
    if (!rule) continue;
    const declarations = new Map<string, string>();
    for (const part of rule[2]!.split(/[,;]/)) {
      const kv = /^\s*([\w-]+)\s*:\s*(.+?)\s*$/.exec(part);
      if (kv) declarations.set(kv[1]!, kv[2]!);
    }
    out.set(rule[1]!, declarations);
  }
  return theme;
}
