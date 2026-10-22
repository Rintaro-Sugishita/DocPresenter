// dgm: the drawing side's command line.
//
//   dgm export [<file|folder>...] [--to svg,png] [--out <dir>] [--flat]
//   dgm check  [<file|folder>...] [--strict]
//   dgm format [<file|folder>...] [--write] [--check]
//   dgm items  [<file|folder>...] [--write] [--check] [--create]
//   dgm new    <file> [--kind flow|free|screen]
//
// See design/build-model.md §6. Installed without the document side, it knows
// only drawings; docpresenter runs the same commands for the .dgm files it is
// pointed at.

import { lastOf, listOf, parseArgs, type ArgSpec, type ParsedArgs } from './args.js';
import {
  checkDrawings, DRAWING_FORMATS, drawingJobs, drawingTheme, exportDrawings, formatDrawings, isDrawing, newDrawing,
  refuseUnknownFormats, reportFindings, syncItemTables,
} from './commands.js';
import {
  COMMON_FLAGS, COMMON_OPTIONS, COMMON_SHORT, contextOf, describeCliError, localeOf, versionOf, type Context,
} from './context.js';
import type { PngOptions } from './drawing.js';
import { CliError, EXIT } from './errors.js';
import { outputPlan, refuseCollisions } from './output.js';
import { collectTargets, findRoot, newFile, type Target } from './workspace.js';

/** Every option of every command, so one reading of the line serves them all. */
export const DGM_SPEC: ArgSpec = {
  flags: [...COMMON_FLAGS, 'flat', 'strict', 'write', 'check', 'create'],
  options: [...COMMON_OPTIONS, 'to', 'out', 'scale', 'background', 'chromium', 'kind'],
  short: { ...COMMON_SHORT, t: 'to', o: 'out' },
};

/** What `export` writes PNGs with, from its options. */
export function pngOptionsOf(args: ParsedArgs): PngOptions {
  const scaleText = lastOf(args, 'scale') ?? '2';
  const scale = Number(scaleText);
  if (!Number.isFinite(scale) || scale <= 0) throw new CliError('usage', 'cli.badScale', { value: scaleText });
  return { scale, background: lastOf(args, 'background') ?? 'white' };
}

/** Runs `dgm` with the arguments after the command name; resolves to the exit code. */
export async function runDgm(argv: readonly string[], from: string): Promise<number> {
  let locale = localeOf(undefined);
  try {
    const args = parseArgs(argv, DGM_SPEC);
    locale = localeOf(lastOf(args, 'lang'));
    const ctx = contextOf(args, locale);
    if (args.flags.has('version')) { console.log(versionOf(from)); return EXIT.ok; }
    const [command, ...paths] = args.positionals;
    if (args.flags.has('help') || command === 'help') { console.log(ctx.t('cli.help.dgm')); return EXIT.ok; }
    if (command === undefined) throw new CliError('usage', 'cli.noCommand', { name: 'dgm' });

    const root = findRoot(lastOf(args, 'root'), paths);
    const targets = (): Target[] => {
      const found = collectTargets(paths, root, isDrawing);
      for (const target of found) {
        if (!isDrawing(target.path)) throw new CliError('usage', 'cli.notDrawing', { path: target.path });
      }
      return found;
    };
    switch (command) {
      case 'export': return await exportCommand(ctx, args, root, targets(), from);
      case 'check': return checkCommand(ctx, args, targets());
      case 'format': return formatCommand(ctx, args, targets());
      case 'items': return itemsCommand(ctx, args, targets());
      case 'new': {
        if (paths.length > 1) throw new CliError('usage', 'cli.new.onePath');
        newDrawing(ctx, newFile(paths[0], root, 'dgm'), lastOf(args, 'kind'));
        return EXIT.ok;
      }
      default: throw new CliError('usage', 'cli.unknownCommand', { command, name: 'dgm' });
    }
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    console.error(describeCliError(error, locale));
    return error.kind === 'usage' ? EXIT.usage : EXIT.content;
  }
}

async function exportCommand(ctx: Context, args: ParsedArgs, root: string, targets: readonly Target[], from: string): Promise<number> {
  const asked = listOf(args, 'to');
  refuseUnknownFormats(asked, DRAWING_FORMATS);
  const plan = outputPlan(root, lastOf(args, 'out'), args.flags.has('flat'));
  const jobs = drawingJobs(targets, asked, plan);
  refuseCollisions(jobs.map(job => ({ source: job.target.path, file: job.file })));
  if (jobs.length === 0) { ctx.say(ctx.t('cli.nothing')); return EXIT.ok; }
  const result = await exportDrawings(ctx, root, jobs, {
    theme: drawingTheme(root, from), png: pngOptionsOf(args), chromium: lastOf(args, 'chromium'),
  });
  if (ctx.json) console.log(JSON.stringify({ written: result.written, failed: result.failed }, null, 2));
  else ctx.say(ctx.t('cli.exportSummary', { written: result.written.length, failed: result.failed }));
  return result.failed > 0 ? EXIT.content : EXIT.ok;
}

function checkCommand(ctx: Context, args: ParsedArgs, targets: readonly Target[]): number {
  const findings = checkDrawings(targets, ctx.locale);
  const { errors, warnings } = reportFindings(ctx, findings);
  if (ctx.json) console.log(JSON.stringify(findings, null, 2));
  else ctx.say(ctx.t('cli.checkDrawings', { drawings: targets.length, errors, warnings }));
  return errors > 0 || (args.flags.has('strict') && warnings > 0) ? EXIT.content : EXIT.ok;
}

function itemsCommand(ctx: Context, args: ParsedArgs, targets: readonly Target[]): number {
  // Making a table is writing one, so `--create` writes.
  const create = args.flags.has('create');
  const write = args.flags.has('write') || create;
  const result = syncItemTables(ctx, targets, write, create);
  if (ctx.json) console.log(JSON.stringify(result, null, 2));
  return result.failed > 0 || (args.flags.has('check') && !write && result.changed.length > 0)
    ? EXIT.content : EXIT.ok;
}

function formatCommand(ctx: Context, args: ParsedArgs, targets: readonly Target[]): number {
  const write = args.flags.has('write');
  const result = formatDrawings(ctx, targets, write);
  if (ctx.json) console.log(JSON.stringify(result, null, 2));
  return result.failed > 0 || (args.flags.has('check') && !write && result.changed.length > 0)
    ? EXIT.content : EXIT.ok;
}
