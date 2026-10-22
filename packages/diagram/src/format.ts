// Formatting a .dgm file: one text for one drawing.
//
// A drawing typed by hand comes out in its author's order and spacing. The
// formatter writes it the way the format asks a writer to — the sections in
// their order, one entity per line, the columns lined up — and puts the lines
// in an order taken from the drawing itself, so two people who drew the same
// thing end up with the same file.
//
// The order is the drawing's reading order. What a container or a group holds
// follows it, in the order the container arranges it; everything else goes the
// way the drawing is read — along a flow, or top to bottom and left to right.
// Pins, bends and style rules follow the shapes they are about. A comment is
// written above a line, so it travels with that line.
//
// It never changes what is drawn. The result is read back and compared with the
// original: the model, every comment, and for a free or flow drawing the boxes,
// the routes and which of two overlapping shapes is in front. An order that
// would change the picture is not taken — the lines keep the order they had —
// and a text that cannot be proven the same is not written at all.

import { byteLength, padToWidth, displayWidth, type Phrase } from '@docpresenter/base';
import { containerOf, members } from './arrange.js';
import { layOutDiagram } from './layout.js';
import { dgm } from './messages.js';
import type { Bend, Callout, Container, DiagramFile, Edge, Node, Part, Placement } from './model.js';
import { parseDiagram } from './parse.js';
import { withParts, type PartReader } from './parts.js';

export interface FormattedDiagram {
  /** The formatted text; the source itself when it could not be formatted. */
  readonly text: string;
  /** Whether the text differs from the source. */
  readonly changed: boolean;
  /** Why the result is less than fully formatted, when it is. */
  readonly notes: readonly Phrase[];
}

/** One source line: its trimmed text and where that text sits, in bytes. */
interface Line {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** A thing the file says, the lines it spans and the comments written above it. */
interface Piece<T> {
  readonly value: T;
  readonly first: number;
  readonly last: number;
  readonly leading: readonly string[];
}

/** A top-level `name … {` section, with the comments above it. */
interface TopSection {
  readonly name: string;
  readonly header: string;
  readonly open: number;
  readonly close: number;
  readonly leading: readonly string[];
}

/** What a written entity becomes: the comments above it, then its own lines. */
interface Written {
  readonly leading: readonly string[];
  readonly lines: readonly string[];
}

type StyleEntry =
  | { readonly kind: 'theme'; readonly text: string }
  | { readonly kind: 'rule'; readonly id: string; readonly line: string }
  | { readonly kind: 'other'; readonly text: string };

const INDENT = '  ';
const BODY = new Set(['free', 'flow', 'overlay']);
const DIRECTION = /^(TB|TD|BT|LR|RL)$/;
/** Declarations in the order the spec lists them; anything else follows by name. */
const PROPERTY_ORDER = ['fill', 'line', 'color', 'align', 'icon'];
const STYLE_RULE = /^([A-Za-z0-9_぀-鿿]+)\s*\{([^}]*)\}\s*$/;
const STYLE_THEME = /^theme\s*:\s*(\S+)\s*$/;
const ITEMS_HEAD = /^\S+\s+([A-Za-z0-9_-]+):\s*\{/;
const PART_STYLE = /\{([^}]*)\}/;
const PART_SIZE = /(\d+)x(\d+)\s*$/;

/**
 * Formats a drawing. `read` resolves the files its `use` lines name, so the
 * drawing compared before and after is the one that will be rendered; without
 * it, parts from other files are left unresolved on both sides.
 *
 * Throws what {@link parseDiagram} throws for a file that cannot be read.
 */
export function formatDiagram(source: string, read?: PartReader): FormattedDiagram {
  const file = parseDiagram(source);
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = linesOf(source);
  const top = scanTop(lines);
  const unchanged = (note: Phrase): FormattedDiagram => ({ text: source, changed: false, notes: [note] });

  if (top.sections.filter(one => BODY.has(one.name)).length > 1) {
    return unchanged(dgm('diagram.format.twoBodies'));
  }

  const pieces = collectPieces(file, lines, top.sections);
  if (typeof pieces === 'number') return unchanged(dgm('diagram.format.duplicate', { line: pieces + 1 }));

  const before = {
    model: modelOf(file),
    comments: commentsOf(lines),
    picture: pictureOf(file, read),
  };
  const arrows = canonicalOrder(file, read, true);
  const page = canonicalOrder(file, read, false);

  // The reading order first, following the arrows and then without them; if
  // either would move anything on the page, the shapes and connections keep
  // the order the author gave them.
  const plans: readonly BodyPlan[] = file.mode === 'free' || file.mode === 'flow'
    ? [
      { nodes: 'canonical', edges: 'canonical', order: arrows },
      { nodes: 'canonical', edges: 'canonical', order: page },
      { nodes: 'canonical', edges: 'kept', order: arrows },
      { nodes: 'kept', edges: 'kept', order: arrows },
      { nodes: 'verbatim', edges: 'verbatim', order: arrows },
    ]
    : [{ nodes: 'canonical', edges: 'canonical', order: arrows }];

  for (const plan of plans) {
    const text = write(file, lines, top, pieces, plan.order, plan).join(eol) + eol;
    let again: DiagramFile;
    try {
      again = parseDiagram(text);
    } catch {
      continue;
    }
    if (modelOf(again) !== before.model) continue;
    if (commentsOf(linesOf(text)) !== before.comments) continue;
    if (pictureOf(again, read) !== before.picture) continue;
    return {
      text,
      changed: text !== source,
      notes: plan.nodes === 'canonical' ? [] : [dgm('diagram.format.keptOrder')],
    };
  }
  return unchanged(dgm('diagram.format.unsafe'));
}

// --- reading the file into pieces ---------------------------------------------

/** Every line, with byte offsets counted the way the parser counts them. */
function linesOf(source: string): Line[] {
  const ended = source.split('\n');
  const out: Line[] = [];
  let at = 0;
  for (const withEnd of ended) {
    const line = withEnd.replace(/\r$/, '');
    const lead = line.length - line.trimStart().length;
    const start = at + byteLength(line.slice(0, lead));
    const text = line.trim();
    out.push({ text, start, end: start + byteLength(text) });
    at += byteLength(withEnd) + 1;
  }
  return out;
}

interface Top {
  /** The comments the file opens with: they stay at the top. */
  readonly header: readonly string[];
  /** `use` and `items` lines, in the order written. */
  readonly uses: readonly { readonly keyword: string; readonly path: string; readonly leading: readonly string[] }[];
  readonly sections: readonly TopSection[];
  /** Comments after the last section. */
  readonly trailing: readonly string[];
}

/** The top level: comments, `use` lines and sections, as the parser finds them. */
function scanTop(lines: readonly Line[]): Top {
  const header: string[] = [];
  const uses: { keyword: string; path: string; leading: string[] }[] = [];
  const sections: TopSection[] = [];
  let pending: string[] = [];
  let opened = false;

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.text;
    if (text === '') continue;
    if (text.startsWith('#')) {
      (opened ? pending : header).push(text);
      continue;
    }
    opened = true;
    const used = /^(use|items)\s+"([^"]+)"\s*$/.exec(text);
    if (used) {
      uses.push({ keyword: used[1]!, path: used[2]!, leading: pending });
      pending = [];
      continue;
    }
    const section = /^(free|flow|overlay|layout|style|parts)\b([^{]*)\{$/.exec(text)!;
    let depth = 1;
    const open = i;
    while (++i < lines.length) {
      depth += count(lines[i]!.text, '{') - count(lines[i]!.text, '}');
      if (depth === 0) break;
    }
    sections.push({
      name: section[1]!, header: section[2]!.trim().replace(/\s+/g, ' '),
      open, close: i, leading: pending,
    });
    pending = [];
  }
  return { header, uses, sections, trailing: pending };
}

interface Pieces {
  readonly nodes: Piece<Node>[];
  readonly edges: Piece<Edge>[];
  /** Body order as written, shapes and connections together. */
  readonly body: Piece<Node | Edge>[];
  readonly pins: Piece<{ id: string; pin: Placement }>[];
  readonly bends: Piece<{ key: string; bend: Bend }>[];
  readonly containers: Piece<Container>[];
  readonly style: Piece<StyleEntry>[];
  readonly parts: Piece<Part>[];
  readonly callouts: Piece<Callout>[];
  /** Comments after the last entity of each kind of section. */
  readonly trailing: ReadonlyMap<string, readonly string[]>;
}

/**
 * Cuts each section into the entities the parser found, each with the comments
 * written above it. A line no entity accounts for is a second line for a name
 * already used — the parser kept only the last — and its line number is
 * returned instead, since moving it would change which one wins.
 */
function collectPieces(
  file: DiagramFile, lines: readonly Line[], sections: readonly TopSection[],
): Pieces | number {
  const startAt = new Map<number, number>();
  const endAt = new Map<number, number>();
  lines.forEach((line, index) => {
    if (line.text === '') return;
    if (!startAt.has(line.start)) startAt.set(line.start, index);
    endAt.set(line.end, index);
  });

  type Found = { readonly kind: string; readonly value: unknown; readonly last: number };
  const found = new Map<number, Found>();
  const add = (kind: string, value: unknown, span: { start: number; end: number }): void => {
    const first = startAt.get(span.start);
    const last = endAt.get(span.end);
    if (first !== undefined && last !== undefined) found.set(first, { kind, value, last });
  };
  for (const node of file.nodes) add('node', node, node.span);
  for (const edge of file.edges) add('edge', edge, edge.span);
  for (const [id, pin] of file.layout) add('pin', { id, pin }, pin.span);
  for (const [key, bend] of file.bends) add('bend', { key, bend }, bend.span);
  for (const container of file.containers.values()) add('container', container, container.span);
  for (const part of file.parts.values()) add('part', part, part.span);
  for (const callout of file.callouts) add('callout', callout, callout.span);

  const out: Pieces = {
    nodes: [], edges: [], body: [], pins: [], bends: [], containers: [], style: [], parts: [], callouts: [],
    trailing: new Map(),
  };
  const trailing = out.trailing as Map<string, string[]>;

  for (const section of sections) {
    const group = BODY.has(section.name) ? 'body' : section.name;
    let pending: string[] = [];
    for (let i = section.open + 1; i < section.close; i++) {
      const text = lines[i]!.text;
      if (text === '') continue;

      if (section.name === 'style') {
        if (text.startsWith('#')) { pending.push(text); continue; }
        const theme = STYLE_THEME.exec(text);
        const rule = STYLE_RULE.exec(text);
        const entry: StyleEntry = theme ? { kind: 'theme', text: `theme: ${theme[1]}` }
          : rule ? { kind: 'rule', id: rule[1]!, line: styleLine(rule[2]!) ?? `{${rule[2]}}` }
            : { kind: 'other', text };
        out.style.push({ value: entry, first: i, last: i, leading: pending });
        pending = [];
        continue;
      }

      const entity = found.get(i);
      if (!entity) {
        if (text.startsWith('#')) { pending.push(text); continue; }
        return i;
      }
      const piece = { value: entity.value as never, first: i, last: entity.last, leading: pending };
      pending = [];
      i = entity.last;
      switch (entity.kind) {
        case 'node': out.nodes.push(piece); out.body.push(piece); break;
        case 'edge': out.edges.push(piece); out.body.push(piece); break;
        case 'pin': out.pins.push(piece); break;
        case 'bend': out.bends.push(piece); break;
        case 'container': out.containers.push(piece); break;
        case 'part': out.parts.push(piece); break;
        case 'callout': out.callouts.push(piece); break;
      }
    }
    trailing.set(group, [...(trailing.get(group) ?? []), ...pending]);
  }
  return out;
}

// --- the order -----------------------------------------------------------------

/**
 * Every shape and group, in the order the drawing reads.
 *
 * What a container holds comes straight after it, in the order the container
 * arranges it. Everything else follows the arrows — a shape comes after the
 * shapes that point at it — and where the arrows say nothing, the page: along
 * a flow, or top to bottom and left to right. A group goes where its first
 * member goes, and what it holds follows it. Ties go by name, so the order
 * depends on the drawing alone.
 */
function canonicalOrder(file: DiagramFile, read: PartReader | undefined, arrows: boolean): Map<string, number> {
  const ids = [...new Set(file.nodes.map(node => node.id))];
  const known = new Set(ids);
  let boxes: ReadonlyMap<string, { x: number; y: number; width: number; height: number; z: number }> = new Map();
  let painted: readonly string[] = [];
  if (file.mode === 'free' || file.mode === 'flow') {
    try {
      const laid = layOutDiagram(resolved(file, read));
      boxes = laid.boxes;
      painted = laid.order;
    } catch {
      // A drawing that cannot be laid out is still written in a stable order.
    }
  }
  const way = file.mode === 'flow' ? file.direction ?? 'TB' : 'TB';
  const key = (id: string): readonly [number, number] => {
    const box = boxes.get(id);
    if (!box) return [Infinity, Infinity];
    switch (way) {
      case 'BT': return [-box.y, box.x];
      case 'LR': return [box.x, box.y];
      case 'RL': return [-box.x, box.y];
      default: return [box.y, box.x];
    }
  };
  const reading = (a: string, b: string): number => {
    const ka = key(a);
    const kb = key(b);
    return compareNumbers(ka[0], kb[0]) || compareNumbers(ka[1], kb[1]) || compareText(a, b);
  };

  // The arrows, taken in reading order where they leave a choice. A line with
  // no head, or a head at each end, says nothing about which comes first.
  const flowRank = arrows ? arrowOrder(file, ids, reading) : new Map<string, number>();
  const groupRank = (id: string): number => {
    const node = file.nodes.find(one => one.id === id);
    if (node?.shape !== 'group') return flowRank.get(id) ?? Infinity;
    let least = Infinity;
    const seen = new Set<string>([id]);
    const walk = (group: Node): void => {
      for (const child of group.children) {
        if (seen.has(child)) continue;
        seen.add(child);
        least = Math.min(least, flowRank.get(child) ?? Infinity);
        const inner = file.nodes.find(one => one.id === child);
        if (inner?.shape === 'group') walk(inner);
      }
    };
    walk(node);
    return least;
  };
  const byFlow = (a: string, b: string): number =>
    compareNumbers(groupRank(a), groupRank(b)) || reading(a, b);

  // A shape belongs to the container that arranges it, else to the first group
  // that lists it — the same owners the layout gives it.
  const parent = new Map<string, string>();
  const held = containerOf(file);
  for (const [child, owner] of held) if (known.has(child) && known.has(owner) && child !== owner) parent.set(child, owner);
  for (const node of file.nodes) {
    if (node.shape !== 'group') continue;
    for (const child of node.children) {
      if (known.has(child) && child !== node.id && !parent.has(child)) parent.set(child, node.id);
    }
  }
  const children = new Map<string, string[]>();
  for (const [child, owner] of parent) {
    const list = children.get(owner);
    if (list) list.push(child); else children.set(owner, [child]);
  }
  for (const [owner, list] of children) {
    const container = file.containers.get(owner);
    if (container && held.size > 0) {
      const place = new Map(members(container).map((id, index) => [id, index]));
      list.sort((a, b) => compareNumbers(place.get(a) ?? Infinity, place.get(b) ?? Infinity) || byFlow(a, b));
    } else {
      list.sort(byFlow);
    }
  }

  const order = new Map<string, number>();
  const visit = (id: string): void => {
    if (order.has(id)) return;
    order.set(id, order.size);
    for (const child of children.get(id) ?? []) visit(child);
  };
  for (const id of ids.filter(one => !parent.has(one)).sort(byFlow)) visit(id);
  // Owners that hold each other leave shapes nobody reached; they still get a place.
  for (const id of [...ids].sort(byFlow)) visit(id);
  return keepInFront(file, order, boxes, painted);
}

/**
 * The order again, with one more rule: of two shapes that overlap, the one
 * painted behind is written first. Two shapes at the same `z` and the same
 * depth are painted in the order they are written — any other pair is decided
 * by the `z` or the depth — so this is what keeps the one in front in front.
 * Otherwise the order stays as it was.
 */
function keepInFront(
  file: DiagramFile, order: ReadonlyMap<string, number>,
  boxes: ReadonlyMap<string, { x: number; y: number; width: number; height: number; z: number }>,
  painted: readonly string[],
): Map<string, number> {
  const groups = new Set(file.nodes.filter(node => node.shape === 'group').map(node => node.id));
  // How deep each shape sits, counted the way the layout counts it for painting.
  const held = new Map(containerOf(file));
  for (const group of file.nodes) {
    if (group.shape !== 'group') continue;
    for (const child of group.children) if (!held.has(child)) held.set(child, group.id);
  }
  const depthOf = (id: string): number => {
    let depth = 0;
    for (let at = held.get(id); at !== undefined && depth < 32; at = held.get(at)) depth += 1;
    return depth;
  };
  const shapes = [...order.keys()].filter(id => !groups.has(id)).sort((a, b) => order.get(a)! - order.get(b)!);
  const behind = new Map<string, Set<string>>(shapes.map(id => [id, new Set()]));
  const paint = new Map(painted.map((id, index) => [id, index]));
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = boxes.get(shapes[i]!);
      const b = boxes.get(shapes[j]!);
      if (!a || !b || !(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height)) continue;
      if (a.z !== b.z || depthOf(shapes[i]!) !== depthOf(shapes[j]!)) continue;
      const [back, front] = (paint.get(shapes[i]!) ?? 0) <= (paint.get(shapes[j]!) ?? 0)
        ? [shapes[i]!, shapes[j]!] : [shapes[j]!, shapes[i]!];
      behind.get(front)!.add(back);
    }
  }
  const sorted: string[] = [];
  const left = [...shapes];
  while (left.length > 0) {
    let at = left.findIndex(id => [...behind.get(id)!].every(back => sorted.includes(back)));
    if (at < 0) at = 0;
    sorted.push(left[at]!);
    left.splice(at, 1);
  }
  // The shapes take the places shapes had; a group keeps its own place, so its
  // pin and its style rule stay beside those of what it holds.
  const out = new Map<string, number>();
  let next = 0;
  for (const id of [...order.keys()].sort((a, b) => order.get(a)! - order.get(b)!)) {
    out.set(groups.has(id) ? id : sorted[next++]!, out.size);
  }
  return out;
}

/**
 * The shapes in the order the arrows run: each after everything pointing at it,
 * the next one taken in reading order whenever several are free. A cycle is
 * broken at its first shape in reading order, so no arrow order decides it.
 */
function arrowOrder(
  file: DiagramFile, ids: readonly string[], reading: (a: string, b: string) => number,
): Map<string, number> {
  const shapes = ids.filter(id => file.nodes.find(node => node.id === id)?.shape !== 'group');
  const known = new Set(shapes);
  const into = new Map<string, Set<string>>(shapes.map(id => [id, new Set()]));
  for (const edge of file.edges) {
    if (edge.arrow !== 'arrow' || edge.from === edge.to) continue;
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    into.get(edge.to)!.add(edge.from);
  }
  const left = [...shapes].sort(reading);
  const order = new Map<string, number>();
  while (left.length > 0) {
    let at = left.findIndex(id => [...into.get(id)!].every(from => order.has(from)));
    if (at < 0) at = 0;
    order.set(left[at]!, order.size);
    left.splice(at, 1);
  }
  return order;
}

function compareNumbers(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Sorts by a rank, things without one last; equal ranks keep their order. */
function byRank<T>(items: readonly T[], rank: (item: T) => number | undefined, name: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, rank: rank(item) ?? Infinity, name: name(item) }))
    .sort((a, b) => compareNumbers(a.rank, b.rank)
      || (a.rank === Infinity ? compareText(a.name, b.name) : 0)
      || a.index - b.index)
    .map(one => one.item);
}

// --- writing -------------------------------------------------------------------

type Order = 'canonical' | 'kept' | 'verbatim';

interface BodyPlan {
  readonly nodes: Order;
  readonly edges: Order;
  /** The canonical order the plan writes in. */
  readonly order: ReadonlyMap<string, number>;
}

/** The whole file, as lines without their line breaks. */
function write(
  file: DiagramFile, lines: readonly Line[], top: Top, pieces: Pieces,
  order: ReadonlyMap<string, number>, plan: BodyPlan,
): string[] {
  const out: string[] = [];
  const gap = (): void => {
    if (out.length > 0 && out[out.length - 1] !== '') out.push('');
  };

  out.push(...top.header);
  if (top.uses.length > 0) {
    gap();
    top.uses.forEach((use, index) => {
      if (use.leading.length > 0 && index > 0) gap();
      out.push(...use.leading, `${use.keyword} "${use.path}"`);
    });
  }

  const leadingOf = (names: readonly string[]): string[] =>
    top.sections.filter(one => names.includes(one.name)).flatMap(one => one.leading);
  const headerOf = (name: string): string => top.sections.find(one => one.name === name)?.header ?? '';
  const section = (head: string, leading: readonly string[], blocks: readonly (readonly Written[])[],
    trailing: readonly string[]): void => {
    const body = blocks.filter(block => block.length > 0);
    if (body.length === 0 && trailing.length === 0 && leading.length === 0) return;
    gap();
    out.push(...leading, `${head} {`);
    body.forEach((block, b) => {
      if (b > 0) out.push('');
      block.forEach((one, index) => {
        if (one.leading.length > 0 && index > 0) out.push('');
        out.push(...one.leading.map(text => INDENT + text), ...one.lines);
      });
    });
    if (trailing.length > 0) {
      if (body.length > 0) out.push('');
      out.push(...trailing.map(text => INDENT + text));
    }
    out.push('}');
  };

  const body = top.sections.find(one => BODY.has(one.name));
  if (body && file.mode === 'overlay') {
    section(`overlay "${file.image}"`, body.leading, [writeCallouts(pieces.callouts)],
      pieces.trailing.get('body') ?? []);
  } else if (body) {
    section(bodyHead(file, body.header), body.leading, writeBody(file, lines, pieces, order, plan),
      pieces.trailing.get('body') ?? []);
  }
  section(named('layout', headerOf('layout')), leadingOf(['layout']), writeLayout(file, lines, pieces, order),
    pieces.trailing.get('layout') ?? []);
  section(named('style', headerOf('style')), leadingOf(['style']), writeStyle(pieces, order),
    pieces.trailing.get('style') ?? []);
  section(named('parts', headerOf('parts')), leadingOf(['parts']), [writeParts(pieces.parts, lines)],
    pieces.trailing.get('parts') ?? []);

  if (top.trailing.length > 0) {
    gap();
    out.push(...top.trailing);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

function named(name: string, header: string): string {
  return header === '' ? name : `${name} ${header}`;
}

/** `flow Title LR` — the title first, then the direction, as the spec's examples write it. */
function bodyHead(file: DiagramFile, header: string): string {
  const mode = file.mode;
  if (mode !== 'flow') return named(mode, header);
  const words = header === '' ? [] : header.split(' ');
  const at = DIRECTION.test(words[0] ?? '') ? 0 : DIRECTION.test(words[words.length - 1] ?? '') ? words.length - 1 : -1;
  if (at < 0) return named(mode, header);
  const title = words.filter((_, index) => index !== at).join(' ');
  const written = [mode, title, words[at]!].filter(word => word !== '').join(' ');
  // A title whose own first word is a direction would be read as the direction;
  // such a header is left as it was.
  const again = parseHeaderDirection(`${title} ${words[at]}`.trim());
  return again === words[at] ? written : named(mode, header);
}

function parseHeaderDirection(header: string): string | undefined {
  const words = header.split(' ');
  return [words[0], words[words.length - 1]].find(word => word !== undefined && DIRECTION.test(word));
}

// --- the semantics section -------------------------------------------------------

function writeBody(
  file: DiagramFile, lines: readonly Line[], pieces: Pieces,
  order: ReadonlyMap<string, number>, plan: BodyPlan,
): (readonly Written[])[] {
  const shapes = pieces.nodes.filter(one => one.value.shape !== 'group');
  const groups = pieces.nodes.filter(one => one.value.shape === 'group');
  const idWidth = widest(shapes.map(one => one.value.id));
  const groupColumns = groupColumnsOf(groups.map(one => one.value));
  const edgeWidths = {
    from: widest(pieces.edges.map(one => one.value.from)),
    to: widest(pieces.edges.filter(one => one.value.label !== undefined).map(one => one.value.to)),
  };

  const writeNode = (piece: Piece<Node>): Written => ({
    leading: piece.leading,
    lines: piece.value.shape === 'group'
      ? [INDENT + groupLine(piece.value, groupColumns, order)]
      : shapeLines(file, piece, lines, idWidth),
  });
  const writeEdge = (piece: Piece<Edge>): Written => ({
    leading: piece.leading, lines: [INDENT + edgeLine(piece.value, edgeWidths)],
  });

  if (plan.nodes === 'verbatim') {
    return [pieces.body.map(piece => ('from' in piece.value
      ? writeEdge(piece as Piece<Edge>) : writeNode(piece as Piece<Node>)))];
  }
  const nodeRank = (piece: Piece<Node>): number | undefined => order.get(piece.value.id);
  const sortNodes = (list: Piece<Node>[]): Piece<Node>[] =>
    (plan.nodes === 'canonical' ? byRank(list, nodeRank, piece => piece.value.id) : list);
  const edges = plan.edges === 'canonical' ? sortEdges(pieces.edges, order) : pieces.edges;
  return [sortNodes(shapes).map(writeNode), sortNodes(groups).map(writeNode), edges.map(writeEdge)];
}

function sortEdges<T extends { value: Edge }>(edges: readonly T[], order: ReadonlyMap<string, number>): T[] {
  return edges
    .map((piece, index) => ({ piece, index }))
    .sort((a, b) => {
      const ea = a.piece.value;
      const eb = b.piece.value;
      return compareNumbers(order.get(ea.from) ?? Infinity, order.get(eb.from) ?? Infinity)
        || compareText(order.has(ea.from) ? '' : ea.from, order.has(eb.from) ? '' : eb.from)
        || compareNumbers(order.get(ea.to) ?? Infinity, order.get(eb.to) ?? Infinity)
        || compareText(order.has(ea.to) ? '' : ea.to, order.has(eb.to) ? '' : eb.to)
        || a.index - b.index;
    })
    .map(one => one.piece);
}

/** A shape: one line, or a part's rows below it. */
function shapeLines(file: DiagramFile, piece: Piece<Node>, lines: readonly Line[], idWidth: number): string[] {
  const node = piece.value;
  const head = INDENT + padToWidth(node.id, idWidth) + ' ';
  const part = file.partOf.get(node.id);
  const className = node.className === undefined ? '' : `:::${node.className}`;
  const first = lines[piece.first]!.text;

  const items = ITEMS_HEAD.exec(first);
  if (part !== undefined && items) {
    const inner = lines.slice(piece.first + 1, piece.last).map(line => line.text).filter(text => text !== '');
    const comments = inner.some(text => text.startsWith('#'));
    if (node.items.length === 0 && !comments) return [`${head}${part}:${className}`];
    if (piece.first === piece.last) return [INDENT + first];
    const out = [`${head}${part}: {`];
    let row = 0;
    for (const text of inner) {
      if (text.startsWith('#')) { out.push(INDENT.repeat(2) + text); continue; }
      const item = node.items[row++]!;
      out.push(INDENT.repeat(2 + item.depth)
        + `${item.closed ? '+' : '-'} ${item.text}${item.picked ? '*' : ''}`);
    }
    out.push(`${INDENT}}`);
    return out;
  }
  if (part !== undefined) {
    return [`${head}${part}:${node.text === '' ? '' : `"${node.text}"`}${className}`];
  }
  if (node.shape === 'line') return [`${head}--`];

  // The tightest spelling that reads back as the same shape; a label such as
  // `/a/` inside `[ … ]` needs its spaces, or it would read as a parallelogram.
  const [open, close] = BRACKETS[node.shape];
  for (const written of [`${open}${node.text}${close}`, `${open} ${node.text} ${close}`]) {
    const line = `${node.id} ${written}${className}`;
    if (readsAs(line, node)) return [head + written + className];
  }
  return [INDENT + first];
}

const BRACKETS: Readonly<Record<Node['shape'], readonly [string, string]>> = {
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
  line: ['--', ''],
};

/** Whether a shape line, read alone, says what the node says. */
function readsAs(line: string, node: Node): boolean {
  try {
    const read = parseDiagram(`free {\n${line}\n}`).nodes[0];
    return read !== undefined && read.id === node.id && read.shape === node.shape
      && read.text === node.text && read.className === node.className;
  } catch {
    return false;
  }
}

interface GroupColumns {
  readonly id: number;
  readonly label: number;
  readonly direction: number;
}

function groupColumnsOf(groups: readonly Node[]): GroupColumns {
  return {
    id: widest(groups.map(group => group.id)),
    label: widest(groups.map(groupLabel)),
    direction: widest(groups.map(group => group.direction ?? '')),
  };
}

/** A group's label, left out when it is only the id the parser would use anyway. */
function groupLabel(group: Node): string {
  return group.text === group.id ? '' : `"${group.text}"`;
}

function groupLine(group: Node, columns: GroupColumns, order: ReadonlyMap<string, number>): string {
  const children = byRank(group.children, id => order.get(id), id => id);
  const fields = [padToWidth(group.id, columns.id)];
  if (columns.label > 0) fields.push(padToWidth(groupLabel(group), columns.label));
  if (columns.direction > 0) fields.push(padToWidth(group.direction ?? '', columns.direction));
  return `group ${fields.join(' ')} ${children.length === 0 ? '{}' : `{ ${children.join('; ')} }`}`;
}

function edgeLine(edge: Edge, widths: { from: number; to: number }): string {
  const from = padToWidth(edge.from, widths.from);
  const to = edge.label === undefined ? edge.to : `${padToWidth(edge.to, widths.to)} "${edge.label}"`;
  return `${from} ${connector(edge)} ${to}${edge.loose ? ' ~' : ''}`;
}

/** The connector, spelt one way for each meaning: `-->` rather than `->`. */
function connector(edge: Edge): string {
  if (edge.line === 'invisible') return '~~~';
  const dashed = edge.line === 'dashed';
  if (edge.arrow === 'both') return dashed ? '<-.->' : '<-->';
  if (edge.arrow === 'arrow') return dashed ? '-.->' : '-->';
  return '--';
}

// --- the layout section ------------------------------------------------------------

function writeLayout(
  file: DiagramFile, lines: readonly Line[], pieces: Pieces, order: ReadonlyMap<string, number>,
): (readonly Written[])[] {
  const containers = byRank(pieces.containers, piece => order.get(piece.value.id), piece => piece.value.id)
    .map(piece => ({ leading: piece.leading, lines: containerLines(piece, lines) }));

  const pins = byRank(pieces.pins, piece => order.get(piece.value.id), piece => piece.value.id);
  const pinColumns = {
    id: widest(pins.map(piece => piece.value.id)),
    x: widest(pins.map(piece => String(piece.value.pin.x))),
    y: widest(pins.map(piece => String(piece.value.pin.y))),
    size: widest(pins.map(piece => sizeOf(piece.value.pin))),
  };

  const edgeRank = new Map(sortEdges(file.edges.map(edge => ({ value: edge })), order)
    .map((one, index) => [`${one.value.from}->${one.value.to}`, index]));
  const bends = byRank(pieces.bends, piece => edgeRank.get(piece.value.key), piece => piece.value.key);
  const bendWidth = widest(bends.map(piece => bendName(piece.value.key)));

  return [
    containers,
    pins.map(piece => ({ leading: piece.leading, lines: [INDENT + pinLine(piece.value.id, piece.value.pin, pinColumns)] })),
    bends.map(piece => ({
      leading: piece.leading,
      lines: [`${INDENT}${padToWidth(bendName(piece.value.key), bendWidth)} @ `
        + piece.value.bend.points.map(point => `(${point.x}, ${point.y})`).join('; ')],
    })),
  ];
}

function sizeOf(pin: Placement): string {
  return pin.width === undefined || pin.height === undefined ? '' : `${pin.width}x${pin.height}`;
}

function pinLine(
  id: string, pin: Placement, columns: { id: number; x: number; y: number; size: number },
): string {
  const size = columns.size > 0 ? ` ${sizeOf(pin).padStart(columns.size)}` : '';
  const z = pin.z === undefined ? '' : `  z:${pin.z}`;
  return `${padToWidth(id, columns.id)} @ (${String(pin.x).padStart(columns.x)}, `
    + `${String(pin.y).padStart(columns.y)})${size}${z}`.replace(/\s+$/, '');
}

/** `a->b` back to `a -> b`. An id has no hyphen, so the `->` is the only one. */
function bendName(key: string): string {
  const split = /^(.*?)->(.*)$/.exec(key);
  return split ? `${split[1]} -> ${split[2]}` : key;
}

/**
 * A container, its settings written only where they differ from the default.
 * A grid is written a row to a line with its cells lined up, which is the
 * shape it draws; a stack or a set of tabs is one line.
 */
function containerLines(piece: Piece<Container>, lines: readonly Line[]): string[] {
  const container = piece.value;
  const settings = containerSettings(container);
  const head = `${INDENT}${container.kind} ${container.id}${settings === '' ? '' : ` (${settings})`} {`;
  const inner = lines.slice(piece.first + 1, piece.last).map(line => line.text).filter(text => text !== '');

  if (piece.first !== piece.last && inner.some(text => text.startsWith('#'))) {
    // Comments among the rows stay where they were written, rows and all.
    const out = [head];
    for (const text of inner) {
      out.push(INDENT.repeat(2) + (text.startsWith('#') ? text
        : text.split(';').map(cell => cell.trim()).filter(cell => cell !== '').join(' ; ')));
    }
    out.push(`${INDENT}}`);
    return out;
  }
  if (container.kind !== 'grid') return [`${head} ${container.cells.flat().join(' ; ')} }`];

  const widths: number[] = [];
  for (const row of container.cells) {
    row.forEach((cell, index) => { widths[index] = Math.max(widths[index] ?? 0, displayWidth(cell)); });
  }
  return [
    head,
    ...container.cells.map(row => INDENT.repeat(2) + row
      .map((cell, index) => (index < row.length - 1 ? padToWidth(cell, widths[index]!) : cell))
      .join(' ; ')),
    `${INDENT}}`,
  ];
}

const DEFAULT_GAP = 12;

function containerSettings(container: Container): string {
  const out: string[] = [];
  if (container.kind === 'stack' && container.flow === 'right') out.push('right');
  if (container.kind === 'grid' && container.cols.length > 0) out.push(`cols: ${container.cols.join(', ')}`);
  const { x, y } = container.gap;
  if (x !== DEFAULT_GAP || y !== DEFAULT_GAP) out.push(x === y ? `gap: ${y}` : `gap: ${y} ${x}`);
  const pad = container.kind === 'tabs' ? 0 : 16;
  if (container.pad !== pad) out.push(`pad: ${container.pad}`);
  if (container.scroll !== 'none') {
    const natural = container.kind === 'stack' ? container.flow : 'down';
    out.push(container.scroll === natural ? 'scroll' : `scroll: ${container.scroll}`);
  }
  if (container.show !== undefined) out.push(`show: ${container.show}`);
  return out.join('; ');
}

// --- the style section ---------------------------------------------------------------

function writeStyle(pieces: Pieces, order: ReadonlyMap<string, number>): (readonly Written[])[] {
  const of = (kind: StyleEntry['kind']): Piece<StyleEntry>[] => pieces.style.filter(piece => piece.value.kind === kind);
  const rules = byRank(of('rule'), piece => order.get(ruleId(piece.value)), piece => ruleId(piece.value));
  const width = widest(rules.map(piece => ruleId(piece.value)));
  const text = (entry: StyleEntry): string => (entry.kind === 'rule'
    ? `${padToWidth(entry.id, width)} ${entry.line}` : entry.text);
  const written = (list: readonly Piece<StyleEntry>[]): Written[] =>
    list.map(piece => ({ leading: piece.leading, lines: [INDENT + text(piece.value)] }));
  return [written(of('theme')), written(rules), written(of('other'))];
}

function ruleId(entry: StyleEntry): string {
  return entry.kind === 'rule' ? entry.id : '';
}

/**
 * `{ fill: …, line: … }` with the declarations in the spec's order. Undefined
 * when a declaration does not read as one: the line is then kept as written,
 * since the parser drops what it cannot read and moving it would lose nothing
 * but its author's intent.
 */
function styleLine(inside: string): string | undefined {
  const declarations = declarationsOf(inside);
  if (declarations === undefined) return undefined;
  return declarations.length === 0 ? '{}' : `{ ${declarations.map(([k, v]) => `${k}: ${v}`).join(', ')} }`;
}

function declarationsOf(inside: string): [string, string][] | undefined {
  const out: [string, string][] = [];
  for (const one of inside.split(/[,;]/)) {
    if (one.trim() === '') continue;
    const kv = /^\s*([\w-]+)\s*:\s*(.+?)\s*$/.exec(one);
    if (!kv) return undefined;
    out.push([kv[1]!, kv[2]!]);
  }
  const rank = (name: string): number => {
    const at = PROPERTY_ORDER.indexOf(name);
    return at < 0 ? PROPERTY_ORDER.length : at;
  };
  return out
    .map((pair, index) => ({ pair, index }))
    .sort((a, b) => rank(a.pair[0]) - rank(b.pair[0])
      || (rank(a.pair[0]) === PROPERTY_ORDER.length ? compareText(a.pair[0], b.pair[0]) : 0)
      || a.index - b.index)
    .map(one => one.pair);
}

// --- parts and overlays ----------------------------------------------------------------

/**
 * Parts keep their order: a library is read by its headings, and the order
 * under them is the order its menu shows. Only the columns are lined up.
 */
function writeParts(parts: readonly Piece<Part>[], lines: readonly Line[]): Written[] {
  const rows = parts.map(piece => {
    const text = lines[piece.first]!.text;
    const name = /^(\S+)\s+(.*)$/.exec(text)!;
    let rest = name[2]!;
    let style = '';
    const styled = PART_STYLE.exec(rest);
    if (styled) {
      style = styleLine(styled[1]!) ?? `{${styled[1]}}`;
      rest = `${rest.slice(0, styled.index)} ${rest.slice(styled.index + styled[0].length)}`;
    }
    const sized = PART_SIZE.exec(rest);
    if (sized) rest = rest.slice(0, sized.index);
    return {
      piece, name: name[1]!, shape: rest.trim(), style,
      size: piece.value.width === undefined ? '' : `${piece.value.width}x${piece.value.height}`,
    };
  });
  const widths = {
    name: widest(rows.map(row => row.name)),
    shape: widest(rows.map(row => row.shape)),
    style: widest(rows.map(row => row.style)),
    size: widest(rows.map(row => row.size)),
  };
  return rows.map(row => {
    const fields = [padToWidth(row.name, widths.name), padToWidth(row.shape, widths.shape)];
    if (widths.style > 0) fields.push(padToWidth(row.style, widths.style));
    if (widths.size > 0) fields.push(row.size.padStart(widths.size));
    return { leading: row.piece.leading, lines: [INDENT + fields.join(' ').replace(/\s+$/, '')] };
  });
}

/** Callouts keep their order: it is the order their markers are numbered in. */
function writeCallouts(callouts: readonly Piece<Callout>[]): Written[] {
  const width = (pick: (callout: Callout) => number): number =>
    widest(callouts.map(piece => String(pick(piece.value))));
  const marker = widest(callouts.map(piece => piece.value.marker));
  const w = { x: width(c => c.x), y: width(c => c.y), tx: width(c => c.targetX), ty: width(c => c.targetY) };
  return callouts.map(piece => {
    const c = piece.value;
    const at = `(${String(c.x).padStart(w.x)}, ${String(c.y).padStart(w.y)})`;
    const to = `(${String(c.targetX).padStart(w.tx)}, ${String(c.targetY).padStart(w.ty)})`;
    const text = c.text === '' ? '' : `  "${c.text}"`;
    return { leading: piece.leading, lines: [`${INDENT}${padToWidth(c.marker, marker)} @ ${at} -> ${to}${text}`] };
  });
}

// --- proving nothing changed ---------------------------------------------------------------

/** What the file means, with spans and the order of unordered things left out. */
function modelOf(file: DiagramFile): string {
  const sorted = <T>(items: readonly T[]): string[] => items.map(item => JSON.stringify(item)).sort();
  const entries = (map: ReadonlyMap<string, string>): [string, string][] =>
    [...map].sort((a, b) => compareText(a[0], b[0]));
  return JSON.stringify({
    mode: file.mode,
    direction: file.direction ?? null,
    image: file.image ?? null,
    theme: file.theme ?? null,
    nodes: sorted(file.nodes.map(node => [node.id, node.text, node.shape, node.className ?? null,
      [...node.children].sort(), node.direction ?? null])),
    edges: sorted(file.edges.map(edge => [edge.from, edge.to, edge.label ?? null, edge.line, edge.arrow, edge.loose])),
    layout: sorted([...file.layout].map(([id, pin]) => [id, pin.x, pin.y, pin.width ?? null,
      pin.height ?? null, pin.z ?? null])),
    bends: sorted([...file.bends].map(([key, bend]) => [key, bend.points.map(point => [point.x, point.y])])),
    containers: sorted([...file.containers.values()].map(container => [container.id, container.kind,
      container.flow, container.scroll, container.show ?? null, container.cols,
      [container.gap.x, container.gap.y], container.pad, container.cells])),
    style: sorted([...file.style].map(([id, rule]) => [id, entries(rule)])),
    callouts: file.callouts.map(c => [c.marker, c.x, c.y, c.targetX, c.targetY, c.text]),
    items: sorted(file.nodes.map(node => [node.id, node.items.map(item =>
      [item.text, item.depth, item.closed, item.picked])])),
    uses: file.uses,
    itemTable: file.itemTable?.path ?? null,
    parts: [...file.parts.values()].map(part => [part.name, part.shape, entries(part.style),
      part.width ?? null, part.height ?? null, part.group ?? null]),
    partOf: entries(file.partOf),
  });
}

/** Every comment in the file, wherever it is. */
function commentsOf(lines: readonly Line[]): string {
  return JSON.stringify(lines.map(line => line.text).filter(text => text.startsWith('#')).sort());
}

/**
 * What a reader sees: where every box is, the path of every line, and which of
 * two overlapping shapes is in front. The painting order of shapes that do not
 * touch is left out — nobody can see it.
 */
function pictureOf(file: DiagramFile, read: PartReader | undefined): string {
  if (file.mode !== 'free' && file.mode !== 'flow') return '';
  let laid;
  try {
    laid = layOutDiagram(resolved(file, read));
  } catch (error) {
    return `error: ${String(error)}`;
  }
  const boxes = [...laid.boxes].map(([id, box]) => [id, box.x, box.y, box.width, box.height, box.z]);
  const routes = laid.routes.map(route => [route.edge.from, route.edge.to, route.points, route.labelAt ?? null]);
  const position = new Map(laid.order.map((id, index) => [id, index]));
  const ids = [...laid.boxes.keys()].sort(compareText);
  const front: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = laid.boxes.get(ids[i]!)!;
      const b = laid.boxes.get(ids[j]!)!;
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) {
        front.push(`${ids[i]}${(position.get(ids[i]!) ?? 0) < (position.get(ids[j]!) ?? 0) ? '<' : '>'}${ids[j]}`);
      }
    }
  }
  return JSON.stringify({
    boxes: boxes.map(box => JSON.stringify(box)).sort(),
    routes: routes.map(route => JSON.stringify(route)).sort(),
    front,
    size: [laid.width, laid.height],
    diagnostics: [...laid.diagnostics].sort(),
  });
}

/** The drawing with its parts applied, or as written when they cannot be read. */
function resolved(file: DiagramFile, read: PartReader | undefined): DiagramFile {
  try {
    return withParts(file, read ?? (() => undefined));
  } catch {
    return file;
  }
}

function widest(texts: readonly string[]): number {
  return texts.reduce((most, text) => Math.max(most, displayWidth(text)), 0);
}

function count(text: string, char: string): number {
  let n = 0;
  for (const c of text) if (c === char) n++;
  return n;
}
