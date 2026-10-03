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
import type { Container, DiagramFile, Point } from './model.js';

/** An empty cell. Written as a full stop because there is nothing to name. */
export const EMPTY_CELL = '.';

/** The room a group's own label takes at the top of its box. */
const GROUP_HEADER = 18;
/** The row of headings across the top of a tab control. */
export const TAB_STRIP = 26;
/** The bar down the edge of an area that is cut off. */
export const SCROLL_BAR = 12;

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

/**
 * The page a tabbed container draws: the one it names, or the first.
 *
 * The others are not drawn at all. That is what a tab control is — the reader
 * sees every heading and one page — and a drawing that showed them all at once
 * would be a drawing of something that cannot happen.
 */
export function shownPage(container: Container): string | undefined {
  const pages = members(container);
  return container.show !== undefined && pages.includes(container.show)
    ? container.show : pages[0];
}

/**
 * The shapes that are pages of a tab control.
 *
 * Their own words are the heading in the strip, so they are not also drawn
 * inside the page — a title written twice is a title someone will edit once.
 */
export function tabPages(diagram: DiagramFile): ReadonlySet<string> {
  const pages = new Set<string>();
  for (const container of diagram.containers.values()) {
    if (container.kind !== 'tabs') continue;
    for (const page of members(container)) pages.add(page);
  }
  return pages;
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
): ReadonlySet<string> {
  const hidden = new Set<string>();
  if (diagram.containers.size === 0) return hidden;
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
    // Pages are shown one at a time, so a tab control is as big as its biggest
    // page — not as big as all of them side by side.
    const pages = container.kind === 'tabs' ? members(container).map(intrinsic) : [];
    const widths = columnWidths(container, undefined, intrinsic);
    const heights = rowHeights(container, intrinsic);
    open.delete(id);
    const size: Size = container.kind === 'tabs' ? {
      width: Math.max(0, ...pages.map(one => one.width)) + container.pad * 2,
      height: Math.max(0, ...pages.map(one => one.height)) + container.pad * 2 + TAB_STRIP,
      lines: sizeOf(id).lines,
    } : {
      // An area that scrolls is as big as it was given, not as big as what is
      // in it: being longer than its room is the thing it is saying.
      width: container.scroll === 'right' ? sizeOf(id).width
        : sum(widths) + container.gap.x * Math.max(0, widths.length - 1) + container.pad * 2
          + (container.scroll === 'down' ? SCROLL_BAR : 0),
      height: container.scroll === 'down' ? sizeOf(id).height
        : sum(heights) + container.gap.y * Math.max(0, heights.length - 1)
          + container.pad * 2 + header(byId.get(id)?.shape)
          + (container.scroll === 'right' ? SCROLL_BAR : 0),
      lines: sizeOf(id).lines,
    };
    wanted.set(id, size);
    return size;
  };

  // A page nobody is shown, and everything inside it, is deliberately not
  // drawn. It has to be said here so that nothing parks it under the drawing.
  const hide = (id: string): void => {
    if (hidden.has(id)) return;
    hidden.add(id);
    const inside = diagram.containers.get(id);
    if (inside) for (const child of members(inside)) hide(child);
  };

  // Then outwards, from the containers that know where they are. A container
  // placed into another's cell becomes known in the round after it.
  const done = new Set<string>();
  for (let again = true; again;) {
    again = false;
    for (const container of diagram.containers.values()) {
      if (done.has(container.id) || hidden.has(container.id)) continue;
      const box = boxes.get(container.id);
      if (!box) continue;
      done.add(container.id);
      again = true;
      place(container, box, byId.get(container.id)?.shape, diagram, intrinsic, sizeOf, boxes, hide);
      // What does not fit is drawn anyway — hiding it would hide the mistake —
      // but a frame too small for its own contents is said out loud. An area
      // that scrolls is not too small: being cut off is what it says.
      const needs = intrinsic(container.id);
      if (container.scroll === 'none' && needs.height > box.height + 1) {
        diagnostics.push(
          `入れ物に中身が入りきらない: ${container.id}`
          + `（${Math.round(box.height)} に ${Math.round(needs.height)} ぶん）`);
      }
    }
  }
  for (const container of diagram.containers.values()) {
    if (!done.has(container.id) && !hidden.has(container.id) && byId.has(container.id)) {
      diagnostics.push(`入れ物の置き場所がない: ${container.id}`);
    }
  }
  return hidden;
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
  hide: (id: string) => void,
): void {
  // One page under the headings; the rest are not drawn.
  if (container.kind === 'tabs') {
    const page = shownPage(container);
    for (const other of members(container)) if (other !== page) hide(other);
    if (page === undefined || diagram.layout.has(page)) return;
    boxes.set(page, {
      x: box.x + container.pad,
      y: box.y + container.pad + TAB_STRIP,
      width: box.width - container.pad * 2,
      height: box.height - container.pad * 2 - TAB_STRIP,
      z: box.z, lines: sizeOf(page).lines,
    });
    return;
  }

  const left = box.x + container.pad;
  const top = box.y + container.pad + header(shape);
  // A bar down the edge takes room from what it is beside.
  const bar = { x: container.scroll === 'down' ? SCROLL_BAR : 0,
    y: container.scroll === 'right' ? SCROLL_BAR : 0 };
  const fold = {
    x: box.x + box.width - container.pad - bar.x,
    y: box.y + box.height - container.pad - bar.y,
  };
  const widths = columnWidths(container, box.width - container.pad * 2 - bar.x, intrinsic);
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
      const spot = {
        x: left + at(widths, where.col, container.gap.x),
        y: top + at(heights, where.row, container.gap.y) + (rowHeight - height) / 2,
      };
      // Past the fold of an area that scrolls: there, but not on screen. The
      // bar beside it is what says there is more.
      if ((container.scroll === 'down' && spot.y >= fold.y)
        || (container.scroll === 'right' && spot.x >= fold.x)) {
        hide(cell);
        continue;
      }
      boxes.set(cell, { ...spot, width, height, z: box.z, lines: sizeOf(cell).lines });
    }
  }
}

/**
 * Where a shape dragged inside its own container would land, and the mark that
 * says so.
 *
 * Reordering is the one gesture that changes an arrangement rather than
 * escaping it, so it has to be visible before the pointer is let go: a list
 * that silently reshuffles on release is a list nobody trusts. A stack takes
 * the shape in between two of its members; a grid trades places with the one
 * underneath, because its cells are a shape of their own and leaving holes in
 * them is not what anybody dragging meant.
 */
export function dropInto(
  container: Container, box: Box, boxOf: (id: string) => Box | undefined,
  moving: string, at: Point,
): { cells: string[][]; mark: Box } | undefined {
  // A tab page is not one of a row: what would be reordered is the strip, and
  // the strip is not what the pointer is on.
  if (container.kind === 'tabs') return undefined;
  const held = members(container);
  if (!held.includes(moving)) return undefined;

  if (container.kind === 'grid') {
    const onto = held.find(id => id !== moving && covers(boxOf(id), at));
    const target = onto === undefined ? undefined : boxOf(onto);
    if (onto === undefined || !target) return undefined;
    const cells = container.cells.map(row =>
      row.map(cell => (cell === moving ? onto : cell === onto ? moving : cell)));
    return { cells, mark: target };
  }

  const others = held.filter(id => id !== moving);
  const down = container.flow === 'down';
  const middleOf = (id: string): number => {
    const one = boxOf(id);
    if (!one) return Infinity;
    return down ? one.y + one.height / 2 : one.x + one.width / 2;
  };
  const pointer = down ? at.y : at.x;
  const index = others.findIndex(id => pointer < middleOf(id));
  const landing = index < 0 ? others.length : index;
  const next = [...others];
  next.splice(landing, 0, moving);
  if (next.join(' ') === held.join(' ')) return undefined;

  // The mark sits in the gap the shape would drop into, across the whole of
  // the container, so it reads as a place rather than as another shape.
  const edge = others[landing];
  const before = edge === undefined ? boxOf(others[others.length - 1]!) : boxOf(edge);
  const along = before === undefined ? (down ? box.y : box.x)
    : edge === undefined
      ? (down ? before.y + before.height : before.x + before.width) + container.gap.y / 2
      : (down ? before.y : before.x) - (down ? container.gap.y : container.gap.x) / 2;
  const mark = down
    ? { x: box.x + container.pad, y: along - 1.5, width: box.width - container.pad * 2, height: 3 }
    : { x: along - 1.5, y: box.y + container.pad, width: 3, height: box.height - container.pad * 2 };
  return {
    cells: down ? next.map(one => [one]) : [next],
    mark: { ...mark, z: box.z, lines: [] },
  };
}

function covers(box: Box | undefined, at: Point): boolean {
  return box !== undefined
    && at.x >= box.x && at.x <= box.x + box.width
    && at.y >= box.y && at.y <= box.y + box.height;
}
