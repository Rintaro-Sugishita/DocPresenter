// Formats drawings (.dgm) into their canonical order and spacing.
//
// Usage: node tools/format-dgm.mjs [--in <workspace>] [--write] [--check] [--lang ja|en] [file.dgm ...]
//
// With no files named, every .dgm under the workspace. Without --write nothing
// is touched: the drawings that would change are listed. --check makes that a
// failure (exit code 1), so a CI job can insist on formatted drawings. The
// formatter never changes what a drawing draws (spec/dgm.md §6.3); a drawing it
// cannot prove that for is left as it is, and says why.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { formatDiagram } from '../packages/diagram/dist/index.js';
import { describeError, isLocale, pickLocale, say } from '../packages/base/dist/index.js';

const SKIP = new Set(['node_modules', '.git', 'dist', 'out']);

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(name);
  if (at < 0) return fallback;
  const value = argv[at + 1];
  argv.splice(at, 2);
  return value ?? fallback;
};
const flag = name => {
  const at = argv.indexOf(name);
  if (at < 0) return false;
  argv.splice(at, 1);
  return true;
};
const root = option('--in', '.');
const langAsked = option('--lang', undefined);
const write = flag('--write');
const check = flag('--check');
const locale = isLocale(langAsked) ? langAsked : pickLocale([
  process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG,
  Intl.DateTimeFormat().resolvedOptions().locale,
].filter(Boolean));
const ja = locale === 'ja';

const files = argv.length > 0 ? argv.map(path => resolve(path)) : [];
if (files.length === 0) {
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.dgm')) files.push(path);
    }
  })(resolve(root));
}

let changed = 0;
let failed = 0;
for (const file of files.sort()) {
  const shown = relative(resolve(root), file).split('\\').join('/');
  const source = readFileSync(file, 'utf8');
  // Parts a drawing uses change its picture, so they are read as the build reads them.
  const read = used => {
    try { return readFileSync(resolve(dirname(file), used), 'utf8'); } catch { return undefined; }
  };
  let result;
  try {
    result = formatDiagram(source, read);
  } catch (error) {
    failed++;
    console.log(`${shown}: ${ja ? 'エラー' : 'error'}: ${describeError(error, locale)}`);
    continue;
  }
  for (const note of result.notes) console.log(`${shown}: ${say(locale, note)}`);
  if (!result.changed) continue;
  changed++;
  if (write) writeFileSync(file, result.text);
  console.log(write
    ? (ja ? `${shown} を整形した` : `formatted ${shown}`)
    : (ja ? `${shown} は整形されていない` : `${shown} is not formatted`));
}

console.log(ja
  ? `図 ${files.length} 件のうち、${write ? '整形した' : '整形が要る'}もの ${changed} 件、読めないもの ${failed} 件`
  : `${files.length} drawings: ${changed} ${write ? 'formatted' : 'to format'}, ${failed} unreadable`);
if (failed > 0 || (check && !write && changed > 0)) process.exitCode = 1;
