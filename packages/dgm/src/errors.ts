// A command line that cannot go on, and why.

import type { Params } from '@docpresenter/base';

/**
 * `usage`: what was asked does not make sense (exit code 2). `content`: it
 * does, but the files say no (exit code 1). The id is a message of the command
 * line's catalogue, or of docpresenter's own.
 */
export class CliError extends Error {
  constructor(
    readonly kind: 'usage' | 'content',
    readonly id: string,
    readonly params: Params = {},
  ) {
    super(id);
  }
}

export const EXIT = { ok: 0, content: 1, usage: 2 } as const;
