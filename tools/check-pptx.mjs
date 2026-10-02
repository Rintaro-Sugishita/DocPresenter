// The deck, read back as a package.
//
// What matters about this output is not that a .pptx appeared: it is that the
// drawing arrives as shapes the person receiving it can take hold of. A slide
// carrying a picture of a diagram would pass "a file was produced" and fail the
// only requirement the format has. So the checks look for presets, connectors
// and a real table, and for the absence of a pasted picture where a drawing
// should be.
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

const bytes = new Uint8Array(readFileSync('out/build/auth-overview.pptx'));
const files = unzipSync(bytes);
const names = Object.keys(files);
const text = path => strFromU8(files[path]);

check('内容の型が先頭にある', names[0] === '[Content_Types].xml', names[0]);
for (const required of [
  '_rels/.rels', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels',
  'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml',
  'ppt/theme/theme1.xml', 'docProps/core.xml',
]) {
  check(`${required} がある`, names.includes(required));
}

const slides = names.filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
check('スライドがある', slides.length >= 4, `${slides.length} 枚`);

// 関係の指す先がすべて存在する（開けない .pptx の第一原因）
let dangling = [];
for (const name of names.filter(n => n.endsWith('.rels'))) {
  const base = name.replace(/_rels\/[^/]*\.rels$/, '');   // `_rels/.rels` has no stem
  for (const [, target] of text(name).matchAll(/Target="([^"]+)"/g)) {
    if (/^https?:/.test(target)) continue;
    const parts = (base + target).split('/');
    const resolved = [];
    for (const part of parts) {
      if (part === '..') resolved.pop();
      else if (part !== '.' && part !== '') resolved.push(part);
    }
    if (!names.includes(resolved.join('/'))) dangling.push(`${name} → ${target}`);
  }
}
check('関係の指す先がすべてある', dangling.length === 0, dangling.join(' / '));

// 内容の型が、入っている部品をすべて説明している
const types = text('[Content_Types].xml');
const undeclared = names.filter(name =>
  name.endsWith('.xml') && !name.endsWith('.rels') && !types.includes(`/${name}`)
  && name !== '[Content_Types].xml');
check('部品がすべて型宣言されている', undeclared.length === 0, undeclared.join(' '));

// 16:9
check('16:9 で出ている', text('ppt/presentation.xml').includes('cx="12192000" cy="6858000"'));

const whole = slides.map(text).join('\n');
const presets = [...whole.matchAll(/prstGeom prst="(\w+)"/g)].map(m => m[1]);
check('図形がプリセットとして出ている', presets.length > 10, `${presets.length} 個`);
for (const preset of ['can', 'diamond', 'roundRect', 'foldedCorner']) {
  check(`${preset} が使われている`, presets.includes(preset));
}
check('接続がコネクタとして出ている', whole.includes('straightConnector1'));
check('折れた線は自由形として出ている', whole.includes('custGeom'));
check('矢印が付いている', whole.includes('tailEnd'));
check('破線が保たれている', whole.includes('prstDash'));
// 単独の線も、図形ではなくコネクタとして出る——受け取った人が端を掴める。
// 構成図の「組織の境界」は破線で、矢印を持たない 1 本である。
const connectors = [...whole.matchAll(/<p:cxnSp>[\s\S]*?<\/p:cxnSp>/g)].map(m => m[0]);
const standalone = connectors.filter(one =>
  one.includes('prstDash') && !one.includes('tailEnd') && !one.includes('headEnd'));
check('単独の線もコネクタとして出ている', standalone.length === 1,
  `コネクタ ${connectors.length} 本のうち ${standalone.length} 本`);
const widthOf = one => Number(/<a:ln w="(\d+)"/.exec(one)?.[1] ?? 0);
check('線の太さが運ばれている',
  widthOf(standalone[0] ?? '') > widthOf(connectors.find(one => !standalone.includes(one)) ?? ''),
  `${widthOf(standalone[0] ?? '')} / 既定 ${widthOf(connectors.find(one => !standalone.includes(one)) ?? '')}`);

check('表がネイティブの表として出ている', whole.includes('<a:tbl>'));
check('部分参照の行だけが入っている',
  whole.includes('アクセストークン') && !whole.includes('DMZ は外部公開セグメント'),
  '');
check('図がラスタとして貼られていない', !whole.includes('<p:pic>'));
check('本文が文字として入っている', whole.includes('システム構成を'));
check('参照が番号に解決されている', whole.includes('図 1'));
check('柱に文書番号と枚数がある', /SD-AUTH-000.{0,12}\d+ \/ \d+/.test(whole.replace(/<[^>]+>/g, '')));

// テーマはフォントを名乗る（テーマの二重化はしないが、名前は運ぶ）
check('テーマがフォントを持っている', text('ppt/theme/theme1.xml').includes('Noto Sans CJK JP'));

const size = (bytes.length / 1024).toFixed(0);
console.log(`書庫 ${size} KB / 部品 ${names.length} 個 / スライド ${slides.length} 枚`);
