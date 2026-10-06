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

/** The page script as one minified piece. */
export async function mermaidRuntime() {
  const bundle = await rolldown({ input: 'packages/editor/dist/mermaid-page.js', platform: 'browser' });
  const { output } = await bundle.generate({ format: 'iife', codeSplitting: false, minify: true });
  return output[0].code;
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
  return packScript(await mermaidRuntime());
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
