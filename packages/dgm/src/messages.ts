// The command line's words, shared by dgm and docpresenter. See
// packages/base/src/i18n.ts for how messages work.

import { defineMessages } from '@docpresenter/base';

export const CLI_MESSAGES = defineMessages({
  'cli.unknownOption': '知らないオプションです: {option}',
  'cli.noValue': '{option} は値を取りません',
  'cli.needsValue': '{option} には値が要ります',
  'cli.noCommand': 'コマンドを指定してください（{name} --help で一覧が出ます）',
  'cli.unknownCommand': '知らないコマンドです: {command}（{name} --help で一覧が出ます）',
  'cli.rootMissing': '作業場のフォルダがありません: {path}',
  'cli.pathMissing': 'ありません: {path}',
  'cli.outsideRoot': '{path} は作業場（{root}）の外にあります。--root で作業場を指定してください',
  'cli.collision': '{first} と {second} が、どちらも {file} に書き出されます。--flat を外すか、別々に書き出してください',
  'cli.unknownFormat': '知らない形式です: {format}（使えるのは {known}）',
  'cli.formatMismatch': '{path} は {format} に書き出せません（書き出せるのは {allowed}）',
  'cli.notDrawing': '{path} は図（.dgm）ではありません',
  'cli.badLang': '--lang は ja か en で指定してください: {value}',
  'cli.badScale': '--scale は正の数で指定してください: {value}',
  'cli.noChromium': 'PNG と PDF を書くための Chromium 系ブラウザが見つかりません。Chrome か Edge を入れるか、--chromium <path> で場所を指定してください（環境変数 DOCPRESENTER_CHROMIUM でも可）',
  'cli.chromiumMissing': '指定された Chromium がありません: {path}',
  'cli.nothing': '対象のファイルがありません',
  'cli.parts': '{path} は部品の定義なので、絵にはなりません',
  'cli.overlaySvg': '{path} は画面キャプチャへの注釈なので SVG にはなりません（PNG にはなります）',
  'cli.wrote': '{file}（{source} → {format}、{size} KB）',
  'cli.failed': '{path}: {format} に書き出せませんでした: {message}',
  'cli.exportSummary': '{written} 件を書き出しました。失敗 {failed} 件',
  'cli.label.error': 'エラー',
  'cli.label.warning': '警告',
  'cli.label.info': 'お知らせ',
  'cli.checkDrawings': '図 {drawings} 件を確かめました。エラー {errors} 件、警告 {warnings} 件（何も書き出していません）',
  'cli.format.formatted': '{path} を整形しました',
  'cli.format.needed': '{path} は整形されていません',
  'cli.format.summaryWrite': '図 {count} 件のうち、整形したもの {changed} 件、読めないもの {failed} 件',
  'cli.format.summary': '図 {count} 件のうち、整形が要るもの {changed} 件、読めないもの {failed} 件',
  'cli.items.synced': '{table} を {path} に合わせました',
  'cli.items.created': '{table} を {path} から作り、結びました',
  'cli.items.linked': '{path} に、もうある {table} を結びました',
  'cli.items.needed': '{table} は {path} と揃っていません',
  'cli.items.summaryWrite': '項目一覧のある画面 {count} 件のうち、表を合わせたもの {changed} 件、読めないもの {failed} 件',
  'cli.items.summary': '項目一覧のある画面 {count} 件のうち、表を合わせる必要があるもの {changed} 件、読めないもの {failed} 件',
  'cli.dryRun': '（--write を付けると書き込みます）',
  'cli.new.needsPath': '作るファイルのパスを指定してください',
  'cli.new.onePath': '一度に作れるのは 1 つです',
  'cli.new.exists': '{path} はもうあります。上書きはしません',
  'cli.new.badKind': '--kind は flow・free・screen のどれかで指定してください: {value}',
  'cli.new.made': '{path} を作りました',
  'cli.name.empty': '名前が空です',
  'cli.name.characters': '「{name}」にはファイル名に使えない文字があります（\\ : * ? " < > |）',
  'cli.name.reserved': '「{name}」は Windows が予約している名前なので使えません',
  'cli.name.ending': '「{name}」は空白か . で始まる・終わるので使えません',
  'cli.help.dgm': `dgm — .dgm の図を書き出す・確かめる・整形する

使い方:
  dgm export [<ファイル|フォルダ>...] [--to svg,png] [--out <dir>] [--flat]
  dgm check  [<ファイル|フォルダ>...] [--strict]
  dgm format [<ファイル|フォルダ>...] [--write] [--check]
  dgm items  [<ファイル|フォルダ>...] [--write] [--check] [--create]
  dgm new    <ファイル> [--kind flow|free|screen]

  ファイルとフォルダはいくつでも指定でき、フォルダは中の .dgm を全部扱います。
  何も指定しなければ作業場全体です。

export:
  -t, --to <形式>        svg・png（カンマ区切りか、繰り返し）。既定は svg
  -o, --out <dir>        書き出し先。既定は作業場の out/build/
      --flat             フォルダ構成を保たず、書き出し先の直下に置く
      --scale <n>        PNG の倍率（既定 2）
      --background <色>  PNG の背景（既定 white。transparent で透明）
      --chromium <path>  PNG を描くブラウザ（既定はこの機械の Chrome / Edge）
check:
      --strict           警告でも終了コード 1 にする
format:
      --write            書き換える（無ければ整形が要る図を挙げるだけ）
      --check            整形が要る図があれば終了コード 1 にする（CI 向け）
items:                   画面の項目一覧（items "….table"）に、画面の項目を画面の順で並べる
      --write            表を書き換える（無ければ揃っていない表を挙げるだけ）
      --check            揃っていない表があれば終了コード 1 にする（CI 向け）
      --create           項目一覧の無い画面に、横に <画面>-items.table を作って結ぶ（書き込む）
new:                     新しい図を作る（既にあるファイルは上書きしない）
      --kind flow|free|screen
                         矢印から並べる図か、置いた所に描く図か、項目一覧つきの画面か（既定 flow）

共通:
      --root <dir>       作業場のルート（既定は .docpresenter/ か .git のある所）
      --lang ja|en       表示の言語（既定はこの機械の言語設定）
      --json             結果を JSON で出す
  -q, --quiet            結果のまとめと誤りだけを出す
  -h, --help             この説明
  -v, --version          版

終了コード: 0 成功、1 内容の問題、2 使い方の誤り`,
}, {
  'cli.unknownOption': 'Unknown option: {option}',
  'cli.noValue': '{option} takes no value',
  'cli.needsValue': '{option} needs a value',
  'cli.noCommand': 'Name a command (see {name} --help)',
  'cli.unknownCommand': 'Unknown command: {command} (see {name} --help)',
  'cli.rootMissing': 'No such workspace folder: {path}',
  'cli.pathMissing': 'Not found: {path}',
  'cli.outsideRoot': '{path} is outside the workspace ({root}). Name the workspace with --root',
  'cli.collision': '{first} and {second} would both be written to {file}. Leave out --flat, or export them separately',
  'cli.unknownFormat': 'Unknown format: {format} (one of {known})',
  'cli.formatMismatch': '{path} cannot be exported as {format} (only {allowed})',
  'cli.notDrawing': '{path} is not a drawing (.dgm)',
  'cli.badLang': '--lang is ja or en: {value}',
  'cli.badScale': '--scale is a positive number: {value}',
  'cli.noChromium': 'No Chromium-based browser was found to draw PNGs and PDFs with. Install Chrome or Edge, or name one with --chromium <path> (or DOCPRESENTER_CHROMIUM)',
  'cli.chromiumMissing': 'The Chromium named is not there: {path}',
  'cli.nothing': 'Nothing to work on',
  'cli.parts': '{path} defines parts, so it has no picture',
  'cli.overlaySvg': '{path} annotates a screenshot, so it has no SVG (it has a PNG)',
  'cli.wrote': '{file} ({source} → {format}, {size} KB)',
  'cli.failed': '{path}: could not be exported as {format}: {message}',
  'cli.exportSummary': 'Exported {written}; {failed} failed',
  'cli.label.error': 'error',
  'cli.label.warning': 'warning',
  'cli.label.info': 'info',
  'cli.checkDrawings': 'Checked {drawings} drawings: {errors} errors, {warnings} warnings (nothing was written)',
  'cli.format.formatted': 'Formatted {path}',
  'cli.format.needed': '{path} is not formatted',
  'cli.format.summaryWrite': '{count} drawings: {changed} formatted, {failed} unreadable',
  'cli.format.summary': '{count} drawings: {changed} to format, {failed} unreadable',
  'cli.items.synced': 'Matched {table} to {path}',
  'cli.items.created': 'Made {table} from {path} and gave it to the screen',
  'cli.items.linked': 'Gave {path} the {table} that was already there',
  'cli.items.needed': '{table} does not match {path}',
  'cli.items.summaryWrite': '{count} screens with an item table: {changed} tables matched, {failed} unreadable',
  'cli.items.summary': '{count} screens with an item table: {changed} tables to match, {failed} unreadable',
  'cli.dryRun': '(add --write to write it)',
  'cli.new.needsPath': 'Name the file to make',
  'cli.new.onePath': 'Only one can be made at a time',
  'cli.new.exists': '{path} is already there; nothing is written over',
  'cli.new.badKind': '--kind is flow, free or screen: {value}',
  'cli.new.made': 'Made {path}',
  'cli.name.empty': 'The name is empty',
  'cli.name.characters': '“{name}” has characters no file name can (\\ : * ? " < > |)',
  'cli.name.reserved': '“{name}” is a name Windows keeps for itself',
  'cli.name.ending': '“{name}” starts or ends with a space or a period',
  'cli.help.dgm': `dgm — export, check and format .dgm drawings

Usage:
  dgm export [<file|folder>...] [--to svg,png] [--out <dir>] [--flat]
  dgm check  [<file|folder>...] [--strict]
  dgm format [<file|folder>...] [--write] [--check]
  dgm items  [<file|folder>...] [--write] [--check] [--create]
  dgm new    <file> [--kind flow|free|screen]

  Name any number of files and folders; a folder means every .dgm in it.
  Nothing named means the whole workspace.

export:
  -t, --to <format>      svg, png (comma-separated, or repeated). svg when absent
  -o, --out <dir>        Where to write. The workspace's out/build/ when absent
      --flat             Put every file straight in the folder, not in the sources' folders
      --scale <n>        PNG scale (2 when absent)
      --background <c>   PNG background (white when absent; transparent for none)
      --chromium <path>  The browser PNGs are drawn with (this machine's Chrome or Edge when absent)
check:
      --strict           Exit with 1 on warnings too
format:
      --write            Rewrite the files (without it, only list the drawings to format)
      --check            Exit with 1 when a drawing is not formatted (for CI)
items:                   List a screen's items in its item table (items "….table"), in the screen's order
      --write            Rewrite the tables (without it, only list the tables that do not match)
      --check            Exit with 1 when a table does not match (for CI)
      --create           Give a screen with no item table one beside it, <screen>-items.table (writes)
new:                     Make a new drawing (never over a file that is there)
      --kind flow|free|screen
                         Laid out from its arrows, drawn where shapes are put, or a screen with its item table (flow when absent)

Common:
      --root <dir>       The workspace root (the folder with .docpresenter/ or .git when absent)
      --lang ja|en       The language to talk in (this machine's when absent)
      --json             Write the result as JSON
  -q, --quiet            Write only the summary and what went wrong
  -h, --help             This help
  -v, --version          The version

Exit codes: 0 success, 1 a problem in the files, 2 a mistake in the command`,
});

export type CliMessage = (typeof CLI_MESSAGES.ids)[number];
