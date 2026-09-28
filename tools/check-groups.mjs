// Picking several shapes, and what a group means when you drag it. A group's
// box is computed from what it holds, so "move the group" has to mean "move
// what it holds" — anything else moves a result and leaves the contents behind.
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
const node = id => `.dp-canvas-stage [data-node="${id}"]`;
const where = () => page.textContent('.dp-sheet:not([hidden]) .dp-canvas-where');
const item = label => `.dp-menu button:text-is("${label}")`;

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
const pinOf = (text, id) => {
  const from = text.indexOf('layout {');
  return text.slice(from, text.indexOf('}', from))
    .split('\n').find(line => line.trim().startsWith(id + ' ')) ?? '';
};
const at = (text, id) => {
  const found = /\( *(-?\d+), *(-?\d+) *\)/.exec(pinOf(text, id));
  return found ? { x: Number(found[1]), y: Number(found[2]) } : undefined;
};
const scale = () => page.$eval('.dp-canvas-stage svg', svg =>
  svg.getBoundingClientRect().width / svg.viewBox.baseVal.width);

const drag = async (selector, dx, dy, { corner } = {}) => {
  const box = await page.locator(selector).boundingBox();
  const factor = await scale();
  const from = corner
    ? { x: box.x + 6, y: box.y + 6 }
    : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx * factor, from.y + dy * factor, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
};

// --- 複数選択 -------------------------------------------------------------
await openSheet(2);
const start = await source();
await page.click(node('db'));
await page.waitForTimeout(150);
await page.click(node('cache'), { modifiers: ['Shift'] });
await page.waitForTimeout(200);
check('Shift クリックで足せる', (await where()).includes('2 個を選択'), await where());
check('選んだ数だけ枠が出る', (await page.$$('.dp-canvas-outline')).length === 2,
  String((await page.$$('.dp-canvas-outline')).length));
await page.click(node('cache'), { modifiers: ['Shift'] });
await page.waitForTimeout(200);
check('もう一度 Shift クリックで外れる', (await where()).startsWith('db'), await where());

// まとめて動かす
await page.click(node('cache'), { modifiers: ['Shift'] });
await page.waitForTimeout(150);
await drag(node('db'), 0, -40);
const moved = await source();
check('選んだ図形が同じだけ動く',
  at(moved, 'db').y === at(start, 'db').y - 40 && at(moved, 'cache').y === at(start, 'cache').y - 40,
  `db ${at(start, 'db').y}→${at(moved, 'db').y} / cache ${at(start, 'cache').y}→${at(moved, 'cache').y}`);
check('動かしていない図形は 1 文字も動かない',
  pinOf(moved, 'browser') === pinOf(start, 'browser'), pinOf(moved, 'browser'));
check('書き換えは 1 回', (await page.textContent('#status')).includes('配置を変更'),
  await page.textContent('#status'));

// 矩形は指したところに出る（図の原点ぶんずれていないこと）
const one = await page.locator(node('browser')).boundingBox();
await page.mouse.move(one.x - 12, one.y - 12);
await page.mouse.down();
await page.mouse.move(one.x + one.width + 12, one.y + one.height + 12, { steps: 8 });
const drawn = await page.$eval('.dp-canvas-band', r => ({
  x: +r.getAttribute('x'), y: +r.getAttribute('y'),
  w: +r.getAttribute('width'), h: +r.getAttribute('height'),
}));
const inside = await page.$eval(node('browser') + ' rect', r => ({
  x: +r.getAttribute('x'), y: +r.getAttribute('y'),
  w: +r.getAttribute('width'), h: +r.getAttribute('height'),
}));
await page.mouse.up();
await page.waitForTimeout(250);
check('矩形は指した場所に出る',
  drawn.x < inside.x && drawn.y < inside.y
  && drawn.x + drawn.w > inside.x + inside.w && drawn.y + drawn.h > inside.y + inside.h,
  `枠 ${Math.round(drawn.x)},${Math.round(drawn.y)} / 図形 ${inside.x},${inside.y}`);
check('囲った 1 つだけが選ばれる', (await where()).startsWith('browser'), await where());

// 矩形選択
await page.mouse.move(10, 10);
const area = await page.locator('.dp-canvas-stage svg').boundingBox();
await page.mouse.move(area.x + 4, area.y + 4);
await page.mouse.down();
await page.mouse.move(area.x + area.width - 4, area.y + area.height - 4, { steps: 10 });
const bandSeen = (await page.$$('.dp-canvas-band')).length > 0;
await page.mouse.up();
await page.waitForTimeout(250);
check('ドラッグで矩形が出る', bandSeen);
check('矩形に入った図形がまとめて選ばれる', (await where()).includes('個を選択'), await where());

// --- グループにする -------------------------------------------------------
await page.click(node('db'));
await page.waitForTimeout(150);
await page.click(node('cache'), { modifiers: ['Shift'] });
await page.waitForTimeout(150);
await page.click(node('db'), { button: 'right' });
await page.waitForSelector('.dp-menu button');
check('2 つ以上選ぶとグループにできる',
  (await page.$$eval('.dp-menu button', ns => ns.map(n => n.textContent)))
    .includes('2 個をグループにする'));
await page.click(item('2 個をグループにする'));
await page.waitForTimeout(400);
const grouped = await source();
check('グループは 1 行足すだけ', grouped.includes('group group1 "グループ" { db; cache }'),
  grouped.split('\n').find(l => l.includes('group group1')));
check('中身の座標は動かない', pinOf(grouped, 'db') === pinOf(moved, 'db'), pinOf(grouped, 'db'));

// --- グループを動かすと中身が付いてくる -----------------------------------
await page.click(node('group1'), { position: { x: 6, y: 6 } });
await page.waitForTimeout(200);
await drag(node('group1'), 0, 40, { corner: true });
const dragged = await source();
check('留めていないグループを引くと中身が動く',
  at(dragged, 'db').y === at(grouped, 'db').y + 40
  && at(dragged, 'cache').y === at(grouped, 'cache').y + 40,
  `db ${at(grouped, 'db').y}→${at(dragged, 'db').y}`);
check('計算で決まる枠は書き込まれない', pinOf(dragged, 'group1') === '',
  pinOf(dragged, 'group1'));

// 留めてあるグループは自分の行も動く
await page.click(node('dmz'), { position: { x: 6, y: 6 } });
await page.waitForTimeout(200);
await drag(node('dmz'), 0, 24, { corner: true });
const pinned = await source();
// 吸着が効くので移動量はぴったり 24 とは限らない。枠と中身が同じだけ動くことが要点。
const byGroup = at(pinned, 'dmz').y - at(dragged, 'dmz').y;
const byChild = at(pinned, 'web').y - at(dragged, 'web').y;
check('留めてあるグループは自分の行も動く', byGroup > 0, `${byGroup}`);
check('その中身も同じだけ動く', byChild === byGroup, `枠 ${byGroup} / 中身 ${byChild}`);

// --- 解除 ---------------------------------------------------------------
await page.click(node('group1'), { position: { x: 6, y: 6 }, button: 'right' });
await page.waitForSelector('.dp-menu button');
check('グループの削除は「解除」と言う',
  (await page.$$eval('.dp-menu button', ns => ns.map(n => n.textContent)))
    .includes('グループを解除（中身は残る）'));
await page.click(item('グループを解除（中身は残る）'));
await page.waitForTimeout(400);
const released = await source();
check('グループの行だけが消える', !released.includes('group1'),
  released.split('\n').filter(l => l.includes('group1')).join(' / '));
check('中身は残る', released.includes('  db      [(会員 DB)]') && at(released, 'db') !== undefined,
  pinOf(released, 'db'));

// --- 整列 -----------------------------------------------------------------
await openSheet(2);
await page.click(node('browser'));
await page.waitForTimeout(150);
check('1 つでは整列の列は出ない', await page.isHidden('.dp-sheet:not([hidden]) .dp-canvas-aligners'));
await page.click(node('web'), { modifiers: ['Shift'] });
await page.click(node('api'), { modifiers: ['Shift'] });
await page.waitForTimeout(200);
check('2 つ以上で整列の列が出る',
  await page.isVisible('.dp-sheet:not([hidden]) .dp-canvas-aligners'));
check('整列のボタンは絵で出る',
  (await page.$$('.dp-canvas-aligners .dp-canvas-icon svg')).length === 8,
  String((await page.$$('.dp-canvas-aligners .dp-canvas-icon svg')).length));

// 上を揃える（重ならない向きで確かめる。左揃えだと 3 つが完全に重なる）
await page.click('.dp-canvas-icon[title="上を揃える"]');
await page.waitForTimeout(400);
const lined = await source();
const ys = ['browser', 'web', 'api'].map(id => at(lined, id).y);
check('上が揃う', ys.every(y => y === ys[0]), ys.join(' / '));
check('1 回の書き換えで揃う', (await page.textContent('#status')).includes('整列'),
  await page.textContent('#status'));

await page.click(node('browser'));
await page.waitForTimeout(150);
await page.click(node('web'), { modifiers: ['Shift'] });
await page.click(node('api'), { modifiers: ['Shift'] });
await page.waitForTimeout(200);
await page.click('.dp-canvas-icon[title="横に等間隔で並べる"]');
await page.waitForTimeout(400);
const spread = await source();
const xs = ['browser', 'web', 'api'].map(id => at(spread, id).x).sort((a, b) => a - b);
check('横の間隔が等しくなる', Math.abs((xs[1] - xs[0]) - (xs[2] - xs[1])) <= 1, xs.join(' / '));

await page.click(node('browser'));
await page.waitForTimeout(150);
await page.click(node('web'), { modifiers: ['Shift'] });
await page.waitForTimeout(200);
check('2 つでは等間隔は押せない',
  await page.isDisabled('.dp-canvas-icon[title="横に等間隔で並べる"]'));

// 図形の見本には絵が付く（基本 8 ＋ フローチャート 4）
await page.click('.dp-sheet:not([hidden]) .dp-canvas-bar button:text("＋ 図形")');
await page.waitForSelector('.dp-menu button');
check('図形の見本は絵で選ぶ', (await page.$$('.dp-menu button svg')).length === 12,
  String((await page.$$('.dp-menu button svg')).length));
await page.keyboard.press('Escape');

await browser.close();
