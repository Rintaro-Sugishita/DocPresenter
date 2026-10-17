// The extension host's language: VS Code's display language, as one of ours.

import { pickLocale, type Locale } from '@docpresenter/base';
import * as vscode from 'vscode';
import { DIAGRAM_EXTENSION_MESSAGES, type DiagramExtensionMessage } from './messages.js';

/** Japanese for `ja`, English for everything else. */
export function hostLocale(): Locale {
  return pickLocale([vscode.env.language]);
}

/** One of the extension's sentences, in VS Code's display language. */
export function t(id: DiagramExtensionMessage, params?: Readonly<Record<string, string | number>>): string {
  return DIAGRAM_EXTENSION_MESSAGES.in(hostLocale())(id, params);
}
