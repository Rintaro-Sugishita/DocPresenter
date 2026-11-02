// The pictures in the READMEs, in Japanese and English, from the editor demo:
//   node tools/build-editor-demo.mjs && node tools/shot-readme.mjs
// → packages/app-vscode/images/<ja|en>/{1-pages,2-canvas,3-table,4-fields,5-choices}.png
// Chrome is found where it usually is; DOCPRESENTER_CHROMIUM names another.
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const CHROME = [
  process.env.DOCPRESENTER_CHROMIUM,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].find(path => path && existsSync(path));
if (!CHROME) throw new Error('Chrome が見つからない。DOCPRESENTER_CHROMIUM に場所を書く');

const browser = await chromium.launch({ executablePath: CHROME });
const pause = ms => new Promise(done => setTimeout(done, ms));

for (const lang of ['ja', 'en']) {
  const out = name => `packages/app-vscode/images/${lang}/${name}.png`;
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1006, height: 860 }, deviceScaleFactor: 1.5 });
    page.on('pageerror', e => console.log('エラー:', e.message));
    await page.goto(pathToFileURL('out/editor.html').href + `?lang=${lang}`);
    await page.waitForTimeout(600);
    return page;
  };
  const sheet = async (page, index) => {
    await page.click(`.dp-tab[data-index="${index}"]`);
    await page.waitForTimeout(300);
  };
  /** Scrolls so that the figure's top sits `top` pixels below the window's. */
  const bring = async (page, figure, top) => {
    await page.locator(figure).evaluate((node, top) => {
      let box = node.parentElement;
      while (box && box.scrollHeight <= box.clientHeight) box = box.parentElement;
      const scroller = box ?? document.scrollingElement;
      scroller.scrollTop += node.getBoundingClientRect().top - top;
    }, top);
    await page.waitForTimeout(200);
  };
  const LOGIN = '.dp-figure[data-path="auth-design/login-screen.dgm"]';
  const ITEMS = '.dp-figure[data-path="auth-design/screen-items.table"]';

  // 1. The document as pages.
  {
    const page = await open();
    await sheet(page, 2);
    await page.screenshot({ path: out('1-pages') });
    await page.close();
  }

  // 2. A button picked up on the canvas, snapping to a guide.
  {
    const page = await open();
    await sheet(page, 3);
    await bring(page, LOGIN, 260);
    await page.click(`${LOGIN} .dp-figure-body`);
    await page.waitForTimeout(400);
    await bring(page, LOGIN, 180);
    const box = await page.locator(`${LOGIN} .dp-canvas-stage [data-node="submit"]`).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 - 28, { steps: 6 });
    await page.waitForTimeout(150);
    await page.screenshot({ path: out('2-canvas') });
    await page.mouse.up();
    await page.close();
  }

  // 3. The error table as a grid, a merged cell picked.
  {
    const page = await open();
    await sheet(page, 7);
    const table = '.dp-sheet:not([hidden]) .dp-figure';
    await bring(page, table, 200);
    await page.locator(`${table} .dp-figure-body`).first().click();
    await page.waitForTimeout(400);
    await bring(page, table, 120);
    await page.locator('.dp-grid-cell[data-row="0"][data-column="0"]').first().click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: out('3-table'), clip: { x: 0, y: 0, width: 1006, height: 700 } });
    await page.close();
  }

  // 4. A form with its labels moved to the left by the field's menu.
  {
    const page = await open();
    await sheet(page, 3);
    await bring(page, LOGIN, 260);
    await page.click(`${LOGIN} .dp-figure-body`);
    await page.waitForTimeout(400);
    const field = `${LOGIN} .dp-canvas-stage [data-node="idBox"]`;
    await page.click(field, { button: 'right' });
    await page.waitForTimeout(200);
    await page.locator('.dp-menu [role="menuitem"]', { hasText: lang === 'ja' ? 'ラベルを左に' : 'labels on the left' }).click();
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await bring(page, LOGIN, 120);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
    await page.screenshot({ path: out('4-fields'), clip: { x: 0, y: 0, width: 1006, height: 760 } });
    await page.close();
  }

  // 5. The item table offering types for a cell.
  {
    const page = await open();
    await sheet(page, 3);
    await bring(page, ITEMS, 300);
    await page.click(`${ITEMS} .dp-figure-body`);
    await page.waitForTimeout(400);
    await bring(page, ITEMS, 120);
    const column = await page.locator(`${ITEMS} .dp-grid-cell`).evaluateAll(cells =>
      cells.find(cell => ['型', 'Type'].includes(cell.textContent.trim()))?.dataset.column);
    const row = await page.locator(`${ITEMS} .dp-grid-cell`).evaluateAll(cells =>
      cells.find(cell => cell.textContent.trim() === 'pwBox')?.dataset.row);
    await page.click(`${ITEMS} .dp-grid-cell[data-row="${row}"][data-column="${column}"]`);
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForTimeout(300);
    await page.screenshot({ path: out('5-choices'), clip: { x: 0, y: 0, width: 1006, height: 700 } });
    await page.close();
  }
  console.log(lang, 'ok');
}
await browser.close();
