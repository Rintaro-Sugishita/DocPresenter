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

  create(document, firstDocument(answers));
  create(`docs/${answers.name}/revision.md`, revision(answers));
  create('docs/assets/.gitkeep', '');
  create('shared/glossary.table', GLOSSARY);
  create('.docpresenter/guide.md', shipped.guide);
  for (const [name, text] of Object.entries(shipped.specs)) create(`.docpresenter/spec/${name}`, text);

  for (const path of ['CLAUDE.md', 'AGENTS.md']) {
    append(path, AGENT_POINTER, text => text.includes(MARKER));
  }
  // The top folder the builds go in: `out/build` is kept out of Git as `out/`.
  const top = answers.outDir.replace(/^\.?\/+/, '').split('/')[0]!;
  append('.gitignore', `# DocPresenter の書き出し\n${top}/\n`,
    text => text.split(/\r?\n/).some(line => line.trim().replace(/^\/|\/$/g, '') === top));

  return { files, kept, document };
}


function firstDocument(answers: ScaffoldAnswers): string {
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
    '## 概要 {#sec-overview}',
    '',
    '### 目的 {#sec-purpose}',
    '',
    '本書は、〈対象システム・機能〉の設計を示す。',
    '',
    '### 対象範囲 {#sec-scope}',
    '',
    '本書が扱う範囲は次のとおりとする。',
    '',
    '- 〈対象に含めるもの〉',
    '',
    '次のものは本書の対象外とする。',
    '',
    '- 〈対象に含めないもの〉',
    '',
    '### 用語 {#sec-terms}',
    '',
    '本書で用いる用語を @tbl-glossary に示す。',
    '',
    '@import "../shared/glossary.table" {#tbl-glossary caption="用語集"}',
    '',
    '---',
    '',
    `@import "${answers.name}/revision.md"`,
    '',
  ].join('\n');
}

function revision(answers: ScaffoldAnswers): string {
  return [
    '## 改訂履歴 {#sec-revision}',
    '',
    '版と変更点は Git の履歴が正本である。ここに載せるのは、**読み手が版を名指しするための番号**だけとする。',
    '',
    '| 版 | 日付 | 変更点 |',
    '|----|------------|------------------------------|',
    `| 0.1 | ${answers.today} | 初版作成 |`,
    '',
  ].join('\n');
}

const GLOSSARY = [
  '# 用語集（複数の文書から引く）',
  '',
  '| 用語 | 説明 |',
  '|------|------|',
  '| 〈用語〉 | 〈説明〉 |',
  '',
  'style {',
  '  col:用語 { width: 30% }',
  '}',
  '',
].join('\n');

const AGENT_POINTER = [
  MARKER,
  '## DocPresenter の設計書',
  '',
  '`docs/` と `shared/` の設計書は DocPresenter の形式で書かれている。',
  '設計書を書く・直す前に、必ず [.docpresenter/guide.md](.docpresenter/guide.md) を読み、その規則に従うこと。',
  '図（`.dgm`）と表（`.table`）の形式の詳細は `.docpresenter/spec/` にある。',
  '',
].join('\n');

/** A frontmatter value that stays a string, whatever the author typed. */
function yamlText(value: string): string {
  return /^[^\s'"#:\-?[\]{},&*!|>%@`][^:#]*$/.test(value) && !/\s$/.test(value)
    ? value : JSON.stringify(value);
}
