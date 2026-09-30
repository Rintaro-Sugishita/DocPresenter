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

// --- 目次のページ番号 -------------------------------------------------------
const contents = texts[0] ?? '';
check('前付けに目次が出る', contents.includes('目次'));
const lines = [...contents.matchAll(/([\d.]+)\s+(\S[^\n]*?)\s+(\d+)\s*$/gm)]
  .map(([, number, title, page]) => ({ number, title: title.trim(), page: Number(page) }));
check('見出しの数だけ行がある', lines.length >= 10, `${lines.length} 行`);
check('節と項の両方が載る', lines.some(line => line.number.includes('.')),
  lines.map(line => line.number).join(' '));

// 本文のページ番号は前付けを除いて数え直すので、n ページ目は texts[n]
const wrong = lines.filter(line => !(texts[line.page] ?? '').includes(`${line.number} ${line.title}`));
check('どの行も実際のページを指している',
  wrong.length === 0,
  wrong.map(line => `${line.number} ${line.title}→${line.page}`).join(' / ') || `${lines.length} 行を照合`);

// --- しおり -----------------------------------------------------------------
const outline = await pdf.getOutline();
check('しおりが付いている', Array.isArray(outline) && outline.length > 0,
  `${outline?.length ?? 0} 件（第一階層）`);
const nested = (outline ?? []).filter(item => (item.items ?? []).length > 0);
check('項は節の下に入る', nested.length > 0,
  nested.map(item => `${item.title}(${item.items.length})`).join(' '));

const at = async destination => {
  const resolved = Array.isArray(destination)
    ? destination : await pdf.getDestination(destination);
  return (await pdf.getPageIndex(resolved[0])) + 1;
};
const flat = [];
const walk = items => items.forEach(item => { flat.push(item); walk(item.items ?? []); });
walk(outline ?? []);
const targets = await Promise.all(flat.map(item => at(item.dest)));
check('しおりはどれも行き先を持っている', targets.every(page => page >= 1),
  `${flat.length} 件`);
// 目次が言うページと、しおりが開くページは同じものでなければならない
const byTitle = new Map(flat.map((item, i) => [item.title.replace(/\s+/g, ' '), targets[i]]));
const disagree = lines.filter(line => {
  const sheet = byTitle.get(`${line.number} ${line.title}`);
  return sheet !== undefined && sheet !== line.page + 1;   // 前付け 1 枚ぶんずれる
});
check('しおりと目次が同じページを指す', disagree.length === 0,
  disagree.map(line => line.number).join(' ') || `${byTitle.size} 件を照合`);

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
check('目次から飛べる', links >= lines.length, `${links} 個`);
check('本文の相互参照も飛べる', links > lines.length,
  `目次 ${lines.length} ＋ 参照 ${links - lines.length}`);
check('行き先の無いリンクが無い', broken === 0, `${broken} 個`);

// --- 目次が無い文書 ---------------------------------------------------------
// 節が数えるほど無い文書に目次を付けても、目次のほうが長い。
// テーマの CSS は毎回埋め込まれるので、探すのは組み立てられた印であって
// スタイルの名前ではない。
const overview = readFileSync('out/build/auth-overview.html', 'utf8');
check('節の少ない文書には目次を出さない', !overview.includes('class="dp-toc"'),
  `${(overview.match(/class="dp-toc-line"/g) ?? []).length} 行`);
