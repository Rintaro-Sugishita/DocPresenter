// What every command runs with: the language, how much to say, and where.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isLocale, pickLocale, say, type Locale, type Translate } from '@docpresenter/base';
import { lastOf, type ParsedArgs } from './args.js';
import { CliError } from './errors.js';
import { CLI_MESSAGES, type CliMessage } from './messages.js';

/** The options every command takes. */
export const COMMON_FLAGS = ['quiet', 'json', 'help', 'version'] as const;
export const COMMON_OPTIONS = ['root', 'lang'] as const;
export const COMMON_SHORT = { q: 'quiet', h: 'help', v: 'version' } as const;

export interface Context {
  readonly locale: Locale;
  readonly quiet: boolean;
  readonly json: boolean;
  /** The command line's own words. */
  readonly t: Translate<CliMessage>;
  /** Progress: said unless --quiet or --json. */
  readonly progress: (line: string) => void;
  /** Findings and summaries: said unless --json. */
  readonly say: (line: string) => void;
  /** What went wrong: always said, on stderr. */
  readonly fail: (line: string) => void;
}

/**
 * The language: `--lang`, else this machine's (`LC_ALL`, `LC_MESSAGES`, `LANG`,
 * then the system's), the rule the build's own command line already follows.
 */
export function localeOf(asked: string | undefined): Locale {
  if (asked !== undefined) {
    if (!isLocale(asked)) throw new CliError('usage', 'cli.badLang', { value: asked });
    return asked;
  }
  return pickLocale([
    process.env['LC_ALL'], process.env['LC_MESSAGES'], process.env['LANG'],
    Intl.DateTimeFormat().resolvedOptions().locale,
  ].filter((tag): tag is string => Boolean(tag)));
}

export function contextOf(args: ParsedArgs, locale: Locale, write = (line: string) => console.log(line)): Context {
  const quiet = args.flags.has('quiet');
  const json = args.flags.has('json');
  return {
    locale, quiet, json,
    t: CLI_MESSAGES.in(locale),
    progress: line => { if (!quiet && !json) write(line); },
    say: line => { if (!json) write(line); },
    fail: line => console.error(line),
  };
}

/** The message of a refusal, in the run's language, whichever catalogue declared it. */
export function describeCliError(error: CliError, locale: Locale): string {
  return say(locale, { id: error.id, params: error.params });
}

/**
 * A file the command carries with it (the theme, the measuring script). Beside
 * the bundle when installed; in the package's `media/` when run from `dist/`.
 */
export function assetFile(name: string, from: string): string | undefined {
  for (const where of [`./${name}`, `../media/${name}`]) {
    const path = fileURLToPath(new URL(where, from));
    if (existsSync(path)) return path;
  }
  return undefined;
}

/** The version in the package.json above the running file. */
export function versionOf(from: string): string {
  try {
    return (JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', from)), 'utf8')) as { version?: string })
      .version ?? '';
  } catch { return ''; }
}
