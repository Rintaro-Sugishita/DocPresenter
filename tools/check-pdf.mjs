// The PDF, read back by the engine Firefox uses.
//
// A PDF is checked by reading it, not by looking at the code that wrote it.
// Two things matter beyond "a file appeared": the Japanese text has to come
// back out — a reviewer selects it to attach a comment, and a font embedded
// wrongly extracts as nothing — and the drawings have to be real marks on the
// page rather than a picture that failed to arrive.
import { readFileSync } from 'node:fs';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

const bytes = new Uint8Array(readFileSync('out/build/auth-design.pdf'));
const pdf = await getDocument({ data: bytes, useSystemFonts: false }).promise;

check('ページがある', pdf.numPages >= 8, `${pdf.numPages} ページ`);

const meta = await pdf.getMetadata();
check('題名が入っている', (meta.info.Title ?? '').includes('認証機能'), meta.info.Title);
check('生成元のコミットが埋まっている', /commit:[0-9a-f]{40}/.test(meta.info.Keywords ?? ''),
  meta.info.Keywords);

const texts = [];
const operators = [];
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const content = await page.getTextContent();
  texts.push(content.items.map(item => item.str).join(''));
  operators.push(await page.getOperatorList());
}
const whole = texts.join('\n');

// 日本語が取り出せる＝読み手が選択・検索・引用できる
for (const expected of [
  '本書は、会員向け Web サービスにおける認証機能の設計を示す。',
  '認証失敗が 5 回に達した時点でアカウントをロックする。',
  'セッションキャッシュ',
  '図 1 認証まわりのシステム構成',
  '表 1 ログイン画面 項目定義',
]) {
  check(`本文が取り出せる: ${expected.slice(0, 16)}…`, whole.includes(expected));
}
check('参照が番号に解決されている', whole.includes('図 1 に示す'), '');
check('見出しの採番が入っている', /1\s*概要/.test(whole));
check('取り込んだ文書の節も入っている', whole.includes('改訂履歴'));

// 柱（ページ番号と文書番号）が全ページにある
const feet = texts.filter(text => /SD-AUTH-001.+\d+ \/ \d+/.test(text));
check('全ページに柱がある', feet.length === pdf.numPages, `${feet.length}/${pdf.numPages}`);

// 図はページに描かれた線と塗りであって、貼られた絵ではない
const drawn = operators.map(list => list.fnArray.filter(fn =>
  fn === OPS.constructPath || fn === OPS.fill || fn === OPS.stroke
  || fn === OPS.fillStroke || fn === OPS.eoFill).length);
const figurePage = drawn.findIndex(count => count > 40);
check('図が線と塗りで描かれている', figurePage >= 0,
  `最も多いページで ${Math.max(...drawn)} 個の描画命令`);

// 画像は貼られている（注釈図の下地）
const images = operators.some(list => list.fnArray.some(fn =>
  fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintInlineImageXObject));
check('画像が埋め込まれている', images);

// 埋め込みフォントで描かれている（標準 14 書体では日本語は出ない）
const fonts = new Set();
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  for (const item of (await page.getTextContent()).items) {
    if (item.fontName) fonts.add(item.fontName);
  }
}
check('フォントが埋め込まれている', fonts.size > 0, [...fonts].join(' '));

// 表の罫線
check('表の罫線が引かれている', drawn.some(count => count > 20));
