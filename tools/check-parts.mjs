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



// --- 「＋ 部品」の一覧 -------------------------------------------------------
//
// 絵を 10 枚足したら、一覧が画面に収まらなくなった。収まらない先は誰にも押せない。
// 見たいのは「区分で分かれていること」と「どの画面の高さでも全部が押せること」。
const canvas = await browser.newPage({ viewport: { width: 1280, height: 760 } });
canvas.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await canvas.goto('file://' + process.cwd() + '/out/editor.html');
await canvas.waitForTimeout(500);
await canvas.click('.dp-tab[data-index="2"]');
await canvas.waitForTimeout(250);
await canvas.locator('.dp-sheet:not([hidden]) .dp-figure-body').first().click();
await canvas.waitForSelector('.dp-canvas-bar');
await canvas.click('.dp-canvas-bar button:text("＋ 部品")');
await canvas.waitForSelector('.dp-menu');

const menu = await canvas.evaluate(() => {
  const node = document.querySelector('.dp-menu');
  const box = node.getBoundingClientRect();
  return {
    groups: [...node.querySelectorAll('.dp-menu-group')].map(one => one.textContent),
    items: node.querySelectorAll('button').length,
    top: box.top, bottom: box.bottom, view: window.innerHeight,
    scrolls: node.scrollHeight > node.clientHeight,
    // 見出しは送っている間も見えている
    sticky: getComputedStyle(node.querySelector('.dp-menu-group')).position,
  };
});
check('区分の見出しが出る', menu.groups.length >= 2, menu.groups.join(' / '));
check('同梱の絵はすべて候補に出る', menu.items >= 20, `${menu.items} 件`);
check('一覧は画面に収まっている',
  menu.top >= 0 && menu.bottom <= menu.view,
  `${Math.round(menu.top)}〜${Math.round(menu.bottom)} / 画面 ${menu.view}`);
check('収まらないぶんは送って出せる', menu.scrolls === true);
check('送っている間も区分が見える', menu.sticky === 'sticky');
check('表の部品がある', (await canvas.textContent('.dp-menu')).includes('表（一覧）'));

// 狭い画面でも同じこと
const small = await browser.newPage({ viewport: { width: 1100, height: 520 } });
await small.goto('file://' + process.cwd() + '/out/editor.html');
await small.waitForTimeout(500);
await small.click('.dp-tab[data-index="2"]');
await small.waitForTimeout(250);
await small.locator('.dp-sheet:not([hidden]) .dp-figure-body').first().click();
await small.waitForSelector('.dp-canvas-bar');
await small.click('.dp-canvas-bar button:text("＋ 部品")');
await small.waitForSelector('.dp-menu');
const narrow = await small.evaluate(() => {
  const box = document.querySelector('.dp-menu').getBoundingClientRect();
  return { top: box.top, bottom: box.bottom, view: window.innerHeight };
});
check('狭い画面でも収まっている',
  narrow.top >= 0 && narrow.bottom <= narrow.view,
  `${Math.round(narrow.top)}〜${Math.round(narrow.bottom)} / 画面 ${narrow.view}`);

await browser.close();
