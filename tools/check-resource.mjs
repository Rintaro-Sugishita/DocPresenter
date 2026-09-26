// Editing a figure and a table, and the Enter binding. A figure is a file of
// its own, so what matters is that the edit lands in that file and the drawing
// is redrawn from it — not that a box opened.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await page.goto('file://' + process.cwd() + '/out/editor.html');
await page.waitForTimeout(400);

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};
const status = () => page.textContent('#status');
const sheet = n => page.click(`.dp-tab[data-index="${n}"]`);

// --- 図 -----------------------------------------------------------------
await sheet(2);
await page.waitForTimeout(200);
await page.click('.dp-sheet:not([hidden]) .dp-figure-body');
await page.waitForTimeout(200);
const opened = await page.inputValue('.dp-block-source');
check('図をクリックすると .dgm のソースが開く', opened.includes('free {'), opened.slice(0, 12));
check('開くのはファイル全体', opened.trimEnd().endsWith('}'));

await page.$eval('.dp-block-source', el => {
  el.value = el.value.replace('[Web フロント]', '[Web フロント（新）]');
});
await page.click('.dp-tabbar-spacer');
await page.waitForTimeout(400);
check('図が書き換えた内容で描き直される',
  (await page.textContent('.dp-sheet:not([hidden]) svg')).includes('Web フロント（新）'));
check('書き戻し先はその図のファイル',
  (await status()).includes('system-architecture.dgm') && (await status()).includes('ソースを編集'),
  await status());
check('本文のソースは変わらない',
  !(await page.textContent('#source')).includes('Web フロント（新）'));

// 壊れた図はページごと落とさず、その場に出す
await page.click('.dp-sheet:not([hidden]) .dp-figure-body');
await page.waitForTimeout(200);
await page.$eval('.dp-block-source', el => { el.value = 'free {\n  a ?? b\n}'; });
await page.click('.dp-tabbar-spacer');
await page.waitForTimeout(400);
check('壊れた図はその場で理由を出す', await page.isVisible('.dp-broken'),
  (await page.textContent('.dp-broken').catch(() => '')) ?? '');
check('ほかのシートは無事', (await page.$$('.dp-sheet')).length === 5);

// --- キャプション（= @import 行）------------------------------------------
await page.click('.dp-sheet:not([hidden]) .dp-caption');
await page.waitForTimeout(200);
const line = await page.inputValue('.dp-block-source');
check('キャプションをクリックすると @import 行が開く', line.startsWith('@import'), line.slice(0, 20));
await page.keyboard.press('Escape');

// --- 表 -----------------------------------------------------------------
// 表はソースではなくグリッドで開く（check-grid.mjs で詳しく見る）。
await sheet(5);
await page.waitForTimeout(250);
await page.click('.dp-sheet:not([hidden]) .dp-figure-body');
await page.waitForTimeout(250);
check('表はソースではなくグリッドで開く',
  await page.isVisible('.dp-grid-table') && !(await page.isVisible('.dp-block-source')));
await page.click('.dp-sheet:not([hidden]) .dp-prose p');
await page.waitForTimeout(200);

// --- 確定キー -------------------------------------------------------------
await sheet(1);
await page.waitForTimeout(250);
await page.click('.dp-prose p');
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForTimeout(100);
check('既定では Enter は改行', await page.isVisible('.dp-block-source'));
await page.keyboard.press('Control+Enter');
await page.waitForTimeout(250);
check('既定では Ctrl+Enter が確定', !(await page.isVisible('.dp-block-source')));

await page.selectOption('#commit-key', 'enter');
await page.waitForTimeout(150);
await page.click('.dp-prose p');
await page.waitForTimeout(200);
await page.keyboard.press('Shift+Enter');
await page.waitForTimeout(100);
check('Enter 確定に変えると Shift+Enter が改行', await page.isVisible('.dp-block-source'));
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
check('Enter 確定に変えると Enter で閉じる', !(await page.isVisible('.dp-block-source')));

// 書式バーは markdown のためのもの。参照ファイルには出さない。
await page.goto('file://' + process.cwd() + '/out/editor.html');
await page.waitForTimeout(400);
await sheet(2);
await page.waitForTimeout(250);
await page.click('.dp-sheet:not([hidden]) .dp-figure-body');
await page.waitForTimeout(250);
check('図の編集中に書式バーは出さない', !(await page.isVisible('.dp-format-bar')));
await page.click('.dp-sheet:not([hidden]) .dp-prose p');
await page.waitForTimeout(250);
check('本文の編集では書式バーが出る', await page.isVisible('.dp-format-bar'));

await browser.close();
