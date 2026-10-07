// The document engine's words. See packages/base/src/i18n.ts for how messages work.
//
// Two kinds live here. Diagnostics are for the author, like any other UI.
// The rest — 図 and 表 in a reference, 節, the diff legend — end up in the
// document itself; they follow the locale of whoever builds it
// (design/decisions.md).

import { defineMessages } from '@docpresenter/base';

export const MARKDOWN_MESSAGES = defineMessages({
  // --- reading -----------------------------------------------------------------
  'markdown.parse.separatorNeedsBlank': '`---` の前には空行が必要（setext 見出しと区別できないため）',
  'markdown.parse.unclosedFrontmatter': 'frontmatter が閉じられていない',
  'markdown.table.noGrid': '表のグリッドが見つからない',
  'markdown.table.unreadableLine': '解釈できない行: {text}',
  'markdown.table.badDelimiter': '区切り行が正しくない',
  'markdown.table.noCellAbove': "'{mark}' の上に結合できるセルがない（{column} 列目）",
  'markdown.table.noCellLeft': "'{mark}' の左に結合できるセルがない（{column} 列目）",

  // --- resolving -------------------------------------------------------------------
  'markdown.cycle': '参照が循環している: {chain}',
  'markdown.missing': '参照先が見つからない: {target}',
  'markdown.unreadable': '{target} を読めない: {message}',
  'markdown.duplicateLabel': "ラベル '{label}' が重複している",
  'markdown.unknownAttribute': "未知の属性 '{name}' は無視される",
  'markdown.kindMismatch': "ラベル '{label}' の種別が参照先 '{path}' と食い違う",
  'markdown.missingImage': '取り込めなかった画像がある: {path}',
  'markdown.missingRange': '名前付き範囲が見つからない: {rows}',

  // --- renaming a figure -------------------------------------------------------------
  'markdown.figure.notFound': 'この図表の取り込み行が見つからない（文書が書き換わった可能性がある）',
  'markdown.figure.badLabel': "ラベル '{label}' は使えない（英数字・-・_ で、fig- などで始める）",
  'markdown.figure.wrongPrefix': "ラベル '{label}' は {prefix}- で始める",
  'markdown.figure.labelTaken': "ラベル '{label}' は、この文書の別の場所で使われている",
  'markdown.figure.labelInUse': "ラベル '{label}' は本文から {count} か所で参照されているので外せない",
  'markdown.figure.badPath': "ファイル名 '{path}' は使えない",

  // --- in the document -----------------------------------------------------------------
  'markdown.noun.figure': '図 {number}',
  'markdown.noun.table': '表 {number}',
  'markdown.noun.section': '{number} 節',
  'markdown.untitledSheet': 'シート {index}',
  'markdown.diff.added': '追加',
  'markdown.diff.changed': '変更',
  'markdown.diff.removed': '削除',
  'markdown.diff.from': '{from} からの変更',
  'markdown.code.text': 'テキスト',
}, {
  'markdown.parse.separatorNeedsBlank': '`---` needs a blank line before it (otherwise it reads as a setext heading)',
  'markdown.parse.unclosedFrontmatter': 'The frontmatter is not closed',
  'markdown.table.noGrid': 'No table grid found',
  'markdown.table.unreadableLine': 'Cannot read this line: {text}',
  'markdown.table.badDelimiter': 'The delimiter row is not right',
  'markdown.table.noCellAbove': "No cell above to merge '{mark}' into (column {column})",
  'markdown.table.noCellLeft': "No cell to the left to merge '{mark}' into (column {column})",

  'markdown.cycle': 'References go round in a circle: {chain}',
  'markdown.missing': 'Reference not found: {target}',
  'markdown.unreadable': 'Cannot read {target}: {message}',
  'markdown.duplicateLabel': "The label '{label}' is used twice",
  'markdown.unknownAttribute': "The unknown attribute '{name}' is ignored",
  'markdown.kindMismatch': "The kind of label '{label}' does not match '{path}'",
  'markdown.missingImage': 'An image could not be brought in: {path}',
  'markdown.missingRange': 'Named range not found: {rows}',

  'markdown.figure.notFound': "This figure's import line is gone (the document may have changed)",
  'markdown.figure.badLabel': "The label '{label}' cannot be used (letters, digits, - and _, starting with fig- or the like)",
  'markdown.figure.wrongPrefix': "The label '{label}' must start with {prefix}-",
  'markdown.figure.labelTaken': "The label '{label}' is already used elsewhere in this document",
  'markdown.figure.labelInUse': "The label '{label}' is referred to {count} times in the text, so it cannot be removed",
  'markdown.figure.badPath': "The file name '{path}' cannot be used",

  'markdown.noun.figure': 'Figure {number}',
  'markdown.noun.table': 'Table {number}',
  'markdown.noun.section': 'Section {number}',
  'markdown.untitledSheet': 'Sheet {index}',
  'markdown.diff.added': 'Added',
  'markdown.diff.changed': 'Changed',
  'markdown.diff.removed': 'Removed',
  'markdown.diff.from': 'Changes since {from}',
  'markdown.code.text': 'Text',
});

export const md = MARKDOWN_MESSAGES.phrase;
