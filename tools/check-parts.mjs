// Screens built from a parts library.
//
// The point of a part is that a screen stops saying what things look like. So
// the test is not "the screen draws" but: the screen's own file holds no
// colour, the drawing on the page has one anyway, and changing the part changes
// every screen that uses it — in one edit, through the editor, with the result
// read back off the page.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

// --- ソースの側 -------------------------------------------------------------
const SCREENS = [
  'sample/docs/auth-design/login-screen.dgm',
  'sample/docs/auth-design/password-reset-screen.dgm',
  'sample/docs/auth-design/locked-screen.dgm',
];
const sources = SCREENS.map(path => readFileSync(path, 'utf8'));
check('画面は 3 枚ある', sources.length === 3);
const coloured = SCREENS.filter((_, i) => /#[0-9a-f]{3,6}/i.test(sources[i]));
check('画面のファイルに色は書かれていない', coloured.length === 0, coloured.join(' '));
check('どの画面も同じ部品を使う',
  sources.every(text => /^use\s+"[^"]*ui-parts\.dgm"$/m.test(text)));
const library = readFileSync('sample/shared/ui-parts.dgm', 'utf8');
check('部品は共有に置く（文書ごとのものではない）', /parts\s*\{/.test(library));

// 並びは入れ物が決める。座標を持つのは枠だけで、中身は 1 つも座標を持たない——
// 持っていたら、項目を 1 つ足すたびに下の全部が書き換わるということである。
check('どの画面も入れ物で並べている',
  sources.every(text => /^\s*stack\s+\w+\s*\(/m.test(text)));
const pinned = SCREENS.map((path, i) => [path, (sources[i].match(/^\s*(\w+)\s+@ \(/gm) ?? [])
  .map(line => line.trim().split(/\s/)[0])]);
check('座標を持つのは枠だけ',
  pinned.every(([, ids]) => ids.length === 1 && ids[0] === 'frame'),
  pinned.map(([path, ids]) => `${path.split('/').pop()}:${ids.join(',')}`).join(' '));

// --- 紙の側 -----------------------------------------------------------------
execFileSync('node', ['tools/build.mjs', '--in', 'sample'], { encoding: 'utf8' });
const page = readFileSync('out/build/auth-design.html', 'utf8');
const figure = path => {
  const at = page.indexOf(`data-path="${path}"`);
  return at < 0 ? '' : page.slice(at, page.indexOf('</figure>', at));
};
const login = figure('docs/auth-design/login-screen.dgm');
check('画面は描かれている', login.includes('<svg'));
check('書かれていない色が、描かれたものには付いている',
  login.includes('#2f6fb5'), '主ボタンの青');
check('部品の既定の大きさが効いている', /width="320"/.test(login));
// 見本には、下敷きにした既定の部品も出る——「ここで何が使えるか」の答えだから
const specimen = figure('shared/ui-parts.dgm');
check('見本も出る', specimen.includes('secondary'));
check('見本には下敷きの部品も出る', specimen.includes('spinner') && specimen.includes('ui/slider'),
  ['spinner', 'slider', 'radio'].filter(name => specimen.includes(name)).join(' '));

// --- 同梱の部品 -------------------------------------------------------------
// 「最低限のものは用意しておく」という指摘への答え。作業場に何も置かなくても
// use "default" だけで一式が使える。
const search = figure('docs/auth-design/search-screen.dgm');
// 見本の頁には全部が出るので、探すのは文書全体にする——画面に出す部品を
// 入れ替えるたびにここが壊れるのは、確かめたいこと（絵が描けること）ではない。
for (const [name, mark] of [
  ['ドロップダウン', 'M143 14'], ['数値入力', 'M106.5 12.5'], ['スライダー', 'M4 12 h152'],
  ['スクロールバー', 'M3.6 4.4'], ['ラジオ（選択）', 'r="4"'], ['画像の枠', 'M12 68'],
  ['表（一覧）', 'M80.7 0.7 v118.6'],
]) {
  check(`${name}が絵として描かれている`, page.includes(mark));
}
// 伸びる絵は、箱の形に合わせて伸びる（正方形に収めると、スクロールバーが点になる）
check('長いものは長いまま描かれる', /scale\(1, 1\)/.test(search) || /scale\([\d.]+, [\d.]+\)/.test(search),
  (search.match(/scale\([^)]*\)/g) ?? []).slice(0, 3).join(' '));

// --- 文字の置き場所 ---------------------------------------------------------
// 絵によって、文字の行き先が違う。ドロップダウンは値を**中に**持ち、ルータは
// 名前を**下に**置き、スクロールバーは**持たない**。
const inside = (name, text) => {
  const at = search.indexOf(`data-node="${name}"`);
  if (at < 0) return undefined;
  // 1 つの図形は入れ子の <g> でできているので、次の図形までを取る。
  const next = search.indexOf('data-node="', at + 1);
  const one = search.slice(at, next < 0 ? search.length : next);
  // 絵は translate で置かれる。その y が外の座標系での上端で、tspan の y も
  // 外の座標系なので、この 2 つだけが比べられる。
  const y = /<tspan[^>]*y="([\d.]+)"/.exec(one);
  const top = /transform="translate\([\d.-]+, ([\d.-]+)\)/.exec(one);
  return { text: one.includes(text), y: y ? Number(y[1]) : undefined,
    top: top ? Number(top[1]) : undefined };
};
const dropdown = inside('dept', '情報システム部');
check('ドロップダウンの文字は中にある', dropdown?.text === true);
// 「箱の中」では緩すぎる。下に寄せてもまだ箱の中なので、**中央に来ているか**を見る。
check('ドロップダウンの文字は上下中央にある',
  dropdown?.y !== undefined && dropdown.top !== undefined
  && Math.abs(dropdown.y - (dropdown.top + 17)) <= 2,
  `中央 ${(dropdown?.top ?? 0) + 17} / 文字 ${dropdown?.y}`);
const spin = inside('age', '30');
check('数値入力の文字も中にある', spin?.text === true);
check('数値入力の文字も上下中央にある',
  spin?.y !== undefined && spin.top !== undefined
  && Math.abs(spin.y - (spin.top + 17)) <= 2,
  `中央 ${(spin?.top ?? 0) + 17} / 文字 ${spin?.y}`);

// 文字を持たない部品に文字を書いたら、黙って消さずに言う
const quiet = `use "default"\n\nfree {\n  bar scrollbar:"ここに文字"\n}\n\n`
  + `layout {\n  bar @ (0, 0)\n}\n`;
const { parseDiagram, withParts, renderDiagram } = await import('@docpresenter/diagram');
const drawn = renderDiagram(withParts(parseDiagram(quiet), () => undefined));
check('スクロールバーに文字は出ない', !drawn.includes('ここに文字'));
check('出ないことは黙らずに言う', drawn.includes('この部品は文字を持たない'),
  (/<!--[^>]*-->/.exec(drawn) ?? [''])[0]);

// --- どんな絵があるか -------------------------------------------------------
const icons = figure('shared/icon-list.dgm');
check('同梱の絵は一覧にできる', icons.includes('<svg'));
for (const name of ['net/router', 'ui/radio-on', 'ui/slider', 'ui/scrollbar-v']) {
  check(`一覧に ${name} が出る`, icons.includes(name));
}

// --- 一度直せば、全部が直る -------------------------------------------------
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const view = await browser.newPage({ viewport: { width: 1280, height: 900 } });
view.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await view.goto('file://' + process.cwd() + '/out/editor.html');
await view.waitForTimeout(600);

await view.click('.dp-tab:has-text("画面部品")');
await view.waitForTimeout(300);
check('部品の見本が画面にも出る',
  await view.isVisible('.dp-sheet:not([hidden]) .dp-figure[data-path$="ui-parts.dgm"] svg'));

// 部品を 1 つ上書きする。1 つのファイルを 1 回書き換えるだけである。上書きするのは
// **どの画面も使っている部品**にする——主ボタンはロック画面に無いので、それを
// 変えても「全部に効く」ことの証明にはならない。
await view.locator('.dp-sheet:not([hidden]) .dp-figure[data-path$="ui-parts.dgm"] .dp-figure-body')
  .first().click();
await view.waitForSelector('.dp-block-source');
const before = await view.inputValue('.dp-block-source');
check('部品のファイルが開く', before.includes('parts {'), before.slice(0, 12));
await view.$eval('.dp-block-source', el => {
  // 同梱の既定にある frame を、この作業場のものとして上書きする
  el.value = el.value.replace(/^\}/m,
    '  frame [ ] { fill: #ffffff, line: #217a3c } 380x300\n}');
});
await view.keyboard.press('Control+Enter');
await view.waitForTimeout(500);

const changed = await view.evaluate(() => {
  const found = {};
  for (const figure of document.querySelectorAll('.dp-figure[data-path$="-screen.dgm"]')) {
    found[figure.dataset.path] = figure.innerHTML.includes('#217a3c');
  }
  return found;
});
const names = Object.keys(changed);
check('書き換えたのは部品のファイル 1 つ',
  (await view.textContent('#status')).includes('ui-parts.dgm'),
  await view.textContent('#status'));
check('部品を使う画面がすべて変わる',
  names.length >= 2 && names.every(path => changed[path]),
  names.map(path => `${path.split('/').pop()}:${changed[path] ? '変' : '不変'}`).join(' '));



// --- 入れ物から出す・戻す ---------------------------------------------------
//
// 入れ物の中の図形も動かせる。動かせば、その 1 つだけがピンを持って入れ物から
// 外れる（既存の「ピンが勝つ」規則）。戻せばまた並びに乗る。
await view.click('.dp-tab:has-text("ログイン機能")');
await view.waitForTimeout(300);
await view.locator('.dp-sheet:not([hidden]) .dp-figure[data-path$="login-screen.dgm"] .dp-figure-body')
  .first().click();
await view.waitForSelector('.dp-canvas-bar');
const screenSource = async () => {
  await view.click('.dp-sheet:not([hidden]) .dp-canvas-bar button:text("ソース")');
  await view.waitForSelector('.dp-block-source');
  const text = await view.inputValue('.dp-block-source');
  await view.keyboard.press('Escape');
  await view.waitForTimeout(250);
  await view.locator('.dp-sheet:not([hidden]) .dp-figure[data-path$="login-screen.dgm"] .dp-figure-body')
    .first().click();
  await view.waitForSelector('.dp-canvas-bar');
  return text;
};
check('画面は入れ物で組まれている', (await screenSource()).includes('stack frame'));

const button = view.locator('.dp-canvas-stage [data-node="submit"]');
const where = await button.boundingBox();
await view.mouse.move(where.x + where.width / 2, where.y + where.height / 2);
await view.mouse.down();
await view.mouse.move(where.x + where.width / 2 + 60, where.y + where.height / 2 + 30, { steps: 8 });
await view.mouse.up();
await view.waitForTimeout(400);
const moved = await screenSource();
check('入れ物の中の図形も動かせる', /^\s*submit\s+@ \(/m.test(moved),
  (/^.*submit.*@.*$/m.exec(moved) ?? [''])[0].trim());
check('動かしたのはその 1 つだけ', (moved.match(/@ \(/g) ?? []).length === 2,
  `座標を持つ行 ${(moved.match(/@ \(/g) ?? []).length} 本`);

// ソースを見に行くと選択は外れるので、選び直してから戻す口を見る
await view.click('.dp-canvas-stage [data-node="submit"]');
await view.waitForTimeout(200);
check('戻す口が「入れ物に戻す」になり、押せる',
  (await view.textContent('.dp-sheet:not([hidden]) .dp-canvas-bar')).includes('入れ物に戻す')
  && await view.isEnabled('.dp-sheet:not([hidden]) .dp-canvas-bar button:text("入れ物に戻す")'),
  await view.textContent('.dp-sheet:not([hidden]) .dp-canvas-where'));
await view.click('.dp-sheet:not([hidden]) .dp-canvas-bar button:text("入れ物に戻す")');
await view.waitForTimeout(400);
const back = await screenSource();
check('戻せば並びに乗る', !/^\s*submit\s+@ \(/m.test(back),
  (back.match(/@ \(/g) ?? []).length + ' 本');

// --- 「＋ 部品」の一覧 -------------------------------------------------------
//
// 絵を 10 枚足したら、一覧が画面に収まらなくなった。見出しで区切っても、下まで
// 見るには結局同じだけ送ることになる。だから区分は「開く行」にした。見たいのは
// 上の段が送らずに読めること、開いた先も画面に収まること、そしてどの絵もどこかの
// 区分から出せること——どれかが欠けると、押せない絵が生まれる。
const { stencilParts } = await import('@docpresenter/diagram');

const openMenu = async (view) => {
  await view.goto('file://' + process.cwd() + '/out/editor.html');
  await view.waitForTimeout(500);
  await view.click('.dp-tab[data-index="2"]');
  await view.waitForTimeout(250);
  await view.locator('.dp-sheet:not([hidden]) .dp-figure-body').first().click();
  await view.waitForSelector('.dp-canvas-bar');
  await view.click('.dp-canvas-bar button:text("＋ 部品")');
  await view.waitForSelector('.dp-menu');
};

/** 開いている段を測る。深さ 0 が区分の段、1 がその区分の絵。 */
const measure = (view, depth) => view.evaluate(level => {
  const panels = [document.querySelector('.dp-menu:not(.dp-menu-sub)'),
    ...document.querySelectorAll('.dp-menu-sub')];
  const node = panels[level];
  if (!node) return undefined;
  const box = node.getBoundingClientRect();
  const rows = [...node.querySelectorAll('button')];
  const parent = panels[level - 1]?.getBoundingClientRect();
  return {
    labels: rows.map(one => one.textContent.trim()),
    opens: rows.filter(one => one.getAttribute('aria-haspopup') === 'menu').length,
    top: box.top, bottom: box.bottom, view: window.innerHeight,
    scrolls: node.scrollHeight > node.clientHeight, content: node.scrollHeight,
    // 親の行の横（右、無理なら左）に出ている。重ねて出したら親が読めない。
    beside: parent ? box.left >= parent.right - 6 || box.right <= parent.left + 6 : undefined,
    panels: document.querySelectorAll('.dp-menu-sub').length,
  };
}, depth);

const canvas = await browser.newPage({ viewport: { width: 1280, height: 760 } });
canvas.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await openMenu(canvas);

const kinds = await measure(canvas, 0);
check('上の段は区分だけが並ぶ',
  kinds.opens === kinds.labels.length && kinds.opens >= 2, kinds.labels.join(' / '));
check('上の段は送らずに全部読める',
  !kinds.scrolls && kinds.top >= 0 && kinds.bottom <= kinds.view,
  `${Math.round(kinds.bottom - kinds.top)}px / 画面 ${kinds.view}`);

// 区分を開く。開いた先は親の横に出て、そこだけで完結している。
let found = 0;
const kindRow = name => `.dp-menu:not(.dp-menu-sub) button:text("${name}")`;
for (const name of kinds.labels) {
  await canvas.hover(kindRow(name));
  await canvas.waitForSelector('.dp-menu-sub');
  // 開いているものから別の区分へ移るときは、ひと呼吸置いてから入れ替わる。
  await canvas.waitForTimeout(350);
  const sub = await measure(canvas, 1);
  found += sub.labels.length;
  check(`${name}を開くと、その区分の絵が出る`, sub.labels.length >= 8 && sub.opens === 0,
    `${sub.labels.length} 件: ${sub.labels.slice(0, 3).join(' ')}…`);
  check(`${name}は親の横に出る`, sub.beside === true);
  check(`${name}も画面に収まる`,
    !sub.scrolls && sub.top >= 0 && sub.bottom <= sub.view,
    `${Math.round(sub.top)}〜${Math.round(sub.bottom)} / 画面 ${sub.view}`);
  // ほかの区分に移ったら、前の区分は閉じている
  check(`開くのは一度に一区分だけ`, sub.panels === 1, `${sub.panels} 枚`);
}
check('同梱の絵はどれかの区分から出せる', found === stencilParts().length,
  `${found} / ${stencilParts().length} 件`);

// 小窓へは斜めに手が動くので、途中で隣の行を通る。通った瞬間に入れ替わると
// 開いた一覧が目の前で消えるので、ひと呼吸だけ待つ。
const firstOf = async () => (await measure(canvas, 1)).labels[0];
await canvas.hover(kindRow(kinds.labels[0]));
await canvas.waitForTimeout(350);
const held = await firstOf();
await canvas.hover(kindRow(kinds.labels.at(-1)));
await canvas.waitForTimeout(80);
check('隣を通っただけでは入れ替わらない', (await firstOf()) === held, held);
await canvas.waitForTimeout(400);
check('留まれば入れ替わる', (await firstOf()) !== held, await firstOf());
check('表の部品がある',
  (await canvas.textContent('.dp-menu-sub')).includes('表（一覧）'));

// 押せば本当に足される。候補を並べ替えても、ここは押した結果を見る——
// 書き換わるのは図のファイルなので、見るのは描かれた絵と、書き換えの報せ。
const figureNow = () => canvas.innerHTML('.dp-sheet:not([hidden]) .dp-figure');
check('押す前は表が無い', !(await figureNow()).includes('M80.7 0.7'));
await canvas.click('.dp-menu-sub button:text("表（一覧）")');
await canvas.waitForTimeout(400);
check('区分から選ぶと図に足される', (await figureNow()).includes('M80.7 0.7'),
  await canvas.textContent('#status'));
check('足したのは図のファイル', (await canvas.textContent('#status')).includes('.dgm'),
  await canvas.textContent('#status'));
check('選んだらメニューは閉じる', (await canvas.$$('.dp-menu-sub')).length === 0);

// --- 鍵盤でも辿れる ---------------------------------------------------------
//
// 開き直しを挟む。上の段は開くたびに組み直されるので、鍵盤の受け口を組み立ての
// たびに足していると、開いた回数ぶん一度に飛ぶ。
for (let i = 0; i < 3; i++) {
  await canvas.click('.dp-canvas-bar button:text("＋ 部品")');
  await canvas.waitForSelector('.dp-menu button');
  await canvas.keyboard.press('Escape');
  await canvas.waitForTimeout(80);
}
await canvas.click('.dp-canvas-bar button:text("＋ 部品")');
await canvas.waitForSelector('.dp-menu button');
const onRow = () => canvas.evaluate(() => document.activeElement?.textContent?.trim());
check('開いた直後は先頭の行にいる', (await onRow()) === kinds.labels[0], await onRow());
await canvas.keyboard.press('ArrowDown');
check('↓ は一行だけ動く', (await onRow()) === kinds.labels[1], await onRow());
await canvas.keyboard.press('ArrowRight');
await canvas.waitForSelector('.dp-menu-sub');
const firstSub = (await measure(canvas, 1)).labels[0];
check('→ で区分が開き、その先頭にいる', (await onRow()) === firstSub, await onRow());
await canvas.keyboard.press('ArrowLeft');
check('← で区分の段に戻る',
  (await onRow()) === kinds.labels[1] && (await canvas.$$('.dp-menu-sub')).length === 0,
  await onRow());
await canvas.keyboard.press('Escape');
check('上の段で Esc なら閉じる', !(await canvas.isVisible('.dp-menu')));

// 狭い画面でも同じこと
const small = await browser.newPage({ viewport: { width: 1100, height: 520 } });
await openMenu(small);
const narrow = await measure(small, 0);
check('狭い画面でも区分の段は収まっている',
  !narrow.scrolls && narrow.top >= 0 && narrow.bottom <= narrow.view,
  `${Math.round(narrow.top)}〜${Math.round(narrow.bottom)} / 画面 ${narrow.view}`);
await small.hover(`.dp-menu:not(.dp-menu-sub) button:text("${narrow.labels.at(-1)}")`);
await small.waitForSelector('.dp-menu-sub');
const deep = await measure(small, 1);
check('狭い画面でも開いた先が収まっている',
  deep.top >= 0 && deep.bottom <= deep.view,
  `${Math.round(deep.top)}〜${Math.round(deep.bottom)} / 画面 ${deep.view}`);
// 送ることになっても、一画面ぶんを超えては送らない——「大量に送る」のが
// やめたかったことなので、そこに線を引く。
check('狭い画面でも送る量は一画面を超えない', deep.content <= deep.view,
  `中身 ${deep.content}px / 画面 ${deep.view}`);

await browser.close();
