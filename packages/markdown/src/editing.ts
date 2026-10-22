// Help while writing Markdown by hand: lists that carry on, list items that
// move in and out, and what to offer after `@` and inside `@import "…"`.
//
// Two places write a document as text — the text box a block opens into on
// the page, and VS Code's own editor — and they should behave alike, so what
// they do is decided here, on strings, and each only applies the change.
// Offsets are string indices (UTF-16), as both a text box and VS Code count.

import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';
import { expandDocument, type DocumentReader } from './document/expand.js';
import { parseDocument } from './document/parse.js';
import { resolveDocument } from './numbering/resolve.js';
import type { ElementKind } from './numbering/model.js';

/** Replace `start`–`end` with `text`, then select `select`. */
export interface TextChange {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly select: { readonly start: number; readonly end: number };
}

/** `  - [ ] text`: indent, marker, the space after it, a task box, the rest. */
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?(.*)$/;

/** A list item's pieces, a missing task box as empty. */
function partsOf(item: RegExpExecArray): { indent: string; marker: string; space: string; task: string; rest: string } {
  return { indent: item[1]!, marker: item[2]!, space: item[3]!, task: item[4] ?? '', rest: item[5] ?? '' };
}

interface Line { readonly start: number; readonly end: number; readonly text: string }

/** The line `at` is on, without its line break (a CR before the LF is not part of it). */
function lineAt(text: string, at: number): Line {
  const start = text.lastIndexOf('\n', at - 1) + 1;
  let end = text.indexOf('\n', at);
  if (end < 0) end = text.length;
  if (end > start && text[end - 1] === '\r') end -= 1;
  return { start, end, text: text.slice(start, end) };
}

/** Every line, without its line break. */
function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (;;) {
    const line = lineAt(text, start);
    lines.push(line);
    const next = text.indexOf('\n', line.end);
    if (next < 0) return lines;
    start = next + 1;
  }
}

/** Whether `at` is inside a fenced code block, where nothing here applies. */
function inFence(text: string, at: number): boolean {
  let open: string | undefined;
  for (const line of text.slice(0, lineAt(text, at).start).split('\n')) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === undefined) continue;
    if (open === undefined) open = fence;
    else if (fence[0] === open[0] && fence.length >= open.length) open = undefined;
  }
  return open !== undefined;
}

/** The marker the next item takes: the same bullet, or the next number. */
function nextMarker(marker: string): string {
  const number = /^(\d+)([.)])$/.exec(marker);
  return number ? `${Number(number[1]) + 1}${number[2]}` : marker;
}

/**
 * Enter on a list item. The text after the cursor becomes the next item, with
 * the same indent and bullet, the next number, and an empty task box when the
 * item had one. Enter on an item with nothing in it ends the list: the marker
 * goes, and the line is left empty. Undefined when the line is not a list
 * item, or the cursor is still in its marker — then Enter is just a line break.
 */
export function enterInList(text: string, start: number, end: number, eol = '\n'): TextChange | undefined {
  if (start !== end && lineAt(text, start).start !== lineAt(text, end).start) return undefined;
  if (inFence(text, start)) return undefined;
  const line = lineAt(text, start);
  const item = ITEM.exec(line.text);
  if (!item) return undefined;
  const { indent, marker, space, task, rest } = partsOf(item);
  const contentAt = line.start + indent.length + marker.length + space.length + task.length;
  if (start < contentAt) return undefined;

  if (rest.trim() === '' && end >= line.end) {
    // An empty item: the list is over.
    return { start: line.start, end: line.end, text: '', select: { start: line.start, end: line.start } };
  }
  const next = `${eol}${indent}${nextMarker(marker)}${space}${task ? '[ ] ' : ''}`;
  const at = start + next.length;
  return { start, end, text: next, select: { start: at, end: at } };
}

/**
 * Tab (or Shift+Tab) on list items: every item the selection touches moves one
 * level in (or out). One level in is where the item above's text starts, so
 * the item becomes its child whatever its marker is; one level out is where
 * its parent's marker is. A numbered item moved in starts its own list at 1.
 * Undefined when the selection is not all list items — then Tab is Tab.
 */
export function indentListItems(text: string, start: number, end: number, outdent: boolean): TextChange | undefined {
  if (inFence(text, start)) return undefined;
  const all = linesOf(text);
  // A selection that ends at the very start of a line does not take that line in.
  const last = end > start && (text[end - 1] === '\n') ? end - 1 : end;
  const firstIndex = all.findIndex(line => start <= line.end);
  const lastIndex = all.findIndex(line => last <= line.end);
  const lines = all.slice(firstIndex, lastIndex + 1);
  if (lines.length === 0 || lines.some(line => !ITEM.test(line.text))) return undefined;

  /** The lines above, nearest first, up to a blank line: the list the item is in. */
  const above = (index: number): Line[] => {
    const found: Line[] = [];
    for (let i = index - 1; i >= 0 && all[i]!.text.trim() !== ''; i--) found.push(all[i]!);
    return found;
  };
  const widthOf = (indent: string) => indent.replace(/\t/g, '    ').length;

  let changed = false;
  const out = lines.map((line, n) => {
    const { indent, marker, space, task, rest } = partsOf(ITEM.exec(line.text)!);
    const here = widthOf(indent);
    const items = above(firstIndex + n).map(one => ITEM.exec(one.text)).filter((one): one is RegExpExecArray => one !== null);
    let to: number | undefined;
    let renumber: string | undefined;
    if (!outdent) {
      // Under the nearest item above at this level or shallower: where its text starts.
      const parent = items.find(one => widthOf(one[1]!) <= here);
      if (parent) to = widthOf(parent[1]!) + parent[2]!.length + parent[3]!.length;
      if (to !== undefined && to <= here) to = undefined;
      if (/^\d/.test(marker)) renumber = `1${marker.slice(-1)}`;
    } else if (here > 0) {
      const parent = items.find(one => widthOf(one[1]!) < here);
      to = parent ? widthOf(parent[1]!) : 0;
      if (/^\d/.test(marker)) {
        const sibling = items.find(one => widthOf(one[1]!) === to && /^\d/.test(one[2]!));
        renumber = `${sibling ? Number(/^\d+/.exec(sibling[2]!)![0]) + 1 : 1}${marker.slice(-1)}`;
      }
    }
    if (to === undefined) return line.text;
    changed = true;
    return `${' '.repeat(to)}${renumber ?? marker}${space}${task}${rest}`;
  });
  if (!changed) return undefined;

  const from = lines[0]!.start;
  const to = lines[lines.length - 1]!.end;
  const eol = text.slice(lines[0]!.end, lines[0]!.end + 2).startsWith('\r\n') ? '\r\n' : '\n';
  const written = out.join(eol);
  // Keep the cursor on the same character of its line.
  const shift = (at: number): number => {
    const index = lines.findIndex(line => at >= line.start && at <= line.end);
    if (index < 0) return at;
    const before = out.slice(0, index).reduce((sum, one) => sum + one.length + eol.length, 0);
    const moved = out[index]!.length - lines[index]!.text.length;
    return from + before + Math.max(0, at - lines[index]!.start + moved);
  };
  return { start: from, end: to, text: written, select: { start: shift(start), end: shift(end) } };
}

/** What is being typed at the cursor, when there is something to offer for it. */
export type CompletionContext =
  /** After `@`: a label. `from` is where the label starts (after the `@`). */
  | { readonly kind: 'reference'; readonly from: number; readonly typed: string; readonly lineStart: boolean }
  /** Inside the quotes of `@import "…"`: a path. `from` is just after the opening quote. */
  | { readonly kind: 'import'; readonly from: number; readonly typed: string };

export function completionContext(text: string, at: number): CompletionContext | undefined {
  if (inFence(text, at)) return undefined;
  const line = lineAt(text, at);
  const before = text.slice(line.start, at);
  const path = /^[ \t]*@import[ \t]+"([^"]*)$/.exec(before);
  if (path) return { kind: 'import', from: at - path[1]!.length, typed: path[1]! };
  // Not inside a code span: an odd number of backticks before the cursor.
  if (((before.match(/`/g) ?? []).length % 2) === 1) return undefined;
  const reference = /(^|[^\w@.])@([A-Za-z0-9_-]*)$/.exec(before);
  if (!reference) return undefined;
  return {
    kind: 'reference', from: at - reference[2]!.length, typed: reference[2]!,
    lineStart: before.trim() === `@${reference[2]}`,
  };
}

/** A label that can be referred to, with what it is. */
export interface LabelCandidate {
  readonly label: string;
  readonly kind: ElementKind;
  /** `3` or `2.1`, as the reference would read; undefined when unnumbered. */
  readonly number: string | undefined;
  readonly caption: string | undefined;
}

/**
 * Every label the document can refer to, its included documents' among them,
 * numbered as the build numbers them. `read` reads a file by the path the
 * document writes for it.
 */
export function labelCandidates(source: string, read: DocumentReader, locale: Locale = DEFAULT_LOCALE): LabelCandidate[] {
  let document;
  try {
    // The document is placed in its own folder, so the paths it writes are the
    // paths `read` takes.
    document = expandDocument(parseDocument(source), 'document.md', read, locale).document;
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const found: LabelCandidate[] = [];
  for (const element of resolveDocument(document, locale).elements) {
    if (element.label === undefined || seen.has(element.label)) continue;
    seen.add(element.label);
    found.push({ label: element.label, kind: element.kind, number: element.number, caption: element.caption });
  }
  return found;
}

/** The files `@import` can take in: drawings, tables, Mermaid, documents and pictures. */
export const IMPORTABLE = /\.(dgm|table|mmd|mermaid|ermlx|md|png|jpe?g|gif|webp|svg)$/i;
