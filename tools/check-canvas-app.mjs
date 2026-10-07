// The drawing tool standing on its own. This check exists as much for the
// packaging as for the editing: the page it drives is built from the base and
// diagram packages only, so if the drawing tool ever reaches into the document
// engine, this stops working.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await page.goto('file://' + process.cwd() + '/out/canvas-app.html?lang=ja');
await page.waitForTimeout(400);

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};
const node = id => `.dp-canvas-stage [data-node="${id}"]`;
const source = () => page.textContent('#source');
const pinOf = (text, id) => {
  const from = text.indexOf('layout {');
  return text.slice(from, text.indexOf('}', from))
    .split('\n').find(line => line.trim().startsWith(id + ' ')) ?? '';
};

check('図が出る', await page.isVisible('.dp-canvas-stage svg'));
check('操作列が出る', await page.isVisible('.dp-canvas-bar'));
check('ソースが横に出る', (await source()).includes('free {'));

await page.click(node('browser'));
await page.waitForTimeout(200);
check('図形を選べる',
  (await page.textContent('.dp-canvas-where')).startsWith('browser'),
  await page.textContent('.dp-canvas-where'));

const before = await source();
const box = await page.locator(node('browser')).boundingBox();
const factor = await page.$eval('.dp-canvas-stage svg', svg =>
  svg.getBoundingClientRect().width / svg.viewBox.baseVal.width);
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40 * factor, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
const after = await source();
check('ドラッグがソースに書かれる', pinOf(after, 'browser') !== pinOf(before, 'browser'),
  `${pinOf(before, 'browser').trim()} → ${pinOf(after, 'browser').trim()}`);
check('書き換えた範囲が出る', (await page.textContent('#status')).includes('バイトを書き換え'),
  await page.textContent('#status'));

// 図形も部品も、文書エンジン抜きで足せる
await page.click('.dp-canvas-bar button:text("＋ 図形")');
await page.waitForSelector('.dp-menu button');
await page.click('.dp-menu button:text-is("ひし形")');
await page.waitForTimeout(400);
check('図形を足せる', (await source()).includes('branch1 {図形}'),
  (await source()).split('\n').find(l => l.includes('branch1')));

await page.click('.dp-canvas-bar button:text("＋ 部品")');
await page.waitForSelector('.dp-menu button');
// 絵は区分ごとの小窓に入っている。区分を開いてから選ぶ。
await page.hover('.dp-menu:not(.dp-menu-sub) button:text("ネットワーク")');
await page.waitForSelector('.dp-menu-sub button');
await page.click('.dp-menu-sub button:text-is("ルータ")');
await page.waitForTimeout(400);
check('部品も足せる', (await source()).includes('icon: net/router'),
  (await source()).split('\n').find(l => l.includes('icon:')));
check('絵が描かれる', (await page.$$('.dp-canvas-stage .dp-part-art')).length === 1);

// 文字の書式バーも、文書エンジン抜きで動く
await page.dblclick(node('branch1'));
await page.waitForSelector('.dp-canvas-text');
check('書式バーも出る', await page.isVisible('.dp-canvas-format'));
await page.fill('.dp-canvas-text', '判定');
await page.$eval('.dp-canvas-text', el => el.setSelectionRange(0, 2));
await page.dispatchEvent('.dp-canvas-text', 'select');
await page.click('.dp-canvas-format .dp-format-bold');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
check('書式もソースに入る', (await source()).includes('branch1 {**判定**}'),
  (await source()).split('\n').find(l => l.includes('branch1')));

await page.screenshot({ path: 'out/canvas-app.png' });
await browser.close();
