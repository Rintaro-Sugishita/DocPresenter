// Builds the drawing tool on its own: a page that opens a `.dgm`, lets it be
// edited, and shows the file as it is written back. Nothing from the document
// side is imported here, so if the drawing package ever grows a dependency on
// the document engine, this page stops building — which is the point of it.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { rolldown } from 'rolldown';

const SOURCE = 'sample/shared/system-architecture.dgm';
const NL = String.fromCharCode(10);

const entry = `
import { applyEdit, BASE_STYLE } from '@docpresenter/base';
import { createCanvas, DIAGRAM_STYLE, parseDiagram } from '@docpresenter/diagram';

let source = ${JSON.stringify(readFileSync(SOURCE, 'utf8'))};
let picked = [];
let edge;
let showing = false;

const style = document.createElement('style');
style.textContent = [BASE_STYLE, DIAGRAM_STYLE].join(String.fromCharCode(10));
document.head.append(style);

const host = document.getElementById('canvas');
const text = document.getElementById('source');
const status = document.getElementById('status');

const draw = () => {
  text.textContent = source;
  if (showing) return;
  let file;
  try {
    file = parseDiagram(source);
  } catch (error) {
    status.textContent = error.message;
    return;
  }
  host.replaceChildren();
  const canvas = createCanvas({
    owner: document,
    file,
    source,
    selected: picked,
    selectedEdge: edge,
    apply: (make, selected, line) => {
      picked = selected;
      edge = line;
      try {
        const change = make();
        source = applyEdit(source, change);
        status.textContent = change.description + '　'
          + change.span.start + '〜' + change.span.end + ' バイトを書き換え';
      } catch (error) {
        status.textContent = error.message;
      }
      draw();
    },
    select: (selected, line) => { picked = selected; edge = line; },
    close: () => {},
    showSource: () => {
      // The drawing tool has no source editor of its own: the page shows the
      // file beside it, which is what a drawing tool for Git users needs.
      text.parentElement.classList.add('dp-shown');
      status.textContent = 'ソースは右側に出ています';
    },
    onError: message => { status.textContent = message; },
  });
  host.append(canvas.element);
  canvas.focus();
};

draw();
`;

mkdirSync('out', { recursive: true });
writeFileSync('out/canvas-entry.js', entry);

const bundle = await rolldown({ input: 'out/canvas-entry.js', platform: 'browser' });
await bundle.write({ file: 'out/canvas-app.js', format: 'iife' });

writeFileSync('out/canvas-app.html', [
  '<!doctype html>',
  '<html lang="ja"><head><meta charset="utf-8">',
  '<title>作図（単独）</title>',
  '<link rel="stylesheet" href="../themes/default/theme.css">',
  '<style>',
  '  html, body { height: 100%; margin: 0; }',
  '  body { display: grid; grid-template-columns: 1fr 24em; font-size: 10.5pt; max-width: none; }',
  '  main { padding: 1.5em; overflow: auto; }',
  '  aside { border-left: 1px solid #c8ccd2; background: #fbfbfc; display: flex;',
  '    flex-direction: column; min-height: 0; font-family: system-ui, sans-serif; font-size: 12px; }',
  '  aside h2 { font-size: 12px; margin: 0; padding: .8em 1em; border-bottom: 1px solid #e2e4e8; }',
  '  #status { padding: .8em 1em; color: #1f5fa8; border-bottom: 1px solid #e2e4e8; min-height: 1.4em; }',
  '  #source { margin: 0; padding: 1em; overflow: auto; white-space: pre-wrap;',
  '    font-family: var(--font-mono, monospace); font-size: 11px; line-height: 1.6; }',
  '</style></head><body>',
  '<main><div id="canvas"></div></main>',
  '<aside><h2>書き戻される .dgm</h2><div id="status"></div><pre id="source"></pre></aside>',
  '<script src="canvas-app.js"></script>',
  '</body></html>',
].join(NL));

console.log('out/canvas-app.html を生成');

// A second copy with everything inlined, for opening from anywhere.
const theme = readFileSync('themes/default/theme.css', 'utf8');
const script = readFileSync('out/canvas-app.js', 'utf8');
const page = readFileSync('out/canvas-app.html', 'utf8')
  .replace('<link rel="stylesheet" href="../themes/default/theme.css">', '<style>' + theme + '</style>')
  .replace('<script src="canvas-app.js"></script>', '<script>' + script + '</script>');
mkdirSync('out/canvas', { recursive: true });
writeFileSync('out/canvas/index.html', page);
console.log('out/canvas/index.html を生成（' + (page.length / 1048576).toFixed(2) + ' MB）');
