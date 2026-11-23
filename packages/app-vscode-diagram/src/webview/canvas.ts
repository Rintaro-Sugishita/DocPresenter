// The canvas screen, inside VS Code's WebView. It draws the drawing with the
// canvas of @docpresenter/diagram and sends each gesture back as a byte range;
// the host writes it, and the text is the only state there is.

import {
  applyEdit, BASE_STYLE, describeError, followColourScheme, localizeEdit, PRINT_CLASS, useDarkStyle, type Locale,
} from '@docpresenter/base';
import { createCanvas, DIAGRAM_STYLE, parseDiagram, withParts } from '@docpresenter/diagram';
import type { FromCanvas, ToCanvas } from '../protocol.js';
import { takesFocus } from './focus.js';

declare function acquireVsCodeApi(): { postMessage(message: FromCanvas): void };

const host = acquireVsCodeApi();
const stage = document.getElementById('canvas')!;
const status = document.getElementById('status')!;

const style = document.createElement('style');
style.textContent = [
  BASE_STYLE, DIAGRAM_STYLE,
  // The drawing is drawn on paper: it is the picture a document will print.
  // On a dark VS Code the paper goes dark too, made from these same rules.
  'body { margin: 0; padding: 16px; background: #f3f4f6; color: #1c1f24; }',
  '#canvas { background: #fff; padding: 12px; border-radius: 4px; display: inline-block; min-width: 320px; }',
  '#status { font: 12px system-ui, sans-serif; color: #b3261e; margin-bottom: 8px; min-height: 1em; }',
].join('\n');
document.head.append(style);
// Light or dark as VS Code's colour theme is; the theme's own rules follow on `open`.
followColourScheme(document, 'vscode');
useDarkStyle(document, 'canvas', style.textContent);

// The bar and the page follow the theme; the drawing does not. A screen is
// drawn in its parts' own colours, which stay as the author chose them, and
// turning only the rest round left white boxes, black boxes and a dark bar
// across a white table on one picture. The drawing is the paper a document
// prints, so it stays paper. Written after the dark rules, and not made dark.
const paper = document.createElement('style');
paper.textContent = [
  `html .dp-canvas-view.${PRINT_CLASS} {`,
  '  background: #fff; color: #1c1f24; color-scheme: light; border-radius: 3px;',
  '}',
  // VS Code paints the scroll bars of a WebView in its own theme's colours.
  `.dp-canvas-view.${PRINT_CLASS} ::-webkit-scrollbar-corner { background: transparent; }`,
  `.dp-canvas-view.${PRINT_CLASS} ::-webkit-scrollbar-thumb { background-color: rgba(100, 100, 100, 0.4); }`,
  `.dp-canvas-view.${PRINT_CLASS} ::-webkit-scrollbar-thumb:hover { background-color: rgba(100, 100, 100, 0.7); }`,
].join('\n');

let source = '';
let libraries: Readonly<Record<string, string>> = {};
let itemTable = '';
let locale: Locale = 'ja';
let picked: readonly string[] = [];
let edge: string | undefined;

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
    close: () => { picked = []; edge = undefined; draw(); },
    onError: message => host.postMessage({ kind: 'error', message }),
  });
  // Asked before the old canvas leaves the page and takes the focus with it.
  const canvasFocused = stage.contains(document.activeElement);
  stage.replaceChildren(canvas.element);
  canvas.element.querySelector('.dp-canvas-view')?.classList.add(PRINT_CLASS);
  if (takesFocus({ pageFocused: document.hasFocus(), canvasFocused, first })) canvas.focus();
}

window.addEventListener('message', (event: MessageEvent<ToCanvas>) => {
  const message = event.data;
  source = message.source;
  libraries = message.libraries;
  itemTable = message.itemTable;
  locale = message.locale;
  if (message.theme !== undefined) useDarkStyle(document, 'theme', message.theme);
  // Last, so it is read after the dark rules it keeps off the drawing.
  document.head.append(paper);
  draw(message.kind === 'open');
});

host.postMessage({ kind: 'ready' });
