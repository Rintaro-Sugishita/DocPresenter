// Adding, renaming and deleting shapes. These are edits to the semantics
// layer — the layer a person would otherwise type — so what matters is that
// the line written is the line they would have written, and that deleting one
// shape does not leave the file pointing at something that is gone.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await page.goto('file://' + process.cwd() + '/out/editor.html');
await page.waitForTimeout(400);

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};
const status = () => page.textContent('#status');
const node = id => `.dp-canvas-stage [data-node="${id}"]`;

let openFigure = 0;
const reopen = async () => {
  const figures = await page.$$('.dp-sheet:not([hidden]) .dp-figure-body');
  await figures[openFigure].click();
  await page.waitForTimeout(300);
};
const openSheet = async (index, figure = 0) => {
  await page.click(`.dp-tab[data-index="${index}"]`);
  await page.waitForTimeout(250);
  openFigure = figure;
  await reopen();
};
const source = async () => {
  await page.click('.dp-sheet:not([hidden]) .dp-canvas-bar button:text("ソース")');
  await page.waitForSelector('.dp-block-source');
  const text = await page.inputValue('.dp-block-source');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await reopen();
  return text;
};
const item = label => `.dp-menu button:text-is("${label}")`;

// --- 追加（自動配置の図。ピンは書かれない）--------------------------------
await openSheet(4);
const shapes = () => page.$$eval('.dp-canvas-stage [data-node]', ns => ns.length);
const before = await shapes();
await page.click('.dp-sheet:not([hidden]) .dp-canvas-bar button:text("＋ 図形")');
await page.waitForSelector('.dp-menu button');
check('図形の見本が並ぶ', (await page.$$('.dp-menu button')).length === 8,
  String((await page.$$('.dp-menu button')).length));
await page.click(item('＋ ひし形'));
await page.waitForTimeout(400);
check('図形が増える', (await shapes()) === before + 1, `${before} → ${await shapes()}`);
check('1 回の操作としてソースに書かれる',
  (await status()).includes('図形を追加') && (await status()).includes('.dgm'), await status());
check('足した図形がそのまま選ばれている',
  (await page.textContent('.dp-sheet:not([hidden]) .dp-canvas-where')).startsWith('branch1'),
  await page.textContent('.dp-sheet:not([hidden]) .dp-canvas-where'));

const added = await source();
check('意味のセクションに 1 行だけ足される', added.includes('  branch1 {図形}'),
  added.split('\n').find(l => l.includes('branch1')));
check('自動配置の図にピンは書かれない', !added.includes('branch1 @'),
  added.slice(added.indexOf('layout {')).split('\n').slice(0, 3).join(' / '));

// --- 文字を変える --------------------------------------------------------
await page.dblclick(node('branch1'));
await page.waitForSelector('.dp-canvas-text');
await page.fill('.dp-canvas-text', '判定する');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
check('ダブルクリックで文字を書き換えられる',
  (await page.textContent(node('branch1'))).includes('判定する'),
  await page.textContent(node('branch1')));
const named = await source();
check('書き換わるのは同じ 1 行', named.includes('  branch1 {判定する}'),
  named.split('\n').find(l => l.includes('branch1')));

// --- 線を引く ------------------------------------------------------------
await page.click(node('branch1'), { button: 'right' });
await page.waitForSelector('.dp-menu button');
await page.click(item('線を引く'));
await page.waitForTimeout(200);
check('引き先を選ぶ状態になる',
  (await page.textContent('.dp-sheet:not([hidden]) .dp-canvas-where')).includes('線を引く先'),
  await page.textContent('.dp-sheet:not([hidden]) .dp-canvas-where'));
await page.click(node('revoked'));
await page.waitForTimeout(400);
const linked = await source();
check('線が 1 行として書かれる', linked.includes('  branch1 --> revoked'),
  linked.split('\n').find(l => l.includes('branch1 -->')));
check('線が描かれる', (await page.$$('.dp-canvas-stage [data-edge="branch1->revoked"]')).length > 0);

// --- 種類を変える --------------------------------------------------------
await page.click(node('branch1'), { button: 'right' });
await page.waitForSelector('.dp-menu button');
await page.click(item('楕円'));
await page.waitForTimeout(400);
const reshaped = await source();
check('種類は同じ行の括弧を書き換える', reshaped.includes('  branch1 ((判定する))'),
  reshaped.split('\n').find(l => l.includes('branch1 (')));
check('描画も楕円になる', (await page.$$(node('branch1') + ' ellipse')).length === 1);

// --- 削除（線も一緒に消える。消える前に言う）------------------------------
await page.click(node('branch1'), { button: 'right' });
await page.waitForSelector('.dp-menu button');
const labels = await page.$$eval('.dp-menu button', ns => ns.map(n => n.textContent));
check('消える線の数を先に言う', labels.some(l => l === '削除（線 1 本も消える）'),
  labels.filter(l => l.startsWith('削除')).join(' / '));
await page.click(item('削除（線 1 本も消える）'));
await page.waitForTimeout(400);
check('図形が消える', (await shapes()) === before, `${before} → ${await shapes()}`);
const removed = await source();
check('線の行も消える', !removed.includes('branch1'), removed.split('\n').filter(l => l.includes('branch1')).join(' / '));
check('もとからあった行は無傷', removed.includes('  active  [有効]')
  && removed.includes('  active  --> expired  "24 時間経過"'));

// --- 自由配置の図では、置いた場所にピンが書かれる --------------------------
await openSheet(3, 2);
await page.click('.dp-sheet:not([hidden]) .dp-canvas-bar button:text("＋ 図形")');
await page.waitForSelector('.dp-menu button');
await page.click(item('＋ 四角'));
await page.waitForTimeout(400);
const free = await source();
check('自由配置では図形とピンが一度に入る',
  free.includes('  box1 [図形]') && /box1 +@ \(\d+, \d+\)/.test(free),
  free.split('\n').filter(l => l.includes('box1')).join(' / '));
check('置き場所は図の外（既にある図形の上に重ねない）',
  Number(/box1 +@ \(\d+, (\d+)\)/.exec(free)[1]) > 300,
  /box1 +@ \(\d+, (\d+)\)/.exec(free)[0]);

// 消せば元に戻る
await page.click(node('box1'), { button: 'right' });
await page.waitForSelector('.dp-menu button');
await page.click(item('削除'));
await page.waitForTimeout(400);
const back = await source();
check('削除すれば図形の行もピンの行も消える', !back.includes('box1'),
  back.split('\n').filter(l => l.includes('box1')).join(' / '));
check('ほかのピンは 1 文字も動かない', back.includes('  frame    @ ( 40,  20) 380x330'),
  back.split('\n').find(l => l.includes('frame')));

await page.screenshot({ path: 'out/canvas-shapes.png' });
await browser.close();
