// The canvas screen, inside VS Code's WebView. It draws the drawing with the
// canvas of @docpresenter/diagram and sends each gesture back as a byte range;
// the host writes it, and the text is the only state there is.

import { applyEdit, BASE_STYLE, describeError, localizeEdit, type Locale } from '@docpresenter/base';
import { createCanvas, DIAGRAM_STYLE, parseDiagram, withParts } from '@docpresenter/diagram';
import type { FromCanvas, ToCanvas } from '../protocol.js';

declare function acquireVsCodeApi(): { postMessage(message: FromCanvas): void };

const host = acquireVsCodeApi();
const stage = document.getElementById('canvas')!;
const status = document.getElementById('status')!;

const style = document.createElement('style');
style.textContent = [
  BASE_STYLE, DIAGRAM_STYLE,
  // The drawing is drawn on paper whatever VS Code's colours are: it is the
  // picture a document will print.
  'body { margin: 0; padding: 16px; background: #f3f4f6; color: #1c1f24; }',
  '#canvas { background: #fff; padding: 12px; border-radius: 4px; display: inline-block; min-width: 320px; }',
  '#status { font: 12px system-ui, sans-serif; color: #b3261e; margin-bottom: 8px; min-height: 1em; }',
].join('\n');
document.head.append(style);

let source = '';
let libraries: Readonly<Record<string, string>> = {};
let locale: Locale = 'ja';
let picked: readonly string[] = [];
let edge: string | undefined;

function draw(): void {
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
    apply: (make, selected, line) => {
      picked = selected;
      edge = line;
      try {
        const change = localizeEdit(make(), locale);
        const base = source;
        source = applyEdit(source, change);
        host.postMessage({ kind: 'edit', start: change.span.start, end: change.span.end, text: change.text, base });
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
  stage.replaceChildren(canvas.element);
  canvas.focus();
}

window.addEventListener('message', (event: MessageEvent<ToCanvas>) => {
  const message = event.data;
  source = message.source;
  libraries = message.libraries;
  locale = message.locale;
  draw();
});

host.postMessage({ kind: 'ready' });
