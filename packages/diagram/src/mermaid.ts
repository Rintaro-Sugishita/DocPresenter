// A flow written in Mermaid's `flowchart`, and the same flow written as a
// `.dgm` `flow` — each turned into the other.
//
// The two were made to be close: dgm borrowed Mermaid's brackets for its
// shapes, its connectors and its words for a direction, so most of a flowchart
// is the same text either way. What is left over is said, not dropped in
// silence: a flowchart's click handlers and its link styles have nowhere to go
// in a drawing, and a drawing's pins and pictures have nowhere to go in
// Mermaid. Both directions make a new text; nothing is read back into a file.

import { DEFAULT_LOCALE, say, type Locale, type Phrase } from '@docpresenter/base';
import { formatDiagram } from './format.js';
import { dgm } from './messages.js';
import type { DiagramFile, Edge, FlowDirection, Node, ShapeKind } from './model.js';
import { parseDiagram } from './parse.js';

/** What a conversion made, and what it could not carry across. */
export interface Converted {
  readonly text: string;
  readonly notes: readonly Phrase[];
}

// --- dgm → Mermaid ----------------------------------------------------------

/** The brackets Mermaid draws each shape with. Words go between them, quoted. */
const MERMAID_SHAPE: Readonly<Record<ShapeKind, readonly [string, string]>> = {
  rect: ['[', ']'], 'round-rect': ['(', ')'], stadium: ['([', '])'], cylinder: ['[(', ')]'],
  ellipse: ['((', '))'], diamond: ['{', '}'], hexagon: ['{{', '}}'], parallelogram: ['[/', '/]'],
  'loop-start': ['[/', '\\]'], 'loop-end': ['[\\', '/]'], note: ['>', ']'], text: ['[', ']'],
  group: ['[', ']'], line: ['[', ']'],
};

/** Words for inside Mermaid's quotes: a line break is `<br>`, a quote an entity. */
function mermaidWords(text: string): string {
  return text.replace(/\\n/g, '<br>').replace(/"/g, '#quot;');
}

/** A Mermaid id: the same as dgm's, which Mermaid reads too, unless it is one of Mermaid's words. */
function mermaidId(id: string): string {
  return /^(end|graph|flowchart|subgraph|style|class|classDef|click|direction|linkStyle)$/i.test(id) ? `${id}_` : id;
}

function mermaidLink(edge: Edge): string {
  if (edge.line === 'invisible') return '~~~';
  const dashed = edge.line === 'dashed';
  if (edge.arrow === 'both') return dashed ? '<-.->' : '<-->';
  if (edge.arrow === 'arrow') return dashed ? '-.->' : '-->';
  return dashed ? '-.-' : '---';
}

/**
 * A drawing as a Mermaid flowchart: its shapes, groups (as subgraphs), its
 * connections and the colours its style section gives them. A screen can be
 * turned too, but it is its pins and its parts that make it a screen.
 */
export function toMermaid(file: DiagramFile, locale: Locale = DEFAULT_LOCALE): Converted {
  if (file.mode !== 'flow' && file.mode !== 'free') {
    throw new Error(say(locale, dgm('diagram.mermaid.notFlow', { mode: file.mode })));
  }
  const notes: Phrase[] = [];
  if (file.mode === 'free' && file.layout.size > 0) notes.push(dgm('diagram.mermaid.pinsDropped'));
  const lines = [`flowchart ${file.direction ?? 'TB'}`];
  const groups = file.nodes.filter(node => node.shape === 'group');
  const plain = file.nodes.filter(node => node.shape !== 'group');
  const pictured = new Set<string>();

  for (const node of plain) {
    const [open, close] = MERMAID_SHAPE[node.shape];
    const icon = file.style.get(node.id)?.get('icon');
    if (icon !== undefined) pictured.add(node.id);
    const name = node.className === undefined ? '' : `:::${node.className}`;
    const words = node.items.length > 0 ? node.items.map(item => item.text).join('<br>') : mermaidWords(node.text);
    lines.push(`  ${mermaidId(node.id)}${open}"${words}"${close}${name}`);
  }
  if (pictured.size > 0) notes.push(dgm('diagram.mermaid.iconsDropped', { ids: [...pictured].join(', ') }));

  // A group inside another is a subgraph inside the other's.
  const inGroup = new Set(groups.flatMap(group => group.children));
  const byId = new Map(groups.map(group => [group.id, group]));
  const subgraph = (group: Node, depth: number, seen: Set<string>): void => {
    if (seen.has(group.id) || depth > 16) return;
    seen.add(group.id);
    const pad = '  '.repeat(depth);
    lines.push(`${pad}subgraph ${mermaidId(group.id)}["${mermaidWords(group.text)}"]`);
    if (group.direction !== undefined) lines.push(`${pad}  direction ${group.direction}`);
    for (const child of group.children) {
      const inner = byId.get(child);
      if (inner) subgraph(inner, depth + 1, seen);
      else lines.push(`${pad}  ${mermaidId(child)}`);
    }
    lines.push(`${pad}end`);
  };
  const seen = new Set<string>();
  for (const group of groups) if (!inGroup.has(group.id)) subgraph(group, 1, seen);
  for (const group of groups) subgraph(group, 1, seen);

  for (const edge of file.edges) {
    const label = edge.label === undefined || edge.label === '' ? '' : `|"${mermaidWords(edge.label)}"|`;
    lines.push(`  ${mermaidId(edge.from)} ${mermaidLink(edge)}${label} ${mermaidId(edge.to)}`);
  }

  // The colours an author chose. A token (`fill: changed`) means something
  // only to a theme, and Mermaid has none of ours.
  for (const node of file.nodes) {
    const rule = file.style.get(node.id);
    if (!rule) continue;
    const said: string[] = [];
    const colour = (value: string | undefined): value is string => value !== undefined && /^#[0-9a-f]{3,8}$/i.test(value);
    if (colour(rule.get('fill'))) said.push(`fill:${rule.get('fill')}`);
    if (colour(rule.get('line'))) said.push(`stroke:${rule.get('line')}`);
    if (rule.get('line') === 'dashed') said.push('stroke-dasharray:5 5');
    if (colour(rule.get('color'))) said.push(`color:${rule.get('color')}`);
    if (node.shape === 'text') said.push('fill:none', 'stroke:none');
    if (said.length > 0) lines.push(`  style ${mermaidId(node.id)} ${said.join(',')}`);
  }
  for (const node of plain) {
    if (node.shape === 'text' && !file.style.has(node.id)) lines.push(`  style ${mermaidId(node.id)} fill:none,stroke:none`);
  }
  return { text: `${lines.join('\n')}\n`, notes };
}

// --- Mermaid → dgm ----------------------------------------------------------

/** Mermaid's brackets, longest first, and the dgm shape each is. */
const FROM_MERMAID: readonly { open: string; close: string; shape: ShapeKind }[] = [
  { open: '(((', close: ')))', shape: 'ellipse' },
  { open: '([', close: '])', shape: 'stadium' },
  { open: '[[', close: ']]', shape: 'rect' },
  { open: '[(', close: ')]', shape: 'cylinder' },
  { open: '((', close: '))', shape: 'ellipse' },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '[/', close: '\\]', shape: 'loop-start' },
  { open: '[\\', close: '/]', shape: 'loop-end' },
  { open: '[/', close: '/]', shape: 'parallelogram' },
  { open: '[\\', close: '\\]', shape: 'parallelogram' },
  { open: '(', close: ')', shape: 'round-rect' },
  { open: '[', close: ']', shape: 'rect' },
  { open: '{', close: '}', shape: 'diamond' },
  { open: '>', close: ']', shape: 'note' },
];

/** The dgm brackets of each shape. */
const DGM_SHAPE: Readonly<Partial<Record<ShapeKind, readonly [string, string]>>> = {
  rect: ['[', ']'], 'round-rect': ['(', ')'], stadium: ['([', '])'], cylinder: ['[(', ')]'],
  ellipse: ['((', '))'], diamond: ['{', '}'], hexagon: ['{{', '}}'], parallelogram: ['[/', '/]'],
  'loop-start': ['[/', '\\]'], 'loop-end': ['[\\', '/]'], note: ['>', ']'], text: ['"', '"'],
};

interface Shape { id: string; text: string; shape: ShapeKind; className: string | undefined }
interface Link { from: string; to: string; connector: string; label: string | undefined }
interface Subgraph { id: string; label: string; direction: FlowDirection | undefined; members: string[] }

/** Mermaid's words in a label, as dgm writes them. */
function dgmWords(text: string): string {
  let words = text.trim();
  if (words.startsWith('"') && words.endsWith('"') && words.length >= 2) words = words.slice(1, -1);
  // A markdown string (`"`**bold**`"`) is written in dgm's own inline notation already.
  if (words.startsWith('`') && words.endsWith('`') && words.length >= 2) words = words.slice(1, -1);
  return words
    .replace(/<br\s*\/?>/gi, '\\n')
    .replace(/#quot;/g, '”')
    .replace(/#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .trim();
}

/** A Mermaid id written in the characters of a dgm id (no hyphen, no dot). */
function dgmId(id: string): string {
  const clean = id.replace(/[^A-Za-z0-9_぀-鿿]/g, '_');
  return clean === '' ? 'node' : clean;
}

const ID = /^[A-Za-z0-9_぀-鿿][A-Za-z0-9_぀-鿿\-.]*/;
const DIRECTIONS = new Set(['TB', 'TD', 'BT', 'LR', 'RL']);

/** One node reference at the start of the text: an id, its brackets if any, a class. */
function readNode(text: string): { shape: Shape; written: boolean; rest: string } | undefined {
  const id = ID.exec(text);
  if (!id) return undefined;
  // `a-->b` is a node `a` and a link: an id does not end in the hyphens of a link.
  let name = id[0];
  const link = /(-{2,}|-\.|={2,}).*$/.exec(name);
  if (link) name = name.slice(0, link.index);
  name = name.replace(/[-.]+$/, '');
  if (name === '') return undefined;
  let rest = text.slice(name.length);
  let shape: ShapeKind = 'rect';
  let words = name;
  let written = false;
  for (const one of FROM_MERMAID) {
    if (!rest.startsWith(one.open)) continue;
    const end = closingOf(rest, one.open, one.close);
    if (end < 0) continue;
    words = dgmWords(rest.slice(one.open.length, end));
    rest = rest.slice(end + one.close.length);
    shape = one.shape;
    written = true;
    break;
  }
  let className: string | undefined;
  const cls = /^:::([\w-]+)/.exec(rest);
  if (cls) { className = cls[1]; rest = rest.slice(cls[0].length); }
  return { shape: { id: dgmId(name), text: words, shape, className }, written, rest: rest.trimStart() };
}

/** Where the closing bracket is: past any quoted words, which may hold brackets of their own. */
function closingOf(text: string, open: string, close: string): number {
  let i = open.length;
  while (i < text.length) {
    if (text[i] === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    if (text.startsWith(close, i)) return i;
    i++;
  }
  return -1;
}

/** One link at the start of the text, with its label in either of Mermaid's two ways. */
function readLink(text: string): { connector: string; label: string | undefined; rest: string } | undefined {
  // `A -- words --> B`, `A -. words .-> B`, `A == words ==> B`
  const inline = /^(<?)(--|==|-\.)(?![-=.>ox])\s*(.+?)\s*(-{2,}>|-{3,}|={2,}>|={3,}|\.-+>|\.-+)/.exec(text);
  if (inline) {
    return { connector: `${inline[1]}${inline[2]}${inline[4]}`, label: dgmWords(inline[3]!), rest: text.slice(inline[0].length).trimStart() };
  }
  const plain = /^(<|o|x)?(-{2,}|={2,}|-\.+-|~{3,})(>|o|x)?\s*(?:\|([^|]*)\|)?/.exec(text);
  if (!plain) return undefined;
  // Two hyphens and nothing else are not a link Mermaid draws (`---` is).
  const line = plain[2]!;
  if (plain[1] === undefined && plain[3] === undefined && line.length < 3 && !line.includes('.')) return undefined;
  return {
    connector: `${plain[1] ?? ''}${plain[2]}${plain[3] ?? ''}`,
    label: plain[4] === undefined ? undefined : dgmWords(plain[4]),
    rest: text.slice(plain[0].length).trimStart(),
  };
}

/** A Mermaid link as the dgm connector that draws it, and whether anything was lost. */
function dgmConnector(link: string): { connector: string; lost: boolean } {
  if (link.startsWith('~')) return { connector: '~~~', lost: false };
  const dashed = link.includes('.');
  const start = /^[<ox]/.test(link);
  const end = /[>ox]$/.test(link);
  const lost = /[ox]/.test(link) || link.includes('=');
  if (start && end) return { connector: dashed ? '<-.->' : '<-->', lost };
  if (end) return { connector: dashed ? '-.->' : '-->', lost };
  if (start) return { connector: dashed ? '<-.->' : '<-->', lost: true };
  // dgm has no dashed line without a head yet (spec/dgm.md §3.2).
  return { connector: '--', lost: lost || dashed };
}

/** Splits a line into statements at the `;` that are not inside brackets or quotes. */
function statements(line: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '"') quoted = !quoted;
    else if (!quoted && '[({'.includes(char)) depth++;
    else if (!quoted && '])}'.includes(char)) depth = Math.max(0, depth - 1);
    else if (!quoted && depth === 0 && char === ';') { out.push(line.slice(start, i)); start = i + 1; }
  }
  out.push(line.slice(start));
  return out.map(one => one.trim()).filter(one => one !== '');
}

/**
 * A Mermaid flowchart as a dgm `flow`: its nodes with their shapes, its
 * subgraphs as groups, its links and their labels, and the colours `style`
 * gives. What dgm has no word for is listed in the notes.
 */
export function fromMermaid(source: string, locale: Locale = DEFAULT_LOCALE): Converted {
  const notes: Phrase[] = [];
  // A fenced block pasted from a document, a front matter, comments.
  let text = source.replace(/\r\n?/g, '\n');
  const fence = /```\s*mermaid\s*\n([\s\S]*?)```/.exec(text);
  if (fence) text = fence[1]!;
  text = text.replace(/^\s*---\n[\s\S]*?\n---\s*\n/, '');
  const lines = text.split('\n').map(line => line.replace(/%%.*$/, '').trim()).filter(line => line !== '');

  const header = /^(flowchart|graph)(?:\s+(TB|TD|BT|LR|RL))?\s*;?\s*(.*)$/i.exec(lines[0] ?? '');
  if (!header) throw new Error(say(locale, dgm('diagram.mermaid.notFlowchart')));
  const direction = header[2]?.toUpperCase() as FlowDirection | undefined;

  const shapes = new Map<string, Shape>();
  const links: Link[] = [];
  const subgraphs: Subgraph[] = [];
  const open: Subgraph[] = [];
  const placed = new Set<string>();
  const style = new Map<string, string[]>();
  /** Boxes drawn with no fill and no outline: words alone, which dgm has a shape for. */
  const bare = new Set<string>();
  const skipped = new Set<string>();

  const meet = (shape: Shape, written: boolean): string => {
    const known = shapes.get(shape.id);
    if (!known || (written && known.text === known.id && known.shape === 'rect')) shapes.set(shape.id, shape);
    else if (written) shapes.set(shape.id, { ...shape, className: shape.className ?? known.className });
    const inside = open.at(-1);
    if (inside && !placed.has(shape.id)) { inside.members.push(shape.id); placed.add(shape.id); }
    return shape.id;
  };

  const body = [...(header[3] ? [header[3]] : []), ...lines.slice(1)];
  for (const line of body) {
    for (const statement of statements(line)) {
      const sub = /^subgraph\s+(.*)$/.exec(statement);
      if (sub) {
        const rest = sub[1]!.trim();
        const named = /^([A-Za-z0-9_぀-鿿\-.]+)\s*\[(.*)\]$/.exec(rest);
        const id = named ? dgmId(named[1]!) : /^[A-Za-z0-9_぀-鿿]+$/.test(rest) ? rest : `group${subgraphs.length + 1}`;
        const label = named ? dgmWords(named[2]!) : dgmWords(rest);
        const graph: Subgraph = { id, label, direction: undefined, members: [] };
        const outer = open.at(-1);
        if (outer) { outer.members.push(id); placed.add(id); }
        subgraphs.push(graph);
        open.push(graph);
        continue;
      }
      if (statement === 'end') { open.pop(); continue; }
      const way = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(statement);
      if (way) {
        const graph = open.at(-1);
        if (graph) graph.direction = way[1]!.toUpperCase() as FlowDirection;
        continue;
      }
      const styled = /^style\s+(\S+)\s+(.+)$/.exec(statement);
      if (styled) {
        const said: string[] = [];
        if (/fill:\s*none/.test(styled[2]!) && /stroke:\s*none/.test(styled[2]!)) bare.add(dgmId(styled[1]!));
        for (const pair of styled[2]!.split(',')) {
          const [key, value] = pair.split(':').map(one => one.trim());
          if (value === undefined) continue;
          if (key === 'fill' && /^#[0-9a-f]{3,6}$/i.test(value)) said.push(`fill: ${value}`);
          else if (key === 'stroke' && /^#[0-9a-f]{3,6}$/i.test(value)) said.push(`line: ${value}`);
          else if (key === 'color' && /^#[0-9a-f]{3,6}$/i.test(value)) said.push(`color: ${value}`);
          else if (key === 'stroke-dasharray') said.push('line: dashed');
        }
        if (said.length > 0) style.set(dgmId(styled[1]!), said);
        continue;
      }
      const word = /^(classDef|class|click|linkStyle|accTitle|accDescr|title)\b/.exec(statement);
      if (word) { skipped.add(word[1]!); continue; }

      // A chain: nodes (several joined by `&`) and the links between them.
      let rest = statement;
      let before: string[] | undefined;
      let pending: { connector: string; label: string | undefined } | undefined;
      let ok = true;
      while (rest !== '') {
        const group: string[] = [];
        for (;;) {
          const node = readNode(rest);
          if (!node) { ok = false; break; }
          if (node.rest.startsWith('@{')) {
            skipped.add('@{ shape }');
            const end = node.rest.indexOf('}');
            node.rest = end < 0 ? '' : node.rest.slice(end + 1).trimStart();
          }
          group.push(meet(node.shape, node.written));
          rest = node.rest;
          if (!rest.startsWith('&')) break;
          rest = rest.slice(1).trimStart();
        }
        if (!ok) break;
        if (before) {
          const link = pending!;
          for (const from of before) for (const to of group) links.push({ from, to, connector: link.connector, label: link.label });
        }
        before = group;
        if (rest === '') break;
        const link = readLink(rest);
        if (!link) { ok = false; break; }
        pending = link;
        rest = link.rest;
      }
      if (!ok) notes.push(dgm('diagram.mermaid.unread', { text: statement }));
    }
  }
  for (const word of skipped) notes.push(dgm('diagram.mermaid.skipped', { word }));

  // A subgraph's id may be a node's too: the group wins, and links to it join the group.
  for (const graph of subgraphs) shapes.delete(graph.id);

  const out: string[] = [`flow${direction === undefined || direction === 'TB' ? '' : ` ${direction}`} {`];
  for (const shape of shapes.values()) {
    if (bare.has(shape.id) && shape.shape === 'rect') shape.shape = 'text';
    const [open2, close] = DGM_SHAPE[shape.shape] ?? ['[', ']'];
    const words = shape.text.replace(/[\r\n]/g, ' ');
    out.push(`  ${shape.id} ${open2}${words}${close}${shape.className === undefined ? '' : `:::${shape.className}`}`);
  }
  if (subgraphs.length > 0) out.push('');
  for (const graph of subgraphs) {
    const label = graph.label.replace(/"/g, '”').replace(/\\n/g, ' ');
    const members = graph.members.filter(member => shapes.has(member) || subgraphs.some(one => one.id === member));
    out.push(`  group ${graph.id} "${label}"${graph.direction === undefined ? '' : ` ${graph.direction}`} { ${members.join('; ')} }`);
  }
  if (links.length > 0) out.push('');
  const pairs = new Set<string>();
  let lost = false;
  for (const link of links) {
    const key = `${link.from}->${link.to}`;
    if (pairs.has(key)) { notes.push(dgm('diagram.mermaid.twice', { from: link.from, to: link.to })); continue; }
    pairs.add(key);
    const { connector, lost: dropped } = dgmConnector(link.connector);
    lost ||= dropped;
    const words = link.label === undefined || link.label === '' || connector === '~~~'
      ? '' : ` "${link.label.replace(/"/g, '”')}"`;
    out.push(`  ${link.from} ${connector} ${link.to}${words}`);
  }
  if (lost) notes.push(dgm('diagram.mermaid.linkLook'));
  out.push('}');
  if (style.size > 0) {
    out.push('', 'style {');
    for (const [id, said] of style) out.push(`  ${id} { ${said.join(', ')} }`);
    out.push('}');
  }
  const written = `${out.join('\n')}\n`;
  // In the canonical order and spacing, the way the formatter writes it —
  // and read once, so what comes out is a drawing that can be read.
  try {
    parseDiagram(written);
    const formatted = formatDiagram(written, () => undefined);
    return { text: formatted.text, notes };
  } catch {
    return { text: written, notes };
  }
}

/** The notes of a conversion, in the reader's language. */
export function conversionNotes(converted: Converted, locale: Locale = DEFAULT_LOCALE): string[] {
  return converted.notes.map(note => say(locale, note));
}
