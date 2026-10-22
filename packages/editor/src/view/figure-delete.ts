// The question asked before a figure leaves the document.
//
// Taking a figure out is two different wishes that look the same on the page:
// "not in this document" — the file stays, another document may use it, it may
// come back — and "not anywhere", which is the file gone as well. One button
// and a question keeps the figure's corner quiet; the answer that loses nothing
// is the one chosen until the author says otherwise. The form only asks; the
// sheet view decides what to write.

import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';
import { EDITOR_MESSAGES } from '../messages.js';

export type FigureDeleteChoice = 'reference' | 'file';

export interface FigureDeleteOptions {
  readonly owner: Document;
  /** Where the form is laid over. */
  readonly root: HTMLElement;
  /** The file, as the document writes it. */
  readonly path: string;
  /** Why the file itself cannot be deleted from here, or undefined when it can. */
  readonly fileFixed?: string | undefined;
  /** How many places in this document point at the figure by its label. */
  readonly referred: number;
  readonly label?: string | undefined;
  /** Returns why it cannot be done (the form stays open saying so), or undefined. */
  readonly onChoose: (choice: FigureDeleteChoice) => string | undefined;
  readonly onClose?: () => void;
  readonly locale?: Locale | undefined;
}

export interface FigureDeleteForm {
  close(): void;
}

export function openFigureDelete(options: FigureDeleteOptions): FigureDeleteForm {
  const { owner } = options;
  const t = EDITOR_MESSAGES.in(options.locale ?? DEFAULT_LOCALE);
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] => {
    const node = owner.createElement(tag);
    if (className) node.className = className;
    return node;
  };

  const backdrop = element('div', 'dp-names-backdrop');
  const form = element('form', 'dp-names dp-delete');
  form.setAttribute('role', 'dialog');
  form.setAttribute('aria-modal', 'true');
  const heading = element('h2', 'dp-names-title');
  heading.textContent = t('editor.delete.title');
  heading.id = 'dp-delete-title';
  form.setAttribute('aria-labelledby', heading.id);
  const file = element('p', 'dp-delete-path');
  file.textContent = options.path;
  form.append(heading, file);

  const choice = (value: FigureDeleteChoice, label: string, hint: string, disabled = false): HTMLInputElement => {
    const row = element('label', 'dp-delete-choice');
    const radio = element('input');
    radio.type = 'radio';
    radio.name = 'dp-delete';
    radio.value = value;
    radio.disabled = disabled;
    const words = element('span', 'dp-delete-words');
    const name = element('span', 'dp-names-label');
    name.textContent = label;
    const note = element('span', 'dp-names-hint');
    note.textContent = hint;
    words.append(name, note);
    row.append(radio, words);
    form.append(row);
    return radio;
  };
  const reference = choice('reference', t('editor.delete.reference'), t('editor.delete.referenceHint'));
  const whole = choice('file', t('editor.delete.file'),
    options.fileFixed ?? t('editor.delete.fileHint'), options.fileFixed !== undefined);
  reference.checked = true;

  if (options.referred > 0 && options.label !== undefined) {
    const warn = element('p', 'dp-delete-warn');
    warn.textContent = t('editor.delete.referred', { label: options.label, count: options.referred });
    form.append(warn);
  }

  const problem = element('p', 'dp-names-problem');
  problem.setAttribute('role', 'alert');
  problem.hidden = true;
  const buttons = element('div', 'dp-names-buttons');
  const cancel = element('button', 'dp-names-cancel');
  cancel.type = 'button';
  cancel.textContent = t('editor.figure.cancel');
  const ok = element('button', 'dp-names-ok');
  ok.type = 'submit';
  buttons.append(cancel, ok);
  form.append(problem, buttons);
  backdrop.append(form);

  // The button says what will happen, and turns red when it cannot be undone
  // from here.
  const sync = (): void => {
    ok.textContent = whole.checked ? t('editor.delete.okFile') : t('editor.delete.okReference');
    ok.classList.toggle('dp-delete-danger', whole.checked);
  };
  reference.addEventListener('change', sync);
  whole.addEventListener('change', sync);
  sync();

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
    const refused = options.onChoose(whole.checked ? 'file' : 'reference');
    if (refused !== undefined) {
      problem.hidden = false;
      problem.textContent = refused;
      return;
    }
    close();
  });
  cancel.addEventListener('click', close);
  backdrop.addEventListener('mousedown', event => {
    if (event.target === backdrop) { event.preventDefault(); close(); }
  });
  form.addEventListener('mousedown', event => event.stopPropagation());
  owner.addEventListener('keydown', onKey, true);

  options.root.append(backdrop);
  ok.focus();
  return { close };
}
