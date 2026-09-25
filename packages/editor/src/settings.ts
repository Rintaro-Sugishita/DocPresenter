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

/** Which Enter commits the open block. Every other Enter inserts a newline. */
export type CommitKey = 'ctrl-enter' | 'enter' | 'shift-enter' | 'alt-enter';

export const COMMIT_KEYS: readonly CommitKey[] = [
  'ctrl-enter', 'enter', 'shift-enter', 'alt-enter',
];

export interface EditorSettings {
  readonly commitKey: CommitKey;
}

/**
 * `Ctrl+Enter` commits by default. Plain Enter is a line break in a design
 * document far more often than it is the end of a paragraph, and a default
 * that ends the block on Enter loses text for anyone who assumed otherwise.
 */
export const DEFAULT_SETTINGS: EditorSettings = { commitKey: 'ctrl-enter' };

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

/** How the choice reads in a settings list. */
export const COMMIT_KEY_LABEL: Readonly<Record<CommitKey, string>> = {
  'ctrl-enter': 'Ctrl+Enter で確定 / Enter で改行',
  'enter': 'Enter で確定 / Shift+Enter で改行',
  'shift-enter': 'Shift+Enter で確定 / Enter で改行',
  'alt-enter': 'Alt+Enter で確定 / Enter で改行',
};
