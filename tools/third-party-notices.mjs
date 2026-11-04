// Writes THIRD-PARTY-NOTICES.md for a built product: the name, version, licence
// and licence text of every package that went into its bundles.
//
// Most of what a bundle carries is MIT, BSD or Apache code, and those licences
// ask for their notice to travel with every copy. A minified bundle drops the
// comments it came with, so the notices go next to it as a file instead.
// The list is taken from what the bundler actually put in, not from
// package.json, so it cannot drift from the build.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { createRequire } from 'node:module';

const LICENCE_FILE = /^(licen[cs]e|copying|notice)([.-].*)?$/i;
// Scripts that happen to be named like one (cytoscape ships license-update.mjs).
const NOT_A_TEXT = /\.(m?js|cjs|ts|json|sh|py)$/i;

// Licence texts for packages that ship none, kept by hand: tools/third-party-licences/<name with / as __>.txt
const FALLBACK_DIR = 'tools/third-party-licences';

// Packages offered under a choice of licences, and the one we take.
const CHOSEN = { dompurify: 'Apache-2.0' };

/** Package folders behind the modules of rolldown outputs (from write() or generate()). */
export function packagesInOutputs(...results) {
  const dirs = new Set();
  for (const { output } of results) {
    for (const item of output) {
      for (const id of item.moduleIds ?? []) {
        const dir = packageDirOf(id);
        if (dir) dirs.add(dir);
      }
    }
  }
  return dirs;
}

/** The folder of an installed package, for a file path inside node_modules. */
function packageDirOf(id) {
  const path = id.replace(/^\0+/, '').split('?')[0];
  const marker = `${sep}node_modules${sep}`;
  const at = path.lastIndexOf(marker);
  if (at < 0) return undefined;
  const rest = path.slice(at + marker.length).split(sep);
  const parts = rest[0].startsWith('@') ? 2 : 1;
  if (rest.length <= parts) return undefined;
  return path.slice(0, at + marker.length) + rest.slice(0, parts).join(sep);
}

/** The folder of a package by name, as Node resolves it from the repository root. */
export function packageDir(name) {
  const require = createRequire(join(process.cwd(), 'package.json'));
  let dir = dirname(require.resolve(name));
  while (!existsSync(join(dir, 'package.json')) || JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name !== name) {
    const up = dirname(dir);
    if (up === dir) throw new Error(`package.json of ${name} not found`);
    dir = up;
  }
  return dir;
}

/** Name, version, licence, licence texts and source of each third-party package, sorted by name. */
export function readPackages(dirs) {
  const entries = new Map();
  for (const dir of dirs) {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (manifest.name.startsWith('@docpresenter/') || manifest.name.startsWith('docpresenter')) continue;
    const key = `${manifest.name}@${manifest.version}`;
    if (entries.has(key)) continue;
    const texts = readdirSync(dir).filter(name => LICENCE_FILE.test(name) && !NOT_A_TEXT.test(name)).sort()
      .map(name => readFileSync(join(dir, name), 'utf8').trim());
    const fallback = join(FALLBACK_DIR, `${manifest.name.replace('/', '__')}.txt`);
    if (texts.length === 0 && existsSync(fallback)) texts.push(readFileSync(fallback, 'utf8').trim());
    let licence = typeof manifest.license === 'string' ? manifest.license
      : manifest.license?.type ?? (manifest.licenses ?? []).map(l => l.type).join(' OR ');
    if (!licence) licence = 'not stated in package.json; see the text below';
    if (CHOSEN[manifest.name]) licence = `${licence}, used under ${CHOSEN[manifest.name]}`;
    if (texts.length === 0) {
      console.warn(`[notices] ${key}: no licence file in the package; only "${licence}" is listed`);
    }
    entries.set(key, { name: manifest.name, version: manifest.version, licence, texts, source: sourceOf(manifest) });
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** Writes the notices file for these package folders; returns how many packages it lists. */
export function writeNotices(file, dirs, product) {
  const sorted = readPackages(dirs);
  if (sorted.length === 0) {
    writeFileSync(file, `# Third-party notices — ${product}\n\n${product} includes no third-party software.\n`);
    return 0;
  }
  const lines = [
    `# Third-party notices — ${product}`,
    '',
    `${product} includes the following third-party software. Each is under its own`,
    'licence, reproduced below; none of them is covered by the licence of DocPresenter',
    'itself.',
    '',
    '| Package | Version | Licence |',
    '|---|---|---|',
    ...sorted.map(e => `| ${e.name} | ${e.version} | ${e.licence} |`),
    '',
  ];
  for (const e of sorted) {
    lines.push('---', '', `## ${e.name} ${e.version}`, '', `Licence: ${e.licence}`, '');
    // EPL-2.0 and MPL-2.0 ask that recipients be told where the source is; every entry says it.
    if (e.source) lines.push(`The source code of this package is available under the licence above at <${e.source}>.`, '');
    for (const text of e.texts) lines.push('```text', text.replace(/```/g, "'''"), '```', '');
  }
  writeFileSync(file, lines.join('\n'));
  return sorted.length;
}

/** Where a package's source can be had, from its package.json. */
function sourceOf(manifest) {
  let url = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  if (!url) return `https://www.npmjs.com/package/${manifest.name}/v/${manifest.version}`;
  url = url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '');
  const short = /^(github|gitlab|bitbucket):(.+)$/.exec(url) ?? (/^[\w.-]+\/[\w.-]+$/.test(url) ? [null, 'github', url] : null);
  if (short) url = `https://${short[1]}.${short[1] === 'bitbucket' ? 'org' : 'com'}/${short[2]}`;
  return url;
}

// A licence's own title line ("MIT License", "The ISC License (ISC)"), which varies between copies of one text.
const TITLE_LINE = /^\s*(the\s+)?(mit|isc|bsd)(\s+\S+)?\s+licen[cs]e(\s*\((mit|isc)\))?\s*$/i;

/** One paragraph per line, whitespace collapsed: copies of a text that differ only in wrapping read the same. */
function normalise(text) {
  return text.split(/\n\s*\n/).map(par => par.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n\n');
}

// A line naming who holds the copyright, as licence files write it.
const COPYRIGHT_LINE = /^\s*(copyright\b|\(c\)|©).*\d{4}|^\s*copyright\s*(\(c\)|©)/i;

/**
 * The same notices, made small enough to travel inside every page that carries
 * the code: each package's copyright lines, and each distinct licence text
 * once, not once per package. MIT, ISC and BSD texts differ between packages
 * only in their copyright lines, so dozens of packages share one text.
 * Returned as plain text; the caller wraps it in a comment.
 */
export function compactNotices(dirs) {
  const packages = readPackages(dirs);
  const bodies = new Map();
  for (const p of packages) {
    p.copyrights = [];
    p.bodies = [];
    for (const text of p.texts) {
      const lines = text.split(/\r?\n/);
      p.copyrights.push(...lines.filter(line => COPYRIGHT_LINE.test(line)).map(line => line.trim()));
      const body = normalise(lines.filter(line => !COPYRIGHT_LINE.test(line) && !TITLE_LINE.test(line)).join('\n'));
      if (!bodies.has(body)) bodies.set(body, bodies.size + 1);
      p.bodies.push(bodies.get(body));
    }
  }
  const lines = [];
  for (const p of packages) {
    lines.push(`${p.name} ${p.version} — ${p.licence}; text ${p.bodies.map(n => `[${n}]`).join(' ') || '(none in the package)'}`);
    for (const c of [...new Set(p.copyrights)]) lines.push(`  ${c}`);
    lines.push(`  Source: ${p.source}`);
  }
  for (const [body, n] of bodies) lines.push('', `[${n}]`, body);
  return { packages: packages.length, text: lines.join('\n') };
}

