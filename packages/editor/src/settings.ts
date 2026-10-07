// Editor settings.
//
// These are values, not a screen. The editor takes them and never asks where
// they came from: VS Code reads them from its own settings UI, which it gets
// for free from `contributes.configuration`, and the web shell reads them from
// wherever it keeps preferences. Building a settings screen inside the editor
// would put a second one next to the one VS Code already has, which is the
// same duplication the project refuses for themes.
//
// Only genuinely contested bindings are settings. Escape cancels and leaving
// the block commits, in every configuration: those are not in dispute, and a
// setting for each would be a choice nobody wants to make.

import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';
import { EDITOR_MESSAGES } from './messages.js';

/** Which Enter commits the open block. Every other Enter inserts a newline. */
export type CommitKey = 'ctrl-enter' | 'enter' | 'shift-enter' | 'alt-enter';

export const COMMIT_KEYS: readonly CommitKey[] = [
  'ctrl-enter', 'enter', 'shift-enter', 'alt-enter',
];

export interface EditorSettings {
  readonly commitKey: CommitKey;
  /**
   * Which language the editor speaks. The shell decides: VS Code follows its
   * display language, the web shell asks once and remembers. Japanese when
   * nobody says.
   */
  readonly locale: Locale;
}

/**
 * `Ctrl+Enter` commits by default. Plain Enter is a line break in a design
 * document far more often than it is the end of a paragraph, and a default
 * that ends the block on Enter loses text for anyone who assumed otherwise.
 */
export const DEFAULT_SETTINGS: EditorSettings = { commitKey: 'ctrl-enter', locale: DEFAULT_LOCALE };

export interface KeyPress {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** True when this key press is the configured commit. */
export function isCommit(event: KeyPress, key: CommitKey): boolean {
  if (event.key !== 'Enter') return false;
  const mod = event.ctrlKey || event.metaKey;
  switch (key) {
    // Cmd on macOS, Ctrl elsewhere — the same gesture under a different name.
    case 'ctrl-enter': return mod && !event.shiftKey && !event.altKey;
    case 'shift-enter': return event.shiftKey && !mod && !event.altKey;
    case 'alt-enter': return event.altKey && !mod && !event.shiftKey;
    case 'enter': return !mod && !event.shiftKey && !event.altKey;
  }
}

/** How the choice reads in a settings list, in the language of that list. */
export function commitKeyLabel(key: CommitKey, locale: Locale = DEFAULT_LOCALE): string {
  return EDITOR_MESSAGES.in(locale)(`editor.commitKey.${key}`);
}
