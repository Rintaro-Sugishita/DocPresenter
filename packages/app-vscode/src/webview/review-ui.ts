// The editing and review modes, on the VS Code shell's screen.
//
// Editing is what the editor always was. Reading (review) is the same page with
// nothing offering to change the file: text is selected rather than opened,
// comments are marked where they are now, listed beside the page, and a new
// one is made on a selection. While editing, a comment is made on what is
// selected in the source box open, and in either mode on a shape of a drawing,
// from the menu on it.
//
// The comments are shown as bubbles that stay on the page — beside the words,
// or beside the shape — and can be switched off when they are in the way; in
// the editing mode that takes the marks off too. Both choices are remembered
// per editor, as VS Code keeps a WebView's state. None of it reaches a PDF or
// a slide.

import {
  EDITOR_MESSAGES, attachReviewCards, clearReviews, layoutBubbles, nodeAnchor, paintReviews, selectionAnchor,
  type PlacedNote, type ReviewNote, type SheetView,
} from '@docpresenter/editor';
import type { Locale, MenuItem } from '@docpresenter/base';
import { inWorkspace } from '../paths.js';
import { VSCODE_MESSAGES } from '../messages.js';
import type { FromView } from '../protocol.js';

export type Mode = 'edit' | 'view';

/** What a new comment is about: where, how exactly, and the words, to show on the form. */
type Found = NonNullable<ReturnType<typeof selectionAnchor>>;

interface Saved { mode?: Mode; marks?: boolean }

export interface ReviewUiOptions {
  readonly send: (message: FromView) => void;
  /** A workspace file as the screen holds it now, read as LF. */
  readonly read: (path: string) => string | undefined;
  readonly documentPath: () => string;
  readonly locale: () => Locale;
  readonly view: () => SheetView | undefined;
  readonly state: { get(): Saved | undefined; set(state: Saved): void };
}

export function createReviewUi(options: ReviewUiOptions) {
  const bar = document.querySelector<HTMLElement>('.dp-export');
  const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('.dp-modes button[data-mode]')];
  const marksLabel = document.querySelector<HTMLLabelElement>('.dp-marks');
  const marksBox = marksLabel?.querySelector<HTMLInputElement>('input') ?? null;
  const panel = document.querySelector<HTMLElement>('.dp-review-panel');
  const editor = document.getElementById('editor')!;
  const t = () => VSCODE_MESSAGES.in(options.locale());

  const saved = options.state.get() ?? {};
  let mode: Mode = saved.mode === 'view' ? 'view' : 'edit';
  let marks = saved.marks !== false;
  let notes: readonly ReviewNote[] = [];
  let placed: PlacedNote[] = [];
  let page: HTMLElement | undefined;

  // With the bubbles on, the comment is already on the page; the card under
  // the pointer is for when they are off.
  attachReviewCards(editor, () => (bubbles() ? [] : placed), options.locale());

  const remember = (): void => options.state.set({ mode, marks });
  const showing = (): boolean => !!bar && (mode === 'view' || marks);
  /** Whether the comments stay on the page as bubbles. The same switch as the marks. */
  const bubbles = (): boolean => !!bar && marks;

  /** Marks the notes on the page as it is drawn now, and lists them. */
  function paint(next?: HTMLElement): void {
    if (next) page = next;
    if (!page) return;
    placed = showing() ? paintReviews(page, notes, { documentPath: options.documentPath(), read: options.read, locale: options.locale() }) : [];
    if (!showing()) clearReviews(page);
    list();
    layout();
  }

  // The bubbles are placed from where things are on screen, so they are
  // placed again whenever that may have moved: a redraw, a zoom, another
  // sheet, a narrower window.
  let pending = false;
  function layout(): void {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (!page || !page.isConnected) return;
      const pane = page.parentElement;
      const shown = bubbles() ? placed.filter(one => one.shown) : [];
      pane?.classList.toggle('dp-with-bubbles', shown.length > 0);
      layoutBubbles(page, shown, { locale: options.locale(), onPick: key => pick(key) });
    });
  }
  const watcher = new ResizeObserver(() => layout());
  watcher.observe(editor);
  let watched: HTMLElement | undefined;
  const watchPage = (): void => {
    if (!page || watched === page) return;
    if (watched) watcher.unobserve(watched);
    watched = page;
    watcher.observe(page);
  };

  /** A bubble pressed: its entry in the list, in the review mode. */
  function pick(key: string): void {
    if (mode !== 'view' || !panel) return;
    const index = placed.findIndex(one => one.note.key === key);
    const entry = panel.querySelectorAll<HTMLElement>('.dp-review-entry')[index];
    entry?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    entry?.classList.remove('dp-review-flash');
    void entry?.getBoundingClientRect();
    entry?.classList.add('dp-review-flash');
  }

  /** The panel beside the page: every comment on the document, in review mode. */
  function list(): void {
    if (!panel) return;
    panel.hidden = mode !== 'view';
    if (panel.hidden) return;
    const heading = document.createElement('h2');
    heading.textContent = t()('vscode.review.panel', { count: notes.length });
    const items = placed.map(({ note, state, shown }) => {
      const item = document.createElement('div');
      item.className = 'dp-review-entry';
      item.dataset['state'] = state;
      const head = document.createElement('div');
      head.className = 'dp-review-head';
      head.textContent = [`#${note.id}`, note.author, statusLabel(note.status)].filter(Boolean).join('　');
      const body = document.createElement('div');
      body.textContent = note.body;
      item.append(head, body);
      const said = state === 'lost' ? t()('vscode.review.lost')
        : state === 'changed' ? t()('vscode.review.changed')
          : !shown ? t()('vscode.review.notShown') : undefined;
      if (said) {
        const warn = document.createElement('div');
        warn.className = 'dp-review-note';
        warn.textContent = said;
        item.append(warn);
      }
      item.append(controls(note));
      item.addEventListener('click', () => reveal(note.key));
      return item;
    });
    const empty = document.createElement('p');
    empty.textContent = t()('vscode.review.panelEmpty');
    panel.replaceChildren(heading, ...(items.length > 0 ? items : [empty]));
  }

  /**
   * The engineer's part of a comment: its state, and the answer. Both are
   * written into the review file by the host, as the lines they are.
   */
  function controls(note: ReviewNote): HTMLElement {
    const box = document.createElement('div');
    box.className = 'dp-review-controls';
    // The state and the answer are the panel's own; only the rest of the entry
    // leads to the mark. Stopped here, before a button replaced by what it
    // opens has left the page and can no longer say where it was.
    box.addEventListener('click', event => event.stopPropagation());
    const label = document.createElement('label');
    label.className = 'dp-review-status';
    label.append(`${t()('vscode.review.statusLabel')} `);
    const select = document.createElement('select');
    for (const status of ['open', 'resolved', 'wontfix', 'question'] as const) {
      const option = document.createElement('option');
      option.value = status;
      option.textContent = statusLabel(status);
      option.selected = note.status === status;
      select.append(option);
    }
    if (!['open', 'resolved', 'wontfix', 'question'].includes(note.status)) {
      const option = document.createElement('option');
      option.value = note.status;
      option.textContent = statusLabel(note.status);
      option.selected = true;
      select.prepend(option);
    }
    select.addEventListener('change', () => {
      options.send({ kind: 'review-update', round: note.round, id: note.id, status: select.value });
    });
    label.append(select);

    const answer = document.createElement('div');
    answer.className = 'dp-review-answer';
    const show = (): void => {
      answer.replaceChildren();
      if (note.reply) {
        const text = document.createElement('div');
        text.className = 'dp-review-reply';
        text.textContent = note.reply;
        answer.append(text);
      }
      const write = document.createElement('button');
      write.type = 'button';
      write.textContent = t()(note.reply ? 'vscode.review.editReply' : 'vscode.review.writeReply');
      write.addEventListener('click', edit);
      answer.append(write);
    };
    const edit = (): void => {
      const area = document.createElement('textarea');
      area.value = note.reply ?? '';
      area.placeholder = t()('vscode.review.replyLabel');
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'dp-review-save';
      save.textContent = t()('vscode.review.save');
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = t()('vscode.review.cancel');
      save.addEventListener('click', () => {
        options.send({ kind: 'review-update', round: note.round, id: note.id, reply: area.value });
      });
      cancel.addEventListener('click', show);
      area.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); show(); } });
      const buttons = document.createElement('div');
      buttons.className = 'dp-review-buttons';
      buttons.append(cancel, save);
      answer.replaceChildren(area, buttons);
      area.focus();
    };
    show();
    box.append(label, answer);
    return box;
  }

  /** Brings a comment's mark into view, switching to the sheet it is on. */
  function reveal(key: string): void {
    if (!page) return;
    const find = (): HTMLElement | null => page!.querySelector<HTMLElement>(`[data-review~="${CSS.escape(key)}"]`);
    let mark = find();
    if (!mark) return;
    const sheet = mark.closest<HTMLElement>('.dp-sheet');
    const index = Number(sheet?.dataset['sheet']);
    if (sheet?.hidden && index > 0) { options.view()?.select(index); mark = find(); }
    mark?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    mark?.classList.remove('dp-review-flash');
    void mark?.getBoundingClientRect();
    mark?.classList.add('dp-review-flash');
  }

  /** A status in the screen's language; one the review model does not name, as written. */
  function statusLabel(status: string): string {
    const known = ['open', 'resolved', 'wontfix', 'question', 'orphaned'] as const;
    const key = known.find(one => one === status);
    return key ? EDITOR_MESSAGES.in(options.locale())(`editor.review.status.${key}`) : status;
  }

  function setMode(next: Mode): void {
    mode = next;
    for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset['mode'] === mode));
    options.view()?.setReadOnly(mode === 'view');
    closeAdd();
    remember();
    paint();
  }

  for (const button of modeButtons) button.addEventListener('click', () => setMode(button.dataset['mode'] as Mode));
  marksBox?.addEventListener('change', () => { marks = marksBox.checked; remember(); paint(); });
  if (marksBox) marksBox.checked = marks;

  // --- a new comment, on a selection ------------------------------------------

  let addButton: HTMLButtonElement | undefined;
  let form: HTMLFormElement | undefined;
  function closeAdd(): void { addButton?.remove(); addButton = undefined; form?.remove(); form = undefined; }

  /** The button that offers a comment on what was found, beside where it is. */
  function offer(found: Found, rect: DOMRect): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dp-review-add';
    button.textContent = t()(mode === 'edit' ? 'vscode.review.addComment' : 'vscode.review.addButton');
    button.style.left = `${Math.max(4, Math.min(rect.right, window.innerWidth - 120))}px`;
    button.style.top = `${Math.max(4, rect.top - 32)}px`;
    // Pressing it must not take the selection away from what it is about.
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => openForm(found, rect));
    document.body.append(button);
    addButton = button;
  }

  /**
   * While editing, the page is not selected but opened: a block is its source
   * in a box. What is selected there is a range of the file already, as long
   * as the box still says what the file says.
   */
  function sourceFound(): Found | undefined {
    const at = options.view()?.sourceSelection();
    if (!at) return undefined;
    const file = at.path === undefined ? options.documentPath() : inWorkspace(options.documentPath(), at.path);
    return {
      anchor: { file, start: at.start, end: at.end, quote: at.text },
      precision: 'text',
      marked: at.text,
    };
  }

  const settle = (event: Event): void => {
    if (form) return;
    if (event instanceof KeyboardEvent && !event.shiftKey && !event.key.startsWith('Arrow') && event.key !== 'Shift') {
      // Typing: the button would only be in the way.
      addButton?.remove();
      addButton = undefined;
      return;
    }
    // After the browser has settled the selection.
    setTimeout(() => {
      addButton?.remove();
      addButton = undefined;
      if (mode === 'view') {
        const selection = window.getSelection();
        const found = selectionAnchor(selection, options.documentPath(), options.read);
        if (found && selection) offer(found, selection.getRangeAt(0).getBoundingClientRect());
        return;
      }
      const box = (event.target as Element | null)?.closest?.('textarea.dp-block-source');
      const found = box ? sourceFound() : undefined;
      if (box && found) offer(found, box.getBoundingClientRect());
    }, 0);
  };
  editor.addEventListener('mouseup', settle);
  editor.addEventListener('keyup', settle);

  /** The line on the menu of a drawing's shape that makes a comment on it. */
  function figureMenu(target: Element): readonly MenuItem[] {
    if (!bar || form) return [];
    const found = nodeAnchor(target, options.documentPath(), options.read);
    if (!found) return [];
    const rect = (target.closest('[data-node]') ?? target).getBoundingClientRect();
    return [{
      label: t()(mode === 'edit' ? 'vscode.review.addOnShape' : 'vscode.review.reviewOnShape'),
      run: () => openForm(found, rect),
    }];
  }

  function openForm(found: Found, at: DOMRect): void {
    addButton?.remove();
    addButton = undefined;
    const box = document.createElement('form');
    box.className = 'dp-review-form';
    const on = document.createElement('div');
    on.className = 'dp-review-on';
    on.textContent = t()('vscode.review.on', { words: found.marked.replace(/\s+/g, ' ').slice(0, 60) });
    const area = document.createElement('textarea');
    // Made while editing, it is the author's own note: shown on the screen and
    // never put in a PDF. Made while reading, it is a review finding, which is.
    const asComment = mode === 'edit';
    area.placeholder = t()(asComment ? 'vscode.review.commentPlaceholder' : 'vscode.review.placeholder');
    const buttons = document.createElement('div');
    buttons.className = 'dp-review-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = t()('vscode.review.cancel');
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.textContent = t()('vscode.review.submit');
    buttons.append(cancel, ok);
    box.append(on, area, buttons);
    box.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - 330))}px`;
    box.style.top = `${Math.min(at.bottom + 8, window.innerHeight - 180)}px`;
    cancel.addEventListener('click', closeAdd);
    box.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeAdd(); } });
    box.addEventListener('submit', event => {
      event.preventDefault();
      const body = area.value.trim();
      if (body === '') { area.focus(); return; }
      options.send({
        kind: 'review-add', anchor: found.anchor, precision: found.precision, body,
        ...(asComment ? { type: 'comment' as const } : {}),
      });
      closeAdd();
      window.getSelection()?.removeAllRanges();
    });
    document.body.append(box);
    form = box;
    area.focus();
  }

  return {
    get mode() { return mode; },
    /** The comments on this document, as the host sends them. */
    setNotes(next: readonly ReviewNote[]): void { notes = next; paint(); },
    /** Called after every redraw of the page. */
    paint(next?: HTMLElement): void { paint(next); watchPage(); },
    /** Places the bubbles again, after something on the page moved. */
    layout,
    /** The lines a drawing's menu gets, for the shape pressed. */
    figureMenu,
    /** Applies the remembered mode to a newly mounted view. */
    apply(): void { setMode(mode); },
  };
}
