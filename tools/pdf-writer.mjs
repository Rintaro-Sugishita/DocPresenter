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
import { createRequire } from 'node:module';
import { createSubsetter, writePdf } from '../packages/pdf/dist/index.js';

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
 * The faces the theme names, and where to find them.
 *
 * Noto Sans CJK ships as one file holding the Japanese, Korean and both
 * Chinese faces, so a face is a file and an index into it. These are the ones
 * `themes/default/theme.css` asks for; a workspace that ships its own fonts
 * would hand a different set to the writer.
 */
const NOTO = '/usr/share/fonts/opentype/noto';
const FACES = {
  // The theme sets the body in the same gothic family as the headings, so these
  // two name the same file. They stay separate entries because a theme that
  // splits them again (--font-body back to the serif family) needs no change
  // here beyond the path.
  body:        { file: `${NOTO}/NotoSansCJK-Regular.ttc`,  index: 0, name: 'NotoSansCJKjp-Regular' },
  bodyBold:    { file: `${NOTO}/NotoSansCJK-Bold.ttc`,     index: 0, name: 'NotoSansCJKjp-Bold' },
  heading:     { file: `${NOTO}/NotoSansCJK-Regular.ttc`,  index: 0, name: 'NotoSansCJKjp-Regular' },
  headingBold: { file: `${NOTO}/NotoSansCJK-Bold.ttc`,     index: 0, name: 'NotoSansCJKjp-Bold' },
  // Index 5 of the same collection is NotoSansMonoCJKjp, which is what the
  // theme means by --font-mono.
  mono:        { file: `${NOTO}/NotoSansCJK-Regular.ttc`,  index: 5, name: 'NotoSansMonoCJKjp-Regular' },
};
/** When the product's own fonts are not installed. TrueType, so no subsetter is needed. */
const FALLBACK_FILE = '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf';

function fonts(override) {
  const read = path => { try { return new Uint8Array(readFileSync(path)); } catch { return undefined; } };
  const set = {};
  const cache = new Map();
  let missing = false;
  for (const [style, face] of Object.entries(FACES)) {
    const path = override ?? face.file;
    if (!cache.has(path)) cache.set(path, read(path));
    const bytes = cache.get(path);
    if (bytes === undefined) { missing = true; break; }
    set[style] = { bytes, name: face.name, faceIndex: override ? 0 : face.index };
  }
  if (!missing) return { set, name: override ?? 'Noto CJK JP' };

  const bytes = read(FALLBACK_FILE);
  if (!bytes) throw new Error('埋め込むフォントが見つからない');
  const one = { bytes, name: FALLBACK_FILE.slice(FALLBACK_FILE.lastIndexOf('/') + 1) };
  return {
    set: { body: one, bodyBold: one, heading: one, headingBold: one, mono: one },
    name: one.name,
  };
}

/**
 * The subsetter. Without it the Noto faces cannot be embedded at all: they hold
 * their outlines in a CFF table, which pdf-lib's own subsetter turns into a
 * font that draws nothing (design/pdf-engine.md §7.5).
 */
async function subsetter() {
  const wasm = createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm');
  return createSubsetter(readFileSync(wasm));
}

export async function createPdfWriter(options = {}) {
  const script = await measureScript();
  const browser = await chromium.launch({ executablePath: options.chromium ?? CHROMIUM });
  const { set, name } = fonts(options.font);
  const subset = await subsetter();

  const write = async input => {
    const html = renderPage({
      workspace: input.workspace,
      document: input.prepared.document,
      resolved: input.prepared.resolved,
      style: input.style,
      root: input.root.path,
      // 差分の印はクラス名なので、PDF 側は何もしなくてよい——組版済みの
      // DOM を読むとき、テーマが解決した色がそのまま入ってくる。
      ...(input.marks ? { marks: input.marks } : {}),
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

    const { bytes, missing } = await writePdf(measured.plan, { fonts: set, subset });
    for (const one of missing) {
      input.diagnostics?.push(`フォントに無い字: ${one.character}`);
    }
    return {
      path: `${input.out}.pdf`, bytes, root: input.root.path, format: 'pdf',
      report: {
        pages: measured.plan.pages.length, missing, font: name,
        diagnostics: measured.diagnostics,
      },
    };
  };

  return { write, close: () => browser.close() };
}
