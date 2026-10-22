// Where an export goes.
//
// Under `out/build/` at the root unless `--out` says otherwise, in the same
// folders as the source: `docs/order/design.md` → `out/build/docs/order/design.pdf`,
// the rule VS Code and the web page write by too (`outputStem` in the build).
// `--flat` puts every file straight in the folder. Two sources that would land
// on one name stop the run before anything is written: one would silently
// replace the other.

import { basename, join, resolve } from 'node:path';
import { CliError } from './errors.js';

/** The folder exports go in when `--out` is not given, from the root. */
export const DEFAULT_OUT = 'out/build';

export interface OutputPlan {
  /** Absolute. */
  readonly folder: string;
  readonly flat: boolean;
}

export function outputPlan(root: string, out: string | undefined, flat: boolean, cwd = process.cwd()): OutputPlan {
  return { folder: out === undefined ? join(root, DEFAULT_OUT) : resolve(cwd, out), flat };
}

/** Where the export of `path` (from the root) in `format` is written. */
export function outputFile(plan: OutputPlan, path: string, format: string): string {
  const stem = path.replace(/^\.?\/+/, '').replace(/\.[^./]+$/, '');
  return join(plan.folder, `${plan.flat ? basename(stem) : stem}.${format}`);
}

/** Refuses a plan in which two sources write one file. */
export function refuseCollisions(planned: readonly { readonly source: string; readonly file: string }[]): void {
  const seen = new Map<string, string>();
  for (const one of planned) {
    const key = process.platform === 'win32' || process.platform === 'darwin' ? one.file.toLowerCase() : one.file;
    const before = seen.get(key);
    if (before !== undefined && before !== one.source) {
      throw new CliError('usage', 'cli.collision', { first: before, second: one.source, file: one.file });
    }
    seen.set(key, one.source);
  }
}
