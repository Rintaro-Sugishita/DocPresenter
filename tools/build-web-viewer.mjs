// Builds the web viewer for GitHub Pages: out/web/ holds the page, its script
// and the font subsetter, and nothing else. No server is involved: the page
// reads public repositories from GitHub itself (design/web-viewer.md).
//
//   npx tsc --build && node tools/build-web-viewer.mjs
//
// The page is published as view.html, the address design/web-viewer.md gives
// out for sharing, and again as index.html so the site's root opens it too.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { rolldown } from 'rolldown';

const OUT = 'out/web';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The entry point. The language is picked the way every web shell picks it
// (tools/web-shell/locale.mjs).
const entry = `
import { startViewer } from '@docpresenter/app-web/viewer';
import { askLocale, languageSelect, startingLocale } from '../tools/web-shell/locale.mjs';

startViewer({
  window,
  fetch: (url, init) => fetch(url, init),
  shippedTheme: ${JSON.stringify(readFileSync('themes/default/theme.css', 'utf8'))},
  subsetterUrl: new URL('harfbuzz-subset.wasm', document.baseURI).toString(),
  locale: { start: startingLocale(), ask: askLocale, select: languageSelect },
});
`;
mkdirSync('out', { recursive: true });
writeFileSync('out/web-viewer-entry.js', entry);

// As ES modules, so the code a document may not need is split off: Mermaid is
// loaded only for a document that draws with it, and the PDF writer only when
// "Download PDF" is pressed (packages/app-web/src/viewer.ts).
const bundle = await rolldown({ input: 'out/web-viewer-entry.js', platform: 'browser' });
await bundle.write({
  dir: OUT, format: 'es', minify: true,
  entryFileNames: 'viewer.js', chunkFileNames: 'chunks/[name]-[hash].js',
});
// A dependency holds U+FFFD as a literal character; written as an escape it
// means the same and is not taken for broken text on the way (as in
// tools/build-editor-demo.mjs).
const scripts = ['viewer.js', ...readdirSync(`${OUT}/chunks`).map(name => `chunks/${name}`)];
for (const file of scripts) {
  writeFileSync(`${OUT}/${file}`, readFileSync(`${OUT}/${file}`, 'utf8').split('\uFFFD').join('\\uFFFD'));
}

copyFileSync(createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'), `${OUT}/harfbuzz-subset.wasm`);

const page = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DocPresenter</title>
<style>
  /* The chrome around the document. The document's own theme is loaded before
     this sheet and styles body; the page takes body back and gives the theme's
     column to the document instead. */
  body.dpw { max-width: none; margin: 0; padding: 0; background: #fff; }
  .dpw-bar, .dpw-status, .dpw-notes, .dpw-form, .dpw-folder {
    font: 13px/1.6 system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif;
    color: #1c1f24;
  }
  .dpw-bar {
    position: sticky; top: 0; z-index: 20; display: flex; flex-wrap: wrap; align-items: center;
    gap: 6px 14px; padding: 8px 16px; background: #fbfbfc; border-bottom: 1px solid #c8ccd2;
  }
  .dpw-bar a { color: #1f5fa8; text-decoration: none; }
  .dpw-bar a:hover { text-decoration: underline; }
  .dpw-brand { font-weight: 700; color: #1c1f24 !important; }
  .dpw-crumb { overflow-wrap: anywhere; }
  .dpw-commit { font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #5a6270;
    background: #eef0f3; padding: 1px 6px; border-radius: 4px; }
  .dpw-spacer { flex: 1; }
  .dpw-bar button, .dpw-form button {
    font: inherit; padding: 3px 12px; cursor: pointer; border: 1px solid #c8ccd2;
    border-radius: 4px; background: #fff; color: #1c1f24;
  }
  .dpw-bar button:disabled { color: #9aa0a8; cursor: progress; }
  .dpw-language select { font: inherit; margin-left: 6px; }
  .dpw-status { padding: 8px 16px; color: #1f5fa8; border-bottom: 1px solid #e2e4e8; }
  .dpw-status[data-kind="busy"] { color: #5a6270; }
  .dpw-status[data-kind="refused"] { color: #b3261e; background: #fdf3f2; }
  .dpw-notes details { padding: 8px 16px; background: #fffaf0; border-bottom: 1px solid #ecdcb5; }
  .dpw-notes summary { cursor: pointer; color: #7a5300; }
  .dpw-notes ul { margin: 6px 0 0; padding-left: 1.4em; max-height: 12em; overflow: auto; }
  #dpw-doc, .dpw-doc { max-width: 48em; margin: 2em auto 4em; padding: 0 16px; }
  .dpw-form h1, .dpw-folder h1 { font-size: 20px; margin: 0 0 .6em; }
  .dpw-folder h2 { font-size: 15px; margin: 1.4em 0 .4em; }
  .dpw-folder ul { padding-left: 1.2em; }
  .dpw-folder a { color: #1f5fa8; }
  .dpw-form label { display: block; font-weight: 600; margin-top: 1.2em; }
  .dpw-row { display: flex; gap: 8px; margin-top: 6px; }
  .dpw-row input { flex: 1; min-width: 0; font: inherit; padding: 6px 8px; border: 1px solid #c8ccd2; border-radius: 4px; }
  .dpw-row button { background: #1f5fa8; color: #fff; border-color: #1f5fa8; padding: 6px 16px; }
  .dpw-hint { color: #5a6270; font-size: 12px; overflow-wrap: anywhere; }
  .dpw-form a { color: #1f5fa8; }
  .dpw-local { margin-top: 2.5em; padding-top: 1.5em; border-top: 1px solid #e2e4e8; }
  .dpw-local h2 { font-size: 16px; margin: 0 0 .4em; }
  .dpw-drop { flex: 1; min-width: 0; border: 2px dashed #c8ccd2; border-radius: 6px; padding: 6px 10px;
    display: flex; align-items: center; justify-content: center; text-align: center; color: #5a6270; }
  body.dpw-dragging::after { content: ''; position: fixed; inset: 0; z-index: 50; pointer-events: none;
    border: 4px dashed #1f5fa8; background: rgba(31, 95, 168, .06); }
  .dpw-doc > button.dpw-primary { font: 13px system-ui, sans-serif; margin-bottom: 1.5em; padding: 6px 16px; cursor: pointer;
    background: #1f5fa8; color: #fff; border: 1px solid #1f5fa8; border-radius: 4px; }
  .dpw-form button[type=button] { margin-top: 12px; }
  @media print { .dpw-bar, .dpw-status, .dpw-notes { display: none; } }
</style>
</head><body>
<script type="module" src="viewer.js"></script>
</body></html>
`;
writeFileSync(`${OUT}/view.html`, page);
writeFileSync(`${OUT}/index.html`, page);
// Keep Pages from running Jekyll over the output.
writeFileSync(`${OUT}/.nojekyll`, '');

const size = file => `${(readFileSync(`${OUT}/${file}`).length / 1024).toFixed(0)} KB`;
// What a page loads before anything is asked of it: viewer.js and what it imports itself.
const upFront = ['viewer.js', ...[...readFileSync(`${OUT}/viewer.js`, 'utf8').matchAll(/from\s*"\.\/(chunks\/[^"]+)"/g)].map(m => m[1])];
const bytes = files => files.reduce((sum, file) => sum + statSync(`${OUT}/${file}`).size, 0);
const kb = n => `${(n / 1024).toFixed(0)} KB`;
console.log(`${OUT}/ を生成: view.html / index.html ＋ 最初に読む ${upFront.length} 本（${kb(bytes(upFront))}）`
  + ` ＋ 必要なときに読む ${scripts.length - upFront.length} 本（${kb(bytes(scripts.filter(file => !upFront.includes(file))))}：Mermaid・PDF）`
  + ` ＋ harfbuzz-subset.wasm（${size('harfbuzz-subset.wasm')}）`);
