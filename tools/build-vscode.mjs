// Builds the VS Code extension into packages/app-vscode/media.
//
// Two bundles, because the extension is two programs. The host half runs in
// Node inside VS Code and must not carry the editor's screen; the WebView half
// runs in Chromium and must not carry anything of VS Code's. `vscode` itself is
// never bundled — the editor provides it at run time.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { rolldown } from 'rolldown';
import { mermaidScript } from './mermaid-script.mjs';

const OUT = 'packages/app-vscode/media';
mkdirSync(OUT, { recursive: true });

const host = await rolldown({
  input: 'packages/app-vscode/dist/extension.js',
  platform: 'node',
  external: ['vscode'],
});
await host.write({ file: `${OUT}/extension.cjs`, format: 'cjs' });

const view = await rolldown({
  input: 'packages/app-vscode/dist/webview/entry.js',
  platform: 'browser',
});
// Minified: the screen carries Mermaid, which is several megabytes as written.
await view.write({ file: `${OUT}/webview.js`, format: 'iife', minify: true, codeSplitting: false });

// The panel a batch export lays its pages out in. Only the answering half of
// the screen: Mermaid and the measuring, no editor.
const exporter = await rolldown({
  input: 'packages/app-vscode/dist/webview/exporter.js',
  platform: 'browser',
});
await exporter.write({ file: `${OUT}/exporter.js`, format: 'iife', minify: true, codeSplitting: false });

// What an exported HTML page carries to draw its own Mermaid blocks, packed.
writeFileSync(`${OUT}/mermaid-page.js`, await mermaidScript());

// The subsetter the PDF's fonts are cut with. The extension reads it at run
// time; it is WebAssembly, which no bundle can inline.
copyFileSync(createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'),
  `${OUT}/harfbuzz-subset.wasm`);

// The theme the documents are rendered with. The extension ships the product's
// own; a workspace with its own theme is the next step, as in the build.
copyFileSync('themes/default/theme.css', `${OUT}/theme.css`);

// What "set this folder up" writes into a workspace: the guide an agent writes
// by, and the format specs it points to — the same files as spec/, not copies.
mkdirSync(`${OUT}/init/spec`, { recursive: true });
copyFileSync('packages/app-vscode/templates/guide.md', `${OUT}/init/guide.md`);
for (const spec of ['dgm.md', 'table.md', 'inline-text.md']) copyFileSync(`spec/${spec}`, `${OUT}/init/spec/${spec}`);

console.log(`${OUT}/extension.cjs ＋ webview.js ＋ theme.css ＋ exporter.js ＋ mermaid-page.js ＋ harfbuzz-subset.wasm ＋ init/ を生成`);
