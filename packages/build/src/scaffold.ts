// What "set this folder up for DocPresenter" writes.
//
// Worked out here, away from VS Code, so that a test can run it over a folder
// held in a map. The command only asks the questions and writes the result.
//
// **Nothing the author already has is overwritten.** A file that exists is
// left alone and named in the report; the files an agent reads its
// instructions from (`CLAUDE.md`, `AGENTS.md`) and `.gitignore` are appended
// to, once — each checks for what it would add, so running the command again
// adds nothing.

import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';

// Where a file name is checked lives with the rest of what every shell shares.
export { nameProblem } from '@docpresenter/base';

export interface ScaffoldAnswers {
  /**
   * The document's file name, without `.md`: `auth-design`. A `/` puts it in a
   * folder below `folder`: `order/design`.
   */
  readonly name: string;
  /** The folder the document goes in, from the workspace root. `docs` when absent. */
  readonly folder?: string | undefined;
  readonly title: string;
  /** The document number for the cover, when the author has one. */
  readonly number?: string | undefined;
  /** `2026-10-06`, for `updated:` and the first revision. */
  readonly today: string;
  /** Where builds are written, so that it can be kept out of Git. */
  readonly outDir: string;
  /** The language the starting documents are written in. Japanese when absent. */
  readonly locale?: Locale | undefined;
  /** Whether the document takes in the shared glossary. Yes unless said otherwise. */
  readonly glossary?: boolean | undefined;
}

/**
 * A new document and its revision history, from the repository's templates
 * (`.docpresenter/templates/`) when it has them and the shipped ones when it
 * does not. The number goes in whatever the template says.
 */
export function documentFiles(
  answers: Omit<ScaffoldAnswers, 'outDir'>,
  templates?: { readonly document?: string | undefined; readonly revision?: string | undefined },
): { path: string; text: string }[] {
  const shipped = defaultTemplates(answers.locale ?? DEFAULT_LOCALE, answers.glossary !== false);
  const where = documentPaths(answers.folder, answers.name);
  const values: TemplateValues = {
    title: answers.title, number: answers.number ?? '', name: where.base, today: answers.today, root: where.root,
  };
  const document = renderTemplate(templates?.document ?? shipped.document, values);
  return [
    { path: where.document, text: answers.number ? ensureNumber(document, answers.number) : document },
    { path: where.revision, text: renderTemplate(templates?.revision ?? shipped.revision, values) },
  ];
}

/**
 * Where a document and its revision history go, and what its imports start
 * with to reach the workspace root (`../` from `docs/a.md`, `../../` from
 * `docs/order/a.md`).
 */
export function documentPaths(folder: string | undefined, name: string): {
  document: string; revision: string; base: string; root: string;
} {
  const stem = [folder ?? 'docs', name].map(part => part.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
  const depth = stem.split('/').length - 1;
  return {
    document: `${stem}.md`,
    revision: `${stem}/revision.md`,
    base: stem.slice(stem.lastIndexOf('/') + 1),
    root: '../'.repeat(depth),
  };
}

/** Where a repository keeps its own templates and theme, set up with the folder. */
export const TEMPLATE_DOCUMENT = '.docpresenter/templates/document.md';
export const TEMPLATE_REVISION = '.docpresenter/templates/revision.md';
export const TEAM_THEME = '.docpresenter/themes/default/theme.css';

/** The two templates a new document is made from. */
export interface DocumentTemplates {
  /** The document. `{{name}}` is its file name, so it can take in its revision history. */
  readonly document: string;
  readonly revision: string;
}

/**
 * What a template can say: `{{title}}`, `{{number}}`, `{{name}}` (the file
 * name, without its folder), `{{today}}`, and `{{root}}` — the way from the
 * document up to the workspace root, so that `{{root}}shared/` is found
 * however deep the document sits.
 */
export type TemplateValues = Readonly<Record<'title' | 'number' | 'name' | 'today' | 'root', string>>;

/**
 * The templates the extension ships, in the language given: the same document
 * the folder used to start with, its values left as placeholders for a team
 * to rearrange.
 */
export function defaultTemplates(locale: Locale = DEFAULT_LOCALE, glossary = true): DocumentTemplates {
  const words = WORDS[locale];
  // Plain words a YAML value takes as it is, swapped for the placeholders after.
  const marks = { title: 'DPTITLE', number: 'DPNUMBER', name: 'dpname', today: 'DPTODAY', root: 'DPROOT/' } as const;
  const unmark = (text: string): string => text
    .replaceAll(marks.title, '{{title}}').replaceAll(marks.number, '{{number}}')
    .replaceAll(marks.name, '{{name}}').replaceAll(marks.today, '{{today}}').replaceAll(marks.root, '{{root}}');
  return { document: unmark(firstDocument(marks, words, glossary)), revision: unmark(revision(marks, words)) };
}

/**
 * A template with its placeholders filled in. A placeholder that is the whole
 * value of a frontmatter key is written as YAML would want it — a title with
 * a colon in it is quoted — and everywhere else the value goes in as it is. A
 * placeholder this does not know is left as written, to be seen and fixed.
 */
export function renderTemplate(template: string, values: TemplateValues): string {
  const lines = template.replace(/\r\n/g, '\n').split('\n');
  const end = lines[0]?.trim() === '---' ? lines.findIndex((line, i) => i > 0 && line.trim() === '---') : -1;
  const known = (key: string): key is keyof TemplateValues => key in values;
  return lines.flatMap((line, i) => {
    if (i > 0 && i < end) {
      const whole = /^(\s*[A-Za-z_][\w-]*:\s*)\{\{(\w+)\}\}\s*$/.exec(line);
      if (whole && known(whole[2]!)) {
        // A key with nothing to say is left out, not written empty.
        const value = values[whole[2]!];
        return value === '' ? [] : [`${whole[1]}${yamlText(value)}`];
      }
    }
    return [line.replace(/\{\{(\w+)\}\}/g, (all, key: string) => (known(key) ? values[key] : all))];
  }).join('\n');
}

/**
 * The document with its number in the frontmatter, whatever its template
 * said: a number is what review comments are tied to, so no document goes
 * without one.
 */
export function ensureNumber(text: string, number: string): string {
  const lines = text.split('\n');
  const end = lines[0]?.trim() === '---' ? lines.findIndex((line, i) => i > 0 && line.trim() === '---') : -1;
  if (end > 0) {
    const at = lines.findIndex((line, i) => i > 0 && i < end && /^document:/.test(line));
    if (at > 0 && lines[at]!.replace(/^document:\s*/, '').replace(/^["']|["']$/g, '').trim() !== '') return text;
    if (at > 0) lines.splice(at, 1, `document: ${yamlText(number)}`);
    else lines.splice(1, 0, `document: ${yamlText(number)}`);
    return lines.join('\n');
  }
  return `---\ndocument: ${yamlText(number)}\n---\n\n${text}`;
}

/** What the extension ships for the folder: the guide and the format specs. */
export interface Shipped {
  readonly guide: string;
  /** `dgm.md` → its text, and so on. */
  readonly specs: Readonly<Record<string, string>>;
  /** The theme documents are printed in, copied for the team to change. */
  readonly theme?: string | undefined;
}

export interface PlannedFile {
  readonly path: string;
  /** The whole file when it is created, or what is added to its end. */
  readonly text: string;
  readonly mode: 'create' | 'append';
}

export interface ScaffoldPlan {
  readonly files: readonly PlannedFile[];
  /** Files that were already there and are left as they are. */
  readonly kept: readonly string[];
  /** The document to open once everything is written. */
  readonly document: string;
}

/** Marks the block this command appends, so that it is appended once. */
const MARKER = '<!-- docpresenter:init -->';

export function planScaffold(
  answers: ScaffoldAnswers, shipped: Shipped, existing: (path: string) => string | undefined,
): ScaffoldPlan {
  const files: PlannedFile[] = [];
  const kept: string[] = [];
  const document = documentPaths(answers.folder, answers.name).document;
  const words = WORDS[answers.locale ?? DEFAULT_LOCALE];

  const create = (path: string, text: string): void => {
    if (existing(path) === undefined) files.push({ path, text, mode: 'create' });
    else kept.push(path);
  };
  /** Adds a block to a file, or creates the file with it. */
  const append = (path: string, block: string, already: (text: string) => boolean): void => {
    const now = existing(path);
    if (now === undefined) files.push({ path, text: block, mode: 'create' });
    else if (already(now)) kept.push(path);
    else files.push({ path, text: `${now === '' || now.endsWith('\n') ? '' : '\n'}\n${block}`, mode: 'append' });
  };

  // The templates and theme go in first and the first document is made from
  // them — the team's own, when the folder already has them.
  const templates = defaultTemplates(answers.locale ?? DEFAULT_LOCALE, answers.glossary !== false);
  create(TEMPLATE_DOCUMENT, templates.document);
  create(TEMPLATE_REVISION, templates.revision);
  if (shipped.theme !== undefined) create(TEAM_THEME, shipped.theme);
  const [first, history] = documentFiles(answers, {
    document: existing(TEMPLATE_DOCUMENT), revision: existing(TEMPLATE_REVISION),
  });
  create(first!.path, first!.text);
  create(history!.path, history!.text);
  create('docs/assets/.gitkeep', '');
  create('shared/glossary.table', glossary(words));
  create('.docpresenter/guide.md', shipped.guide);
  for (const [name, text] of Object.entries(shipped.specs)) create(`.docpresenter/spec/${name}`, text);

  for (const path of ['CLAUDE.md', 'AGENTS.md']) {
    append(path, agentPointer(words), text => text.includes(MARKER));
  }
  // The top folder the builds go in: `out/build` is kept out of Git as `out/`.
  // PDFs and decks are kept out wherever they are written; SVG and PNG are not,
  // since a drawing exported as a picture is often meant to be committed.
  const top = answers.outDir.replace(/^\.?\/+/, '').split('/')[0]!;
  const bare = (line: string): string => line.trim().replace(/^\/|\/$/g, '');
  const missing = (text: string): string[] => {
    const ignored = new Set(text.split(/\r?\n/).map(bare));
    return [`${top}/`, '*.pdf', '*.pptx'].filter(pattern => !ignored.has(bare(pattern)));
  };
  append('.gitignore', `${words.gitignore}\n${missing(existing('.gitignore') ?? '').join('\n')}\n`,
    text => missing(text).length === 0);

  return { files, kept, document };
}


/**
 * The words of what is written into the folder. They are the start of the
 * author's documents, not chrome, so they come in the language the author's
 * VS Code speaks — the same rule as 図 and 表 in a build (design/decisions.md).
 */
interface Words {
  readonly gitignore: string;
  readonly overview: string;
  readonly purpose: string;
  readonly purposeText: string;
  readonly scope: string;
  readonly scopeIn: string;
  readonly scopeInItem: string;
  readonly scopeOut: string;
  readonly scopeOutItem: string;
  readonly terms: string;
  readonly termsText: string;
  readonly glossaryCaption: string;
  readonly revision: string;
  readonly revisionText: string;
  readonly revisionHead: readonly [string, string, string];
  readonly firstRevision: string;
  readonly glossary: string;
  readonly glossaryHead: readonly [string, string];
  readonly glossaryRow: readonly [string, string];
  readonly agent: readonly string[];
}

const WORDS: Readonly<Record<Locale, Words>> = {
  ja: {
    gitignore: '# DocPresenter の書き出し',
    overview: '概要',
    purpose: '目的',
    purposeText: '本書は、〈対象システム・機能〉の設計を示す。',
    scope: '対象範囲',
    scopeIn: '本書が扱う範囲は次のとおりとする。',
    scopeInItem: '〈対象に含めるもの〉',
    scopeOut: '次のものは本書の対象外とする。',
    scopeOutItem: '〈対象に含めないもの〉',
    terms: '用語',
    termsText: '本書で用いる用語を @tbl-glossary に示す。',
    glossaryCaption: '用語集',
    revision: '改訂履歴',
    revisionText: '版と変更点は Git の履歴が正本である。ここに載せるのは、**読み手が版を名指しするための番号**だけとする。',
    revisionHead: ['版', '日付', '変更点'],
    firstRevision: '初版作成',
    glossary: '用語集（複数の文書から引く）',
    glossaryHead: ['用語', '説明'],
    glossaryRow: ['〈用語〉', '〈説明〉'],
    agent: [
      '## DocPresenter の設計書',
      '',
      '`docs/` と `shared/` の設計書は DocPresenter の形式で書かれている。',
      '設計書を書く・直す前に、必ず [.docpresenter/guide.md](.docpresenter/guide.md) を読み、その規則に従うこと。',
      '図（`.dgm`）と表（`.table`）の形式の詳細は `.docpresenter/spec/` にある。',
    ],
  },
  en: {
    gitignore: '# DocPresenter output',
    overview: 'Overview',
    purpose: 'Purpose',
    purposeText: 'This document describes the design of 〈the system or feature〉.',
    scope: 'Scope',
    scopeIn: 'This document covers the following.',
    scopeInItem: '〈What is in scope〉',
    scopeOut: 'The following is out of scope.',
    scopeOutItem: '〈What is out of scope〉',
    terms: 'Terms',
    termsText: 'The terms used in this document are listed in @tbl-glossary.',
    glossaryCaption: 'Glossary',
    revision: 'Revision history',
    revisionText: 'The Git history is the record of versions and changes. This table holds only **the numbers readers use to name a version**.',
    revisionHead: ['Version', 'Date', 'Changes'],
    firstRevision: 'First draft',
    glossary: 'Glossary (shared by several documents)',
    glossaryHead: ['Term', 'Meaning'],
    glossaryRow: ['〈Term〉', '〈Meaning〉'],
    agent: [
      '## DocPresenter design documents',
      '',
      'The design documents in `docs/` and `shared/` are written in the DocPresenter format.',
      'Before writing or changing one, read [.docpresenter/guide.md](.docpresenter/guide.md) and follow its rules.',
      'The `.dgm` (diagram) and `.table` (table) formats are specified in `.docpresenter/spec/`.',
    ],
  },
};

function firstDocument(answers: TemplateValues, words: Words, withGlossary: boolean): string {
  return [
    '---',
    `document: ${yamlText(answers.number)}`,
    `title: ${yamlText(answers.title)}`,
    'version: 0.1',
    'status: draft',
    'author: ""',
    `updated: ${answers.today}`,
    'theme: default',
    'output: [html, pdf]',
    '---',
    '',
    `# ${answers.title}`,
    '',
    `## ${words.overview} {#sec-overview}`,
    '',
    `### ${words.purpose} {#sec-purpose}`,
    '',
    words.purposeText,
    '',
    `### ${words.scope} {#sec-scope}`,
    '',
    words.scopeIn,
    '',
    `- ${words.scopeInItem}`,
    '',
    words.scopeOut,
    '',
    `- ${words.scopeOutItem}`,
    '',
    ...(!withGlossary ? [] : [
      `### ${words.terms} {#sec-terms}`,
      '',
      words.termsText,
      '',
      `@import "${answers.root}shared/glossary.table" {#tbl-glossary caption="${words.glossaryCaption}"}`,
      '',
    ]),
    '---',
    '',
    `@import "${answers.name}/revision.md"`,
    '',
  ].join('\n');
}

function revision(answers: TemplateValues, words: Words): string {
  const [version, date, changes] = words.revisionHead;
  return [
    `## ${words.revision} {#sec-revision}`,
    '',
    words.revisionText,
    '',
    `| ${version} | ${date} | ${changes} |`,
    '|----|------------|------------------------------|',
    `| 0.1 | ${answers.today} | ${words.firstRevision} |`,
    '',
  ].join('\n');
}

function glossary(words: Words): string {
  const [term, meaning] = words.glossaryHead;
  const [someTerm, someMeaning] = words.glossaryRow;
  return [
    `# ${words.glossary}`,
    '',
    `| ${term} | ${meaning} |`,
    '|------|------|',
    `| ${someTerm} | ${someMeaning} |`,
    '',
    'style {',
    `  col:${term} { width: 30% }`,
    '}',
    '',
  ].join('\n');
}

function agentPointer(words: Words): string {
  return [MARKER, ...words.agent, ''].join('\n');
}

/** A frontmatter value that stays a string, whatever the author typed. */
function yamlText(value: string): string {
  return /^[^\s'"#:\-?[\]{},&*!|>%@`][^:#]*$/.test(value) && !/\s$/.test(value)
    ? value : JSON.stringify(value);
}
