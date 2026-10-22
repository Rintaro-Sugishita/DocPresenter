// Builds the two commands: dgm into packages/dgm/media, docpresenter into
// packages/cli/media.
//
// Each is one bundle and the files it reads at run time, the way the VS Code
// extensions are built (tools/build-vscode.mjs). Our own packages are private
// and go inside the bundle; playwright-core, which drives the browser PNGs and
// PDFs are drawn in, stays a dependency. dgm is built from the drawing side
// alone — nothing of the document side goes in, which is what lets it be
// installed on its own.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { rolldown } from 'rolldown';
import { mermaidScript } from './mermaid-script.mjs';

const EXTERNAL = ['playwright-core'];

async function command(input, file) {
  const bundle = await rolldown({ input, platform: 'node', external: EXTERNAL });
  await bundle.write({ file, format: 'esm', banner: '#!/usr/bin/env node', codeSplitting: false });
}

// dgm
const DGM = 'packages/dgm/media';
mkdirSync(DGM, { recursive: true });
await command('packages/dgm/dist/bin.js', `${DGM}/dgm.mjs`);
// The theme's drawing rules go inside every SVG it writes.
copyFileSync('themes/default/theme.css', `${DGM}/theme.css`);
console.log(`${DGM}/dgm.mjs ＋ theme.css を生成`);

// docpresenter
const DOC = 'packages/cli/media';
mkdirSync(DOC, { recursive: true });
await command('packages/cli/dist/bin.js', `${DOC}/docpresenter.mjs`);
copyFileSync('themes/default/theme.css', `${DOC}/theme.css`);
// The measuring that turns a laid-out page into a page plan runs inside the
// page, so it travels as a script to inject.
mkdirSync('out', { recursive: true });
writeFileSync('out/cli-measure-entry.js',
  `import { measure } from '../packages/pdf/dist/measure.js';\nwindow.__dpMeasure = measure;\n`);
const measure = await rolldown({ input: 'out/cli-measure-entry.js', platform: 'browser' });
const { output } = await measure.generate({ format: 'iife', minify: true, codeSplitting: false });
writeFileSync(`${DOC}/measure.js`, output[0].code);
// What a delivered page carries to draw its own Mermaid blocks, packed.
writeFileSync(`${DOC}/mermaid-page.js`, await mermaidScript());
// The subsetter the PDF's fonts are cut with: WebAssembly, which no bundle can inline.
copyFileSync(createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'),
  `${DOC}/harfbuzz-subset.wasm`);
// What `init` writes into a workspace: the guide an agent writes by, and the
// format specs it points to — the same files as the VS Code extension ships.
mkdirSync(`${DOC}/init/spec`, { recursive: true });
copyFileSync('packages/app-vscode/templates/guide.md', `${DOC}/init/guide.md`);
for (const spec of ['dgm.md', 'table.md', 'inline-text.md']) copyFileSync(`spec/${spec}`, `${DOC}/init/spec/${spec}`);
console.log(`${DOC}/docpresenter.mjs ＋ theme.css ＋ measure.js ＋ mermaid-page.js ＋ harfbuzz-subset.wasm ＋ init/ を生成`);
