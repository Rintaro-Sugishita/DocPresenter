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
check('図形の見本が並ぶ', (await page.$$('.dp-menu button')).length === 12,
  String((await page.$$('.dp-menu button')).length));
await page.click(item('ひし形'));
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
await page.click(item('四角'));
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


// --- 線を選ぶ・消す・つなぎ替える -----------------------------------------
await openSheet(4);
// 線は「近さ」で拾う。描かれている線の中ほどを押す。
const pressLine = async (from, to) => {
  const at = await page.$eval('.dp-canvas-stage svg', (svg, key) => {
    const g = svg.querySelector(`[data-edge="${key}"] polyline`);
    const points = g.getAttribute('points').split(' ').map(p => p.split(',').map(Number));
    // 折れている線もあるので、線の長さの真ん中を取る。
    const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
    const half = lengths.reduce((a, b) => a + b, 0) / 2;
    let walked = 0;
    let found = points[0];
    for (let i = 0; i < lengths.length; i++) {
      if (walked + lengths[i] >= half) {
        const t = (half - walked) / (lengths[i] || 1);
        found = [points[i][0] + (points[i + 1][0] - points[i][0]) * t,
          points[i][1] + (points[i + 1][1] - points[i][1]) * t];
        break;
      }
      walked += lengths[i];
    }
    const box = svg.getBoundingClientRect();
    const scale = box.width / svg.viewBox.baseVal.width;
    return { x: box.left + found[0] * scale, y: box.top + found[1] * scale };
  }, `${from}->${to}`);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(250);
};
await pressLine('active', 'expired');
check('線をクリックすると線が選ばれる',
  (await page.textContent('.dp-sheet:not([hidden]) .dp-canvas-where')).includes('active → expired'),
  await page.textContent('.dp-sheet:not([hidden]) .dp-canvas-where'));
check('両端に掴む点が出る', (await page.$$('.dp-canvas-end')).length === 2,
  String((await page.$$('.dp-canvas-end')).length));

// つなぎ替え先として、まだどの線も繋がっていない図形を 1 つ足す
await page.click('.dp-sheet:not([hidden]) .dp-canvas-bar button:text("＋ 図形")');
await page.waitForSelector('.dp-menu button');
await page.click(item('四角'));
await page.waitForTimeout(400);
await pressLine('active', 'expired');

// つなぎ替え: 終端を別の図形へ
const factor = await page.$eval('.dp-canvas-stage svg', svg =>
  svg.getBoundingClientRect().width / svg.viewBox.baseVal.width);
const endAt = await page.locator('.dp-canvas-end[data-end="to"]').boundingBox();
const onto = await page.locator(node('box1')).boundingBox();
await page.mouse.move(endAt.x + endAt.width / 2, endAt.y + endAt.height / 2);
await page.mouse.down();
await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(400);
const rewired = await source();
check('線のつなぎ替えは同じ 1 行の書き換え',
  rewired.includes('  active  --> box1  "24 時間経過"'),
  rewired.split('\n').find(l => l.includes('active  -->')));
check('ラベルも線種もそのまま', !rewired.includes('active  --> expired'));
void factor;

// 消す
await pressLine('active', 'box1');
check('つなぎ替えた線をもう一度選べる',
  (await page.textContent('.dp-sheet:not([hidden]) .dp-canvas-where')).includes('active → box1'),
  await page.textContent('.dp-sheet:not([hidden]) .dp-canvas-where'));
await page.keyboard.press('Delete');
await page.waitForTimeout(400);
const cut = await source();
check('Delete で線が消える', !cut.includes('active  --> box1'),
  cut.split('\n').filter(l => l.includes('active  -->')).join(' / '));
check('図形は残っている', cut.includes('  active  [有効]') && cut.includes('  revoked [失効]'));

// --- 線を折る -------------------------------------------------------------
await openSheet(2);
const linePoint = async (key, t = 0.5) => page.$eval('.dp-canvas-stage svg', (svg, [name, at]) => {
  const g = svg.querySelector(`[data-edge="${name}"] polyline`);
  const pts = g.getAttribute('points').split(' ').map(p => p.split(',').map(Number));
  const lengths = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const want = lengths.reduce((a, b) => a + b, 0) * at;
  let walked = 0;
  let found = pts[0];
  for (let i = 0; i < lengths.length; i++) {
    if (walked + lengths[i] >= want) {
      const k = (want - walked) / (lengths[i] || 1);
      found = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
      break;
    }
    walked += lengths[i];
  }
  const box = svg.getBoundingClientRect();
  const scale = box.width / svg.viewBox.baseVal.width;
  return { x: box.left + found[0] * scale, y: box.top + found[1] * scale, scale };
}, [key, t]);

let mid = await linePoint('browser->web');
await page.mouse.click(mid.x, mid.y);
await page.waitForTimeout(250);
check('線を選んでも、まだ折れていない', (await page.$$('.dp-canvas-bend')).length === 0);
check('曲げられることが目印で分かる', (await page.$$('.dp-canvas-bend-new')).length === 1,
  String((await page.$$('.dp-canvas-bend-new')).length));
check('何をすればよいかが出る',
  (await page.textContent('.dp-sheet:not([hidden]) .dp-canvas-hint')).includes('ドラッグすると曲がる'),
  await page.textContent('.dp-sheet:not([hidden]) .dp-canvas-hint'));

// 選んだあとにもう一度引くと折れる
await page.mouse.move(mid.x, mid.y);
await page.mouse.down();
await page.mouse.move(mid.x, mid.y + 60 * mid.scale, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(400);
check('線をドラッグすると折れ点ができる', (await page.$$('.dp-canvas-bend')).length === 1,
  String((await page.$$('.dp-canvas-bend')).length));
const bent = await source();
check('折れ点は layout に 1 行', /browser -> web @ \(\d+, \d+\)/.test(bent),
  bent.split('\n').find(l => l.includes('-> web @')));
check('意味のセクションは触られていない', bent.includes('  browser -> web   "HTTPS"'));

// ソースを見ると選択は解ける。もう一度線を選び直す。
mid = await linePoint('browser->web', 0.25);
await page.mouse.click(mid.x, mid.y);
await page.waitForTimeout(250);
check('折れた線も選び直せる', (await page.$$('.dp-canvas-bend')).length === 1,
  await page.textContent('.dp-sheet:not([hidden]) .dp-canvas-where'));

// 直角に吸着する（browser の中心 x に寄せる）
const corner = await page.locator('.dp-canvas-bend').boundingBox();
const shapeBox = await page.locator(node('browser')).boundingBox();
await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
await page.mouse.down();
await page.mouse.move(shapeBox.x + shapeBox.width / 2 + 2, corner.y + corner.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(400);
const squared = await source();
const bendX = Number(/browser -> web @ \((\d+),/.exec(squared)[1]);
const browserPin = /browser @ \( *(\d+), *(\d+)\)/.exec(squared);
check('角は隣の点と直角に吸着する',
  bendX === Number(browserPin[1]) + 70, `折れ点 ${bendX} / 図形の中心 ${Number(browserPin[1]) + 70}`);

// まっすぐに戻す: 折れ点を線の上に落とす
mid = await linePoint('browser->web', 0.25);
await page.mouse.click(mid.x, mid.y);
await page.waitForTimeout(250);
// まっすぐな線は 2 つの図形の中心を結ぶ。その真ん中に落とす。
const centres = await Promise.all([node('browser'), node('web')].map(async selector => {
  const box = await page.locator(selector).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}));
const ends = {
  x: (centres[0].x + centres[1].x) / 2,
  y: (centres[0].y + centres[1].y) / 2,
};
const corner2 = await page.locator('.dp-canvas-bend').boundingBox();
await page.mouse.move(corner2.x + corner2.width / 2, corner2.y + corner2.height / 2);
await page.mouse.down();
await page.mouse.move(ends.x, ends.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(400);
const straight = await source();
check('線の上に戻すと折れ点は消える', !straight.includes('-> web @'),
  straight.split('\n').filter(l => l.includes('-> web')).join(' / '));
check('折れ点の目印も消える', (await page.$$('.dp-canvas-bend')).length === 0);

// --- 部品（図形とは別の一覧）---------------------------------------------
await openSheet(4);
await page.click('.dp-sheet:not([hidden]) .dp-canvas-bar button:text("＋ 部品")');
await page.waitForSelector('.dp-menu button');
const parts = await page.$$eval('.dp-menu button', ns => ns.map(n => n.textContent));
check('部品は別の一覧になっている', parts.includes('ルータ') && !parts.includes('四角'),
  parts.slice(0, 4).join(' / '));
check('部品も絵で選ぶ', (await page.$$('.dp-menu button svg')).length === parts.length,
  `${(await page.$$('.dp-menu button svg')).length} / ${parts.length}`);

await page.click(item('ルータ'));
await page.waitForTimeout(500);
check('1 回の操作として書かれる', (await status()).includes('部品を追加'), await status());
check('絵が描かれる', (await page.$$('.dp-canvas-stage .dp-part-art')).length === 1,
  String((await page.$$('.dp-canvas-stage .dp-part-art')).length));
check('名前は絵の下に出る',
  (await page.textContent(node('part1'))).includes('ルータ'),
  await page.textContent(node('part1')));

const withPart = await source();
check('意味は意味層、絵はスタイル層', withPart.includes('  part1 "ルータ"')
  && withPart.includes('part1 { icon: net/router }'),
  withPart.split('\n').filter(l => l.includes('part1')).join(' / '));

await browser.close();
