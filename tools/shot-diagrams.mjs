// Crops each rendered diagram out of the sample so it can actually be looked
// at: a diagram that parses and passes its tests can still be unreadable.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.goto('file://' + process.cwd() + '/out/auth-design.html');
await page.waitForTimeout(400);
const boxes = await page.evaluate(() =>
  [...document.querySelectorAll('.dp-figure')]
    .filter(f => f.querySelector('.dp-diagram, .dp-overlay'))
    .map((f, i) => {
      const r = f.getBoundingClientRect();
      return { name: `dgm-${i}`, x: r.x, y: r.y + scrollY, w: r.width, h: r.height };
    }));
for (const b of boxes) {
  await page.screenshot({
    path: `out/${b.name}.png`, fullPage: true,
    clip: { x: b.x - 8, y: b.y - 8, width: b.w + 16, height: b.h + 16 },
  });
}
console.log(boxes.map(b => `${b.name}: ${Math.round(b.w)}x${Math.round(b.h)}`).join('\n'));
await browser.close();
