// The editing and review modes, in the VS Code shell's real screen.
//
// Review comments are marked where they are now, shown when the pointer is
// over the mark, and can be switched off while editing. The review mode reads
// rather than writes: a click selects text instead of opening the block, the
// comments are listed beside the page, and a selection becomes a new comment
// anchored to the words selected.
//
// Usage: node tools/check-review-mode.mjs [--chromium <path>]
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { byteLength, sliceBytes, toLf } from '../packages/base/dist/index.js';
import { findChromium } from './pdf-writer.mjs';
import { PAGE_STYLE } from '../packages/app-vscode/dist/page-style.js';

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
const doc = files[DOC];
const at = (text, piece) => {
  const start = byteLength(text.slice(0, text.indexOf(piece)));
  return { start, end: start + byteLength(piece), quote: piece };
};

// Three comments: one made on an earlier version (its range is off by the
// lines added since), one on a table cell, and one whose words are gone.
const lock = at(doc, 'ロックの解除は');
const table = files['docs/auth-design/screen-items.table'];
const notes = [
  { key: 'r#1', round: 'r', id: 1, file: DOC, start: lock.start - 30, end: lock.end - 30, quote: lock.quote,
    body: '24 時間での自動解除も検討したい', status: 'open', author: '発注者', replies: [{ body: '別途協議します', author: '設計' }] },
  { key: 'r#2', round: 'r', id: 2, file: 'docs/auth-design/screen-items.table', ...at(table, '8 文字以上'),
    body: '12 文字にしてほしい', status: 'open', replies: [] },
  { key: 'r#3', round: 'r', id: 3, file: DOC, start: 10, end: 30, quote: 'もう本文に無い言い回し',
    body: '消えた箇所への指摘', status: 'open', replies: [] },
];

mkdirSync('out', { recursive: true });
writeFileSync('out/vscode-review.html', `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="../packages/app-vscode/media/theme.css">
<style>${PAGE_STYLE}</style>
</head><body>
<div class="dp-export" role="toolbar">
  <span class="dp-modes"><button type="button" data-mode="edit" aria-pressed="true">編集</button><button type="button" data-mode="view" aria-pressed="false">閲覧（レビュー）</button></span>
  <label class="dp-marks"><input type="checkbox" checked> 指摘の印</label>
  <span class="dp-bar-gap"></span>
  <span class="dp-export-label">書き出し</span>
  <button type="button" data-format="html">HTML</button><button type="button" data-format="pdf">PDF</button><button type="button" data-format="pptx">PPTX</button>
</div>
<div class="dp-main"><div id="editor"></div><aside class="dp-review-panel" hidden></aside></div>
<script>
  window.__sent = []; window.__state = undefined;
  window.acquireVsCodeApi = () => ({ postMessage: m => window.__sent.push(m), getState: () => window.__state, setState: s => { window.__state = s; } });
</script>
<script src="../packages/app-vscode/media/webview.js"></script>
</body></html>
`);

const browser = await chromium.launch({ executablePath: findChromium(option('--chromium')) });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', error => { console.log('✗ ページエラー:', error.message); process.exitCode = 1; });
await page.goto(pathToFileURL(resolve('out/vscode-review.html')).href);
await page.waitForTimeout(300);
await page.evaluate(([path, source, files, notes]) => {
  window.postMessage({ kind: 'open', path, source, files, images: {}, commitKey: 'ctrl-enter', locale: 'ja' }, '*');
  window.postMessage({ kind: 'reviews', notes }, '*');
}, [DOC, doc, files, notes]);
await page.waitForTimeout(900);

// --- 編集モード ------------------------------------------------------------------
check('編集モードでも、指摘の今の位置に印が付く（本文の語）',
  (await page.locator('mark.dp-review-mark[data-review~="r#1"]').allTextContents()).join('') === 'ロックの解除は',
  (await page.locator('mark.dp-review-mark[data-review~="r#1"]').allTextContents()).join(''));
check('　範囲がずれていても、語をたどって付く（moved）',
  await page.locator('mark[data-review~="r#1"]').first().getAttribute('data-review-state') === 'moved');
check('表のセルの語にも印が付く',
  (await page.locator('mark.dp-review-mark[data-review~="r#2"]').allTextContents()).join('') === '8 文字以上');

await page.click('.dp-tab:has-text("ログイン機能")');
await page.waitForTimeout(300);
const mark = page.locator('mark[data-review~="r#1"]').first();
await mark.scrollIntoViewIfNeeded();
await mark.hover();
await page.waitForTimeout(150);
const card = await page.locator('.dp-review-card').innerText().catch(() => '');
check('印にマウスを合わせると、指摘と回答が出る',
  !(await page.locator('.dp-review-card').isHidden()) && card.includes('24 時間での自動解除') && card.includes('別途協議します'),
  card.replace(/\n/g, ' / '));

await page.click('.dp-marks input');
await page.waitForTimeout(300);
check('「指摘の印」を外すと、印が消える', await page.locator('mark.dp-review-mark, .dp-review-block').count() === 0);
await page.click('.dp-marks input');
await page.waitForTimeout(300);
check('付け直すと、また出る', await page.locator('mark.dp-review-mark').count() >= 2);

// --- 閲覧（レビュー）モード ---------------------------------------------------------
await page.click('.dp-modes button[data-mode="view"]');
await page.waitForTimeout(400);
check('閲覧モードでは「指摘の印」の切り替えは隠れ、印は出たまま',
  await page.locator('.dp-marks').isHidden() && await page.locator('mark.dp-review-mark').count() >= 2);
const listed = await page.locator('.dp-review-panel').innerText();
check('横に指摘の一覧が出る', /指摘 3 件/.test(listed) && listed.includes('12 文字にしてほしい'), listed.split('\n')[0]);
check('　場所を見失った指摘も一覧に残り、そう書かれる', listed.includes('消えた箇所への指摘') && listed.includes('場所が見つからない'));
check('編集の入口（挿入・タブの追加）が出ない', await page.locator('.dp-append:visible, .dp-tab-add:visible').count() === 0);

const paragraph = page.locator('.dp-sheet:not([hidden]) p', { hasText: '認証失敗が 5 回に達した' }).first();
await paragraph.click();
await page.waitForTimeout(300);
check('本文を押しても編集は始まらない', await page.locator('.dp-block-source').count() === 0);

// Select 「管理者による手動操作」 in that paragraph, as a mouse drag would.
await page.evaluate(() => {
  const p = [...document.querySelectorAll('.dp-sheet:not([hidden]) p')].find(node => node.textContent.includes('管理者による手動操作'));
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.data.indexOf('管理者による手動操作');
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + '管理者による手動操作'.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return;
  }
});
await page.waitForTimeout(200);
check('本文を選ぶと「指摘を追加」が出る', await page.locator('.dp-review-add').isVisible());
await page.click('.dp-review-add');
await page.waitForSelector('.dp-review-form');
await page.fill('.dp-review-form textarea', '解除の手順書へのリンクがほしい');
await page.screenshot({ path: 'out/review-mode.png' });
await page.click('.dp-review-form button[type="submit"]');
await page.waitForTimeout(200);
const added = (await page.evaluate(() => window.__sent)).find(one => one.kind === 'review-add');
const words = at(doc, '管理者による手動操作');
check('選んだ語のアンカーで、指摘が器に渡る',
  added?.body === '解除の手順書へのリンクがほしい' && added.precision === 'text'
  && added.anchor.file === DOC && added.anchor.start === words.start && added.anchor.end === words.end
  && sliceBytes(doc, added.anchor.start, added.anchor.end) === '管理者による手動操作',
  JSON.stringify(added?.anchor));
check('選んだモードは覚えておく', (await page.evaluate(() => window.__state))?.mode === 'view');

// 一覧から状態と回答を変える
await page.evaluate(() => { window.__sent.length = 0; });
const second = page.locator('.dp-review-entry').nth(1);
await second.locator('select').selectOption('resolved');
await second.getByRole('button', { name: '回答を書く' }).click();
await second.locator('textarea').fill('12 文字に変えました');
await page.screenshot({ path: 'out/review-panel.png' });
await second.getByRole('button', { name: '保存' }).click();
const updates = (await page.evaluate(() => window.__sent)).filter(one => one.kind === 'review-update');
check('状態を選ぶと、その指摘の状態だけを書き換える頼みが出る',
  updates.some(one => one.round === 'r' && one.id === 2 && one.status === 'resolved' && one.reply === undefined), JSON.stringify(updates));
check('回答を書いて保存すると、回答を書き換える頼みが出る',
  updates.some(one => one.id === 2 && one.reply === '12 文字に変えました'));
check('一覧を操作しても、印へは飛ばない（選択と入力の邪魔をしない）', await page.locator('.dp-review-flash').count() === 0);

await browser.close();
