// Free colour, column widths, and formatting inside a cell.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
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
  await page.waitForTimeout(150);
};
const closeGrid = async () => {
  await page.click('.dp-sheet:not([hidden]) .dp-prose p');
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
};

// --- 本文の文字色 ---------------------------------------------------------
await page.click('.dp-prose p');
await page.waitForTimeout(250);
check('書式バーに色見本が並ぶ', (await page.$$('.dp-format-swatch')).length === 4);
check('意味トークンのボタンは無い', (await page.$$('.dp-format-token')).length === 0);
await page.$eval('.dp-block-source', el => {
  const at = el.value.indexOf('認証機能');
  el.setSelectionRange(at, at + 4);
  el.dispatchEvent(new Event('select', { bubbles: true }));
});
await page.click('.dp-format-swatch[title*="赤"]', { force: true });
await page.waitForTimeout(150);
check('選んだ色が記法として入る',
  (await page.inputValue('.dp-block-source')).includes('[認証機能]{color=#ff0000}'));
// 編集を閉じるのは「外を叩く」動作。叩く先はタブバーの余白ではなくペインの余白に
// する——シートが増えるとタブが並びきって余白は幅 0 になり、叩けなくなるので。
await page.click('.dp-editor-pane', { position: { x: 12, y: 6 } });
await page.waitForTimeout(300);
check('描画は色の付いた span になる',
  await page.isVisible('.dp-prose span[style*="color:#ff0000"]'));

// --- 表の塗りと文字色 -----------------------------------------------------
await page.click('.dp-tab:has-text("用語")');
await page.waitForTimeout(250);
await openGrid();
check('罫線の太線・二重線のボタンは無い',
  (await page.$$('.dp-grid-style button[title*="罫線"]')).length === 0);
check('塗りと文字色の見本が並ぶ', (await page.$$('.dp-grid-swatch')).length === 10);

await page.click(cell(1, 1));
await page.waitForTimeout(150);
await page.click('.dp-grid-swatch[title="塗り: 黄"]');
await page.waitForSelector('.dp-grid-table');
await page.waitForTimeout(250);
check('グリッドの上で塗りが見える',
  await page.$eval(cell(1, 1), el => el.getAttribute('style') ?? '').then(v => v.includes('#fdf0d5')),
  await page.$eval(cell(1, 1), el => el.getAttribute('style') ?? ''));
await page.click(cell(1, 1));
await page.waitForTimeout(150);
await page.click('.dp-grid-swatch[title="文字色: 青"]');
await page.waitForSelector('.dp-grid-table');
await page.waitForTimeout(250);
await closeGrid();
check('描画された表に塗りと文字色が乗る',
  await page.isVisible('.dp-table td[style*="background:#fdf0d5"][style*="color:#0000ff"]'));
await openGrid();

// --- セル内の文字書式 -----------------------------------------------------
await page.click(cell(0, 1));
await page.waitForTimeout(150);
await page.keyboard.press('F2');
await page.waitForTimeout(200);
check('セルを編集すると書式バーが出る', await page.isVisible('.dp-grid .dp-format-bar'));
await page.$eval('.dp-grid-input', el => {
  el.setSelectionRange(0, 3);
  el.dispatchEvent(new Event('select', { bubbles: true }));
});
await page.click('.dp-grid .dp-format-italic', { force: true });
await page.waitForTimeout(150);
check('セルの中に markdown が入る',
  (await page.inputValue('.dp-grid-input')).startsWith('*'),
  await page.inputValue('.dp-grid-input'));
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await closeGrid();
check('セルの markdown が描画に効く', await page.isVisible('.dp-table td em'));
await openGrid();

// --- 列幅のドラッグ -------------------------------------------------------
const head = await page.$(cell(-1, 0));
const box = await head.boundingBox();
await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width + 120, box.y + box.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForSelector('.dp-grid-table');
await page.waitForTimeout(300);
check('ドラッグが 1 回の変更として記録される',
  (await page.textContent('#status')).includes('列幅を変更'), await page.textContent('#status'));
await page.click('.dp-grid-bar button[title*="ソースを直接"]');
await page.waitForSelector('.dp-block-source');
const source = await page.inputValue('.dp-block-source');
check('列幅は割合で書かれる', /col:用語 \{[^}]*width: \d+(\.\d+)?%/.test(source),
  source.split('\n').filter(l => l.includes('width')).join(' / '));
check('塗りと文字色は直値で書かれる',
  /fill: #fdf0d5/.test(source) && /color: #0000ff/.test(source),
  source.split('\n').filter(l => l.includes('#')).join(' / '));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('描画された表に列幅が効く',
  await page.$$eval('.dp-table colgroup col', cols => cols.some(c => (c.getAttribute('style') ?? '').includes('%'))));

await page.screenshot({ path: 'out/colour.png' });
await browser.close();
