// Starting things: a workspace set up for DocPresenter, a numbered document,
// a drawing. What is written is what VS Code's commands write
// (`planScaffold`, `documentFiles`, `starterDiagram`); only the questions are
// arguments here, since a command line does not ask.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  TEAM_THEME, TEMPLATE_DOCUMENT, TEMPLATE_REVISION, documentFiles, documentPaths, planScaffold,
  type Shipped,
} from '@docpresenter/build';
import { nameProblem } from '@docpresenter/base';
import { assetFile, CliError, DEFAULT_OUT, lastOf, listFiles, newFile, type Context, type ParsedArgs } from '@docpresenter/dgm';
import { documentNumberOf, firstNumber, numberSeries, suggestNumber } from '@docpresenter/markdown';
import { DOC_MESSAGES } from './messages.js';

/** The format specs shipped beside the guide, in `media/init/spec/`. */
const SPECS = ['dgm.md', 'table.md', 'inline-text.md'];

/** Every document number in the workspace, with the document that has it. */
export function numbersInUse(root: string): Map<string, string> {
  const used = new Map<string, string>();
  for (const path of listFiles(root).filter(one => /\.md$/i.test(one))) {
    let text: string;
    try { text = readFileSync(join(root, path), 'utf8'); } catch { continue; }
    const number = documentNumberOf(text);
    if (number && !used.has(number)) used.set(number, path);
  }
  return used;
}

/**
 * The number a new document gets: the one given, refused when it is taken; or
 * the next free one of the series given (its first, for a new series); or the
 * next of the series the repository uses most.
 */
export function chooseNumber(used: ReadonlyMap<string, string>, given?: string, series?: string): string {
  if (given !== undefined && series !== undefined) throw new CliError('usage', 'doc.number.both');
  if (given !== undefined) {
    const number = given.trim();
    if (number === '') throw new CliError('usage', 'doc.number.empty');
    const by = used.get(number);
    if (by !== undefined) throw new CliError('content', 'doc.number.taken', { number, path: by });
    return number;
  }
  if (series !== undefined) {
    const prefix = series.trim();
    if (prefix === '') throw new CliError('usage', 'doc.number.empty');
    return numberSeries([...used.keys()]).find(one => one.prefix === prefix)?.next ?? firstNumber(prefix);
  }
  return suggestNumber([...used.keys()]);
}

/** Today as this machine's calendar has it, not UTC's. */
export function localDate(now: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

function titleOf(args: ParsedArgs): string {
  const title = lastOf(args, 'title')?.trim();
  if (!title) throw new CliError('usage', 'doc.title.needed');
  return title;
}

/**
 * `docpresenter init`: the workspace set up as VS Code's "Set Up This Folder"
 * sets it up. Nothing that is there is written over; what is kept is said.
 */
export function initCommand(ctx: Context, args: ParsedArgs, root: string, from: string): number {
  const d = DOC_MESSAGES.in(ctx.locale);
  // The first document goes in docs/, under the name given (a `/` puts it in a
  // folder). A workspace that already has numbered documents gets none unless
  // a name is given: run again to bring the guide or the specs back, init
  // should not leave a stray docs/design.md behind.
  const used = numbersInUse(root);
  const firstDocument = used.size === 0 || lastOf(args, 'name') !== undefined;
  const title = firstDocument ? titleOf(args) : lastOf(args, 'title') ?? '';
  const name = (lastOf(args, 'name') ?? 'design').trim().replace(/\\/g, '/').replace(/\.md$/i, '');
  const problem = nameProblem(name);
  if (problem !== undefined) throw new CliError('usage', `cli.name.${problem}`, { name });
  const number = chooseNumber(used, lastOf(args, 'number'), lastOf(args, 'series'));

  const shippedFile = (name: string): string | undefined => {
    const path = assetFile(name, from);
    return path === undefined ? undefined : readFileSync(path, 'utf8');
  };
  const guide = shippedFile('init/guide.md');
  if (guide === undefined) throw new CliError('content', 'doc.init.noGuide');
  const specs: Record<string, string> = {};
  for (const spec of SPECS) {
    const text = shippedFile(`init/spec/${spec}`);
    if (text !== undefined) specs[spec] = text;
  }
  const shipped: Shipped = { guide, specs, theme: shippedFile('theme.css') };

  const paths = documentPaths(undefined, name);
  const candidates = [
    paths.document, paths.revision, 'docs/assets/.gitkeep', 'shared/glossary.table',
    '.docpresenter/guide.md', ...SPECS.map(spec => `.docpresenter/spec/${spec}`),
    TEMPLATE_DOCUMENT, TEMPLATE_REVISION, TEAM_THEME, 'CLAUDE.md', 'AGENTS.md', '.gitignore',
  ];
  const existing = new Map<string, string>();
  for (const path of candidates) {
    try { existing.set(path, readFileSync(join(root, path), 'utf8')); } catch { /* 無い */ }
  }
  const plan = planScaffold({
    name, title, number, today: localDate(new Date()), outDir: DEFAULT_OUT, locale: ctx.locale,
  }, shipped, path => existing.get(path));
  const own = new Set([paths.document, paths.revision]);
  const files = plan.files.filter(file => firstDocument || !own.has(file.path));
  const kept = plan.kept.filter(path => firstDocument || !own.has(path));

  for (const file of files) {
    const at = join(root, file.path);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, file.mode === 'append' ? `${existing.get(file.path) ?? ''}${file.text}` : file.text);
  }
  const made = files.filter(file => file.mode === 'create').map(file => file.path);
  const appended = files.filter(file => file.mode === 'append').map(file => file.path);
  const document = firstDocument && made.includes(plan.document) ? plan.document : undefined;
  if (ctx.json) {
    console.log(JSON.stringify({ document: document ?? null, number: document ? number : null, made, appended, kept }, null, 2));
    return 0;
  }
  for (const path of made) ctx.progress(d('doc.init.made', { path }));
  for (const path of appended) ctx.progress(d('doc.init.appended', { path }));
  for (const path of kept) ctx.progress(d('doc.init.kept', { path }));
  const counts = { made: made.length, appended: appended.length, kept: kept.length };
  ctx.say(document === undefined
    ? d('doc.init.doneNoDocument', counts)
    : d('doc.init.done', { ...counts, document, number }));
  return 0;
}

/**
 * `docpresenter new doc <file>`: a document and its revision history from the
 * workspace's templates (`.docpresenter/templates/`) or the shipped ones,
 * with a number no other document has.
 */
export function newDocumentCommand(ctx: Context, args: ParsedArgs, root: string, given: string | undefined): number {
  const d = DOC_MESSAGES.in(ctx.locale);
  const target = newFile(given, root, 'md');
  const title = titleOf(args);
  const number = chooseNumber(numbersInUse(root), lastOf(args, 'number'), lastOf(args, 'series'));
  const stem = target.path.replace(/\.md$/i, '');
  const folder = stem.includes('/') ? stem.slice(0, stem.lastIndexOf('/')) : '';
  const read = (path: string): string | undefined => {
    try { return readFileSync(join(root, path), 'utf8'); } catch { return undefined; }
  };
  const made = documentFiles({
    name: stem.slice(stem.lastIndexOf('/') + 1), folder, title, number, today: localDate(new Date()),
    locale: ctx.locale, glossary: existsSync(join(root, 'shared/glossary.table')),
  }, { document: read(TEMPLATE_DOCUMENT), revision: read(TEMPLATE_REVISION) });
  const written: string[] = [];
  for (const file of made) {
    // Never over what is there: a revision file may be left from a document that was deleted.
    const at = join(root, file.path);
    if (existsSync(at)) continue;
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, file.text);
    written.push(file.path);
  }
  if (ctx.json) console.log(JSON.stringify({ document: made[0]!.path, number, made: written }, null, 2));
  else ctx.say(d('doc.new.made', { path: made[0]!.path, number }));
  return 0;
}
