// The canvas screen, inside VS Code's WebView. It draws the drawing with the
// canvas of @docpresenter/diagram and sends each gesture back as a byte range;
// the host writes it, and the text is the only state there is.

import {
  applyEdit, BASE_STYLE, describeError, followColourScheme, localizeEdit, useDarkStyle, type Locale,
} from '@docpresenter/base';
import {
  createCanvas, DIAGRAM_STYLE, parseDiagram, pickAt, rememberSource, useItemSettings, withParts,
} from '@docpresenter/diagram';
import { createGrid, EDITOR_STYLE, type Grid, type GridPosition } from '@docpresenter/editor';
import { parseTable } from '@docpresenter/markdown';
import type { FromCanvas, ToCanvas } from '../protocol.js';
import { takesFocus } from './focus.js';

declare function acquireVsCodeApi(): {
  postMessage(message: FromCanvas): void;
  getState?(): { items?: ItemsSide } | undefined;
  setState?(state: { items?: ItemsSide }): void;
};
/** Where the screen's item table is shown beside it, or not at all. */
type ItemsSide = 'below' | 'right' | 'none';

const host = acquireVsCodeApi();
const stage = document.getElementById('canvas')!;
const status = document.getElementById('status')!;

const style = document.createElement('style');
style.textContent = [
  BASE_STYLE, DIAGRAM_STYLE, EDITOR_STYLE,
  // The drawing is drawn on paper: it is the picture a document will print.
  // On a dark VS Code the paper goes dark too, made from these same rules.
  // The theme is a document's, and keeps a page of text to a reading width;
  // a drawing and its item table use the whole window.
  'body { margin: 0; padding: 16px; background: #f3f4f6; color: #1c1f24; max-width: none; }',
  '#canvas { background: #fff; padding: 12px; border-radius: 4px; display: inline-block; min-width: 320px; }',
  '#status { font: 12px system-ui, sans-serif; color: #b3261e; margin-bottom: 8px; min-height: 1em; }',
  // The screen and its item table, side by side or one over the other.
  '.dp-with-items { display: flex; gap: 16px; align-items: flex-start; }',
  '.dp-with-items.dp-items-below { flex-direction: column; }',
  '.dp-with-items.dp-items-right { width: calc(100vw - 72px); }',
  '.dp-with-items.dp-items-right > .dp-canvas { flex: 3 1 0; min-width: 0; }',
  '.dp-with-items.dp-items-right > .dp-items-pane { flex: 2 1 0; }',
  '.dp-items-pane { background: #fff; border-radius: 4px; padding: 8px 12px; min-width: 320px; max-width: 100%; overflow: auto; font: 13px system-ui, sans-serif; }',
  '.dp-items-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; color: #3a4048; }',
  '.dp-items-head strong { font-weight: 600; margin-right: auto; }',
  '.dp-items-head button { border: 1px solid #d3d7dd; background: #f7f8fa; color: #3a4048; border-radius: 3px; padding: 0.2em 0.6em; font: inherit; font-size: 12px; cursor: pointer; }',
  '.dp-items-head button.dp-on { background: #dce6f2; border-color: #9cb4d0; }',
  '.dp-items-shown { margin-top: 8px; font: 12px system-ui, sans-serif; }',
].join('\n');
document.head.append(style);
// Light or dark as VS Code's colour theme is; the theme's own rules follow on `open`.
followColourScheme(document, 'vscode');
useDarkStyle(document, 'canvas', style.textContent);

// The drawing goes dark with the rest, as it does in a document on screen:
// a drawing that stays white in a dark window glares. Only what is printed or
// exported keeps the light colours (`dp-print` on the page measured for it).

let source = '';
let libraries: Readonly<Record<string, string>> = {};
let itemTable = '';
let locale: Locale = 'ja';
let picked: readonly string[] = [];
let pictures: Readonly<Record<string, string>> = {};
/** The questions for a picture still waiting for the author, by their number. */
const asking = new Map<number, (path: string | undefined) => void>();
let asked = 0;
let edge: string | undefined;
/** The item table beside the screen: where it is shown, and where its selection was. */
let itemsSide: ItemsSide = host.getState?.()?.items ?? 'below';
let itemsAt: GridPosition = { row: 0, column: 0 };
let itemsTarget = 'cell';
let itemsGrid: Grid | undefined;

function draw(first = false): void {
  let file;
  try {
    file = withParts(parseDiagram(source), path => libraries[path]);
  } catch (error) {
    // A drawing being typed is often unreadable for a moment. The last picture
    // stays, and the reason is said above it.
    status.textContent = describeError(error, locale);
    return;
  }
  status.textContent = '';
  const canvas = createCanvas({
    owner: document,
    file,
    source,
    selected: picked,
    selectedEdge: edge,
    locale,
    itemSource: file.itemTable === undefined ? undefined : libraries[file.itemTable.path],
    newItemTable: {
      path: itemTable,
      // Kept in hand as well as sent, so the screen is drawn with its table
      // the moment the line naming it lands; one already there is used as is.
      create: text => {
        if (libraries[itemTable] !== undefined) return undefined;
        libraries = { ...libraries, [itemTable]: text };
        host.postMessage({ kind: 'create', path: itemTable, text });
        return undefined;
      },
    },
    apply: (make, selected, line) => {
      picked = selected;
      edge = line;
      try {
        const made = localizeEdit(make(), locale);
        // A label renamed on the screen may rename its item in the table too:
        // two files, each written as its own edit.
        for (const change of made.also ? [made, made.also] : [made]) {
          const path = change.path;
          // An edit to the item table is written to the table; the drawing is
          // drawn again from the table as it will be.
          const base = path === undefined ? source : libraries[path] ?? '';
          if (path === undefined) source = applyEdit(source, change);
          else libraries = { ...libraries, [path]: applyEdit(base, change) };
          host.postMessage({
            kind: 'edit', start: change.span.start, end: change.span.end, text: change.text, base,
            ...(path === undefined ? {} : { path }),
          });
        }
      } catch (error) {
        host.postMessage({ kind: 'error', message: describeError(error, locale) });
      }
      draw();
    },
    select: (ids, line) => { picked = ids; edge = line; },
    showSource: () => host.postMessage({ kind: 'source' }),
    // Where the screen's item table is shown: the same three as the buttons over it.
    drawingMenu: () => {
      if (file.itemTable === undefined || libraries[file.itemTable.path] === undefined) return [];
      const say = (ja: string, en: string): string => (locale === 'ja' ? ja : en);
      const choices: [ItemsSide, string][] = [
        ['below', say('項目一覧を下に表示', 'Show the item table below')],
        ['right', say('項目一覧を右に表示', 'Show the item table on the right')],
        ['none', say('項目一覧を隠す', 'Hide the item table')],
      ];
      return choices.map(([side, label]) => ({
        label, disabled: side === itemsSide,
        run: () => { itemsSide = side; host.setState?.({ items: side }); draw(); },
      }));
    },
    picture: path => pictures[path],
    pickPicture: () => new Promise(done => {
      const id = ++asked;
      asking.set(id, done);
      host.postMessage({ kind: 'pick-picture', id });
    }),
    close: () => { picked = []; edge = undefined; draw(); },
    onError: message => host.postMessage({ kind: 'error', message }),
  });
  // Asked before the old canvas leaves the page and takes the focus with it.
  const inItems = document.activeElement?.closest('.dp-items-pane') != null;
  const canvasFocused = stage.contains(document.activeElement) && !inItems;
  itemsGrid?.flush();
  itemsGrid = undefined;
  stage.replaceChildren(withItemTable(canvas.element, file.itemTable?.path, inItems));
  if (takesFocus({ pageFocused: document.hasFocus(), canvasFocused, first })) canvas.focus();
}

/**
 * The screen with its item table beside it — under it or to its right, as the
 * author last chose — edited in place: each change to a cell is an edit to
 * the table's file, which the screen is drawn again from.
 */
function withItemTable(canvas: HTMLElement, path: string | undefined, focused: boolean): HTMLElement {
  const text = path === undefined ? undefined : libraries[path];
  if (path === undefined || text === undefined) return canvas;
  const say = (ja: string, en: string): string => (locale === 'ja' ? ja : en);
  const pane = document.createElement('div');
  pane.className = 'dp-items-pane';
  const head = document.createElement('div');
  head.className = 'dp-items-head';
  const title = document.createElement('strong');
  title.textContent = say(`項目一覧（${path}）`, `Item table (${path})`);
  head.append(title);
  const sides: [ItemsSide, string][] = [['below', say('下に表示', 'Below')], ['right', say('右に表示', 'Right')], ['none', say('隠す', 'Hide')]];
  for (const [side, label] of sides) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.classList.toggle('dp-on', side === itemsSide);
    button.addEventListener('click', () => {
      itemsSide = side;
      host.setState?.({ items: side });
      draw();
    });
    head.append(button);
  }
  pane.append(head);
  const wrap = document.createElement('div');
  wrap.className = `dp-with-items dp-items-${itemsSide === 'right' ? 'right' : 'below'}`;
  if (itemsSide === 'none') {
    // Hidden, the buttons stay: a way back under the screen.
    pane.classList.add('dp-items-shown');
    pane.replaceChildren(head);
    wrap.append(canvas, pane);
    return wrap;
  }
  let table;
  try {
    table = parseTable(text);
  } catch (error) {
    const note = document.createElement('p');
    note.textContent = describeError(error, locale);
    pane.append(note);
    wrap.append(canvas, pane);
    return wrap;
  }
  itemsGrid = createGrid({
    owner: document, table, source: text, at: itemsAt, target: itemsTarget, locale,
    takeFocus: focused,
    apply: (make, next) => {
      itemsAt = next;
      try {
        const made = localizeEdit(make(), locale);
        const base = libraries[path] ?? '';
        libraries = { ...libraries, [path]: applyEdit(base, made) };
        host.postMessage({ kind: 'edit', start: made.span.start, end: made.span.end, text: made.text, base, path });
      } catch (error) {
        host.postMessage({ kind: 'error', message: describeError(error, locale) });
      }
      draw();
    },
    move: next => { itemsAt = next; },
    onTarget: next => { itemsTarget = next; },
    showSource: () => host.postMessage({ kind: 'open-file', path }),
  });
  pane.append(itemsGrid.element);
  wrap.append(canvas, pane);
  return wrap;
}

window.addEventListener('message', (event: MessageEvent<ToCanvas>) => {
  const message = event.data;
  if (message.kind === 'cursor') {
    // Typing on the canvas is not followed back: only a cursor moved in the text.
    if (document.hasFocus() && stage.contains(document.activeElement)) return;
    let file;
    try { file = rememberSource(parseDiagram(source), source); } catch { return; }
    const found = pickAt(file, message.offset);
    if (!found) return;
    if (found.kind === 'shape') {
      if (edge === undefined && picked.length === 1 && picked[0] === found.id) return;
      picked = [found.id];
      edge = undefined;
    } else {
      if (edge === found.name && picked.length === 0) return;
      picked = [];
      edge = found.name;
    }
    draw();
    return;
  }
    if (message.kind === 'picked') {
    // Held before the shape names it, so it is drawn the moment it does.
    if (message.path !== undefined && message.url !== undefined) pictures = { ...pictures, [message.path]: message.url };
    asking.get(message.id)?.(message.path);
    asking.delete(message.id);
    return;
  }
  source = message.source;
  pictures = message.pictures ?? {};
  // The columns the repository gives an item table, and the headings it reads.
  useItemSettings(message.settings);
  libraries = message.libraries;
  itemTable = message.itemTable;
  locale = message.locale;
  if (message.theme !== undefined) useDarkStyle(document, 'theme', message.theme);
  draw(message.kind === 'open');
});

host.postMessage({ kind: 'ready' });
