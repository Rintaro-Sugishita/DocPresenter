// Screenshots the editor demo so the sheet tabs can be looked at.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
page.on('pageerror', e => console.log('エラー:', e.message));
await page.goto('file://' + process.cwd() + '/out/editor.html');
await page.waitForTimeout(600);
const tabs = await page.$$eval('.dp-tab', ts => ts.map(t => t.textContent));
console.log('タブ:', tabs.join(' | '));
await page.screenshot({ path: 'out/editor.png' });
await browser.close();
