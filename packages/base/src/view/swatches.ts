// The colour row: a few ready colours, a picker, and a reset.
//
// One implementation, used by the formatting bar over a paragraph, the same
// bar over an open cell, and the table's fill and text-colour controls. They
// are the same control doing the same job, and three copies of it would drift
// the way the two inline parsers did.

import { DEFAULT_LOCALE, type Locale } from '../i18n.js';
import { BASE_MESSAGES } from '../messages.js';

/** A colour's name, looked up in the messages as `base.colour.<name>`. */
export type ColourName = 'red' | 'blue' | 'green' | 'purple' | 'yellow' | 'grey';

export interface SwatchRowOptions {
  /** What the row sets, for the titles: 文字色, 塗り, … — already in the locale's language. */
  readonly label: string;
  readonly swatches: readonly (readonly [string, ColourName])[];
  readonly locale?: Locale | undefined;
  /** The colour the picker starts on. */
  readonly initial: string;
  readonly onPick: (colour: string) => void;
  readonly onReset: () => void;
  readonly className: string;
}

export interface SwatchRow {
  readonly nodes: readonly HTMLElement[];
  /** Lights up the colour currently applied, if it is one of the swatches. */
  sync(current: string | undefined, enabled: boolean): void;
}

/**
 * Four plain colours, not muted ones. A colour in a design document is there
 * to stand out; a palette of tasteful near-greys defeats the only thing it is
 * for. Anything else comes from the picker.
 */
export const TEXT_SWATCHES: readonly (readonly [string, ColourName])[] = [
  ['#ff0000', 'red'], ['#0000ff', 'blue'], ['#00b400', 'green'], ['#8000ff', 'purple'],
];

/** The same four hues, pale enough to read black text on. */
export const FILL_SWATCHES: readonly (readonly [string, ColourName])[] = [
  ['#ffe0e0', 'red'], ['#e0e8ff', 'blue'], ['#e0f5e0', 'green'], ['#f0e0ff', 'purple'],
  ['#fdf0d5', 'yellow'], ['#eceef1', 'grey'],
];

export function createSwatchRow(owner: Document, options: SwatchRowOptions): SwatchRow {
  const buttons: { colour: string; node: HTMLButtonElement }[] = [];
  const nodes: HTMLElement[] = [];
  const t = BASE_MESSAGES.in(options.locale ?? DEFAULT_LOCALE);
  const { label } = options;

  for (const [colour, name] of options.swatches) {
    const node = owner.createElement('button');
    node.type = 'button';
    node.className = options.className;
    node.title = t('base.swatch.named', { label, name: t(`base.colour.${name}`) });
    node.style.setProperty('--swatch', colour);
    node.setAttribute('aria-pressed', 'false');
    // mousedown, not click: a click blurs the text box first, and the
    // selection the button is meant to act on is gone by then.
    node.addEventListener('mousedown', event => {
      event.preventDefault();
      options.onPick(colour);
    });
    buttons.push({ colour, node });
    nodes.push(node);
  }

  const picker = owner.createElement('input');
  picker.type = 'color';
  picker.className = `${options.className}-picker`;
  picker.title = t('base.swatch.pick', { label });
  picker.value = options.initial;
  picker.addEventListener('mousedown', event => event.stopPropagation());
  picker.addEventListener('input', () => options.onPick(picker.value));
  nodes.push(picker);

  const reset = owner.createElement('button');
  reset.type = 'button';
  reset.className = `${options.className}-reset`;
  reset.textContent = t('base.swatch.reset');
  reset.title = t('base.swatch.resetTitle', { label });
  reset.addEventListener('mousedown', event => {
    event.preventDefault();
    options.onReset();
  });
  nodes.push(reset);

  return {
    nodes,
    sync(current, enabled) {
      for (const { colour, node } of buttons) {
        node.setAttribute('aria-pressed',
          String(current !== undefined && current.toLowerCase() === colour.toLowerCase()));
        node.disabled = !enabled;
      }
      picker.disabled = !enabled;
      reset.disabled = !enabled;
    },
  };
}
