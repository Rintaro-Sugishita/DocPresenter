// What a control on a screen is showing: a check box ticked or not, an input
// that cannot be used, words in a typeface and size of their own.
//
// None of these is a shape of its own. A ticked box is the same check box in
// another state, and a table of check boxes ticks some rows and not others: so
// ticking one is changing that one shape's picture, never its column's. A
// control that cannot be used keeps its part — it is still a text box — and is
// drawn the way the screen's library says disabled things look, or greyed out
// when it says nothing.

import { described, type Edit } from '@docpresenter/base';
import { DiagramEditError, setNodePart, setNodeStyle } from './edits.js';
import { dgm } from './messages.js';
import type { DiagramFile } from './model.js';
import { parseDiagram } from './parse.js';

/** The pictures of a control that is off, and the one each turns into. */
const TURNED_ON: Readonly<Record<string, string>> = { 'ui/check': 'ui/check-on', 'ui/radio': 'ui/radio-on' };
const TURNED_OFF: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(TURNED_ON).map(([off, on]) => [on, off]));

/** Whether a shape is a check box or a radio button, and whether it is on. */
export function checkState(file: DiagramFile, id: string): 'on' | 'off' | undefined {
  const icon = file.style.get(id)?.get('icon') ?? '';
  return TURNED_OFF[icon] !== undefined ? 'on' : TURNED_ON[icon] !== undefined ? 'off' : undefined;
}

/**
 * Ticks a check box or a radio button, or clears it: this shape only. A shape
 * written as a part becomes the library's part with the other picture
 * (`checkbox` and `checked`); one with no such part, or with a picture of its
 * own, has its picture changed in the style section.
 */
export function toggleCheck(file: DiagramFile, source: string, id: string): Edit {
  const icon = file.style.get(id)?.get('icon') ?? '';
  const other = TURNED_ON[icon] ?? TURNED_OFF[icon];
  if (other === undefined) throw new DiagramEditError(dgm('diagram.check.notCheck', { id }));
  const own = parseDiagram(source);
  const turned = checkState(file, id) === 'on' ? 'diagram.did.uncheck' : 'diagram.did.check';
  if (file.partOf.has(id) && own.style.get(id)?.get('icon') === undefined) {
    const part = [...file.library.values()].find(one => one.style.get('icon') === other);
    if (part) return { ...setNodePart(file, source, id, part.name), ...described(dgm(turned)) };
  }
  return { ...setNodeStyle(own, source, id, { icon: other }), ...described(dgm(turned)) };
}

// --- enabled --------------------------------------------------------------

/** The words `enabled:` is turned off with. */
const OFF = new Set(['false', 'no', 'off', '0', 'none', '無効']);
/** What of the `disabled` part's style is a look; the rest (`item:`, a picture) is not given away. */
const LOOK = new Set(['fill', 'line', 'color', 'opacity', 'weight', 'font', 'font-size']);
/** How a disabled control looks when the library does not say: greyed out. */
const GREYED: ReadonlyMap<string, string> = new Map([['fill', '#f2f3f5'], ['line', '#c9cdd3'], ['color', '#9aa0a8']]);
/** A picture has its own colours, so it is faded instead. */
const FADED = '0.45';

/** Whether a shape is written as one that cannot be used (`enabled: false`). */
export function isDisabled(style: ReadonlyMap<string, string> | undefined): boolean {
  const value = style?.get('enabled');
  return value !== undefined && OFF.has(value.trim().toLowerCase());
}

/**
 * The drawing with each disabled shape given the disabled look: the
 * library's `disabled` part, laid over the shape's own colours, as the
 * `required` part is the look of the required mark. A picture is faded too,
 * unless that part says how far.
 */
export function withDisabled(diagram: DiagramFile): DiagramFile {
  if (!diagram.nodes.some(node => isDisabled(diagram.style.get(node.id)))) return diagram;
  const part = diagram.library.get('disabled');
  const look = part === undefined
    ? GREYED
    : new Map([...part.style].filter(([property]) => LOOK.has(property)));
  const style = new Map(diagram.style);
  for (const node of diagram.nodes) {
    const own = diagram.style.get(node.id);
    if (!isDisabled(own)) continue;
    const merged = new Map([...own!, ...look]);
    if (own!.has('icon') && !merged.has('opacity')) merged.set('opacity', FADED);
    style.set(node.id, merged);
  }
  return { ...diagram, style };
}

/**
 * Whether a shape is written as not shown (`visible: false`). It keeps its
 * room — a stack leaves the gap it would fill — and only the editor draws it,
 * faintly, so it can still be picked.
 */
export function isHidden(style: ReadonlyMap<string, string> | undefined): boolean {
  const value = style?.get('visible');
  return value !== undefined && OFF.has(value.trim().toLowerCase());
}

/** Hides a shape, keeping its room, or shows it again. */
export function setVisible(source: string, id: string, visible: boolean): Edit {
  const own = parseDiagram(source);
  return {
    ...setNodeStyle(own, source, id, { visible: visible ? undefined : 'false' }),
    ...described(dgm(visible ? 'diagram.did.show' : 'diagram.did.hide')),
  };
}

/** Makes a shape one that cannot be used, or usable again. */
export function setEnabled(source: string, id: string, enabled: boolean): Edit {
  // The style written in the file, not the one the parts filled in: the part's
  // colours stay the part's.
  const own = parseDiagram(source);
  return {
    ...setNodeStyle(own, source, id, { enabled: enabled ? undefined : 'false' }),
    ...described(dgm(enabled ? 'diagram.did.enable' : 'diagram.did.disable')),
  };
}

// --- type -----------------------------------------------------------------

/** The size words are measured at unless a shape says. */
export const DEFAULT_FONT_SIZE = 14;
const SIZE = /^(\d+(?:\.\d+)?)(?:px)?$/;
/** A typeface's name: letters, digits, spaces, hyphens — nothing that could leave the attribute. */
const FAMILY = /^[\w\s\-ぁ-鿿・]+$/;

/** The typeface and size a shape's words are written in, as far as its style says. */
export function fontOf(style: ReadonlyMap<string, string> | undefined): { size: number | undefined; family: string | undefined } {
  const sized = SIZE.exec(style?.get('font-size')?.trim() ?? '');
  const size = sized ? Number(sized[1]) : undefined;
  const named = style?.get('font')?.trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  return {
    size: size !== undefined && size >= 6 && size <= 96 ? size : undefined,
    family: named !== undefined && named !== '' && FAMILY.test(named) ? named : undefined,
  };
}
