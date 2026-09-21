// Paged.js computes one page size per run, so mixed orientation is done by
// laying out each orientation in its own pass and assembling the PDF
// ourselves — which we can do because we write the PDF, not the browser.
import { chromium } from 'playwright-core';

const ROWS = Array.from({ length: 40 }, (_, i) => i + 1).map(i =>
  `<tr><td>入力</td><td>${i}</td><td>項目${i}</td><td>field_${i}</td><td>varchar(64)</td><td>○</td>
   <td>—</td><td>64</td><td>半角英数字のみ</td><td>備考テキスト${i}</td><td>ログイン画面</td><td>2026-09-21</td></tr>`).join('');

const CSS = orient => `
  @page { size: A4 ${orient}; margin: ${orient === 'landscape' ? '15mm' : '20mm'}; }
  body { font-family: "Noto Sans CJK JP", sans-serif; font-size: 10pt; line-height: 1.8; }
  h2 { break-before: page; }
  table { border-collapse: collapse; width: 100%; font-size: 9pt; }
  th, td { border: 1px solid #666; padding: 3px 6px; }
  thead th { background: #eee; }`;

const PORTRAIT = `<h2>1 概要</h2><p>本書は認証機能の設計を示す。</p>
  <h2>2 画面項目</h2><p>項目定義を次に示す。</p>`;
const LANDSCAPE = `<figure><table><thead><tr>
  <th>分類</th><th>No</th><th>項目名</th><th>物理名</th><th>型</th><th>必須</th>
  <th>初期値</th><th>桁数</th><th>入力規則</th><th>備考</th><th>関連画面</th><th>更新日</th>
  </tr></thead><tbody>${ROWS}</tbody></table><figcaption>表 1 ログイン画面 項目定義</figcaption></figure>`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

async function layout(orient, body, label) {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${CSS(orient)}</style></head><body>${body}</body></html>`);
  await page.addScriptTag({ path: 'node_modules/pagedjs/dist/paged.polyfill.js' });
  await page.waitForFunction(() => document.querySelector('.pagedjs_page'), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  const boxes = await page.evaluate(() => [...document.querySelectorAll('.pagedjs_page')].map(el => {
    const r = el.getBoundingClientRect();
    const head = el.querySelector('thead');
    return { w: Math.round(r.width), h: Math.round(r.height), hasHeaderRow: !!head };
  }));
  await page.screenshot({ path: `split-${orient}.png`, fullPage: true });
  await page.close();
  boxes.forEach((b, i) => console.log(
    `  ${label} p${i + 1}: ${b.w}x${b.h} ${b.w > b.h ? '横' : '縦'}  ヘッダ行:${b.hasHeaderRow ? 'あり' : 'なし'}`));
  return boxes;
}

console.log('=== 縦向きの組版 ===');
const a = await layout('portrait', PORTRAIT, '縦');
console.log('=== 横向きの組版（表だけ別パス） ===');
const b = await layout('landscape', LANDSCAPE, '横');
console.log(`\n合計 ${a.length + b.length} ページ（縦 ${a.length} ＋ 横 ${b.length}）を順に綴じれば混在 PDF になる`);
await browser.close();
