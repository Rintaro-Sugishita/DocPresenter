// Writes a block of the editor demo by hand, the way a person would, and
// checks the help a text box gives: Enter carries a list on, Tab and Shift+Tab
// move items, Ctrl+E marks code, and `@` / `@import "` offer what can follow.
// The same rules VS Code's own editor follows (packages/markdown/src/editing.ts).
//
// Run `node tools/build-editor-demo.mjs` first.
import { chromium } from 'playwright-core';
import { findChromium } from './pdf-writer.mjs';

const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await page.goto('file://' + process.cwd().split('\\').join('/') + '/out/editor.html?lang=ja');
await page.waitForTimeout(400);

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};
const box = () => page.$eval('.dp-block-source', area => area.value);
const caret = () => page.$eval('.dp-block-source', area => area.value.slice(0, area.selectionStart) + '|' + area.value.slice(area.selectionEnd));

// 段落を 1 つ開いて、中身を書き直す（最後に Escape で捨てる）
await page.click('.dp-sheet:not([hidden]) .dp-prose');
await page.waitForSelector('.dp-block-source');
await page.keyboard.press('Control+A');
await page.keyboard.type('- 一つ目');
await page.keyboard.press('Enter');
check('Enter で次の項目の記号が入る', (await caret()) === '- 一つ目\n- |', JSON.stringify(await caret()));

await page.keyboard.type('二つ目');
await page.keyboard.press('Tab');
check('Tab で項目が一段下がる', (await box()) === '- 一つ目\n  - 二つ目', JSON.stringify(await box()));
check('Tab で枠から出ない', await page.$('.dp-block-source:focus') !== null);
await page.keyboard.press('Shift+Tab');
check('Shift+Tab で項目が一段上がる', (await box()) === '- 一つ目\n- 二つ目', JSON.stringify(await box()));

await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
check('空の項目で Enter すると箇条書きが終わる', (await caret()) === '- 一つ目\n- 二つ目\n|', JSON.stringify(await caret()));

await page.keyboard.type('値');
await page.keyboard.down('Shift');
await page.keyboard.press('ArrowLeft');
await page.keyboard.up('Shift');
await page.keyboard.press('Control+E');
check('Ctrl+E でコードにする', (await box()).endsWith('`値`'), JSON.stringify(await box()));

// @ の後ろにはラベル
await page.keyboard.press('End');
await page.keyboard.type(' 図は @fig');
await page.waitForTimeout(100);
const offered = await page.$$eval('.dp-suggest:not([hidden]) .dp-suggest-text', rows => rows.map(r => r.textContent));
check('@fig でラベルが出る', offered.length > 0 && offered.every(one => one.startsWith('fig-')), offered.slice(0, 3).join(', '));
await page.keyboard.press('Enter');
check('Enter で選んだラベルが入る', /@fig-[\w-]+$/.test(await box()) && (await box()).endsWith(offered[0]), JSON.stringify((await box()).slice(-30)));
check('選んだら一覧は閉じる', await page.$('.dp-suggest:not([hidden])') === null);

// 行頭の @import "…" にはファイル
await page.keyboard.press('Enter');
await page.keyboard.type('@import "');
await page.waitForTimeout(100);
const files = await page.$$eval('.dp-suggest:not([hidden]) .dp-suggest-text', rows => rows.map(r => r.textContent));
check('@import " でファイルが出る', files.length > 0 && files.some(one => /\.(dgm|table)$/.test(one)), files.slice(0, 3).join(', '));
await page.keyboard.press('Escape');
check('Escape は一覧だけを閉じ、編集は続く', await page.$('.dp-block-source') !== null && await page.$('.dp-suggest:not([hidden])') === null);

await page.keyboard.press('Escape');
check('もう一度 Escape で、書いたものを捨てて閉じる', await page.$('.dp-block-source') === null);
await browser.close();
