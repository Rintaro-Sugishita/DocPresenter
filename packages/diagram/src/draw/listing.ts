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

function listRows(kind: Listing, box: Box, items: readonly Item[]): string {
  const room = Math.max(0, Math.floor((box.height - PAD * 2) / ROW));
  const cut = items.length > room;
  const inner = box.width - PAD * 2 - (cut ? BAR : 0);
  const marks: string[] = [];

  items.slice(0, room).forEach((item, i) => {
    const top = box.y + PAD + i * ROW;
    const middle = top + ROW / 2;
    const indent = kind === 'ui/tree' ? item.depth * INDENT + MARK : 0;
    if (item.picked) {
      marks.push(`<rect x="${n(box.x + PAD / 2)}" y="${n(top)}"`
        + ` width="${n(inner + PAD)}" height="${ROW}" rx="2" fill="${PICKED}"/>`);
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
    marks.push(`<text class="dp-listing-label" x="${n(box.x + PAD + indent)}"`
      + ` y="${n(middle)}" dominant-baseline="central"`
      + ` font-size="${FONT}" fill="${TEXT}">${escapeHtml(item.text)}</text>`);
  });

  return marks.join('') + (cut ? bar(box) : '');
}

/** A row has something under it when the row after it sits deeper. */
function hasChildren(items: readonly Item[], at: number): boolean {
  return (items[at + 1]?.depth ?? 0) > items[at]!.depth;
}

function menuRows(box: Box, items: readonly Item[]): string {
  const marks: string[] = [];
  let x = box.x + 4;
  for (const item of items) {
    const width = textWidth(item.text, FONT) + MENU_PAD * 2;
    if (x + width > box.x + box.width) break;
    if (item.picked) {
      marks.push(`<rect x="${n(x)}" y="${n(box.y + 3)}" width="${n(width)}"`
        + ` height="${n(box.height - 6)}" rx="2" fill="${PICKED}"/>`);
    }
    marks.push(`<text class="dp-listing-label" x="${n(x + width / 2)}"`
      + ` y="${n(box.y + box.height / 2)}" text-anchor="middle" dominant-baseline="central"`
      + ` font-size="${FONT}" fill="${TEXT}">${escapeHtml(item.text)}</text>`);
    x += width;
  }
  return marks.join('');
}

function bar(box: Box): string {
  const x = box.x + box.width - BAR - 2;
  return `<rect x="${n(x)}" y="${n(box.y + 2)}" width="${BAR}"`
    + ` height="${n(box.height - 4)}" rx="2" fill="#f2f3f5"/>`
    + `<rect x="${n(x + 2)}" y="${n(box.y + 5)}" width="${BAR - 4}"`
    + ` height="${n((box.height - 10) * 0.5)}" rx="${(BAR - 4) / 2}" fill="#c8ccd2"/>`;
}
