// The diagram extension's words. See packages/base/src/i18n.ts for how messages
// work. What package.json contributes is in package.nls*.json.

import { defineMessages } from '@docpresenter/base';

export const DIAGRAM_EXTENSION_MESSAGES = defineMessages({
  'diagramExt.notDiagram': '図（.dgm）を開いてから実行してください',
  'diagramExt.rename.notShape': '図形の名前（id）の上で実行してください',
  'diagramExt.rename.title': '{id} の名前を変える（線・配置・見た目・項目一覧も一緒に変わります）',
  'diagramExt.format.unreadable': '{path} を読めないため、整形しませんでした: {message}',
  'diagramExt.format.done': '{path} を整形しました',
  'diagramExt.format.already': '{path} はすでに整形されています',
  'diagramExt.svg.unreadable': '{path} を読めないため、書き出しませんでした: {message}',
  'diagramExt.svg.saveLabel': 'SVG に書き出す',
  'diagramExt.picture.open': 'この画像にする',
  'diagramExt.picture.filter': '画像',
  'diagramExt.screen.notFree': '書き出せるのは画面（free）の図だけです。流れ図には画面の部品がありません',
  'diagramExt.screen.saveHtml': 'HTML に書き出す',
  'diagramExt.screen.saveXaml': 'XAML（WPF）に書き出す',
  'diagramExt.screen.open': '開く',
  'diagramExt.svg.done': '{path} に書き出しました',
  'diagramExt.canvas.unreadable': 'この図は読めません。テキストで直すと描き直します: {message}',
  'diagramExt.mermaid.failed': '変換できませんでした: {message}',
  'diagramExt.mermaid.nothing': 'Mermaid の flowchart を開くか、選んでから実行してください',
  'diagramExt.mermaid.notes': '変換しました。持っていけなかったもの: {notes}',
}, {
  'diagramExt.notDiagram': 'Open a drawing (.dgm) first',
  'diagramExt.rename.notShape': 'Put the cursor on the name (id) of a shape first',
  'diagramExt.rename.title': 'Rename {id} (its lines, layout, look and item table follow)',
  'diagramExt.format.unreadable': '{path} could not be read, so it was not formatted: {message}',
  'diagramExt.format.done': 'Formatted {path}',
  'diagramExt.format.already': '{path} is already formatted',
  'diagramExt.svg.unreadable': '{path} could not be read, so nothing was exported: {message}',
  'diagramExt.svg.saveLabel': 'Export as SVG',
  'diagramExt.picture.open': 'Use this picture',
  'diagramExt.picture.filter': 'Pictures',
  'diagramExt.screen.notFree': 'Only a screen (free) drawing can be written out; a flow has no controls',
  'diagramExt.screen.saveHtml': 'Export as HTML',
  'diagramExt.screen.saveXaml': 'Export as XAML (WPF)',
  'diagramExt.screen.open': 'Open',
  'diagramExt.svg.done': 'Exported {path}',
  'diagramExt.canvas.unreadable': 'This drawing cannot be read. Fix the text and it is drawn again: {message}',
  'diagramExt.mermaid.failed': 'Could not convert: {message}',
  'diagramExt.mermaid.nothing': 'Open or select a Mermaid flowchart first',
  'diagramExt.mermaid.notes': 'Converted. What could not be carried across: {notes}',
});

export type DiagramExtensionMessage = (typeof DIAGRAM_EXTENSION_MESSAGES.ids)[number];
