// A figure's names — its file, its caption, its label — changed from the form,
// in the VS Code shell's real screen with `acquireVsCodeApi` standing in.
//
// What is checked is what leaves the screen: the file is asked to move before
// the document's edit, the edit is one byte range that touches only the lines
// naming the figure, and the figure is still drawn afterwards under its new
// name. A refused name keeps the form open and says why.
//
// Usage: node tools/check-figure-names.mjs [--chromium <path>]
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

mkdirSync('out', { recursive: true });
writeFileSync('out/vscode-names.html', `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="../packages/app-vscode/media/theme.css">
<style>html, body { height: 100%; margin: 0; max-width: none; }</style>
</head><body>
<div id="editor"></div>
<script>
  window.__sent = [];
  window.acquireVsCodeApi = () => ({ postMessage: m => window.__sent.push(m), getState: () => window.__state, setState: s => { window.__state = s; } });
</script>
<script src="../packages/app-vscode/media/webview.js"></script>
</body></html>
`);

const browser = await chromium.launch({ executablePath: findChromium(option('--chromium')) });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', error => { console.log('✗ ページエラー:', error.message); process.exitCode = 1; });
await page.goto(pathToFileURL(resolve('out/vscode-names.html')).href);
await page.waitForTimeout(300);
await page.evaluate(([path, source, files]) => {
  window.postMessage({ kind: 'open', path, source, files, images: {}, commitKey: 'ctrl-enter', locale: 'ja' }, '*');
}, [DOC, files[DOC], files]);
await page.waitForTimeout(800);

const sent = () => page.evaluate(() => window.__sent.filter(one => one.kind !== 'ready'));
const figure = '.dp-sheet:not([hidden]) .dp-figure[data-path="auth-design/login-flow.dgm"]';

await page.click('.dp-tab:has-text("ログイン機能")');
await page.waitForTimeout(300);
await page.hover(`${figure} .dp-figure-body`);
const button = page.locator(`${figure} > .dp-figure-tools > .dp-figure-names`);
check('図に乗ると「名前・題・ラベル」が出る', await button.isVisible());
await button.click();
await page.waitForSelector('.dp-names');
const value = sel => page.inputValue(`.dp-names-field:nth-of-type(${sel}) input`);
check('今の名前が入っている',
  await value(1) === 'login-flow' && await value(2) === 'ログイン画面遷移' && await value(3) === 'fig-login-flow',
  `${await value(1)} / ${await value(2)} / ${await value(3)}`);
const fixed = await page.locator('.dp-names-fixed').allTextContents();
check('フォルダと拡張子は変えないものとして見える', fixed.join('|') === 'auth-design/|.dgm', fixed.join('|'));

// 使えないラベルは断られ、フォームは開いたまま理由を言う。
await page.fill('.dp-names-field:nth-of-type(3) input', 'tbl-login');
await page.click('.dp-names-ok');
await page.waitForTimeout(200);
const problem = await page.locator('.dp-names-problem').textContent();
check('使えないラベルは理由を言って断る', await page.isVisible('.dp-names') && /fig-/.test(problem ?? ''), problem ?? '');
check('断ったときは何も出ていかない', (await sent()).length === 0, JSON.stringify(await sent()));

await page.fill('.dp-names-field:nth-of-type(1) input', 'login-transitions');
await page.fill('.dp-names-field:nth-of-type(2) input', 'ログインの画面遷移');
await page.fill('.dp-names-field:nth-of-type(3) input', 'fig-login-transitions');
await page.click('.dp-names-ok');
await page.waitForTimeout(600);
check('変更するとフォームは閉じる', !(await page.isVisible('.dp-names')));

const out = await sent();
check('ファイルを動かす頼みが、文書の編集より先に出る',
  out.map(one => one.kind).join(',') === 'move,change', out.map(one => one.kind).join(','));
const move = out[0] ?? {};
check('動かすのは作業場からの道で',
  move.from === 'docs/auth-design/login-flow.dgm' && move.to === 'docs/auth-design/login-transitions.dgm',
  `${move.from} → ${move.to}`);
const change = out[1] ?? {};
const before = files[DOC];
const after = change.span ? replaceBytes(before, change.span.start, change.span.end, change.text) : before;
const changed = before.split('\n').map((line, i) => line === after.split('\n')[i] ? '' : line).filter(Boolean);
check('文書の編集は、図の名前が書かれた行だけを変える',
  changed.length === 2 && changed.every(line => line.includes('login-flow')), changed.join(' / '));
check('取り込み行はファイル名・題・ラベルが新しくなる',
  after.includes('@import "auth-design/login-transitions.dgm" {#fig-login-transitions caption="ログインの画面遷移"}'));
check('本文の参照も新しいラベルになる',
  after.includes('ログイン時の画面遷移を @fig-login-transitions に示す。') && !after.includes('@fig-login-flow'));
check('新しい名前のまま図が描かれている',
  await page.locator('.dp-sheet:not([hidden]) .dp-figure[data-path="auth-design/login-transitions.dgm"] svg.dp-diagram').count() === 1);

// 右クリックからも同じフォームが開く。英語の画面では英語で聞く。
await page.evaluate(() => window.postMessage({ kind: 'settings', commitKey: 'ctrl-enter', locale: 'en' }, '*'));
await page.evaluate(([path, source, files]) => {
  window.postMessage({ kind: 'open', path, source, files, images: {}, commitKey: 'ctrl-enter', locale: 'en' }, '*');
}, [DOC, files[DOC], files]);
await page.waitForTimeout(800);
await page.click('.dp-tab:nth-child(3)');
await page.waitForTimeout(300);
await page.click(`${figure} .dp-caption`, { button: 'right' });
await page.waitForTimeout(200);
await page.locator('.dp-menu >> text=Name, caption, label').click();
await page.waitForSelector('.dp-names');
check('右クリックのメニューからも開き、画面の言語で聞く',
  (await page.locator('.dp-names-title').textContent()) === "Figure's names");
await page.screenshot({ path: 'out/figure-names.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
check('Escape で閉じる', !(await page.isVisible('.dp-names')));

await browser.close();
