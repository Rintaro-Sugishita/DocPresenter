// Drives the editor demo the way a person would, and checks that each gesture
// lands in the source as one byte-range edit. A tab bar that looks right but
// writes the wrong bytes is the failure this catches.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await page.goto('file://' + process.cwd() + '/out/editor.html');
await page.waitForTimeout(400);

const tabs = () => page.$$eval('.dp-tab:not(.dp-tab-add)', ts =>
  ts.map(t => t.firstChild.textContent));
const shown = () => page.$$eval('.dp-sheet:not([hidden]) h2, .dp-sheet:not([hidden]) h1',
  hs => hs.map(h => h.textContent.trim()));
const status = () => page.textContent('#status');
const source = () => page.textContent('#source');

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

// 切り替え
await page.click('.dp-tab[data-index="3"]');
check('タブを押すとそのシートだけが出る', (await shown()).join('/').includes('ログイン機能'), (await shown()).join('/'));

// Ctrl+PageDown
await page.keyboard.press('Control+PageDown');
check('Ctrl+PageDown で次のシートへ', (await shown()).join('/').includes('トークン管理'));

// 並べ替え（HTML5 drag をイベントで再現する）
const before = await tabs();
await page.evaluate(() => {
  const from = document.querySelector('.dp-tab[data-index="5"]');
  const to = document.querySelector('.dp-tab[data-index="2"]');
  const data = new DataTransfer();
  from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }));
  to.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }));
});
await page.waitForTimeout(150);
check('タブのドラッグでシートが動く',
  (await tabs())[1].includes('用語') && before[1].includes('システム構成'),
  (await tabs()).join(' | '));
check('移動は 1 回の書き換えとして報告される', (await status()).includes('バイトを書き換え'), await status());

// 追加
await page.click('.dp-tab-add');
await page.waitForTimeout(150);
check('＋で空のシートが増える', (await tabs()).length === 6 && (await tabs())[5] === 'シート 6',
  (await tabs()).join(' | '));

// 改名
await page.dblclick('.dp-tab[data-index="6"]');
await page.fill('.dp-tab-rename', '付録');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check('見出しの無いシートは改名できないと言う',
  await page.getAttribute('#status', 'data-kind') === 'refused', await status());

await page.click('.dp-tab[data-index="2"]');
await page.dblclick('.dp-tab[data-index="2"]');
await page.fill('.dp-tab-rename', '用語集');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check('改名は見出しを書き換える', (await source()).includes('## 用語集 {#sec-glossary}'));
check('ラベルは保たれる', (await source()).includes('{#sec-glossary}'));

// 削除
await page.click('.dp-tab[data-index="2"] .dp-tab-close');
await page.waitForTimeout(200);
check('×でシートが消える', (await tabs()).length === 5 && !(await tabs()).join().includes('用語集'),
  (await tabs()).join(' | '));
check('区切りが二重に残らない', !(await source()).includes('---\n\n---'));

// 全シート表示
await page.click('.dp-tabbar-toggle');
await page.waitForTimeout(200);
check('全シート表示に切り替わる', (await shown()).length > 1, (await shown()).length + ' 見出し');

await page.screenshot({ path: 'out/editor-after.png' });
await browser.close();
