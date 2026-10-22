// What to offer while a block is written as text: the labels `@` can refer
// to, and the files `@import "…"` can take in — the suggestions VS Code's own
// editor gives (packages/app-vscode/src/markdown-editing.ts), in the page's
// text box. What is being typed is worked out in @docpresenter/markdown.

import { completionContext, type LabelCandidate } from '@docpresenter/markdown';

export interface Suggestions {
  /** The list, placed under the text box; hidden while there is nothing to offer. */
  readonly element: HTMLElement;
  /** Looks at the cursor again and offers what fits there. */
  update(): void;
  /** Takes the key when the list is open (arrows, Enter, Tab, Escape). True when it did. */
  key(event: KeyboardEvent): boolean;
}

export interface SuggestionSources {
  readonly labels: () => readonly LabelCandidate[];
  readonly files: () => readonly string[];
  /** What the line-start `@import` item says it does. */
  readonly importLabel: string;
}

interface Item { readonly text: string; readonly detail: string; readonly insert: string; readonly again?: boolean }

const MAX = 40;

export function createSuggestions(
  owner: Document, area: HTMLTextAreaElement, sources: SuggestionSources, changed: () => void,
): Suggestions {
  const list = owner.createElement('ul');
  list.className = 'dp-suggest';
  list.setAttribute('role', 'listbox');
  list.hidden = true;

  let items: Item[] = [];
  let from = 0;
  let active = 0;
  let labels: readonly LabelCandidate[] | undefined;

  const close = (): void => { list.hidden = true; items = []; };

  const draw = (): void => {
    list.replaceChildren(...items.map((item, index) => {
      const row = owner.createElement('li');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === active));
      if (index === active) row.classList.add('dp-suggest-active');
      const text = owner.createElement('span');
      text.className = 'dp-suggest-text';
      text.textContent = item.text;
      row.append(text);
      if (item.detail) {
        const detail = owner.createElement('span');
        detail.className = 'dp-suggest-detail';
        detail.textContent = item.detail;
        row.append(detail);
      }
      // Pressed, not clicked: a click would take the focus from the text box first.
      row.addEventListener('mousedown', event => { event.preventDefault(); accept(index); });
      return row;
    }));
    list.hidden = items.length === 0;
    list.querySelector('.dp-suggest-active')?.scrollIntoView({ block: 'nearest' });
  };

  const accept = (index: number): void => {
    const item = items[index];
    if (!item) return;
    area.setRangeText(item.insert, from, area.selectionStart, 'end');
    close();
    changed();
    area.focus();
    if (item.again) update();
  };

  function update(): void {
    if (area.selectionStart !== area.selectionEnd) { close(); return; }
    const context = completionContext(area.value, area.selectionStart);
    if (!context) { close(); return; }
    const typed = context.typed.toLowerCase();
    const fits = (text: string) => text.toLowerCase().includes(typed);
    from = context.from;
    if (context.kind === 'import') {
      items = sources.files().filter(fits).map(path => ({ text: path, detail: '', insert: path }));
    } else {
      labels ??= sources.labels();
      items = labels.filter(one => fits(one.label)).map(one => ({
        text: one.label, detail: [one.number, one.caption].filter(Boolean).join(' '), insert: one.label,
      }));
      if (context.lineStart && 'import'.startsWith(typed)) {
        items.unshift({ text: 'import "…"', detail: sources.importLabel, insert: 'import "', again: true });
      }
    }
    items = items.slice(0, MAX);
    active = 0;
    draw();
  }

  return {
    element: list,
    update,
    key(event) {
      if (list.hidden || items.length === 0) return false;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        active = (active + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        draw();
        return true;
      }
      if ((event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey) || event.key === 'Tab') {
        accept(active);
        return true;
      }
      if (event.key === 'Escape') { close(); return true; }
      return false;
    },
  };
}
