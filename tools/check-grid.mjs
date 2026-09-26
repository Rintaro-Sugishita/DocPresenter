// The grid editor. Each gesture has to land in the .table file as the right
// bytes; a grid that looks right but writes a ragged or wrong file is the
// failure this catches.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 880 } });
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await page.goto('file://' + process.cwd() + '/out/editor.html');
await page.waitForTimeout(400);

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};
// 用語集のシートを開き、表のグリッドを出す
const openGrid = async () => {
  await page.click('.dp-tab[data-index="5"]');
  await page.waitForTimeout(250);
  await page.click('.dp-sheet:not([hidden]) .dp-figure-body');
  await page.waitForTimeout(300);
};
const cell = (row, column) => `.dp-grid-table [data-row="${row}"][data-column="${column}"]`;
const status = () => page.textContent('#status');

await openGrid();
check('表をクリックするとグリッドが出る（ソースではない）',
  await page.isVisible('.dp-grid-table') && !(await page.isVisible('.dp-block-source')));
check('見出しも編集対象として並ぶ', (await page.textContent(cell(-1, 0))).trim() === '用語');

// 行の追加と削除
const rowsNow = () => page.$$eval('.dp-grid-table tbody tr', rs => rs.length);
const before = await rowsNow();
await page.click('.dp-grid-bar button[title*="行の下に追加"]');
await page.waitForTimeout(350);
check('行を足せる', (await rowsNow()) === before + 1, `${before} → ${await rowsNow()}`);
await page.click('.dp-grid-bar button[title*="行を削除"]');
await page.waitForTimeout(350);
check('行を消せる', (await rowsNow()) === before);

// 列の追加
const colsNow = () => page.$$eval('.dp-grid-table thead th', hs => hs.length);
const cols = await colsNow();
await page.click('.dp-grid-bar button[title*="列の右に追加"]');
await page.waitForTimeout(350);
check('列を足すと全行に入る', (await colsNow()) === cols + 1, `${cols} → ${await colsNow()}`);
await page.click('.dp-grid-bar button[title*="列を削除"]');
await page.waitForTimeout(350);
check('列を消せる', (await colsNow()) === cols);

// セル編集: 打ち始めると置き換わる
await page.click(cell(0, 1));
await page.waitForTimeout(120);
await page.keyboard.type('認可に使う短命の資格情報');
await page.keyboard.press('Enter');
await page.waitForTimeout(350);
check('打ち始めると中身が置き換わる',
  (await page.textContent(cell(0, 1))).includes('認可に使う短命'), await page.textContent(cell(0, 1)));
check('書き戻し先は .table のファイル',
  (await status()).includes('.table') && (await status()).includes('セルを編集'), await status());
check('Enter で下のセルへ進む',
  await page.getAttribute(cell(1, 1), 'class').then(c => c.includes('dp-grid-at')));

// 矢印で移動、F2 で編集
await page.keyboard.press('ArrowUp');
await page.waitForTimeout(200);
check('矢印で移動する',
  await page.getAttribute(cell(0, 1), 'class').then(c => c.includes('dp-grid-at')));

// 寄せ
await page.click(cell(0, 1));
await page.waitForTimeout(120);
await page.click('.dp-grid-bar button[title*="右寄せ"]');
await page.waitForTimeout(350);
check('寄せは列全体に効く',
  await page.getAttribute(cell(0, 1), 'class').then(c => c.includes('dp-align-right')));

// 整形は明示したときだけ
await page.click('.dp-grid-bar button[title*="桁を揃える"]');
await page.waitForTimeout(350);
check('整形は独立した操作として出る', (await status()).includes('表を整形'), await status());

// ソースへの逃げ道
await page.click('.dp-grid-bar button[title*="ソースを直接"]');
await page.waitForTimeout(300);
const source = await page.inputValue('.dp-block-source');
check('ソースにも切り替えられる', source.includes('|'));
// 桁は表示幅で揃う。和文は 2 桁なので JS の文字数では揃わない。
const width = text => [...text].reduce((w, c) =>
  w + (/[\u3000-\u9FFF\uFF00-\uFF60]/.test(c) ? 2 : 1), 0);
const gridRows = source.split('\n').filter(l => l.startsWith('|'));
check('整形した結果が桁の揃ったソースになっている',
  gridRows.every(l => width(l) === width(gridRows[0])),
  gridRows.map(width).join(' / '));
check('編集した値がファイルに入っている', source.includes('認可に使う短命の資格情報'));
check('グリッド以外の節は残っている', source.includes('style {') && source.includes('range {'));

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await openGrid();
await page.screenshot({ path: 'out/grid.png' });
await browser.close();
