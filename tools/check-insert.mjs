// Adding a table and a diagram to a sheet, and the height of an empty row.
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
const sheetFigures = () => page.$$eval('.dp-sheet:not([hidden]) .dp-figure', f => f.length);

await page.click('.dp-tab[data-index="1"]');
await page.waitForTimeout(300);
check('シート末尾に「＋ 表」「＋ 図」がある',
  (await page.$$eval('.dp-sheet:not([hidden]) .dp-append-add', b => b.map(x => x.textContent))).join('/')
    === '＋ 表/＋ 図');

const before = await sheetFigures();
await page.click('.dp-sheet:not([hidden]) .dp-append-add:text("表")');
await page.waitForTimeout(500);
check('表が 1 つ増える', (await sheetFigures()) === before + 1, `${before} → ${await sheetFigures()}`);
check('本文に @import が書かれる',
  (await page.textContent('#source')).includes('@import "auth-design/table-1.table"'));
check('新しい表が描画される',
  await page.isVisible('.dp-sheet:not([hidden]) .dp-figure[data-path*="table-1.table"] table'));

// 中身のない行でも高さがある
await page.click('.dp-sheet:not([hidden]) .dp-figure[data-path*="table-1.table"] .dp-figure-body');
await page.waitForSelector('.dp-grid-table');
await page.waitForTimeout(250);
const emptyRow = await page.$eval('.dp-grid-table tbody tr', el => el.getBoundingClientRect().height);
check('空の行にも高さがある', emptyRow >= 20, `${Math.round(emptyRow)}px`);
await page.click('.dp-sheet:not([hidden]) .dp-prose p');
await page.waitForTimeout(400);
const renderedRow = await page.$eval('.dp-figure[data-path*="table-1.table"] tbody tr',
  el => el.getBoundingClientRect().height);
check('描画された空の行にも高さがある', renderedRow >= 18, `${Math.round(renderedRow)}px`);

// 図
await page.click('.dp-sheet:not([hidden]) .dp-append-add:text("図")');
await page.waitForTimeout(500);
check('図も増える',
  await page.isVisible('.dp-sheet:not([hidden]) .dp-figure[data-path*=".dgm"] svg'));
check('図はそのままソースで開ける',
  await (async () => {
    await page.click('.dp-sheet:not([hidden]) .dp-figure[data-path*=".dgm"] .dp-figure-body');
    await page.waitForTimeout(300);
    return (await page.inputValue('.dp-block-source')).includes('free {');
  })());

await browser.close();
