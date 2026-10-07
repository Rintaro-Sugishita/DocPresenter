// Messages in more than one language.
//
// The locale is a value, like the editor settings: the shell decides it — VS
// Code from its display language, the web shell from the browser and the
// author's choice — and passes it in. No package reads the environment to find
// out which language to speak, for the same reason none of them owns a
// settings screen (design/settings-model.md).
//
// Each package declares its own messages with `defineMessages`, Japanese and
// English side by side. The type makes the English catalogue carry every key
// the Japanese one has; `checkMessages` adds what the type cannot see — the
// same placeholders on both sides.
//
// Code that has no locale to hand — a parser throwing an error, an edit naming
// itself — returns a `Phrase` rather than a sentence: the id and its values.
// Whoever shows it to a person knows the locale and turns it into words there.
// The Japanese rendering is kept alongside as the default, so a caller that
// never asks about languages sees exactly what it saw before.

export type Locale = 'ja' | 'en';

export const LOCALES: readonly Locale[] = ['ja', 'en'];

/** What the packages speak when nobody says otherwise. */
export const DEFAULT_LOCALE: Locale = 'ja';

/** Each language named in itself, for a language switch. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = { ja: '日本語', en: 'English' };

export function isLocale(value: unknown): value is Locale {
  return value === 'ja' || value === 'en';
}

/**
 * Picks the locale for a list of language tags in order of preference — what
 * `navigator.languages` or `vscode.env.language` report. The first tag in a
 * language we have wins; Japanese for `ja` and anything under it, English for
 * `en`, and English when none of them is either.
 */
export function pickLocale(tags: readonly (string | undefined)[]): Locale {
  for (const tag of tags) {
    const primary = tag?.toLowerCase().split(/[-_]/)[0];
    if (primary === 'ja') return 'ja';
    if (primary === 'en') return 'en';
  }
  return 'en';
}

/** A value to put into a message. A phrase inside a phrase is rendered in the same locale. */
export type Param = string | number | Phrase;
export type Params = Readonly<Record<string, Param>>;

/** A message not yet put into words: which one, and the values that go into it. */
export interface Phrase {
  readonly id: string;
  readonly params?: Params | undefined;
}

/**
 * A message in one language. A string names its values as `{name}`; a function
 * is there for the sentence a template cannot say — an English plural.
 */
export type Template = string | ((params: Readonly<Record<string, string>>) => string);

export type Catalogue<K extends string = string> = Readonly<Record<K, Template>>;

/** Turns an id and its values into a sentence in one language. */
export type Translate<K extends string = string> = (id: K, params?: Params) => string;

export interface Messages<K extends string> {
  readonly ids: readonly K[];
  readonly catalogues: Readonly<Record<Locale, Catalogue<K>>>;
  /** The messages in one language. */
  in(locale: Locale): Translate<K>;
  /** The message as data, for code that does not know the locale. */
  phrase(id: K, params?: Params): Phrase;
}

// Every message every package declared, by id. A phrase carries only its id,
// so whoever renders it finds the words here without knowing which package
// made it. Ids are prefixed with the package to keep them apart.
const registry = new Map<string, Readonly<Record<Locale, Template>>>();

export function defineMessages<const J extends Record<string, Template>>(
  ja: J, en: { readonly [K in keyof J]: Template },
): Messages<keyof J & string> {
  type K = keyof J & string;
  const ids = Object.keys(ja) as K[];
  // The same catalogue can be loaded twice — a bundle and its source side by
  // side in a test — so a second declaration replaces the first rather than
  // failing. Ids carry their package's prefix, which is what keeps them apart.
  for (const id of ids) {
    registry.set(id, { ja: ja[id]!, en: en[id]! });
  }
  const catalogues = { ja, en } as Readonly<Record<Locale, Catalogue<K>>>;
  return {
    ids,
    catalogues,
    // A locale nobody declared — a shell that predates the setting passes
    // nothing — reads as the default rather than failing.
    in: given => {
      const locale = isLocale(given) ? given : DEFAULT_LOCALE;
      return (id, params) => fill(catalogues[locale][id] ?? catalogues.ja[id], params, locale, id);
    },
    phrase: (id, params) => (params ? { id, params } : { id }),
  };
}

/** Puts a phrase into words. An id nobody declared comes back as itself, which is at least findable. */
export function say(locale: Locale, phrase: Phrase): string {
  const entry = registry.get(phrase.id);
  return fill(entry?.[locale] ?? entry?.ja, phrase.params, locale, phrase.id);
}

function fill(template: Template | undefined, params: Params | undefined, locale: Locale, id: string): string {
  if (template === undefined) return id;
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(params ?? {})) {
    values[name] = typeof value === 'object' ? say(locale, value) : String(value);
  }
  if (typeof template === 'function') return template(values);
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/**
 * An error whose message is a phrase. `message` holds the Japanese, so code
 * that only logs it is unchanged; code that shows it to a person asks
 * `describeError` for the words in that person's language.
 */
export class LocalizedError extends Error {
  readonly phrase: Phrase;
  constructor(phrase: Phrase) {
    super(say(DEFAULT_LOCALE, phrase));
    this.phrase = phrase;
  }
}

/** The phrase an error carries, if it carries one. Duck-typed: two bundles have two classes. */
export function phraseOf(error: unknown): Phrase | undefined {
  const phrase = (error as { phrase?: unknown } | null)?.phrase;
  return typeof phrase === 'object' && phrase !== null && typeof (phrase as Phrase).id === 'string'
    ? phrase as Phrase : undefined;
}

/** What went wrong, in the reader's language when the error can say it in theirs. */
export function describeError(error: unknown, locale: Locale): string {
  const phrase = phraseOf(error);
  if (phrase) return say(locale, phrase);
  return error instanceof Error ? error.message : String(error);
}

/**
 * Faults in a pair of catalogues that the type cannot see: a key on one side
 * only, a placeholder on one side only, an empty message. Each package's tests
 * assert this comes back empty.
 */
export function checkMessages(messages: Messages<string>): string[] {
  const problems: string[] = [];
  const { ja, en } = messages.catalogues;
  for (const id of Object.keys(ja)) {
    if (!(id in en)) { problems.push(`en is missing ${id}`); continue; }
    const a = ja[id]!;
    const b = en[id]!;
    if (typeof a === 'string' && a.trim() === '') problems.push(`ja ${id} is empty`);
    if (typeof b === 'string' && b.trim() === '') problems.push(`en ${id} is empty`);
    if (typeof a === 'string' && typeof b === 'string') {
      const left = placeholders(a);
      const right = placeholders(b);
      if (left !== right) problems.push(`${id} has {${left}} in ja but {${right}} in en`);
    }
  }
  for (const id of Object.keys(en)) if (!(id in ja)) problems.push(`en has ${id}, which ja does not`);
  return problems;
}

function placeholders(template: string): string {
  return [...new Set([...template.matchAll(/\{(\w+)\}/g)].map(m => m[1]!))].sort().join(',');
}
