// The grid editor for a `.table`.
//
// Nobody wants to edit a table by writing its source, so this is what opens
// when a table is clicked. It behaves the way a spreadsheet does — the arrows
// move, typing replaces, Tab and Enter commit and step on — because that is
// the muscle memory the people this is for already have.
//
// Every gesture becomes one of the operations in ../table.ts, which are byte
// range edits in the `.table` file. The grid holds no copy of the data: after
// each change the file is re-read and the grid is rebuilt from it.

import {
  cellAt, shownText, type Align, type Cell, type Selector, type StyleRule, type TableFile,
} from '@docpresenter/markdown';
import {
  alignOf, cellClasses, cellRules, headerClasses, headerRules, inlineMarkdown,
  inlineStyle, rowClasses,
} from '@docpresenter/markdown';
import { BASE_MESSAGES, DEFAULT_LOCALE, type Edit, type Locale } from '@docpresenter/base';
import { EDITOR_MESSAGES } from '../messages.js';
import { undoKey } from '../history.js';
import { columnFloor, fitColumns } from '../column-widths.js';
import {
  formatTable, insertColumn, insertRow, parseClipboardGrid, pasteGrid,
  mergeDown, mergeLoses, mergeRange, mergeRight, removeColumn, removeRow, setAlign,
  clearRange, copyRange, setCell, setStyle, setWidth, styleAt, unmerge, wholeCells,
  type CellRange, type StyleProperty,
} from '../table.js';
import { toggleInline, type InlineMark } from '@docpresenter/base';
import { createMenu, type MenuItem } from '@docpresenter/base';
import { createSwatchRow, FILL_SWATCHES, TEXT_SWATCHES } from '@docpresenter/base';
import { createToolbar, type Toolbar } from '@docpresenter/base';

export interface GridPosition {
  /** -1 is the header row. */
  readonly row: number;
  readonly column: number;
}

export interface GridOptions {
  readonly owner: Document;
  readonly table: TableFile;
  readonly at: GridPosition;
  /** Which of TARGETS the style controls act on. Kept by the host so that it
   *  survives the rebuild after every edit. */
  readonly target: string;
  /** Runs one operation as an edit on the table's file. */
  readonly apply: (make: () => Edit, at: GridPosition) => void;
  /** Tells the host where the selection went, so a redraw can restore it. */
  readonly move: (at: GridPosition) => void;
  readonly onTarget: (target: string) => void;
  /** Leaves the grid and shows the source instead. */
  readonly showSource: () => void;
  /**
   * Undo (or redo, with true). The grid's selection lives in a text box, so the
   * keys reach the box first; while no cell is open they are the host's.
   */
  readonly undo?: ((redo: boolean) => void) | undefined;
  /** Which language the bars and menus speak. */
  readonly locale?: Locale | undefined;
  /**
   * The words a cell is offered, for a table that knows what its columns
   * mean — a screen's item table. Undefined for a cell that is just text.
   */
  readonly choices?: ((at: GridPosition) => CellChoices | undefined) | undefined;
}

/** The words one cell is offered, and whether anything else belongs there. */
export interface CellChoices {
  /** True when only these words are read; false when they are a start. */
  readonly closed: boolean;
  readonly choices: readonly { readonly text: string; readonly detail?: string | undefined }[];
  /** Whether a word written there can be read. */
  accepts(text: string): boolean;
}

/**
 * The targets a style can be applied to, as the file's own selectors. A cell
 * is named by its row and column and a single row by a range over itself, so a
 * rule keeps pointing at the same thing when the rows move.
 *
 * Row striping is not here. Zebra rows are a look, not a statement about this
 * table, so the theme draws them - the same call as the rule under the header.
 * A `row:odd` rule already in a file is still read and still rendered.
 */
const TARGETS = ['cell', 'row', 'column', 'header'] as const;

export interface Grid {
  readonly element: HTMLElement;
  /**
   * Writes back whatever cell is open. The view calls this before taking the
   * grid off the page: removing a focused text box fires its blur, and a blur
   * arriving after the grid is gone would put it back on screen.
   */
  flush(): void;
}

export function createGrid(options: GridOptions): Grid {
  const { owner, table } = options;
  const locale = options.locale ?? DEFAULT_LOCALE;
  const t = EDITOR_MESSAGES.in(locale);
  const columns = table.columns.length;

  // One text box, always focused, sitting over the selected cell. A cell that
  // is merely focusable cannot take IME input: composing Japanese needs
  // somewhere to compose into from the very first keystroke, and a grid where
  // the first character of every Japanese word is swallowed is unusable.
  let at = options.at;
  // Where a range selection started. Equal to `at` while one cell is picked.
  let anchor = options.at;
  let dragging = false;
  let editing = false;
  let repaintStyle: () => void = () => {};
  // A target the host remembers from an older build may no longer exist.
  let target = TARGETS.some(one => one === options.target) ? options.target : 'cell';
  const nodes = new Map<string, HTMLElement>();
  const input = owner.createElement('input');
  input.className = 'dp-grid-input';
  input.spellcheck = false;

  // What the open cell is offered, under it, and the button that opens it on
  // a cell that is only picked — the pointer's way in, as a spreadsheet's
  // list cell has. The words shown are those that fit what has been typed.
  const list = element('ul', 'dp-suggest dp-grid-choices');
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  const opener = element('button', 'dp-grid-opener');
  opener.textContent = '\u25be';
  opener.tabIndex = -1;
  opener.title = t('editor.grid.choices');
  opener.addEventListener('mousedown', event => {
    event.preventDefault();
    event.stopPropagation();
    if (!editing) startEditing('');
  });
  let offered: CellChoices | undefined;
  let shown: CellChoices['choices'] = [];
  let active = -1;
  // Until something is typed every word is shown: the box opens holding the
  // cell's own text, and that is not a search.
  let typed = false;

  // A cell holds inline Markdown, so the same bar that formats prose formats a
  // cell. It appears only while a cell is open: with nothing being edited
  // there is no selection for it to act on.
  const toolbar: Toolbar = createToolbar(owner, applyInline, locale);
  toolbar.element.hidden = true;
  const menu = createMenu(owner);

  const root = owner.createElement('div');
  root.className = 'dp-grid';
  root.append(createBar(), createStyleBar(), toolbar.element, createTable());
  root.addEventListener('paste', onPaste);
  root.addEventListener('copy', onCopy);
  root.addEventListener('cut', onCut);
  owner.addEventListener('mouseup', () => { dragging = false; });
  wireInput();
  queueMicrotask(() => place(at));
  return {
    element: root,
    flush() { if (editing) commit(at); },
  };

  function element(tag: string, className: string): HTMLElement {
    const node = owner.createElement(tag);
    node.className = className;
    return node;
  }

  function key(position: GridPosition): string {
    return `${position.row},${position.column}`;
  }

  /** The rectangle currently picked, grown to hold every cell it touches. */
  function range(): CellRange {
    return wholeCells(table, {
      top: Math.min(anchor.row, at.row),
      left: Math.min(anchor.column, at.column),
      bottom: Math.max(anchor.row, at.row),
      right: Math.max(anchor.column, at.column),
    });
  }

  /** True while exactly one cell is picked. A declaration, not a const: this
   *  lives after the function's `return`, where only declarations exist. */
  function single(): boolean {
    return anchor.row === at.row && anchor.column === at.column;
  }

  /** Paints the picked rectangle. The selected cell keeps its own outline. */
  function paintRange(): void {
    const box = range();
    for (const [id, node] of nodes) {
      const [row, column] = id.split(',').map(Number) as [number, number];
      const inside = !single() && row >= box.top && row <= box.bottom
        && column >= box.left && column <= box.right;
      node.classList.toggle('dp-grid-picked', inside);
    }
  }

  function createTable(): HTMLElement {
    const grid = owner.createElement('table');
    grid.className = 'dp-grid-table';

    const head = owner.createElement('thead');
    const headRow = owner.createElement('tr');
    const widths = table.columns.map(column => table.style.find(r =>
      r.selector.kind === 'column' && r.selector.name === column.header,
    )?.declarations.get('width'));
    const heads = table.columns.map((column, c) => {
      const node = cellNode('th', column.header, -1, c, 1, 1, undefined);
      const width = widths[c];
      if (width !== undefined) node.style.width = width;
      addResizeHandle(node, c);
      headRow.append(node);
      return node;
    });
    head.append(headRow);

    // Widths given to some columns can leave the others too little to show a
    // word; those keep their room, and the given ones give way, on screen only.
    const floors = table.columns.map((column, c) => columnFloor(column.header, table.rows.flatMap(row =>
      row.cells.filter(cell => cell.column === c && cell.colspan === 1).map(shownText))));
    const fit = (): void => {
      const total = grid.clientWidth;
      if (total <= 0) return;
      const em = Number.parseFloat(owner.defaultView?.getComputedStyle(grid).fontSize ?? '') || 16;
      const shares = fitColumns(widths, floors, total, em);
      heads.forEach((node, c) => { node.style.width = shares ? `${shares[c]}%` : widths[c] ?? ''; });
    };
    queueMicrotask(fit);
    const Observer = owner.defaultView?.ResizeObserver;
    if (Observer) new Observer(fit).observe(grid);

    const tbody = owner.createElement('tbody');
    table.rows.forEach((row, r) => {
      const line = owner.createElement('tr');
      line.className = rowClasses(table, r).join(' ');
      for (const cell of row.cells) {
        line.append(cellNode('td', shownText(cell), r, cell.column, cell.rowspan, cell.colspan, cell));
      }
      tbody.append(line);
    });

    grid.append(head, tbody);
    return grid;
  }

  function cellNode(
    tag: 'th' | 'td', text: string, row: number, column: number,
    rowspan: number, colspan: number, cell: Cell | undefined,
  ): HTMLElement {
    // The grid wears the same style classes the printed table will, so a fill
    // or a rule can be seen the moment it is applied.
    const rules = cell
      ? cellRules(table, cell, row)
      : [...headerRules(table), ...columnRulesFor(column)];
    const styles = cell ? cellClasses(table, cell, row) : headerClasses(table);
    // The alignment a cell ends up with is decided by the renderer, from the
    // delimiter row and any rule that overrides it. Reading only the column
    // here would leave the grid unmoved by an alignment it had just been told
    // to apply.
    const node = element(tag, ['dp-grid-cell', alignOf(table, column, rules), ...styles].join(' '));
    // A word the screen cannot read is shown as such where it is written,
    // not only as a note under the drawing.
    const offer = tag === 'td' ? options.choices?.({ row, column }) : undefined;
    if (offer?.closed && text.trim() !== '' && !offer.accepts(text)) {
      node.classList.add('dp-grid-unread');
      node.title = t('editor.grid.unread');
    }
    const colours = inlineStyle(rules);
    if (colours !== '') node.setAttribute('style', colours);
    const label = element('span', 'dp-grid-text');
    // What the cell will look like, not the notation that produces it. The
    // notation is in the text box, which is what opens when you edit.
    label.innerHTML = inlineMarkdown(text);
    node.append(label);
    node.dataset['row'] = String(row);
    node.dataset['column'] = String(column);
    if (rowspan > 1) node.setAttribute('rowspan', String(rowspan));
    if (colspan > 1) node.setAttribute('colspan', String(colspan));
    nodes.set(key({ row, column }), node);

    node.addEventListener('mousedown', event => {
      // The browser would otherwise move focus off the text box we rely on.
      event.preventDefault();
      if (event.button !== 0) return;
      if (editing) commit({ row, column });
      else place({ row, column }, event.shiftKey);
      // Dragging across cells picks a rectangle, as it does in a spreadsheet.
      if (!event.shiftKey) dragging = true;
    });
    node.addEventListener('mouseenter', () => {
      if (dragging && !editing) place({ row, column }, true);
    });
    node.addEventListener('contextmenu', event => {
      // While a cell is open the browser's own menu is the useful one: cut,
      // copy, paste, and whatever the platform adds for text.
      if (editing) return;
      event.preventDefault();
      // Right-clicking inside a picked rectangle keeps it; outside, it moves.
      const box = range();
      const inside = row >= box.top && row <= box.bottom
        && column >= box.left && column <= box.right;
      if (!inside) place({ row, column });
      menu.open(event.clientX, event.clientY, rowColumnMenu());
    });
    // On both the cell and the box: the box covers the cell, but a double
    // click whose two halves land on different nodes is delivered to the cell
    // they have in common.
    node.addEventListener('dblclick', () => startEditing(''));
    return node;
  }

  function columnRulesFor(column: number): readonly StyleRule[] {
    const header = table.columns[column]?.header;
    return table.style.filter(r => r.selector.kind === 'column' && r.selector.name === header);
  }

  function textOf(position: GridPosition): string {
    if (position.row < 0) return table.columns[position.column]?.header ?? '';
    return cellAt(table, position.row, position.column)?.text ?? '';
  }

  /** Puts the selection, and the text box, on a cell. */
  function place(next: GridPosition, extend = false): void {
    const wanted = clamp(next);
    const owning = wanted.row < 0 ? undefined : cellAt(table, wanted.row, wanted.column);
    const resolved = owning ? { row: owning.row, column: owning.column } : wanted;

    // Landing on the cell that is already selected must not move the text box:
    // taking it out and putting it back breaks the browser's count of
    // consecutive clicks, and the double click never arrives. Everything else
    // still happens — leaving the cell in its editing state would keep the
    // formatting bar on screen, and the rows below it would sit where they
    // were rather than where they are.
    const same = resolved.row === at.row && resolved.column === at.column
      && input.parentElement === nodes.get(key(at));

    const was = nodes.get(key(at));
    was?.classList.remove('dp-grid-editing');
    if (!same) was?.classList.remove('dp-grid-at');

    at = resolved;
    if (!extend) anchor = resolved;
    editing = false;
    input.value = '';
    closeChoices();
    offered = at.row < 0 ? undefined : options.choices?.(at);
    toolbar.element.hidden = true;
    repaintStyle();
    paintRange();

    const node = nodes.get(key(at));
    if (!node) return;
    node.classList.add('dp-grid-at');
    if (!same) node.append(input);
    if (offered && offered.choices.length > 0) node.append(opener);
    else opener.remove();
    input.focus({ preventScroll: true });
    options.move(at);
  }

  function startEditing(initial: string): void {
    if (editing) return;
    editing = true;
    input.value = initial === '' ? textOf(at) : initial;
    nodes.get(key(at))?.classList.add('dp-grid-editing');
    if (initial === '') input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
    toolbar.element.hidden = false;
    toolbar.sync(input.value, input.selectionStart ?? 0, input.selectionEnd ?? 0);
    typed = initial !== '';
    showChoices();
  }

  /** Shows what the open cell is offered, as far as it fits what is typed. */
  function showChoices(): void {
    if (!offered || !editing) { closeChoices(); return; }
    const value = input.value.trim().toLowerCase();
    // A closed list is short and is all there is, so it is never cut down; an
    // open one is cut to what has the typed text in it.
    shown = offered.closed || !typed || value === ''
      ? offered.choices
      : offered.choices.filter(one => one.text.toLowerCase().includes(value));
    if (!offered.closed && shown.length === 1 && shown[0]!.text.toLowerCase() === value) shown = [];
    // On a closed list the word already written is where the arrows start.
    active = offered.closed ? shown.findIndex(one => one.text.toLowerCase() === value) : -1;
    drawChoices();
  }

  function drawChoices(): void {
    list.replaceChildren(...shown.map((one, index) => {
      const row = element('li', index === active ? 'dp-suggest-active' : '');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === active));
      const text = element('span', 'dp-suggest-text');
      // An empty word is a choice too — "as the part has it" — and needs a
      // place to click.
      text.textContent = one.text === '' ? '\u00a0' : one.text;
      row.append(text);
      if (one.detail) {
        const detail = element('span', 'dp-suggest-detail');
        detail.textContent = one.detail;
        row.append(detail);
      }
      // Pressed, not clicked: a click would take the focus from the box first.
      row.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
        choose(index, at);
      });
      return row;
    }));
    list.hidden = shown.length === 0;
    const node = nodes.get(key(at));
    if (!list.hidden && node) {
      node.append(list);
      // Under the cell, unless the cell is near the bottom of the window and
      // there is more room above it: a list opened past the bottom edge is a
      // list nobody sees until they think to scroll.
      list.classList.remove('dp-grid-choices-up');
      const view = owner.defaultView;
      const cell = node.getBoundingClientRect();
      const below = (view?.innerHeight ?? cell.bottom) - cell.bottom;
      if (list.offsetHeight > below && cell.top > below) list.classList.add('dp-grid-choices-up');
    }
    list.querySelector('.dp-suggest-active')?.scrollIntoView({ block: 'nearest' });
  }

  function closeChoices(): void {
    list.hidden = true;
    list.remove();
    shown = [];
    active = -1;
  }

  /** Writes a word from the list into the open cell and moves on. */
  function choose(index: number, then: GridPosition): void {
    const one = shown[index];
    if (!one) return;
    input.value = one.text;
    commit(then);
  }

  /** On a closed list, the word after the one written: Space, as a check box takes it. */
  function cycle(): void {
    if (!offered?.closed || offered.choices.length === 0) return;
    const now = textOf(at).trim().toLowerCase();
    const index = offered.choices.findIndex(one => one.text.toLowerCase() === now);
    const next = offered.choices[(index + 1) % offered.choices.length]!.text;
    const target = at;
    options.apply(() => setCell(table, target.row, target.column, next), target);
  }

  /** Formats the selection inside the open cell, as Markdown in the cell text. */
  function applyInline(mark: InlineMark): void {
    if (!editing) return;
    const change = toggleInline(
      input.value, input.selectionStart ?? 0, input.selectionEnd ?? 0, mark);
    input.setRangeText(change.text, change.start, change.end, 'preserve');
    input.setSelectionRange(change.select.start, change.select.end);
    input.focus();
    toolbar.sync(input.value, input.selectionStart ?? 0, input.selectionEnd ?? 0);
  }

  /** Writes the box back and moves on. */
  function commit(then: GridPosition): void {
    if (!editing) { place(then); return; }
    const written = input.value;
    const before = textOf(at);
    const target = at;
    editing = false;
    if (written === before) { place(then); return; }
    options.apply(() => setCell(table, target.row, target.column, written), clamp(then));
  }

  function wireInput(): void {
    // A character arriving while navigating starts an edit and is kept, which
    // is also how the first keystroke of an IME composition reaches the box.
    input.addEventListener('compositionstart', () => {
      if (!editing) {
        editing = true;
        nodes.get(key(at))?.classList.add('dp-grid-editing');
      }
    });
    input.addEventListener('input', () => {
      if (!editing && input.value !== '') startEditing(input.value);
      else if (editing) {
        toolbar.sync(input.value, input.selectionStart ?? 0, input.selectionEnd ?? 0);
        typed = true;
        showChoices();
      }
    });
    input.addEventListener('select', () => {
      if (editing) toolbar.sync(input.value, input.selectionStart ?? 0, input.selectionEnd ?? 0);
    });
    input.addEventListener('blur', () => {
      // A blur caused by the box being taken off the page is not the author
      // leaving the cell; whatever was open has already been written back.
      if (editing && input.isConnected) commit(at);
    });
    // The box covers the cell, so a double click lands here and not on the td.
    input.addEventListener('dblclick', () => startEditing(''));
    // While a cell is open the press belongs to the text: dragging selects,
    // which is how anyone copies part of a cell or picks what to colour. The
    // cell's own handler would cancel the default and end the edit.
    input.addEventListener('mousedown', event => {
      if (editing) event.stopPropagation();
    });

    input.addEventListener('keydown', event => {
      event.stopPropagation();
      // While composing, every key belongs to the IME.
      if (event.isComposing) return;
      // An open cell undoes its own typing; a closed one undoes the last edit.
      const travel = editing ? undefined : undoKey(event);
      if (travel) {
        event.preventDefault();
        options.undo?.(travel === 'redo');
        return;
      }
      const step = (row: number, column: number, extend = false): void => {
        event.preventDefault();
        if (editing && active >= 0 && shown[active]) choose(active, { row, column });
        else if (editing) commit({ row, column });
        else place({ row, column }, extend);
      };

      // An open list has the up and down arrows; Enter and Tab take the word
      // the arrows are on, through step.
      if (editing && !list.hidden && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        active = event.key === 'ArrowDown'
          ? (active + 1) % shown.length
          : (active <= 0 ? shown.length : active) - 1;
        drawChoices();
        return;
      }
      if (!editing && offered && offered.choices.length > 0) {
        // Alt+Down opens the list, as it does on a spreadsheet's list cell.
        if (event.key === 'ArrowDown' && event.altKey) { event.preventDefault(); return startEditing(''); }
        if (event.key === ' ' && offered.closed && single()) { event.preventDefault(); return cycle(); }
      }

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          return place(at);
        case 'Enter':
          if (!editing) { event.preventDefault(); return startEditing(''); }
          return step(at.row + 1, at.column);
        case 'F2':
          event.preventDefault();
          return startEditing('');
        case 'Tab':
          return step(at.row, at.column + (event.shiftKey ? -1 : 1));
        case 'ArrowUp':
          if (editing) return;
          return step(at.row - 1, at.column, event.shiftKey);
        case 'ArrowDown':
          if (editing) return;
          return step(at.row + 1, at.column, event.shiftKey);
        case 'ArrowLeft':
          if (editing) return;
          return step(at.row, at.column - 1, event.shiftKey);
        case 'ArrowRight':
          if (editing) return;
          return step(at.row, at.column + 1, event.shiftKey);
        case 'Delete':
        case 'Backspace': {
          if (editing) return;
          event.preventDefault();
          const target = at;
          return options.apply(() => setCell(table, target.row, target.column, ''), target);
        }
        default:
      }
    });
  }

  // --- スタイル ---------------------------------------------------------
  //
  // The buttons offer exactly the selectors the file already uses, so nothing
  // new has to be invented for the UI: a cell is named by its row and column,
  // a row by a range over itself, and both keep pointing at the same thing
  // when the rows move.


  /** The selector the buttons act on, from the target and the selected cell. */
  function selector(): Selector | undefined {
    const column = table.columns[at.column]?.header;
    const rowKey = at.row < 0 ? undefined : table.rows[at.row]?.cells[0]?.text;
    switch (target) {
      case 'header': return { kind: 'header' };
      case 'column': return column === undefined ? undefined : { kind: 'column', name: column };
      case 'row': return rowKey === undefined ? undefined : { kind: 'range', from: rowKey, to: rowKey };
      case 'cell':
        return column === undefined || rowKey === undefined
          ? undefined : { kind: 'cell', row: rowKey, column };
      default: return undefined;
    }
  }

  function createStyleBar(): HTMLElement {
    const bar = element('div', 'dp-grid-bar dp-grid-style');

    const choose = owner.createElement('select');
    choose.className = 'dp-grid-target';
    choose.title = t('editor.grid.targetTitle');
    for (const option of TARGETS) {
      const node = owner.createElement('option');
      node.value = option;
      node.textContent = t(`editor.grid.target.${option}`);
      choose.append(node);
    }
    choose.value = target;
    choose.addEventListener('change', () => {
      target = choose.value;
      options.onTarget(target);
      paint();
    });
    bar.append(choose);

    const set = (property: StyleProperty, value: string | undefined): void => {
      const which = selector();
      if (!which) return;
      // Pressing the colour already applied takes it off.
      const next = value !== undefined && styleAt(table, which, property) === value
        ? undefined : value;
      options.apply(() => setStyle(table, which, property, next), at);
    };

    const rows = ([
      ['fill', t('editor.grid.fill'), FILL_SWATCHES, '#ffe0e0'],
      ['color', t('editor.grid.colour'), TEXT_SWATCHES, '#ff0000'],
    ] as const).map(([property, label, swatches, initial], index) => {
      if (index > 0) bar.append(element('span', 'dp-grid-divider'));
      const name = element('span', 'dp-grid-label');
      name.textContent = label;
      bar.append(name);
      const row = createSwatchRow(owner, {
        label, swatches, initial, locale, className: 'dp-grid-swatch',
        onPick: colour => set(property, colour),
        onReset: () => set(property, undefined),
      });
      bar.append(...row.nodes);
      return { property, row };
    });

    function paint(): void {
      const which = selector();
      for (const { property, row } of rows) {
        row.sync(which && styleAt(table, which, property), which !== undefined);
      }
    }
    paint();
    repaintStyle = paint;
    return bar;
  }

  /**
   * Dragging the edge of a header cell sets that column's width, as a share of
   * the table. A share travels: the same document goes to HTML, PDF and PPTX,
   * and a pixel means something different in each.
   */
  function addResizeHandle(node: HTMLElement, column: number): void {
    const handle = element('span', 'dp-grid-resize');
    handle.title = t('editor.grid.widthHandle');
    node.append(handle);

    handle.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
      const grid = node.closest('table');
      if (!grid) return;
      const total = grid.getBoundingClientRect().width;
      const from = node.getBoundingClientRect().width;
      const startX = event.clientX;
      let share = (from / total) * 100;

      const onMove = (move: MouseEvent): void => {
        const width = Math.max(24, from + (move.clientX - startX));
        share = Math.min(95, Math.max(3, (width / total) * 100));
        node.style.width = `${share.toFixed(1)}%`;
      };
      const onUp = (): void => {
        owner.removeEventListener('mousemove', onMove);
        owner.removeEventListener('mouseup', onUp);
        const name = table.columns[column]?.header;
        if (name === undefined) return;
        // One edit for the whole drag, not one per pixel.
        options.apply(() => setWidth(table, name, `${share.toFixed(1)}%`), at);
      };
      owner.addEventListener('mousemove', onMove);
      owner.addEventListener('mouseup', onUp);
    });
  }

  /**
   * The picked rectangle leaves as tab-separated text, which is what a
   * spreadsheet reads. While a cell is open the clipboard belongs to the text
   * in it — that is how part of a cell gets copied — so nothing is intercepted.
   */
  function onCopy(event: ClipboardEvent): void {
    if (editing || !event.clipboardData) return;
    event.clipboardData.setData('text/plain', copyRange(table, range()));
    event.preventDefault();
  }

  function onCut(event: ClipboardEvent): void {
    if (editing || !event.clipboardData) return;
    const picked = range();
    event.clipboardData.setData('text/plain', copyRange(table, picked));
    event.preventDefault();
    options.apply(() => clearRange(table, picked), at);
  }

  function onPaste(event: ClipboardEvent): void {
    // While a cell is open, what arrives is text for that cell.
    if (editing) return;
    const text = event.clipboardData?.getData('text/plain');
    if (!text || !/[\t\n]/.test(text)) return;
    event.preventDefault();
    const values = parseClipboardGrid(text);
    const row = Math.max(0, at.row);
    const column = at.column;
    options.apply(() => pasteGrid(table, row, column, values), { row, column });
  }

  function clamp(next: GridPosition): GridPosition {
    return {
      row: Math.max(-1, Math.min(next.row, table.rows.length - 1)),
      column: Math.max(0, Math.min(next.column, columns - 1)),
    };
  }

  /**
   * Inserting and deleting rows and columns: six entries that are reached
   * now and then. On the toolbar they crowded out the colours and the
   * alignment, which are reached constantly, so they live on right-click.
   */
  /**
   * Merging a rectangle keeps only the top-left cell's text. Losing the rest
   * silently is the kind of thing a spreadsheet asks about first, so this does
   * too — in the same menu, where the pointer already is.
   */
  function mergeSelection(): void {
    const box = range();
    const lost = mergeLoses(table, box);
    const apply = (): void => options.apply(
      () => mergeRange(table, box), { row: box.top, column: box.left });
    if (lost.length === 0) { apply(); return; }

    const node = nodes.get(key({ row: box.top, column: box.left }));
    const where = node?.getBoundingClientRect();
    menu.open(where?.left ?? 0, (where?.bottom ?? 0) + 4, [
      { label: t('editor.grid.mergeLoses', { count: lost.length }), disabled: true, run: () => {} },
      { label: t('editor.grid.mergeKeep', { text: keptText() }), separated: true, run: apply },
      { label: BASE_MESSAGES.in(locale)('base.cancel'), run: () => {} },
    ]);
  }

  /** The text that survives the merge, short enough to read in a menu. */
  function keptText(): string {
    const box = range();
    const text = (cellAt(table, box.top, box.left)?.text ?? '').trim();
    if (text === '') return t('editor.grid.emptyCell');
    return text.length > 12 ? `${text.slice(0, 12)}…` : text;
  }

  function rowColumnMenu(): MenuItem[] {
    const row = Math.max(0, at.row);
    const here = (): GridPosition => ({ row, column: at.column });
    return [
      { label: t('editor.grid.rowAbove'), run: () => options.apply(() => insertRow(table, row), here()) },
      {
        label: t('editor.grid.rowBelow'),
        run: () => options.apply(() => insertRow(table, row + 1), { row: row + 1, column: at.column }),
      },
      { label: t('editor.grid.removeRow'), run: () => options.apply(() => removeRow(table, row), here()) },
      {
        label: t('editor.grid.columnLeft'), separated: true,
        run: () => options.apply(() => insertColumn(table, at.column, ''), here()),
      },
      {
        label: t('editor.grid.columnRight'),
        run: () => options.apply(
          () => insertColumn(table, at.column + 1, ''), { row: at.row, column: at.column + 1 }),
      },
      {
        label: t('editor.grid.removeColumn'),
        run: () => options.apply(
          () => removeColumn(table, at.column), { row: at.row, column: Math.max(0, at.column - 1) }),
      },
      ...mergeItems(),
    ];
  }

  /**
   * Merging, from the cell that owns the merge. There is no range selection,
   * and none is needed: the file says a merge by marking the cell that gives
   * itself up, so "extend down" and "extend right" are the whole vocabulary.
   */
  function mergeItems(): MenuItem[] {
    const owning = at.row < 0 ? undefined : cellAt(table, at.row, at.column);
    const merged = owning !== undefined && (owning.rowspan > 1 || owning.colspan > 1);
    const canDown = at.row >= 0 && owning !== undefined
      && at.row + owning.rowspan < table.rows.length + 1
      && table.rows[at.row + owning.rowspan] !== undefined;
    const canRight = at.row >= 0 && owning !== undefined
      && owning.column + owning.colspan < table.columns.length;

    return [
      {
        label: t('editor.grid.mergeSelection'), separated: true, disabled: single() || at.row < 0,
        run: () => mergeSelection(),
      },
      {
        label: t('editor.grid.mergeDown'), disabled: !canDown || !single(),
        run: () => options.apply(() => mergeDown(table, at.row, at.column), at),
      },
      {
        label: t('editor.grid.mergeRight'), disabled: !canRight || !single(),
        run: () => options.apply(() => mergeRight(table, at.row, at.column), at),
      },
      {
        label: t('editor.grid.unmerge'), disabled: !merged,
        run: () => options.apply(() => unmerge(table, at.row, at.column), at),
      },
    ];
  }

  function createBar(): HTMLElement {
    const bar = element('div', 'dp-grid-bar');
    const add = (label: string, title: string, run: () => void): void => {
      const button = owner.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.title = title;
      button.addEventListener('mousedown', event => { event.preventDefault(); run(); });
      bar.append(button);
    };
    const here = (): GridPosition => ({ row: Math.max(0, at.row), column: at.column });

    // Alignment follows the same target as the colours. Markdown can only
    // give a column one alignment, but a rule may override it for the header —
    // headings centred over right-aligned figures is the usual scientific
    // table, and the vocabulary already allows it.
    const aligns: [Align, string, string][] = [
      ['left', t('editor.grid.alignLeft'), t('editor.grid.alignLeftTitle')],
      ['center', t('editor.grid.alignCenter'), t('editor.grid.alignCenterTitle')],
      ['right', t('editor.grid.alignRight'), t('editor.grid.alignRightTitle')],
    ];
    for (const [align, label, title] of aligns) {
      add(label, title, () => {
        if (target === 'column') {
          options.apply(() => setAlign(table, at.column, align), here());
          return;
        }
        const which = selector();
        if (!which) return;
        const off = styleAt(table, which, 'align') === align;
        options.apply(() => setStyle(table, which, 'align', off ? undefined : align), here());
      });
    }

    bar.append(element('span', 'dp-grid-divider'));
    // The source is what a reviewer reads in a diff, so keeping its columns
    // lined up is worth a button. It changes nothing in the printed table.
    add(t('editor.grid.format'), t('editor.grid.formatTitle'), () =>
      options.apply(() => formatTable(table), here()));
    add(t('editor.grid.source'), t('editor.grid.sourceTitle'), () => options.showSource());
    // The rows, the columns and the merging are on the right click — which a
    // finger does not have. The same menu, for the cell that is picked.
    add(t('editor.grid.more'), t('editor.grid.moreTitle'), () => {
      const where = bar.getBoundingClientRect();
      menu.open(where.right - 8, where.bottom + 4, rowColumnMenu());
    });
    return bar;
  }
}
