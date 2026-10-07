// The PDF format writer, for a build running in Node.
//
// The build itself knows nothing about browsers: it hands a prepared document
// to a writer and takes back bytes. This writer opens the same HTML the HTML
// artifact is made of, lets Chromium lay it out, reads the result as a page
// plan, and writes the PDF from that. See design/pdf-engine.md §6.
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { platform } from 'node:process';
import { chromium } from 'playwright-core';
import { rolldown } from 'rolldown';
import { BUILD_MESSAGES, renderPage } from '../packages/build/dist/index.js';
import { createRequire } from 'node:module';
import { createSubsetter, writePdf } from '../packages/pdf/dist/index.js';

/**
 * Where to find a Chromium to measure with.
 *
 * The browser is not ours to ship — playwright-core carries no binary — so the
 * answer is whatever this machine already has. Tried in order, and the first
 * that exists wins; `--chromium` on the command line beats all of them.
 *
 * A path that is wrong is better than a silent fallback: when none is found
 * the error names the flag, because "PDF 出力に失敗" with no path in it is a
 * message nobody can act on.
 */
const CHROMIUM_PATHS = {
  linux: [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/snap/bin/chromium',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
};

/**
 * Japanese faces to embed, when the ones the theme names are not installed.
 *
 * The PDF carries its own fonts (design/pdf-engine.md), so a machine with no
 * Japanese face cannot write one at all. Every desktop has one; they are just
 * called different things.
 */
const FALLBACK_PATHS = {
  linux: [
    '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf',
    '/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ],
  darwin: [
    '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/Library/Fonts/Arial Unicode.ttf',
  ],
  win32: [
    'C:\\Windows\\Fonts\\YuGothR.ttc',
    'C:\\Windows\\Fonts\\meiryo.ttc',
    'C:\\Windows\\Fonts\\msgothic.ttc',
  ],
};

/**
 * The monospaced Japanese face the browser sets code in, where the theme's own
 * is not installed. The first face of MS Gothic's collection is the monospaced
 * one — the face a Japanese Windows page means by `monospace`.
 */
const MONO_FALLBACK_PATHS = {
  win32: ['C:\\Windows\\Fonts\\msgothic.ttc'],
  darwin: ['/System/Library/Fonts/Osaka.ttf'],
};

/** The first of a list that is actually on this machine. */
function firstThere(paths) {
  return paths.find(path => existsSync(path));
}

export function findChromium(override) {
  const found = override ?? process.env.DOCPRESENTER_CHROMIUM
    ?? firstThere(CHROMIUM_PATHS[platform] ?? CHROMIUM_PATHS.linux);
  if (!found) {
    throw new Error('PDF を書くための Chromium が見つからない。'
      + 'Chrome か Edge を入れるか、--chromium <path> で場所を教えてください'
      + '（環境変数 DOCPRESENTER_CHROMIUM でも可）');
  }
  return found;
}
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
function fonts(given) {
  const override = given ?? process.env.DOCPRESENTER_FONT;
  const read = path => { try { return new Uint8Array(readFileSync(path)); } catch { return undefined; } };
  const set = {};
  const cache = new Map();
  let missing = false;
  for (const [style, face] of Object.entries(FACES)) {
    const path = override ?? face.file;
    if (!cache.has(path)) cache.set(path, read(path));
    const bytes = cache.get(path);
    // A font that was named and cannot be read is a mistake, not a reason to
    // quietly write the PDF in some other face: the writing would come out in
    // a font nobody chose, and the report would be the only hint.
    if (bytes === undefined && override !== undefined) {
      throw new Error(`指定されたフォントが読めない: ${override}`);
    }
    if (bytes === undefined) { missing = true; break; }
    set[style] = { bytes, name: face.name, faceIndex: override ? 0 : face.index };
  }
  if (!missing) return { set, name: override ?? 'Noto CJK JP' };

  const fallback = firstThere(FALLBACK_PATHS[platform] ?? FALLBACK_PATHS.linux);
  const bytes = fallback === undefined ? undefined : read(fallback);
  if (!bytes) {
    throw new Error('PDF に埋め込む日本語フォントが見つからない。'
      + '--font <ttf/ttc のパス> で指定してください'
      + '（環境変数 DOCPRESENTER_FONT でも可）');
  }
  const fileName = path => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const one = { bytes, name: fileName(fallback) };
  // Code is laid out by the browser in the machine's monospaced face, so it is
  // written in one too: set in a proportional face, each run is squeezed into
  // the width the browser gave it and the runs of a line run into each other.
  const monoAt = firstThere(MONO_FALLBACK_PATHS[platform] ?? []);
  const monoBytes = monoAt === undefined ? undefined : read(monoAt);
  const mono = monoBytes ? { bytes: monoBytes, name: fileName(monoAt) } : one;
  return {
    set: { body: one, bodyBold: one, heading: one, headingBold: one, mono },
    name: mono === one ? one.name : `${one.name} ＋ ${mono.name}`,
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
  const browser = await chromium.launch({ executablePath: findChromium(options.chromium) });
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
      ...(options.mermaidScript ? { mermaidScript: options.mermaidScript } : {}),
    });

    const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent(html, { waitUntil: 'load' });
    // The page draws its Mermaid blocks itself. Measuring before it is done
    // would leave a blank where each drawing goes.
    await page.waitForFunction(() => !document.querySelector('.dp-mermaid')
      || document.documentElement.dataset.dpMermaid === 'done', undefined, { timeout: 60000 });
    // Drawn as SVG for the screen; laid on the page as a picture of itself.
    await page.evaluate(() => window.__dpMermaid?.flatten(document));
    await page.addScriptTag({ content: script });

    const title = String(input.root.document.frontmatter.raw.title ?? '');
    const number = String(input.root.document.frontmatter.raw.document ?? '');
    const version = String(input.root.document.frontmatter.raw.version ?? '');
    const { locale } = input.prepared.resolved;
    const versioned = version && BUILD_MESSAGES.in(locale)('build.foot.version', { version });
    const measured = await page.evaluate(
      ([foot, name, commit, language]) =>
        window.__dpMeasure(document.body, { foot, title: name, commit, locale: language }),
      [[number, title, versioned].filter(Boolean).join('　'), title,
        input.options.commit ?? '', locale],
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
