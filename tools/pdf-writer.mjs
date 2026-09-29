// The PDF format writer, for a build running in Node.
//
// The build itself knows nothing about browsers: it hands a prepared document
// to a writer and takes back bytes. This writer opens the same HTML the HTML
// artifact is made of, lets Chromium lay it out, reads the result as a page
// plan, and writes the PDF from that. See design/pdf-engine.md §6.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { rolldown } from 'rolldown';
import { renderPage } from '../packages/build/dist/index.js';
import { writePdf } from '../packages/pdf/dist/index.js';

const CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
/**
 * The measuring code runs inside the page, so it is bundled once and injected.
 * It is the same module the browser and VS Code paths will use.
 */
async function measureScript() {
  mkdirSync('out', { recursive: true });
  writeFileSync('out/measure-entry.js',
    `import { measure } from '../packages/pdf/dist/measure.js';\n`
    + `window.__dpMeasure = measure;\n`);
  const bundle = await rolldown({ input: 'out/measure-entry.js', platform: 'browser' });
  const { output } = await bundle.generate({ format: 'iife' });
  return output[0].code;
}

/**
 * Fonts. The product ships Noto Sans CJK JP (design/pdf-engine.md §8), which is
 * a CFF font and needs a subsetter of its own; what is wired here is the
 * TrueType path, which pdf-lib subsets correctly. The writer refuses a CFF font
 * rather than producing a file whose text extracts and whose glyphs are blank.
 */
function fonts(path = '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf') {
  const bytes = readFileSync(path);
  const name = path.slice(path.lastIndexOf('/') + 1);
  return { regular: { bytes, name }, bold: { bytes, name }, mono: { bytes, name } };
}

export async function createPdfWriter(options = {}) {
  const script = await measureScript();
  const browser = await chromium.launch({ executablePath: options.chromium ?? CHROMIUM });
  const set = fonts(options.font);

  const write = async input => {
    const html = renderPage({
      workspace: input.workspace,
      document: input.prepared.document,
      resolved: input.prepared.resolved,
      style: input.style,
      root: input.root.path,
      ...(input.options.commit ? { commit: input.options.commit } : {}),
    });

    const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent(html, { waitUntil: 'load' });
    await page.addScriptTag({ content: script });

    const title = String(input.root.document.frontmatter.raw.title ?? '');
    const number = String(input.root.document.frontmatter.raw.document ?? '');
    const version = String(input.root.document.frontmatter.raw.version ?? '');
    const measured = await page.evaluate(
      ([foot, name, commit]) => window.__dpMeasure(document.body, { foot, title: name, commit }),
      [[number, title, version && `版 ${version}`].filter(Boolean).join('　'), title,
        input.options.commit ?? ''],
    );
    await page.close();
    if (errors.length) throw new Error(errors.join(' / '));

    const { bytes, missing } = await writePdf(measured.plan, { fonts: set });
    for (const one of missing) {
      input.diagnostics?.push(`フォントに無い字: ${one.character}`);
    }
    return {
      path: `${input.out}.pdf`, bytes, root: input.root.path, format: 'pdf',
      report: { pages: measured.plan.pages.length, missing, diagnostics: measured.diagnostics },
    };
  };

  return { write, close: () => browser.close() };
}
