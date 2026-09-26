// The sheet view: one sheet on screen at a time, with tabs along the bottom.
//
// The view owns no model of its own. It holds the source text, asks the caller
// to render it, and turns every gesture into one of the sheet operations —
// which are byte-range edits. That means what the screen shows and what the
// file contains can never drift apart: there is only the file.

import {
  byteLength, parseDocument, parseTable, sheetsOf, sliceBytes, type Sheet,
} from '@docpresenter/core';
import type { Edit } from '../edit.js';
import { applyEdit } from '../edit.js';
import { toggleInline, type InlineMark } from '../inline.js';
import { DEFAULT_SETTINGS, isCommit, type EditorSettings } from '../settings.js';
import { insertSheet, moveSheet, removeSheet, renameSheet, SheetEditError } from '../sheets.js';
import { TableEditError } from '../table.js';
import { createGrid, type Grid, type GridPosition } from './grid.js';
import { EDITOR_STYLE } from './style.js';
import { createToolbar } from './toolbar.js';

export interface SheetViewOptions {
  readonly root: HTMLElement;
  readonly source: string;
  /** Renders a document to HTML made of `<section class="dp-sheet">`. */
  readonly render: (source: string) => string;
  /**
   * Reads a referenced file so its source can be opened. Without it a diagram
   * or a table can be looked at but not edited.
   */
  readonly readResource?: (path: string) => string | undefined;
  /**
   * Called after every edit with the full new text of whatever was edited —
   * the document when `edit.path` is absent, that referenced file otherwise.
   * The host must store it before returning: the view redraws straight after,
   * and reads referenced files back through `render`.
   */
  readonly onChange?: (edit: Edit, text: string) => void;
  /** Called when an operation is refused, so the app can say why. */
  readonly onError?: (message: string) => void;
  /** Key bindings and the like. See settings.ts for why this is a value. */
  readonly settings?: EditorSettings;
}

export interface SheetView {
  readonly source: string;
  readonly active: number;
  select(index: number): void;
  /** Applies changed settings without losing the place. */
  configure(settings: EditorSettings): void;
  destroy(): void;
}

export function mountSheetView(options: SheetViewOptions): SheetView {
  const { root, render } = options;
  let source = options.source;
  let active = 1;
  let continuous = false;
  let dragging: number | undefined;
  let sections: HTMLElement[] = [];
  let tabs: HTMLElement[] = [];
  let editing: BlockEdit | undefined;
  /** The table whose grid is open, and where the selection sits in it. */
  let grid: { path: string; at: GridPosition } | undefined;
  let mounted: Grid | undefined;
  let settings = options.settings ?? DEFAULT_SETTINGS;

  const owner = root.ownerDocument;
  injectStyle(owner);
  root.classList.add('dp-editor');
  const pane = element('div', 'dp-editor-pane');
  // The listener lives on the pane, which survives a redraw; the page inside
  // it does not. Routing is on mousedown so that the open editor is closed
  // before the click is resolved — closing one can redraw the page, and a
  // click resolved beforehand would land on a node that no longer exists.
  pane.addEventListener('mousedown', onPointerDown);
  const tabbar = element('div', 'dp-tabbar');
  tabbar.setAttribute('role', 'tablist');
  root.append(pane, tabbar);

  function element(tag: string, className: string): HTMLElement {
    const node = owner.createElement(tag);
    node.className = className;
    return node;
  }

  // --- 本文の編集 --------------------------------------------------------
  //
  // A block is edited as what it is: the Markdown that produced it. Clicking
  // opens the source of that block and nothing else, so the byte range written
  // back is exactly the range that was opened.

  interface BlockEdit {
    readonly host: HTMLElement;
    readonly original: string;
    readonly span: { start: number; end: number };
    readonly area: HTMLTextAreaElement;
    /** Written before the text. A new block needs the blank line that separates it. */
    readonly prefix: string;
    /** A new block, so an empty box means "never mind" rather than "delete this". */
    readonly fresh: boolean;
    /** The referenced file being edited, or undefined for the document. */
    readonly path: string | undefined;
  }

  const toolbar = createToolbar(owner, applyFormat);

  function applyFormat(mark: InlineMark): void {
    const current = editing;
    if (!current) return;
    const { area } = current;
    const change = toggleInline(area.value, area.selectionStart, area.selectionEnd, mark);
    area.setRangeText(change.text, change.start, change.end, 'preserve');
    area.setSelectionRange(change.select.start, change.select.end);
    area.focus();
    resize(area);
    toolbar.sync(area.value, area.selectionStart, area.selectionEnd);
  }

  function beginEdit(host: HTMLElement): void {
    if (editing?.host === host) return;
    const span = spanOf(host);
    if (!span) return;
    open(host, span, sliceBytes(source, span.start, span.end), '', false, undefined);
  }

  /**
   * Opens a diagram or a table — the whole of the file it lives in. A figure
   * is one file, so its range is that file from end to end; the `@import` line
   * that placed it belongs to the document and is edited from the caption.
   */
  function beginResourceEdit(figure: HTMLElement): void {
    const body = figure.querySelector<HTMLElement>('.dp-figure-body');
    const path = figure.dataset['path'];
    if (!body || !path || editing?.host === body) return;
    const text = options.readResource?.(path);
    if (text === undefined) {
      options.onError?.(`${path} を開けない`);
      return;
    }
    // Nobody wants to write a table by hand, so a table opens as a grid. The
    // source is still one click away, for the parts the grid has no gesture
    // for yet.
    if (path.toLowerCase().endsWith('.table')) {
      if (grid?.path === path) return;
      grid = { path, at: { row: 0, column: 0 } };
      endEdit(true);
      mountGrid(body);
      return;
    }
    open(body, { start: 0, end: byteLength(text) }, text, '', false, path);
  }

  /** Builds the grid from the file as it stands; the grid keeps no copy. */
  function mountGrid(body: HTMLElement): void {
    const current = grid;
    if (!current) return;
    const text = options.readResource?.(current.path);
    if (text === undefined) return;

    let table;
    try {
      table = parseTable(text);
    } catch (error) {
      options.onError?.(error instanceof Error ? error.message : String(error));
      grid = undefined;
      return;
    }

    mounted = createGrid({
      owner,
      table,
      at: current.at,
      apply: (make, next) => {
        // Only move the selection if the grid is still open. A write-back that
        // arrives as the grid is closing must still be applied, but it must
        // not bring the grid back.
        if (grid?.path === current.path) grid = { path: current.path, at: next };
        commit(() => {
          try {
            return { ...make(), path: current.path };
          } catch (error) {
            if (error instanceof TableEditError) throw new SheetEditError(error.message);
            throw error;
          }
        }, active);
      },
      // The grid moves its own selection; the host only remembers where it is,
      // so that a redraw after an edit can put it back.
      move: next => { grid = { path: current.path, at: next }; },
      showSource: () => {
        grid = undefined;
        const source = options.readResource?.(current.path) ?? '';
        open(body, { start: 0, end: byteLength(source) }, source, '', false, current.path);
      },
    });
    body.replaceChildren(mounted.element);
  }

  /**
   * Starts a new block at the end of a sheet. An empty sheet, or the space
   * after the last block, is the only place with nothing to click — without
   * this there is no way to begin writing at all.
   */
  function beginAppend(host: HTMLElement): void {
    if (editing?.host === host) return;
    const at = spanOf(host)?.end;
    if (at === undefined) return;
    open(host, { start: at, end: at }, '', '\n\n', true, undefined);
  }

  function open(
    host: HTMLElement, span: { start: number; end: number },
    initial: string, prefix: string, fresh: boolean, path: string | undefined,
  ): void {
    endEdit(true);

    const area = owner.createElement('textarea');
    area.className = 'dp-block-source';
    area.value = initial;
    area.spellcheck = false;

    const edit: BlockEdit = { host, original: host.innerHTML, span, area, prefix, fresh, path };
    host.classList.add('dp-editing');
    // The bar writes Markdown. A table's cells take inline Markdown but its
    // meaning tokens are fills in the style section, and a diagram takes
    // neither — so a bar over a referenced file would write the wrong thing.
    host.replaceChildren(...(path === undefined ? [toolbar.element, area] : [area]));
    editing = edit;

    resize(area);
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    toolbar.sync(area.value, area.selectionStart, area.selectionEnd);

    const update = (): void => {
      resize(area);
      toolbar.sync(area.value, area.selectionStart, area.selectionEnd);
    };
    area.addEventListener('input', update);
    area.addEventListener('select', update);
    area.addEventListener('keyup', update);
    area.addEventListener('click', update);
    area.addEventListener('blur', () => endEdit(true));
    area.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); endEdit(false); }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (isCommit(event, settings.commitKey)) { endEdit(true); return; }
        // Every Enter that is not the commit inserts a line break, including
        // the modified ones a text box would otherwise swallow.
        area.setRangeText('\n', area.selectionStart, area.selectionEnd, 'end');
        resize(area);
        toolbar.sync(area.value, area.selectionStart, area.selectionEnd);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault(); applyFormat('bold');
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') {
        event.preventDefault(); applyFormat('italic');
      }
    });
  }

  /** Commits the open block, if any. `keep` false throws the changes away. */
  function endEdit(keep: boolean): void {
    const current = editing;
    if (!current) return;
    editing = undefined;
    current.host.classList.remove('dp-editing');

    const typed = current.area.value;
    const whole = current.path === undefined
      ? source
      : options.readResource?.(current.path) ?? '';
    const before = sliceBytes(whole, current.span.start, current.span.end);
    const abandoned = current.fresh ? typed.trim() === '' : typed === before;
    if (!keep || abandoned) {
      // Putting the saved markup back is only safe for a block of prose. A
      // figure's body may have held a live grid, and restoring its HTML would
      // leave a picture of a grid with nothing wired to it — every button
      // clickable and dead. Draw it again instead.
      if (current.path === undefined) current.host.innerHTML = current.original;
      else draw();
      return;
    }
    commit(() => ({
      span: current.span,
      text: current.prefix + typed,
      path: current.path,
      // The path is in the edit; naming it here too would say it twice.
      description: current.path !== undefined
        ? 'ソースを編集'
        : current.fresh ? '本文を追加' : '本文を編集',
    }), active);
  }

  const CLICKABLE = '.dp-grid, .dp-block-source, .dp-format-bar, .dp-caption,'
    + ' .dp-import-line, .dp-figure, .dp-append, .dp-prose, h1, h2, h3, h4, h5, h6';

  function onPointerDown(event: MouseEvent): void {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(CLICKABLE);
    if (!target || !pane.contains(target)) return;
    // A press inside whatever is already open belongs to it.
    if (target.classList.contains('dp-block-source')) return;
    if (target.classList.contains('dp-format-bar')) return;
    if (target.classList.contains('dp-grid')) return;

    // We are about to open an editor and focus it. Left to itself the browser
    // would then move focus to whatever was under the pointer — by that time a
    // detached node — and the editor would blur and close on the way up.
    event.preventDefault();

    // Remember what was pressed before closing anything, then find it again:
    // closing redraws, and the element pressed is replaced by an equal one.
    const wanted = {
      span: target.dataset['span'],
      path: target.closest<HTMLElement>('.dp-figure')?.dataset['path'],
      append: target.classList.contains('dp-append'),
      caption: target.classList.contains('dp-caption')
        || target.classList.contains('dp-import-line'),
      figure: target.classList.contains('dp-figure'),
    };

    const hadGrid = grid !== undefined;
    if (hadGrid && !wanted.figure && wanted.path === undefined) {
      // Write back the open cell before the grid leaves the page, so nothing
      // typed is lost and no blur arrives after it is gone.
      const open = mounted;
      grid = undefined;
      open?.flush();
      draw();
      return;
    }
    endEdit(true);

    const again = resolve(wanted);
    if (!again) return;
    if (wanted.caption) {
      const figure = again.closest<HTMLElement>('.dp-figure');
      if (figure) beginEdit2(again, figure);
      return;
    }
    if (wanted.figure) { beginResourceEdit(again); return; }
    if (wanted.append) beginAppend(again);
    else beginEdit(again);
  }

  /** The same element in the page as it stands now. */
  function resolve(wanted: {
    span: string | undefined; path: string | undefined;
    append: boolean; caption: boolean; figure: boolean;
  }): HTMLElement | undefined {
    if (wanted.figure && wanted.path !== undefined) {
      return pane.querySelector<HTMLElement>(
        `.dp-figure[data-path="${cssEscape(wanted.path)}"]`) ?? undefined;
    }
    if (wanted.caption && wanted.path !== undefined) {
      const figure = pane.querySelector<HTMLElement>(
        `.dp-figure[data-path="${cssEscape(wanted.path)}"]`);
      return figure?.querySelector<HTMLElement>('.dp-caption, .dp-import-line') ?? undefined;
    }
    if (wanted.span === undefined) return undefined;
    const matches = [...pane.querySelectorAll<HTMLElement>(`[data-span="${wanted.span}"]`)];
    return matches.find(node => node.classList.contains('dp-append') === wanted.append);
  }

  /** Edits one element's range while showing the box somewhere else. */
  function beginEdit2(host: HTMLElement, ranged: HTMLElement): void {
    if (editing?.host === host) return;
    const span = spanOf(ranged);
    if (!span) return;
    open(host, span, sliceBytes(source, span.start, span.end), '', false, undefined);
  }

  /**
   * A figure with no caption has nothing that stands for the `@import` line,
   * so the editor shows the line itself. Editor chrome; never in the output.
   */
  function addImportTarget(figure: HTMLElement): void {
    if (figure.querySelector('.dp-caption')) return;
    const line = element('div', 'dp-import-line');
    line.textContent = `@import "${figure.dataset['path'] ?? ''}"`;
    figure.append(line);
  }

  /** The place to start writing, at the end of a sheet. Editor chrome only. */
  function addAppendTarget(section: HTMLElement): void {
    const empty = section.childElementCount === 0;
    section.classList.toggle('dp-sheet-empty', empty);
    const append = element('div', 'dp-append');
    // The sheet's own range ends where its last block ends, which is where a
    // new block goes, so the target carries the same range.
    append.dataset['span'] = section.dataset['span'] ?? '';
    append.textContent = empty ? 'ここに本文を書く' : '';
    section.append(append);
  }

  /** Paths contain dots and slashes; an attribute selector needs them quoted. */
  function cssEscape(value: string): string {
    return value.replace(/["\\]/g, '\\$&');
  }

  function spanOf(host: HTMLElement): { start: number; end: number } | undefined {
    const raw = host.dataset['span']?.split(',').map(Number);
    if (!raw || raw.length !== 2 || raw.some(Number.isNaN)) return undefined;
    return { start: raw[0]!, end: raw[1]! };
  }

  function resize(area: HTMLTextAreaElement): void {
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  }

  function sheets(): readonly Sheet[] {
    const document = parseDocument(source);
    return sheetsOf(document, undefined);
  }

  /**
   * Runs one operation, re-renders, and keeps the named sheet selected. An
   * edit that the document parser then refuses is rolled back: editing raw
   * Markdown makes an unparsable document reachable, and a broken editor is
   * worse than a refused keystroke.
   */
  function commit(make: () => Edit, select: number): void {
    let edit: Edit;
    try {
      edit = make();
    } catch (error) {
      if (error instanceof SheetEditError) { options.onError?.(error.message); return; }
      throw error;
    }

    const previous = source;
    const before = edit.path === undefined ? undefined : options.readResource?.(edit.path);
    const written = applyEdit(
      edit.path === undefined ? source : before ?? '', edit,
    );
    if (edit.path === undefined) source = written;
    options.onChange?.(edit, written);

    try {
      active = Math.max(1, Math.min(select, sheets().length));
      draw();
    } catch (error) {
      source = previous;
      if (edit.path !== undefined && before !== undefined) {
        options.onChange?.({ ...edit, description: '取り消し' }, before);
      }
      draw();
      options.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  /** Rebuilds everything. Only an edit needs this. */
  function draw(): void {
    const page = element('div', 'dp-page');
    page.innerHTML = render(source);
    pane.replaceChildren(page);
    editing = undefined;
    sections = [...page.querySelectorAll<HTMLElement>('.dp-sheet')];
    for (const section of sections) addAppendTarget(section);
    for (const figure of page.querySelectorAll<HTMLElement>('.dp-figure')) addImportTarget(figure);
    if (grid) {
      const figure = page.querySelector<HTMLElement>(`.dp-figure[data-path="${cssEscape(grid.path)}"]`);
      const body = figure?.querySelector<HTMLElement>('.dp-figure-body');
      if (body) mountGrid(body);
      else { grid = undefined; mounted = undefined; }
    } else {
      mounted = undefined;
    }

    drawTabs(sections.map((section, i) => ({
      title: section.dataset['title'] ?? `シート ${i + 1}`,
      empty: section.textContent?.trim() === '',
    })));
    refresh();
  }

  /**
   * Changes only what selecting a sheet changes. Switching tabs must not
   * rebuild the tab bar: a rebuild replaces the element mid-gesture, so the
   * second half of a double-click lands on a node that is no longer there.
   */
  function refresh(): void {
    pane.classList.toggle('dp-continuous', continuous);
    sections.forEach((section, i) => {
      section.hidden = !continuous && i + 1 !== active;
    });
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i + 1 === active));
    });
    if (continuous) sections[active - 1]?.scrollIntoView({ block: 'start' });
    else pane.scrollTop = 0;
  }

  function drawTabs(labels: readonly { title: string; empty: boolean }[]): void {
    tabbar.replaceChildren();
    tabs = [];

    labels.forEach((label, i) => {
      const index = i + 1;
      const tab = element('button', 'dp-tab') as HTMLButtonElement;
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.dataset['index'] = String(index);
      if (label.empty) tab.dataset['empty'] = 'true';
      tab.draggable = true;
      tab.append(owner.createTextNode(label.title));

      tab.addEventListener('click', () => select(index));
      tab.addEventListener('dblclick', () => beginRename(tab, index, label.title));
      tab.addEventListener('dragstart', event => {
        dragging = index;
        event.dataTransfer?.setData('text/plain', String(index));
      });
      tab.addEventListener('dragover', event => {
        event.preventDefault();
        if (dragging === undefined || dragging === index) return;
        tab.classList.add(dragging < index ? 'dp-drop-after' : 'dp-drop-before');
      });
      tab.addEventListener('dragleave', () => {
        tab.classList.remove('dp-drop-before', 'dp-drop-after');
      });
      tab.addEventListener('drop', event => {
        event.preventDefault();
        const from = dragging;
        dragging = undefined;
        if (from === undefined || from === index) return;
        commit(() => moveSheet(parseDocument(source), source, from, index), index);
      });

      if (labels.length > 1) {
        const close = element('button', 'dp-tab-close') as HTMLButtonElement;
        close.type = 'button';
        close.textContent = '×';
        close.title = 'このシートを削除';
        close.addEventListener('click', event => {
          event.stopPropagation();
          commit(() => removeSheet(parseDocument(source), source, index), Math.max(1, index - 1));
        });
        tab.append(close);
      }
      tabs.push(tab);
      tabbar.append(tab);
    });

    const add = element('button', 'dp-tab dp-tab-add') as HTMLButtonElement;
    add.type = 'button';
    add.textContent = '＋';
    add.title = 'シートを追加';
    add.addEventListener('click', () => {
      const last = labels.length;
      commit(() => insertSheet(parseDocument(source), source, last), last + 1);
    });
    tabbar.append(add, element('div', 'dp-tabbar-spacer'));

    const toggle = element('button', 'dp-tabbar-toggle') as HTMLButtonElement;
    toggle.type = 'button';
    toggle.textContent = '全シート表示';
    toggle.setAttribute('aria-pressed', String(continuous));
    toggle.addEventListener('click', event => {
      continuous = !continuous;
      (event.currentTarget as HTMLElement).setAttribute('aria-pressed', String(continuous));
      refresh();
    });
    tabbar.append(toggle);
  }

  /** Renaming edits the heading the name comes from; there is no other name. */
  function beginRename(tab: HTMLElement, index: number, title: string): void {
    // The tab keeps the width it had. Letting the box size itself shifts every
    // tab to its right while the name is being typed.
    tab.style.width = `${tab.getBoundingClientRect().width}px`;
    const input = element('input', 'dp-tab-rename') as HTMLInputElement;
    input.value = title;
    tab.replaceChildren(input);
    input.focus();
    input.select();

    // Committing replaces the tab, which blurs the input, which would ask to
    // commit again — on a tree that no longer exists. Once is enough.
    let done = false;
    const finish = (accept: boolean): void => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      tab.style.width = '';
      if (!accept || name === '' || name === title) { draw(); return; }
      commit(() => renameSheet(parseDocument(source), source, index, name), index);
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      event.stopPropagation();
    });
  }

  function select(index: number): void {
    active = Math.max(1, Math.min(index, sections.length || 1));
    refresh();
  }

  // Ctrl+PageUp / PageDown move between sheets, as in a spreadsheet.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!event.ctrlKey || editing) return;
    if (event.key === 'PageDown') { event.preventDefault(); select(active + 1); }
    if (event.key === 'PageUp') { event.preventDefault(); select(active - 1); }
  };
  owner.addEventListener('keydown', onKeyDown);

  draw();

  return {
    get source() { return source; },
    get active() { return active; },
    select,
    configure(next) {
      settings = next;
    },
    destroy() {
      owner.removeEventListener('keydown', onKeyDown);
      root.replaceChildren();
      root.classList.remove('dp-editor');
    },
  };
}

function injectStyle(document: Document): void {
  if (document.getElementById('dp-editor-style')) return;
  const style = document.createElement('style');
  style.id = 'dp-editor-style';
  style.textContent = EDITOR_STYLE;
  document.head.append(style);
}
