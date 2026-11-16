// The editing and review modes, in the VS Code shell's real screen.
//
// Review comments are marked where they are now and shown as bubbles that stay
// on the page — beside the words, or beside the shape of a drawing they are
// about — and can be switched off. While editing, what is selected in an open
// source box becomes a new comment, and so does a shape, from its menu; a
// zoomed drawing keeps its bubbles on their shapes. The review mode reads
// rather than writes: a click selects text instead of opening the block, the
// comments are listed beside the page, and a selection becomes a new comment
// anchored to the words selected. With the bubbles off, the comment is shown
// when the pointer is over the mark.
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
const flow = files['docs/auth-design/login-flow.dgm'];
const notes = [
  { key: 'r#1', round: 'r', id: 1, file: DOC, start: lock.start - 30, end: lock.end - 30, quote: lock.quote,
    body: '24 時間での自動解除も検討したい', status: 'open', author: '発注者', replies: [{ body: '別途協議します', author: '設計' }] },
  { key: 'r#2', round: 'r', id: 2, file: 'docs/auth-design/screen-items.table', ...at(table, '8 文字以上'),
    body: '12 文字にしてほしい', status: 'open', replies: [] },
  { key: 'r#3', round: 'r', id: 3, file: DOC, start: 10, end: 30, quote: 'もう本文に無い言い回し',
    body: '消えた箇所への指摘', status: 'open', replies: [] },
  { key: 'r#4', round: 'r', id: 4, file: 'docs/auth-design/login-flow.dgm', ...at(flow, '認証 API 呼び出し'),
    body: '認証 API は別チームの管理', status: 'open', replies: [] },
  { key: 'r#5', round: 'r', id: 5, file: 'docs/auth-design/login-flow.dgm', ...at(flow, 'エラー表示'),
    body: '文言は別表にまとめる予定', status: 'open', replies: [], type: 'comment' },
];

mkdirSync('out', { recursive: true });
writeFileSync('out/vscode-review.html', `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="../packages/app-vscode/media/theme.css">
<style>${PAGE_STYLE}</style>
</head><body>
<div class="dp-export" role="toolbar">
  <span class="dp-modes"><button type="button" data-mode="edit" aria-pressed="true">編集</button><button type="button" data-mode="view" aria-pressed="false">閲覧（レビュー）</button></span>
  <label class="dp-marks"><input type="checkbox" checked> コメント</label>
  <span class="dp-bar-gap"></span>
  <span class="dp-export-label">書き出し</span>
  <button type="button" data-format="html">HTML</button><button type="button" data-format="pdf">PDF</button><button type="button" data-format="pptx">PPTX</button>
  <button type="button" class="dp-export-changes" title="前の版と比べ、変わったところに印を付けて書き出す">変更箇所付き…</button>
  <span class="dp-export-status" role="status"></span>
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
await page.waitForTimeout(400);
const bubbleText = await page.locator('.dp-review-bubble-margin').allInnerTexts();
check('指摘は吹き出しで余白に出たまま（マウスを合わせなくても読める）',
  bubbleText.some(text => text.includes('24 時間での自動解除')), bubbleText.join(' / ').replace(/\n/g, ' '));
check('　吹き出しの余白が空けてある', await page.locator('.dp-editor-pane.dp-with-bubbles').count() === 1);
check('図形への指摘は、その図形に印が付く',
  await page.locator('svg.dp-diagram [data-node="authapi"].dp-review-node[data-review~="r#4"]').count() === 1);
const shapeBox = await page.locator('svg.dp-diagram [data-node="authapi"]').first().boundingBox();
const nodeBubble = page.locator('.dp-review-bubble-node', { hasText: '認証 API は別チームの管理' });
const nodeBubbleBox = await nodeBubble.boundingBox();
const near = (a, b) => a && b && Math.abs((b.y + b.height) - a.y) < 30 && b.x < a.x + a.width && b.x + b.width > a.x;
check('　吹き出しは図形の横（上）に出る', near(shapeBox, nodeBubbleBox), JSON.stringify([shapeBox, nodeBubbleBox]));
const ownNote = page.locator('.dp-review-bubble', { hasText: '文言は別表にまとめる予定' });
check('コメント（自分の書き足し）は指摘と色分けされ、そう書かれる',
  await ownNote.evaluate(node => node.classList.contains('dp-review-bubble-comment')) && (await ownNote.innerText()).includes('コメント')
  && await nodeBubble.evaluate(node => node.classList.contains('dp-review-bubble-review')) && (await nodeBubble.innerText()).includes('指摘'));

// 図の拡大: Ctrl+ホイールで大きくなり、吹き出しは図形についていく。
const flowFigure = page.locator('.dp-figure[data-path="auth-design/login-flow.dgm"]');
const widthBefore = (await flowFigure.locator('svg.dp-diagram').boundingBox()).width;
await flowFigure.locator('svg.dp-diagram').hover({ position: { x: 12, y: 12 } });
await page.keyboard.down('Control');
await page.mouse.wheel(0, -400);
await page.keyboard.up('Control');
await page.waitForTimeout(300);
const widthAfter = (await flowFigure.locator('svg.dp-diagram').boundingBox()).width;
check('図は Ctrl+ホイールで拡大できる', widthAfter > widthBefore * 1.2, `${Math.round(widthBefore)} → ${Math.round(widthAfter)}`);
check('　拡大中は倍率が出る', /\d+%/.test(await flowFigure.locator('.dp-zoom-value').innerText()));
await page.evaluate(() => { document.querySelector('[data-node="authapi"]')?.scrollIntoView({ block: 'center', inline: 'center' }); });
await page.waitForTimeout(300);
check('　拡大しても、吹き出しは図形の横に付いていく',
  near(await page.locator('svg.dp-diagram [data-node="authapi"]').first().boundingBox(), await nodeBubble.boundingBox()));
await flowFigure.locator('.dp-zoom-fit').click({ force: true });
await page.waitForTimeout(300);
check('「幅に合わせる」で元に戻る',
  Math.abs((await flowFigure.locator('svg.dp-diagram').boundingBox()).width - widthBefore) < 2);

await page.click('.dp-marks input');
await page.waitForTimeout(300);
check('「コメント」を外すと、印も吹き出しも消える',
  await page.locator('mark.dp-review-mark, .dp-review-block, .dp-review-bubble, .dp-review-node').count() === 0);
await page.click('.dp-marks input');
await page.waitForTimeout(300);
check('付け直すと、また出る',
  await page.locator('mark.dp-review-mark').count() >= 2 && await page.locator('.dp-review-bubble').count() >= 2);

// 編集モードでコメントを書き足す: 開いた本文の箱で選んだ語に。
await page.evaluate(() => { window.__sent.length = 0; });
const lockParagraph = page.locator('.dp-sheet:not([hidden]) p', { hasText: '管理者による手動操作' }).first();
await lockParagraph.click();
await page.waitForSelector('textarea.dp-block-source');
await page.evaluate(() => {
  const area = document.querySelector('textarea.dp-block-source');
  const at = area.value.indexOf('管理者による手動操作');
  area.setSelectionRange(at, at + '管理者による手動操作'.length);
  area.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});
await page.waitForTimeout(200);
check('編集モードでも、開いた本文で語を選ぶと「コメントを追加」が出る',
  await page.locator('.dp-review-add').isVisible() && await page.locator('.dp-review-add').innerText() === 'コメントを追加');
await page.click('.dp-review-add');
await page.waitForSelector('.dp-review-form');
await page.fill('.dp-review-form textarea', '手順書へのリンクを');
await page.click('.dp-review-form button[type="submit"]');
await page.waitForTimeout(200);
const fromEdit = (await page.evaluate(() => window.__sent)).find(one => one.kind === 'review-add');
const editWords = at(doc, '管理者による手動操作');
check('　選んだ語のアンカーで、指摘が器に渡る',
  fromEdit?.anchor.file === DOC && fromEdit.anchor.start === editWords.start && fromEdit.anchor.end === editWords.end
  && fromEdit.precision === 'text', JSON.stringify(fromEdit?.anchor));
check('　編集モードで付けたものはコメント（PDF に載らない）', fromEdit?.type === 'comment');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// 図形のメニューから、その図形にコメントする。
await page.evaluate(() => { window.__sent.length = 0; });
await page.locator('svg.dp-diagram [data-node="validate"]').first().click({ button: 'right' });
await page.waitForTimeout(200);
const shapeItem = page.locator('.dp-menu button', { hasText: 'この図形にコメント' });
check('図形を右クリックすると「この図形にコメント」がある', await shapeItem.isVisible());
await shapeItem.click();
await page.waitForSelector('.dp-review-form');
await page.fill('.dp-review-form textarea', '条件を書き出してほしい');
await page.click('.dp-review-form button[type="submit"]');
await page.waitForTimeout(200);
const onShape = (await page.evaluate(() => window.__sent)).find(one => one.kind === 'review-add');
check('　その図形の行に掛かるアンカーで渡る',
  onShape?.anchor.file === 'docs/auth-design/login-flow.dgm'
  && sliceBytes(flow, onShape.anchor.start, onShape.anchor.end) === '入力チェック', JSON.stringify(onShape?.anchor));
check('　編集モードで図形に付けたものもコメント', onShape?.type === 'comment');

// 表のメニューから、Excel で開く（保存すると書き戻す）。
await page.keyboard.press('Escape');
await page.evaluate(() => { window.__sent.length = 0; });
await page.locator('.dp-figure[data-path="auth-design/screen-items.table"] caption, .dp-figure[data-path="auth-design/screen-items.table"] figcaption').first().click({ button: 'right' });
await page.waitForTimeout(200);
const excelItem = page.locator('.dp-menu button', { hasText: 'Excel で開く' });
check('表を右クリックすると「Excel で開く（保存すると書き戻す）」がある', await excelItem.isVisible());
await excelItem.click();
await page.waitForTimeout(100);
const toExcel = (await page.evaluate(() => window.__sent)).find(one => one.kind === 'open-in-excel');
check('　その表のファイルを Excel で開く頼みが出る', toExcel?.path === 'docs/auth-design/screen-items.table', JSON.stringify(toExcel));

// --- 閲覧（レビュー）モード ---------------------------------------------------------
await page.click('.dp-modes button[data-mode="view"]');
await page.waitForTimeout(400);
check('閲覧モードでも「コメント」の切り替えがあり、印は出ている',
  await page.locator('.dp-marks').isVisible() && await page.locator('mark.dp-review-mark').count() >= 2);
const listed = await page.locator('.dp-review-panel').innerText();
check('横に指摘の一覧が出る', /指摘 5 件/.test(listed) && listed.includes('12 文字にしてほしい'), listed.split('\n')[0]);
check('　場所を見失った指摘も一覧に残り、そう書かれる', listed.includes('消えた箇所への指摘') && listed.includes('場所が見つからない'));
check('編集の入口（挿入・タブの追加）が出ない', await page.locator('.dp-append:visible, .dp-tab-add:visible').count() === 0);

// 吹き出しを外すと、閲覧モードでは印は残り、マウスを合わせると指摘が出る。
await page.click('.dp-marks input');
await page.waitForTimeout(300);
check('閲覧モードで「コメント」を外すと、吹き出しは消え印は残る',
  await page.locator('.dp-review-bubble').count() === 0 && await page.locator('mark.dp-review-mark').count() >= 2);
const mark = page.locator('mark[data-review~="r#1"]').first();
await mark.scrollIntoViewIfNeeded();
await mark.hover();
await page.waitForTimeout(150);
const card = await page.locator('.dp-review-card').innerText().catch(() => '');
check('　印にマウスを合わせると、指摘と回答が出る',
  !(await page.locator('.dp-review-card').isHidden()) && card.includes('24 時間での自動解除') && card.includes('別途協議します'),
  card.replace(/\n/g, ' / '));
await page.click('.dp-marks input');
await page.waitForTimeout(300);

const paragraph = page.locator('.dp-sheet:not([hidden]) p', { hasText: '認証失敗が 5 回に達した' }).first();
await paragraph.click();
await page.waitForTimeout(300);
check('本文を押しても編集は始まらない', await page.locator('.dp-block-source').count() === 0);

await page.evaluate(() => { window.__sent.length = 0; });
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
check('　閲覧（レビュー）モードで付けたものは指摘（PDF に注釈として載る）', added?.type === undefined);
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

// 変更箇所付きの書き出しは、拡張に頼むだけ（版の選択は VS Code の QuickPick）
await page.evaluate(() => { window.__sent.length = 0; });
await page.getByRole('button', { name: '変更箇所付き…' }).click();
check('「変更箇所付き…」で、変更箇所付きの書き出しを拡張に頼む',
  (await page.evaluate(() => window.__sent)).some(one => one.kind === 'export-changes'));
await page.evaluate(() => window.postMessage({ kind: 'export-state', busy: true, message: 'PDF を書き出しています…' }, '*'));
await page.waitForTimeout(100);
check('　書き出し中は、ほかの書き出しボタンと一緒に押せなくなる',
  await page.locator('.dp-export-changes').isDisabled() && await page.locator('[data-format="pdf"]').isDisabled());
await page.screenshot({ path: 'out/export-changes-bar.png', clip: { x: 0, y: 0, width: 1280, height: 60 } });

await browser.close();
