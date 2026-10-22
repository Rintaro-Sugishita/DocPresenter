// docpresenter's own words; what it shares with dgm is in
// packages/dgm/src/messages.ts. See packages/base/src/i18n.ts.

import { defineMessages } from '@docpresenter/base';

export const DOC_MESSAGES = defineMessages({
  'doc.unsupported': '{path} は扱えません（.md と .dgm を指定してください）',
  'doc.noOutput': '{path} には output: が無いので、--to で形式を指定してください',
  'doc.noFont': 'PDF に埋め込む日本語フォントが見つかりません。--font <ttf/ttc のパス> で指定してください（環境変数 DOCPRESENTER_FONT でも可）',
  'doc.fontMissing': '指定されたフォントが読めません: {path}',
  'doc.badShowRemoved': '--show-removed は none か strike で指定してください: {value}',
  'doc.noPdf': 'PDF は書けません: {message}',
  'doc.noMermaid': 'Mermaid の図をスライドに描けません: {message}',
  'doc.fetched': '取り込み {address}（{size} KB）',
  'doc.pdfReport': '{pages} ページ、{font}',
  'doc.missingGlyphs': '欠字 {count}',
  'doc.checked': '文書 {documents}・図 {drawings}・表 {tables} を確かめました。エラー {errors} 件、警告 {warnings} 件（何も書き出していません）',
  'doc.import.nothing': 'import には .pptx か .pdf を指定してください',
  'doc.import.unsupported': '{path} は取り込めません（.pptx か .pdf を指定してください）',
  'doc.import.unchanged': '{path}: 変更なし',
  'doc.import.changed': '{path}: {changes}',
  'doc.import.pdf': '== {pdf}（文書 {document}、文書番号 {number}）',
  'doc.import.pdfNoMap': '== {pdf}（DocPresenter の対応表が無いので、指摘は場所を持たずに orphaned として入ります）',
  'doc.import.ours': 'PDF に載せていた指摘と回答 {count} 件は取り込みません',
  'doc.import.reply': '{round} #{id} への返信: {body}',
  'doc.import.nowhere': '（場所なし）',
  'doc.import.noRound': '{round} が無いので、返信 {count} 件を入れられません',
  'doc.import.replies': '{round}: 返信 {added} 件を追加（除いたもの {skipped} 件）',
  'doc.import.added': '{into}: {added} 件を追加（前に取り込んだので除いたもの {skipped} 件）',
  'doc.import.round': '{stem} へのレビュー',
  'doc.title.needed': '--title で文書の題名を指定してください',
  'doc.number.both': '--number と --series は一緒に指定できません',
  'doc.number.empty': '文書番号が空です',
  'doc.number.taken': '文書番号 {number} は {path} が使っています',
  'doc.init.noPaths': 'init はパスを取りません。場所は --root で指定してください',
  'doc.init.noGuide': '同梱の書き方の仕様書（init/guide.md）が見つかりません。npm run build:cli を実行してください',
  'doc.init.made': '作成 {path}',
  'doc.init.appended': '追記 {path}',
  'doc.init.kept': 'そのまま {path}',
  'doc.init.done': '作業場を用意しました（作成 {made} 件、追記 {appended} 件、そのまま {kept} 件）。最初の文書は {document}（文書番号 {number}）',
  'doc.init.doneNoDocument': '作業場を用意しました（作成 {made} 件、追記 {appended} 件、そのまま {kept} 件）。文書はもうあるので、最初の文書は作っていません（--name で作れます）',
  'doc.new.what': 'new のあとに doc か diagram を指定してください',
  'doc.new.made': '{path} を作りました（文書番号 {number}）',
  'doc.help': `docpresenter — 設計書を書き出す・確かめる・整形する・取り込む

使い方:
  docpresenter export [<ファイル|フォルダ>...] [--to <形式>[,<形式>...]] [--out <dir>] [--flat]
  docpresenter check  [<ファイル|フォルダ>...] [--strict]
  docpresenter format [<ファイル|フォルダ>...] [--write] [--check]
  docpresenter import <file.pptx|file.pdf>... [--write] [--into <reviews/x.review.yml>]
  docpresenter init   --title <題名> [--name <名前>] [--number <番号> | --series <接頭辞>]
  docpresenter new doc <ファイル> --title <題名> [--number <番号> | --series <接頭辞>]
  docpresenter new diagram <ファイル> [--kind flow|free]

  ファイルとフォルダはいくつでも指定できます。何も指定しなければ作業場全体です。
  フォルダから拾う .md は output: を持つ文書だけです（部品の .md は書き出しません）。

export:
  -t, --to <形式>        .md は html・pdf・pptx、.dgm は svg・png（カンマ区切りか、繰り返し）。
                         無ければ .md は frontmatter の output: のとおり、.dgm は svg
  -o, --out <dir>        書き出し先。既定は作業場の out/build/（フォルダ構成を保つ）
      --flat             フォルダ構成を保たず、書き出し先の直下に置く
      --chromium <path>  PDF と PNG を描くブラウザ（既定はこの機械の Chrome / Edge）
      --font <path>      PDF に埋め込むフォント（既定はこの機械の日本語フォント）
      --scale <n>        PNG の倍率（既定 2）
      --background <色>  PNG の背景（既定 white。transparent で透明）
      --diff-from <rev|dir>   その版からの変更に印を付ける
      --show-removed none|strike  消えた行の見せ方
      --no-review-notes  PDF に指摘と回答を載せない（納品用）
check:
      --strict           警告でも終了コード 1 にする
format:                  .dgm を決まった形に整える
      --write            書き換える（無ければ整形が要る図を挙げるだけ）
      --check            整形が要る図があれば終了コード 1 にする（CI 向け）
import:                  .pptx は図への読み戻し、.pdf は注釈を指摘として取り込む
      --write            書き込む（無ければ書き込む中身を見せるだけ）
      --into <file>      新しい指摘を入れるレビューファイル（.pdf のとき）
init:                    作業場を用意する（VS Code の「作業場を初期化する」と同じ。既にあるファイルは上書きしない）
      --title <題名>     最初の文書の題名（最初の文書を作るときは必須）
      --name <名前>      最初の文書のファイル名。docs/ に置く（既定 design）。文書がもうある作業場では、
                         これを指定したときだけ最初の文書を作る
new doc:                 文書と改訂履歴をテンプレートから作る（.docpresenter/templates/ があればそれを使う）
      --title <題名>     題名（必須）
      --number <番号>    文書番号。使われていれば断る
      --series <接頭辞>  その系列の次の番号を採る（新しい系列なら 001）。どちらも無ければ一番多い系列の次
new diagram:
      --kind flow|free   矢印から並べる図か、置いた所に描く図か（既定 flow）

共通:
      --root <dir>       作業場のルート（既定は .docpresenter/ か .git のある所）
      --lang ja|en       表示と、書き出す文書の見出しの言語（既定はこの機械の言語設定）
      --json             結果を JSON で出す
  -q, --quiet            結果のまとめと誤りだけを出す
  -h, --help             この説明
  -v, --version          版

終了コード: 0 成功、1 内容の問題、2 使い方の誤り`,
}, {
  'doc.unsupported': '{path} cannot be used here (name .md and .dgm files)',
  'doc.noOutput': '{path} has no output:, so name the formats with --to',
  'doc.noFont': 'No Japanese font was found to embed in the PDF. Name one with --font <path to a ttf/ttc> (or DOCPRESENTER_FONT)',
  'doc.fontMissing': 'The font named cannot be read: {path}',
  'doc.badShowRemoved': '--show-removed is none or strike: {value}',
  'doc.noPdf': 'Cannot write PDF: {message}',
  'doc.noMermaid': 'Cannot draw Mermaid diagrams for slides: {message}',
  'doc.fetched': 'Brought in {address} ({size} KB)',
  'doc.pdfReport': '{pages} pages, {font}',
  'doc.missingGlyphs': '{count} missing glyphs',
  'doc.checked': 'Checked {documents} documents, {drawings} drawings and {tables} tables: {errors} errors, {warnings} warnings (nothing was written)',
  'doc.import.nothing': 'Name the .pptx or .pdf files to import',
  'doc.import.unsupported': '{path} cannot be imported (name a .pptx or a .pdf)',
  'doc.import.unchanged': '{path}: unchanged',
  'doc.import.changed': '{path}: {changes}',
  'doc.import.pdf': '== {pdf} (document {document}, number {number})',
  'doc.import.pdfNoMap': '== {pdf} (no DocPresenter map, so its comments go in as orphaned, without a place)',
  'doc.import.ours': '{count} comments and answers the PDF was sent with are not taken in',
  'doc.import.reply': 'Reply to {round} #{id}: {body}',
  'doc.import.nowhere': '(no place)',
  'doc.import.noRound': '{round} is not there, so {count} replies cannot go in',
  'doc.import.replies': '{round}: {added} replies added ({skipped} left out)',
  'doc.import.added': '{into}: {added} added ({skipped} taken in before, left out)',
  'doc.import.round': 'Review of {stem}',
  'doc.title.needed': 'Give the document a title with --title',
  'doc.number.both': '--number and --series cannot be given together',
  'doc.number.empty': 'The document number is empty',
  'doc.number.taken': 'Document number {number} is taken by {path}',
  'doc.init.noPaths': 'init takes no paths; name the place with --root',
  'doc.init.noGuide': 'The shipped writing guide (init/guide.md) is missing; run npm run build:cli',
  'doc.init.made': 'Made {path}',
  'doc.init.appended': 'Added to {path}',
  'doc.init.kept': 'Kept {path}',
  'doc.init.done': 'The workspace is set up ({made} made, {appended} added to, {kept} kept). The first document is {document} (number {number})',
  'doc.init.doneNoDocument': 'The workspace is set up ({made} made, {appended} added to, {kept} kept). It has documents already, so no first document was made (--name makes one)',
  'doc.new.what': 'After new, say doc or diagram',
  'doc.new.made': 'Made {path} (number {number})',
  'doc.help': `docpresenter — export, check, format and import design documents

Usage:
  docpresenter export [<file|folder>...] [--to <format>[,<format>...]] [--out <dir>] [--flat]
  docpresenter check  [<file|folder>...] [--strict]
  docpresenter format [<file|folder>...] [--write] [--check]
  docpresenter import <file.pptx|file.pdf>... [--write] [--into <reviews/x.review.yml>]
  docpresenter init   --title <title> [--name <name>] [--number <n> | --series <prefix>]
  docpresenter new doc <file> --title <title> [--number <n> | --series <prefix>]
  docpresenter new diagram <file> [--kind flow|free]

  Name any number of files and folders. Nothing named means the whole workspace.
  From a folder, only the .md files with an output: are exported (not the parts).

export:
  -t, --to <format>      html, pdf, pptx for .md; svg, png for .dgm (comma-separated, or repeated).
                         Without it, .md as its output: says, .dgm as svg
  -o, --out <dir>        Where to write. The workspace's out/build/ when absent (folders kept)
      --flat             Put every file straight in the folder, not in the sources' folders
      --chromium <path>  The browser PDFs and PNGs are drawn with (this machine's Chrome or Edge when absent)
      --font <path>      The font embedded in PDFs (this machine's Japanese font when absent)
      --scale <n>        PNG scale (2 when absent)
      --background <c>   PNG background (white when absent; transparent for none)
      --diff-from <rev|dir>   Mark what changed since that version
      --show-removed none|strike  How removed lines are shown
      --no-review-notes  Leave the review out of PDFs (a copy to deliver)
check:
      --strict           Exit with 1 on warnings too
format:                  Put .dgm drawings into their canonical form
      --write            Rewrite the files (without it, only list the drawings to format)
      --check            Exit with 1 when a drawing is not formatted (for CI)
import:                  .pptx: read edited drawings back; .pdf: take annotations in as review comments
      --write            Write (without it, only show what would be written)
      --into <file>      The review file new comments go in (for .pdf)
init:                    Set the workspace up (as VS Code's "Set Up This Folder"; nothing there is written over)
      --title <title>    The first document's title (required when one is made)
      --name <name>      The first document's file name, in docs/ (design when absent). In a workspace
                         that has documents already, a first document is made only when this is given
new doc:                 A document and its revision history from the templates (.docpresenter/templates/ when there)
      --title <title>    Its title (required)
      --number <n>       Its number; refused when taken
      --series <prefix>  The next number of that series (001 for a new one). Without either, the next of the largest series
new diagram:
      --kind flow|free   Laid out from its arrows, or drawn where shapes are put (flow when absent)

Common:
      --root <dir>       The workspace root (the folder with .docpresenter/ or .git when absent)
      --lang ja|en       The language to talk and to label documents in (this machine's when absent)
      --json             Write the result as JSON
  -q, --quiet            Write only the summary and what went wrong
  -h, --help             This help
  -v, --version          The version

Exit codes: 0 success, 1 a problem in the files, 2 a mistake in the command`,
});

export type DocMessage = (typeof DOC_MESSAGES.ids)[number];
