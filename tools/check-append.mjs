// New blocks and renaming. Both are about the moment before anything exists:
// an empty sheet with nothing to click, and a tab whose width must not move
// under the pointer while its name is being typed.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await page.goto('file://' + process.cwd() + '/out/editor.html?lang=ja');
await page.waitForTimeout(400);

const source = () => page.textContent('#source');
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

// 空のシートを作って、そこに書く
await page.click('.dp-tab-add');
await page.waitForTimeout(250);
check('空のシートには書き出しの案内が出る',
  (await page.textContent('.dp-sheet-empty .dp-append'))?.includes('ここに本文を書く'));

await page.click('.dp-sheet:not([hidden]) .dp-append');
await page.waitForTimeout(200);
check('案内をクリックすると空の入力欄が開く', await page.inputValue('.dp-block-source') === '');

await page.fill('.dp-block-source', '## 付録\n\n参考にした資料を並べる。');
// 編集を閉じるのは「外を叩く」動作。叩く先はタブバーの余白ではなくペインの余白に
// する——シートが増えるとタブが並びきって余白は幅 0 になり、叩けなくなるので。
await page.click('.dp-editor-pane', { position: { x: 12, y: 6 } });
await page.waitForTimeout(300);
check('書いた内容がソースの末尾に入る', (await source()).trimEnd().endsWith('参考にした資料を並べる。'));
check('直前のシートとの間に区切りが残る',
  /---\n\n## 付録\n\n参考にした資料を並べる。/.test(await source()));
// 採番は「何枚目か」で決まる。標本が増えても壊れないよう、枚数から出して比べる。
const labels = await page.$$eval('.dp-tab:not(.dp-tab-add)', ts => ts.map(t => t.firstChild.textContent));
check('シート名が見出しと採番から決まる', /^\d+ 付録$/.test(labels.at(-1) ?? ''), labels.at(-1));
check('空の入力は何も書かない', (await page.textContent('#status')).includes('本文を追加'));

// 本文の末尾に足す
await page.click('.dp-tab[data-index="1"]');
await page.waitForTimeout(200);
const before = (await source()).length;
await page.click('.dp-sheet:not([hidden]) .dp-append');
await page.waitForTimeout(150);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('何も書かずに閉じれば変わらない', (await source()).length === before);

// タブ幅
await page.click('.dp-tab[data-index="2"]');
await page.waitForTimeout(150);
const widthBefore = await page.$eval('.dp-tab[data-index="2"]', t => t.getBoundingClientRect().width);
const barBefore = await page.$eval('.dp-tab[data-index="3"]', t => t.getBoundingClientRect().x);
await page.dblclick('.dp-tab[data-index="2"]');
await page.waitForTimeout(150);
const widthDuring = await page.$eval('.dp-tab[data-index="2"]', t => t.getBoundingClientRect().width);
const barDuring = await page.$eval('.dp-tab[data-index="3"]', t => t.getBoundingClientRect().x);
check('改名中もタブの幅が変わらない', Math.abs(widthDuring - widthBefore) < 1,
  `${widthBefore.toFixed(1)} → ${widthDuring.toFixed(1)}`);
check('右のタブが動かない', Math.abs(barDuring - barBefore) < 1,
  `${barBefore.toFixed(1)} → ${barDuring.toFixed(1)}`);

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await browser.close();
