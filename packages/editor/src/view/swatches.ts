// The colour row: a few ready colours, a picker, and a reset.
//
// One implementation, used by the formatting bar over a paragraph, the same
// bar over an open cell, and the table's fill and text-colour controls. They
// are the same control doing the same job, and three copies of it would drift
// the way the two inline parsers did.

export interface SwatchRowOptions {
  /** What the row sets, for the titles: 文字色, 塗り, … */
  readonly label: string;
  readonly swatches: readonly (readonly [string, string])[];
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
export const TEXT_SWATCHES: readonly (readonly [string, string])[] = [
  ['#ff0000', '赤'], ['#0000ff', '青'], ['#00b400', '緑'], ['#8000ff', '紫'],
];

/** The same four hues, pale enough to read black text on. */
export const FILL_SWATCHES: readonly (readonly [string, string])[] = [
  ['#ffe0e0', '赤'], ['#e0e8ff', '青'], ['#e0f5e0', '緑'], ['#f0e0ff', '紫'],
  ['#fdf0d5', '黄'], ['#eceef1', '灰'],
];

export function createSwatchRow(owner: Document, options: SwatchRowOptions): SwatchRow {
  const buttons: { colour: string; node: HTMLButtonElement }[] = [];
  const nodes: HTMLElement[] = [];

  for (const [colour, name] of options.swatches) {
    const node = owner.createElement('button');
    node.type = 'button';
    node.className = options.className;
    node.title = `${options.label}: ${name}`;
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
  picker.title = `${options.label}を選ぶ`;
  picker.value = options.initial;
  picker.addEventListener('mousedown', event => event.stopPropagation());
  picker.addEventListener('input', () => options.onPick(picker.value));
  nodes.push(picker);

  const reset = owner.createElement('button');
  reset.type = 'button';
  reset.className = `${options.className}-reset`;
  reset.textContent = '解除';
  reset.title = `${options.label}を外す`;
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
