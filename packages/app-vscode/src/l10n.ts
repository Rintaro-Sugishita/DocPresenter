// The extension host's language: VS Code's display language, as one of ours.

import { pickLocale, type Locale } from '@docpresenter/base';
import * as vscode from 'vscode';
import { VSCODE_MESSAGES, type VscodeMessage } from './messages.js';

/**
 * Japanese for `ja`, English for everything else. Read when it is needed
 * rather than once — it cannot change without a restart, but reading it costs
 * nothing and a test can set it.
 */
export function hostLocale(): Locale {
  return pickLocale([vscode.env.language]);
}

/** One of the shell's sentences, in VS Code's display language. */
export function t(id: VscodeMessage, params?: Readonly<Record<string, string | number>>): string {
  return VSCODE_MESSAGES.in(hostLocale())(id, params);
}
