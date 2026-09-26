// The palette (shared between prose and cells) and cell merging.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await page.goto('file://' + process.cwd() + '/out/editor.html');
await page.waitForTimeout(400);
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};
const cell = (row, column) => `.dp-grid-table [data-row="${row}"][data-column="${column}"]`;
const openGrid = async () => {
  await page.click('.dp-sheet:not([hidden]) .dp-figure-body');
  await page.waitForSelector('.dp-grid-table');
  await page.waitForTimeout(200);
};
const viaMenu = async (label, at) => {
  await page.click(at, { button: 'right' });
  await page.waitForSelector('.dp-menu button');
  await page.click(`.dp-menu button:text("${label}")`);
  await page.waitForSelector('.dp-grid-table');
  await page.waitForTimeout(300);
};

// --- パレット（本文） -----------------------------------------------------
await page.click('.dp-prose p');
await page.waitForTimeout(250);
const proseSwatches = await page.$$eval('.dp-prose .dp-format-swatch',
  b => b.map(x => x.title));
check('本文の色見本は 4 色', proseSwatches.length === 4, proseSwatches.join(' / '));
check('赤・青・緑・紫', proseSwatches.join('/') === '文字色: 赤/文字色: 青/文字色: 緑/文字色: 紫');
check('ピッカーと解除がある',
  await page.isVisible('.dp-prose .dp-format-swatch-picker')
  && await page.isVisible('.dp-prose .dp-format-swatch-reset'));

await page.$eval('.dp-block-source', el => {
  const at = el.value.indexOf('認証機能');
  el.setSelectionRange(at, at + 4);
  el.dispatchEvent(new Event('select', { bubbles: true }));
});
await page.click('.dp-prose .dp-format-swatch[title*="赤"]', { force: true });
await page.waitForTimeout(150);
check('はっきりした赤が入る',
  (await page.inputValue('.dp-block-source')).includes('{color=#ff0000}'));
await page.click('.dp-prose .dp-format-swatch-reset', { force: true });
await page.waitForTimeout(150);
check('解除で色が外れる',
  !(await page.inputValue('.dp-block-source')).includes('{color='));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// --- パレット（セル）— 同じ部品 -------------------------------------------
await page.click('.dp-tab[data-index="5"]');
await page.waitForTimeout(250);
await openGrid();
await page.dblclick(cell(0, 1));
await page.waitForTimeout(250);
const cellSwatches = await page.$$eval('.dp-grid .dp-format-swatch', b => b.map(x => x.title));
check('セルの色見本も同じ 4 色', cellSwatches.join('/') === proseSwatches.join('/'),
  cellSwatches.join(' / '));
check('セルにも解除がある', await page.isVisible('.dp-grid .dp-format-swatch-reset'));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// --- 結合 -----------------------------------------------------------------
const spanOf = async (r, c) => page.$eval(cell(r, c),
  el => `${el.getAttribute('rowspan') ?? 1}x${el.getAttribute('colspan') ?? 1}`);
// 編集を閉じた直後は行の高さが戻る途中なので、落ち着いてから押す。
await page.waitForTimeout(400);
await viaMenu('下のセルと結合', cell(0, 0));
check('下のセルと結合できる', (await spanOf(0, 0)) === '2x1', await spanOf(0, 0));
await viaMenu('右のセルと結合', cell(0, 0));
check('続けて右にも結合できる', (await spanOf(0, 0)) === '2x2', await spanOf(0, 0));
await viaMenu('結合を解除', cell(0, 0));
check('解除できる', (await spanOf(0, 0)) === '1x1', await spanOf(0, 0));

// 結合していないセルでは「解除」が押せない
await page.click(cell(1, 1), { button: 'right' });
await page.waitForSelector('.dp-menu button');
check('結合していなければ解除は押せない',
  await page.$eval('.dp-menu button:text("結合を解除")', b => b.disabled));
await page.keyboard.press('Escape');

await browser.close();
