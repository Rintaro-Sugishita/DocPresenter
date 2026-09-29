// Reads a laid-out document out of the browser as a page plan.
//
// The browser is the layout engine: it breaks the lines, applies the kerning,
// and resolves every colour the theme declares. This file does not lay
// anything out — it reads what the browser decided and says where each mark
// ended up. What it does decide is where the pages break, because that is the
// one thing the browser will not do the way a design document needs
// (a table has to repeat its header, and `---` has to start a page).
//
// Everything here runs inside the page, so it uses DOM APIs only and holds no
// imports that a bundler would have to resolve at run time.

import { collect } from './collect.js';
import { mapPathData } from './plan.js';
import type { Item, Page, PagePlan, TextItem } from './plan.js';

/** CSS defines these exactly, so no probing is needed. */
const PX_PER_PT = 96 / 72;
const PX_PER_MM = 96 / 25.4;

export interface PageSetup {
  /** Points. */
  readonly width: number;
  readonly height: number;
  readonly margin: {
    readonly top: number; readonly right: number;
    readonly bottom: number; readonly left: number;
  };
  readonly footSize: number;
  readonly footColour: string;
}

export interface MeasureOptions {
  /** Printed at the foot of every page, beside the page number. */
  readonly foot?: string;
  readonly title?: string;
  readonly commit?: string;
}

export interface Measurement {
  readonly plan: PagePlan;
  readonly diagnostics: readonly string[];
}

/** The paper, as the theme declares it. */
export function readPageSetup(root: Element): PageSetup {
  const style = getComputedStyle(root);
  const pt = (name: string, fallback: number): number => {
    const value = style.getPropertyValue(name).trim();
    return value === '' ? fallback : toPoints(value, fallback);
  };
  return {
    width: pt('--page-width', 595),
    height: pt('--page-height', 842),
    margin: {
      top: pt('--page-margin-top', 57),
      right: pt('--page-margin-right', 51),
      bottom: pt('--page-margin-bottom', 51),
      left: pt('--page-margin-left', 51),
    },
    footSize: pt('--page-foot-size', 8),
    footColour: style.getPropertyValue('--page-foot-colour').trim() || '#6b7280',
  };
}

export function toPoints(value: string, fallback = 0): number {
  const found = /^(-?[\d.]+)(mm|cm|in|pt|px|pc)?$/.exec(value.trim());
  if (!found) return fallback;
  const size = Number(found[1]);
  switch (found[2]) {
    case 'mm': return (size * PX_PER_MM) / PX_PER_PT;
    case 'cm': return (size * 10 * PX_PER_MM) / PX_PER_PT;
    case 'in': return size * 72;
    case 'pc': return size * 12;
    case 'px': return size / PX_PER_PT;
    default: return size;                       // pt, or a bare number
  }
}

/**
 * One piece of a block that a page break may fall between. A line of prose, a
 * row of a table, a whole figure. Ranges are in the pixels of the pass the
 * block was measured in.
 */
interface Fragment {
  readonly top: number;
  readonly bottom: number;
  /** Repeated at the top of every page the block continues onto. */
  readonly repeat: boolean;
  /** Kept with the fragment after it: a heading alone at the foot reads badly. */
  readonly keepWithNext: boolean;
  /** Which block it belongs to, so a table's header follows its rows. */
  readonly block: number;
}

type Orientation = 'portrait' | 'landscape';

/** A mark, with what a page break needs to know about it. */
interface Held {
  readonly item: Item;
  readonly top: number;
  readonly bottom: number;
  /** The merged cell it belongs to, when it belongs to one. */
  readonly cell?: { readonly top: number; readonly bottom: number; readonly room: number };
}

/** One block of the document, as one measuring pass saw it. */
interface MeasuredBlock {
  readonly index: number;
  readonly orientation: Orientation;
  /** A page break is required before this block. */
  readonly forced: boolean;
  readonly items: readonly Held[];
  readonly fragments: readonly Fragment[];
}

/** A page, before its marks are placed on it. */
interface Sheet {
  readonly orientation: Orientation;
  readonly fragments: Fragment[];
  readonly offsets: number[];
}

export function measure(root: HTMLElement, options: MeasureOptions = {}): Measurement {
  const portrait = readPageSetup(document.documentElement);
  const landscape = turned(portrait);
  const diagnostics: string[] = [];

  // Two passes, because a page turned sideways is a different measure and the
  // browser has to lay the block out at the width it will be printed at. Only
  // the blocks that asked for it are taken from the second pass, and a document
  // with none is not laid out twice.
  const turns = root.querySelector('[data-page="landscape"]') !== null;
  const blocks = [
    ...(turns ? pass(root, landscape, 'landscape', diagnostics) : []),
    ...pass(root, portrait, 'portrait', diagnostics),
  ].sort((a, b) => a.index - b.index);

  const sheets: Sheet[] = [];
  let current: Sheet | undefined;
  let cursor = 0;
  const repeats = new Map<number, Fragment[]>();

  const flush = (): void => {
    if (current && current.fragments.length > 0) sheets.push(current);
    current = undefined;
    cursor = 0;
  };

  for (const block of blocks) {
    const setup = block.orientation === 'landscape' ? landscape : portrait;
    const contentHeight = (setup.height - setup.margin.top - setup.margin.bottom) * PX_PER_PT;

    // A sheet boundary, a change of paper, or the first block starts a page.
    if (block.forced || current === undefined || current.orientation !== block.orientation) {
      flush();
    }

    for (const [i, fragment] of block.fragments.entries()) {
      const height = fragment.bottom - fragment.top;
      if (fragment.repeat) {
        const held = repeats.get(fragment.block) ?? [];
        held.push(fragment);
        repeats.set(fragment.block, held);
      }

      // A heading is kept with what follows it, so it never ends a page alone.
      const next = block.fragments[i + 1];
      const withNext = fragment.keepWithNext && next ? next.bottom - next.top : 0;

      if (current && cursor > 0 && cursor + height + withNext > contentHeight) {
        flush();
      }
      if (current === undefined) {
        current = { orientation: block.orientation, fragments: [], offsets: [] };
        // A table that continues brings its header rows with it.
        if (!fragment.repeat) {
          for (const header of repeats.get(fragment.block) ?? []) {
            current.fragments.push(header);
            current.offsets.push(cursor - header.top);
            cursor += header.bottom - header.top;
          }
        }
      }
      if (height > contentHeight) {
        diagnostics.push(`1 ページに収まらない要素がある（高さ ${Math.round(height)}px）`);
      }
      current.fragments.push(fragment);
      current.offsets.push(cursor - fragment.top);
      cursor += height;
    }
  }
  flush();

  const byBlock = new Map(blocks.map(block => [block.index, block]));
  // How the theme writes "continued". Empty means the theme does not want it.
  const continuedValue = getComputedStyle(document.documentElement)
    .getPropertyValue('--table-continued').trim().replace(/^["']|["']$/g, '');
  const continued = continuedValue === '' ? undefined : continuedValue;
  const built: Page[] = sheets.map((sheet, index) => {
    const setup = sheet.orientation === 'landscape' ? landscape : portrait;
    const dx = setup.margin.left * PX_PER_PT;
    const dy = setup.margin.top * PX_PER_PT;
    const placed: Item[] = [];

    sheet.fragments.forEach((fragment, at) => {
      const offset = sheet.offsets[at]!;
      // Where a merged cell that began on an earlier page says what it is a
      // continuation of: the first fragment of the block on this page that is
      // not one of the repeated header rows.
      const opens = sheet.fragments.findIndex(
        one => one.block === fragment.block && !one.repeat) === at;
      for (const held of byBlock.get(fragment.block)?.items ?? []) {
        for (const piece of within(held, fragment, opens, continued)) {
          placed.push(shift(piece, dx, offset + dy));
        }
      }
    });

    return {
      items: [...placed.map(toPoints2), foot(setup, index + 1, sheets.length, options)],
      ...(sheet.orientation === 'landscape'
        ? { width: setup.width, height: setup.height } : {}),
    };
  });

  return {
    plan: {
      width: portrait.width, height: portrait.height, pages: built,
      ...(options.title === undefined ? {} : { title: options.title }),
      ...(options.commit === undefined ? {} : { commit: options.commit }),
    },
    diagnostics,
  };
}

/**
 * The part of a mark that belongs to one fragment.
 *
 * Most marks belong where they start. A fill is the exception and is cut: the
 * background and the side rules of a cell merged down five rows have to carry
 * on across the page break, and a cell that stopped at the foot of the page
 * would leave the continuation open on one side.
 */
function within(
  held: Held, fragment: Fragment, opens: boolean, continued: string | undefined,
): Item[] {
  const starts = held.top >= fragment.top - 0.5 && held.top < fragment.bottom - 0.5;

  // A merged cell whose text was written on an earlier page is written again,
  // marked as a continuation. Excel and Word both do this, and a column of
  // blank cells at the top of a page says nothing about what they belong to.
  // Only at the top of the page: repeating it on every row would turn one
  // merged cell into a column of identical ones.
  if (opens && held.item.kind === 'text' && !starts && held.cell
    && held.cell.top < fragment.top - 0.5 && held.cell.bottom > fragment.top + 0.5) {
    // The suffix is dropped when the column is too narrow for it: a name that
    // runs into the next column says less than a name on its own.
    const room = held.cell.room;
    const needed = (held.item.width ?? 0) + (continued?.length ?? 0) * held.item.size;
    const text = continued !== undefined && needed <= room
      ? `${held.item.text}${continued}` : held.item.text;
    return [{ ...held.item, text, y: fragment.top + (held.item.y - held.cell.top) }];
  }

  if (held.item.kind !== 'fill') return starts ? [held.item] : [];

  const fill = held.item;
  const top = Math.max(fill.y, fragment.top);
  const bottom = Math.min(fill.y + fill.height, fragment.bottom);
  if (bottom - top <= 0.01) return [];
  if (starts && bottom >= fill.y + fill.height - 0.5) return [fill];
  return [{ ...fill, y: top, height: bottom - top }];
}

/** The same paper, turned. Margins stay as they are. */
function turned(setup: PageSetup): PageSetup {
  return { ...setup, width: setup.height, height: setup.width };
}

/**
 * One measuring pass. The document is laid out at the width this paper gives
 * it, and the blocks that belong on it are read.
 */
function pass(
  root: HTMLElement, setup: PageSetup, orientation: Orientation, diagnostics: string[],
): MeasuredBlock[] {
  const contentWidth = (setup.width - setup.margin.left - setup.margin.right) * PX_PER_PT;
  root.style.width = `${contentWidth}px`;
  root.style.maxWidth = 'none';
  root.style.margin = '0';
  root.style.padding = '0';

  const origin = root.getBoundingClientRect();
  const left = origin.left + window.scrollX;
  const top = origin.top + window.scrollY;

  const measured: MeasuredBlock[] = [];
  let index = 0;

  for (const section of [...root.children].filter(child => child instanceof HTMLElement)) {
    const boundary = section.classList.contains('dp-sheet');
    for (const [n, element] of blocksOf(section).entries()) {
      const at = index++;
      if (orientationOf(element) !== orientation) continue;
      const rect = boxOf(element, left, top);
      if (rect.height <= 0) continue;
      measured.push({
        index: at,
        orientation,
        forced: boundary && n === 0 && at > 0,
        items: collect(element, left, top, orientation === 'portrait' ? diagnostics : [])
          .map(({ item, top: y, cell }) => ({
            item, top: y, bottom: y + heightOf(item), ...(cell ? { cell } : {}),
          })),
        fragments: fragmentsOf(element, rect, at, left, top),
      });
    }
  }
  return measured;
}

/** `{page="landscape"}` on an import reaches the page as an attribute. */
function orientationOf(element: HTMLElement): Orientation {
  return element.getAttribute('data-page') === 'landscape'
    || element.querySelector('[data-page="landscape"]') !== null
    ? 'landscape' : 'portrait';
}

function heightOf(item: Item): number {
  switch (item.kind) {
    case 'fill':
    case 'picture': return item.height;
    case 'text': return item.size;
    default: return 0;
  }
}

/** The running foot: which page this is, and what document it belongs to. */
function foot(
  setup: PageSetup, page: number, total: number, options: MeasureOptions,
): TextItem {
  const text = options.foot ? `${options.foot}　${page} / ${total}` : `${page} / ${total}`;
  return {
    kind: 'text', text,
    x: setup.margin.left,
    y: setup.height - setup.margin.bottom + setup.footSize * 1.8,
    size: setup.footSize, bold: false, italic: false, mono: false,
    colour: setup.footColour,
  };
}

/** Pixels to points, once, at the end. */
function toPoints2(item: Item): Item {
  const s = (value: number): number => value / PX_PER_PT;
  switch (item.kind) {
    case 'text':
      return { ...item, x: s(item.x), y: s(item.y), size: s(item.size),
        ...(item.width === undefined ? {} : { width: s(item.width) }) };
    case 'fill':
      return { ...item, x: s(item.x), y: s(item.y), width: s(item.width), height: s(item.height) };
    case 'picture':
      return { ...item, x: s(item.x), y: s(item.y), width: s(item.width), height: s(item.height) };
    case 'shape':
      return { ...item, points: item.points.map(p => ({ x: s(p.x), y: s(p.y) })),
        ...(item.lineWidth === undefined ? {} : { lineWidth: s(item.lineWidth) }),
        ...(item.dash === undefined ? {} : { dash: item.dash.map(s) }) };
    case 'ellipse':
      return { ...item, cx: s(item.cx), cy: s(item.cy), rx: s(item.rx), ry: s(item.ry),
        ...(item.lineWidth === undefined ? {} : { lineWidth: s(item.lineWidth) }) };
    case 'path':
      return { ...item, d: mapPathData(item.d, (x, y) => ({ x: x / PX_PER_PT, y: y / PX_PER_PT }), 1 / PX_PER_PT),
        ...(item.lineWidth === undefined ? {} : { lineWidth: s(item.lineWidth) }) };
  }
}

function shift(item: Item, dx: number, dy: number): Item {
  switch (item.kind) {
    case 'text':
    case 'fill':
    case 'picture':
      return { ...item, x: item.x + dx, y: item.y + dy };
    case 'shape':
      return { ...item, points: item.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
    case 'ellipse':
      return { ...item, cx: item.cx + dx, cy: item.cy + dy };
    case 'path':
      return { ...item, d: mapPathData(item.d, (x, y) => ({ x: x + dx, y: y + dy }), 1) };
  }
}

interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

function boxOf(element: Element, left: number, top: number): Rect {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + window.scrollX - left,
    y: rect.top + window.scrollY - top,
    width: rect.width, height: rect.height,
  };
}

/** The blocks of one section: what a page break may fall between. */
function blocksOf(sheet: Element): readonly HTMLElement[] {
  if (!sheet.classList.contains('dp-sheet')) return [sheet as HTMLElement];
  return [...sheet.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
}

/**
 * Where a page may break inside one block. A table breaks between rows and
 * carries its header; prose breaks between lines; anything else is indivisible.
 */
function fragmentsOf(
  element: HTMLElement, rect: Rect, block: number, left: number, top: number,
): Fragment[] {
  const whole: Fragment = {
    top: rect.y, bottom: rect.y + rect.height, repeat: false,
    keepWithNext: /^H[1-6]$/.test(element.tagName), block,
  };

  const table = element.matches('table') ? element : element.querySelector('table');
  if (table && element.querySelectorAll('table').length === 1) {
    const rows: Fragment[] = [];
    for (const row of table.querySelectorAll('tr')) {
      const box = boxOf(row, left, top);
      if (box.height <= 0) continue;
      rows.push({
        top: box.y, bottom: box.y + box.height,
        repeat: row.closest('thead') !== null, keepWithNext: false, block,
      });
    }
    // The caption, and anything else around the table, rides with the rows.
    if (rows.length > 1) {
      const first = rows[0]!;
      const last = rows[rows.length - 1]!;
      return [
        { ...first, top: Math.min(first.top, rect.y) },
        ...rows.slice(1, -1),
        { ...last, bottom: Math.max(last.bottom, rect.y + rect.height) },
      ];
    }
  }

  if (element.classList.contains('dp-prose')) {
    const lines = lineBoxes(element, left, top);
    if (lines.length > 1) {
      // The pieces have to meet: a gap between two fragments would be space the
      // page loses, and an overlap would be space it counts twice.
      const edges = [rect.y, ...lines.slice(1).map(line => line.top), rect.y + rect.height];
      return edges.slice(0, -1).map((from, i) => ({
        top: from, bottom: edges[i + 1]!, repeat: false, keepWithNext: false, block,
      }));
    }
  }

  return [whole];
}

/** The line boxes of a block of prose, found by measuring its text. */
function lineBoxes(element: Element, left: number, top: number): { top: number; bottom: number }[] {
  const lines: { top: number; bottom: number }[] = [];
  for (const node of textNodes(element)) {
    const range = document.createRange();
    for (let i = 0; i < node.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rect = range.getBoundingClientRect();
      if (rect.height <= 0) continue;
      const y = rect.top + window.scrollY - top;
      const bottom = y + rect.height;
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.top - y) < 2) continue;
      lines.push({ top: y, bottom });
    }
  }
  void left;
  lines.sort((a, b) => a.top - b.top);
  return lines;
}

function* textNodes(element: Element): Generator<Text> {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text && node.data.trim() !== '') yield node;
  }
}
