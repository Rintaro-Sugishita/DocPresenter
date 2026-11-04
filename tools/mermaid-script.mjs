// The script a delivered page carries to draw its Mermaid blocks, and a way to
// draw one as a picture for a slide.
//
// Mermaid lays a drawing out in a browser, so the build cannot do it in Node:
// the page draws itself when it is opened (packages/editor/src/mermaid-page.ts),
// and a slide's picture is drawn by the same script in a browser this machine
// already has — the one the PDF is laid out with.
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { rolldown } from 'rolldown';
import { findChromium } from './pdf-writer.mjs';
import { compactNotices, packagesInOutputs } from './third-party-notices.mjs';

/** The page script as one minified piece, and the notices of what went into it. */
export async function mermaidRuntime() {
  const bundle = await rolldown({ input: 'packages/editor/dist/mermaid-page.js', platform: 'browser' });
  const result = await bundle.generate({ format: 'iife', codeSplitting: false, minify: true });
  return { code: result.output[0].code, notices: compactNotices(packagesInOutputs(result)).text };
}

/**
 * The comment every page carrying the script starts it with. The code inside is
 * minified and packed, so the licences it was written under cannot ride along
 * as comments in it; they go here, readable in the page's source, with no
 * network needed (LICENSE.md §6; the third parties' own terms).
 */
export function noticeBanner(notices) {
  const text = [
    'This page draws its diagrams with a script from DocPresenter.',
    'DocPresenter is Copyright © 2026 Rintaro Sugishita. All rights reserved.',
    'Licence: https://github.com/Rintaro-Sugishita/DocPresenter/blob/HEAD/LICENSE.md',
    '',
    'The script includes the following third-party software, each under its own',
    'licence. Each package lists its copyright lines and the licence text it is',
    'under, by number; the texts follow the list.',
    '',
    notices,
  ].join('\n');
  return `/*!\n${text.replace(/\*\//g, '* /')}\n*/\n`;
}

/**
 * The page script, packed to be inlined.
 *
 * Mermaid is several megabytes of script, and every delivered page with a
 * Mermaid block carries all of it — the page has to open with no network. So
 * it travels compressed, and the browser's own DecompressionStream unpacks it
 * when the page is opened: about a third of the size, and nothing fetched.
 */
export async function mermaidScript() {
  const { code, notices } = await mermaidRuntime();
  return noticeBanner(notices) + packScript(code);
}

export function packScript(code) {
  const packed = gzipSync(Buffer.from(code, 'utf8'), { level: 9 }).toString('base64');
  return `(async () => {
  const text = atob(${JSON.stringify(packed)});
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  const code = await new Response(new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream('gzip'))).text();
  const script = document.createElement('script');
  script.src = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  document.head.append(script);
})();`;
}

/**
 * Draws Mermaid sources as PNGs, in a browser of its own. Closed by the caller;
 * one page is reused for every drawing, because each is a few hundred
 * milliseconds and a document rarely has more than a handful.
 */
export async function createMermaidPainter({ chromium: at, script }) {
  const browser = await chromium.launch({ executablePath: findChromium(at) });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body></body></html>');
  await page.addScriptTag({ content: script });
  await page.waitForFunction(() => window.__dpMermaid !== undefined, undefined, { timeout: 60000 });
  return {
    picture: source => page.evaluate(text => window.__dpMermaid.picture(text), source),
    close: () => browser.close(),
  };
}
