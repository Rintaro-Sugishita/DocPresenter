// The command line, read into what was asked.
//
// One reader for both commands (dgm, docpresenter): a subcommand, the paths it
// works on, and options. `--to svg,png`, `--to svg --to png`, `--to=svg` and
// `-t svg` all say the same thing. A name nobody knows is a mistake to point
// out, not something to skip: a misspelt `--wirte` that silently did nothing
// would leave the files as they were and say it had succeeded.

import { CliError } from './errors.js';

export interface ArgSpec {
  /** Options that stand alone (`--write`). */
  readonly flags: readonly string[];
  /** Options that take a value (`--out <dir>`). Each may be given more than once. */
  readonly options: readonly string[];
  /** One-letter names, to the long name they stand for. */
  readonly short?: Readonly<Record<string, string>>;
}

export interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly flags: ReadonlySet<string>;
  /** Every value an option was given, in order. */
  readonly options: ReadonlyMap<string, readonly string[]>;
}

export function parseArgs(argv: readonly string[], spec: ArgSpec): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Set<string>();
  const options = new Map<string, string[]>();
  const flagNames = new Set(spec.flags);
  const optionNames = new Set(spec.options);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('-') || arg === '-') {
      positionals.push(arg);
      continue;
    }
    let name: string;
    let value: string | undefined;
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      name = equals < 0 ? arg.slice(2) : arg.slice(2, equals);
      value = equals < 0 ? undefined : arg.slice(equals + 1);
    } else {
      const long = spec.short?.[arg.slice(1, 2)];
      if (long === undefined || (arg.length > 2 && !optionNames.has(long))) {
        throw new CliError('usage', 'cli.unknownOption', { option: arg });
      }
      name = long;
      value = arg.length > 2 ? arg.slice(2) : undefined;
    }

    if (flagNames.has(name)) {
      if (value !== undefined) throw new CliError('usage', 'cli.noValue', { option: `--${name}` });
      flags.add(name);
    } else if (optionNames.has(name)) {
      if (value === undefined) {
        const next = argv[i + 1];
        if (next === undefined || (next.startsWith('-') && next !== '-')) {
          throw new CliError('usage', 'cli.needsValue', { option: `--${name}` });
        }
        value = next;
        i++;
      }
      options.set(name, [...(options.get(name) ?? []), value]);
    } else {
      throw new CliError('usage', 'cli.unknownOption', { option: arg });
    }
  }
  return { positionals, flags, options };
}

/** The last value an option was given, or undefined. */
export function lastOf(args: ParsedArgs, name: string): string | undefined {
  const values = args.options.get(name);
  return values?.[values.length - 1];
}

/** Every value of a list option, split at commas, empty pieces dropped. */
export function listOf(args: ParsedArgs, name: string): string[] {
  return (args.options.get(name) ?? []).flatMap(value => value.split(',')).map(one => one.trim()).filter(Boolean);
}
