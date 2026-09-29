// The build, driven from a filesystem. Everything specific to Node is here:
// the package itself never opens a file, so the same build runs in a browser
// over a directory handle.
//
// Usage: node tools/build.mjs [--in <workspace>] [--out <dir>] [root.md ...]
//
// The workspace is the directory the documents live in, and every path the
// build sees is relative to it. Ours is `sample`; a real one is the repository
// the design documents are kept in.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { build } from '../packages/build/dist/index.js';

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
};

const tryRead = path => { try { return readFileSync(path, 'utf8'); } catch { return undefined; } };

const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch { return undefined; }
})();

const only = argv.map(path => relative(root, resolve(path)).split('\\').join('/'));
const result = build(workspace, {
  outDir,
  // The workspace's own theme wins; otherwise the one the product ships.
  style: theme => workspace.read(`themes/${theme}/theme.css`)
    ?? tryRead(`themes/${theme}/theme.css`),
  ...(only.length ? { only } : {}),
  ...(commit ? { commit } : {}),
  builtAt: new Date().toISOString(),
});

for (const d of result.diagnostics) {
  const where = d.path ? `${d.path}${d.span ? `:${d.span.start}` : ''}: ` : '';
  console.log(`  ${d.severity === 'error' ? '✗' : '!'} ${where}${d.message}`);
}
for (const artifact of result.artifacts) {
  mkdirSync(dirname(artifact.path), { recursive: true });
  writeFileSync(artifact.path, artifact.text);   // outDir is relative to the cwd
  const size = (Buffer.byteLength(artifact.text) / 1024).toFixed(0);
  console.log(`${artifact.path}（${artifact.root} → ${artifact.format}、${size} KB）`);
}
console.log(`ルート ${result.graph.roots.length} 件 / 成果物 ${result.artifacts.length} 件`);
if (result.diagnostics.some(d => d.severity === 'error')) process.exitCode = 1;
