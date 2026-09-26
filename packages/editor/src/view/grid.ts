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

import { cellAt, type Align, type Cell, type Selector, type TableFile } from '@docpresenter/core';
import {
  cellClasses, cellRules, headerClasses, headerRules, inlineStyle, rowClasses,
} from '@docpresenter/render';
import type { Edit } from '../edit.js';
import {
  formatTable, insertColumn, insertRow, parseClipboardGrid, pasteGrid,
  removeColumn, removeRow, setAlign, setCell, setStyle, setWidth, styleAt,
  type StyleProperty,
} from '../table.js';
import { toggleInline, type InlineMark } from '../inline.js';
import { createToolbar, SWATCHES, type Toolbar } from './toolbar.js';

export interface GridPosition {
  /** -1 is the header row. */
  readonly row: number;
  readonly column: number;
}

export interface GridOptions {
  readonly owner: Document;
  readonly table: TableFile;
  readonly at: GridPosition;
  /** Runs one operation as an edit on the table's file. */
  readonly apply: (make: () => Edit, at: GridPosition) => void;
  /** Tells the host where the selection went, so a redraw can restore it. */
  readonly move: (at: GridPosition) => void;
  /** Leaves the grid and shows the source instead. */
  readonly showSource: () => void;
}

const ALIGN_CLASS: Readonly<Record<Align, string>> = {
  left: 'dp-align-left', center: 'dp-align-center', right: 'dp-align-right', default: '',
};

/**
 * The targets a style can be applied to, as the file's own selectors. A cell
 * is named by its row and column and a single row by a range over itself, so a
 * rule keeps pointing at the same thing when the rows move.
 */
const TARGETS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'cell', label: 'このセル' },
  { id: 'row', label: 'この行' },
  { id: 'column', label: 'この列' },
  { id: 'header', label: 'ヘッダ' },
  { id: 'odd', label: '奇数行' },
  { id: 'even', label: '偶数行' },
];

/** Pale enough to read black text on, for filling a cell. */
const FILL_SWATCHES: readonly [string, string][] = [
  ['#fde8e8', '赤'], ['#e3f0fb', '青'], ['#e6f4e9', '緑'],
  ['#fdf0d5', '黄'], ['#f0e8f7', '紫'], ['#eceef1', '灰'],
];

export function createGrid(options: GridOptions): HTMLElement {
  const { owner, table } = options;
  const columns = table.columns.length;

  // One text box, always focused, sitting over the selected cell. A cell that
  // is merely focusable cannot take IME input: composing Japanese needs
  // somewhere to compose into from the very first keystroke, and a grid where
  // the first character of every Japanese word is swallowed is unusable.
  let at = options.at;
  let editing = false;
  let repaintStyle: () => void = () => {};
  let target = 'cell';
  const nodes = new Map<string, HTMLElement>();
  const input = owner.createElement('input');
  input.className = 'dp-grid-input';
  input.spellcheck = false;

  // A cell holds inline Markdown, so the same bar that formats prose formats a
  // cell. It appears only while a cell is open: with nothing being edited
  // there is no selection for it to act on.
  const toolbar: Toolbar = createToolbar(owner, applyInline);
  toolbar.element.hidden = true;

  const root = owner.createElement('div');
  root.className = 'dp-grid';
  root.append(createBar(), createStyleBar(), toolbar.element, createTable());
  root.addEventListener('paste', onPaste);
  wireInput();
  queueMicrotask(() => place(at));
  return root;

  function element(tag: string, className: string): HTMLElement {
    const node = owner.createElement(tag);
    node.className = className;
    return node;
  }

  function key(position: GridPosition): string {
    return `${position.row},${position.column}`;
  }

  function createTable(): HTMLElement {
    const grid = owner.createElement('table');
    grid.className = 'dp-grid-table';

    const head = owner.createElement('thead');
    const headRow = owner.createElement('tr');
    table.columns.forEach((column, c) => {
      const node = cellNode('th', column.header, -1, c, 1, 1, column.align, undefined);
      const width = table.style.find(r =>
        r.selector.kind === 'column' && r.selector.name === column.header,
      )?.declarations.get('width');
      if (width !== undefined) node.style.width = width;
      addResizeHandle(node, c);
      headRow.append(node);
    });
    head.append(headRow);

    const tbody = owner.createElement('tbody');
    table.rows.forEach((row, r) => {
      const line = owner.createElement('tr');
      line.className = rowClasses(table, r).join(' ');
      for (const cell of row.cells) {
        line.append(cellNode(
          'td', cell.text, r, cell.column, cell.rowspan, cell.colspan,
          table.columns[cell.column]?.align ?? 'default', cell,
        ));
      }
      tbody.append(line);
    });

    grid.append(head, tbody);
    return grid;
  }

  function cellNode(
    tag: 'th' | 'td', text: string, row: number, column: number,
    rowspan: number, colspan: number, align: Align, cell: Cell | undefined,
  ): HTMLElement {
    // The grid wears the same style classes the printed table will, so a fill
    // or a rule can be seen the moment it is applied.
    const rules = cell ? cellRules(table, cell, row) : headerRules(table);
    const styles = cell ? cellClasses(table, cell, row) : headerClasses(table);
    const node = element(tag, ['dp-grid-cell', ALIGN_CLASS[align], ...styles].join(' '));
    const colours = inlineStyle(rules);
    if (colours !== '') node.setAttribute('style', colours);
    const label = element('span', 'dp-grid-text');
    label.textContent = text;
    node.append(label);
    node.dataset['row'] = String(row);
    node.dataset['column'] = String(column);
    if (rowspan > 1) node.setAttribute('rowspan', String(rowspan));
    if (colspan > 1) node.setAttribute('colspan', String(colspan));
    nodes.set(key({ row, column }), node);

    node.addEventListener('mousedown', event => {
      // The browser would otherwise move focus off the text box we rely on.
      event.preventDefault();
      if (editing) commit({ row, column });
      else place({ row, column });
    });
    node.addEventListener('dblclick', () => startEditing(''));
    return node;
  }

  function textOf(position: GridPosition): string {
    if (position.row < 0) return table.columns[position.column]?.header ?? '';
    return cellAt(table, position.row, position.column)?.text ?? '';
  }

  /** Puts the selection, and the text box, on a cell. */
  function place(next: GridPosition): void {
    const wanted = clamp(next);
    const owning = wanted.row < 0 ? undefined : cellAt(table, wanted.row, wanted.column);
    const resolved = owning ? { row: owning.row, column: owning.column } : wanted;

    nodes.get(key(at))?.classList.remove('dp-grid-at', 'dp-grid-editing');
    at = resolved;
    editing = false;
    input.value = '';
    toolbar.element.hidden = true;
    repaintStyle();

    const node = nodes.get(key(at));
    if (!node) return;
    node.classList.add('dp-grid-at');
    node.append(input);
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
      else if (editing) toolbar.sync(input.value, input.selectionStart ?? 0, input.selectionEnd ?? 0);
    });
    input.addEventListener('select', () => {
      if (editing) toolbar.sync(input.value, input.selectionStart ?? 0, input.selectionEnd ?? 0);
    });
    input.addEventListener('blur', () => { if (editing) commit(at); });

    input.addEventListener('keydown', event => {
      event.stopPropagation();
      // While composing, every key belongs to the IME.
      if (event.isComposing) return;
      const step = (row: number, column: number): void => {
        event.preventDefault();
        if (editing) commit({ row, column });
        else place({ row, column });
      };

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
          return step(at.row - 1, at.column);
        case 'ArrowDown':
          if (editing) return;
          return step(at.row + 1, at.column);
        case 'ArrowLeft':
          if (editing) return;
          return step(at.row, at.column - 1);
        case 'ArrowRight':
          if (editing) return;
          return step(at.row, at.column + 1);
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
      case 'odd': return { kind: 'row', which: 'odd' };
      case 'even': return { kind: 'row', which: 'even' };
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
    choose.title = 'スタイルを付ける対象';
    for (const option of TARGETS) {
      const node = owner.createElement('option');
      node.value = option.id;
      node.textContent = option.label;
      choose.append(node);
    }
    choose.value = target;
    choose.addEventListener('change', () => { target = choose.value; paint(); });
    bar.append(choose);

    const swatches: { property: StyleProperty; value: string; node: HTMLButtonElement }[] = [];

    const set = (property: StyleProperty, value: string | undefined): void => {
      const which = selector();
      if (!which) return;
      // Pressing the colour already applied takes it off.
      const next = value !== undefined && styleAt(table, which, property) === value
        ? undefined : value;
      options.apply(() => setStyle(table, which, property, next), at);
    };

    const group = (
      property: StyleProperty, label: string, colours: readonly [string, string][],
    ): void => {
      const name = element('span', 'dp-grid-label');
      name.textContent = label;
      bar.append(name);

      for (const [colour, title] of colours) {
        const node = owner.createElement('button');
        node.type = 'button';
        node.className = 'dp-grid-swatch';
        node.title = `${label}: ${title}`;
        node.style.setProperty('--swatch', colour);
        node.addEventListener('mousedown', event => { event.preventDefault(); set(property, colour); });
        swatches.push({ property, value: colour, node });
        bar.append(node);
      }

      const picker = owner.createElement('input');
      picker.type = 'color';
      picker.className = 'dp-grid-picker';
      picker.title = `${label}を選ぶ`;
      picker.value = property === 'fill' ? '#fde8e8' : '#c62828';
      picker.addEventListener('input', () => set(property, picker.value));
      bar.append(picker);

      const clear = owner.createElement('button');
      clear.type = 'button';
      clear.className = 'dp-grid-clear';
      clear.textContent = '×';
      clear.title = `${label}を外す`;
      clear.addEventListener('mousedown', event => { event.preventDefault(); set(property, undefined); });
      bar.append(clear);
    };

    group('fill', '塗り', FILL_SWATCHES);
    bar.append(element('span', 'dp-grid-divider'));
    group('color', '文字色', SWATCHES);

    function paint(): void {
      const which = selector();
      for (const { property, value, node } of swatches) {
        const on = which !== undefined
          && (styleAt(table, which, property) ?? '').toLowerCase() === value.toLowerCase();
        node.setAttribute('aria-pressed', String(on));
        node.disabled = which === undefined;
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
    handle.title = 'ドラッグして列幅を決める';
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

  function onPaste(event: ClipboardEvent): void {
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

    add('行＋', '選択している行の下に追加', () =>
      options.apply(() => insertRow(table, Math.max(0, at.row) + 1), here()));
    add('行−', '選択している行を削除', () =>
      options.apply(() => removeRow(table, Math.max(0, at.row)), here()));
    add('列＋', '選択している列の右に追加', () =>
      options.apply(() => insertColumn(table, at.column + 1, ''), { row: at.row, column: at.column + 1 }));
    add('列−', '選択している列を削除', () =>
      options.apply(() => removeColumn(table, at.column), { row: at.row, column: Math.max(0, at.column - 1) }));

    bar.append(element('span', 'dp-grid-divider'));
    const aligns: [Align, string, string][] = [
      ['left', '左', '左寄せ'], ['center', '中', '中央'], ['right', '右', '右寄せ'],
    ];
    for (const [align, label, title] of aligns) {
      add(label, `${title}（列全体）`, () =>
        options.apply(() => setAlign(table, at.column, align), here()));
    }

    bar.append(element('span', 'dp-grid-divider'));
    add('整形', 'グリッドの桁を揃える（明示的に実行したときだけ）', () =>
      options.apply(() => formatTable(table), here()));
    add('ソース', '.table のソースを直接編集する', () => options.showSource());
    return bar;
  }
}
