// A repository's settings for every document in it: `.docpresenter/settings.yml`.
//
// What is in it is read by whoever it concerns — the cover by the build, the
// item table's columns by the drawings — so this only finds and reads it.

import { parse } from 'yaml';

/** Where a repository keeps its settings, from its root. */
export const SETTINGS_FILE = '.docpresenter/settings.yml';

/** The settings as read, or undefined when there are none or they cannot be read. */
export function readSettings(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try { return parse(text) as unknown; } catch { return undefined; }
}
