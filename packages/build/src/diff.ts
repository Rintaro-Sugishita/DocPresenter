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
  type Change, type DiagramMarks, type DiffMarks, type RangeMark,
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
    ranges, tables, diagrams,
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
  const rows = new Map<string, Change>();
  for (let r = 0; r < table.rows.length; r++) rows.set(keyOf(table, r), 'added');
  return { cells: new Map(), rows };
}

/**
 * Cells, not lines. A row is matched by the text of its leading cell and a
 * column by its header — the same names a style rule uses — so a row that moves
 * is not a change, and a row that is inserted does not mark everything below it.
 */
export function tableDiff(before: TableFile, after: TableFile): TableMarks {
  const cells = new Map<string, Change>();
  const rows = new Map<string, Change>();

  const oldRows = new Map<string, number>();
  before.rows.forEach((_, r) => oldRows.set(keyOf(before, r), r));

  after.rows.forEach((_, r) => {
    const key = keyOf(after, r);
    const was = oldRows.get(key);
    if (was === undefined) {
      rows.set(key, 'added');
      return;
    }
    for (let c = 0; c < after.columns.length; c++) {
      const header = after.columns[c]?.header ?? '';
      const oldColumn = before.columns.findIndex(column => column.header === header);
      const now = cellAt(after, r, c);
      if (!now || now.row !== r || now.column !== c) continue;
      if (oldColumn < 0) { cells.set(`${key}/${header}`, 'added'); continue; }
      const then = cellAt(before, was, oldColumn);
      if ((then?.text ?? '') !== now.text) cells.set(`${key}/${header}`, 'changed');
    }
  });

  return { cells, rows };
}

function keyOf(table: TableFile, row: number): string {
  return table.rows[row]?.cells[0]?.text ?? '';
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
    if (then.label !== edge.label || then.line !== edge.line || then.arrow !== edge.arrow) {
      edges.set(key, 'changed');
    }
  }

  return { nodes, edges };
}
