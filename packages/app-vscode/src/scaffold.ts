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

export interface ScaffoldAnswers {
  /** The first document's file name, without `.md`: `auth-design`. */
  readonly name: string;
  readonly title: string;
  /** The document number for the cover, when the author has one. */
  readonly number?: string | undefined;
  /** `2026-10-06`, for `updated:` and the first revision. */
  readonly today: string;
  /** Where builds are written, so that it can be kept out of Git. */
  readonly outDir: string;
  /** The language the starting documents are written in. Japanese when absent. */
  readonly locale?: Locale | undefined;
}

/** What the extension ships for the folder: the guide and the format specs. */
export interface Shipped {
  readonly guide: string;
  /** `dgm.md` → its text, and so on. */
  readonly specs: Readonly<Record<string, string>>;
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

/** A name that works as a file name and as a folder name on every platform. */
export const DOCUMENT_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Marks the block this command appends, so that it is appended once. */
const MARKER = '<!-- docpresenter:init -->';

export function planScaffold(
  answers: ScaffoldAnswers, shipped: Shipped, existing: (path: string) => string | undefined,
): ScaffoldPlan {
  const files: PlannedFile[] = [];
  const kept: string[] = [];
  const document = `docs/${answers.name}.md`;
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

  create(document, firstDocument(answers, words));
  create(`docs/${answers.name}/revision.md`, revision(answers, words));
  create('docs/assets/.gitkeep', '');
  create('shared/glossary.table', glossary(words));
  create('.docpresenter/guide.md', shipped.guide);
  for (const [name, text] of Object.entries(shipped.specs)) create(`.docpresenter/spec/${name}`, text);

  for (const path of ['CLAUDE.md', 'AGENTS.md']) {
    append(path, agentPointer(words), text => text.includes(MARKER));
  }
  // The top folder the builds go in: `out/build` is kept out of Git as `out/`.
  const top = answers.outDir.replace(/^\.?\/+/, '').split('/')[0]!;
  append('.gitignore', `${words.gitignore}\n${top}/\n`,
    text => text.split(/\r?\n/).some(line => line.trim().replace(/^\/|\/$/g, '') === top));

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

function firstDocument(answers: ScaffoldAnswers, words: Words): string {
  return [
    '---',
    ...(answers.number ? [`document: ${yamlText(answers.number)}`] : []),
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
    `### ${words.terms} {#sec-terms}`,
    '',
    words.termsText,
    '',
    `@import "../shared/glossary.table" {#tbl-glossary caption="${words.glossaryCaption}"}`,
    '',
    '---',
    '',
    `@import "${answers.name}/revision.md"`,
    '',
  ].join('\n');
}

function revision(answers: ScaffoldAnswers, words: Words): string {
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
