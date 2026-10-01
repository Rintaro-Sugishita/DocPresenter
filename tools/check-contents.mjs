// The table of contents, the bookmarks and the links — read back out of the PDF.
//
// A contents list is only worth having if its numbers are true, and a number
// that is true at build time is the one thing this feature can get wrong: the
// contents is part of what is being paginated, so writing it changes it. So the
// test is not "a contents page exists" but "every line points at the page the
// section is actually on", checked against the text of those pages.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

execFileSync('node', ['tools/build.mjs', '--in', 'sample'], { encoding: 'utf8' });
const pdf = await getDocument({
  data: new Uint8Array(readFileSync('out/build/auth-design.pdf')), useSystemFonts: false,
}).promise;

const texts = [];
for (let i = 1; i <= pdf.numPages; i++) {
  const content = await (await pdf.getPage(i)).getTextContent();
  texts.push(content.items.map(item => item.str + (item.hasEOL ? '\n' : '')).join(''));
}

// 柱が各ページを何と呼んでいるか。前付けは i、本文は 1 から数え直すので、
// 「3 ページ」が何枚目かは数えるのではなく読み取る。
const printed = texts.map(text => (/版 [\d.]+\s+(\S+)(?: \/ \d+)?\s*$/m.exec(text) ?? [])[1]);

const at = async destination => {
  const resolved = Array.isArray(destination)
    ? destination : await pdf.getDestination(destination);
  return (await pdf.getPageIndex(resolved[0])) + 1;
};

/**
 * 一覧の各行を、PDF から読み直す。行の文字とリンクの枠を縦位置で突き合わせ、
 * 「行に印刷されている番号」と「その行を押すと開くページの番号」を取り出す。
 * 一覧が正しいとは、この 2 つが一致することである。
 */
const linesOf = async (sheet, first, last) => {
  const page = await pdf.getPage(sheet);
  const items = (await page.getTextContent()).items
    .filter(item => item.str.trim() !== '')
    .map(item => ({ text: item.str, y: item.transform[5] }));
  const found = [];
  for (const annotation of await page.getAnnotations()) {
    if (annotation.subtype !== 'Link') continue;
    const [, bottom, , top] = annotation.rect;
    const text = items.filter(item => item.y >= bottom - 1 && item.y <= top + 1)
      .map(item => item.text).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const said = /(\S+)$/.exec(text)?.[1];
    found.push({ text, said, opens: printed[(await at(annotation.dest)) - 1] });
  }
  return found.filter(line => first.test(line.text) === true && last !== false);
};

// --- 目次 -------------------------------------------------------------------
const contents = texts[0] ?? '';
check('前付けに目次が出る', contents.includes('目次'));
const all = await linesOf(1, /./, true);
const lines = all.filter(line => /^[\d.]+ /.test(line.text));
check('見出しの数だけ行がある', lines.length >= 10, `${lines.length} 行`);
check('節と項の両方が載る', lines.some(line => /^\d+\.\d+ /.test(line.text)),
  lines.map(line => /^[\d.]+/.exec(line.text)[0]).join(' '));

const wrong = lines.filter(line => line.said !== line.opens);
check('どの行も、押すと開くページを印刷している', wrong.length === 0,
  wrong.map(line => `${line.text}→${line.opens}`).join(' / ') || `${lines.length} 行を照合`);

// --- 図表一覧 ---------------------------------------------------------------
check('前付けに図表一覧が出る', contents.includes('図表一覧'));
const drawings = all.filter(line => /^(図|表) \d+ /.test(line.text));
check('図も表も載る',
  drawings.some(line => line.text.startsWith('図')) && drawings.some(line => line.text.startsWith('表')),
  drawings.map(line => /^(図|表) \d+/.exec(line.text)[0]).join(' '));
check('図が先、表が後',
  drawings.findLast(line => line.text.startsWith('図'))
    && drawings.findIndex(line => line.text.startsWith('表'))
      > drawings.findLastIndex(line => line.text.startsWith('図')),
  drawings.map(line => line.text[0]).join(''));
const offFigures = drawings.filter(line => line.said !== line.opens);
check('図表一覧もページを言い当てている', offFigures.length === 0,
  offFigures.map(line => `${line.text}→${line.opens}`).join(' / ') || `${drawings.length} 行を照合`);

// --- しおり -----------------------------------------------------------------
const outline = await pdf.getOutline();
check('しおりが付いている', Array.isArray(outline) && outline.length > 0,
  `${outline?.length ?? 0} 件（第一階層）`);
const nested = (outline ?? []).filter(item => (item.items ?? []).length > 0);
check('項は節の下に入る', nested.length > 0,
  nested.map(item => `${item.title}(${item.items.length})`).join(' '));

const flat = [];
const walk = items => items.forEach(item => { flat.push(item); walk(item.items ?? []); });
walk(outline ?? []);
const targets = await Promise.all(flat.map(item => at(item.dest)));
check('しおりはどれも行き先を持っている', targets.every(page => page >= 1),
  `${flat.length} 件`);
// 目次が言うページと、しおりが開くページは同じものでなければならない
const byTitle = new Map(flat.map((item, i) => [item.title.replace(/\s+/g, ' '), printed[targets[i] - 1]]));
const paired = lines.map(line => ({ line, page: byTitle.get(line.text.replace(/\s+\S+$/, '')) }))
  .filter(one => one.page !== undefined);
const disagree = paired.filter(one => one.page !== one.line.said);
check('しおりと目次が同じページを指す',
  disagree.length === 0 && paired.length === lines.length,
  disagree.map(one => one.line.text).join(' / ') || `${paired.length}/${lines.length} 行を照合`);

// --- リンク -----------------------------------------------------------------
let links = 0;
let broken = 0;
for (let i = 1; i <= pdf.numPages; i++) {
  for (const annotation of await (await pdf.getPage(i)).getAnnotations()) {
    if (annotation.subtype !== 'Link') continue;
    links++;
    try { await at(annotation.dest); } catch { broken++; }
  }
}
const listed = lines.length + drawings.length;
check('一覧のどの行からも飛べる', links >= listed, `${links} 個`);
check('本文の相互参照も飛べる', links > listed,
  `前付け ${listed}（目次 ${lines.length} ＋ 図表 ${drawings.length}）＋ 本文 ${links - listed}`);
check('行き先の無いリンクが無い', broken === 0, `${broken} 個`);

// --- 目次が無い文書 ---------------------------------------------------------
// 節が数えるほど無い文書に目次を付けても、目次のほうが長い。
// テーマの CSS は毎回埋め込まれるので、探すのは組み立てられた印であって
// スタイルの名前ではない。
const overview = readFileSync('out/build/auth-overview.html', 'utf8');
check('節の少ない文書には目次を出さない', !overview.includes('class="dp-index dp-index-contents"'),
  `${(overview.match(/class="dp-index-line"/g) ?? []).length} 行`);
