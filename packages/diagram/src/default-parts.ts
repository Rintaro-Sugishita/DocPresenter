import { stencilParts } from './draw/stencil.js';

// The parts every screen needs, shipped with the tool.
//
// A system's own look belongs in that system's own library — that is what
// `parts { … }` in a file of the workspace is for. But nobody should have to
// write one before they can draw their first screen, and the first screen
// someone draws is the one that tells them what they actually want. So this set
// is here to be used immediately and overridden later: a drawing that says
// `use "default"` and then declares a part of its own gets its own.
//
// It is a string rather than a file because it has to be there in every shell —
// the command line, the editor in a browser with no folder open, a test with a
// workspace held in a map. A file would be missing in two of the three.

/** The name a drawing writes to reach the set below. */
export const DEFAULT_LIBRARY = 'default';

/**
 * The name a drawing writes to get one part per shipped picture.
 *
 * "What pictures are there" is a question best answered by showing them, and a
 * library already draws itself. So the answer is a library: `use "icons"` in a
 * file of its own, imported into the document, prints every picture with the
 * name to write for it.
 */
export const ICON_LIBRARY = 'icons';

/** That library, built from the pictures rather than written out beside them. */
export function iconParts(): string {
  const lines = stencilParts().map(part => {
    const size = part.fit ?? { width: 24, height: 24 };
    return `  ${part.name.replace(/\//g, '-')} [ ] `
      + `{ icon: ${part.name} } ${size.width}x${size.height}`;
  });
  return `# 同梱の絵（自動生成）\n\nparts {\n${lines.join('\n')}\n}\n`;
}

export const DEFAULT_PARTS = `# 同梱の画面部品
# 自分のシステムの見た目は、作業場の parts ファイルに書いて上書きする。

parts {
  # --- 面 ---
  frame      [ ] { fill: #ffffff, line: #d3d7dd }                380x300
  panel      [ ] { fill: #f7f8fa, line: #d3d7dd }                320x120
  banner     [ ] { fill: #eef3f9, line: #c3d3e6 }                320x56
  alert      [ ] { fill: #fdecea, line: #e9a8a2 }                320x56

  # --- 文字 ---
  title      "" { color: #1c1f24 }                               320x24
  label      "" { color: #3a4048, align: left }                  320x18
  body       "" { color: #3a4048, align: left }                  320x32
  hint       "" { color: #8b929c, align: left }                  320x16
  error      "" { color: #b3261e, align: left }                  320x36
  link       "" { color: #1f5fa8, align: right }                 320x16
  required   "" { color: #b3261e }                                16x18

  # --- 入力 ---
  textbox    [ ] { fill: #fbfbfc, line: #aeb4bd, align: left }   320x34
  textarea   [ ] { fill: #fbfbfc, line: #aeb4bd, align: left }   320x90
  select     [ ] { icon: ui/select }                             160x34
  spinner    [ ] { icon: ui/spinner }                            120x34
  slider     [ ] { icon: ui/slider }                             160x24
  checkbox   [ ] { icon: ui/check }                               16x16
  checked    [ ] { icon: ui/check-on }                            16x16
  radio      [ ] { icon: ui/radio }                               16x16
  selected   [ ] { icon: ui/radio-on }                            16x16

  # --- ボタン ---
  primary    ( ) { fill: #2f6fb5, line: #2f6fb5, color: #ffffff } 320x38
  secondary  ( ) { fill: #ffffff, line: #aeb4bd, color: #3a4048 } 320x38
  danger     ( ) { fill: #b3261e, line: #b3261e, color: #ffffff } 320x38

  # --- 一覧 ---
  # 行数や列数は画面ごとに違うので、絵は「表がここに入る」ことだけを言う。
  # 中にほかの部品を置くのは、座標で重ねれば今でもできる。
  grid       [ ] { icon: ui/grid }                               240x120

  # --- 中身を行で持つもの ---
  # 行は図形ではないので id を持たない。項目定義が要るのはこの 1 つである。
  tree       [ ] { icon: ui/tree }                               200x240
  list       [ ] { icon: ui/list }                               200x160
  menu       [ ] { icon: ui/menu }                               320x28

  # --- 線 ---
  # つなぐ線ではなく、仕切る線・指し示す線。太さ・色・矢印は部品の側で決める。
  divider    -- { line: #d3d7dd }                                320x0
  dividerV   -- { line: #d3d7dd }                                  0x120
  pointer    -- { line: #3a4048, arrow: end }                    120x0
  guide      -- { line: dashed }                                 160x0

  # --- 飾り・見せるもの ---
  scrollbar  [ ] { icon: ui/scrollbar-v }                         12x120
  scrollbarH [ ] { icon: ui/scrollbar-h }                        120x12
  image      [ ] { icon: ui/image }                              120x90
  icon       [ ] { icon: net/router }                             24x24
}
`;
