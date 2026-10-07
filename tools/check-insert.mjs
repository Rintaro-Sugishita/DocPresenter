// Adding a table and a diagram to a sheet, and the height of an empty row.
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
const sheetFigures = () => page.$$eval('.dp-sheet:not([hidden]) .dp-figure', f => f.length);

await page.click('.dp-tab[data-index="1"]');
await page.waitForTimeout(300);
check('ブロックごとに追加できる場所がある',
  (await page.$$('.dp-sheet:not([hidden]) .dp-append')).length >= 3,
  `${(await page.$$('.dp-sheet:not([hidden]) .dp-append')).length} 箇所`);

// 最初のブロックの直後に入れる（末尾ではない位置）
const before = await sheetFigures();
await page.click('.dp-sheet:not([hidden]) .dp-append:first-of-type .dp-append-add:text("表")');
await page.waitForTimeout(500);
check('表が 1 つ増える', (await sheetFigures()) === before + 1, `${before} → ${await sheetFigures()}`);
check('本文に @import が書かれる',
  (await page.textContent('#source')).includes('@import "auth-design/table-1.table"'));
check('末尾ではなく、押した場所に入る', await (async () => {
  const src = await page.textContent('#source');
  // 押したのは表題の直後なので、最初の見出しより前にある。
  return src.indexOf('@import "auth-design/table-1.table"') < src.indexOf('## 概要');
})());
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
check('増えた図はそのまま動かせる形で開ける',
  await (async () => {
    await page.click('.dp-sheet:not([hidden]) .dp-figure[data-path*=".dgm"] .dp-figure-body');
    await page.waitForTimeout(300);
    return await page.isVisible('.dp-canvas-stage svg')
      && await page.isVisible('.dp-canvas-bar button:text("自動配置に戻す")');
  })());



// --- すでにある図表を参照する ---------------------------------------------
await page.goto('file://' + process.cwd() + '/out/editor.html?lang=ja');
await page.waitForTimeout(500);
await page.click('.dp-tab[data-index="1"]');
await page.waitForTimeout(300);
check('「＋ 参照」がある',
  await page.isVisible('.dp-sheet:not([hidden]) .dp-append-add:text("参照")'));

await page.click('.dp-sheet:not([hidden]) .dp-append:first-of-type .dp-append-add:text("参照")');
await page.waitForSelector('.dp-menu button');
const listed = await page.$$eval('.dp-menu button', bs => bs.map(b => b.textContent));
check('すでにある図表が並ぶ', listed.length >= 5, `${listed.length} 件: ${listed.slice(0, 3).join(' / ')}`);
check('共有のものも選べる', listed.some(t => t.includes('shared/')), listed.at(-1));

await page.click('.dp-menu button:text("system-architecture.dgm")');
await page.waitForTimeout(500);
check('参照した図が入る',
  (await page.textContent('#source')).includes('@import "../shared/system-architecture.dgm"'));
check('新しいファイルは作られない',
  !(await page.textContent('#status')).includes('を作成'), await page.textContent('#status'));
check('参照した図が描画される',
  (await page.$$('.dp-sheet:not([hidden]) .dp-figure')).length === 1);

await browser.close();
