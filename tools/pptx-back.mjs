// Reads an edited deck back into the drawings it came from.
//
// Usage: node tools/pptx-back.mjs <deck.pptx> [--in <workspace>] [--write]
//
// Without --write nothing is touched: the changes are printed, which is how
// this should be used the first time someone sends a deck back.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { writeBack } from '../packages/build/dist/index.js';

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
const write = flag('--write');
const deck = argv[0];
if (!deck) {
  console.error('使い方: node tools/pptx-back.mjs <deck.pptx> [--in <作業域>] [--write]');
  process.exit(2);
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'out']);
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
      return statSync(join(root, path)).isFile() ? readFileSync(join(root, path), 'utf8') : undefined;
    } catch { return undefined; }
  },
};

const result = writeBack(new Uint8Array(readFileSync(deck)), workspace);
for (const d of result.diagnostics) {
  console.log(`  ${d.severity === 'error' ? '✗' : '!'} ${d.path ? d.path + ': ' : ''}${d.message}`);
}
for (const file of result.files) {
  if (file.text === file.source) {
    console.log(`${file.path}　変更なし`);
    continue;
  }
  console.log(`${file.path}　${file.changes.join('、')}`);
  if (write) {
    writeFileSync(join(root, file.path), file.text);
  } else {
    for (const line of diff(file.source, file.text)) console.log(`    ${line}`);
  }
}
if (!write && result.files.some(file => file.text !== file.source)) {
  console.log('（--write を付けると書き込みます）');
}

/** The changed lines, so what would be written can be read before it is. */
function diff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`- ${a[i]}`);
    if (b[i] !== undefined) out.push(`+ ${b[i]}`);
  }
  return out;
}
