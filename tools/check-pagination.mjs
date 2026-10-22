// A table that does not fit on one page.
//
// This is the case every design document eventually has and no Markdown
// toolchain handles: thirty rows, a merged first column, and a page break
// somewhere in the middle of it. What has to survive the break is every row
// exactly once, the header above the continuation, and some statement of what
// the merged cell that carries on was called. A table that silently drops a row
// at a page boundary is worse than one that does not paginate at all.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

/** The codes in the sample's long table, which is the thing being paginated. */
const CODES = readFileSync('sample/docs/auth-design/error-codes.table', 'utf8')
  .split('\n').map(line => /\|\s*(E\d{4})\s*\|/.exec(line)?.[1]).filter(Boolean);

async function pagesOf(path) {
  const pdf = await getDocument({
    data: new Uint8Array(readFileSync(path)), useSystemFonts: false,
  }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const [, , width, height] = page.view;
    pages.push({
      width, height,
      text: (await page.getTextContent()).items.map(item => item.str).join(''),
    });
  }
  return pages;
}

// --- 横向きの指定があるとき -------------------------------------------------
execFileSync('node', ['tools/build.mjs', '--in', 'sample'], { encoding: 'utf8' });
const pages = await pagesOf('out/build/docs/auth-design.pdf');

check('表の行が 30 行ある標本である', CODES.length === 30, `${CODES.length} 行`);

const holding = pages.filter(page => CODES.some(code => page.text.includes(code)));
check('表が複数ページにまたがる', holding.length >= 2, `${holding.length} ページ`);

const missing = CODES.filter(code => !pages.some(page => page.text.includes(code)));
check('どの行も落ちていない', missing.length === 0, missing.join(' '));

const twice = CODES.filter(code =>
  pages.filter(page => page.text.includes(code)).length > 1);
check('どの行も重複していない', twice.length === 0, twice.join(' '));

check('続きのページにも見出し行が出る',
  holding.every(page => page.text.includes('発生条件') && page.text.includes('表示位置')),
  holding.map(page => page.text.slice(0, 12)).join(' / '));

check('ページをまたいだ結合セルは続きだと言う',
  holding.slice(1).some(page => page.text.includes('（続き）')),
  holding.slice(1).map(page => /\S+（続き）/.exec(page.text)?.[0] ?? '—').join(' / '));

// 横向きの指定は、そのページだけに効く
const landscape = pages.filter(page => page.width > page.height);
const portrait = pages.filter(page => page.width <= page.height);
check('指定した表のページだけが横向き', landscape.length === holding.length,
  `横 ${landscape.length} / 縦 ${portrait.length}`);
check('横向きのページは表のページである',
  landscape.every(page => CODES.some(code => page.text.includes(code))));
check('横向きの紙は縦向きの紙を回したもの',
  landscape.every(page => Math.abs(page.width - portrait[0].height) < 1
    && Math.abs(page.height - portrait[0].width) < 1),
  landscape.length ? `${Math.round(landscape[0].width)}x${Math.round(landscape[0].height)}` : '');
check('横向きのページにも柱が出る',
  landscape.every(page => /SD-AUTH-001.*\d+ \/ \d+/.test(page.text)));
check('本文は縦向きのまま', portrait.some(page => page.text.includes('本書は、会員向け')));

// --- 横向きの指定が無いとき（縦のまま分割される）----------------------------
const COPY = 'out/pagination-portrait';
rmSync(COPY, { recursive: true, force: true });
cpSync('sample', COPY, { recursive: true });
const document_ = `${COPY}/docs/auth-design.md`;
writeFileSync(document_, readFileSync(document_, 'utf8')
  .replace(' page="landscape"', '')
  .replace('output: [html, pdf]', 'output: [pdf]'));
execFileSync('node', ['tools/build.mjs', '--in', COPY, '--out', 'out/pagination-out'],
  { encoding: 'utf8' });
const plain = await pagesOf('out/pagination-out/auth-design.pdf');

check('縦向きのままでも表は分割される',
  plain.filter(page => CODES.some(code => page.text.includes(code))).length >= 2,
  `${plain.filter(page => CODES.some(code => page.text.includes(code))).length} ページ`);
check('縦向きのままなら横向きのページは出ない',
  plain.every(page => page.width <= page.height));
const lostInPortrait = CODES.filter(code => !plain.some(page => page.text.includes(code)));
check('縦向きでも行は落ちない', lostInPortrait.length === 0, lostInPortrait.join(' '));
check('縦向きでも見出し行は繰り返す',
  plain.filter(page => CODES.some(code => page.text.includes(code)))
    .every(page => page.text.includes('発生条件')));
