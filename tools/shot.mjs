import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
await page.goto('file://' + process.cwd() + '/out/auth-design.html');
await page.waitForTimeout(500);
await page.screenshot({ path: 'out/auth-design.png', fullPage: true });
const h = await page.evaluate(() => document.body.scrollHeight);
console.log(`描画: out/auth-design.png（高さ ${h}px）`);
await browser.close();
