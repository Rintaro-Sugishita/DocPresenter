// What a new table or a new drawing holds before the author writes anything.
//
// Every shell makes these files — where they go is the shell's business — but
// what is in them is the same everywhere, so it is here, in the language the
// editor is speaking.

import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';
import { displayWidth } from '@docpresenter/markdown';
import { EDITOR_MESSAGES } from './messages.js';
import type { ResourceKind } from './view/sheet-view.js';

/** The two ways a drawing is laid out: by its connections, or by hand. */
export type DiagramKind = 'flow' | 'free';

/**
 * A new drawing. A `flow` starts as a start, a step and an end joined up, laid
 * out from its connections; a `free` as one shape pinned where it stands.
 */
export function starterDiagram(kind: DiagramKind, locale: Locale = DEFAULT_LOCALE): string {
  const t = EDITOR_MESSAGES.in(locale);
  if (kind === 'free') {
    return `free {\n  a [${t('editor.starter.shape')}]\n}\n\nlayout {\n  a @ (40, 40) 160x60\n}\n`;
  }
  return [
    'flow {',
    `  begin  ([${t('editor.starter.begin')}])`,
    `  step1  [${t('editor.starter.step')}]`,
    `  finish ([${t('editor.starter.finish')}])`,
    '',
    '  begin --> step1',
    '  step1 --> finish',
    '}',
    '',
  ].join('\n');
}

export function starterResource(kind: ResourceKind, locale: Locale = DEFAULT_LOCALE): string {
  const t = EDITOR_MESSAGES.in(locale);
  if (kind === 'diagram') return starterDiagram('free', locale);
  // Two columns, lined up as the formatter would line them up, so the first
  // diff the author makes is their own words and not a re-alignment.
  const headings = [t('editor.starter.heading', { n: 1 }), t('editor.starter.heading', { n: 2 })];
  const row = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  return [
    row(headings),
    row(headings.map(heading => '-'.repeat(displayWidth(heading)))),
    row(headings.map(heading => ' '.repeat(displayWidth(heading)))),
    '',
  ].join('\n');
}
