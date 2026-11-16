// Opening a long block for editing keeps the reader where they were.
//
// The block's source takes its place, and the caret goes near what was
// pressed — not to the end of the block, which for a long one is off the
// screen, and not to the top of the page, where measuring the box's height
// used to send the scroll.
//
// Usage: node tools/check-edit-scroll.mjs [--chromium <path>]   (after node tools/build-editor-demo.mjs)
import { chromium } from 'playwright-core';
import { findChromium } from './pdf-writer.mjs';

const option = name => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

const browser = await chromium.launch({ executablePath: findChromium(option('--chromium')) });
const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await page.goto('file:///' + process.cwd().split('\\').join('/') + '/out/editor.html?lang=ja');
await page.waitForTimeout(500);

// A paragraph of 60 lines, taller than the screen.
await page.click('.dp-sheet:not([hidden]) .dp-prose');
await page.evaluate(() => {
  const area = document.querySelector('textarea.dp-block-source');
  area.value = Array.from({ length: 60 }, (_, i) => `長い段落の ${i + 1} 行目`).join('\n');
  area.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.keyboard.press('Control+Enter');
await page.waitForTimeout(400);
await page.evaluate(() => {
  const blocks = [...document.querySelectorAll('.dp-sheet:not([hidden]) .dp-prose')];
  blocks.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
  blocks[0].id = 'dp-longest';
  blocks[0].scrollIntoView({ block: 'start' });
});
await page.waitForTimeout(200);

const pane = page.locator('.dp-editor-pane');
const box = await page.locator('#dp-longest').boundingBox();
const before = await pane.evaluate(node => node.scrollTop);
await page.mouse.click(box.x + 30, box.y + 40);
await page.waitForTimeout(300);
const after = await pane.evaluate(node => node.scrollTop);
const area = await page.locator('textarea.dp-block-source').boundingBox();
check('長い段落を開いても、画面の位置は変わらない', Math.abs(after - before) < 40, `${before} → ${after}`);
check('　開いた欄は画面の中にある', area.y > -50 && area.y < 700, String(Math.round(area.y)));
const line = await page.evaluate(() => {
  const a = document.querySelector('textarea.dp-block-source');
  return a.value.slice(0, a.selectionStart).split('\n').length;
});
check('　カーソルは押した行の辺りに来る（末尾ではない）', line <= 4, `${line} 行目`);

// Typing at the top of a long box does not move the page either.
await page.keyboard.type('追記');
await page.waitForTimeout(200);
check('長い欄で入力しても、画面の位置は変わらない',
  Math.abs((await pane.evaluate(node => node.scrollTop)) - after) < 40);

await browser.close();
