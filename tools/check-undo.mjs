// Undo and redo, in the VS Code shell's real screen.
//
// VS Code's own undo knows only the document on screen. A drawing or a table
// is written to a file of its own, so taking back a shape that was deleted is
// the editor's job. What matters: the file comes back byte for byte, the edit
// that does it is one byte range like any other, a file changed by somebody
// else is not overwritten, and a text box keeps its own Ctrl+Z.
//
// Usage: node tools/check-undo.mjs [--chromium <path>]
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { replaceBytes, toLf } from '../packages/base/dist/index.js';
import { findChromium } from './pdf-writer.mjs';

const option = name => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

const files = {};
(function collect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) { collect(path); continue; }
    if (/\.(dgm|table|ermlx|mmd|md)$/i.test(entry.name)) {
      files[relative('sample', path).split('\\').join('/')] = toLf(readFileSync(path, 'utf8'));
    }
  }
})('sample');
const DOC = 'docs/auth-design.md';
const FLOW = 'docs/auth-design/login-flow.dgm';
const ITEMS = 'docs/auth-design/screen-items.table';
const original = { ...files };

mkdirSync('out', { recursive: true });
writeFileSync('out/vscode-undo.html', `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="../packages/app-vscode/media/theme.css">
<style>html, body { height: 100%; margin: 0; max-width: none; }</style>
</head><body>
<div id="editor"></div>
<script>
  window.__sent = [];
  window.__forwarded = [];
  // VS Code listens on the window for the keys a webview leaves alone.
  window.addEventListener('keydown', e => { if (e.ctrlKey) window.__forwarded.push(e.key); });
  window.acquireVsCodeApi = () => ({ postMessage: m => window.__sent.push(m), getState: () => window.__state, setState: s => { window.__state = s; } });
</script>
<script src="../packages/app-vscode/media/webview.js"></script>
</body></html>
`);

const browser = await chromium.launch({ executablePath: findChromium(option('--chromium')) });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', error => { console.log('✗ ページエラー:', error.message); process.exitCode = 1; });
await page.goto(pathToFileURL(resolve('out/vscode-undo.html')).href);
await page.waitForTimeout(300);

await page.evaluate(([path, source, all]) => {
  window.postMessage({ kind: 'open', path, source, files: all, images: {}, commitKey: 'ctrl-enter', locale: 'ja' }, '*');
}, [DOC, files[DOC], files]);
await page.waitForTimeout(800);

/** Takes what the screen sent and writes it into `files`, as the extension would. */
const take = async () => {
  const sent = await page.evaluate(() => window.__sent.splice(0));
  for (const one of sent) {
    if (one.kind !== 'change') continue;
    const path = one.path ?? DOC;
    files[path] = replaceBytes(files[path], one.span.start, one.span.end, one.text);
  }
  return sent;
};
const press = async key => { await page.keyboard.press(key); await page.waitForTimeout(400); };
/** Delete, and say yes when it asks about the lines that go with the shape. */
const remove = async () => {
  await press('Delete');
  const confirm = page.locator('.dp-menu button', { hasText: '削除' });
  if (await confirm.count() > 0) { await confirm.first().click(); await page.waitForTimeout(400); }
};
const tabs = () => page.locator('.dp-tab:not(.dp-tab-add)').allInnerTexts();

// --- 1. 文書そのもの（シート名） ---------------------------------------------
await page.locator('.dp-tab:not(.dp-tab-add)').nth(1).dblclick();
await page.locator('.dp-tab-rename').fill('構成');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
await take();
check('改名が書かれる', files[DOC].includes('## 構成 {#sec-architecture}'));
await page.locator('.dp-tabbar').click({ position: { x: 2, y: 2 } }).catch(() => {});
await press('Control+z');
let sent = await take();
check('Ctrl+Z で文書が元に戻る', files[DOC] === original[DOC]);
check('戻す編集も 1 つのバイト範囲', sent.length === 1 && sent[0].kind === 'change' && sent[0].text === 'システム',
  JSON.stringify(sent.map(one => [one.kind, one.text])));
check('説明に何を取り消したかが出る', sent[0]?.description?.startsWith('取り消し:'), sent[0]?.description);
check('タブも元の名前', (await tabs())[1].includes('システム構成'), (await tabs())[1].split('\n')[0]);
check('VS Code には渡さない（文書が二重に戻らない）', !(await page.evaluate(() => window.__forwarded)).includes('z'));
await press('Control+y');
await take();
check('Ctrl+Y でやり直せる', files[DOC].includes('## 構成 {#sec-architecture}'));
await press('Control+z');
await take();

// --- 2. 図（別のファイル） ---------------------------------------------------
await page.click('.dp-tab[data-index="3"]');
await page.waitForTimeout(300);
await page.locator(`.dp-sheet:not([hidden]) .dp-figure[data-path$="login-flow.dgm"] .dp-figure-body`).click();
await page.waitForTimeout(400);
await page.click('.dp-canvas-stage [data-node="home"]');
await page.waitForTimeout(200);
await remove();
await take();
check('図形を消すと .dgm から消える', !files[FLOW].includes('home     [マイページ]'));
check('図形が画面から消える', !(await page.$('.dp-canvas-stage [data-node="home"]')));
await press('Control+z');
sent = await take();
check('Ctrl+Z で .dgm がバイト単位で元どおり', files[FLOW] === original[FLOW]);
check('戻す編集は .dgm に宛てる', sent.length === 1 && sent[0].path === FLOW, sent.map(one => one.path).join(','));
check('図形が画面に戻る', !!(await page.$('.dp-canvas-stage [data-node="home"]')));
check('キャンバスは開いたまま', !!(await page.$('.dp-sheet:not([hidden]) .dp-canvas')));

// 2 つ続けて戻す
await page.click('.dp-canvas-stage [data-node="error"]');
await press('ArrowRight');
sent = await take();
check('矢印で動かすとピンが書かれる', /error +@/.test(files[FLOW]), JSON.stringify(sent));
await page.click('.dp-canvas-stage [data-node="locked"]');
await remove();
await take();
await press('Control+z');
await press('Control+z');
await take();
check('続けて押せば続けて戻る', files[FLOW] === original[FLOW]);
await press('Control+Shift+z');
await take();
check('Ctrl+Shift+Z もやり直し', files[FLOW] !== original[FLOW] && /error +@/.test(files[FLOW]),
  files[FLOW].slice(files[FLOW].indexOf('layout {')).split('\n').slice(0, 6).join(' / '));
await press('Control+z');
await take();

// --- 3. 作り直しても履歴は残る（画像が届くと画面は組み直される） -------------
await page.click('.dp-canvas-stage [data-node="home"]');
await remove();
await take();
await page.evaluate(() => window.postMessage({ kind: 'image', path: 'docs/assets/x.png', url: 'data:,' }, '*'));
await page.waitForTimeout(500);
await page.locator('.dp-tabbar').click({ position: { x: 2, y: 2 } }).catch(() => {});
await press('Control+z');
await take();
check('画面を組み直したあとでも戻せる', files[FLOW] === original[FLOW]);

// --- 4. 他で書き換えられたファイルは上書きしない ------------------------------
await page.click('.dp-tab[data-index="3"]');
await page.waitForTimeout(300);
await page.locator(`.dp-sheet:not([hidden]) .dp-figure[data-path$="login-flow.dgm"] .dp-figure-body`).click();
await page.waitForTimeout(400);
await page.click('.dp-canvas-stage [data-node="home"]');
await remove();
await take();
const outside = files[FLOW].replace('# ログイン画面遷移', '# ログイン画面遷移（外で直した）');
files[FLOW] = outside;
await page.evaluate(([path, text]) => window.postMessage({ kind: 'file', path, text }, '*'), [FLOW, outside]);
await page.waitForTimeout(500);
await page.locator('.dp-tabbar').click({ position: { x: 2, y: 2 } }).catch(() => {});
await press('Control+z');
sent = await take();
check('外で書き換えられたあとは戻さない', !sent.some(one => one.kind === 'change') && files[FLOW] === outside);
check('戻せない理由を言う', sent.some(one => one.kind === 'error' && one.message.includes('取り消せない')),
  sent.map(one => one.message).join(' / '));
files[FLOW] = original[FLOW];
await page.evaluate(([path, text]) => window.postMessage({ kind: 'file', path, text }, '*'), [FLOW, original[FLOW]]);
await page.waitForTimeout(500);

// --- 5. 表 -------------------------------------------------------------------
await page.click('.dp-tab[data-index="3"]');
await page.waitForTimeout(300);
await page.locator(`.dp-sheet:not([hidden]) .dp-figure[data-path$="screen-items.table"] .dp-figure-body`).click();
await page.waitForSelector('.dp-grid-table');
await page.click('.dp-grid-table [data-row="0"][data-column="2"]');
await press('Delete');
await take();
check('セルを消す', !files[ITEMS].includes('ログイン ID'));
await press('Control+z');
await take();
check('表の上でも Ctrl+Z で戻る', files[ITEMS] === original[ITEMS]);

// --- 6. 書いている最中の Ctrl+Z は文字のもの ----------------------------------
await page.click('.dp-grid-table [data-row="0"][data-column="2"]');
await press('Enter');
await page.keyboard.type('あ');
await press('Control+z');
sent = await take();
check('セルを書いている最中の Ctrl+Z は何も書かない', sent.length === 0, JSON.stringify(sent));
await press('Escape');
await take();

await browser.close();
