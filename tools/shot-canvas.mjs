// A picture of the canvas for the design notes: a shape picked up, mid-drag,
// with the guide it snapped to.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
await page.goto('file://' + process.cwd() + '/out/editor.html?lang=ja');
await page.waitForTimeout(400);
await page.click('.dp-tab[data-index="3"]');
await page.waitForTimeout(250);
const figures = await page.$$('.dp-sheet:not([hidden]) .dp-figure-body');
await figures[2].click();               // ログイン画面（画面設計）
await page.waitForTimeout(300);
const box = await page.locator('.dp-canvas-stage [data-node="submit"]').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 - 28, { steps: 6 });
await page.waitForTimeout(150);
const figure = await page.locator('.dp-figure[data-path="auth-design/login-screen.dgm"]').boundingBox();
await page.screenshot({ path: 'out/canvas-drag.png', clip: {
  x: figure.x - 8, y: figure.y - 8, width: Math.min(figure.width + 16, 900), height: figure.height + 16,
} });
await page.mouse.up();
await browser.close();
console.log('out/canvas-drag.png');
