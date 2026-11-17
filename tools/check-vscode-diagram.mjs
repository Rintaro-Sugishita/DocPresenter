// The DocPresenter Diagram canvas, without VS Code.
//
// The extension's screen (media/canvas.js) is loaded in a real browser with
// `acquireVsCodeApi` standing in for the bridge. What is checked is the
// contract with the host: it asks for the drawing, draws it, sends a gesture
// back as one byte range of the text it was drawing, and says why when the
// text cannot be read.
//
// Usage: node tools/check-vscode-diagram.mjs [--chromium <path>]   (after npm run build:vscode)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { findChromium } from './pdf-writer.mjs';

const at = process.argv.indexOf('--chromium');
const executablePath = at < 0 ? findChromium() : process.argv[at + 1];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

const media = resolve('packages/app-vscode-diagram/media');
mkdirSync('out', { recursive: true });
const pagePath = resolve('out/check-vscode-diagram.html');
writeFileSync(pagePath, `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(`${media}/theme.css`)}"></head>
<body><div id="status"></div><div id="canvas"></div>
<script>window.sent = []; window.acquireVsCodeApi = () => ({ postMessage: m => window.sent.push(m) });</script>
<script src="${pathToFileURL(`${media}/canvas.js`)}"></script></body></html>`);

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', e => check('画面でエラーが起きない', false, e.message));
await page.goto(pathToFileURL(pagePath).href);
await page.waitForTimeout(300);
const sent = () => page.evaluate(() => window.sent);

check('開くと、まず図を求める', JSON.stringify(await sent()) === '[{"kind":"ready"}]');

const source = readFileSync('sample/shared/system-architecture.dgm', 'utf8');
await page.evaluate(text => window.postMessage({ kind: 'open', source: text, libraries: {}, locale: 'ja' }, '*'), source);
await page.waitForTimeout(400);
check('図が描かれる', await page.locator('svg.dp-diagram').count() === 1);
const fill = await page.locator('[data-node="api"] rect').first().evaluate(el => getComputedStyle(el).fill);
check('テーマの見た目で描かれる（黒く塗りつぶさない）', fill === 'rgb(255, 255, 255)', fill);

// 拡大: ボタンで大きくなり、そのまま図形を動かせる。
const widthBefore = (await page.locator('svg.dp-diagram').boundingBox()).width;
await page.locator('.dp-canvas-view').hover({ position: { x: 20, y: 20 } });
for (let i = 0; i < 3; i += 1) await page.click('.dp-zoom-in', { force: true });
await page.waitForTimeout(200);
const widthAfter = (await page.locator('svg.dp-diagram').boundingBox()).width;
check('キャンバスもボタンで拡大できる', widthAfter > widthBefore * 1.2, `${Math.round(widthBefore)} → ${Math.round(widthAfter)}`);
await page.locator('[data-node="api"]').first().scrollIntoViewIfNeeded();

const box = await page.locator('[data-node="api"]').first().boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
const edit = (await sent()).find(one => one.kind === 'edit');
const bytes = Buffer.from(source);
check('動かすと、その図形のピンの 1 行だけが書き換えとして届く',
  edit !== undefined && edit.base === source
  && bytes.subarray(edit.start, edit.end).toString() === 'api     @ (460, 120) 140x60'
  && /^api +@ \(\d+, +\d+\) 140x60$/.test(edit.text),
  edit && JSON.stringify(edit.text));

const outline = await page.locator('.dp-canvas-outline').first().boundingBox();
const shape = await page.locator('[data-node="api"] rect').first().boundingBox();
check('　拡大していても、選択の枠は図形に重なる',
  outline && shape && Math.abs(outline.x - shape.x) < 12 && Math.abs(outline.width - shape.width) < 16,
  JSON.stringify([outline, shape]));

await page.evaluate(() => window.postMessage({ kind: 'update', source: 'free {\n  a [A\n}\n', libraries: {}, locale: 'ja' }, '*'));
await page.waitForTimeout(200);
const status = await page.textContent('#status');
check('読めない文になったら、理由を言い、前の絵は残す',
  /2 行目/.test(status) && await page.locator('svg.dp-diagram').count() === 1, status);

// --- VS Code の配色に従う --------------------------------------------------------
{
  const dark = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  dark.on('pageerror', e => check('画面でエラーが起きない（暗い配色）', false, e.message));
  await dark.goto(pathToFileURL(pagePath).href);
  await dark.evaluate(() => { document.body.className = 'vscode-dark'; });
  await dark.waitForTimeout(100);
  await dark.evaluate(([text, theme]) => window.postMessage({ kind: 'open', source: text, libraries: {}, locale: 'ja', theme }, '*'),
    [source, readFileSync(`${media}/theme.css`, 'utf8')]);
  await dark.waitForTimeout(400);
  const luminance = rgb => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return (r + g + b) / 3; };
  const paper = await dark.$eval('#canvas', el => getComputedStyle(el).backgroundColor);
  const label = await dark.locator('svg.dp-diagram .dp-label').first().evaluate(el => getComputedStyle(el).fill);
  check('VS Code が暗い配色なら、紙も暗くなる', luminance(paper) < 80, paper);
  check('　図の文字は明るくなる', luminance(label) > 160, label);
  await dark.evaluate(() => { document.body.className = 'vscode-light'; });
  await dark.waitForTimeout(100);
  const light = await dark.$eval('#canvas', el => getComputedStyle(el).backgroundColor);
  check('明るい配色に戻せば紙も白に戻る', light === 'rgb(255, 255, 255)', light);
  await dark.close();
}

await browser.close();
