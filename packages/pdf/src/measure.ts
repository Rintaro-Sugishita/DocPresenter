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
 * row of a table, a whole figure. Ranges are in document pixels.
 */
interface Fragment {
  readonly top: number;
  readonly bottom: number;
  /** Repeated at the top of every page the block continues onto. */
  readonly repeat: boolean;
  /** Kept with the fragment after it: a heading alone at the foot reads badly. */
  readonly keepWithNext: boolean;
  /** Fragments of the same block, so a table's header follows its rows. */
  readonly block: number;
}

export function measure(root: HTMLElement, options: MeasureOptions = {}): Measurement {
  const setup = readPageSetup(document.documentElement);
  const diagnostics: string[] = [];

  const contentWidth = (setup.width - setup.margin.left - setup.margin.right) * PX_PER_PT;
  const contentHeight = (setup.height - setup.margin.top - setup.margin.bottom) * PX_PER_PT;

  // Lay the document out at exactly the measure it will be printed at.
  root.style.width = `${contentWidth}px`;
  root.style.maxWidth = 'none';
  root.style.margin = '0';
  root.style.padding = '0';

  const origin = root.getBoundingClientRect();
  const left = origin.left + window.scrollX;
  const top = origin.top + window.scrollY;

  const items: { item: Item; y: number }[] = [];
  const fragments: Fragment[] = [];
  let block = 0;
  /** Where a page break is required whatever the space left. */
  const forced = new Set<number>();

  // Everything the page holds, not only the sheets: a cover comes before them
  // and a build may put a legend after them, and a part of the document that is
  // skipped here is a part that is missing from the PDF.
  for (const sheet of [...root.children].filter(child => child instanceof HTMLElement)) {
    if (sheet.classList.contains('dp-sheet') && block > 0) forced.add(block);
    for (const element of blocksOf(sheet)) {
      const rect = boxOf(element, left, top);
      if (rect.height <= 0) continue;
      const collected = collect(element, left, top, diagnostics);
      items.push(...collected.map(({ item, top: y }) => ({ item, y })));
      fragments.push(...fragmentsOf(element, rect, block, left, top));
      block++;
    }
  }

  // Pack the fragments into pages, repeating what has to be repeated.
  const pages: { fragments: Fragment[]; offsets: number[] }[] = [];
  let current: Fragment[] = [];
  let offsets: number[] = [];
  let cursor = 0;
  const repeats = new Map<number, Fragment[]>();

  const flush = (): void => {
    if (current.length === 0) return;
    pages.push({ fragments: current, offsets });
    current = [];
    offsets = [];
    cursor = 0;
  };

  for (let i = 0; i < fragments.length; i++) {
    const fragment = fragments[i]!;
    const height = fragment.bottom - fragment.top;
    if (fragment.repeat) {
      const held = repeats.get(fragment.block) ?? [];
      held.push(fragment);
      repeats.set(fragment.block, held);
    }

    const startsBlock = i === 0 || fragments[i - 1]!.block !== fragment.block;
    if (startsBlock && forced.has(fragment.block) && cursor > 0) flush();

    // A heading is kept with what follows it, so it never ends a page alone.
    const withNext = fragment.keepWithNext && i + 1 < fragments.length
      ? fragments[i + 1]!.bottom - fragments[i + 1]!.top : 0;

    if (cursor > 0 && cursor + height + withNext > contentHeight) {
      flush();
      // A table that continues brings its header rows with it.
      for (const header of repeats.get(fragment.block) ?? []) {
        if (header === fragment) continue;
        current.push(header);
        offsets.push(cursor - header.top);
        cursor += header.bottom - header.top;
      }
    }
    if (height > contentHeight) {
      diagnostics.push(`1 ページに収まらない要素がある（高さ ${Math.round(height)}px）`);
    }
    current.push(fragment);
    offsets.push(cursor - fragment.top);
    cursor += height;
  }
  flush();

  // Place every mark on the page its fragment landed on.
  const built: Page[] = pages.map((page, index) => {
    const placed: Item[] = [];
    for (const { item, y } of items) {
      const at = page.fragments.findIndex(
        (fragment, n) => y >= fragment.top - 0.5 && y < fragment.bottom - 0.5
          && !(fragment.repeat && page.fragments.indexOf(fragment) !== n),
      );
      if (at < 0) continue;
      placed.push(shift(item, setup.margin.left * PX_PER_PT, page.offsets[at]! + setup.margin.top * PX_PER_PT));
    }
    return { items: [...placed.map(toPoints2), foot(setup, index + 1, pages.length, options)] };
  });

  return {
    plan: {
      width: setup.width, height: setup.height, pages: built,
      ...(options.title === undefined ? {} : { title: options.title }),
      ...(options.commit === undefined ? {} : { commit: options.commit }),
    },
    diagnostics,
  };
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
