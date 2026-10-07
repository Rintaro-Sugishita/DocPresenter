// The formatting bar. It is anchored to the block being edited rather than to
// the selection: a text box gives no rectangle for its selection, and the
// mirror-element trick needed to find one is a large amount of machinery for a
// bar that is easier to hit when it stays in one place.
//
// The same bar serves a paragraph and an open table cell, because a cell holds
// the same inline Markdown a paragraph does.

import { inlineStateAt, type InlineMark, type InlineState } from '../inline.js';
import { createSwatchRow, TEXT_SWATCHES, type SwatchRow } from './swatches.js';
import { DEFAULT_LOCALE, type Locale } from '../i18n.js';
import { BASE_MESSAGES } from '../messages.js';

export interface Toolbar {
  readonly element: HTMLElement;
  /** Re-reads the text box and lights up whatever is already applied. */
  sync(text: string, start: number, end: number): void;
}

export { TEXT_SWATCHES as SWATCHES };

export function createToolbar(
  owner: Document, apply: (mark: InlineMark) => void, locale: Locale = DEFAULT_LOCALE,
): Toolbar {
  const t = BASE_MESSAGES.in(locale);
  const bar = owner.createElement('div');
  bar.className = 'dp-format-bar';
  bar.setAttribute('role', 'toolbar');

  const buttons: { mark: InlineMark; node: HTMLElement }[] = [];

  const add = (mark: InlineMark, label: string, title: string, className: string): void => {
    const button = owner.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('mousedown', event => {
      event.preventDefault();
      apply(mark);
    });
    buttons.push({ mark, node: button });
    bar.append(button);
  };

  add('bold', 'B', t('base.format.bold'), 'dp-format-bold');
  add('italic', 'I', t('base.format.italic'), 'dp-format-italic');
  add('code', '</>', t('base.format.code'), 'dp-format-code');

  const divider = owner.createElement('span');
  divider.className = 'dp-format-divider';
  bar.append(divider);

  let colour: string | undefined;
  const swatches: SwatchRow = createSwatchRow(owner, {
    label: t('base.format.colour'),
    locale,
    swatches: TEXT_SWATCHES,
    initial: '#ff0000',
    className: 'dp-format-swatch',
    onPick: picked => apply({ color: picked }),
    // Reset is not "apply none": it takes off whatever colour is there, which
    // is what pressing the applied colour again would do.
    onReset: () => { if (colour !== undefined) apply({ color: colour }); },
  });
  bar.append(...swatches.nodes);

  return {
    element: bar,
    sync(text, start, end) {
      const state: InlineState = inlineStateAt(text, start, end);
      colour = state.color;
      for (const { mark, node } of buttons) {
        node.setAttribute('aria-pressed', String(isOn(state, mark)));
      }
      swatches.sync(state.color, true);
    },
  };
}

function isOn(state: InlineState, mark: InlineMark): boolean {
  if (typeof mark === 'object') {
    return state.color !== undefined && state.color.toLowerCase() === mark.color.toLowerCase();
  }
  return state[mark];
}
