// Builds the VS Code extension into packages/app-vscode/media.
//
// Two bundles, because the extension is two programs. The host half runs in
// Node inside VS Code and must not carry the editor's screen; the WebView half
// runs in Chromium and must not carry anything of VS Code's. `vscode` itself is
// never bundled — the editor provides it at run time.
import { copyFileSync, mkdirSync } from 'node:fs';
import { rolldown } from 'rolldown';

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
await view.write({ file: `${OUT}/webview.js`, format: 'iife' });

// The theme the documents are rendered with. The extension ships the product's
// own; a workspace with its own theme is the next step, as in the build.
copyFileSync('themes/default/theme.css', `${OUT}/theme.css`);

console.log(`${OUT}/extension.cjs ＋ webview.js ＋ theme.css を生成`);
