// Changes, marked from the repository rather than by hand.
//
// The test is built the way the feature is meant to be used: a previous version
// is put beside the current one, four things are different, and the build is
// asked to compare. Three of them have to show. The fourth — a shape that was
// only moved — must not, because moving something is not changing it, and a
// drawing that comes back marked as rewritten every time someone tidies it up
// is a drawing nobody will tidy up.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

const BEFORE = 'out/diff-before';
rmSync(BEFORE, { recursive: true, force: true });
mkdirSync('out', { recursive: true });
cpSync('sample', BEFORE, { recursive: true });

const edit = (path, from, to) => {
  const full = `${BEFORE}/${path}`;
  const source = readFileSync(full, 'utf8');
  if (!source.includes(from)) throw new Error(`標本が変わっている: ${path} に「${from}」が無い`);
  writeFileSync(full, source.replace(from, to));
};

// 「前の版」はこう書かれていた
edit('docs/auth-design.md',
  '認証失敗が 5 回に達した時点でアカウントをロックする。',
  '認証失敗が 3 回に達した時点でアカウントをロックする。');
edit('shared/system-architecture.dgm',
  'cache   [(セッションキャッシュ)]', 'cache   [(セッション置き場)]');
edit('docs/auth-design/screen-items.table',
  '| 入力 |  1 | ログイン ID', '| 入力 |  1 | ログイン名');
// 位置だけの違い。これは変更ではない
edit('shared/system-architecture.dgm',
  '  api     @ (460, 120) 140x60', '  api     @ (480, 140) 140x60');

execFileSync('node', ['tools/build.mjs', '--in', 'sample', '--diff-from', BEFORE],
  { encoding: 'utf8' });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await page.goto('file://' + process.cwd() + '/out/build/docs/auth-design.html');
await page.waitForTimeout(300);

const marked = selector => page.$$eval(selector, nodes => nodes.map(n => n.textContent.trim()));

const prose = await marked('.dp-prose.dp-diff-changed');
check('変わった段落に印が付く', prose.length === 1 && prose[0].includes('5 回'),
  prose.join(' / ').slice(0, 60));

const cells = await marked('td.dp-diff-changed');
check('変わったセルだけに印が付く', cells.length === 1 && cells[0] === 'ログイン ID',
  cells.join(' / '));

const shapes = await page.$$eval('.dp-diagram .dp-diff-changed',
  nodes => nodes.map(n => n.getAttribute('data-node')));
check('変わった図形に印が付く', shapes.length === 1 && shapes[0] === 'cache', shapes.join(' / '));
check('動かしただけの図形には印が付かない', !shapes.includes('api'), shapes.join(' / '));

check('凡例が出る', await page.isVisible('.dp-diff-legend'),
  (await page.textContent('.dp-diff-legend')).replace(/\s+/g, ' ').trim());
check('何と比べたかが書いてある',
  (await page.textContent('.dp-diff-from')).includes(BEFORE),
  await page.textContent('.dp-diff-from'));

// 色だけに頼らない（白黒でも位置が分かる）
const band = await page.$eval('.dp-prose.dp-diff-changed',
  node => getComputedStyle(node).borderLeftWidth);
check('色のほかに帯が付く', band !== '0px', band);

// 印はソースに 1 バイトも書かれない
const source = readFileSync('sample/shared/system-architecture.dgm', 'utf8');
check('ソースには何も書かれない', !source.includes('diff') && !source.includes('changed'));

await page.screenshot({ path: 'out/diff-page.png' });

// PDF は組版済みの DOM を読むので、HTML に付いた印はそのまま PDF に出る
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
const pdf = await getDocument({
  data: new Uint8Array(readFileSync('out/build/docs/auth-design.pdf')), useSystemFonts: false,
}).promise;
const lastPage = await pdf.getPage(pdf.numPages);
const tail = (await lastPage.getTextContent()).items.map(item => item.str).join('');
check('PDF にも凡例が出る', tail.includes('からの変更'), tail.slice(-40));

// PPTX はスライドに CSS が無いので、色を自分で持つ
const deck = readFileSync('out/build/docs/auth-overview.pptx');
const { unzipSync, strFromU8 } = await import('fflate');
const slides = unzipSync(new Uint8Array(deck));
const architecture = Object.keys(slides).find(name =>
  /slide\d+\.xml$/.test(name) && strFromU8(slides[name]).includes('system-architecture.dgm'));
const xml = strFromU8(slides[architecture]);
const fillOf = id => {
  const at = xml.indexOf(`name="${id}"`);
  return /srgbClr val="([0-9A-F]{6})"/.exec(xml.slice(at, at + 600))?.[1];
};
check('PPTX では変わった図形の塗りが変わる', fillOf('cache') === 'FDF0D5', fillOf('cache'));
check('PPTX では変わっていない図形はそのまま', fillOf('web') === 'FFFFFF', fillOf('web'));

// 比べる相手が無いときは、印も凡例も出ない
execFileSync('node', ['tools/build.mjs', '--in', 'sample'], { encoding: 'utf8' });
await page.goto('file://' + process.cwd() + '/out/build/docs/auth-design.html');
await page.waitForTimeout(200);
check('比較しないビルドには印が出ない', (await page.$$('.dp-diff-changed')).length === 0);
check('比較しないビルドには凡例も出ない', (await page.$$('.dp-diff-legend')).length === 0);

await browser.close();
