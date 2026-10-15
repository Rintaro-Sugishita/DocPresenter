// The build's words. See packages/base/src/i18n.ts for how messages work.
//
// The diagnostics are for the author. The cover labels, the headings of the
// two indexes and the version in the foot go into the document; like 図 and
// 表 they follow the locale of whoever builds (design/decisions.md).

import { defineMessages, type Locale, type Params } from '@docpresenter/base';

export const BUILD_MESSAGES = defineMessages({
  // --- diagnostics ---------------------------------------------------------------
  'build.notRoot': 'ビルドルートではない（frontmatter に output が無い）',
  'build.cannotInline': '外部の画像を取り込めない器で建てている（{count} 件）',
  'build.inlineFailed': '外部の画像を取り込めなかった: {address}',
  'build.noMermaidPicture': 'Mermaid の図を PPTX に描けない環境で建てている（{count} 件）。スライドにはコードを出す',
  'build.mermaidFailed': 'Mermaid の図を描けなかった: {message}',
  'build.noWriter': '{format} 出力はこの環境では書けない（書き手が渡されていない）',
  'build.noTheme': 'テーマが見つからない: {theme}',
  'build.writeFailed': '{format} を書けなかった: {message}',
  'build.noMermaidScript': 'Mermaid を描くスクリプトが渡されていない。HTML ではコードのまま表示される',
  'build.unreadable': '読めない: {message}',
  'build.unreadableFile': '{path} を読めない: {message}',
  'build.noRoots': 'frontmatter に output を持つ文書が無い。ビルドするものが何も無い',
  'build.duplicateNumber': '文書番号 {number} が {others} と重なっている（レビューの指摘がどちらの文書のものか分からなくなる）',
  'build.noNumber': '文書番号（frontmatter の document:）が無い。レビューの指摘は文書を動かすと離れる（「新しい文書を作る」なら自動で採番する）',
  'build.orphan': 'どの成果物にも含まれていない',
  'build.cycle': '参照が循環している: {chain}',
  'build.missing': '参照先が見つからない: {target}',
  'build.unknownDocument': '文書番号 {document} の文書が見つからない',
  'build.missingRange': '名前付き範囲が見つからない: {rows}',
  'build.unreadableImage': '画像を読めない: {path}',
  'build.notSlide': 'スライドにできない参照: {path}',
  'build.notSlideCaptioned': 'スライドにできない参照: {path}（{caption}）',
  'build.writeback.missing': '読み戻す先の図が見つからない',
  'build.writeback.extraShape': 'スライドにある図形が図に無い: {id}（PowerPoint で足されたものは読み戻せない）',
  'build.writeback.formatted': '{id}: 書式付きのラベルを書き換えると書式が落ちる（{from} → {to}）',
  'build.writeback.text': '{id} の文字を「{text}」に',
  'build.writeback.moved': '{ids} の位置を更新',
  'build.writeback.unreadable': '読み戻せない図形がある: {id}',
  'build.writeback.edgeLabel': '{from} → {to} の線のラベルが「{was}」から「{now}」に変わっているが、線のラベルはまだ読み戻せない（図で直すこと）',
  'build.writeback.table': '{slide} 枚目の表（{path}）が PowerPoint で書き換えられているが、表は読み戻せない（{path} を直すこと）',

  // --- in the document ---------------------------------------------------------------
  'build.cover.document': '文書番号',
  'build.cover.version': '版',
  'build.cover.status': '状態',
  'build.cover.author': '作成',
  'build.cover.updated': '更新',
  'build.contents': '目次',
  'build.figures': '図表一覧',
  'build.foot.version': '版 {version}',
}, {
  'build.notRoot': 'Not a build root (no output in the frontmatter)',
  'build.cannotInline': 'Built where pictures from the web cannot be brought in ({count})',
  'build.inlineFailed': 'Could not bring in a picture from the web: {address}',
  'build.noMermaidPicture': 'Built where Mermaid diagrams cannot be drawn for PPTX ({count}). The slides show the code',
  'build.mermaidFailed': 'Could not draw a Mermaid diagram: {message}',
  'build.noWriter': '{format} output cannot be written here (no writer was given)',
  'build.noTheme': 'Theme not found: {theme}',
  'build.writeFailed': 'Could not write {format}: {message}',
  'build.noMermaidScript': 'No script to draw Mermaid was given. The HTML shows the code instead',
  'build.unreadable': 'Cannot read: {message}',
  'build.unreadableFile': 'Cannot read {path}: {message}',
  'build.noRoots': 'No document has output in its frontmatter, so there is nothing to build',
  'build.duplicateNumber': 'The document number {number} is also used by {others} (review comments could not tell the two apart)',
  'build.noNumber': 'No document number (document: in the frontmatter). Review comments come loose if the document is moved ("New Document" numbers one for you)',
  'build.orphan': 'Not part of any output',
  'build.cycle': 'References go round in a circle: {chain}',
  'build.missing': 'Reference not found: {target}',
  'build.unknownDocument': 'No document has the number {document}',
  'build.missingRange': 'Named range not found: {rows}',
  'build.unreadableImage': 'Cannot read the image: {path}',
  'build.notSlide': 'Cannot be made into a slide: {path}',
  'build.notSlideCaptioned': 'Cannot be made into a slide: {path} ({caption})',
  'build.writeback.missing': 'The diagram to read back into was not found',
  'build.writeback.extraShape': 'A shape on the slide is not in the diagram: {id} (shapes added in PowerPoint cannot be read back)',
  'build.writeback.formatted': '{id}: rewriting a formatted label loses the formatting ({from} → {to})',
  'build.writeback.text': 'Text of {id} to "{text}"',
  'build.writeback.moved': 'Moved {ids}',
  'build.writeback.unreadable': 'A shape cannot be read back: {id}',
  'build.writeback.edgeLabel': 'The label of the line {from} → {to} changed from "{was}" to "{now}", but line labels cannot be read back yet (change it in the diagram)',
  'build.writeback.table': 'The table on slide {slide} ({path}) was changed in PowerPoint, but tables cannot be read back (change {path})',

  'build.cover.document': 'Document No.',
  'build.cover.version': 'Version',
  'build.cover.status': 'Status',
  'build.cover.author': 'Author',
  'build.cover.updated': 'Updated',
  'build.contents': 'Contents',
  'build.figures': 'Figures and tables',
  'build.foot.version': 'Version {version}',
});

export type BuildMessage = (typeof BUILD_MESSAGES.ids)[number];

/**
 * A diagnostic's words and the id they came from. The id is for code that
 * decides by what was said — the VS Code shell leaves some out of its report —
 * so that it does not have to match a sentence in one language.
 */
export function said(locale: Locale, id: BuildMessage, params?: Params): { message: string; id: string } {
  return { message: BUILD_MESSAGES.in(locale)(id, params), id };
}
