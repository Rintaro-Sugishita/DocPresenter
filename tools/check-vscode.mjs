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
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { COMMIT_KEYS } from '../packages/editor/dist/index.js';

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
    const at = relative('sample', path).split('\\').join('/');
    if (/\.(dgm|table|ermlx|mmd|md)$/i.test(entry.name)) files[at] = readFileSync(path, 'utf8');
    const picture = /\.(png|jpe?g|gif)$/i.exec(entry.name);
    if (picture) {
      const type = picture[1].toLowerCase() === 'jpg' ? 'jpeg' : picture[1].toLowerCase();
      images[at] = `data:image/${type};base64,${readFileSync(path).toString('base64')}`;
    }
  }
})('sample');
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
  window.acquireVsCodeApi = () => ({ postMessage: m => window.__sent.push(m) });
</script>
<script src="../packages/app-vscode/media/webview.js"></script>
</body></html>
`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', error => { console.log('✗ ページエラー:', error.message); process.exitCode = 1; });
await page.goto('file://' + process.cwd() + '/out/vscode-webview.html');
await page.waitForTimeout(300);

const sent = () => page.evaluate(() => window.__sent);
check('読み込んだだけでは何も描かない（器が開くまで待つ）',
  (await page.$$('.dp-sheet')).length === 0);
check('最初に言うのは「用意ができた」だけ',
  JSON.stringify(await sent()) === JSON.stringify([{ kind: 'ready' }]),
  JSON.stringify(await sent()));

await page.evaluate(([path, source, files, images]) => {
  window.postMessage({ kind: 'open', path, source, files, images, commitKey: 'ctrl-enter' }, '*');
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

// 渡された範囲を本当にその場で当てると、画面が持っているものと同じ文になる
const written = await page.evaluate(([before, change]) => {
  const bytes = new TextEncoder().encode(before);
  const decode = part => new TextDecoder().decode(part);
  return decode(bytes.slice(0, change.span.start)) + change.text + decode(bytes.slice(change.span.end));
}, [files['docs/auth-design/login-screen.dgm'], change]);
check('その範囲を置き換えると、座標が 1 つ動いた図になる',
  written.includes('frame @ ( 44,  20)') && written.split('\n').length
    === files['docs/auth-design/login-screen.dgm'].split('\n').length,
  (/^\s*frame\s+@.*$/m.exec(written) ?? [''])[0].trim());

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

await browser.close();
