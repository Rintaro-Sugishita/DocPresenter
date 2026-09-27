// The clipboard, both ways. A table in a design document usually starts life
// in Excel, and often has to go back for a moment; if the grid cannot take a
// block in and hand one back, it is not a grid anyone will use.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await page.goto('file://' + process.cwd() + '/out/editor.html');
await page.waitForTimeout(400);

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};
const status = () => page.textContent('#status');
const cell = (row, column) => `.dp-grid-table [data-row="${row}"][data-column="${column}"]`;
const read = () => page.evaluate(() => navigator.clipboard.readText());
const write = text => page.evaluate(t => navigator.clipboard.writeText(t), text);
const textOf = (row, column) => page.textContent(cell(row, column));

await page.click('.dp-tab[data-index="5"]');
await page.waitForTimeout(250);
await page.click('.dp-sheet:not([hidden]) .dp-figure-body');
await page.waitForSelector('.dp-grid-table');
await page.waitForTimeout(250);

// --- 表 → 表計算 ---------------------------------------------------------
await page.click(cell(0, 0));
await page.waitForTimeout(150);
await page.keyboard.press('Shift+ArrowRight');
await page.keyboard.press('Shift+ArrowDown');
await page.waitForTimeout(150);
await page.keyboard.press('Control+c');
await page.waitForTimeout(250);
const copied = await read();
check('選んだ範囲がタブ区切りで出る', copied.split('\n').length === 2 && copied.includes('\t'),
  JSON.stringify(copied));
check('中身はセルの文字そのもの', copied.split('\n')[0].split('\t')[0] === (await textOf(0, 0)).trim(),
  copied.split('\n')[0]);

// 見出しも範囲に入る
await page.click(cell(-1, 0));
await page.waitForTimeout(150);
await page.keyboard.press('Shift+ArrowRight');
await page.keyboard.press('Control+c');
await page.waitForTimeout(250);
check('見出し行もコピーできる', (await read()).split('\t').length === 2, JSON.stringify(await read()));

// --- 表計算 → 表 ---------------------------------------------------------
await write('あ\tい\nう\tえ');
await page.click(cell(0, 0));
await page.waitForTimeout(150);
await page.keyboard.press('Control+v');
await page.waitForTimeout(400);
check('貼り付けは 1 回の書き換えとして入る', (await status()).includes('貼り付け'), await status());
check('貼り付けた値が並ぶ',
  (await textOf(0, 0)).trim() === 'あ' && (await textOf(1, 1)).trim() === 'え',
  `${(await textOf(0, 0)).trim()} / ${(await textOf(1, 1)).trim()}`);

// はみ出す塊は表を広げる
const rows = () => page.$$eval('.dp-grid-table tbody tr', rs => rs.length);
const before = await rows();
await write('1\t2\n3\t4\n5\t6');
await page.click(cell(before - 1, 0));
await page.waitForTimeout(150);
await page.keyboard.press('Control+v');
await page.waitForTimeout(400);
check('はみ出した分だけ行が増える', (await rows()) === before + 2, `${before} → ${await rows()}`);

// --- 切り取り -----------------------------------------------------------
await page.click(cell(0, 0));
await page.waitForTimeout(150);
await page.keyboard.press('Shift+ArrowRight');
await page.keyboard.press('Control+x');
await page.waitForTimeout(400);
check('切り取りも同じ形で出る', (await read()).includes('\t'), JSON.stringify(await read()));
check('切り取った範囲は空になる',
  (await textOf(0, 0)).trim() === '' && (await textOf(0, 1)).trim() === '',
  JSON.stringify([(await textOf(0, 0)).trim(), (await textOf(0, 1)).trim()]));
check('切り取りも 1 回の書き換え', (await status()).includes('内容を消去'), await status());

// --- セルを開いているときはセルの文字の話 ---------------------------------
await page.dblclick(cell(1, 0));
await page.waitForTimeout(250);
await page.keyboard.press('Control+a');
await page.keyboard.press('Control+c');
await page.waitForTimeout(250);
const inCell = await read();
check('セルを開いている間はその文字がコピーされる', !inCell.includes('\t') && inCell !== '',
  JSON.stringify(inCell));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// ソースを読んで、書かれた形を確かめる
await page.click('.dp-grid-bar button[title*="ソースを直接"]');
await page.waitForSelector('.dp-block-source');
const source = await page.inputValue('.dp-block-source');
check('貼り付けた値がファイルにある', source.includes('| 1 ') && source.includes('| 6 '),
  source.split('\n').filter(l => l.includes('| 1 ')).join(' / '));
check('グリッドの形は保たれている', /^\| *\S+ *\|/m.test(source));

await browser.close();
