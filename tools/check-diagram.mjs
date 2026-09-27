// Dragging a shape. What this catches is the thing unit tests cannot see: that
// the shape under the pointer is the shape that moves, that where it lands is
// what the file says, and that the rest of the file does not move at all.
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
const where = () => page.textContent('.dp-sheet:not([hidden]) .dp-canvas-where');
const node = id => `.dp-canvas-stage [data-node="${id}"]`;

let openFigure = 0;
const openSheet = async (index, figure = 0) => {
  await page.click(`.dp-tab[data-index="${index}"]`);
  await page.waitForTimeout(250);
  openFigure = figure;
  await reopen();
};
/** Opens the figure this run is working on. Reading the source closes it. */
const reopen = async () => {
  const figures = await page.$$('.dp-sheet:not([hidden]) .dp-figure-body');
  await figures[openFigure].click();
  await page.waitForTimeout(300);
};

/** Drawing units per screen pixel, so a drag can be asked for in the file's own numbers. */
const scale = () => page.$eval('.dp-canvas-stage svg', svg =>
  svg.getBoundingClientRect().width / svg.viewBox.baseVal.width);

const drag = async (selector, dx, dy, { hold, corner, plain } = {}) => {
  const box = await page.locator(selector).boundingBox();
  // An overlay is shown at the image's own size, so its numbers are pixels.
  const factor = plain ? 1 : await scale();
  // A group is behind the shapes it contains, so it is grabbed by its corner.
  const from = corner
    ? { x: box.x + 6, y: box.y + 6 }
    : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx * factor, from.y + dy * factor, { steps: 8 });
  if (hold) await hold();
  await page.mouse.up();
  await page.waitForTimeout(250);
};

/** What the bar says: the id, the pin, the size and whether it is pinned. */
const reading = async () => {
  const text = (await where()).trim().split(/\s+/);
  return { id: text[0], x: Number(text[1].replace(',', '')), y: Number(text[2]), pinned: text[4] };
};

/** The .dgm as it stands, read through the source button and put back. */
const source = async () => {
  await page.click('.dp-sheet:not([hidden]) .dp-canvas-bar button:text("ソース")');
  await page.waitForSelector('.dp-block-source');
  const text = await page.inputValue('.dp-block-source');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  // Opening the source closed the canvas. Put it back, so what follows is
  // still driving the drawing.
  await reopen();
  return text;
};
const layoutOf = text => {
  const from = text.indexOf('layout {');
  return text.slice(from, text.indexOf('}', from) + 1).split('\n');
};
const pinOf = (text, id) =>
  layoutOf(text).find(line => line.trim().startsWith(id + ' ')) ?? '';

// --- 状態遷移図（layout が空のファイル）--------------------------------
await openSheet(4);
check('図をクリックすると図そのものが出る（ソースではない）',
  await page.isVisible('.dp-canvas-stage svg') && !(await page.isVisible('.dp-block-source')));
check('矢印も描かれたまま', (await page.$$('.dp-canvas-stage .dp-edge')).length > 0);

await page.click(node('active'));
await page.waitForTimeout(150);
check('図形を選ぶと枠と取っ手が出る',
  await page.isVisible('.dp-canvas-outline') && await page.isVisible('.dp-canvas-handle'));
const before = await reading();
check('留めていない図形は「自動」と出る', before.id === 'active' && before.pinned === '(自動)',
  await where());

await drag(node('active'), 60, -24);
const moved = await reading();
check('ドラッグした分だけ動く',
  Math.abs(moved.x - (before.x + 60)) <= 6 && Math.abs(moved.y - (before.y - 24)) <= 6,
  `${before.x},${before.y} → ${moved.x},${moved.y}`);
check('1 回の操作としてソースに書かれる',
  (await status()).includes('配置を固定') && (await status()).includes('.dgm'), await status());
check('留めたので「固定」になる', moved.pinned === '(固定)', await where());

const afterDrag = await source();
check('空だった layout に 1 行だけ足される',
  layoutOf(afterDrag).length === 3 && pinOf(afterDrag, 'active').includes('@'),
  layoutOf(afterDrag).join(' / '));
check('画面の座標とファイルの座標が一致する',
  pinOf(afterDrag, 'active').includes(`(${moved.x}, ${moved.y})`),
  pinOf(afterDrag, 'active'));
check('意味のセクションは触られていない',
  afterDrag.includes('active  [有効]') && afterDrag.includes('active  --> expired  "24 時間経過"'));

// 矢印キー
await page.click(node('active'));
await page.waitForTimeout(150);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(250);
const nudged = await reading();
check('矢印キーは 4 動かす', nudged.x === moved.x + 4, `${moved.x} → ${nudged.x}`);
await page.keyboard.press('Shift+ArrowDown');
await page.waitForTimeout(250);
const fine = await reading();
check('Shift 付きは 1 動かす', fine.y === nudged.y + 1, `${nudged.y} → ${fine.y}`);

// 大きさ
await drag('.dp-canvas-handle', 40, 12);
const sized = await source();
check('取っ手を引くと大きさが書かれる', /active\s+@ \(\d+, \d+\) \d+x\d+/.test(pinOf(sized, 'active')),
  pinOf(sized, 'active'));
check('大きさは描画にも効く',
  await page.$eval(node('active') + ' rect', r => Number(r.getAttribute('width'))) > 150);

// 自動配置に戻す
await page.click(node('active'));
await page.waitForTimeout(150);
await page.click('.dp-sheet:not([hidden]) .dp-canvas-bar button:text("自動配置に戻す")');
await page.waitForTimeout(300);
check('自動に戻すと「自動」に戻る', (await reading()).pinned === '(自動)', await where());
const released = await source();
check('layout から行が消える', layoutOf(released).length === 2, layoutOf(released).join(' / '));
check('戻したあとも描画は壊れない', await page.isVisible('.dp-canvas-stage svg'));

// --- システム構成図（全要素が留まっているファイル）----------------------
await openSheet(2);
await page.click(node('browser'));
await page.waitForTimeout(150);
const start = await reading();
check('留めてある図形は「固定」と出る', start.pinned === '(固定)', await where());

// web は x=240。3 だけ手前で放しても辺が吸着する。
let sawGuide = false;
await drag(node('browser'), 197, 0, {
  // A guide is a line with no width, which counts as invisible; its presence
  // on the page is the thing being checked.
  hold: async () => { sawGuide = (await page.$$('.dp-canvas-guide')).length > 0; },
});
const snapped = await reading();
check('ドラッグ中に整列ガイドが出る', sawGuide);
check('他の図形の辺に吸着する', snapped.x === 240, `x=${snapped.x}`);

const aligned = await source();
check('手で揃えた桁は崩れない', pinOf(aligned, 'browser') === '  browser @ (240, 120) 140x60',
  JSON.stringify(pinOf(aligned, 'browser')));
check('他の行は 1 文字も動かない', pinOf(aligned, 'web') === '  web     @ (240, 120) 140x60',
  JSON.stringify(pinOf(aligned, 'web')));

// グループ（留まっているので動かせる。z は残る）
await page.click(node('dmz'), { position: { x: 6, y: 6 } });
await page.waitForTimeout(150);
await drag(node('dmz'), 0, 40, { corner: true });
const group = await source();
check('留めてあるグループは動かせる', /dmz\s+@ \(220,\s+1\d\d\)\s+180x140\s+z:-1/.test(pinOf(group, 'dmz')),
  JSON.stringify(pinOf(group, 'dmz')));

// --- 開始と終了 --------------------------------------------------------
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Escape で図の編集を閉じる',
  !(await page.isVisible('.dp-canvas-stage')) && await page.isVisible('.dp-sheet:not([hidden]) .dp-diagram'));

await page.click('.dp-sheet:not([hidden]) .dp-figure-body');
await page.waitForTimeout(300);
check('もう一度開ける', await page.isVisible('.dp-canvas-stage'));
// 表のグリッドと同じ作法: 外を 1 度押すと閉じ、もう 1 度でそこが開く。
await page.click('.dp-sheet:not([hidden]) .dp-prose p');
await page.waitForTimeout(300);
check('図の外を押すと図の編集が閉じる',
  !(await page.isVisible('.dp-canvas-stage')) && !(await page.isVisible('.dp-block-source')));
await page.click('.dp-sheet:not([hidden]) .dp-prose p');
await page.waitForTimeout(300);
check('もう一度押すとそこが編集に入る', await page.isVisible('.dp-block-source'));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

await page.click('.dp-sheet:not([hidden]) .dp-figure-body');
await page.waitForTimeout(300);
await page.click('.dp-canvas-bar button:text("ソース")');
await page.waitForSelector('.dp-block-source');
check('ソースは直接編集できる', (await page.inputValue('.dp-block-source')).startsWith('#'));
await page.keyboard.press('Escape');
await page.waitForTimeout(250);

await page.click('.dp-sheet:not([hidden]) .dp-figure-body');
await page.waitForTimeout(300);
await page.screenshot({ path: 'out/canvas.png' });

// --- 画面キャプチャへの注釈 ---------------------------------------------
await openSheet(3, 1);
check('注釈は画像の上でそのまま掴める',
  await page.isVisible('.dp-sheet:not([hidden]) .dp-overlay-editing')
  && await page.isVisible('.dp-sheet:not([hidden]) .dp-canvas-bar'));

const marker = name => `.dp-callout[data-callout="${name}"]`;
await page.click(marker('②'));
await page.waitForTimeout(150);
check('注釈を選ぶと先端の点が出る',
  await page.isVisible('.dp-callout-handle') && await page.isVisible(marker('②') + '.dp-picked'));
check('選んだ注釈の座標が出る', (await where()).trim().startsWith('②'), await where());

await drag(marker('②'), 24, 12, { plain: true });
const notes = await source();
check('丸を動かすと座標が書かれ、文言は残る',
  notes.includes('② @ (192, 198) -> (188, 192)  "パスワード"'),
  notes.split('\n').find(l => l.includes('②')));
check('ほかの注釈は 1 文字も動かない',
  notes.includes('① @ (168, 126) -> (188, 132)  "ログイン ID"'));

await page.click(marker('②'));
await page.waitForTimeout(150);
await drag('.dp-callout-handle', 10, 6, { plain: true });
const pointed = await source();
check('先端の点で「指す位置」だけを動かせる',
  pointed.includes('② @ (192, 198) -> (198, 198)'),
  pointed.split('\n').find(l => l.includes('②')));

await page.click(marker('②'));
await page.waitForTimeout(150);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(250);
const nudgedNote = await source();
check('注釈も矢印キーで動く', nudgedNote.includes('② @ (196, 198)'),
  nudgedNote.split('\n').find(l => l.includes('②')));
check('指す先は付いてこない', nudgedNote.includes('-> (198, 198)'));

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Escape で注釈の編集を閉じる',
  !(await page.isVisible('.dp-sheet:not([hidden]) .dp-canvas-bar'))
  && await page.isVisible('.dp-sheet:not([hidden]) .dp-overlay'));

await browser.close();
