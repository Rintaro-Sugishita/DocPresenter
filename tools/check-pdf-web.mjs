// The PDF, made in the browser.
//
// The command line has had this for a while; what this checks is that the same
// pipeline runs with nothing behind it — no Node, no Chromium being driven from
// outside, no font server. The page carries the fonts it needs, cut down to the
// characters this document uses, and writes the file itself.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });

// 外に何も取りに行かないこと。フォントも器の中にある。
const outside = [];
page.on('request', request => {
  const url = request.url();
  if (!url.startsWith('file://') && !url.startsWith('data:') && !url.startsWith('blob:')) outside.push(url);
});

await page.goto('file://' + process.cwd() + '/out/editor.html');
await page.waitForTimeout(600);

check('PDF のボタンがある', await page.isVisible('#make-pdf'));

const started = Date.now();
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  page.click('#make-pdf'),
]);
const took = Date.now() - started;
check('押すとファイルが降りてくる', download !== undefined, `${took} ms`);
check('文書番号が名前になる', download.suggestedFilename() === 'SD-AUTH-001.pdf',
  download.suggestedFilename());

const path = 'out/editor-web.pdf';
await download.saveAs(path);
const bytes = new Uint8Array(readFileSync(path));
const size = bytes.byteLength;
const pdf = await getDocument({ data: bytes, useSystemFonts: false }).promise;

check('ページが揃っている', pdf.numPages >= 12, `${pdf.numPages} ページ`);
check('埋め込みフォントの分だけで収まっている', size < 2 * 1024 * 1024,
  `${(size / 1024).toFixed(0)} KB`);

const texts = [];
for (let i = 1; i <= pdf.numPages; i++) {
  const one = await pdf.getPage(i);
  texts.push((await one.getTextContent()).items.map(item => item.str).join(''));
}
const whole = texts.join('\n');
for (const expected of [
  '本書は、会員向け Web サービスにおける認証機能の設計を示す。',
  '図 1 認証まわりのシステム構成',
  '表 1 ログイン画面 項目定義',
]) {
  check(`本文が取り出せる: ${expected.slice(0, 14)}…`, whole.includes(expected));
}
check('数字が数字として取り出せる', whole.includes('SD-AUTH-001'),
  /SD-AUTH-\S{1,8}/.exec(whole)?.[0] ?? '');
check('横向きのページも出ている',
  (await Promise.all([...Array(pdf.numPages).keys()].map(async i => {
    const [, , w, h] = (await pdf.getPage(i + 1)).view;
    return w > h;
  }))).some(Boolean));

check('外から取りに行っていない', outside.length === 0, outside.join(' '));
check('作れたと言っている', (await page.textContent('#status')).includes('ページの PDF'),
  await page.textContent('#status'));

// 同梱していない字は、黙って消さずに名指しで報告する
await page.click('.dp-tab:has-text("用語")');
await page.waitForTimeout(200);
await page.click('.dp-sheet:not([hidden]) .dp-prose');
await page.waitForSelector('.dp-block-source');
await page.$eval('.dp-block-source', el => { el.value = el.value + '\n\n鬱蠡驫'; });
await page.click('.dp-tabbar-spacer');
await page.waitForTimeout(400);
const second = page.waitForEvent('download', { timeout: 60000 });
await page.click('#make-pdf');
await second;
const said = await page.textContent('#status');
check('同梱していない字は名指しで報告する', said.includes('無い字'), said);

await browser.close();
