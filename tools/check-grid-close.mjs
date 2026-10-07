// Ending an edit, and reaching the first row and column.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1320, height: 880 } });
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await page.goto('file://' + process.cwd() + '/out/editor.html?lang=ja');
await page.waitForTimeout(400);
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};
const cell = (row, column) => `.dp-grid-table [data-row="${row}"][data-column="${column}"]`;
const bars = () => page.$$eval('.dp-format-bar', b => b.filter(x => x.offsetParent).length);
const openGrid = async () => {
  await page.click('.dp-sheet:not([hidden]) .dp-figure-body');
  await page.waitForSelector('.dp-grid-table');
  await page.waitForTimeout(200);
};

await page.click('.dp-tab:has-text("用語")');
await page.waitForTimeout(250);
await openGrid();

// ダブルクリックで編集が始まる
await page.dblclick(cell(0, 0));
await page.waitForTimeout(250);
check('ダブルクリックで編集が始まる', await page.isVisible('.dp-grid .dp-format-bar'));
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// セル編集中に本文をクリックしたら、書いた内容が残って表が閉じる
await page.click(cell(0, 1));
await page.waitForTimeout(150);
await page.keyboard.press('F2');
await page.waitForTimeout(150);
await page.keyboard.press('End');
await page.keyboard.type('。追記');
await page.click('.dp-sheet:not([hidden]) .dp-prose p');
await page.waitForTimeout(500);
check('表の外をクリックするとグリッドが閉じる', !(await page.isVisible('.dp-grid-table')));
check('書式バーも消える', (await bars()) === 0, `${await bars()} 個`);
check('編集中だった内容は残る',
  (await page.textContent('.dp-sheet:not([hidden]) .dp-table')).includes('。追記'));

// 続けて本文が編集できる
await page.click('.dp-sheet:not([hidden]) .dp-prose p');
await page.waitForTimeout(300);
check('続けて本文が編集できる', await page.isVisible('.dp-block-source'));
await page.keyboard.press('Escape');
await page.waitForTimeout(250);

// 1 行目・1 列目に挿入できる
await openGrid();
const firstRow = () => page.textContent(cell(0, 0));
const firstCol = () => page.textContent(cell(-1, 0));
await page.click(cell(0, 0));
await page.waitForTimeout(150);
await page.click(cell(0, 0), { button: 'right' });
await page.waitForSelector('.dp-menu button');
await page.click('.dp-menu button:text("行を上に追加")');
await page.waitForSelector('.dp-grid-table');
await page.waitForTimeout(300);
check('1 行目の上に行を足せる', (await firstRow()).trim() === '', `「${await firstRow()}」`);

await page.click(cell(0, 0));
await page.waitForTimeout(150);
await page.click(cell(0, 0), { button: 'right' });
await page.waitForSelector('.dp-menu button');
await page.click('.dp-menu button:text("列を左に追加")');
await page.waitForSelector('.dp-grid-table');
await page.waitForTimeout(300);
check('1 列目の左に列を足せる', (await firstCol()).trim() === '', `「${await firstCol()}」`);

// セルの一部に色（行や列を足したあとの表では名前付き範囲が崩れるので、開き直す）
await page.goto('file://' + process.cwd() + '/out/editor.html?lang=ja');
await page.waitForTimeout(500);
await page.click('.dp-tab:has-text("用語")');
await page.waitForTimeout(250);
await openGrid();
await page.click(cell(2, 1));
await page.waitForTimeout(150);
await page.keyboard.press('F2');
await page.waitForTimeout(200);
await page.$eval('.dp-grid-input', el => {
  el.setSelectionRange(0, 3);
  el.dispatchEvent(new Event('select', { bubbles: true }));
});
await page.click('.dp-grid .dp-format-swatch[title*="赤"]', { force: true });
await page.waitForTimeout(150);
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
await page.click('.dp-sheet:not([hidden]) .dp-prose p');
await page.waitForTimeout(400);
check('セルの一部に付けた色が描画される',
  await page.isVisible('.dp-table td span[style*="color:#ff0000"]'));

await browser.close();
