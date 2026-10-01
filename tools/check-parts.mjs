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
check('見本も出る', figure('shared/ui-parts.dgm').includes('secondary'));

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

// 部品の色を変える。1 つのファイルを 1 回書き換えるだけである。変えるのは
// **3 枚すべてが使っている部品**にする——主ボタンはロック画面に無いので、
// それを変えても「全部に効く」ことの証明にはならない。
await view.locator('.dp-sheet:not([hidden]) .dp-figure[data-path$="ui-parts.dgm"] .dp-figure-body')
  .first().click();
await view.waitForSelector('.dp-block-source');
const before = await view.inputValue('.dp-block-source');
check('部品のファイルが開く', before.includes('parts {'), before.slice(0, 12));
await view.$eval('.dp-block-source', el => {
  el.value = el.value.replace(/#d3d7dd/g, '#217a3c');   // frame の枠線
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

await browser.close();
