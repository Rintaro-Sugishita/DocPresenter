// The build, driven from a filesystem. Everything specific to Node is here:
// the package itself never opens a file, so the same build runs in a browser
// over a directory handle.
//
// Usage: node tools/build.mjs [--in <workspace>] [--out <dir>] [root.md ...]
//                             [--chromium <path>] [--font <ttf/ttc>] [--lang ja|en]
//
// The PDF is laid out by a browser and carries its own fonts, so those two are
// this machine's business rather than the document's: both are found by
// looking in the usual places, and named here when they are somewhere else.
//
// The workspace is the directory the documents live in, and every path the
// build sees is relative to it. Ours is `sample`; a real one is the repository
// the design documents are kept in.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { build, themeOf } from '../packages/build/dist/index.js';
import { isLocale, pickLocale } from '../packages/base/dist/index.js';
import { createPdfWriter } from './pdf-writer.mjs';
import { createMermaidPainter, mermaidScript } from './mermaid-script.mjs';

const SKIP = new Set(['node_modules', '.git', 'dist', 'out']);
const BINARY = /\.(png|jpe?g|gif|webp)$/i;
const MEDIA = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(name);
  if (at < 0) return fallback;
  const value = argv[at + 1];
  argv.splice(at, 2);
  return value ?? fallback;
};
const root = option('--in', '.');
const outDir = option('--out', 'out/build');
// 何と比べるか。コミット・タグ・ブランチ、またはフォルダ（design/diff-marking.md §2）
const diffFrom = option('--diff-from', undefined);
const showRemoved = option('--show-removed', undefined);
// A PDF carries the review so far for the customer to answer; a copy for
// delivery leaves it out.
const reviewNotes = !process.argv.includes('--no-review-notes');
// PDF を書くのに要る、この機械のもの。見つからなければ既定の置き場所を順に探す。
const chromiumAt = option('--chromium', undefined);
const fontAt = option('--font', undefined);
// 診断と、文書に入る文言（表紙の見出し・目次・図/表）の言語。ビルドした人の言語に
// 従う（design/decisions.md）。--lang が無ければ、この機械の言語設定から決める。
const langAsked = option('--lang', undefined);
const locale = isLocale(langAsked) ? langAsked : pickLocale([
  process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG,
  Intl.DateTimeFormat().resolvedOptions().locale,
].filter(Boolean));
const ja = locale === 'ja';
const inside = path => join(root, path);

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) files.push(relative(root, path).split('\\').join('/'));
  }
})(root);

const workspace = {
  list: () => files,
  read(path) {
    try {
      if (BINARY.test(path)) return undefined;   // binaries travel as data URLs
      if (!statSync(inside(path)).isFile()) return undefined;
      return readFileSync(inside(path), 'utf8');
    } catch { return undefined; }
  },
  dataUrl(path) {
    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    const type = MEDIA[extension];
    if (!type) return undefined;
    try {
      return `data:${type};base64,${readFileSync(inside(path)).toString('base64')}`;
    } catch { return undefined; }
  },
  // 文書が web 上の画像を指しているとき、**作業フォルダには落とさず**、
  // 成果物にだけ入れる。配ったファイルが外に取りに行かないのは譲れないので、
  // 取り込むならビルドのここしか場所が無い。取れなければ黙らず報告する。
  async inline(address) {
    const response = await fetch(address, { redirect: 'follow' });
    if (!response.ok) return undefined;
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!Object.values(MEDIA).includes(type)) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) return undefined;
    const size = (bytes.length / 1024).toFixed(0);
    console.log(ja ? `  取り込み ${address}（${size} KB）` : `  Brought in ${address} (${size} KB)`);
    return `data:${type};base64,${bytes.toString('base64')}`;
  },
};

const tryRead = path => { try { return readFileSync(path, 'utf8'); } catch { return undefined; } };

/**
 * The other version. A folder is read straight; anything else is asked of Git,
 * which is where the answer lives for the usual case — "what changed since the
 * version we reviewed".
 */
const previous = (() => {
  if (!diffFrom) return undefined;
  let isDirectory = false;
  try { isDirectory = statSync(diffFrom).isDirectory(); } catch { isDirectory = false; }
  if (isDirectory) {
    return { name: diffFrom, read: path => tryRead(join(diffFrom, path)) };
  }
  const prefix = relative('.', root).split('\\').join('/');
  return {
    name: diffFrom,
    read: path => {
      const target = prefix && prefix !== '.' ? `${prefix}/${path}` : path;
      const shown = spawnSync('git', ['show', `${diffFrom}:${target}`], { encoding: 'utf8' });
      return shown.status === 0 ? shown.stdout : undefined;
    },
  };
})();

const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch { return undefined; }
})();
// Whether what is built is that commit. Only the folder being built counts:
// a change elsewhere in the repository does not make these files different.
const clean = commit === undefined ? undefined : (() => {
  try {
    return execFileSync('git', ['status', '--porcelain', '--', root], { encoding: 'utf8' }).trim() === '';
  } catch { return undefined; }
})();

const wantsPdf = files.some(path => /\.md$/i.test(path)
  && (workspace.read(path) ?? '').includes('pdf'));
// Mermaid is drawn by the page itself; the script is carried only by the pages
// that have a Mermaid block. A slide needs it drawn as a picture, here.
const hasMermaid = files.some(path => /\.(mmd|mermaid)$/i.test(path)
  || (/\.md$/i.test(path) && /^ {0,3}(`{3,}|~{3,})\s*mermaid/m.test(workspace.read(path) ?? '')));
const script = hasMermaid ? await mermaidScript() : undefined;
const wantsPptx = files.some(path => /\.md$/i.test(path)
  && (workspace.read(path) ?? '').includes('pptx'));
const painter = await (async () => {
  if (!script || !wantsPptx) return undefined;
  try {
    return await createMermaidPainter({ chromium: chromiumAt, script });
  } catch (error) {
    console.log(ja ? `  ! Mermaid の図をスライドに描けない: ${error.message}`
      : `  ! Cannot draw Mermaid diagrams for slides: ${error.message}`);
    return undefined;
  }
})();
// A machine with no browser or no Japanese font can still build the HTML and
// the PPTX. Saying why the PDF is missing, and failing the run, beats both
// stopping everything and quietly leaving one format out.
const pdf = await (async () => {
  if (!wantsPdf) return undefined;
  try {
    return await createPdfWriter({ chromium: chromiumAt, font: fontAt, mermaidScript: script });
  } catch (error) {
    console.log(ja ? `  ✗ PDF は書けない: ${error.message}` : `  ✗ Cannot write PDF: ${error.message}`);
    process.exitCode = 1;
    return undefined;
  }
})();

const only = argv.map(path => relative(root, resolve(path)).split('\\').join('/'));
const result = await build(workspace, {
  locale,
  ...(pdf ? { writers: { pdf: pdf.write } } : {}),
  ...(script ? { mermaidScript: script } : {}),
  ...(painter ? { mermaidPicture: painter.picture } : {}),
  outDir,
  // The workspace's own theme wins; otherwise the one the product ships.
  style: theme => themeOf(path => workspace.read(path), theme)
    ?? tryRead(`themes/${theme}/theme.css`),
  ...(previous ? { diffFrom: previous } : {}),
  ...(showRemoved ? { showRemoved } : {}),
  ...(only.length ? { only } : {}),
  ...(commit ? { commit } : {}),
  ...(clean === undefined ? {} : { clean }),
  reviewNotes,
  builtAt: new Date().toISOString(),
});

for (const d of result.diagnostics) {
  const where = d.path ? `${d.path}${d.span ? `:${d.span.start}` : ''}: ` : '';
  console.log(`  ${d.severity === 'error' ? '✗' : '!'} ${where}${d.message}`);
}
for (const artifact of result.artifacts) {
  mkdirSync(dirname(artifact.path), { recursive: true });
  const body = artifact.bytes ?? artifact.text;   // outDir is relative to the cwd
  writeFileSync(artifact.path, body);
  const size = ((artifact.bytes?.length ?? Buffer.byteLength(artifact.text)) / 1024).toFixed(0);
  const comma = ja ? '、' : ', ';
  const extra = artifact.report
    ? comma + (ja ? `${artifact.report.pages} ページ` : `${artifact.report.pages} pages`)
      + (artifact.report.font ? comma + artifact.report.font : '')
      + (artifact.report.missing.length
        ? comma + (ja ? '欠字 ' : 'missing glyphs ') + artifact.report.missing.length : '')
    : '';
  console.log(ja
    ? `${artifact.path}（${artifact.root} → ${artifact.format}、${size} KB${extra}）`
    : `${artifact.path} (${artifact.root} → ${artifact.format}, ${size} KB${extra})`);
  for (const message of artifact.report?.diagnostics ?? []) console.log(`  ! ${message}`);
}
await pdf?.close();
await painter?.close();
console.log(ja
  ? `ルート ${result.graph.roots.length} 件 / 成果物 ${result.artifacts.length} 件`
  : `${result.graph.roots.length} roots / ${result.artifacts.length} outputs`);
if (result.diagnostics.some(d => d.severity === 'error')) process.exitCode = 1;
