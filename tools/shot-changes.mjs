// The picture of an export with the changes marked, in Japanese and English:
//   node tools/shot-changes.mjs
// → packages/app-vscode/images/<ja|en>/6-changes.png
//
// The sample is compared with a copy of itself as it might have been at v1.1:
// one sentence, one table cell and one shape label different, and one shape
// only moved (which must not be marked). The marks land far apart in the
// document, so the three places are cut out and set side by side with the
// legend, each under a word saying what it is.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { findChromium } from './pdf-writer.mjs';

const WORK = 'out/shot-changes';
// The legend names the version by the folder's name as given, so the copy is
// put at the top for the build and taken away again.
const BEFORE = 'v1.1';
if (existsSync(BEFORE)) throw new Error(`${BEFORE} がもうある。消してからやり直す`);
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const edit = (path, from, to) => {
  const full = `${BEFORE}/${path}`;
  const source = readFileSync(full, 'utf8');
  if (!source.includes(from)) throw new Error(`標本が変わっている: ${path} に「${from}」が無い`);
  writeFileSync(full, source.replace(from, to));
};

cpSync('sample', BEFORE, { recursive: true });
try {
  edit('docs/auth-design.md',
    '認証失敗が 5 回に達した時点でアカウントをロックする。', '認証失敗が 3 回に達した時点でアカウントをロックする。');
  edit('shared/system-architecture.dgm', 'cache   [(セッションキャッシュ)]', 'cache   [(セッション置き場)]');
  edit('docs/auth-design/screen-items.table', '| 入力 |  # | idBox   | ログイン ID', '| 入力 |  # | idBox   | ログイン名');
  edit('shared/system-architecture.dgm', '  api     @ (460, 120) 140x60', '  api     @ (480, 140) 140x60');
  for (const lang of ['ja', 'en']) {
    execFileSync('node', ['tools/build.mjs', '--in', 'sample', '--diff-from', BEFORE,
      '--out', `${WORK}/${lang}`, '--lang', lang], { stdio: 'ignore' });
  }
} finally {
  rmSync(BEFORE, { recursive: true, force: true });
}

const WORDS = {
  ja: { prose: '本文 — 変わった段落', table: '表 — 変わったセルだけ', figure: '図 — ラベルが変わった図形だけ（動かしただけの図形には付かない）', legend: '凡例' },
  en: { prose: 'Text — the paragraph that changed', table: 'Tables — only the cell that changed', figure: 'Diagrams — only the shape whose label changed (one only moved is not marked)', legend: 'Legend' },
};

const browser = await chromium.launch({ executablePath: findChromium() });
for (const lang of ['ja', 'en']) {
  const page = await browser.newPage({ viewport: { width: 1006, height: 860 }, deviceScaleFactor: 1.5 });
  page.on('pageerror', e => console.log('エラー:', e.message));
  await page.goto(pathToFileURL(`${WORK}/${lang}/docs/auth-design.html`).href);
  await page.waitForTimeout(800);

  /** A piece of the page around what the selector finds, as a data URL. */
  const cut = async (selector, around) => {
    const box = await page.$eval(selector, (node, around) => {
      // `from` / `until` widen the piece to an ancestor's top or a later row's bottom.
      const top = (around.from ? node.closest(around.from) : node).getBoundingClientRect().top;
      const last = around.until ? node.closest('table').querySelector(around.until) : node;
      return { top: top + scrollY, bottom: last.getBoundingClientRect().bottom + scrollY, ...around };
    }, around);
    const clip = { x: 150, y: box.top - box.above, width: 706, height: box.bottom - box.top + box.above + box.below };
    const bytes = await page.screenshot({ clip, fullPage: true });
    return `data:image/png;base64,${bytes.toString('base64')}`;
  };
  const words = WORDS[lang];
  const pieces = [
    [words.prose, await cut('.dp-prose.dp-diff-changed', { above: 14, below: 14 })],
    [words.table, await cut('td.dp-diff-changed', { from: 'table', until: 'tbody tr:nth-child(2)', above: 12, below: 1 })],
    [words.figure, await cut('.dp-figure:has(.dp-node.dp-diff-changed) svg', { above: 10, below: 10 })],
    [words.legend, await cut('.dp-diff-legend', { above: 12, below: 12 })],
  ];
  await page.close();

  const sheet = await browser.newPage({ viewport: { width: 760, height: 400 }, deviceScaleFactor: 1 });
  await sheet.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 20px 24px; background: #eef1f5; font: 14px "Yu Gothic UI", "Segoe UI", sans-serif; color: #2b3138; }
    figure { margin: 0 0 18px; }
    figcaption { font-weight: 600; margin: 0 0 6px; }
    img { display: block; width: 706px; border: 1px solid #c9d0d9; border-radius: 4px; background: #fff; }
  </style></head><body>${pieces.map(([caption, src]) =>
    `<figure><figcaption>${caption}</figcaption><img src="${src}"></figure>`).join('')}</body></html>`);
  await sheet.waitForTimeout(300);
  // The pieces were taken at 1.5×; shown at 1×, so the sheet is shot at 1.5× too.
  const shot = await browser.newPage({ viewport: { width: 760, height: 400 }, deviceScaleFactor: 1.5 });
  await shot.setContent(await sheet.content());
  await shot.waitForTimeout(300);
  await shot.screenshot({ path: `packages/app-vscode/images/${lang}/6-changes.png`, fullPage: true });
  await sheet.close();
  await shot.close();
  console.log(lang, 'ok');
}
await browser.close();
