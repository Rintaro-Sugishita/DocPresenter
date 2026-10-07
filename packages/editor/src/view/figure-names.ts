// The form for what a figure is called: its file, its caption, its label.
//
// Three things that live in three places — the file system, an attribute on the
// `@import` line, and every `@label` in the text — are one question to the
// author: "what is this figure called?". So they are asked together, and
// written together when the author says so. The form only collects; the sheet
// view decides what to write.

import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';
import { EDITOR_MESSAGES } from '../messages.js';

export interface FigureNamesValue {
  /** The file name without its folder or its extension. */
  readonly name: string;
  readonly caption: string;
  readonly label: string;
}

export interface FigureNamesOptions {
  readonly owner: Document;
  /** Where the form is laid over. */
  readonly root: HTMLElement;
  readonly value: FigureNamesValue;
  /** `auth-design/` and `.dgm`, shown either side of the name so it is clear what is not changing. */
  readonly folder: string;
  readonly extension: string;
  /** Why the file name cannot be changed here, or undefined when it can. */
  readonly fixedName?: string | undefined;
  /** `fig` or `tbl`, for the hint and the placeholder. */
  readonly prefix: string;
  /**
   * Called with what the author entered. Returns why it cannot be done, and
   * the form stays open with that said; returns undefined when it was done.
   */
  readonly onSubmit: (value: FigureNamesValue) => string | undefined;
  readonly onClose?: () => void;
  readonly locale?: Locale | undefined;
}

export interface FigureNamesForm {
  close(): void;
}

/** Characters a file name cannot carry on some platform, and the path separators. */
const UNSAFE = /[\\/:*?"<>|\s]/;

export function openFigureNames(options: FigureNamesOptions): FigureNamesForm {
  const { owner } = options;
  const t = EDITOR_MESSAGES.in(options.locale ?? DEFAULT_LOCALE);
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] => {
    const node = owner.createElement(tag);
    if (className) node.className = className;
    return node;
  };

  const backdrop = element('div', 'dp-names-backdrop');
  const form = element('form', 'dp-names');
  form.setAttribute('role', 'dialog');
  form.setAttribute('aria-modal', 'true');
  const heading = element('h2', 'dp-names-title');
  heading.textContent = t('editor.figure.title');
  heading.id = 'dp-names-title';
  form.setAttribute('aria-labelledby', heading.id);
  form.append(heading);

  const field = (label: string, input: HTMLInputElement, hint: string, before?: string, after?: string): void => {
    const row = element('label', 'dp-names-field');
    const name = element('span', 'dp-names-label');
    name.textContent = label;
    const line = element('span', 'dp-names-line');
    if (before) { const fixed = element('span', 'dp-names-fixed'); fixed.textContent = before; line.append(fixed); }
    line.append(input);
    if (after) { const fixed = element('span', 'dp-names-fixed'); fixed.textContent = after; line.append(fixed); }
    const note = element('span', 'dp-names-hint');
    note.textContent = hint;
    row.append(name, line, note);
    form.append(row);
  };
  const input = (value: string, placeholder = ''): HTMLInputElement => {
    const node = element('input', 'dp-names-input');
    node.type = 'text';
    node.value = value;
    node.placeholder = placeholder;
    node.spellcheck = false;
    return node;
  };

  const name = input(options.value.name);
  name.disabled = options.fixedName !== undefined;
  field(t('editor.figure.file'), name, options.fixedName ?? t('editor.figure.fileHint'),
    options.folder, options.extension);
  const caption = input(options.value.caption);
  field(t('editor.figure.caption'), caption, t('editor.figure.captionHint'));
  const label = input(options.value.label, `${options.prefix}-…`);
  field(t('editor.figure.label'), label, t('editor.figure.labelHint', { prefix: options.prefix }));

  const problem = element('p', 'dp-names-problem');
  problem.setAttribute('role', 'alert');
  problem.hidden = true;
  const buttons = element('div', 'dp-names-buttons');
  const cancel = element('button', 'dp-names-cancel');
  cancel.type = 'button';
  cancel.textContent = t('editor.figure.cancel');
  const ok = element('button', 'dp-names-ok');
  ok.type = 'submit';
  ok.textContent = t('editor.figure.ok');
  buttons.append(cancel, ok);
  form.append(problem, buttons);
  backdrop.append(form);

  const say = (text: string | undefined): void => {
    problem.hidden = text === undefined;
    problem.textContent = text ?? '';
  };

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    owner.removeEventListener('keydown', onKey, true);
    options.onClose?.();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  form.addEventListener('submit', event => {
    event.preventDefault();
    const value = { name: name.value.trim(), caption: caption.value.trim(), label: label.value.trim() };
    if (value.name === '' || UNSAFE.test(value.name)) {
      say(t('editor.figure.badName'));
      name.focus();
      return;
    }
    const refused = options.onSubmit(value);
    if (refused !== undefined) { say(refused); return; }
    close();
  });
  cancel.addEventListener('click', close);
  // A press on the dim area around the form is "never mind", as Escape is.
  backdrop.addEventListener('mousedown', event => {
    if (event.target === backdrop) { event.preventDefault(); close(); }
  });
  // Nothing behind the form should react to what is pressed inside it.
  form.addEventListener('mousedown', event => event.stopPropagation());
  owner.addEventListener('keydown', onKey, true);

  options.root.append(backdrop);
  (name.disabled ? caption : name).focus();
  (name.disabled ? caption : name).select();
  return { close };
}
