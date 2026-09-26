// Narrow screens. The pane that explains the editing must not replace it.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

for (const [label, size] of [['携帯', { width: 390, height: 780 }], ['机上', { width: 1320, height: 860 }]]) {
  const page = await browser.newPage({ viewport: size });
  page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
  await page.goto('file://' + process.cwd() + '/out/artifact/index.html');
  await page.waitForTimeout(1200);
  const narrow = size.width < 820;

  check(`${label}: ソースは${narrow ? '隠れている' : '出ている'}`,
    (await page.isVisible('#side')) === !narrow);
  const width = await page.$eval('#editor', el => Math.round(el.getBoundingClientRect().width));
  check(`${label}: 編集ペインが画面を使える`, narrow ? width >= size.width - 8 : width > 700, `${width}px`);

  if (narrow) {
    check('携帯: 見出しは 1 行に収まる',
      await page.$eval('.bar', el => Math.round(el.getBoundingClientRect().height)) < 60,
      `${await page.$eval('.bar', el => Math.round(el.getBoundingClientRect().height))}px`);
    await page.click('#toggle-source');
    await page.waitForTimeout(300);
    check('携帯: 押すとソースが出る', await page.isVisible('#side'));
    check('携帯: 出しても編集ペインは残る',
      await page.isVisible('.dp-editor-pane'));
    await page.click('#toggle-source');
    await page.waitForTimeout(300);
    check('携帯: もう一度押すと閉じる', !(await page.isVisible('#side')));
    // 表の編集が携帯でも届く
    await page.click('.dp-tab[data-index="5"]');
    await page.waitForTimeout(300);
    await page.click('.dp-sheet:not([hidden]) .dp-figure-body');
    await page.waitForSelector('.dp-grid-table');
    check('携帯: 表のグリッドが開く', await page.isVisible('.dp-grid-table'));
    check('携帯: 横にはみ出さない',
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      await page.evaluate(() => `${document.documentElement.scrollWidth} / ${window.innerWidth}`));
  }
  await page.close();
}
await browser.close();
