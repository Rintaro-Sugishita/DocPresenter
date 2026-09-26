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
import { cellClasses, headerClasses, rowClasses } from '@docpresenter/render';
import type { Edit } from '../edit.js';
import {
  formatTable, insertColumn, insertRow, parseClipboardGrid, pasteGrid,
  removeColumn, removeRow, setAlign, setCell, setStyle, styleAt,
  type StyleProperty,
} from '../table.js';

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

/** Meaning tokens first, then the ones that only group. Never a literal colour. */
const FILLS: readonly [string, string][] = [
  ['changed', '変更'], ['pending', '要確認'], ['disabled', '対象外'], ['removed', '削除予定'],
  ['shade', '網掛け'], ['tint-1', '区分 1'], ['tint-2', '区分 2'],
];

const RULES: readonly [StyleProperty, string, string, string][] = [
  ['bottom', 'thick', '下太', '下の罫線を太く'],
  ['bottom', 'double', '下二重', '下の罫線を二重に'],
  ['right', 'thick', '右太', '右の罫線を太く'],
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

  const root = owner.createElement('div');
  root.className = 'dp-grid';
  root.append(createBar(), createStyleBar(), createTable());
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
      headRow.append(cellNode('th', column.header, -1, c, 1, 1, column.align, undefined));
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
    const styles = cell ? cellClasses(table, cell, row) : headerClasses(table);
    const node = element(tag, ['dp-grid-cell', ALIGN_CLASS[align], ...styles].join(' '));
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

    const buttons: { property: StyleProperty; value: string; node: HTMLButtonElement }[] = [];
    const add = (
      property: StyleProperty, value: string, label: string, title: string, className: string,
    ): void => {
      const node = owner.createElement('button');
      node.type = 'button';
      node.className = className;
      node.textContent = label;
      node.title = title;
      node.addEventListener('mousedown', event => {
        event.preventDefault();
        const which = selector();
        if (!which) return;
        // Pressing the one already applied takes it off.
        const next = styleAt(table, which, property) === value ? undefined : value;
        options.apply(() => setStyle(table, which, property, next), at);
      });
      buttons.push({ property, value, node });
      bar.append(node);
    };

    for (const [token, label] of FILLS) {
      add('fill', token, label, `塗りつぶし: ${token}`, `dp-grid-fill dp-token-${token}`);
    }
    bar.append(element('span', 'dp-grid-divider'));
    for (const [property, value, label, title] of RULES) add(property, value, label, title, '');

    function paint(): void {
      const which = selector();
      for (const { property, value, node } of buttons) {
        const on = which !== undefined && styleAt(table, which, property) === value;
        node.setAttribute('aria-pressed', String(on));
        node.disabled = which === undefined;
      }
    }
    paint();
    repaintStyle = paint;
    return bar;
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
