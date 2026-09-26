// The formatting bar. It is anchored to the block being edited rather than to
// the selection: a text box gives no rectangle for its selection, and the
// mirror-element trick needed to find one is a large amount of machinery for a
// bar that is easier to hit when it stays in one place.
//
// Colour is a swatch row plus a picker. The swatches are there so a team's
// documents stay consistent without anyone having to remember a hex code; the
// picker is there because the colours people want are their own.

import { inlineStateAt, type InlineMark, type InlineState } from '../inline.js';

export interface Toolbar {
  readonly element: HTMLElement;
  /** Re-reads the text box and lights up whatever is already applied. */
  sync(text: string, start: number, end: number): void;
}

/** Offered as swatches. Legible on white, and distinct in greyscale print. */
export const SWATCHES: readonly [string, string][] = [
  ['#c62828', '赤'],
  ['#1f5fa8', '青'],
  ['#2e7d32', '緑'],
  ['#8a5a00', '茶'],
  ['#6a1b9a', '紫'],
  ['#5a6270', '灰'],
];

export function createToolbar(
  owner: Document, apply: (mark: InlineMark) => void,
): Toolbar {
  const bar = owner.createElement('div');
  bar.className = 'dp-format-bar';
  bar.setAttribute('role', 'toolbar');

  const buttons: { mark: InlineMark; node: HTMLElement }[] = [];

  const add = (mark: InlineMark, label: string, title: string, className: string): HTMLElement => {
    const button = owner.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-pressed', 'false');
    // mousedown, not click: a click would blur the text box first and the
    // selection the button is meant to act on would be gone.
    button.addEventListener('mousedown', event => {
      event.preventDefault();
      apply(mark);
    });
    buttons.push({ mark, node: button });
    bar.append(button);
    return button;
  };

  add('bold', 'B', '太字（Ctrl+B）', 'dp-format-bold');
  add('italic', 'I', '斜体（Ctrl+I）', 'dp-format-italic');
  add('code', '</>', 'コード', 'dp-format-code');

  const divider = owner.createElement('span');
  divider.className = 'dp-format-divider';
  bar.append(divider);

  for (const [colour, name] of SWATCHES) {
    const swatch = add({ color: colour }, '', `文字色: ${name}`, 'dp-format-swatch');
    swatch.style.setProperty('--swatch', colour);
  }

  // The picker keeps its own last value, so a colour used once is a click away.
  const picker = owner.createElement('input');
  picker.type = 'color';
  picker.className = 'dp-format-picker';
  picker.title = '文字色を選ぶ';
  picker.value = '#c62828';
  picker.addEventListener('mousedown', event => event.stopPropagation());
  picker.addEventListener('input', () => apply({ color: picker.value }));
  bar.append(picker);

  return {
    element: bar,
    sync(text, start, end) {
      const state = inlineStateAt(text, start, end);
      for (const { mark, node } of buttons) {
        node.setAttribute('aria-pressed', String(isOn(state, mark)));
      }
    },
  };
}

function isOn(state: InlineState, mark: InlineMark): boolean {
  if (typeof mark === 'object') {
    return state.color !== undefined && state.color.toLowerCase() === mark.color.toLowerCase();
  }
  return state[mark];
}
