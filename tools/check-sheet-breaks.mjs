// Verifies that a sheet boundary really starts a new page when printed.
// CSS that looks right on screen can be ignored by the paginator, so this
// prints the sample and counts the pages rather than trusting the stylesheet.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.goto('file://' + process.cwd() + '/out/auth-design.html');
const sheets = await page.evaluate(() => document.querySelectorAll('.dp-sheet').length);
await page.pdf({ path: 'out/auth-design.pdf', format: 'A4', printBackground: true });

// 同じ内容をシート 1 枚にまとめたものと比べる。
await page.evaluate(() => {
  const all = [...document.querySelectorAll('.dp-sheet')];
  for (const s of all.slice(1)) { all[0].append(...s.childNodes); s.remove(); }
});
await page.pdf({ path: 'out/auth-design-flat.pdf', format: 'A4', printBackground: true });
await browser.close();

const pages = f => (readFileSync(f).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
console.log(`シート ${sheets} 枚 → ${pages('out/auth-design.pdf')} ページ`);
console.log(`1 枚にまとめると → ${pages('out/auth-design-flat.pdf')} ページ`);
