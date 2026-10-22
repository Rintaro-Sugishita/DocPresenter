// What a .dgm file can have next, at the point someone is typing.
//
// The file being typed is broken almost by definition — half a shape, a brace
// not yet closed — so nothing here goes through the parser, which refuses a
// file at its first bad line. The file is read the way the parser finds its
// sections (by counting braces) and the lines are matched one by one, so a typo
// three lines up does not take the suggestions away.
//
// The answers are the notation itself: the twelve bracket pairs, the four
// connectors, the names already in the file, the parts the drawing can reach.
// The host decides how to show them; this knows nothing about an editor.

import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';
import { DEFAULT_GROUPS, DEFAULT_LIBRARY, ICON_LIBRARY } from './default-parts.js';
import { isListing } from './draw/listing.js';
import { stencilParts } from './draw/stencil.js';
import { DIAGRAM_MESSAGES } from './messages.js';
import type { Part, ShapeKind } from './model.js';

type DiagramMessage = (typeof DIAGRAM_MESSAGES.ids)[number];
type Say = ReturnType<typeof DIAGRAM_MESSAGES.in>;

export type CompletionKind =
  | 'section' | 'keyword' | 'shape' | 'connector' | 'id' | 'part'
  | 'container' | 'setting' | 'property' | 'value' | 'library' | 'snippet';

export interface Completion {
  /** What the list shows, and what typing narrows it by. */
  readonly label: string;
  readonly kind: CompletionKind;
  /** What is written, as a VS Code snippet (`$1`, `${1:x}`, `$0`). */
  readonly insert: string;
  /** What it is, in the reader's language. */
  readonly detail?: string;
  /**
   * Where the text it replaces starts, as a column of the cursor's line. It
   * replaces up to the cursor: the word being typed, which may hold `-` or `/`
   * where an editor's own idea of a word would stop.
   */
  readonly from: number;
  /** Open the list again once written: what goes next has suggestions too. */
  readonly again?: boolean;
  /** Ordering within the list, where the order matters more than the alphabet. */
  readonly sort?: string;
}

export interface CompletionContext {
  /** Every part the drawing can reach, when the host could read its libraries. */
  readonly parts?: ReadonlyMap<string, Part>;
  /** Files a `use` line could name, written relative to this file. */
  readonly libraries?: readonly string[];
  readonly locale?: Locale;
}

/** An identifier's characters (spec/dgm.md §2): no hyphen, which connectors are made of. */
const ID = '[A-Za-z0-9_぀-鿿]';
const ID_END = ID;
const TYPED_WORD = /[\w./-]*$/;

/** The twelve pairs, in the order a reader of flowcharts reaches for them. */
const SHAPES: readonly { open: string; close: string; shape: ShapeKind }[] = [
  { open: '[', close: ']', shape: 'rect' },
  { open: '(', close: ')', shape: 'round-rect' },
  { open: '{', close: '}', shape: 'diamond' },
  { open: '([', close: '])', shape: 'stadium' },
  { open: '[(', close: ')]', shape: 'cylinder' },
  { open: '((', close: '))', shape: 'ellipse' },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '[/', close: '/]', shape: 'parallelogram' },
  { open: '[/', close: '\\]', shape: 'loop-start' },
  { open: '[\\', close: '/]', shape: 'loop-end' },
  { open: '>', close: ']', shape: 'note' },
  { open: '"', close: '"', shape: 'text' },
];

const CONNECTORS: readonly { written: string; detail: DiagramMessage }[] = [
  { written: '-->', detail: 'diagram.complete.arrow' },
  { written: '->', detail: 'diagram.complete.arrow' },
  { written: '--', detail: 'diagram.complete.plain' },
  { written: '-.->', detail: 'diagram.complete.dashed' },
  { written: '<-->', detail: 'diagram.complete.both' },
  { written: '<-.->', detail: 'diagram.complete.bothDashed' },
  { written: '~~~', detail: 'diagram.complete.invisible' },
];

/** The properties a style rule or a part reads (spec/dgm.md §7.3, and a line's own three). */
const PROPERTIES: readonly { name: string; detail: DiagramMessage }[] = [
  { name: 'fill', detail: 'diagram.complete.fill' },
  { name: 'line', detail: 'diagram.complete.line' },
  { name: 'color', detail: 'diagram.complete.color' },
  { name: 'align', detail: 'diagram.complete.align' },
  { name: 'icon', detail: 'diagram.complete.icon' },
  { name: 'arrow', detail: 'diagram.complete.lineArrow' },
  { name: 'slope', detail: 'diagram.complete.slope' },
  { name: 'weight', detail: 'diagram.complete.weight' },
];

/** The tokens the shipped theme gives a meaning to. Any other is passed on as written. */
const TOKENS: Readonly<Record<string, readonly string[]>> = {
  fill: ['changed', 'pending', 'removed', 'disabled', 'shade', 'tint-1', 'tint-2'],
  line: ['dashed'],
  align: ['left', 'center', 'right'],
  arrow: ['none', 'start', 'end', 'both'],
  slope: ['down', 'up'],
};
const CLASSES = ['changed', 'pending', 'removed', 'disabled'];

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

/** Where in the file a line is. A nested block is the thing its braces belong to. */
type Frame = 'top' | 'semantics' | 'overlay' | 'layout' | 'style' | 'parts' | 'rows' | 'container';

/** What the file already says, gathered from every line that can be read. */
interface Known {
  /** Shapes and groups, by id, in the order written. */
  readonly shapes: Map<string, ShapeKind>;
  readonly edges: { from: string; to: string }[];
  readonly pinned: Set<string>;
  readonly bent: Set<string>;
  readonly styled: Set<string>;
  /** Shapes a container already holds — the container places them, not a pin. */
  readonly held: Set<string>;
  readonly classes: Set<string>;
  readonly sections: Set<string>;
  callouts: number;
  theme: boolean;
}

interface At {
  readonly before: string;
  readonly column: number;
  readonly known: Known;
  readonly say: Say;
  readonly context: CompletionContext;
}

/**
 * The suggestions at a line and column (both from 0, the column in UTF-16
 * units as an editor counts them).
 */
export function completeDiagram(
  source: string, line: number, column: number, context: CompletionContext = {},
): Completion[] {
  const lines = source.split('\n').map(one => one.replace(/\r$/, ''));
  // The line being typed is not yet anything, so it names nothing: a shape
  // half written must not be offered back as a shape to connect to.
  const { frames, known } = read(lines, line);
  const before = (lines[line] ?? '').slice(0, column);
  const at: At = {
    before, column, known, context, say: DIAGRAM_MESSAGES.in(context.locale ?? DEFAULT_LOCALE),
  };

  switch (frames[line] ?? 'top') {
    case 'top': return atTop(at);
    case 'semantics': return inSemantics(at);
    case 'overlay': return inOverlay(at);
    case 'layout': return inLayout(at);
    case 'container': return cells(at);
    case 'style': return inStyle(at);
    case 'parts': return inPart(at);
    case 'rows': return [];
  }
}

const SECTION = /^(free|flow|overlay|layout|style|parts)\b[^{]*\{$/;
const CONTAINER_OPEN = new RegExp(`^(stack|grid|tabs)\\s+(${ID}+)\\s*(?:\\([^)]*\\))?\\s*\\{(.*)$`);
const ROWS_OPEN = new RegExp(`^${ID}+\\s+[A-Za-z0-9_-]+:\\s*\\{\\s*$`);

/**
 * The frame each line opens in, and the names the file holds.
 *
 * The frame is decided the way the parser decides a section's extent — by the
 * braces — so that a suggestion and the reading agree on where a line is.
 */
function read(lines: readonly string[], typing: number): { frames: Frame[]; known: Known } {
  const known: Known = {
    shapes: new Map(), edges: [], pinned: new Set(), bent: new Set(), styled: new Set(),
    held: new Set(), classes: new Set(), sections: new Set(), callouts: 0, theme: false,
  };
  const frames: Frame[] = [];
  const stack: Frame[] = [];

  lines.forEach((raw, index) => {
    const frame = stack[stack.length - 1] ?? 'top';
    frames.push(frame);
    const text = raw.trim();
    if (text === '' || text.startsWith('#')) return;
    if (index !== typing) take(frame, text, known);

    const change = count(text, '{') - count(text, '}');
    if (change > 0) {
      const section = frame === 'top' ? SECTION.exec(text) : null;
      if (section) known.sections.add(section[1]!);
      const opened: Frame = section ? sectionFrame(section[1]!)
        : frame === 'layout' && CONTAINER_OPEN.test(text) ? 'container'
          : frame === 'semantics' && ROWS_OPEN.test(text) ? 'rows' : frame;
      for (let i = 0; i < change; i++) stack.push(opened);
    } else {
      for (let i = 0; i < -change; i++) stack.pop();
    }
  });
  return { frames, known };
}

function sectionFrame(name: string): Frame {
  return name === 'free' || name === 'flow' ? 'semantics' : name as Frame;
}

function count(text: string, char: string): number {
  let n = 0;
  for (const c of text) if (c === char) n++;
  return n;
}

const GROUP_LINE = new RegExp(`^group\\s+(${ID}+)`);
const LINE_NODE = new RegExp(`^(${ID}+?)\\s*-{2,}$`);
const EDGE_LINE = new RegExp(`^(${ID}+?)\\s*(?:<-\\.->|<-->|<->|-\\.->|-->|->|--|~~~)\\s*(${ID}+)`);
const NODE_LINE = new RegExp(`^(${ID}+)\\s*(.*)$`);
const PIN_LINE = new RegExp(`^(${ID}+)\\s*@`);
const BEND_LINE = new RegExp(`^(${ID}+?)\\s*-+>\\s*(${ID}+)\\s*@`);
const RULE_LINE = new RegExp(`^(${ID}+)\\s*\\{`);

/** Notes what one line says about the file. A line that cannot be read says nothing. */
function take(frame: Frame, text: string, known: Known): void {
  if (frame === 'semantics') {
    const group = GROUP_LINE.exec(text);
    if (group) { known.shapes.set(group[1]!, 'group'); return; }
    const line = LINE_NODE.exec(text);
    if (line) { known.shapes.set(line[1]!, 'line'); return; }
    const edge = EDGE_LINE.exec(text);
    if (edge) { known.edges.push({ from: edge[1]!, to: edge[2]! }); return; }
    const node = NODE_LINE.exec(text);
    if (node) {
      const written = node[2]!.replace(/\s*:::([\w-]+)\s*$/, (_, name: string) => {
        known.classes.add(name);
        return '';
      });
      known.shapes.set(node[1]!, SHAPES.find(one => written.startsWith(one.open))?.shape ?? 'rect');
    }
  } else if (frame === 'layout') {
    const bend = BEND_LINE.exec(text);
    if (bend) { known.bent.add(`${bend[1]}->${bend[2]}`); return; }
    const pin = PIN_LINE.exec(text);
    if (pin) { known.pinned.add(pin[1]!); return; }
    const container = CONTAINER_OPEN.exec(text);
    if (container) {
      known.pinned.add(container[2]!);
      for (const cell of container[3]!.replace(/\}.*$/, '').split(';')) known.held.add(cell.trim());
    }
  } else if (frame === 'container') {
    for (const cell of text.replace(/\}.*$/, '').split(';')) known.held.add(cell.trim());
  } else if (frame === 'style') {
    if (/^theme\s*:/.test(text)) { known.theme = true; return; }
    const rule = RULE_LINE.exec(text);
    if (rule) known.styled.add(rule[1]!);
  } else if (frame === 'overlay') {
    if (text.includes('@')) known.callouts++;
  }
}

// --- each frame ---------------------------------------------------------------

function atTop({ before, column, known, say, context }: At): Completion[] {
  const library = /^\s*use\s+"([^"]*)$/.exec(before);
  if (library) {
    const from = column - library[1]!.length;
    return [
      { label: DEFAULT_LIBRARY, detail: say('diagram.complete.libraryDefault') },
      { label: ICON_LIBRARY, detail: say('diagram.complete.libraryIcons') },
      ...(context.libraries ?? []).map(path => ({ label: path, detail: say('diagram.complete.libraryFile') })),
    ].map((one, i) => ({ ...one, kind: 'library', insert: one.label, from, sort: String(i).padStart(4, '0') }));
  }
  // `flow |` — which way it runs, as Mermaid's `flowchart LR` says it.
  const heading = /^\s*flow\s+([A-Z]*)$/.exec(before);
  if (heading) return directions(column - heading[1]!.length, say);
  if (!/^\s*[a-z]*$/.test(before)) return [];

  const from = column - before.trimStart().length;
  const drawing = ['free', 'flow', 'overlay'].some(name => known.sections.has(name));
  const found: Completion[] = [];
  const add = (one: Omit<Completion, 'from' | 'sort'>): void => {
    if (one.kind === 'section' && known.sections.has(one.label)) return;
    found.push({ ...one, from, sort: String(found.length) });
  };
  // A file holds one drawing. Once it has one, the others are not on offer.
  if (!drawing) {
    add({ label: 'flow', kind: 'section', insert: 'flow $1{\n\t$0\n}', detail: say('diagram.complete.flow') });
    add({ label: 'free', kind: 'section', insert: 'free $1{\n\t$0\n}', detail: say('diagram.complete.free') });
    add({
      label: 'overlay', kind: 'section', insert: 'overlay "${1:image.png}" {\n\t$0\n}',
      detail: say('diagram.complete.overlay'),
    });
  }
  // `layout` has no meaning in an overlay (spec/dgm.md §5).
  if (!known.sections.has('overlay')) {
    add({ label: 'layout', kind: 'section', insert: 'layout {\n\t$0\n}', detail: say('diagram.complete.layout') });
  }
  add({ label: 'style', kind: 'section', insert: 'style {\n\t$0\n}', detail: say('diagram.complete.style') });
  add({ label: 'use', kind: 'keyword', insert: 'use "$1"', detail: say('diagram.complete.use'), again: true });
  // A screen's item table: a screen is drawn where its shapes are put.
  if (!known.sections.has('overlay') && !known.sections.has('flow')) {
    add({ label: 'items', kind: 'keyword', insert: 'items "${1:items.table}"', detail: say('diagram.complete.items') });
  }
  add({ label: 'parts', kind: 'section', insert: 'parts {\n\t$0\n}', detail: say('diagram.complete.parts') });
  return found;
}

function inSemantics(at: At): Completion[] {
  const { before, column, known, say } = at;

  // `group g "…" |` — which way its own contents run, before its members.
  const way = new RegExp(`^\\s*group\\s+${ID}+\\s*(?:"[^"]*")?\\s+([A-Z]*)$`).exec(before);
  if (way) return directions(column - way[1]!.length, say);

  // `group g "…" { a; b; |`
  const members = new RegExp(`^\\s*group\\s+(${ID}+)\\s*(?:"[^"]*")?\\s*(?:(?:TB|TD|BT|LR|RL)\\s*)?\\{([^}]*?)(${ID}*)$`).exec(before);
  if (members) {
    const listed = new Set(members[2]!.split(';').map(one => one.trim()));
    return ids(known, column - members[3]!.length, say,
      id => id !== members[1] && !listed.has(id) && known.shapes.get(id) !== 'group');
  }

  // `a :::|`
  const classed = /:::([\w-]*)$/.exec(before);
  if (classed) {
    const from = column - classed[1]!.length;
    return [...new Set([...CLASSES, ...known.classes])].map(name => ({
      label: name, kind: 'value', insert: name, detail: say('diagram.complete.class'), from,
    }));
  }

  // `a -|` — the connector is being written.
  const connector = new RegExp(`^\\s*${ID}*?${ID_END}\\s*(<?-[-.>]*|<|~{1,2})$`).exec(before);
  if (connector) {
    const from = column - connector[1]!.length;
    return connectors(from, say).filter(one => one.label.startsWith(connector[1]!))
      .map(one => ({ ...one, insert: `${one.insert} `, again: true }));
  }

  // `a --> |` — what it connects to: anything not already joined from `a`.
  const edge = new RegExp(`^\\s*(${ID}+?)\\s*(?:<-\\.->|<-->|<->|-\\.->|-->|->|--)\\s+(${ID}*)$`).exec(before);
  if (edge) {
    const start = edge[1]!;
    const joined = new Set(known.edges.filter(one => one.from === start).map(one => one.to));
    return ids(known, column - edge[2]!.length, say,
      id => id !== start && !joined.has(id) && known.shapes.get(id) !== 'group');
  }

  // `a |` — what the shape is: a pair of brackets, a part, or a connection.
  const named = new RegExp(`^\\s*(${ID}+)\\s+([A-Za-z0-9_-]*)$`).exec(before);
  if (named && named[1] !== 'group') {
    const from = column - named[2]!.length;
    return [
      ...SHAPES.map(({ open, close, shape }, i): Completion => ({
        label: `${open} ${close}`, kind: 'shape', insert: `${open}$1${close}`,
        detail: shapeName(shape, say), from, sort: `0${String(i).padStart(2, '0')}`,
      })),
      { label: '--', kind: 'shape', insert: '--', detail: say('diagram.shape.line'), from, sort: '012' },
      ...parts(at, from),
      ...connectors(from, say).map((one, i) => ({ ...one, insert: `${one.insert} `, again: true, sort: `3${i}` })),
    ];
  }

  // A new line: a connection from a shape already there, or a group.
  if (new RegExp(`^\\s*${ID}*$`).test(before)) {
    const from = column - before.trimStart().length;
    return [
      ...ids(known, from, say, id => known.shapes.get(id) !== 'group'),
      {
        label: 'group', kind: 'keyword', insert: 'group ${1:id} "$2" { $0 }',
        detail: say('diagram.complete.group'), from, again: true,
      },
    ];
  }
  return [];
}

/** Mermaid's four words for the way a flow runs, and its second spelling of one. */
function directions(from: number, say: Say): Completion[] {
  return (['TB', 'LR', 'BT', 'RL', 'TD'] as const).map((name, i) => ({
    label: name, kind: 'value', insert: `${name} `, detail: say(`diagram.complete.direction${name}`),
    from, sort: String(i),
  }));
}

function connectors(from: number, say: Say): Completion[] {
  return CONNECTORS.map(({ written, detail }) => ({
    label: written, kind: 'connector', insert: written, detail: say(detail), from,
  }));
}

/** The parts this drawing can reach, as the line that uses one is written. */
function parts({ context, say }: At, from: number): Completion[] {
  return [...(context.parts?.values() ?? [])].map(part => {
    const rows = isListing(part.style.get('icon'));
    const heading = part.group === undefined ? undefined : DEFAULT_GROUPS[part.group];
    const group = heading === undefined ? part.group : say(heading as DiagramMessage);
    return {
      label: `${part.name}:`, kind: 'part',
      // A part that holds rows takes a list, one row a line; any other takes
      // its words in quotes.
      insert: rows ? `${part.name}: {\n\t- $0\n}` : `${part.name}:"$0"`,
      detail: rows ? say('diagram.complete.rows')
        : group === undefined ? say('diagram.complete.part') : say('diagram.complete.partGroup', { group }),
      from, sort: `2${part.name}`,
    };
  });
}

/** The shapes and groups in the file, narrowed by `keep`. */
function ids(known: Known, from: number, say: Say, keep: (id: string) => boolean): Completion[] {
  return [...known.shapes].filter(([id]) => keep(id)).map(([id, shape], i) => ({
    label: id, kind: 'id', insert: id, from, detail: shapeName(shape, say),
    sort: String(i).padStart(4, '0'),
  }));
}

/** What the canvas calls the shape. A group is not one of the twelve, so it has a word of its own. */
function shapeName(shape: ShapeKind, say: Say): string {
  return shape === 'group' ? say('diagram.complete.groupId') : say(`diagram.shape.${shape}`);
}

function inOverlay({ before, column, known, say }: At): Completion[] {
  if (before.trim() !== '') return [];
  const marker = CIRCLED[known.callouts] ?? String(known.callouts + 1);
  return [{
    label: marker, kind: 'snippet', from: column,
    insert: `${marker} @ (\${1:0}, \${2:0}) -> (\${3:0}, \${4:0}) "$5"`,
    detail: say('diagram.complete.callout'),
  }];
}

function inLayout(at: At): Completion[] {
  const { before, column, known, say } = at;

  // `grid form (cols: 1fr; |`
  const settings = /^\s*(stack|grid|tabs)\s+\S+\s*\(([^)]*)$/.exec(before);
  if (settings) return containerSettings(at, settings[1]!, settings[2]!);

  // `stack form { a; |`
  if (/^\s*(?:stack|grid|tabs)\s+\S+\s*(?:\([^)]*\))?\s*\{[^}]*$/.test(before)) return cells(at);

  // `a |` — a pin follows the id.
  const pinning = new RegExp(`^\\s*(${ID}+)\\s+$`).exec(before);
  if (pinning && !/^(stack|grid|tabs)$/.test(pinning[1]!)) {
    return [{
      label: '@ (x, y)', kind: 'snippet', insert: '@ (${1:0}, ${2:0})',
      detail: say('diagram.complete.pin'), from: column,
    }];
  }

  if (!new RegExp(`^\\s*${ID}*$`).test(before)) return [];
  const from = column - before.trimStart().length;
  const found: Completion[] = [];
  // Only what nobody placed yet: a pin is one line per shape (spec/dgm.md §4.2).
  for (const [id, shape] of known.shapes) {
    if (known.pinned.has(id) || known.held.has(id)) continue;
    found.push({
      label: id, kind: 'id', insert: `${id} @ (\${1:0}, \${2:0})`,
      detail: `${say('diagram.complete.pin')} — ${shapeName(shape, say)}`,
      from, sort: `0${String(found.length).padStart(4, '0')}`,
    });
  }
  for (const { from: start, to } of known.edges) {
    if (known.bent.has(`${start}->${to}`)) continue;
    found.push({
      label: `${start} -> ${to}`, kind: 'connector', insert: `${start} -> ${to} @ (\${1:0}, \${2:0})`,
      detail: say('diagram.complete.bend'), from, sort: `1${String(found.length).padStart(4, '0')}`,
    });
  }
  found.push(
    {
      label: 'stack', kind: 'container', insert: 'stack ${1:id} (${2|down,right|}) {\n\t$0\n}',
      detail: say('diagram.complete.stack'), from, sort: '2a',
    },
    {
      label: 'grid', kind: 'container', insert: 'grid ${1:id} (cols: ${2:1fr, 1fr}) {\n\t$0\n}',
      detail: say('diagram.complete.grid'), from, sort: '2b',
    },
    {
      label: 'tabs', kind: 'container', insert: 'tabs ${1:id} {\n\t$0\n}',
      detail: say('diagram.complete.tabs'), from, sort: '2c',
    },
  );
  return found;
}

function containerSettings({ column, known, say }: At, kind: string, written: string): Completion[] {
  const value = /(show|scroll)\s*:\s*(\S*)$/.exec(written);
  if (value) {
    const from = column - value[2]!.length;
    if (value[1] === 'show') return ids(known, from, say, () => true);
    return (['down', 'right'] as const).map(name => ({
      label: name, kind: 'value', insert: name, detail: say(`diagram.complete.${name}`), from,
    }));
  }
  const typed = /(?:^|;)\s*(\w*)$/.exec(written);
  if (!typed) return [];
  const from = column - typed[1]!.length;
  const words: { label: string; insert: string; detail: DiagramMessage }[] = [
    ...(kind === 'stack' ? [
      { label: 'down', insert: 'down', detail: 'diagram.complete.down' as const },
      { label: 'right', insert: 'right', detail: 'diagram.complete.right' as const },
    ] : []),
    ...(kind === 'grid' ? [{ label: 'cols', insert: 'cols: ${1:1fr, 1fr}', detail: 'diagram.complete.cols' as const }] : []),
    { label: 'gap', insert: 'gap: ${1:12}', detail: 'diagram.complete.gap' },
    { label: 'pad', insert: 'pad: ${1:16}', detail: 'diagram.complete.pad' },
    ...(kind === 'tabs' ? [{ label: 'show', insert: 'show: ', detail: 'diagram.complete.show' as const }] : []),
    { label: 'scroll', insert: 'scroll', detail: 'diagram.complete.scroll' },
  ];
  return words.map(one => ({
    label: one.label, kind: 'setting', insert: one.insert, detail: say(one.detail), from,
    again: one.label === 'show',
  }));
}

/** What a container can hold: the shapes no container holds yet. */
function cells({ before, column, known, say }: At): Completion[] {
  const typed = new RegExp(`(?:^|[;{])\\s*(${ID}*)$`).exec(before)?.[1];
  if (typed === undefined) return [];
  const listed = new Set(before.replace(/^.*\{/, '').split(';').map(one => one.trim()));
  return ids(known, column - typed.length, say,
    id => !listed.has(id) && !known.held.has(id) && known.shapes.get(id) !== 'group');
}

function inStyle(at: At): Completion[] {
  const { before, column, known, say } = at;
  const theme = /^\s*theme\s*:\s*(\S*)$/.exec(before);
  if (theme) {
    return [{
      label: 'default', kind: 'value', insert: 'default', detail: say('diagram.complete.theme'),
      from: column - theme[1]!.length,
    }];
  }
  const rule = new RegExp(`^\\s*${ID}+\\s*\\{([^}]*)$`).exec(before);
  if (rule) return declarations(at, rule[1]!);

  if (!new RegExp(`^\\s*${ID}*$`).test(before)) return [];
  const from = column - before.trimStart().length;
  const found: Completion[] = [];
  if (!known.theme) {
    found.push({
      label: 'theme', kind: 'keyword', insert: 'theme: ${1:default}', detail: say('diagram.complete.theme'),
      from, sort: '0',
    });
  }
  for (const [id, shape] of known.shapes) {
    if (known.styled.has(id)) continue;
    found.push({
      label: id, kind: 'id', insert: `${id} { $0 }`, again: true,
      detail: `${say('diagram.complete.rule')} — ${shapeName(shape, say)}`,
      from, sort: `1${String(found.length).padStart(4, '0')}`,
    });
  }
  return found;
}

function inPart(at: At): Completion[] {
  const look = /^\s*[A-Za-z0-9_-]+\s+[^{]*\{([^}]*)$/.exec(at.before);
  return look ? declarations(at, look[1]!) : [];
}

/** Inside `{ … }`: a property, or the value of the one being written. */
function declarations({ column, say, context }: At, written: string): Completion[] {
  const value = /(?:^|[,;])\s*([\w-]+)\s*:\s*([^,;]*)$/.exec(written);
  if (value) {
    const property = value[1]!;
    const typed = TYPED_WORD.exec(value[2]!)![0];
    const from = column - typed.length;
    if (property === 'icon') {
      return stencilParts(context.locale).map(part => ({
        label: part.name, kind: 'value', insert: part.name, detail: part.label, from,
      }));
    }
    return (TOKENS[property] ?? []).map(token => ({
      label: token, kind: 'value', insert: token, detail: say('diagram.complete.token'), from,
    }));
  }
  const name = /(?:^|[,;])\s*([\w-]*)$/.exec(written);
  if (!name) return [];
  const from = column - name[1]!.length;
  const taken = new Set([...written.matchAll(/([\w-]+)\s*:/g)].map(found => found[1]!));
  return PROPERTIES.filter(one => !taken.has(one.name)).map((one, i) => ({
    label: one.name, kind: 'property', insert: `${one.name}: `, detail: say(one.detail), from,
    again: true, sort: String(i),
  }));
}
