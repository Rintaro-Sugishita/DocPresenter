// The table has to stay alive after its source has been opened and abandoned.
// A restored snapshot of the grid looks identical and does nothing.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await page.goto('file://' + process.cwd() + '/out/editor.html');
await page.waitForTimeout(400);
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};
const cell = (row, column) => `.dp-grid-table [data-row="${row}"][data-column="${column}"]`;

await page.click('.dp-tab:has-text("用語")');
await page.waitForTimeout(250);
await page.click('.dp-sheet:not([hidden]) .dp-figure-body');
await page.waitForSelector('.dp-grid-table');

// ソースを開いて、何も書かずに離れる
await page.click('.dp-grid-bar button[title*="ソースを直接"]');
await page.waitForSelector('.dp-block-source');
await page.click('.dp-tabbar-spacer');
await page.waitForTimeout(400);
check('ソースを閉じると表が描き直される',
  await page.isVisible('.dp-sheet:not([hidden]) .dp-table'),
  (await page.isVisible('.dp-grid-table')) ? 'グリッドが残っている' : '');

// 表をもう一度開いて操作できる
await page.click('.dp-sheet:not([hidden]) .dp-figure-body');
await page.waitForSelector('.dp-grid-table');
await page.click(cell(0, 1));
await page.waitForTimeout(150);
await page.keyboard.type('abc');
await page.keyboard.press('Enter');
await page.waitForTimeout(350);
check('セルがまた編集できる', (await page.textContent(cell(0, 1))).includes('abc'),
  await page.textContent(cell(0, 1)));

// ボタンも生きている
const rows = () => page.$$eval('.dp-grid-table tbody tr', r => r.length);
const before = await rows();
await page.click(cell(0, 0), { button: 'right' });
await page.waitForSelector('.dp-menu button');
await page.click('.dp-menu button:text("行を下に追加")');
await page.waitForSelector('.dp-grid-table');
await page.waitForTimeout(350);
check('ボタンも生きている', (await rows()) === before + 1, `${before} → ${await rows()}`);

// Escape で閉じた場合も同じ
await page.click('.dp-grid-bar button[title*="ソースを直接"]');
await page.waitForSelector('.dp-block-source');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.click('.dp-sheet:not([hidden]) .dp-figure-body');
await page.waitForSelector('.dp-grid-table');
await page.click(cell(0, 0));
await page.waitForTimeout(150);
check('Escape で閉じたあとも操作できる',
  await page.getAttribute(cell(0, 0), 'class').then(c => c.includes('dp-grid-at')));

await browser.close();
