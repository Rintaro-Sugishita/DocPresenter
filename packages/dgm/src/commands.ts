// The drawing commands: export, check, format. docpresenter runs the same ones
// for the .dgm files it is pointed at.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describeError, say } from '@docpresenter/base';
import {
  drawingProblems, formatDiagram, starterDiagram, type DiagramFile, type DrawingProblem,
} from '@docpresenter/diagram';
import type { Context } from './context.js';
import { assetFile } from './context.js';
import { Painter, readDrawing, svgOf, type PngOptions } from './drawing.js';
import { CliError } from './errors.js';
import { outputFile, type OutputPlan } from './output.js';
import type { Target } from './workspace.js';

export const DRAWING_FORMATS = ['svg', 'png'] as const;
export const isDrawing = (path: string): boolean => /\.dgm$/i.test(path);

/** Refuses a format nobody can write. */
export function refuseUnknownFormats(asked: readonly string[], known: readonly string[]): void {
  for (const format of asked) {
    if (!known.includes(format)) {
      throw new CliError('usage', 'cli.unknownFormat', { format, known: known.join(', ') });
    }
  }
}

/** One file to write. */
export interface Job {
  readonly target: Target;
  readonly format: string;
  readonly file: string;
}

/**
 * The drawings' exports. With `--to`, the formats asked that a drawing can be;
 * a drawing named on the command line that can be none of them is a mistake,
 * one found in a folder is just not one of the files meant. Without `--to`, SVG.
 */
export function drawingJobs(targets: readonly Target[], asked: readonly string[], plan: OutputPlan): Job[] {
  const jobs: Job[] = [];
  for (const target of targets) {
    if (!isDrawing(target.path)) continue;
    const formats = asked.length === 0 ? ['svg'] : asked.filter(format => (DRAWING_FORMATS as readonly string[]).includes(format));
    if (formats.length === 0 && target.named) {
      throw new CliError('usage', 'cli.formatMismatch', {
        path: target.path, format: asked.join(', '), allowed: DRAWING_FORMATS.join(', '),
      });
    }
    for (const format of formats) jobs.push({ target, format, file: outputFile(plan, target.path, format) });
  }
  return jobs;
}

/** The theme drawings are styled with: the workspace's own, else the one shipped. */
export function drawingTheme(root: string, from: string): string {
  for (const path of [join(root, '.docpresenter/themes/default/theme.css'), assetFile('theme.css', from)]) {
    if (path === undefined) continue;
    try { return readFileSync(path, 'utf8'); } catch { /* 次を当たる */ }
  }
  return '';
}

export interface Written {
  readonly source: string;
  readonly format: string;
  readonly file: string;
  readonly bytes: number;
}

/** Writes the drawings' jobs. A drawing that cannot be drawn is said and counted, and the rest go on. */
export async function exportDrawings(
  ctx: Context, root: string, jobs: readonly Job[],
  options: { readonly theme: string; readonly png: PngOptions; readonly chromium?: string | undefined },
): Promise<{ written: Written[]; failed: number }> {
  const written: Written[] = [];
  let failed = 0;
  const painter = new Painter(options.chromium);
  try {
    const drawings = new Map<string, DiagramFile>();
    const svgs = new Map<string, string>();
    const said = new Set<string>();
    for (const job of jobs) {
      const { target, format } = job;
      try {
        if (!drawings.has(target.path)) drawings.set(target.path, readDrawing(target.file));
        const drawing = drawings.get(target.path)!;
        // A library is parts to draw with, not a drawing.
        if (drawing.mode === 'parts') {
          if (!said.has(target.path)) ctx.progress(ctx.t('cli.parts', { path: target.path }));
          said.add(target.path);
          continue;
        }
        // An overlay is a screenshot with callouts: its picture is pixels, so it has no SVG of its own.
        if (drawing.mode === 'overlay' && format === 'svg') {
          ctx.progress(ctx.t('cli.overlaySvg', { path: target.path }));
          continue;
        }
        let bytes: Uint8Array;
        if (drawing.mode === 'overlay') {
          bytes = await painter.overlayPng(target.file, drawing, options.theme, ctx.locale, options.png);
        } else {
          if (!svgs.has(target.path)) svgs.set(target.path, svgOf(target.file, drawing, options.theme, ctx.locale));
          const svg = svgs.get(target.path)!;
          bytes = format === 'png' ? await painter.png(svg, options.png) : Buffer.from(svg, 'utf8');
        }
        mkdirSync(dirname(job.file), { recursive: true });
        writeFileSync(job.file, bytes);
        written.push({ source: target.path, format, file: job.file, bytes: bytes.length });
        ctx.progress(ctx.t('cli.wrote', {
          file: shown(root, job.file), source: target.path, format, size: Math.max(1, Math.round(bytes.length / 1024)),
        }));
      } catch (error) {
        if (error instanceof CliError) throw error;
        failed++;
        ctx.fail(ctx.t('cli.failed', { path: target.path, format, message: describeError(error, ctx.locale) }));
      }
    }
  } finally {
    await painter.close();
  }
  return { written, failed };
}

/** A file as the person typing knows it: from the root when inside it. */
export function shown(root: string, file: string): string {
  const from = relative(root, file);
  return (from.startsWith('..') ? file : from).split('\\').join('/');
}

/** A finding, wherever it came from. */
export interface Finding {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly id?: string;
}

/** The drawings' problems, as findings with lines and columns. */
export function checkDrawings(targets: readonly Target[], locale: Context['locale']): Finding[] {
  return targets.filter(target => isDrawing(target.path)).flatMap(target => {
    const source = readFileSync(target.file, 'utf8');
    const read = (used: string) => {
      try { return readFileSync(resolve(dirname(target.file), used), 'utf8'); } catch { return undefined; }
    };
    return drawingProblems(source, read, locale).map(problem => findingOf(target.path, source, problem));
  });
}

/**
 * Where a problem is, as `line:column`. Ranges are bytes of the text read as
 * LF; a CR only ever ends a line, so the line and column are the same in the
 * file as it is.
 */
export function findingOf(path: string, source: string, problem: DrawingProblem): Finding {
  const base = {
    path, severity: problem.severity, message: problem.message,
    ...(problem.id === undefined ? {} : { id: problem.id }),
  };
  if (problem.span !== undefined) {
    const before = Buffer.from(source.replace(/\r\n/g, '\n')).subarray(0, problem.span.start).toString('utf8');
    const lines = before.split('\n');
    return { ...base, line: lines.length, column: lines[lines.length - 1]!.length + 1 };
  }
  return problem.line === undefined ? base : { ...base, line: problem.line };
}

/** Prints findings as `path:line:column: severity: message`, sorted, and counts them. */
export function reportFindings(ctx: Context, findings: readonly Finding[]): { errors: number; warnings: number } {
  const sorted = [...findings].sort((a, b) => a.path.localeCompare(b.path)
    || (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0));
  for (const one of sorted) {
    const at = [one.path, one.line, one.line === undefined ? undefined : one.column].filter(part => part !== undefined).join(':');
    ctx.say(`${at}: ${ctx.t(`cli.label.${one.severity}`)}: ${one.message}`);
  }
  return {
    errors: findings.filter(one => one.severity === 'error').length,
    warnings: findings.filter(one => one.severity === 'warning').length,
  };
}

/** Writes a new drawing of the kind asked, from the starter every shell makes. */
export function newDrawing(ctx: Context, target: Target, kind: string | undefined): void {
  if (kind !== undefined && kind !== 'flow' && kind !== 'free') {
    throw new CliError('usage', 'cli.new.badKind', { value: kind });
  }
  mkdirSync(dirname(target.file), { recursive: true });
  writeFileSync(target.file, starterDiagram(kind ?? 'flow', ctx.locale));
  ctx.say(ctx.t('cli.new.made', { path: target.path }));
}

export interface FormatResult {
  readonly count: number;
  readonly changed: readonly string[];
  readonly failed: number;
}

/** Formats the drawings; writes only with `write`. */
export function formatDrawings(ctx: Context, targets: readonly Target[], write: boolean): FormatResult {
  const drawings = targets.filter(target => isDrawing(target.path));
  const changed: string[] = [];
  let failed = 0;
  for (const target of drawings) {
    const source = readFileSync(target.file, 'utf8');
    // Parts a drawing uses change its picture, so they are read as the build reads them.
    const read = (used: string) => {
      try { return readFileSync(resolve(dirname(target.file), used), 'utf8'); } catch { return undefined; }
    };
    let result;
    try {
      result = formatDiagram(source, read);
    } catch (error) {
      failed++;
      ctx.fail(`${target.path}: ${ctx.t('cli.label.error')}: ${describeError(error, ctx.locale)}`);
      continue;
    }
    for (const note of result.notes) ctx.say(`${target.path}: ${say(ctx.locale, note)}`);
    if (!result.changed) continue;
    changed.push(target.path);
    if (write) writeFileSync(target.file, result.text);
    ctx.say(ctx.t(write ? 'cli.format.formatted' : 'cli.format.needed', { path: target.path }));
  }
  ctx.say(ctx.t(write ? 'cli.format.summaryWrite' : 'cli.format.summary', {
    count: drawings.length, changed: changed.length, failed,
  }));
  return { count: drawings.length, changed, failed };
}
