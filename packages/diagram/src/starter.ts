// What a new drawing holds before the author writes anything.
//
// Every shell makes these files — the editor, VS Code, the command line — and
// the drawing side has to be able to make one alone, so it is here.

import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';
import { DIAGRAM_MESSAGES } from './messages.js';

/** The two ways a drawing is laid out: by its connections, or by hand. */
export type DiagramKind = 'flow' | 'free';

/**
 * A new drawing. A `flow` starts as a start, a step and an end joined up, laid
 * out from its connections; a `free` as one shape pinned where it stands.
 */
export function starterDiagram(kind: DiagramKind, locale: Locale = DEFAULT_LOCALE): string {
  const t = DIAGRAM_MESSAGES.in(locale);
  if (kind === 'free') {
    return `free {\n  a [${t('diagram.starter.shape')}]\n}\n\nlayout {\n  a @ (40, 40) 160x60\n}\n`;
  }
  return [
    'flow {',
    `  begin  ([${t('diagram.starter.begin')}])`,
    `  step1  [${t('diagram.starter.step')}]`,
    `  finish ([${t('diagram.starter.finish')}])`,
    '',
    '  begin --> step1',
    '  step1 --> finish',
    '}',
    '',
  ].join('\n');
}
