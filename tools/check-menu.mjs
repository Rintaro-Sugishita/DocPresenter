// Selecting text with the mouse inside a cell, and the row/column menu.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1320, height: 880 } });
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

await page.click('.dp-tab:has-text("用語")');
await page.waitForTimeout(250);
await openGrid();

// ツールバーが軽くなっている
check('行・列のボタンはツールバーから消えた',
  (await page.$$eval('.dp-grid-bar:not(.dp-grid-style) button', bs => bs.map(b => b.textContent)))
    .join(' ') === '左 中 右 ソース整形 ソース',
  (await page.$$eval('.dp-grid-bar:not(.dp-grid-style) button', bs => bs.map(b => b.textContent).join(' '))));

// マウスで文字を選択できる
await page.dblclick(cell(0, 1));
await page.waitForTimeout(250);
const box = await (await page.$('.dp-grid-input')).boundingBox();
await page.mouse.move(box.x + 6, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(200);
const picked = await page.$eval('.dp-grid-input', el => el.value.slice(el.selectionStart, el.selectionEnd));
check('マウスのドラッグで文字を選べる', picked.length > 0, `「${picked}」`);
check('ドラッグしても編集は続いている', await page.isVisible('.dp-grid-input'));

// 選んだ範囲に色を付けられる
await page.click('.dp-grid .dp-format-swatch[title*="赤"]', { force: true });
await page.waitForTimeout(200);
check('選んだ範囲に色が付く',
  (await page.inputValue('.dp-grid-input')).includes('{color=#ff0000}'),
  (await page.inputValue('.dp-grid-input')).slice(0, 40));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// 右クリックのメニュー
await page.click(cell(1, 0), { button: 'right' });
await page.waitForTimeout(250);
check('右クリックでメニューが出る', await page.isVisible('.dp-menu'));
check('行と列とセル結合の操作が並ぶ',
  (await page.$$eval('.dp-menu button', bs => bs.map(b => b.textContent))).join('/')
    === '行を上に追加/行を下に追加/行を削除/列を左に追加/列を右に追加/列を削除'
      + '/選択範囲を結合/下のセルと結合/右のセルと結合/結合を解除',
  (await page.$$eval('.dp-menu button', bs => bs.map(b => b.textContent))).join('/'));

const rows = () => page.$$eval('.dp-grid-table tbody tr', r => r.length);
const before = await rows();
await page.click('.dp-menu button:text("行を上に追加")');
await page.waitForSelector('.dp-grid-table');
await page.waitForTimeout(300);
check('メニューから行を足せる', (await rows()) === before + 1, `${before} → ${await rows()}`);
check('選んだあとメニューは閉じる', !(await page.isVisible('.dp-menu')));

// Escape で閉じる
await page.click(cell(1, 0), { button: 'right' });
await page.waitForTimeout(200);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('Escape で閉じる', !(await page.isVisible('.dp-menu')));

// 外をクリックしても閉じる
await page.click(cell(1, 0), { button: 'right' });
await page.waitForTimeout(200);
await page.click(cell(2, 1));
await page.waitForTimeout(250);
check('外を押しても閉じる', !(await page.isVisible('.dp-menu')));
check('メニューを閉じた押下は表に届かない',
  await page.getAttribute(cell(1, 0), 'class').then(c => c.includes('dp-grid-at')),
  await page.$eval('.dp-grid-at', el => `${el.dataset['row']},${el.dataset['column']}`));

// 編集中はブラウザのメニュー（コピー・貼り付け）に譲る
await page.dblclick(cell(2, 1));
await page.waitForTimeout(250);
await page.click(cell(2, 1), { button: 'right' });
await page.waitForTimeout(250);
check('編集中は自前のメニューを出さない', !(await page.isVisible('.dp-menu')));

await browser.close();
