// The three controls whose picture is their contents: a tree, a list, a menu.
//
// Every other picture in this package is fixed artwork — a router looks like a
// router whatever it is called. These three do not: a tree with four branches
// and a tree with twenty are different drawings, and the difference is the
// thing a reader of the screen is looking at. So they are drawn from the rows
// the shape holds.
//
// They are still pictures rather than shapes (design/diagram-model.md §10.2):
// the rows have no ids, no styles and no lines of their own in the item list.
// What the specification has a row for is the tree.

import { escapeHtml } from '@docpresenter/base';
import { n } from './geometry.js';
import { textWidth } from '../text.js';
import type { Box } from '../layout.js';
import type { Item } from '../model.js';

/** The pictures drawn from rows, by the name a part points at them with. */
export const LISTINGS = ['ui/tree', 'ui/list', 'ui/menu'] as const;
export type Listing = (typeof LISTINGS)[number];

export function isListing(icon: string | undefined): icon is Listing {
  return LISTINGS.includes(icon as Listing);
}

const ROW = 22;
const INDENT = 15;
const PAD = 7;
const FONT = 13;
/** Room for the mark that opens and closes a branch. */
const MARK = 14;
/** How far apart the words of a menu bar sit. */
const MENU_PAD = 13;
/** The bar down the edge of a list too long for its box. */
const BAR = 10;

const FACE = 'fill="#ffffff" stroke="#aeb4bd" stroke-width="1.3"';
const PICKED = '#dce6f2';
const MARK_COLOUR = '#5a6270';
const TEXT = '#3a4048';

/**
 * A tree, a list or a menu bar, drawn from its rows.
 *
 * Rows that do not fit are not drawn and a bar is drawn down the edge, the
 * same answer an area that scrolls gives: a control showing eight of twenty
 * rows is what the screen will do, and pretending otherwise would be drawing
 * something that cannot happen.
 */
export function listingArt(kind: Listing, box: Box, items: readonly Item[]): string {
  const face = `<rect class="dp-listing-face" x="${n(box.x)}" y="${n(box.y)}"`
    + ` width="${n(box.width)}" height="${n(box.height)}" ${FACE}/>`;
  return kind === 'ui/menu'
    ? face + menuRows(box, items)
    : face + listRows(kind, box, items);
}

/**
 * Which rows are on screen, and where.
 *
 * The editor needs this as much as the renderer does: a row has to be pressed
 * to be changed, and a row the pointer cannot find is a row nobody can edit.
 * So both ask here, and the answer is one box per row — `undefined` for a row
 * that is not drawn, which keeps the list countable by row number. A row goes
 * undrawn when it fell past the bottom of the box, or when a branch above it
 * is closed: the mark on a closed branch says there is more under it, which is
 * the whole point of the mark.
 */
export function rowBoxes(
  kind: Listing, box: Box, items: readonly Item[],
): readonly (Box | undefined)[] {
  const found: (Box | undefined)[] = items.map(() => undefined);
  if (kind === 'ui/menu') {
    let x = box.x + 4;
    for (const [i, item] of items.entries()) {
      const width = textWidth(item.text, FONT) + MENU_PAD * 2;
      if (x + width > box.x + box.width) break;
      found[i] = {
        x, y: box.y + 3, width, height: box.height - 6, z: box.z, lines: [],
      };
      x += width;
    }
    return found;
  }
  const open = openRows(items);
  const room = Math.max(0, Math.floor((box.height - PAD * 2) / ROW));
  const inner = box.width - PAD * 2 - (open.length > room ? BAR : 0);
  open.slice(0, room).forEach((at, slot) => {
    found[at] = {
      x: box.x + PAD / 2, y: box.y + PAD + slot * ROW,
      width: inner + PAD, height: ROW, z: box.z, lines: [],
    };
  });
  return found;
}

/**
 * The rows a reader would see, in order: everything but what a closed branch
 * holds. Depth alone says what is under what, so the fold is read the same way
 * the drawing is.
 */
function openRows(items: readonly Item[]): readonly number[] {
  const found: number[] = [];
  /** The depth of the closed branch we are inside, if we are inside one. */
  let folded: number | undefined;
  for (const [i, item] of items.entries()) {
    if (folded !== undefined && item.depth > folded) continue;
    folded = item.closed ? item.depth : undefined;
    found.push(i);
  }
  return found;
}

/** Where the words of a row start, which is where a box to edit them goes. */
export function rowTextAt(
  kind: Listing, box: Box, items: readonly Item[], index: number,
): Box {
  const row = rowBoxes(kind, box, items)[index];
  if (!row) return { ...box, height: ROW, lines: [] };
  if (kind === 'ui/menu') return row;
  const indent = textIndent(kind, items[index]!);
  return { ...row, x: row.x + indent, width: Math.max(20, row.width - indent - PAD / 2) };
}

/** How far into its row a row's words sit: its depth, and room for the mark. */
function textIndent(kind: Listing, item: Item): number {
  return PAD / 2 + (kind === 'ui/tree' ? item.depth * INDENT + MARK : 0);
}

function listRows(kind: Listing, box: Box, items: readonly Item[]): string {
  const boxes = rowBoxes(kind, box, items);
  const marks: string[] = [];

  items.forEach((item, i) => {
    const row = boxes[i];
    if (!row) return;
    const middle = row.y + ROW / 2;
    if (item.picked) {
      marks.push(`<rect x="${n(row.x)}" y="${n(row.y)}"`
        + ` width="${n(row.width)}" height="${ROW}" rx="2" fill="${PICKED}"/>`);
    }
    // A branch says which way it goes: pointing right while it is closed,
    // down while it is open. A row with nothing under it says nothing.
    if (kind === 'ui/tree' && (item.closed || hasChildren(items, i))) {
      const x = box.x + PAD + item.depth * INDENT + 3;
      const path = item.closed
        ? `M ${n(x)} ${n(middle - 4)} L ${n(x + 5)} ${n(middle)} L ${n(x)} ${n(middle + 4)}`
        : `M ${n(x - 1)} ${n(middle - 2)} L ${n(x + 4)} ${n(middle + 3)}`
          + ` L ${n(x + 9)} ${n(middle - 2)}`;
      marks.push(`<path d="${path}" fill="none" stroke="${MARK_COLOUR}" stroke-width="1.4"`
        + ' stroke-linejoin="round" stroke-linecap="round"/>');
    }
    marks.push(`<text class="dp-listing-label" x="${n(row.x + textIndent(kind, item))}"`
      + ` y="${n(middle)}" dominant-baseline="central"`
      + ` font-size="${FONT}" fill="${TEXT}">${escapeHtml(item.text)}</text>`);
  });

  const room = Math.max(0, Math.floor((box.height - PAD * 2) / ROW));
  return marks.join('') + (openRows(items).length > room ? bar(box) : '');
}

/** A row has something under it when the row after it sits deeper. */
function hasChildren(items: readonly Item[], at: number): boolean {
  return (items[at + 1]?.depth ?? 0) > items[at]!.depth;
}

function menuRows(box: Box, items: readonly Item[]): string {
  const boxes = rowBoxes('ui/menu', box, items);
  const marks: string[] = [];
  items.forEach((item, i) => {
    const row = boxes[i];
    if (!row) return;
    if (item.picked) {
      marks.push(`<rect x="${n(row.x)}" y="${n(row.y)}" width="${n(row.width)}"`
        + ` height="${n(row.height)}" rx="2" fill="${PICKED}"/>`);
    }
    marks.push(`<text class="dp-listing-label" x="${n(row.x + row.width / 2)}"`
      + ` y="${n(box.y + box.height / 2)}" text-anchor="middle" dominant-baseline="central"`
      + ` font-size="${FONT}" fill="${TEXT}">${escapeHtml(item.text)}</text>`);
  });
  return marks.join('');
}

function bar(box: Box): string {
  const x = box.x + box.width - BAR - 2;
  return `<rect x="${n(x)}" y="${n(box.y + 2)}" width="${BAR}"`
    + ` height="${n(box.height - 4)}" rx="2" fill="#f2f3f5"/>`
    + `<rect x="${n(x + 2)}" y="${n(box.y + 5)}" width="${BAR - 4}"`
    + ` height="${n((box.height - 10) * 0.5)}" rx="${(BAR - 4) / 2}" fill="#c8ccd2"/>`;
}
