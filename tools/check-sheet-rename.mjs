// Renaming a sheet from its tab, in the VS Code shell's real screen.
//
// A sheet's name is its first heading, and that heading is not always in the
// document: a sheet that is only `@import "revision.md"` is named by that
// file. Renaming it must rewrite that file, and a sheet with no heading at all
// must get one — not refuse with "a sheet with no heading has no name".
//
// Usage: node tools/check-sheet-rename.mjs [--chromium <path>]
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
// A sheet with nothing but text, to name from scratch.
files['docs/plain.md'] = '# 題名\n\n---\n\n本文だけのシート。\n';

mkdirSync('out', { recursive: true });
writeFileSync('out/vscode-rename.html', `<!doctype html>
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
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', error => { console.log('✗ ページエラー:', error.message); process.exitCode = 1; });
await page.goto(pathToFileURL(resolve('out/vscode-rename.html')).href);
await page.waitForTimeout(300);

const open = async path => {
  await page.evaluate(() => { window.__sent.length = 0; });
  await page.evaluate(([path, source, files]) => {
    window.postMessage({ kind: 'open', path, source, files, images: {}, commitKey: 'ctrl-enter', locale: 'ja' }, '*');
  }, [path, files[path], files]);
  await page.waitForTimeout(800);
};
const tabs = () => page.locator('.dp-tab:not(.dp-tab-add)').allInnerTexts();
const rename = async (index, name) => {
  await page.locator('.dp-tab:not(.dp-tab-add)').nth(index).dblclick();
  await page.locator('.dp-tab-rename').fill(name);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
};
const changes = () => page.evaluate(() => window.__sent.filter(one => one.kind === 'change' || one.kind === 'error'));

// 1. 取り込んだ文書の見出しで名前が付いているシート
await open('docs/auth-design.md');
const last = (await tabs()).length - 1;
check('取り込んだ改訂履歴のシートは、その見出しの名前でタブに出る', (await tabs())[last].includes('改訂履歴'), (await tabs())[last]);
await rename(last, '変更履歴');
let sent = await changes();
check('警告は出ない', !sent.some(one => one.kind === 'error'), JSON.stringify(sent.filter(one => one.kind === 'error')));
check('書き換えるのは取り込んだ改訂履歴のファイル', sent.length === 1 && sent[0].path === 'docs/auth-design/revision.md', sent.map(one => one.path).join(','));
const before = files['docs/auth-design/revision.md'];
const after = sent[0] ? replaceBytes(before, sent[0].span.start, sent[0].span.end, sent[0].text) : before;
check('見出しの文字だけが変わり、ラベルは残る', after === before.replace('## 改訂履歴', '## 変更履歴'), after.split('\n')[0]);
check('タブも新しい名前になる', (await tabs())[last].includes('変更履歴'), (await tabs())[last]);

// 2. 見出しの無いシート
await open('docs/plain.md');
await rename(1, '二枚目');
sent = await changes();
check('見出しの無いシートも警告なしで名前が付く', sent.length === 1 && sent[0].kind === 'change' && sent[0].path === undefined, JSON.stringify(sent));
const plain = sent[0] ? replaceBytes(files['docs/plain.md'], sent[0].span.start, sent[0].span.end, sent[0].text) : '';
check('名前は見出しとしてシートの先頭に入る', plain === '# 題名\n\n---\n\n## 二枚目\n\n本文だけのシート。\n', JSON.stringify(plain));
check('タブも新しい名前になる', (await tabs())[1].includes('二枚目'), (await tabs())[1]);

// 3. ふつうのシート（今までどおり）
await open('docs/auth-design.md');
await rename(1, 'システムの構成');
sent = await changes();
check('見出しのあるシートは、その見出しを書き換える', sent.length === 1 && sent[0].path === undefined && sent[0].text.startsWith('## システムの構成'), sent[0]?.text);

await browser.close();
