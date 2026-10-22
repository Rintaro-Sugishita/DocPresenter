// Everything a build would find wrong, without building anything.
//
// A build stops at the first thing it needs and cannot have, and says only
// what the documents it was asked for ran into. A check reads the whole
// folder: every document that is built, every drawing and every table, whether
// or not anything includes them — the drawing nobody has put in a document yet
// is the one whose typo nobody would see. Nothing is written.

import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';
import { drawingProblems, unreadableProblem } from '@docpresenter/diagram';
import { joinPath, parseTable } from '@docpresenter/markdown';
import { prepare } from './build.js';
import { readGraph } from './graph.js';
import { asLf, type BuildDiagnostic, type Workspace } from './workspace.js';

export interface CheckOptions {
  readonly locale?: Locale;
}

export interface CheckResult {
  readonly diagnostics: readonly BuildDiagnostic[];
  /** How much was read, so "nothing wrong" can say what it is a claim about. */
  readonly documents: number;
  readonly drawings: number;
  readonly tables: number;
}

export function checkWorkspace(given: Workspace, options: CheckOptions = {}): CheckResult {
  const workspace = asLf(given);
  const locale = options.locale ?? DEFAULT_LOCALE;
  const graph = readGraph(workspace, locale);
  const found: BuildDiagnostic[] = [];

  // A part included by two documents is checked in each; it is still one
  // mistake, written once.
  const seen = new Set<string>();
  const add = (one: BuildDiagnostic): void => {
    const key = `${one.path}\0${one.span?.start ?? ''}\0${one.line ?? ''}\0${one.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(one);
  };
  for (const one of graph.diagnostics) add(one);

  for (const root of graph.roots) {
    for (const one of prepare(workspace, root, locale).diagnostics) add(one);
  }

  const paths = workspace.list();
  const drawings = paths.filter(path => /\.dgm$/i.test(path));
  const tables = paths.filter(path => /\.table$/i.test(path));
  for (const path of drawings) for (const one of checkDrawing(workspace, path, locale)) add(one);
  for (const path of tables) {
    const source = workspace.read(path);
    if (source === undefined) continue;
    try {
      parseTable(source);
    } catch (error) {
      add(unreadable(path, error, locale));
    }
  }

  return { diagnostics: found, documents: graph.roots.length, drawings: drawings.length, tables: tables.length };
}

/** A drawing's problems (`drawingProblems`), as the build's diagnostics. */
function checkDrawing(workspace: Workspace, path: string, locale: Locale): BuildDiagnostic[] {
  const source = workspace.read(path);
  if (source === undefined) return [];
  return drawingProblems(source, used => workspace.read(joinPath(path, used)), locale)
    .map(problem => ({ ...problem, path }));
}

function unreadable(path: string, error: unknown, locale: Locale): BuildDiagnostic {
  return { ...unreadableProblem(error, locale), path };
}
