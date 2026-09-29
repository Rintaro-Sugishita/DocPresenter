// Table styling from the grid. What matters is that the file gains exactly one
// rule line, written with the selectors the file already uses, that the grid
// above it is untouched, and that the rendered table actually changes.
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
const status = () => page.textContent('#status');
const cell = (row, column) => `.dp-grid-table [data-row="${row}"][data-column="${column}"]`;
const fill = name => `.dp-grid-swatch[title="塗り: ${name}"]`;
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
const press = async (selector) => {
  await page.click(selector);
  await page.waitForSelector('.dp-grid-table');
  await page.waitForTimeout(250);
};

await page.click('.dp-tab:has-text("用語")');
await page.waitForTimeout(250);
await openGrid();
check('スタイルの操作列が出る', await page.isVisible('.dp-grid-style'));
// 縞はテーマの仕事。対象の一覧に出さない
const targets = await page.$$eval('.dp-grid-target option', nodes => nodes.map(n => n.value));
check('縞は「対象」に出ない', !targets.includes('odd') && !targets.includes('even'), targets.join(' / '));
check('対象はセル・行・列・ヘッダの 4 つ', targets.length === 4, String(targets.length));

// このセル（既定の対象）
await page.click(cell(1, 1));
await page.waitForTimeout(150);
await press(fill('黄'));
check('1 回の操作としてソースに書かれる',
  (await status()).includes('スタイルを設定') && (await status()).includes('.table'), await status());
check('付いている色が点灯する',
  await page.getAttribute(fill('黄'), 'aria-pressed') === 'true');

check('グリッドの上でも塗りが見える',
  await page.isVisible('.dp-grid-table td[style*="#fdf0d5"]'));
await closeGrid();
check('描画された表のセルに色が乗る',
  await page.isVisible('.dp-sheet:not([hidden]) .dp-table td[style*="background:#fdf0d5"]'));
await openGrid();

// 押し直すと外れる
await page.click(cell(1, 1));
await page.waitForTimeout(150);
await press(fill('黄'));
check('押し直すと外れる',
  await page.getAttribute(fill('黄'), 'aria-pressed') === 'false');
await closeGrid();
check('描画からも消える',
  !(await page.isVisible('.dp-sheet:not([hidden]) .dp-table td[style*="background:#fdf0d5"]')));
await openGrid();

// 列に文字色（既存の規則に足す）
await page.selectOption('.dp-grid-target', 'column');
await page.click(cell(1, 1));
await page.waitForTimeout(150);
await press('.dp-grid-swatch[title="文字色: 緑"]');
await closeGrid();
check('列の文字色が描画に効く',
  await page.isVisible('.dp-sheet:not([hidden]) .dp-table td[style*="color:#00b400"]'));
await openGrid();

// 行は範囲セレクタで指す
await page.selectOption('.dp-grid-target', 'row');
await page.click(cell(2, 0));
await page.waitForTimeout(150);
await press(fill('青'));
await closeGrid();
check('行の塗りが描画に効く（範囲セレクタ）',
  await page.isVisible('.dp-sheet:not([hidden]) .dp-table tr[style*="background:#e0e8ff"]'));
await openGrid();

// ヘッダ
await page.selectOption('.dp-grid-target', 'header');
await press(fill('灰'));
await closeGrid();
check('ヘッダの塗りが描画に効く',
  await page.isVisible('.dp-sheet:not([hidden]) .dp-table th[style*="background:#eceef1"]'));

// 最後にソースを読んで、記法そのものを確かめる
await openGrid();
await page.click('.dp-grid-bar button[title*="ソースを直接"]');
await page.waitForSelector('.dp-block-source');
const source = await page.inputValue('.dp-block-source');
check('セルは行と列の名前で指される（今は解除済みなので残っていない）',
  !source.includes('cell:リフレッシュトークン'), source.split('\n').filter(l => l.includes('cell:')).join(' / '));
check('列の規則は既存の行に足されている',
  /col:説明 \{[^}]*color: #00b400/.test(source),
  source.split('\n').filter(l => l.includes('col:')).join(' / '));
check('行は範囲セレクタで書かれる',
  /range:アカウントロック\.\.アカウントロック \{ fill: #e0e8ff \}/.test(source),
  source.split('\n').filter(l => l.includes('range:')).join(' / '));
check('ヘッダの規則も 1 行', /header \{[^}]*fill: #eceef1/.test(source),
  source.split('\n').filter(l => l.includes('header')).join(' / '));
check('空の規則が残らない', !/\{\s*\}/.test(source));
check('グリッドには触っていない', source.includes('| アクセストークン'));


await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await openGrid();
await page.screenshot({ path: 'out/grid-style.png' });
await browser.close();
