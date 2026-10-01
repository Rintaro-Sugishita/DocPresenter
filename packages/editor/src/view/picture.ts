// The controls on a picture: how wide it is, and where it sits.
//
// A picture has no source to open — there is no text behind a PNG — so what
// takes the place of an editor is a handle and three buttons. Both write the
// same thing in the end: one attribute on the `@import` line that placed it,
// which is a byte range like every other edit this product makes.

export type Align = 'left' | 'center' | 'right';

export interface PictureOptions {
  readonly owner: Document;
  /** The `<figure>` the picture is in. */
  readonly figure: HTMLElement;
  /** What the document says now, so the buttons show the state rather than a guess. */
  readonly align: string | undefined;
  readonly width: string | undefined;
  /** Writes `align`, or removes it when undefined. */
  readonly onAlign: (value: Align | undefined) => void;
  /** Writes `width` as a percentage of the text column. */
  readonly onWidth: (percent: number) => void;
}

export interface PictureControls {
  destroy(): void;
}

/** Narrower than this and the picture is a dot; wider and it leaves the column. */
const LEAST = 10;
const MOST = 100;

export function mountPicture(options: PictureOptions): PictureControls {
  const { owner, figure } = options;
  const body = figure.querySelector<HTMLElement>('.dp-figure-body');
  if (!body) return { destroy: () => undefined };

  figure.classList.add('dp-picture-open');

  const bar = owner.createElement('div');
  bar.className = 'dp-picture-bar';
  const button = (label: string, title: string, pressed: boolean, run: () => void): void => {
    const node = owner.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.title = title;
    node.setAttribute('aria-pressed', String(pressed));
    node.addEventListener('mousedown', event => {
      // The pane routes a press to "open something else"; this one is the
      // picture's own gesture and must not travel.
      event.preventDefault();
      event.stopPropagation();
      run();
    });
    bar.append(node);
  };

  const at = options.align === 'center' || options.align === 'right' ? options.align : 'left';
  for (const [value, label] of [['left', '左'], ['center', '中央'], ['right', '右']] as const) {
    // Left is the theme's own default, so choosing it takes the attribute off
    // rather than writing down what was already true.
    button(label, `${label}に寄せる`, at === value,
      () => options.onAlign(value === 'left' ? undefined : value));
  }

  const size = owner.createElement('span');
  size.className = 'dp-picture-size';
  const show = (percent: number | undefined): void => {
    size.textContent = percent === undefined ? (options.width ?? '原寸') : `${percent}%`;
  };
  show(undefined);
  bar.append(size);
  // Zero means "no width of its own": the picture goes back to its natural size.
  button('原寸', '幅の指定を外す', options.width === undefined, () => options.onWidth(0));

  const handle = owner.createElement('div');
  handle.className = 'dp-picture-handle';
  handle.title = '端をつまんで幅を変える';

  // The column the percentage is of: the figure's own container, which is what
  // the printed text column will be.
  const column = (): number => figure.parentElement?.clientWidth ?? figure.clientWidth;

  let dragging = false;
  const moved = (event: MouseEvent): void => {
    if (!dragging) return;
    const left = body.getBoundingClientRect().left;
    const percent = clamp(Math.round(((event.clientX - left) / column()) * 100));
    body.style.width = `${percent}%`;
    show(percent);
  };
  const dropped = (): void => {
    if (!dragging) return;
    dragging = false;
    owner.removeEventListener('mousemove', moved);
    owner.removeEventListener('mouseup', dropped);
    const percent = clamp(Math.round((body.getBoundingClientRect().width / column()) * 100));
    options.onWidth(percent);
  };
  handle.addEventListener('mousedown', event => {
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    owner.addEventListener('mousemove', moved);
    owner.addEventListener('mouseup', dropped);
  });

  body.append(handle);
  figure.prepend(bar);

  return {
    destroy: () => {
      dragging = false;
      owner.removeEventListener('mousemove', moved);
      owner.removeEventListener('mouseup', dropped);
      figure.classList.remove('dp-picture-open');
      bar.remove();
      handle.remove();
    },
  };
}

function clamp(percent: number): number {
  return Math.min(MOST, Math.max(LEAST, percent));
}
