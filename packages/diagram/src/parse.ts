// Parses a .dgm file. The notation follows Mermaid's flowchart syntax closely,
// so someone who writes Mermaid can write this, and the layout and style
// sections stay separate so that moving a shape never touches the semantics.

import { byteLength, type ByteSpan } from '@docpresenter/base';
import type {
  ArrowStyle, Bend, Callout, DiagramFile, DiagramMode, Edge, EdgeStyle, LayoutBlock, Node,
  Container, Item, Part, Placement, Point, Section, ShapeKind,
} from './model.js';

/** One source line, trimmed, with the bytes it occupies. */
interface SourceLine {
  readonly text: string;
  /** How far it was indented, in characters — the depth of a tree's rows. */
  readonly indent: number;
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

/**
 * A line on its own: `rule1 --`.
 *
 * Borrowed from the connector it is drawn like, so nobody has to learn a second
 * way of writing a line. There is no bracket pair because there is nothing to
 * put inside one — a line holds no words — and the form is exact so that a
 * mistyped connection (`a --> b` with the `b` lost) is refused rather than
 * quietly read as a line.
 */
const LINE_SHAPE = /^-{2,}$/;
/**
 * The same thing on a line of the drawing: `rule1 --`.
 *
 * Read before the connections, not after. An id may end in a hyphen, so
 * `rule1 ---` is also a connection from `rule1` to a node called `-`; the
 * reading that needs no such node is the one meant.
 */
const LINE_NODE = /^([A-Za-z0-9_぀-鿿-]+?)\s*(-{2,})$/;

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
    lines.push({
      text, indent: lead, span: { start, end: start + byteLength(text) }, number: index + 1,
    });
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
  const containers = new Map<string, Container>();
  const style = new Map<string, ReadonlyMap<string, string>>();
  const styleSpans = new Map<string, ByteSpan>();
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
      parseLayout(inner, layout, bends, containers);
      layoutBlock = blockOf(lines, raw, start, i, inner);
    } else {
      theme = parseStyle(inner, style, styleSpans) ?? theme;
      styleBlock = blockOf(lines, raw, start, i, inner);
    }
  }

  // A file that only reaches for other libraries is a library too: it declares
  // no parts of its own, and what it offers is what it was built on.
  if (!mode && uses.length > 0) mode = 'parts';
  if (!mode) throw new DiagramParseError('free / flow / overlay のいずれのセクションも無い', 1);
  return {
    mode, comments, nodes, edges, body, layout, bends, containers, layoutBlock, styleBlock,
    theme, style, styleSpans, image, callouts, uses, parts, partOf, partSizes: new Map(),
    // What the file can reach is known only once the parts are applied, which
    // needs a reader of other files. Until then a drawing offers nothing.
    library: new Map(),
    partsBlock,
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
/**
 * `# --- ボタン ---` — a heading over a run of parts.
 *
 * Comments are not data anywhere else in this format, and they are not data
 * here either: nothing is read from the words. What is read is that a heading
 * was written, and which parts come under it, so that a list of forty can be
 * shown the way its author already divided it.
 */
const PART_GROUP = /^#\s*-{2,}\s*(.+?)\s*-{2,}\s*$/;
const PART_STYLE = /\{([^}]*)\}/;
const PART_SIZE = /(\d+)x(\d+)\s*$/;

function parseParts(body: readonly SourceLine[], out: Map<string, Part>): void {
  let group: string | undefined;
  for (const source of body) {
    const text = source.text;
    if (text.startsWith('#')) {
      const heading = PART_GROUP.exec(text);
      if (heading) group = heading[1];
      continue;
    }
    if (text === '') continue;
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
      span: source.span, group,
    });
  }
}

/**
 * How a shape is written, with nothing in it: `[ ]`, `( )`, `" "`.
 *
 * The notation is the answer to "how do I make one of these", so a parts list
 * that shows the look should show this beside it. Without it a reader sees
 * three rectangles of different colours and cannot tell what decided that.
 */
export function notationOf(shape: ShapeKind): string {
  if (shape === 'line') return '--';
  const found = SHAPES.find(one => one.shape === shape);
  return found ? `${found.open} ${found.close}` : shape;
}

/** The shape a bracket pair means, with nothing inside it. */
function shapeOf(written: string): ShapeKind | undefined {
  if (LINE_SHAPE.test(written)) return 'line';
  for (const { open, close, shape } of SHAPES) {
    if (written.startsWith(open) && written.endsWith(close)
      && written.length >= open.length + close.length) return shape;
  }
  return undefined;
}

/** `idBox textbox:"yamada@example.co.jp"` — a shape written as a part. */
const PART_USE = /^([A-Za-z0-9_-]+):\s*(?:"([^"]*)")?$/;
/**
 * `nav tree: {` — a part that holds a list of rows rather than a sentence.
 *
 * The rows are written as a markdown bullet list, which is what a tree looks
 * like written down: `-` for a row, `+` for a branch drawn closed, and a `*`
 * at the end for the one that is chosen. Indentation is the depth.
 */
const PART_ITEMS = /^([A-Za-z0-9_-]+):\s*\{\s*(.*)$/;
const ITEM = /^([-+])\s+(.*)$/;

function parseBody(
  body: readonly SourceLine[], nodes: Node[], edges: Edge[], partOf: Map<string, string>,
): void {
  for (let i = 0; i < body.length; i++) {
    const source = body[i]!;
    let span = source.span;
    const text = source.text;
    if (text === '' || text.startsWith('#')) continue;
    const line = source.number;

    const group = GROUP.exec(text);
    if (group) {
      nodes.push({
        id: group[1]!,
        text: group[2] ?? group[1]!,
        shape: 'group',
        className: undefined, items: [],
        children: group[3]!.split(';').map(s => s.trim()).filter(s => s !== ''),
        span,
      });
      continue;
    }

    const alone = LINE_NODE.exec(text);
    if (alone) {
      nodes.push({
        id: alone[1]!, text: '', shape: 'line',
        className: undefined, children: [], items: [], span,
      });
      continue;
    }

    const edge = EDGE.exec(text);
    if (edge) {
      const connector = edge[2]!;
      const line: EdgeStyle = connector.includes('.') ? 'dashed' : 'solid';
      const arrow: ArrowStyle = connector.endsWith('>') ? 'arrow' : 'none';
      edges.push({ from: edge[1]!, to: edge[3]!, label: edge[4], line, arrow, span });
      continue;
    }

    const node = NODE.exec(text);
    if (node) {
      const written = node[2]!.trim();
      // A shape written as a part carries no shape of its own: the part says
      // what it looks like. Resolution happens later, so the parser keeps the
      // name and leaves a plain rectangle in its place until then.
      // A part that holds rows: the block that follows is its list, and the
      // shape's own range covers all of it so that deleting it deletes it all.
      const listed = PART_ITEMS.exec(written);
      if (listed) {
        const rows: SourceLine[] = [];
        let last = source;
        const tail = listed[2]!;
        if (tail.includes('}')) {
          if (tail.slice(0, tail.indexOf('}')).trim() !== '') {
            throw new DiagramParseError(`一覧は行ごとに書く: ${text}`, line);
          }
        } else {
          while (++i < body.length) {
            last = body[i]!;
            if (last.text === '}') break;
            if (last.text !== '' && !last.text.startsWith('#')) rows.push(last);
          }
          if (last.text !== '}') {
            throw new DiagramParseError(`'${listed[1]}' の一覧が閉じられていない`, line);
          }
        }
        span = { start: source.span.start, end: last.span.end };
        partOf.set(node[1]!, listed[1]!);
        nodes.push({
          id: node[1]!, text: '', shape: 'rect', className: node[3],
          children: [], items: readItems(rows), span,
        });
        continue;
      }

      const used = PART_USE.exec(written);
      if (used) {
        partOf.set(node[1]!, used[1]!);
        nodes.push({
          id: node[1]!, text: used[2] ?? '', shape: 'rect', className: node[3],
          children: [], items: [], span,
        });
        continue;
      }
      const shaped = readShape(written);
      if (!shaped) throw new DiagramParseError(`図形の記法が読めない: ${text}`, line);
      nodes.push({
        id: node[1]!, text: shaped.text, shape: shaped.shape, className: node[3],
        children: [], items: [], span,
      });
      continue;
    }

    throw new DiagramParseError(`解釈できない行: ${text}`, line);
  }
}

/**
 * The rows written inside a `{ … }` after a part's name.
 *
 * Depth comes from the indent, by how the indents nest rather than by a fixed
 * number of spaces: two files that agree with themselves are both readable.
 */
function readItems(rows: readonly SourceLine[]): Item[] {
  const items: Item[] = [];
  const steps: number[] = [];
  for (const row of rows) {
    const found = ITEM.exec(row.text);
    if (!found) throw new DiagramParseError(`一覧の行が読めない: ${row.text}`, row.number);
    while (steps.length > 0 && row.indent < steps[steps.length - 1]!) steps.pop();
    if (steps.length === 0 || row.indent > steps[steps.length - 1]!) steps.push(row.indent);
    const written = found[2]!.trim();
    const picked = written.endsWith('*');
    items.push({
      text: (picked ? written.slice(0, -1) : written).trim(),
      depth: steps.length - 1,
      closed: found[1] === '+',
      picked,
    });
  }
  return items;
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

/**
 * `grid form (cols: 120, 1fr; gap: 8 12) {` — a container and how it arranges.
 *
 * The settings are optional: a container with none is an even share of the
 * room, which is what a form of labels and fields wants.
 */
const CONTAINER = /^(stack|grid|tabs)\s+([A-Za-z0-9_぀-鿿-]+)\s*(?:\(([^)]*)\))?\s*\{\s*(.*)$/;
const DEFAULT_GAP = 12;
const DEFAULT_PAD = 16;

function parseLayout(
  body: readonly SourceLine[], out: Map<string, Placement>, bends: Map<string, Bend>,
  containers: Map<string, Container>,
): void {
  for (let i = 0; i < body.length; i++) {
    const source = body[i]!;
    const text = source.text;
    if (text === '' || text.startsWith('#')) continue;

    const container = CONTAINER.exec(text);
    if (container) {
      // A container may be written on one line or spread over several; the
      // rows of a grid are its lines, so the written shape is the shape drawn.
      const rows: string[] = [];
      let last = source;
      const tail = container[4]!;
      if (tail.includes('}')) rows.push(tail.slice(0, tail.indexOf('}')));
      else {
        while (++i < body.length) {
          last = body[i]!;
          if (last.text === '}') break;
          if (last.text !== '' && !last.text.startsWith('#')) rows.push(last.text);
        }
        if (last.text !== '}') {
          throw new DiagramParseError(`'${container[1]}' が閉じられていない`, source.number);
        }
      }
      const one = readContainer(container, rows, source.number);
      containers.set(one.id, { ...one, span: { start: source.span.start, end: last.span.end } });
      continue;
    }

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
  }
}

/** The settings in the brackets, and the cells in the braces. */
function readContainer(
  found: RegExpExecArray, rows: readonly string[], line: number,
): Omit<Container, 'span'> {
  const kind = found[1] as 'stack' | 'grid' | 'tabs';
  const id = found[2]!;
  let flow: 'down' | 'right' = 'down';
  let cols: string[] = [];
  let gap = { x: DEFAULT_GAP, y: DEFAULT_GAP };
  // A tab control is a frame around pages, not a padded box: its pages bring
  // their own padding, the way they do in every toolkit.
  let pad = kind === 'tabs' ? 0 : DEFAULT_PAD;
  let scroll: 'none' | 'down' | 'right' = 'none';
  let show: string | undefined;

  for (const setting of (found[3] ?? '').split(';')) {
    const written = setting.trim();
    if (written === '') continue;
    if (written === 'down' || written === 'right') { flow = written; continue; }
    // `scroll` on its own runs the way the container does; a tabbed area or a
    // grid has no flow of its own, so there it means down the page.
    if (written === 'scroll') { scroll = kind === 'stack' ? flow : 'down'; continue; }
    const kv = /^([\w-]+)\s*:\s*(.+?)$/.exec(written);
    // A misspelt setting is refused rather than ignored: a gap nobody applied
    // is a drawing that silently disagrees with its own file.
    if (!kv) throw new DiagramParseError(`入れ物の設定が読めない: ${written}`, line);
    const value = kv[2]!.trim();
    if (kv[1] === 'cols') cols = value.split(',').map(one => one.trim()).filter(one => one !== '');
    else if (kv[1] === 'pad') pad = Number(value);
    else if (kv[1] === 'show') show = value;
    else if (kv[1] === 'scroll') {
      if (value !== 'down' && value !== 'right') {
        throw new DiagramParseError(`スクロールの向きは down か right: ${value}`, line);
      }
      scroll = value;
    }
    else if (kv[1] === 'gap') {
      // `gap: 8 12` is the rows then the columns, as CSS writes it.
      const two = value.split(/\s+/).map(Number);
      gap = { y: two[0] ?? DEFAULT_GAP, x: two[1] ?? two[0] ?? DEFAULT_GAP };
    } else throw new DiagramParseError(`入れ物の設定が読めない: ${written}`, line);
  }

  const cells = rows
    .map(row => row.split(';').map(cell => cell.trim()).filter(cell => cell !== ''))
    .filter(row => row.length > 0);
  if (cells.length === 0) throw new DiagramParseError(`入れ物の中身が無い: ${id}`, line);

  // A stack is a grid of one column — or, laid across, one row. Saying it this
  // way means one arrangement to compute rather than two.
  if (kind === 'stack') {
    const members = cells.flat();
    return {
      id, kind, flow, gap, pad, scroll, show,
      cols: flow === 'down' ? ['1fr'] : members.map(() => 'auto'),
      cells: flow === 'down' ? members.map(one => [one]) : [members],
    };
  }
  // The pages of a tab control are a list, like a stack's members: they are
  // side by side in the strip and one at a time underneath it.
  if (kind === 'tabs') {
    const pages = cells.flat();
    return { id, kind, flow, gap, pad, scroll, show, cols: ['1fr'], cells: [pages] };
  }
  return { id, kind, flow, gap, pad, scroll, show, cols, cells };
}

function parseStyle(
  body: readonly SourceLine[], out: Map<string, ReadonlyMap<string, string>>,
  spans: Map<string, ByteSpan>,
): string | undefined {
  let theme: string | undefined;
  for (const source of body) {
    const text = source.text;
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
    spans.set(rule[1]!, source.span);
  }
  return theme;
}
