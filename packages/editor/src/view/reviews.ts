// Review comments, on the page.
//
// A comment is anchored to a file, a byte range and the text it held
// (design/review-model.md §3). This finds where that is now (§3.2), marks it
// on the rendered page — the words themselves where they can be found, the
// paragraph or the figure otherwise — and shows the comment when the pointer
// is over the mark. It also turns a selection on the page into an anchor, for
// a new comment.
//
// It only reads the page. Whoever shows it decides when: always in the review
// mode, and in the editing mode only while the marks are switched on.

import {
  DEFAULT_LOCALE, importedPathOf, locateAnchor, narrowAnchor, sliceBytes,
  type Anchor, type AnchorState, type Locale, type Precision,
} from '@docpresenter/base';
import { EDITOR_MESSAGES } from '../messages.js';

export interface ReviewNote {
  /** Unique on the page: the review file and the comment's id. */
  readonly key: string;
  readonly round: string;
  readonly id: number;
  readonly file?: string | undefined;
  readonly start?: number | undefined;
  readonly end?: number | undefined;
  readonly quote?: string | undefined;
  /** The file at the commit the comment was made on, to follow it exactly. */
  readonly before?: string | undefined;
  readonly body: string;
  readonly status: string;
  readonly reply?: string | undefined;
  readonly author?: string | undefined;
  readonly date?: string | undefined;
  readonly replies: readonly { readonly body: string; readonly author?: string | undefined }[];
}

/** Where a note was found on this page, for the list beside it. */
export interface PlacedNote {
  readonly note: ReviewNote;
  readonly state: AnchorState;
  /** Whether anything on the page carries its mark. */
  readonly shown: boolean;
}

export interface PaintOptions {
  /** The document on screen, as a workspace path. */
  readonly documentPath: string;
  /** A file of the workspace as it is now, read as LF. */
  readonly read: (path: string) => string | undefined;
  readonly locale?: Locale | undefined;
}

/** Characters the page does not print. */
const UNPRINTED = /[\s*_`~]/u;

/**
 * Marks every note on the page and returns where each one was found. Marks
 * from an earlier call are taken off first, so this can run after every redraw.
 */
export function paintReviews(page: HTMLElement, notes: readonly ReviewNote[], options: PaintOptions): PlacedNote[] {
  clearReviews(page);
  return notes.map(note => {
    if (!note.file || note.start === undefined || note.end === undefined || note.quote === undefined) {
      return { note, state: 'lost' as const, shown: false };
    }
    const current = options.read(note.file);
    if (current === undefined) return { note, state: 'lost' as const, shown: false };
    const at = locateAnchor({ start: note.start, end: note.end, quote: note.quote }, current, note.before);
    if (at.state === 'lost') return { note, state: at.state, shown: false };
    const words = sliceBytes(current, at.start, at.end);
    const shown = note.file === options.documentPath
      ? markInDocument(page, note, at, words, at.state)
      : markInFigures(page, note, words, at.state, options.documentPath);
    return { note, state: at.state, shown };
  });
}

/** Takes every mark off the page, leaving its text as it was. */
export function clearReviews(page: HTMLElement): void {
  for (const mark of page.querySelectorAll<HTMLElement>('mark.dp-review-mark')) {
    mark.replaceWith(...mark.childNodes);
  }
  page.normalize();
  for (const node of page.querySelectorAll<Element>('[data-review]')) {
    node.removeAttribute('data-review');
    node.removeAttribute('data-review-state');
    node.classList.remove('dp-review-block', 'dp-review-svg');
  }
}

/** A comment on the document's own text: its words in the block that holds them. */
function markInDocument(
  page: HTMLElement, note: ReviewNote, at: { start: number; end: number }, words: string, state: AnchorState,
): boolean {
  let best: HTMLElement | undefined;
  for (const node of page.querySelectorAll<HTMLElement>('[data-span]')) {
    if (node.closest('[data-doc]') || node.classList.contains('dp-sheet')) continue;
    const [start, end] = (node.dataset['span'] ?? '').split(',').map(Number);
    if (start === undefined || end === undefined || at.start < start || at.end > end) continue;
    // The innermost: a reference inside a paragraph is its own range.
    if (!best || (best.contains(node) && node !== best)) best = node;
  }
  if (!best) return false;
  if (best.classList.contains('dp-figure') || !wrapWords(best, words, note.key, state)) tag(best, note.key, state);
  return true;
}

/** A comment on a drawing or a table: the figures that show that file. */
function markInFigures(
  page: HTMLElement, note: ReviewNote, words: string, state: AnchorState, documentPath: string,
): boolean {
  let shown = false;
  for (const figure of page.querySelectorAll<HTMLElement>('.dp-figure[data-path]')) {
    const path = importedPathOf(documentPath, `@import "${figure.dataset['path']}"`);
    if (path !== note.file) continue;
    shown = true;
    if (!wrapWords(figure, words, note.key, state)) tag(figure, note.key, state);
  }
  return shown;
}

function tag(node: Element, key: string, state: AnchorState): void {
  const keys = new Set((node.getAttribute('data-review') ?? '').split(' ').filter(Boolean));
  keys.add(key);
  node.setAttribute('data-review', [...keys].join(' '));
  node.setAttribute('data-review-state', state);
  node.classList.add(node instanceof SVGElement ? 'dp-review-svg' : 'dp-review-block');
}

/**
 * Wraps the printed form of `words` inside `root` in marks. The page does not
 * print what the source has around the words (`**`, line breaks), so the
 * search skips those on both sides. In a drawing, where a mark element cannot
 * go, the text element itself is tagged.
 */
function wrapWords(root: HTMLElement, words: string, key: string, state: AnchorState): boolean {
  const wanted = [...words].filter(character => !UNPRINTED.test(character)).join('');
  if (wanted === '') return false;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const pieces: { node: Text; offset: number }[] = [];
  let text = '';
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (node.parentElement?.closest('.dp-review-card, .dp-figure-tools, .dp-code-head, .dp-mermaid-switch')) continue;
    const value = node.data;
    for (let i = 0; i < value.length; i += 1) {
      if (UNPRINTED.test(value[i]!)) continue;
      pieces.push({ node, offset: i });
      text += value[i];
    }
  }
  const index = text.indexOf(wanted);
  if (index < 0) return false;
  const covered = pieces.slice(index, index + wanted.length);
  // One mark per text node the words run through.
  const byNode = new Map<Text, { from: number; to: number }>();
  for (const { node, offset } of covered) {
    const span = byNode.get(node);
    if (span) span.to = offset + 1; else byNode.set(node, { from: offset, to: offset + 1 });
  }
  for (const [node, { from, to }] of byNode) {
    if (node.parentElement instanceof SVGElement || node.parentElement?.closest('svg')) {
      tag(node.parentElement!.closest('text') ?? node.parentElement!, key, state);
      continue;
    }
    const range = root.ownerDocument.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    const mark = root.ownerDocument.createElement('mark');
    mark.className = 'dp-review-mark';
    mark.setAttribute('data-review', key);
    mark.setAttribute('data-review-state', state);
    range.surroundContents(mark);
  }
  return true;
}

/**
 * The card a comment is shown in, under the pointer. One per page, filled in
 * for whatever mark the pointer is over; several comments on the same words
 * are shown together.
 */
export function attachReviewCards(
  pane: HTMLElement, notes: () => readonly PlacedNote[], locale: Locale = DEFAULT_LOCALE,
): () => void {
  const t = EDITOR_MESSAGES.in(locale);
  const owner = pane.ownerDocument;
  const card = owner.createElement('div');
  card.className = 'dp-review-card';
  card.hidden = true;
  owner.body.append(card);

  const show = (target: Element, x: number, y: number): void => {
    const keys = (target.getAttribute('data-review') ?? '').split(' ');
    const placed = notes().filter(one => keys.includes(one.note.key));
    if (placed.length === 0) { card.hidden = true; return; }
    card.replaceChildren(...placed.map(({ note, state }) => {
      const item = owner.createElement('div');
      item.className = 'dp-review-item';
      const head = owner.createElement('div');
      head.className = 'dp-review-head';
      head.textContent = [`#${note.id}`, note.author, t(`editor.review.status.${statusKey(note.status)}`)]
        .filter(Boolean).join('　');
      const body = owner.createElement('div');
      body.className = 'dp-review-body';
      body.textContent = note.body || t('editor.review.noBody');
      item.append(head, body);
      if (state === 'changed') {
        const warn = owner.createElement('div');
        warn.className = 'dp-review-changed';
        warn.textContent = t('editor.review.changed');
        item.append(warn);
      }
      for (const answer of [...(note.reply ? [{ body: note.reply, author: undefined }] : []), ...note.replies]) {
        const reply = owner.createElement('div');
        reply.className = 'dp-review-reply';
        reply.textContent = `${answer.author ? `${answer.author}: ` : ''}${answer.body}`;
        item.append(reply);
      }
      return item;
    }));
    card.hidden = false;
    const view = owner.defaultView!;
    const width = Math.min(360, view.innerWidth - 24);
    card.style.left = `${Math.max(8, Math.min(x + 12, view.innerWidth - width - 8))}px`;
    card.style.top = `${Math.min(y + 16, view.innerHeight - card.offsetHeight - 8)}px`;
  };

  const onMove = (event: MouseEvent): void => {
    const target = (event.target as Element | null)?.closest?.('[data-review]');
    if (target && pane.contains(target)) show(target, event.clientX, event.clientY);
    else card.hidden = true;
  };
  pane.addEventListener('mousemove', onMove);
  pane.addEventListener('mouseleave', () => { card.hidden = true; });
  return () => { pane.removeEventListener('mousemove', onMove); card.remove(); };
}

/** The statuses the review model names; anything else reads as open. */
function statusKey(status: string): 'open' | 'resolved' | 'wontfix' | 'question' | 'orphaned' {
  return (['open', 'resolved', 'wontfix', 'question', 'orphaned'] as const).find(one => one === status) ?? 'open';
}

/**
 * The anchor for what is selected on the page: the block the selection starts
 * in, narrowed to the words selected. Undefined when nothing the document
 * wrote is selected.
 */
export function selectionAnchor(
  selection: Selection | null, documentPath: string, read: (path: string) => string | undefined,
): { anchor: Anchor; precision: Precision; marked: string } | undefined {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const marked = selection.toString();
  if (marked.trim() === '') return undefined;
  const start = selection.getRangeAt(0).startContainer;
  const element = start instanceof Element ? start : start.parentElement;
  // The innermost block with a range of its own; a figure is its import line.
  const block = element?.closest<HTMLElement>('[data-span]:not(.dp-sheet)');
  if (!block || block.closest('[data-doc]')) return undefined;
  const [from, to] = (block.dataset['span'] ?? '').split(',').map(Number);
  if (from === undefined || to === undefined || Number.isNaN(from)) return undefined;
  const { anchor, precision } = narrowAnchor({ file: documentPath, start: from, end: to }, marked, read);
  return { anchor, precision, marked };
}
