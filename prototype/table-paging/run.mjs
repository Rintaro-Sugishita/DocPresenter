// Measures the table in a real page box, splits it with split.mjs, then lays
// the result out with Paged.js and checks every page.
import { chromium } from 'playwright-core';
import { splitTable } from './split.mjs';
import { writeFileSync } from 'node:fs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const COLS = ['分類','No','項目名','物理名','型','必須','初期値','桁数','入力規則','備考','関連画面','更新日'];
const GROUPS = ['入力','操作','表示','検証','連携','出力','監査','通知','権限'];

// 分類 is a merged cell spanning 7 rows, so groups straddle page boundaries.
const rows = [];
let no = 0;
GROUPS.forEach(g => {
  for (let i = 0; i < 7; i++) {
    no++;
    const cells = [];
    if (i === 0) cells.push({ col: 0, text: g, rowspan: 7 });
    cells.push(
      { col: 1, text: String(no) }, { col: 2, text: `項目${no}` }, { col: 3, text: `field_${no}` },
      { col: 4, text: 'varchar(64)' }, { col: 5, text: '○' }, { col: 6, text: '—' },
      { col: 7, text: '64' }, { col: 8, text: '半角英数字のみ' }, { col: 9, text: `備考テキスト${no}` },
      { col: 10, text: 'ログイン画面' }, { col: 11, text: '2026-09-21' });
    rows.push(cells);
  }
});

const CSS = `
  @page { size: A4 landscape; margin: 15mm; }
  body { font-family: "Noto Sans CJK JP", sans-serif; font-size: 9pt; margin: 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #666; padding: 3px 6px; }
  thead th { background: #eee; }
  .chunk + .chunk { break-before: page; }
  .cont { color: #555; }`;

const tableHtml = body => `<table><thead><tr>${COLS.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
const rowHtml = cells => `<tr>${cells.map(c =>
  `<td${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}${c.continued ? ' class="cont"' : ''}>${c.text}${c.continued ? '<br><small>（続き）</small>' : ''}</td>`).join('')}</tr>`;

const browser = await chromium.launch({ executablePath: CHROME });

// --- 1. Measure in a real landscape content area -----------------------------
const m = await browser.newPage();
await m.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${CSS}
  #probe { width: calc(297mm - 30mm); }</style></head>
  <body><div id="probe">${tableHtml(rows.map(rowHtml).join(''))}</div></body></html>`);
const measured = await m.evaluate(() => {
  const t = document.querySelector('table');
  return {
    headerHeight: t.tHead.getBoundingClientRect().height,
    rowHeights: [...t.tBodies[0].rows].map(r => r.getBoundingClientRect().height),
  };
});
// A4 landscape content height = 210mm - 30mm margins, at 96dpi
const PAGE_H = (210 - 30) / 25.4 * 96;
console.log(`計測: ヘッダ ${measured.headerHeight.toFixed(1)}px / 行 ${measured.rowHeights.length} 本 / ページ内高 ${PAGE_H.toFixed(1)}px`);
await m.close();

// --- 2. Split, then measure the real result and converge ----------------------
// A continued cell carries a "（続き）" marker, so its row is taller than the
// row measured in step 1. Rather than predict that, re-measure what was
// actually produced and shrink any chunk that overflows, until nothing does.
const probe = await browser.newPage();
const chunksHtml = pages => pages.map(p => `<div class="chunk">${tableHtml(p.map(rowHtml).join(''))}</div>`).join('\n');

async function measureChunks(pages) {
  await probe.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${CSS}
    .chunk { width: calc(297mm - 30mm); } .chunk + .chunk { break-before: auto; }</style></head>
    <body>${chunksHtml(pages)}</body></html>`);
  return probe.evaluate(() => [...document.querySelectorAll('.chunk table')].map(t => t.getBoundingClientRect().height));
}

let budget = [...measured.rowHeights];
let pages = splitTable(rows, budget, measured.headerHeight, PAGE_H, PAGE_H);
let heights = await measureChunks(pages);
let round = 0;
while (round < 8) {
  const over = heights.findIndex(h => h > PAGE_H);
  if (over === -1) break;
  round++;
  // Inflate the estimate for the rows in the overflowing chunk so the next
  // split places fewer of them on that page.
  const scale = PAGE_H / heights[over];
  pages[over].forEach((_, k) => {
    const globalRow = pages.slice(0, over).reduce((a, p) => a + p.length, 0) + k;
    budget[globalRow] = budget[globalRow] / scale;
  });
  pages = splitTable(rows, budget, measured.headerHeight, PAGE_H, PAGE_H);
  heights = await measureChunks(pages);
}
await probe.close();
console.log(`分割: ${pages.length} ページ（行数 ${pages.map(p => p.length).join(' + ')} = ${pages.reduce((a, p) => a + p.length, 0)}）／収束まで ${round} 回`);
console.log(`各チャンクの実高: ${heights.map(h => h.toFixed(0)).join(', ')}  （上限 ${PAGE_H.toFixed(0)}）`);

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${CSS}</style></head><body>
${chunksHtml(pages)}
</body></html>`;
writeFileSync('split.html', html);

// --- 3. Lay out and verify ---------------------------------------------------
const p = await browser.newPage();
await p.setContent(html);
await p.addScriptTag({ path: 'node_modules/pagedjs/dist/paged.polyfill.js' });
await p.waitForFunction(() => document.querySelector('.pagedjs_page'), null, { timeout: 60000 });
await p.waitForTimeout(1500);

const report = await p.evaluate(() => [...document.querySelectorAll('.pagedjs_page')].map((el, i) => {
  const area = el.querySelector('.pagedjs_page_content');
  const tbl = el.querySelector('table');
  const ar = area.getBoundingClientRect(), tr = tbl?.getBoundingClientRect();
  return {
    page: i + 1,
    header: !!el.querySelector('thead'),
    rows: el.querySelectorAll('tbody tr').length,
    firstCell: el.querySelector('tbody td')?.textContent.trim().slice(0, 8) ?? '',
    cont: !!el.querySelector('.cont'),
    overflow: tr ? +(tr.bottom - ar.bottom).toFixed(1) : 0,
  };
}));
console.table(report);
const bad = report.filter(r => !r.header || r.overflow > 1);
console.log(bad.length ? `NG: ${bad.length} ページに問題` : 'OK: 全ページにヘッダ行があり、はみ出しなし');
console.log(`行数の合計: ${report.reduce((a, r) => a + r.rows, 0)}（元 ${rows.length}）`);
await p.screenshot({ path: 'split.png', fullPage: true });
await browser.close();
