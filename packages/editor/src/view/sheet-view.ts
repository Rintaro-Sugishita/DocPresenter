// The sheet view: one sheet on screen at a time, with tabs along the bottom.
//
// The view owns no model of its own. It holds the source text, asks the caller
// to render it, and turns every gesture into one of the sheet operations —
// which are byte-range edits. That means what the screen shows and what the
// file contains can never drift apart: there is only the file.

import { parseDocument, sheetsOf, sliceBytes, type Sheet } from '@docpresenter/core';
import type { Edit } from '../edit.js';
import { applyEdit } from '../edit.js';
import { toggleInline, type InlineMark } from '../inline.js';
import { insertSheet, moveSheet, removeSheet, renameSheet, SheetEditError } from '../sheets.js';
import { EDITOR_STYLE } from './style.js';
import { createToolbar } from './toolbar.js';

export interface SheetViewOptions {
  readonly root: HTMLElement;
  readonly source: string;
  /** Renders a document to HTML made of `<section class="dp-sheet">`. */
  readonly render: (source: string) => string;
  /** Called after every edit, with the new source and the edit that made it. */
  readonly onChange?: (source: string, edit: Edit) => void;
  /** Called when an operation is refused, so the app can say why. */
  readonly onError?: (message: string) => void;
}

export interface SheetView {
  readonly source: string;
  readonly active: number;
  select(index: number): void;
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

  const owner = root.ownerDocument;
  injectStyle(owner);
  root.classList.add('dp-editor');
  const pane = element('div', 'dp-editor-pane');
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
    endEdit(true);
    const span = spanOf(host);
    if (!span) return;

    const area = owner.createElement('textarea');
    area.className = 'dp-block-source';
    area.value = sliceBytes(source, span.start, span.end);
    area.spellcheck = false;

    const edit: BlockEdit = { host, original: host.innerHTML, span, area };
    host.classList.add('dp-editing');
    host.replaceChildren(toolbar.element, area);
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

    const written = current.area.value;
    const before = sliceBytes(source, current.span.start, current.span.end);
    if (!keep || written === before) {
      current.host.innerHTML = current.original;
      return;
    }
    commit(() => ({
      span: current.span, text: written, description: '本文を編集',
    }), active);
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

  /** Runs one operation, re-renders, and keeps the named sheet selected. */
  function commit(make: () => Edit, select: number): void {
    let edit: Edit;
    try {
      edit = make();
    } catch (error) {
      if (error instanceof SheetEditError) { options.onError?.(error.message); return; }
      throw error;
    }
    source = applyEdit(source, edit);
    active = Math.max(1, Math.min(select, sheets().length));
    draw();
    options.onChange?.(source, edit);
  }

  /** Rebuilds everything. Only an edit needs this. */
  function draw(): void {
    const page = element('div', 'dp-page');
    page.innerHTML = render(source);
    page.addEventListener('click', event => {
      const target = (event.target as HTMLElement | null)
        ?.closest<HTMLElement>('.dp-prose, h1, h2, h3, h4, h5, h6');
      if (target && page.contains(target)) beginEdit(target);
    });
    pane.replaceChildren(page);
    editing = undefined;
    sections = [...page.querySelectorAll<HTMLElement>('.dp-sheet')];

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
