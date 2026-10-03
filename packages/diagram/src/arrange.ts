// Containers: the shapes that decide where the shapes they hold go.
//
// The layout layer used to be pins and nothing else, so a form of eight fields
// was eight coordinates — when the facts were "down the page, 12 apart, full
// width". A container says those three and the coordinates are computed, which
// is the same rule the rest of this format follows: what can be worked out is
// not written down. Inserting a field then changes one line instead of six.
//
// Two passes, as every layout engine has: how big each thing wants to be
// (bottom up, since a container is as big as what it holds), then where
// everything goes (top down, from the container's own box). A pin still wins:
// a shape that has one is drawn there and leaves its cell empty.

import type { Box } from './layout.js';
import type { TextLine } from './inline.js';
import type { Container, DiagramFile } from './model.js';

/** An empty cell. Written as a full stop because there is nothing to name. */
export const EMPTY_CELL = '.';

/** The room a group's own label takes at the top of its box. */
const GROUP_HEADER = 18;

export interface Size {
  readonly width: number;
  readonly height: number;
  readonly lines: readonly TextLine[];
}

/** Which container each shape is in, by the shape's id. */
export function containerOf(diagram: DiagramFile): ReadonlyMap<string, string> {
  const held = new Map<string, string>();
  for (const container of diagram.containers.values()) {
    for (const name of members(container)) {
      if (!held.has(name)) held.set(name, container.id);
    }
  }
  return held;
}

/** The ids a container holds, each once, in reading order. */
export function members(container: Container): readonly string[] {
  const seen = new Set<string>();
  for (const row of container.cells) {
    for (const cell of row) if (cell !== EMPTY_CELL) seen.add(cell);
  }
  return [...seen];
}

/**
 * Places what the containers hold, in the boxes the containers have.
 *
 * `boxes` is read for the containers' own boxes and written for their members.
 * A container whose own box is not known — one that was never pinned and sits
 * in no other container — is reported rather than guessed at: a form drawn at
 * a place nobody chose is a form in the wrong place.
 */
export function arrangeContainers(
  diagram: DiagramFile, sizeOf: (id: string) => Size,
  boxes: Map<string, Box>, diagnostics: string[],
): void {
  if (diagram.containers.size === 0) return;
  const byId = new Map(diagram.nodes.map(node => [node.id, node]));
  const held = new Map<string, string>();

  for (const container of diagram.containers.values()) {
    if (!byId.has(container.id)) {
      diagnostics.push(`入れ物が見つからない: ${container.id}`);
      continue;
    }
    for (const row of container.cells) {
      for (const cell of row) {
        if (cell === EMPTY_CELL) continue;
        if (!byId.has(cell)) {
          diagnostics.push(`入れ物の中身が見つからない: ${cell}（${container.id}）`);
        } else if (held.has(cell) && held.get(cell) !== container.id) {
          diagnostics.push(`2 つの入れ物に入っている: ${cell}`);
        } else held.set(cell, container.id);
      }
    }
  }

  // How big each thing wants to be. A container is as big as what it holds, so
  // this walks inwards; the guard is for a container that holds itself.
  const wanted = new Map<string, Size>();
  const open = new Set<string>();
  const intrinsic = (id: string): Size => {
    const found = wanted.get(id);
    if (found) return found;
    const container = diagram.containers.get(id);
    if (!container || open.has(id)) {
      if (open.has(id)) diagnostics.push(`入れ物が入れ子で自分を含んでいる: ${id}`);
      return sizeOf(id);
    }
    open.add(id);
    const widths = columnWidths(container, undefined, intrinsic);
    const heights = rowHeights(container, intrinsic);
    open.delete(id);
    const size: Size = {
      width: sum(widths) + container.gap.x * Math.max(0, widths.length - 1) + container.pad * 2,
      height: sum(heights) + container.gap.y * Math.max(0, heights.length - 1)
        + container.pad * 2 + header(byId.get(id)?.shape),
      lines: sizeOf(id).lines,
    };
    wanted.set(id, size);
    return size;
  };

  // Then outwards, from the containers that know where they are. A container
  // placed into another's cell becomes known in the round after it.
  const done = new Set<string>();
  for (let again = true; again;) {
    again = false;
    for (const container of diagram.containers.values()) {
      if (done.has(container.id)) continue;
      const box = boxes.get(container.id);
      if (!box) continue;
      done.add(container.id);
      again = true;
      place(container, box, byId.get(container.id)?.shape, diagram, intrinsic, sizeOf, boxes);
      // What does not fit is drawn anyway — hiding it would hide the mistake —
      // but a frame too small for its own contents is said out loud.
      const needs = intrinsic(container.id);
      if (needs.height > box.height + 1) {
        diagnostics.push(
          `入れ物に中身が入りきらない: ${container.id}`
          + `（${Math.round(box.height)} に ${Math.round(needs.height)} ぶん）`);
      }
    }
  }
  for (const container of diagram.containers.values()) {
    if (!done.has(container.id) && byId.has(container.id)) {
      diagnostics.push(`入れ物の置き場所がない: ${container.id}`);
    }
  }
}

/** A group writes its own name across the top, so its contents start below it. */
function header(shape: string | undefined): number {
  return shape === 'group' ? GROUP_HEADER : 0;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, one) => total + one, 0);
}

/**
 * Where a name sits in the cells: the smallest rectangle covering it. A name
 * written in two neighbouring cells occupies both, which is how
 * `grid-template-areas` says it — the written shape is the shape drawn.
 */
function area(
  container: Container, name: string,
): { row: number; col: number; rows: number; cols: number } {
  let top = Infinity; let left = Infinity; let bottom = -1; let right = -1;
  container.cells.forEach((row, r) => row.forEach((cell, c) => {
    if (cell !== name) return;
    top = Math.min(top, r); bottom = Math.max(bottom, r);
    left = Math.min(left, c); right = Math.max(right, c);
  }));
  return { row: top, col: left, rows: bottom - top + 1, cols: right - left + 1 };
}

/**
 * How wide each column is. `auto` is as wide as its widest member, a number is
 * itself, and `1fr` shares what is left over — so a form says `120, 1fr` and
 * the field column follows the frame whatever the frame's width.
 */
function columnWidths(
  container: Container, room: number | undefined, intrinsic: (id: string) => Size,
): number[] {
  const count = Math.max(1, ...container.cells.map(row => row.length));
  const spec = Array.from({ length: count }, (_, i) => container.cols[i] ?? '1fr');
  const widest = (column: number): number => {
    let found = 0;
    for (const row of container.cells) {
      const cell = row[column];
      // A name spanning several columns is not what decides any one of them.
      if (cell === undefined || cell === EMPTY_CELL) continue;
      if (area(container, cell).cols > 1) continue;
      found = Math.max(found, intrinsic(cell).width);
    }
    return found;
  };

  const widths = spec.map((one, i) => (one === 'auto' || one === '1fr' ? widest(i) : Number(one)));
  if (room === undefined) return widths;

  const gaps = container.gap.x * Math.max(0, count - 1);
  const shares = spec.filter(one => one === '1fr').length;
  const fixed = spec.reduce((total, one, i) => total + (one === '1fr' ? 0 : widths[i]!), 0);
  if (shares > 0) {
    const each = Math.max(0, room - gaps - fixed) / shares;
    return spec.map((one, i) => (one === '1fr' ? each : widths[i]!));
  }

  // Nothing shares the room, and what is asked for does not fit: the ones that
  // asked for "as wide as needed" give way, in proportion, the way a flex row
  // does. A column given a number keeps it — a number is an instruction.
  const loose = spec.reduce((total, one, i) => total + (one === 'auto' ? widths[i]! : 0), 0);
  if (loose === 0 || gaps + fixed <= room) return widths;
  const factor = Math.max(0, room - gaps - (fixed - loose)) / loose;
  return spec.map((one, i) => (one === 'auto' ? widths[i]! * factor : widths[i]!));
}

/** How tall each row is: as tall as its tallest member. */
function rowHeights(container: Container, intrinsic: (id: string) => Size): number[] {
  return container.cells.map(row => {
    let found = 0;
    for (const cell of row) {
      if (cell === EMPTY_CELL) continue;
      // A name spanning several rows is not what decides any one of them.
      if (area(container, cell).rows > 1) continue;
      found = Math.max(found, intrinsic(cell).height);
    }
    return found;
  });
}

function place(
  container: Container, box: Box, shape: string | undefined, diagram: DiagramFile,
  intrinsic: (id: string) => Size, sizeOf: (id: string) => Size, boxes: Map<string, Box>,
): void {
  const left = box.x + container.pad;
  const top = box.y + container.pad + header(shape);
  const widths = columnWidths(container, box.width - container.pad * 2, intrinsic);
  const heights = rowHeights(container, intrinsic);
  const at = (sizes: readonly number[], index: number, gap: number): number =>
    sizes.slice(0, index).reduce((total, one) => total + one + gap, 0);

  const placed = new Set<string>();
  for (const row of container.cells) {
    for (const cell of row) {
      if (cell === EMPTY_CELL || placed.has(cell)) continue;
      placed.add(cell);
      // A pin wins, as everywhere else in this format: the shape is drawn
      // where someone put it, and its cell is left empty.
      if (diagram.layout.has(cell)) continue;
      const where = area(container, cell);
      const width = sum(widths.slice(where.col, where.col + where.cols))
        + container.gap.x * (where.cols - 1);
      const rowHeight = sum(heights.slice(where.row, where.row + where.rows))
        + container.gap.y * (where.rows - 1);
      // The cell gives its width; the height is the shape's own, in the middle
      // of the row. A text box in a tall row should not become a tall text box.
      const size = intrinsic(cell);
      const height = diagram.containers.has(cell) ? rowHeight : Math.min(size.height, rowHeight);
      boxes.set(cell, {
        x: left + at(widths, where.col, container.gap.x),
        y: top + at(heights, where.row, container.gap.y) + (rowHeight - height) / 2,
        width, height, z: box.z, lines: sizeOf(cell).lines,
      });
    }
  }
}
