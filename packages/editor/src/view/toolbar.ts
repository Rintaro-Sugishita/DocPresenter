// The formatting bar. It is anchored to the block being edited rather than to
// the selection: a text box gives no rectangle for its selection, and the
// mirror-element trick needed to find one is a large amount of machinery for a
// bar that is easier to hit when it stays in one place.
//
// There is no colour picker, deliberately. The buttons are the four meanings
// the tables already use, so a colour in the prose and a fill in a table say
// the same thing, the legend can be generated, and the theme stays in charge
// of what each one looks like on screen, in print and in greyscale.
//
// A token button carries a swatch of its own colour rather than the document
// class itself: the document class also brings a strike-through or an
// underline, which belong in the prose and not on a button.

import { inlineStateAt, TOKENS, type InlineMark, type InlineState } from '../inline.js';

export interface Toolbar {
  readonly element: HTMLElement;
  /** Re-reads the text box and lights up whatever is already applied. */
  sync(text: string, start: number, end: number): void;
}

interface Button {
  readonly mark: InlineMark;
  readonly label: string;
  readonly title: string;
  readonly className: string;
}

const BUTTONS: readonly Button[] = [
  { mark: 'bold', label: 'B', title: '太字（Ctrl+B）', className: 'dp-format-bold' },
  { mark: 'italic', label: 'I', title: '斜体（Ctrl+I）', className: 'dp-format-italic' },
  { mark: 'code', label: '</>', title: 'コード', className: 'dp-format-code' },
];

const TOKEN_LABEL: Readonly<Record<string, string>> = {
  changed: '変更', pending: '要確認', disabled: '対象外', removed: '削除予定',
};

export function createToolbar(
  owner: Document, apply: (mark: InlineMark) => void,
): Toolbar {
  const bar = owner.createElement('div');
  bar.className = 'dp-format-bar';
  bar.setAttribute('role', 'toolbar');

  const buttons = new Map<InlineMark, HTMLButtonElement>();

  const add = (mark: InlineMark, label: string, title: string, className: string): void => {
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
    buttons.set(mark, button);
    bar.append(button);
  };

  for (const button of BUTTONS) add(button.mark, button.label, button.title, button.className);

  const divider = owner.createElement('span');
  divider.className = 'dp-format-divider';
  bar.append(divider);

  for (const token of TOKENS) {
    add(token, TOKEN_LABEL[token] ?? token, `意味トークン: ${token}`, `dp-format-token dp-token-${token}`);
  }

  return {
    element: bar,
    sync(text, start, end) {
      const state = inlineStateAt(text, start, end);
      for (const [mark, button] of buttons) {
        button.setAttribute('aria-pressed', String(isOn(state, mark)));
      }
    },
  };
}

function isOn(state: InlineState, mark: InlineMark): boolean {
  if (mark === 'bold' || mark === 'italic' || mark === 'code') return state[mark];
  return state.token === mark;
}
