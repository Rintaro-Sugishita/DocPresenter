// What changed since another version.
//
// Nobody paints changes by hand. That was tried as a vocabulary the author
// wrote (`changed`, `removed`) and withdrawn for the reason such schemes are
// always withdrawn: the painting is work, the scrubbing off is work, and the
// moment someone forgets either one the colour is lying. The repository knows
// what changed, so it is asked (design/diff-marking.md §1).
//
// Three kinds of comparison, because there are three kinds of file. Prose is
// compared by lines. A table is compared by cells, and a drawing by shapes and
// connections, which is possible only because both are held as models rather
// than as pictures — and is the plainest benefit of holding them that way.

import { byteLength, toLf } from '@docpresenter/base';
import { parseDiagram, type DiagramFile } from '@docpresenter/diagram';
import {
  cellAt, parseTable,
  shownText,
  type Change, type DiagramMarks, type DiffMarks, type RangeMark, type RemovedRow, type RemovedText,
  type TableFile, type TableMarks,
} from '@docpresenter/markdown';
import { asLf, type Workspace } from './workspace.js';

/** The other version. A folder, a commit — whatever the caller can read. */
export type Previous = (path: string) => string | undefined;

export interface DiffOptions {
  readonly workspace: Workspace;
  readonly previous: Previous;
  /** Every file the build reaches, so each is compared once. */
  readonly files: readonly string[];
  /** What the marks are relative to, for the legend. */
  readonly from: string;
  readonly showRemoved?: 'none' | 'strike';
  /** The root document, whose ranges carry no file name. */
  readonly root: string;
}

export function diffOf(options: DiffOptions): DiffMarks {
  const ranges: RangeMark[] = [];
  const removed: RemovedText[] = [];
  const tables = new Map<string, TableMarks>();
  const diagrams = new Map<string, DiagramMarks>();

  for (const path of options.files) {
    // Both read as LF, so a CRLF checkout compares the same as an LF one and
    // the marks land on the ranges the rest of the build speaks (asLf).
    const now = asLf(options.workspace).read(path);
    if (now === undefined) continue;
    const previous = options.previous(path);
    const before = previous === undefined ? undefined : toLf(previous);

    if (/\.md$/i.test(path)) {
      const doc = path === options.root ? '' : path;
      if (before === undefined) {
        ranges.push({ doc, start: 0, end: byteLength(now), change: 'added' });
        continue;
      }
      ranges.push(...lineRanges(before, now, doc));
      removed.push(...removedLines(before, now, doc));
      continue;
    }
    if (/\.table$/i.test(path)) {
      tables.set(path, before === undefined
        ? wholeTable(parseTable(now)) : tableDiff(parseTable(before), parseTable(now)));
      continue;
    }
    if (/\.dgm$/i.test(path)) {
      try {
        diagrams.set(path, before === undefined
          ? wholeDiagram(parseDiagram(now)) : diagramDiff(parseDiagram(before), parseDiagram(now)));
      } catch {
        // A drawing that will not parse is reported where it is rendered.
      }
      continue;
    }
  }

  return {
    ranges, removed, tables, diagrams,
    showRemoved: options.showRemoved ?? 'none',
    from: options.from,
  };
}

// --- prose ----------------------------------------------------------------

/**
 * The byte ranges of the lines that are new or changed.
 *
 * A line that is only in the new version is added; a line that took the place
 * of one that is gone is a change. Deletions leave no range — there is nothing
 * in the new file to mark — and are shown, when they are shown at all, by the
 * document saying so rather than by this.
 */
export function lineRanges(before: string, after: string, doc: string): RangeMark[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const common = lcs(a, b);

  const ranges: RangeMark[] = [];
  let ai = 0;
  let bi = 0;
  let offset = 0;
  /** Byte offset of each line in the new text. */
  const starts = b.map(line => {
    const at = offset;
    offset += byteLength(line) + 1;
    return at;
  });

  const push = (from: number, to: number, change: Change): void => {
    if (to <= from) return;
    const start = starts[from]!;
    const end = starts[to - 1]! + byteLength(b[to - 1]!);
    const last = ranges[ranges.length - 1];
    if (last && last.change === change && last.end + 1 >= start) {
      ranges[ranges.length - 1] = { ...last, end };
      return;
    }
    ranges.push({ doc, start, end, change });
  };

  for (const [ax, bx] of common) {
    const removed = ax - ai;
    const added = bx - bi;
    if (added > 0) push(bi, bx, removed > 0 ? 'changed' : 'added');
    ai = ax + 1;
    bi = bx + 1;
  }
  if (bi < b.length) push(bi, b.length, ai < a.length ? 'changed' : 'added');
  return ranges;
}

/**
 * The lines that are gone, each run of them placed where it stood in the new
 * text: at the start of the lines that replaced it, or of the line that now
 * follows. Lines that were only blank, and the front matter (settings, not
 * prose), are left out.
 */
export function removedLines(before: string, after: string, doc: string): RemovedText[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const settings = frontMatterLines(a);
  const starts: number[] = [];
  let offset = 0;
  for (const line of b) { starts.push(offset); offset += byteLength(line) + 1; }
  const at = (index: number): number => (index < b.length ? starts[index]! : byteLength(after));

  const found: RemovedText[] = [];
  const take = (from: number, to: number, where: number): void => {
    const lines = a.slice(Math.max(from, settings), to);
    if (lines.every(line => line.trim() === '')) return;
    // A run is cut at its blank edges, so what is drawn is the words, not the gaps.
    while (lines[0]?.trim() === '') lines.shift();
    while (lines[lines.length - 1]?.trim() === '') lines.pop();
    found.push({ doc, at: at(where), text: lines.join('\n') });
  };
  let ai = 0;
  let bi = 0;
  for (const [ax, bx] of lcs(a, b)) {
    if (ax > ai) take(ai, ax, bi);
    ai = ax + 1;
    bi = bx + 1;
  }
  if (ai < a.length) take(ai, a.length, bi);
  return found;
}

/** How many leading lines are front matter (`---` … `---`). */
function frontMatterLines(lines: readonly string[]): number {
  if (lines[0]?.trim() !== '---') return 0;
  const end = lines.findIndex((line, i) => i > 0 && (line.trim() === '---' || line.trim() === '...'));
  return end < 0 ? 0 : end + 1;
}

/**
 * Matching line pairs: the longest common subsequence of the two line lists.
 *
 * An earlier version anchored on lines that appear exactly once in both files,
 * which is fast and wrong: blank lines repeat, so every gap between anchors
 * came back as a change and an untouched document lit up from end to end. A
 * design document is a few hundred lines, so the straightforward table is
 * affordable; a file far past that is marked whole rather than mis-marked.
 */
function lcs(a: readonly string[], b: readonly string[]): [number, number][] {
  const LIMIT = 4000;
  if (a.length > LIMIT || b.length > LIMIT) {
    return a.length === b.length && a.every((line, i) => line === b[i])
      ? a.map((_, i) => [i, i] as [number, number])
      : [];
  }

  // table[i][j] = the length of the longest common subsequence of a[i…] and b[j…]
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }

  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; continue; }
    if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i++;
    else j++;
  }
  return pairs;
}

// --- tables ---------------------------------------------------------------

function wholeTable(table: TableFile): TableMarks {
  const rows = new Map<number, Change>();
  for (let r = 0; r < table.rows.length; r++) rows.set(r, 'added');
  return { cells: new Map(), rows };
}

/**
 * Cells, not lines. A column is matched by its header — the name a style rule
 * uses. A row is matched by what it holds: first a row whose every cell is the
 * same (so a row that moves is not a change), then, among the rest, the row
 * that shares the most cells with it (so a row with one cell edited is that
 * row, changed). A row that shares no cell with any that is left is added, and
 * an inserted row does not mark everything below it.
 *
 * Rows are not matched by their leading cell's text: a leading column is
 * often a category merged down (`^`) or a running number (`#`), the same in
 * row after row.
 */
export function tableDiff(before: TableFile, after: TableFile): TableMarks {
  const cells = new Map<string, Change>();
  const rows = new Map<number, Change>();
  const was = new Map<string, string>();
  const columnOf = after.columns.map(column =>
    before.columns.findIndex(old => old.header === column.header));
  const textAt = (table: TableFile, r: number, c: number): string => cellAt(table, r, c)?.text ?? '';
  const signature = (table: TableFile, r: number, columns: readonly number[]): string =>
    columns.map(c => (c < 0 ? '\u0000' : textAt(table, r, c))).join('\u0001');

  // Rows the same in every column both versions have.
  const shared = columnOf.filter(c => c >= 0);
  const free = new Map<string, number[]>();
  before.rows.forEach((_, r) => {
    const key = signature(before, r, shared);
    free.set(key, [...(free.get(key) ?? []), r]);
  });
  const pairOf = new Map<number, number>();
  const left: number[] = [];
  after.rows.forEach((_, r) => {
    const key = signature(after, r, columnOf.map((c, i) => (c < 0 ? -1 : i)).filter(i => i >= 0));
    const same = free.get(key);
    if (same && same.length > 0) pairOf.set(r, same.shift()!);
    else left.push(r);
  });
  const unpaired = new Set([...free.values()].flat());

  // The rest: the old row that shares the most cells.
  for (const r of left) {
    let best = -1;
    let most = 0;
    for (const was of unpaired) {
      let alike = 0;
      columnOf.forEach((old, c) => {
        if (old >= 0 && textAt(after, r, c) !== '' && textAt(after, r, c) === textAt(before, was, old)) alike += 1;
      });
      if (alike > most) { most = alike; best = was; }
    }
    if (best < 0) { rows.set(r, 'added'); continue; }
    unpaired.delete(best);
    pairOf.set(r, best);
    for (let c = 0; c < after.columns.length; c++) {
      const now = cellAt(after, r, c);
      if (!now || now.row !== r || now.column !== c) continue;
      const old = columnOf[c]!;
      if (old < 0) { cells.set(`${r}/${c}`, 'added'); continue; }
      if (textAt(before, best, old) !== now.text) {
        cells.set(`${r}/${c}`, 'changed');
        was.set(`${r}/${c}`, shownAt(before, best, old));
      }
    }
  }

  // The rows left over are gone. Each goes above the first row now whose
  // partner stood after it, so it reappears where it was.
  const removedRows: RemovedRow[] = [...unpaired].sort((x, y) => x - y).map(old => {
    let at = after.rows.length;
    for (let r = 0; r < after.rows.length; r++) {
      const partner = pairOf.get(r);
      if (partner !== undefined && partner > old) { at = r; break; }
    }
    return { before: at, cells: columnOf.map(c => (c < 0 ? '' : shownAt(before, old, c))) };
  });
  const removedColumns = before.columns
    .filter(column => !after.columns.some(now => now.header === column.header))
    .map(column => column.header);

  // A column that is new is new in every row that was already there.
  for (const [r] of pairOf) {
    columnOf.forEach((old, c) => {
      const now = cellAt(after, r, c);
      if (old < 0 && now && now.row === r && now.column === c) cells.set(`${r}/${c}`, 'added');
    });
  }
  return { cells, rows, was, removedRows, removedColumns };
}

/** What a cell showed: a running number as its number, a merged cell as the cell it joins. */
function shownAt(table: TableFile, row: number, column: number): string {
  const cell = cellAt(table, row, column);
  return cell ? shownText(cell) : '';
}

// --- drawings -------------------------------------------------------------

function wholeDiagram(diagram: DiagramFile): DiagramMarks {
  return {
    nodes: new Map(diagram.nodes.map(node => [node.id, 'added' as Change])),
    edges: new Map(diagram.edges.map(edge => [`${edge.from}->${edge.to}`, 'added' as Change])),
  };
}

/**
 * Shapes and connections, by id.
 *
 * A drawing whose pins moved is not a changed drawing: the layer that holds
 * coordinates is not the layer that holds meaning, and a diagram someone
 * tidied up should not come back marked as rewritten. That distinction is the
 * three-layer model paying for itself.
 */
export function diagramDiff(before: DiagramFile, after: DiagramFile): DiagramMarks {
  const nodes = new Map<string, Change>();
  const edges = new Map<string, Change>();

  const was = new Map(before.nodes.map(node => [node.id, node]));
  for (const node of after.nodes) {
    const then = was.get(node.id);
    if (!then) { nodes.set(node.id, 'added'); continue; }
    if (then.text !== node.text || then.shape !== node.shape
      || then.className !== node.className
      || then.children.join(';') !== node.children.join(';')) {
      nodes.set(node.id, 'changed');
    }
  }

  const before_ = new Map(before.edges.map(edge => [`${edge.from}->${edge.to}`, edge]));
  for (const edge of after.edges) {
    const key = `${edge.from}->${edge.to}`;
    const then = before_.get(key);
    if (!then) { edges.set(key, 'added'); continue; }
    if (then.label !== edge.label || then.line !== edge.line || then.arrow !== edge.arrow
      || then.loose !== edge.loose) {
      edges.set(key, 'changed');
    }
  }

  // What is gone has no place left in the drawing, so it is named instead.
  const now = new Set(after.nodes.map(node => node.id));
  const nowEdges = new Set(after.edges.map(edge => `${edge.from}->${edge.to}`));
  const words = (id: string): string => {
    const text = was.get(id)?.text.trim();
    return text ? text : id;
  };
  const removed = {
    nodes: before.nodes.filter(node => !now.has(node.id)).map(node => words(node.id)),
    edges: before.edges.filter(edge => !nowEdges.has(`${edge.from}->${edge.to}`))
      .map(edge => `${words(edge.from)} → ${words(edge.to)}${edge.label ? ` (${edge.label})` : ''}`),
  };
  return { nodes, edges, ...(removed.nodes.length + removed.edges.length > 0 ? { removed } : {}) };
}
