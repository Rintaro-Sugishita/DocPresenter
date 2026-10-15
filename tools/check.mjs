// Checks a folder of documents the way a build would, and writes nothing.
//
// Usage: node tools/check.mjs [--in <workspace>] [--lang ja|en] [--strict]
//
// Every document with an `output:`, every drawing and every table is read, and
// what a build would find wrong is printed as `path:line:column`, which a
// terminal in VS Code turns into a link. The exit code is 1 when anything is
// an error — or, with --strict, a warning — so a CI job can stop on it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkWorkspace } from '../packages/build/dist/index.js';
import { isLocale, pickLocale } from '../packages/base/dist/index.js';

const SKIP = new Set(['node_modules', '.git', 'dist', 'out']);
const BINARY = /\.(png|jpe?g|gif|webp)$/i;

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(name);
  if (at < 0) return fallback;
  const value = argv[at + 1];
  argv.splice(at, 2);
  return value ?? fallback;
};
const root = option('--in', '.');
const strict = argv.includes('--strict');
const langAsked = option('--lang', undefined);
const locale = isLocale(langAsked) ? langAsked : pickLocale([
  process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG,
  Intl.DateTimeFormat().resolvedOptions().locale,
].filter(Boolean));
const ja = locale === 'ja';

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) files.push(relative(root, path).split(String.fromCharCode(92)).join('/'));
  }
})(root);

const read = path => {
  try {
    if (BINARY.test(path) || !statSync(join(root, path)).isFile()) return undefined;
    return readFileSync(join(root, path), 'utf8');
  } catch { return undefined; }
};
const result = checkWorkspace({ list: () => files, read, dataUrl: () => undefined }, { locale });

/**
 * `path:line:column` for a finding. The build's ranges are bytes of the text
 * read as LF; a CR only ever ends a line, so the line and column are the same
 * in the file as it is.
 */
function where(d) {
  if (!d.path) return '';
  const text = read(d.path);
  if (text === undefined) return d.path;
  if (d.span) {
    const before = Buffer.from(text.replace(/\r\n/g, '\n')).subarray(0, d.span.start).toString('utf8');
    const lines = before.split('\n');
    return `${d.path}:${lines.length}:${lines[lines.length - 1].length + 1}`;
  }
  if (d.line !== undefined) return `${d.path}:${d.line}`;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const numbered = lines[0] === '---' ? lines.slice(0, lines.indexOf('---', 1)).findIndex(l => /^document\s*:/.test(l)) : -1;
  return `${d.path}:${numbered >= 0 ? numbered + 1 : 1}`;
}

const LABEL = ja
  ? { error: 'エラー', warning: '警告', info: 'お知らせ' }
  : { error: 'error', warning: 'warning', info: 'info' };
// A file no output includes is said, but as what it is: a part not yet used.
const severityOf = d => (d.id === 'build.orphan' ? 'info' : d.severity);
const sorted = [...result.diagnostics].sort((a, b) => a.path.localeCompare(b.path)
  || (a.span?.start ?? a.line ?? 0) - (b.span?.start ?? b.line ?? 0));
for (const d of sorted) {
  const at = where(d);
  console.log(`${at ? `${at}: ` : ''}${LABEL[severityOf(d)]}: ${d.message}`);
}

const errors = result.diagnostics.filter(d => severityOf(d) === 'error').length;
const warnings = result.diagnostics.filter(d => severityOf(d) === 'warning').length;
console.log(ja
  ? `文書 ${result.documents}・図 ${result.drawings}・表 ${result.tables} を確かめた。エラー ${errors} 件、警告 ${warnings} 件（何も書き出していない）`
  : `Checked ${result.documents} documents, ${result.drawings} drawings and ${result.tables} tables: ${errors} errors, ${warnings} warnings (nothing was written)`);
if (errors > 0 || (strict && warnings > 0)) process.exitCode = 1;
