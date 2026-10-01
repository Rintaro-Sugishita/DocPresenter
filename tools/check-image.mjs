// Bringing a picture into a document, and saying how big it is and where it sits.
//
// Four gestures, one outcome: a line of the document changes. That is the thing
// worth checking — not that a handle appeared, but that dragging it wrote
// `width="…"` into the `@import` that placed the picture, because the source is
// what gets committed and reviewed.
import { chromium } from 'playwright-core';

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await page.goto('file://' + process.cwd() + '/out/editor.html');
await page.waitForTimeout(500);

const source = () => page.textContent('#source');

// 1x1 の PNG。中身は何でもよく、見たいのは「バイトが来たらファイルになる」こと。
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 本物のクリップボードは渡せないので、貼り付けの出来事そのものを組み立てる。 */
const paste = async base64 => page.evaluate(async data => {
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  const file = new File([bytes], 'screen.png', { type: 'image/png' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  document.querySelector('.dp-editor-pane').dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 300));
}, base64);

// --- 貼り付け ---------------------------------------------------------------
await page.click('.dp-tab:has-text("用語")');
await page.waitForTimeout(250);
await paste(PNG);
await page.waitForTimeout(300);
const written = await source();
const line = /@import "[^"]*auth-design\/screen\.png"[^\n]*/.exec(written);
check('貼り付けると取り込み行が書かれる', line !== null, line?.[0]);
check('画像が描かれている', (await page.$$('.dp-figure img')).length > 0);

// --- 寄せ -------------------------------------------------------------------
const figure = '.dp-sheet:not([hidden]) .dp-figure[data-path$="auth-design/screen.png"]';
// 画像そのものを叩く。figure の中身は小さく、枠の中心は画像の上にある。
const open = async () => {
  await page.locator(figure).first().locator('img').click();
  await page.waitForSelector('.dp-picture-bar');
};
await open();
check('画像を押すと操作が出る', await page.isVisible('.dp-picture-handle'));
check('ソースは開かない', (await page.$$('.dp-block-source')).length === 0);

await page.click('.dp-picture-bar button:has-text("中央")');
await page.waitForTimeout(250);
check('中央に寄せると属性が書かれる', /auth-design\/screen\.png" \{align="center"\}/.test(await source()),
  (/@import "[^"]*auth-design\/screen\.png"[^\n]*/.exec(await source()) ?? [''])[0]);
check('描画にも効く',
  await page.getAttribute(figure, 'data-align') === 'center');

await open();
await page.click('.dp-picture-bar button:has-text("左")');
await page.waitForTimeout(250);
check('左は既定なので属性ごと消える', !/auth-design\/screen\.png" \{align=/.test(await source()),
  (/@import "[^"]*auth-design\/screen\.png"[^\n]*/.exec(await source()) ?? [''])[0]);

// --- 幅 ---------------------------------------------------------------------
await open();
const box = await page.locator('.dp-picture-handle').boundingBox();
const column = await page.locator(figure).evaluate(node => node.parentElement.clientWidth);
// つまみは本体の右端にある。本体は版面いっぱいなので、つまみの位置がそのまま
// 「版面に対する幅」を表している——縮めるのは左へ引く動きである。
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x - column * 0.5, box.y + box.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
const sized = (/@import "[^"]*auth-design\/screen\.png"[^\n]*/.exec(await source()) ?? [''])[0];
check('端を引くと幅が書かれる', /width="\d+%"/.test(sized), sized);
const percent = Number((/width="(\d+)%"/.exec(sized) ?? [, '0'])[1]);
check('引いた長さと書かれた幅が合っている', percent >= 35 && percent <= 65, `${percent}%`);
check('紙に効く単位で書く（版面に対する %）', /width="\d+%"/.test(sized));
check('描画にも効く',
  await page.locator(`${figure} .dp-figure-body`).evaluate(node => node.style.width) !== '');

await open();
await page.click('.dp-picture-bar button:has-text("原寸")');
await page.waitForTimeout(250);
check('原寸に戻すと幅の指定が消える',
  !/width=/.test((/@import "[^"]*auth-design\/screen\.png"[^\n]*/.exec(await source()) ?? [''])[0]));

// --- 同じ絵をもう一度 -------------------------------------------------------
// 作業フォルダに在るものは、もう一枚作らずそれを指す。
await paste(PNG);
await page.waitForTimeout(300);
const twice = (await source()).match(/@import "[^"]*auth-design\/screen\.png"/g) ?? [];
check('同じ画像は 2 枚にならず、在るものを指す',
  twice.length === 2 && twice[0] === twice[1], twice.join(' / '));

// --- 落とす -----------------------------------------------------------------
// リンクを落としたときは、作業フォルダには何も書かず、住所をそのまま書く。
await page.evaluate(async () => {
  const transfer = new DataTransfer();
  transfer.setData('text/uri-list', 'https://example.com/diagram.png');
  const target = [...document.querySelectorAll('.dp-sheet:not([hidden]) .dp-append')].at(-1);
  target.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true }));
  target.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 300));
});
await page.waitForTimeout(300);
const dropped = await source();
check('落としたリンクは住所のまま書かれる',
  dropped.includes('@import "https://example.com/diagram.png"'));
// 住所は住所のまま。作業フォルダのどこかを指す行に書き換えられてはいない。
check('リンクを落としてもファイルは作られない',
  !/@import "(?!https:)[^"]*diagram\.png"/.test(dropped),
  (/@import "[^"]*diagram\.png"/.exec(dropped) ?? [''])[0]);

// --- ファイルを落とす -------------------------------------------------------
// 貼り付けと同じ道を通る。違うのは入口だけで、出口は同じ取り込み行である。
await page.evaluate(async data => {
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
  const target = [...document.querySelectorAll('.dp-sheet:not([hidden]) .dp-append')].at(-1);
  target.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true }));
  target.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 400));
},
// 貼ったものと中身を変える。同じなら「在るものを指す」側に流れてしまう。
'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
await page.waitForTimeout(300);
check('落としたファイルは作業フォルダに置かれる',
  /@import "[^"]*dropped\.png"/.test(await source()),
  (/@import "[^"]*dropped\.png"/.exec(await source()) ?? [''])[0]);

await browser.close();
