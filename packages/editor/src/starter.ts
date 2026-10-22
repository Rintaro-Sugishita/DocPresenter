// What a new table or a new drawing holds before the author writes anything.
//
// Every shell makes these files — where they go is the shell's business — but
// what is in them is the same everywhere, so it is here, in the language the
// editor is speaking. A drawing's own starter is the drawing side's
// (`@docpresenter/diagram`), which the command line uses without the editor.

import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';
import { starterDiagram } from '@docpresenter/diagram';
import { displayWidth } from '@docpresenter/markdown';
import { EDITOR_MESSAGES } from './messages.js';
import type { ResourceKind } from './view/sheet-view.js';

export { starterDiagram, type DiagramKind } from '@docpresenter/diagram';

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
