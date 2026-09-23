import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await page.goto('file://' + process.cwd() + '/out/auth-design.html');
await page.waitForTimeout(400);
// 用語集（部分参照した表）と項目定義表を切り出す
const box = await page.evaluate(() => {
  const tables = [...document.querySelectorAll('.dp-figure')].filter(f => f.querySelector('table'));
  const first = tables[0].getBoundingClientRect(), last = tables.at(-1).getBoundingClientRect();
  return { items: { x: first.x, y: first.y + scrollY, w: first.width, h: first.height },
           glossary: { x: last.x, y: last.y + scrollY, w: last.width, h: last.height } };
});
for (const [name, b] of Object.entries(box)) {
  await page.screenshot({ path: `out/${name}.png`, clip: { x: b.x - 10, y: b.y - 10, width: b.w + 20, height: b.h + 30 }, fullPage: true });
}
console.log('切り出し完了');
await browser.close();
