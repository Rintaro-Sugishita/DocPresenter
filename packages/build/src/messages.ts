// The build's words. See packages/base/src/i18n.ts for how messages work.
//
// The diagnostics are for the author. The cover labels, the headings of the
// two indexes and the version in the foot go into the document; like 図 and
// 表 they follow the locale of whoever builds (design/decisions.md).

import { defineMessages, type Locale, type Params } from '@docpresenter/base';

export const BUILD_MESSAGES = defineMessages({
  // --- diagnostics ---------------------------------------------------------------
  'build.notRoot': 'ビルドルートではありません（frontmatter に output がありません）',
  'build.cannotInline': '外部の画像を取り込めない環境でビルドしています（{count} 件）',
  'build.inlineFailed': '外部の画像を取り込めませんでした: {address}',
  'build.noMermaidPicture': 'Mermaid の図を PPTX に描けない環境でビルドしています（{count} 件）。スライドにはコードを表示します',
  'build.mermaidFailed': 'Mermaid の図を描けませんでした: {message}',
  'build.noWriter': '{format} の出力はこの環境では書き出せません（書き出し機能が渡されていません）',
  'build.noTheme': 'テーマが見つかりません: {theme}',
  'build.writeFailed': '{format} を書き出せませんでした: {message}',
  'build.noMermaidScript': 'Mermaid を描くスクリプトが渡されていないため、HTML ではコードのまま表示されます',
  'build.unreadable': '読めません: {message}',
  'build.unreadableFile': '{path} を読めません: {message}',
  'build.noRoots': 'frontmatter に output を持つ文書がないため、ビルドするものがありません',
  'build.duplicateNumber': '文書番号 {number} が {others} と重なっています（レビューの指摘がどちらの文書のものか分からなくなります）',
  'build.noNumber': '文書番号（frontmatter の document:）がありません。文書を移動するとレビューの指摘が離れてしまいます（「新しい文書を作る」なら自動で採番します）',
  'build.orphan': 'どの成果物にも含まれていません',
  'build.cycle': '参照が循環しています: {chain}',
  'build.missing': '参照先が見つかりません: {target}',
  'build.unknownDocument': '文書番号 {document} の文書が見つかりません',
  'build.missingRange': '名前付き範囲が見つかりません: {rows}',
  'build.unreadableImage': '画像を読めません: {path}',
  'build.notSlide': 'スライドにできない参照です: {path}',
  'build.notSlideCaptioned': 'スライドにできない参照です: {path}（{caption}）',
  'build.writeback.missing': '読み戻す先の図が見つかりません',
  'build.writeback.extraShape': 'スライドにある図形が図にありません: {id}（PowerPoint で追加したものは読み戻せません）',
  'build.writeback.formatted': '{id}: 書式付きのラベルを書き換えると書式が失われます（{from} → {to}）',
  'build.writeback.text': '{id} の文字を「{text}」に',
  'build.writeback.moved': '{ids} の位置を更新',
  'build.writeback.unreadable': '読み戻せない図形があります: {id}',
  'build.writeback.edgeLabel': '{from} → {to} の線のラベルが「{was}」から「{now}」に変わっていますが、線のラベルはまだ読み戻せません（図で直してください）',
  'build.writeback.table': '{slide} 枚目の表（{path}）が PowerPoint で書き換えられていますが、表は読み戻せません（{path} を直してください）',

  // --- writing tables out for programs (table-export.ts) ---------------------------
  'build.tableExport.noRange': '名前付き範囲 {range} がありません',
  'build.tableExport.collision': '{file} は {other} の書き出しと重なります',

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

  'build.tableExport.noRange': 'No named range {range}',
  'build.tableExport.collision': '{file} is also where {other} is written',
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
