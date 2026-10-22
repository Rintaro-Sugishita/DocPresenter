// docpresenter: the document side's command line.
//
//   docpresenter export [<file|folder>...] [--to <format>,...] [--out <dir>] [--flat]
//   docpresenter check  [<file|folder>...] [--strict]
//   docpresenter format [<file|folder>...] [--write] [--check]
//   docpresenter import <file.pptx|file.pdf>... [--write] [--into <review file>]
//   docpresenter init   --title <title> [--name <name>] [--number <n> | --series <prefix>]
//   docpresenter new doc <file> --title <title> [--number <n> | --series <prefix>]
//   docpresenter new diagram <file> [--kind flow|free]
//
// See design/build-model.md §6. The .dgm files it is pointed at go through the
// drawing side's own commands (@docpresenter/dgm), so `docpresenter export a.dgm`
// and `dgm export a.dgm` write the same file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  build, checkWorkspace, readGraph, themeOf, writeBack, type BuildDiagnostic, type BuildOptions, type Workspace,
} from '@docpresenter/build';
import {
  CliError, collectTargets, COMMON_FLAGS, COMMON_OPTIONS, COMMON_SHORT, contextOf, describeCliError,
  DRAWING_FORMATS, drawingJobs, drawingTheme, EXIT, exportDrawings, findingOf, findRoot, formatDrawings, isDrawing, newDrawing, newFile,
  lastOf, listOf, localeOf, outputFile, outputPlan, parseArgs, pngOptionsOf, refuseCollisions, refuseUnknownFormats,
  reportFindings, shown, versionOf, type ArgSpec, type Context, type Finding, type Job, type OutputPlan, type ParsedArgs,
  type Target,
} from '@docpresenter/dgm';
import {
  appendReplies, appendReview, planImport, readReviewPdf, resolveAnnotations, type PdfReply,
} from '@docpresenter/pdf';
import { pdfFonts } from './fonts.js';
import { DOC_MESSAGES } from './messages.js';
import { gitState, nodeWorkspace, previousVersion } from './node-workspace.js';
import { asset, openMermaidPainter, openPdfWriter, type PdfWriter } from './pdf.js';
import { initCommand, newDocumentCommand } from './setup.js';

export const DOCUMENT_FORMATS = ['html', 'pdf', 'pptx'] as const;
const isDocument = (path: string): boolean => /\.md$/i.test(path);

export const DOC_SPEC: ArgSpec = {
  flags: [...COMMON_FLAGS, 'flat', 'strict', 'write', 'check', 'no-review-notes'],
  options: [
    ...COMMON_OPTIONS, 'to', 'out', 'scale', 'background', 'chromium', 'font',
    'diff-from', 'show-removed', 'into', 'title', 'name', 'number', 'series', 'kind',
  ],
  short: { ...COMMON_SHORT, t: 'to', o: 'out' },
};

/** Runs `docpresenter` with the arguments after the command name; resolves to the exit code. */
export async function runDocpresenter(argv: readonly string[], from: string): Promise<number> {
  let locale = localeOf(undefined);
  try {
    const args = parseArgs(argv, DOC_SPEC);
    locale = localeOf(lastOf(args, 'lang'));
    const ctx = contextOf(args, locale);
    const d = DOC_MESSAGES.in(locale);
    if (args.flags.has('version')) { console.log(versionOf(from)); return EXIT.ok; }
    const [command, ...paths] = args.positionals;
    if (args.flags.has('help') || command === 'help') { console.log(d('doc.help')); return EXIT.ok; }
    if (command === undefined) throw new CliError('usage', 'cli.noCommand', { name: 'docpresenter' });
    if (command === 'init') {
      if (paths.length > 0) throw new CliError('usage', 'doc.init.noPaths');
      return initCommand(ctx, args, findRoot(lastOf(args, 'root'), []), from);
    }
    if (command === 'new') {
      // `new doc <file>` / `new diagram <file>`: the root is found from where the file goes.
      const [what, file, ...more] = paths;
      if (more.length > 0) throw new CliError('usage', 'cli.new.onePath');
      const root = findRoot(lastOf(args, 'root'), file === undefined ? [] : [dirname(resolve(file))]);
      if (what === 'doc') return newDocumentCommand(ctx, args, root, file);
      if (what === 'diagram') { newDrawing(ctx, newFile(file, root, 'dgm'), lastOf(args, 'kind')); return EXIT.ok; }
      throw new CliError('usage', 'doc.new.what');
    }
    const root = findRoot(lastOf(args, 'root'), paths);
    switch (command) {
      case 'export': return await exportCommand(ctx, args, root, paths, from);
      case 'check': return checkCommand(ctx, args, root, paths);
      case 'format': return formatCommand(ctx, args, root, paths);
      case 'import': return await importCommand(ctx, args, root, paths);
      default: throw new CliError('usage', 'cli.unknownCommand', { command, name: 'docpresenter' });
    }
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    console.error(describeCliError(error, locale));
    return error.kind === 'usage' ? EXIT.usage : EXIT.content;
  }
}

/** The documents and drawings named; anything else named directly is a mistake. */
function targetsOf(paths: readonly string[], root: string): Target[] {
  const targets = collectTargets(paths, root, path => isDocument(path) || isDrawing(path));
  for (const target of targets) {
    if (!isDocument(target.path) && !isDrawing(target.path)) {
      throw new CliError('usage', 'doc.unsupported', { path: target.path });
    }
  }
  return targets;
}

// ---- export ----------------------------------------------------------------

async function exportCommand(
  ctx: Context, args: ParsedArgs, root: string, paths: readonly string[], from: string,
): Promise<number> {
  const d = DOC_MESSAGES.in(ctx.locale);
  const asked = listOf(args, 'to');
  refuseUnknownFormats(asked, [...DOCUMENT_FORMATS, ...DRAWING_FORMATS]);
  const showRemoved = lastOf(args, 'show-removed');
  if (showRemoved !== undefined && showRemoved !== 'none' && showRemoved !== 'strike') {
    throw new CliError('usage', 'doc.badShowRemoved', { value: showRemoved });
  }
  const plan = outputPlan(root, lastOf(args, 'out'), args.flags.has('flat'));
  const targets = targetsOf(paths, root);
  const workspace = nodeWorkspace(root, (address, bytes) =>
    ctx.progress(d('doc.fetched', { address, size: Math.max(1, Math.round(bytes / 1024)) })));

  // Which documents, in which formats. From a folder only the roots — a part
  // such as a revision history is not a deliverable; one named is built even
  // without an `output:`, when --to says what to make of it.
  const graph = readGraph(workspace, ctx.locale);
  const roots = new Map(graph.roots.map(one => [one.path, one]));
  const documentAsked = asked.filter(format => (DOCUMENT_FORMATS as readonly string[]).includes(format));
  const documentJobs: Job[] = [];
  const documents: string[] = [];
  for (const target of targets.filter(one => isDocument(one.path))) {
    const rootDocument = roots.get(target.path);
    if (!target.named && rootDocument === undefined) continue;
    if (target.named && asked.length > 0 && documentAsked.length === 0) {
      throw new CliError('usage', 'cli.formatMismatch', {
        path: target.path, format: asked.join(', '), allowed: DOCUMENT_FORMATS.join(', '),
      });
    }
    const formats = asked.length > 0 ? documentAsked : rootDocument?.formats ?? [];
    if (target.named && formats.length === 0) throw new CliError('usage', 'doc.noOutput', { path: target.path });
    if (formats.length === 0) continue;
    documents.push(target.path);
    for (const format of formats) documentJobs.push({ target, format, file: outputFile(plan, target.path, format) });
  }
  // Drawings already go into the documents. Found in a folder, one is exported
  // on its own only when --to asks for a picture; named, always.
  const drawingAsked = asked.some(format => (DRAWING_FORMATS as readonly string[]).includes(format));
  const drawings = drawingJobs(targets.filter(one => one.named || drawingAsked), asked, plan);
  refuseCollisions([...documentJobs, ...drawings].map(job => ({ source: job.target.path, file: job.file })));
  if (documentJobs.length === 0 && drawings.length === 0) { ctx.say(ctx.t('cli.nothing')); return EXIT.ok; }

  let failed = 0;
  const written: { source: string; format: string; file: string; bytes: number }[] = [];
  if (documentJobs.length > 0) {
    const result = await exportDocuments(ctx, args, root, workspace, documents,
      asked.length > 0 ? documentAsked : undefined, documentJobs, plan, from, showRemoved as 'none' | 'strike' | undefined);
    written.push(...result.written);
    failed += result.failed;
  }
  if (drawings.length > 0) {
    const result = await exportDrawings(ctx, root, drawings, {
      theme: drawingTheme(root, from), png: pngOptionsOf(args), chromium: lastOf(args, 'chromium'),
    });
    written.push(...result.written);
    failed += result.failed;
  }
  if (ctx.json) console.log(JSON.stringify({ written, failed }, null, 2));
  else ctx.say(ctx.t('cli.exportSummary', { written: written.length, failed }));
  return failed > 0 ? EXIT.content : EXIT.ok;
}

async function exportDocuments(
  ctx: Context, args: ParsedArgs, root: string, workspace: Workspace, only: readonly string[],
  formats: readonly string[] | undefined, jobs: readonly Job[], plan: OutputPlan, from: string,
  showRemoved: 'none' | 'strike' | undefined,
): Promise<{ written: { source: string; format: string; file: string; bytes: number }[]; failed: number }> {
  const d = DOC_MESSAGES.in(ctx.locale);
  const wants = (format: string) => jobs.some(job => job.format === format);
  const chromiumPath = lastOf(args, 'chromium');
  let failed = 0;

  // Mermaid is drawn by the page itself, so only pages with a Mermaid block
  // carry the script; a slide needs it drawn as a picture, here.
  const hasMermaid = workspace.list().some(path => /\.(mmd|mermaid)$/i.test(path)
    || (isDocument(path) && /^ {0,3}(`{3,}|~{3,})\s*mermaid/m.test(workspace.read(path) ?? '')));
  const script = hasMermaid ? readFileSync(asset('mermaid-page.js', from), 'utf8') : undefined;

  // A machine with no browser or no Japanese font can still write the HTML
  // and the PPTX. Saying why the PDF is missing, and failing the run, beats
  // both stopping everything and quietly leaving one format out.
  let pdf: PdfWriter | undefined;
  if (wants('pdf')) {
    try {
      pdf = await openPdfWriter({ from, chromium: chromiumPath, fonts: pdfFonts(lastOf(args, 'font')), mermaidScript: script });
    } catch (error) {
      if (error instanceof CliError && error.kind === 'usage') throw error;
      ctx.fail(d('doc.noPdf', { message: error instanceof CliError ? describeCliError(error, ctx.locale) : String((error as Error).message) }));
      failed += jobs.filter(job => job.format === 'pdf').length;
    }
  }
  let painter: Awaited<ReturnType<typeof openMermaidPainter>> | undefined;
  if (script !== undefined && wants('pptx')) {
    try {
      painter = await openMermaidPainter(chromiumPath, script);
    } catch (error) {
      ctx.progress(d('doc.noMermaid', { message: error instanceof CliError ? describeCliError(error, ctx.locale) : String((error as Error).message) }));
    }
  }

  const diffFrom = lastOf(args, 'diff-from');
  const git = gitState(root);
  const options: BuildOptions = {
    locale: ctx.locale,
    only,
    ...(formats === undefined ? {} : { formats: pdf ? formats : formats.filter(one => one !== 'pdf') }),
    outDir: 'out/build',
    ...(pdf ? { writers: { pdf: pdf.write } } : {}),
    ...(script ? { mermaidScript: script } : {}),
    ...(painter ? { mermaidPicture: painter.picture } : {}),
    // The workspace's own theme wins; otherwise the one shipped.
    style: theme => themeOf(path => workspace.read(path), theme)
      ?? (theme === 'default' ? drawingTheme(root, from) || undefined : undefined),
    ...(diffFrom === undefined ? {} : { diffFrom: previousVersion(root, diffFrom) }),
    ...(showRemoved === undefined ? {} : { showRemoved }),
    ...(git.commit === undefined ? {} : { commit: git.commit }),
    ...(git.clean === undefined ? {} : { clean: git.clean }),
    reviewNotes: !args.flags.has('no-review-notes'),
    builtAt: new Date().toISOString(),
  };

  const written: { source: string; format: string; file: string; bytes: number }[] = [];
  try {
    const result = await build(workspace, options);
    const findings = result.diagnostics.map(one => findingOfBuild(workspace, one));
    const { errors } = reportFindings(ctx, findings.filter(one => one.severity !== 'info'));
    if (errors > 0) failed += errors;
    for (const artifact of result.artifacts) {
      // Where the build would put it is its own convention; where it goes is ours.
      const file = outputFile(plan, artifact.root, artifact.format);
      const body = artifact.bytes ?? Buffer.from(artifact.text ?? '', 'utf8');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, body);
      written.push({ source: artifact.root, format: artifact.format, file, bytes: body.length });
      const report = artifact.format === 'pdf' ? pdf?.reports.get(artifact.root) : undefined;
      const comma = ctx.locale === 'ja' ? '、' : ', ';
      const extra = report === undefined ? '' : comma + d('doc.pdfReport', { pages: report.pages, font: report.font })
        + (report.missing > 0 ? comma + d('doc.missingGlyphs', { count: report.missing }) : '');
      ctx.progress(ctx.t('cli.wrote', {
        file: shown(root, file), source: artifact.root, format: artifact.format + extra,
        size: Math.max(1, Math.round(body.length / 1024)),
      }));
    }
  } finally {
    await pdf?.close();
    await painter?.close();
  }
  return { written, failed };
}

/** A build diagnostic as a finding, with the line and column the build's byte range is at. */
function findingOfBuild(workspace: Workspace, one: BuildDiagnostic): Finding {
  const severity = one.id === 'build.orphan' ? 'info' : one.severity;
  if (!one.path) return { path: '', severity, message: one.message, ...(one.id ? { id: one.id } : {}) };
  const source = workspace.read(one.path) ?? '';
  const found = findingOf(one.path, source, {
    severity, message: one.message,
    ...(one.id === undefined ? {} : { id: one.id }),
    ...(one.span === undefined ? {} : { span: one.span }),
    ...(one.line === undefined ? {} : { line: one.line }),
  });
  if (found.line !== undefined) return found;
  // A document-wide finding (its number, say) points at the frontmatter line it is about.
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const numbered = lines[0] === '---' ? lines.slice(0, lines.indexOf('---', 1)).findIndex(l => /^document\s*:/.test(l)) : -1;
  return { ...found, line: numbered >= 0 ? numbered + 1 : 1 };
}

// ---- check -----------------------------------------------------------------

function checkCommand(ctx: Context, args: ParsedArgs, root: string, paths: readonly string[]): number {
  const d = DOC_MESSAGES.in(ctx.locale);
  const workspace = nodeWorkspace(root);
  const result = checkWorkspace(workspace, { locale: ctx.locale });
  let findings = result.diagnostics.map(one => findingOfBuild(workspace, one));
  let counts = { documents: result.documents, drawings: result.drawings, tables: result.tables };
  if (paths.length > 0) {
    // The whole workspace is read — a reference is broken or not only against
    // all of it — and what is said is narrowed to the files named.
    const targets = collectTargets(paths, root, () => true);
    const named = new Set(targets.map(one => one.path));
    findings = findings.filter(one => named.has(one.path));
    const roots = new Set(readGraph(workspace, ctx.locale).roots.map(one => one.path));
    counts = {
      documents: targets.filter(one => roots.has(one.path)).length,
      drawings: targets.filter(one => isDrawing(one.path)).length,
      tables: targets.filter(one => /\.table$/i.test(one.path)).length,
    };
  }
  const { errors, warnings } = reportFindings(ctx, findings);
  if (ctx.json) console.log(JSON.stringify(findings, null, 2));
  else ctx.say(d('doc.checked', { ...counts, errors, warnings }));
  return errors > 0 || (args.flags.has('strict') && warnings > 0) ? EXIT.content : EXIT.ok;
}

// ---- format ----------------------------------------------------------------

function formatCommand(ctx: Context, args: ParsedArgs, root: string, paths: readonly string[]): number {
  const targets = collectTargets(paths, root, isDrawing);
  for (const target of targets) {
    if (!isDrawing(target.path)) throw new CliError('usage', 'cli.notDrawing', { path: target.path });
  }
  const write = args.flags.has('write');
  const result = formatDrawings(ctx, targets, write);
  if (ctx.json) console.log(JSON.stringify(result, null, 2));
  return result.failed > 0 || (args.flags.has('check') && !write && result.changed.length > 0)
    ? EXIT.content : EXIT.ok;
}

// ---- import ----------------------------------------------------------------

async function importCommand(ctx: Context, args: ParsedArgs, root: string, paths: readonly string[]): Promise<number> {
  if (paths.length === 0) throw new CliError('usage', 'doc.import.nothing');
  const files = paths.map(path => resolve(path));
  for (const [i, file] of files.entries()) {
    if (!existsSync(file)) throw new CliError('usage', 'cli.pathMissing', { path: paths[i]! });
    if (!/\.(pptx|pdf)$/i.test(file)) throw new CliError('usage', 'doc.import.unsupported', { path: paths[i]! });
  }
  const write = args.flags.has('write');
  let changes = 0;
  for (const deck of files.filter(file => /\.pptx$/i.test(file))) changes += importDeck(ctx, root, deck, write);
  const pdfs = files.filter(file => /\.pdf$/i.test(file));
  if (pdfs.length > 0) changes += await importReviews(ctx, root, pdfs, lastOf(args, 'into'), write);
  if (!write && changes > 0) ctx.say(ctx.t('cli.dryRun'));
  return EXIT.ok;
}

/** Reads an edited deck back into the drawings it came from. */
function importDeck(ctx: Context, root: string, deck: string, write: boolean): number {
  const d = DOC_MESSAGES.in(ctx.locale);
  const workspace = nodeWorkspace(root);
  const result = writeBack(new Uint8Array(readFileSync(deck)), workspace, ctx.locale);
  reportFindings(ctx, result.diagnostics.map(one => findingOfBuild(workspace, one)));
  let changed = 0;
  for (const file of result.files) {
    if (file.text === file.source) { ctx.say(d('doc.import.unchanged', { path: file.path })); continue; }
    changed++;
    ctx.say(d('doc.import.changed', { path: file.path, changes: file.changes.join(ctx.locale === 'ja' ? '、' : ', ') }));
    if (write) writeFileSync(join(root, file.path), file.text);
    else for (const line of changedLines(file.source, file.text)) ctx.say(`    ${line}`);
  }
  return changed;
}

/**
 * Takes reviewers' PDF annotations into review files: replies under the
 * comments they answer, new comments appended to one review file.
 */
async function importReviews(
  ctx: Context, root: string, pdfs: readonly string[], intoGiven: string | undefined, write: boolean,
): Promise<number> {
  const d = DOC_MESSAGES.in(ctx.locale);
  const stem = pdfs.length === 1 ? basename(pdfs[0]!).replace(/\.pdf$/i, '') : 'review';
  const into = intoGiven ?? `reviews/${new Date().toISOString().slice(0, 10)}-${stem}.review.yml`;
  const line = (text: string) => text.replace(/\s+/g, ' ').slice(0, 80);

  const reads = [];
  for (const pdf of pdfs) {
    const review = await readReviewPdf(new Uint8Array(readFileSync(pdf)));
    const plan = planImport(resolveAnnotations(review), review.map?.written);
    const name = shown(root, pdf);
    reads.push({ pdf: name, review, plan });
    ctx.say(review.map
      ? d('doc.import.pdf', { pdf: name, document: review.map.document, number: review.map.number ?? '—' })
      : d('doc.import.pdfNoMap', { pdf: name }));
    if (plan.ours) ctx.say(d('doc.import.ours', { count: plan.ours }));
    for (const [round, list] of plan.replies) {
      for (const reply of list) ctx.say(d('doc.import.reply', { round, id: reply.id, body: line(reply.body) }));
    }
    for (const one of plan.fresh) {
      const where = one.anchor ? `${one.anchor.file} ${one.anchor.start}–${one.anchor.end}` : d('doc.import.nowhere');
      ctx.say(`p.${one.annotation.page} ${one.annotation.kind}　[${one.precision}] ${where}`);
      if (one.anchor) ctx.say(`    「${line(one.anchor.quote)}」`);
      if (one.annotation.body) ctx.say(`    ${line(one.annotation.body)}`);
    }
  }

  let changes = 0;
  const replies = new Map<string, PdfReply[]>();
  for (const { plan } of reads) for (const [round, list] of plan.replies) replies.set(round, [...(replies.get(round) ?? []), ...list]);
  for (const [round, list] of replies) {
    const path = join(root, round);
    if (!existsSync(path)) { ctx.say(d('doc.import.noRound', { round, count: list.length })); continue; }
    const placed = appendReplies(readFileSync(path, 'utf8'), list);
    ctx.say(d('doc.import.replies', { round, added: placed.added, skipped: placed.skipped }));
    if (placed.added > 0) { changes++; if (write) writeFileSync(path, placed.text); }
  }

  const target = join(root, into);
  const before = existsSync(target) ? readFileSync(target, 'utf8') : undefined;
  let text = before;
  let added = 0;
  let skipped = 0;
  for (const { pdf, review, plan } of reads) {
    if (plan.fresh.length === 0) continue;
    const appended = appendReview(text, plan.fresh, {
      round: d('doc.import.round', { stem }),
      pdf,
      document: review.map?.document ?? pdf,
      number: review.map?.number,
      commit: review.map?.commit ?? review.commit,
      clean: review.map?.clean,
      path: into,
    });
    if (appended.added > 0) text = appended.text;
    added += appended.added;
    skipped += appended.skipped;
  }
  ctx.say(d('doc.import.added', { into, added, skipped }));
  if (added > 0 && text !== undefined) {
    changes++;
    if (write) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
    } else {
      ctx.say(text.slice((before ?? '').length));
    }
  }
  return changes;
}

/** The lines between the first and the last that differ, so what would be written can be read first. */
function changedLines(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return [...a.slice(head, a.length - tail).map(one => `- ${one}`), ...b.slice(head, b.length - tail).map(one => `+ ${one}`)];
}

