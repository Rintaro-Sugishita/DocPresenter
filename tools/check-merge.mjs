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
await page.click('.dp-tab:has-text("用語")');
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



// --- 範囲の結合 -----------------------------------------------------------
await page.goto('file://' + process.cwd() + '/out/editor.html');
await page.waitForTimeout(500);
await page.click('.dp-tab:has-text("用語")');
await page.waitForTimeout(250);
await openGrid();

// Shift+矢印で範囲を広げる
await page.click(cell(0, 0));
await page.waitForTimeout(150);
await page.keyboard.press('Shift+ArrowDown');
await page.keyboard.press('Shift+ArrowRight');
await page.waitForTimeout(200);
check('Shift+矢印で範囲が広がる',
  (await page.$$('.dp-grid-picked')).length === 4,
  `${(await page.$$('.dp-grid-picked')).length} セル`);

// 中身があるので警告が出る
await page.click(cell(0, 0), { button: 'right' });
await page.waitForSelector('.dp-menu button');
await page.click('.dp-menu button:text("選択範囲を結合")');
await page.waitForSelector('.dp-menu button');
await page.waitForTimeout(200);
const warning = await page.$$eval('.dp-menu button', bs => bs.map(b => b.textContent));
check('中身があると先に知らせる', warning[0].includes('文字が消えます'), warning.join(' / '));
check('やめる選択肢がある', warning.some(t => t === 'やめる'));

await page.click('.dp-menu button:text("やめる")');
await page.waitForTimeout(300);
check('やめれば結合されない',
  await page.$eval(cell(0, 0), el => el.getAttribute('rowspan')) === null);

// 進めれば結合される
await page.click(cell(0, 0), { button: 'right' });
await page.waitForSelector('.dp-menu button');
await page.click('.dp-menu button:text("選択範囲を結合")');
await page.waitForSelector('.dp-menu button');
await page.click('.dp-menu button:text("だけを残して結合")');
await page.waitForSelector('.dp-grid-table');
await page.waitForTimeout(350);
check('進めれば 2x2 に結合される',
  (await page.$eval(cell(0, 0), el =>
    `${el.getAttribute('rowspan')}x${el.getAttribute('colspan')}`)) === '2x2',
  await page.$eval(cell(0, 0), el => `${el.getAttribute('rowspan')}x${el.getAttribute('colspan')}`));
check('左上の文字だけが残る',
  (await page.textContent(cell(0, 0))).includes('アクセストークン'));



// --- 見出しの寄せと色 -----------------------------------------------------
await page.goto('file://' + process.cwd() + '/out/editor.html');
await page.waitForTimeout(500);
await page.click('.dp-tab:has-text("用語")');
await page.waitForTimeout(250);
await openGrid();

await page.dblclick(cell(-1, 1));
await page.waitForTimeout(250);
await page.$eval('.dp-grid-input', el => {
  el.setSelectionRange(0, 2);
  el.dispatchEvent(new Event('select', { bubbles: true }));
});
await page.click('.dp-grid .dp-format-swatch[title*="赤"]', { force: true });
await page.keyboard.press('Enter');
await page.waitForSelector('.dp-grid-table');
await page.waitForTimeout(350);
await page.click('.dp-sheet:not([hidden]) .dp-prose p');
await page.waitForTimeout(400);
check('見出しの一部にも色が付く',
  await page.isVisible('.dp-sheet:not([hidden]) .dp-table th span[style*="color:#ff0000"]'));

await openGrid();
await page.selectOption('.dp-grid-target', 'header');
await page.waitForTimeout(150);
await page.click('.dp-grid-bar button[title*="中央"]');
await page.waitForSelector('.dp-grid-table');
await page.waitForTimeout(300);
await page.click('.dp-sheet:not([hidden]) .dp-prose p');
await page.waitForTimeout(400);
check('見出しだけ中央寄せにできる',
  await page.isVisible('.dp-sheet:not([hidden]) .dp-table th.dp-align-center'));
check('本文セルの寄せは変わらない',
  !(await page.isVisible('.dp-sheet:not([hidden]) .dp-table td.dp-align-center')));



// --- グリッドは「見た目」を出す -------------------------------------------
await page.goto('file://' + process.cwd() + '/out/editor.html');
await page.waitForTimeout(500);
await page.click('.dp-tab:has-text("用語")');
await page.waitForTimeout(250);
await openGrid();

await page.dblclick(cell(-1, 0));
await page.waitForTimeout(250);
await page.$eval('.dp-grid-input', el => {
  el.setSelectionRange(0, 1);
  el.dispatchEvent(new Event('select', { bubbles: true }));
});
await page.click('.dp-grid .dp-format-swatch[title*="赤"]', { force: true });
await page.keyboard.press('Enter');
await page.waitForSelector('.dp-grid-table');
await page.waitForTimeout(350);
check('グリッドの見出しにも色が出る',
  await page.isVisible(`${cell(-1, 0)} span[style*="color:#ff0000"]`),
  await page.$eval(cell(-1, 0), el => el.textContent));
check('編集を開くと記法が見える', await (async () => {
  await page.dblclick(cell(-1, 0));
  await page.waitForTimeout(200);
  const raw = await page.inputValue('.dp-grid-input');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return raw.includes('{color=#ff0000}');
})());

// 寄せがグリッドに出る
await page.click(cell(0, 1));
await page.waitForTimeout(150);
const before = await page.getAttribute(cell(0, 1), 'class');
await page.click('.dp-grid-bar button[title*="中央"]');
await page.waitForSelector('.dp-grid-table');
await page.waitForTimeout(350);
check('寄せがグリッドにも出る',
  (await page.getAttribute(cell(0, 1), 'class')).includes('dp-align-center'),
  `${before} → ${await page.getAttribute(cell(0, 1), 'class')}`);
check('同じ列の別のセルは変わらない',
  !(await page.getAttribute(cell(1, 1), 'class')).includes('dp-align-center'));



// 「対象」の選択は操作のたびに戻らない
await page.selectOption('.dp-grid-target', 'header');
await page.waitForTimeout(150);
await page.click('.dp-grid-swatch[title="塗り: 灰"]');
await page.waitForSelector('.dp-grid-table');
await page.waitForTimeout(350);
check('「対象」の選択が操作のあとも残る',
  (await page.inputValue('.dp-grid-target')) === 'header',
  await page.inputValue('.dp-grid-target'));

await browser.close();
