// Runs Paged.js over the document in Chromium and reports the size of each
// resulting page box, to see whether portrait and landscape can coexist.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.goto('file://' + process.cwd() + '/doc.html');
await page.addScriptTag({ path: 'node_modules/pagedjs/dist/paged.polyfill.js' });
await page.waitForFunction(() => window.PagedPolyfill && document.querySelector('.pagedjs_page'), null, { timeout: 60000 });
await page.waitForTimeout(1500);

const pages = await page.evaluate(() =>
  [...document.querySelectorAll('.pagedjs_page')].map((el, i) => {
    const area = el.querySelector('.pagedjs_page_content');
    const r = el.getBoundingClientRect();
    return {
      no: i + 1,
      名前: el.getAttribute('data-page-type') || (el.className.match(/pagedjs_(\w+)_page/)?.[1] ?? ''),
      幅: Math.round(r.width), 高さ: Math.round(r.height),
      向き: r.width > r.height ? '横' : '縦',
      先頭: (area?.innerText || '').trim().split('\n')[0]?.slice(0, 24) ?? '',
    };
  })
);
console.table(pages);
await page.screenshot({ path: 'paged.png', fullPage: true });
await browser.close();
