// Parses a .dgm file. The notation follows Mermaid's flowchart syntax closely,
// so someone who writes Mermaid can write this, and the layout and style
// sections stay separate so that moving a shape never touches the semantics.

import { byteLength } from '../bytes.js';
import type {
  ArrowStyle, Callout, DiagramFile, DiagramMode, Edge, EdgeStyle, LayoutBlock, Node,
  Placement, Section, ShapeKind,
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
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const layout = new Map<string, Placement>();
  const style = new Map<string, ReadonlyMap<string, string>>();
  const callouts: Callout[] = [];
  let theme: string | undefined;
  let mode: DiagramMode | undefined;
  let image: string | undefined;
  let layoutBlock: LayoutBlock | undefined;
  let body: Section | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const text = line.text;
    if (text === '') continue;
    if (text.startsWith('#')) { comments.push(text.replace(/^#\s?/, '')); continue; }

    const section = /^(free|flow|overlay|layout|style)\b([^{]*)\{$/.exec(text);
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
      parseBody(inner, nodes, edges);
      body = blockOf(lines, raw, start, i, inner);
    } else if (kind === 'overlay') {
      mode = kind;
      const quoted = /^"([^"]*)"$/.exec(header);
      if (!quoted) throw new DiagramParseError('overlay には画像のパスが要る', lines[start]!.number);
      image = quoted[1]!;
      parseCallouts(inner, callouts);
    } else if (kind === 'layout') {
      parseLayout(inner, layout);
      layoutBlock = blockOf(lines, raw, start, i, inner);
    } else {
      theme = parseStyle(inner.map(l => l.text), style) ?? theme;
    }
  }

  if (!mode) throw new DiagramParseError('free / flow / overlay のいずれのセクションも無い', 1);
  return {
    mode, comments, nodes, edges, body, layout, layoutBlock, theme, style, image, callouts,
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

function parseBody(body: readonly SourceLine[], nodes: Node[], edges: Edge[]): void {
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
      const shaped = readShape(node[2]!.trim());
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

function parseLayout(body: readonly SourceLine[], out: Map<string, Placement>): void {
  body.forEach(source => {
    const text = source.text;
    if (text === '' || text.startsWith('#')) return;
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
