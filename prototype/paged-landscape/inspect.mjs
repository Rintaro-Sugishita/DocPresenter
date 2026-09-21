import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.goto('file://' + process.cwd() + '/doc.html');
await page.addScriptTag({ path: 'node_modules/pagedjs/dist/paged.polyfill.js' });
await page.waitForFunction(() => document.querySelector('.pagedjs_page'), null, { timeout: 60000 });
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const fig = document.querySelector('figure.landscape');
  return {
    pageClasses: [...document.querySelectorAll('.pagedjs_page')].map(el => el.className),
    figureDataPage: fig ? fig.getAttribute('data-page') : null,
    figureComputedPage: fig ? getComputedStyle(fig).page : null,
    figurePageClass: fig?.closest('.pagedjs_page')?.className ?? '(none)',
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
