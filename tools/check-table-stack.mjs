// A table on a screen that holds its cells, and arranging picked shapes into
// a stack — both from the canvas menu, in the editor demo (out/editor.html).
//
// Usage: node tools/check-table-stack.mjs [--chromium <path>]   (after tools/build-editor-demo.mjs)
import { chromium } from 'playwright-core';
import { findChromium } from './pdf-writer.mjs';

const at = process.argv.indexOf('--chromium');
const browser = await chromium.launch({ executablePath: findChromium(at < 0 ? undefined : process.argv[at + 1]) });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};
const status = () => page.textContent('#status');
const node = id => page.locator(`.dp-canvas-stage [data-node="${id}"]`).first();
const where = () => page.textContent('.dp-sheet:not([hidden]) .dp-canvas-where');

await page.goto('file://' + process.cwd() + '/out/editor.html?lang=ja');
await page.waitForTimeout(600);

// --- 表に中身を作る ----------------------------------------------------------
await page.click('.dp-tab:has-text("画面部品")');
await page.waitForTimeout(500);
const figure = page.locator('.dp-figure[data-path="auth-design/search-screen.dgm"] .dp-figure-body');
await figure.scrollIntoViewIfNeeded();
await figure.click();
await page.waitForTimeout(600);

let box = await node('listNote').boundingBox();
await page.mouse.click(box.x + 10, box.y + box.height / 2);
await page.click('.dp-canvas-bar button:text("＋ 部品")');
await page.hover('.dp-menu button:text-is("一覧")');
await page.waitForTimeout(450);
await page.click('.dp-menu-sub button:text-is("grid")');
await page.waitForTimeout(500);
const table = await page.evaluate(() => [...document.querySelectorAll('.dp-canvas-stage [data-node]')]
  .map(one => one.dataset.node).find(id => /^part\d+$/.test(id)));
check('表（一覧）を足せる', table !== undefined, table);

box = await node(table).boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
await page.waitForTimeout(250);
check('中身の無い表には「表に中身を作る」が出る', await page.isVisible('.dp-menu button:has-text("表に中身を作る")'));
await page.click('.dp-menu button:has-text("表に中身を作る")');
await page.waitForTimeout(500);
check('作ると報せる', (await status()).includes('表に中身を作る'), await status());
check('罫線と見出しの網掛けが描かれる',
  await page.locator(`.dp-canvas-stage [data-node="${table}"] .dp-table-art .dp-table-head`).count() === 1);

// 2 行目のセル。空のセルも押せる。
const frame = await node(table).boundingBox();
const secondRow = (column) => ({ x: frame.x + frame.width * (column + 0.5) / 3, y: frame.y + frame.height * 0.7 });
let spot = secondRow(0);
await page.mouse.click(spot.x, spot.y);
await page.waitForTimeout(250);
check('空のセルも押せる', (await where()).startsWith(`${table}R1`), await where());

await page.mouse.click(spot.x, spot.y, { button: 'right' });
await page.hover('.dp-menu button:text-is("部品を変える")');
await page.waitForTimeout(450);
await page.hover('.dp-menu-sub button:text-is("入力")');
await page.waitForTimeout(450);
await page.click('.dp-menu-sub >> nth=1 >> button:text-is("checkbox")');
await page.waitForTimeout(500);
check('セルをチェックボックスにできる', (await status()).includes('部品を変える'), await status());

spot = secondRow(1);
await page.mouse.click(spot.x, spot.y, { button: 'right' });
await page.hover('.dp-menu button:text-is("表")');
await page.waitForTimeout(450);
check('セルの右クリックに表の操作が並ぶ',
  (await page.$$eval('.dp-menu-sub button', buttons => buttons.map(one => one.textContent))).join(' ')
    === '下に行を足す 右に列を足す この行を消す この列を消す');
await page.click('.dp-menu-sub button:text-is("下に行を足す")');
await page.waitForTimeout(500);
check('行を足すと表が伸びる', (await node(table).boundingBox()).height > frame.height + 10,
  `${Math.round(frame.height)} → ${Math.round((await node(table).boundingBox()).height)}`);

// --- 選んだものを並べる ------------------------------------------------------
await page.click('.dp-tab:has-text("システム構成")');
await page.waitForTimeout(500);
await page.click('.dp-sheet:not([hidden]) .dp-figure-body');
await page.waitForTimeout(600);
box = await node('db').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
const cache = await node('cache').boundingBox();
await page.keyboard.down('Shift');
await page.mouse.click(cache.x + cache.width / 2, cache.y + cache.height / 2);
await page.keyboard.up('Shift');
await page.mouse.click(cache.x + cache.width / 2, cache.y + cache.height / 2, { button: 'right' });
await page.waitForTimeout(250);
const offered = await page.$$eval('.dp-menu button', buttons => buttons.map(one => one.textContent));
check('2 つ選ぶと「縦に並べる」「横に並べる」が出る',
  offered.includes('2 個を縦に並べる') && offered.includes('2 個を横に並べる'), offered.filter(one => /並べる/.test(one)).join(' / '));
await page.click('.dp-menu button:text-is("2 個を横に並べる")');
await page.waitForTimeout(600);
check('並べてまとめたと報せる', (await status()).includes('並べてまとめる'), await status());
const db = await node('db').boundingBox();
const after = await node('cache').boundingBox();
check('横に並ぶ（上の端が揃い、左から順）', Math.abs(db.y - after.y) < 2 && db.x < after.x,
  `db ${Math.round(db.x)},${Math.round(db.y)} / cache ${Math.round(after.x)},${Math.round(after.y)}`);

await browser.close();
