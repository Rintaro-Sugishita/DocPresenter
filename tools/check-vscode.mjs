// The VS Code shell's screen, without VS Code.
//
// The extension is two programs. The host half is run in the unit tests
// against an API that does what VS Code's does; this is the other half: the
// real bundle, in a real browser, over the real sample — with `acquireVsCodeApi`
// standing in for the bridge.
//
// What is checked is the contract between them: the screen draws from what it
// is given, every edit leaves as one byte range with the file's own path, and
// a file changed by somebody else redraws the screen rather than being ignored.
//
// Usage: node tools/check-vscode.mjs [--chromium <path>] [--in <sample>]
//
// The sample is used as it is checked out, so on a CRLF checkout this is the
// CRLF case (`--in` names a copy, to try the other one). Either way the edit is made once more on the sample with the
// other line ending, and must leave as the same range.
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { replaceBytes, spanInFile, toLf } from '../packages/base/dist/index.js';
import { COMMIT_KEYS } from '../packages/editor/dist/index.js';
import { findChromium } from './pdf-writer.mjs';

const option = name => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};
const chromiumAt = option('--chromium');
const sampleDir = option('--in') ?? 'sample';

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

// --- 名乗りと中身が合っているか ---------------------------------------------
//
// manifest は VS Code への名乗りであって、コードとは別のファイルである。
// 名乗ったコマンドが登録されていなければ、押せないメニューが出るだけで、
// どちらのファイルも単体では間違っていない。だから突き合わせる。
const manifest = JSON.parse(readFileSync('packages/app-vscode/package.json', 'utf8'));
const extensionSource = readFileSync('packages/app-vscode/src/extension.ts', 'utf8')
  + readFileSync('packages/app-vscode/src/sheet-editor.ts', 'utf8');
const named = manifest.contributes.commands.map(one => one.command);
check('名乗ったコマンドは、すべて登録されている',
  named.every(name => extensionSource.includes(`'${name}'`)), named.join(' / '));
check('カスタムエディタの viewType は、コードと同じ',
  extensionSource.includes(`'${manifest.contributes.customEditors[0].viewType}'`),
  manifest.contributes.customEditors[0].viewType);
check('既定のエディタは奪わない（priority は option）',
  manifest.contributes.customEditors[0].priority === 'option');
check('設定の確定キーは、エディタが知っているものと同じ',
  JSON.stringify(manifest.contributes.configuration.properties['docpresenter.commitKey'].enum)
  === JSON.stringify(COMMIT_KEYS), COMMIT_KEYS.join(' '));
check('拡張が読み込むのは束ねたものだけ',
  manifest.main === './media/extension.cjs'
  && existsSync('packages/app-vscode/media/extension.cjs')
  && existsSync('packages/app-vscode/media/webview.js'));

const files = {};
const images = {};
(function collect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) { collect(path); continue; }
    const at = relative(sampleDir, path).split('\\').join('/');
    if (/\.(dgm|table|ermlx|mmd|md)$/i.test(entry.name)) files[at] = readFileSync(path, 'utf8');
    const picture = /\.(png|jpe?g|gif)$/i.exec(entry.name);
    if (picture) {
      const type = picture[1].toLowerCase() === 'jpg' ? 'jpeg' : picture[1].toLowerCase();
      images[at] = `data:image/${type};base64,${readFileSync(path).toString('base64')}`;
    }
  }
})(sampleDir);
const DOC = 'docs/auth-design.md';

mkdirSync('out', { recursive: true });
writeFileSync('out/vscode-webview.html', `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="../packages/app-vscode/media/theme.css">
<style>html, body { height: 100%; margin: 0; max-width: none; }</style>
</head><body>
<div id="editor"></div>
<script>
  window.__sent = [];
  window.acquireVsCodeApi = () => ({ postMessage: m => window.__sent.push(m), getState: () => window.__state, setState: s => { window.__state = s; } });
</script>
<script src="../packages/app-vscode/media/webview.js"></script>
</body></html>
`);

const browser = await chromium.launch({ executablePath: findChromium(chromiumAt) });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', error => { console.log('✗ ページエラー:', error.message); process.exitCode = 1; });
await page.goto(pathToFileURL(resolve('out/vscode-webview.html')).href);
await page.waitForTimeout(300);

const sent = () => page.evaluate(() => window.__sent);
check('読み込んだだけでは何も描かない（器が開くまで待つ）',
  (await page.$$('.dp-sheet')).length === 0);
check('最初に言うのは「用意ができた」だけ',
  JSON.stringify(await sent()) === JSON.stringify([{ kind: 'ready' }]),
  JSON.stringify(await sent()));

await page.evaluate(([path, source, files, images]) => {
  window.postMessage({ kind: 'open', path, source, files, images, commitKey: 'ctrl-enter', locale: 'ja' }, '*');
}, [DOC, files[DOC], files, images]);
await page.waitForTimeout(800);

check('渡された文書がシートになる', (await page.$$('.dp-sheet')).length >= 6,
  `${(await page.$$('.dp-sheet')).length} 枚`);
check('図も表も描かれる',
  (await page.$$('.dp-sheet:not([hidden]) svg.dp-diagram')).length > 0
  || (await page.$$('svg.dp-diagram')).length > 0,
  `${(await page.$$('svg.dp-diagram')).length} 枚`);
check('画像も出る（器が渡した URL で）',
  (await page.$$('img[src^="data:image"]')).length > 0);

// --- 編集が 1 つのバイト範囲として出ていく ----------------------------------
/** 図を開いて枠を選び、右へ 1 つ動かす。 */
async function nudgeFrame() {
  await page.click('.dp-tab:has-text("ログイン機能")');
  await page.waitForTimeout(300);
  await page.locator('.dp-sheet:not([hidden]) .dp-figure[data-path$="login-screen.dgm"] .dp-figure-body')
    .first().click();
  await page.waitForSelector('.dp-canvas-bar');
  // 枠は中身に覆われているので、余白のところを押す（真ん中は子が持っている）。
  const frame = await page.locator('.dp-canvas-stage [data-node="frame"]').boundingBox();
  await page.mouse.click(frame.x + 8, frame.y + 8);
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
}
await nudgeFrame();

const changes = (await sent()).filter(one => one.kind === 'change');
check('編集は 1 つだけ出ていく', changes.length === 1, `${changes.length} 件`);
const change = changes[0] ?? {};
check('どのファイルかを、作業場からの道で言う',
  change.path === 'docs/auth-design/login-screen.dgm', String(change.path));
check('どこを書き換えるかを、バイト範囲で言う',
  Number.isInteger(change.span?.start) && change.span.end > change.span.start,
  JSON.stringify(change.span));
check('置き換える文字も一緒に渡す', typeof change.text === 'string' && change.text.length > 0,
  JSON.stringify(change.text));
check('何をしたかも言う（器が人に見せる）', typeof change.description === 'string'
  && change.description.length > 0, change.description);

// 渡された範囲を、器（sheet-editor.ts）と同じやり方でファイルに当てると、
// 座標が 1 つ動いた図になる。範囲は LF で読んだ本文の上で測られているので、
// CRLF のファイルでは器が置き直す。
const drawing = files['docs/auth-design/login-screen.dgm'];
const crlf = drawing.includes('\r\n');
const there = spanInFile(drawing, change);
const written = replaceBytes(drawing, there.span.start, there.span.end, there.text);
check('その範囲を置き換えると、座標が 1 つ動いた図になる',
  written.includes('frame @ ( 44,  20)') && written.split('\n').length === drawing.split('\n').length,
  (/^\s*frame\s+@.*$/m.exec(written) ?? [''])[0].trim());
check(`書き戻しても改行は ${crlf ? 'CRLF' : 'LF'} のまま`,
  (written.match(/\r\n/g) ?? []).length === (crlf ? written.split('\n').length - 1 : 0));
check('範囲は LF で読んだ本文の上で測られている',
  replaceBytes(toLf(drawing), change.span.start, change.span.end, change.text) === toLf(written));

// --- 外から書き換えられたら描き直す ----------------------------------------
await page.evaluate(([path, text]) => {
  window.postMessage({ kind: 'file', path, text }, '*');
}, ['docs/auth-design/login-screen.dgm',
  files['docs/auth-design/login-screen.dgm'].replace('サービスにログイン', 'サービスにサインイン')]);
await page.waitForTimeout(600);
check('外からの書き換えは画面に出る',
  (await page.innerHTML('.dp-sheet:not([hidden])')).includes('サインイン'));
check('描き直しても、見ていたシートのまま',
  (await page.getAttribute('.dp-tab:has-text("ログイン機能")', 'aria-selected')) === 'true'
  || !(await page.isHidden('.dp-sheet:not([hidden])')));

// --- 改行が違っても、同じ範囲が出ていく ------------------------------------
//
// レビューの指摘は「コミット＋バイト範囲」に付く（design/review-model.md §3）。
// 同じコミットが Linux では LF、Windows では CRLF で取り出されるので、範囲が
// 改行に左右されると、同じ指摘が機械ごとに別の場所を指す。
const flip = text => (crlf ? toLf(text) : toLf(text).replace(/\n/g, '\r\n'));
const flipped = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, flip(text)]));
await page.evaluate(() => { window.__sent.length = 0; });
await page.evaluate(([path, source, files, images]) => {
  window.postMessage({ kind: 'open', path, source, files, images, commitKey: 'ctrl-enter', locale: 'ja' }, '*');
}, [DOC, flipped[DOC], flipped, images]);
await page.waitForTimeout(800);
await nudgeFrame();
const other = (await sent()).filter(one => one.kind === 'change')[0] ?? {};
check(`${crlf ? 'LF' : 'CRLF'} の標本でも、同じ範囲と同じ文字が出ていく`,
  JSON.stringify(other.span) === JSON.stringify(change.span) && other.text === change.text,
  `${JSON.stringify(change.span)} / ${JSON.stringify(other.span)}`);

await browser.close();
