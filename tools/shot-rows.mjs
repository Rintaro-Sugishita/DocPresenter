// A picture of the row buttons for the design notes: a row of the tree picked,
// with the bar that acts on it.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await page.goto('file://' + process.cwd() + '/out/editor.html');
await page.waitForTimeout(500);
await page.click('.dp-tab[data-index="6"]');
await page.waitForTimeout(300);
await page.locator('.dp-sheet:not([hidden]) .dp-figure[data-path$="detail-screen.dgm"] .dp-figure-body').first().click();
await page.waitForSelector('.dp-canvas-bar');
const svg = await page.locator('.dp-sheet:not([hidden]) [data-path$="detail-screen.dgm"] svg.dp-diagram').boundingBox();
await page.mouse.click(svg.x + 92, svg.y + 119 + 2 * 22 + 11);
await page.waitForTimeout(300);
const figure = await page.locator('.dp-figure[data-path="auth-design/detail-screen.dgm"]').boundingBox();
await page.screenshot({ path: 'out/canvas-rows.png', clip: {
  x: figure.x - 8, y: figure.y - 8, width: Math.min(figure.width + 16, 900), height: figure.height + 16,
} });
await browser.close();
console.log('out/canvas-rows.png');
