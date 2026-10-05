# DocPresenter

Git の差分がレビューになる設計書のための道具。文章は Markdown、図と表はそれぞれの記法のファイルで、
**編集はすべて 1 つのバイト範囲の置き換え**として書き戻される。

## パッケージ

[分割の理由と境界は packaging.md](design/packaging.md)。依存は一方向に流れる。

| パッケージ | 中身 | 単独公開 |
|---|---|:--:|
| `packages/base` | バイト範囲・編集・inline 記法・共通 UI 部品 | 土台 |
| `packages/diagram` | 作図：記法・レイアウト・SVG 描画・部品ライブラリ・キャンバス GUI | **する** |
| `packages/markdown` | 文書エンジン：Markdown・表・採番・HTML 描画（画面を持たない） | **する** |
| `packages/pdf` | PDF：ページ計画・組版済み DOM の読み取り・改ページ・書き出し | 製品の一部 |
| `packages/pptx` | PPTX：デッキ・DrawingML・書庫 | 製品の一部 |
| `packages/build` | ビルド：ルート探索・参照閉包・診断・成果物の書き出し | 製品の一部 |
| `packages/editor` | 設計書の編集 UI：シート・本文ブロック・表のグリッド | 製品の一部 |

## 動かす

Node 22 以上。**PDF を書くときだけ**、この機械の Chromium 系ブラウザ（Chrome / Edge /
Chromium のどれか）と日本語フォントを使う——組版はブラウザにさせ、字は PDF に埋め込む
ためである。どちらも既定の置き場所を順に探し、見つからなければ**どこを探したかを言って
HTML と PPTX だけを書く**（黙って PDF を落とさない）。別の場所にあるなら名前で渡す。

```
node tools/build.mjs --in sample --chromium "C:\Program Files\Google\Chrome\Application\chrome.exe"
node tools/build.mjs --in sample --font "C:\Windows\Fonts\YuGothR.ttc"
# 環境変数 DOCPRESENTER_CHROMIUM / DOCPRESENTER_FONT でも同じ
```

```
npm install
npm test                        # 単体テスト
npx tsc --build                 # 型検査とビルド

node tools/build-editor-demo.mjs   # 設計書の編集画面   → out/editor.html（PDF のボタン付き）
node tools/build-canvas-demo.mjs   # 作図だけのページ   → out/canvas-app.html
node tools/build.mjs --in sample   # サンプルをビルド     → out/build/*.{html,pdf,pptx}
                                  #   長い表はページをまたぎ、`{page="landscape"}` の表は横向きのページになる
node tools/build.mjs --in sample --diff-from HEAD~3   # 前の版からの変更に印を付ける
node tools/pptx-back.mjs out/build/auth-overview.pptx --in sample   # 直された図を読み戻す

node tools/check-spec.mjs          # 仕様と実装が一致しているか
for f in tools/check-*.mjs; do node "$f"; done   # 全検証（上の 3 つを先に走らせておく）
```

`out/canvas-app.html` は base ＋ diagram だけで作られている。文書エンジンは 1 バイトも入っていない
（`out/canvas/index.html` はそれを 1 枚に畳んだもの）。

## 仕様

`.dgm` と `.table` の仕様は **英語で [`spec/`](spec/README.md) にあります**。
この 2 つの形式は[ライセンスの対象外](legal/LICENSE.draft.md)で、**誰がどの言語で実装しても構いません**。

| | |
|---|---|
| [`spec/dgm.md`](spec/dgm.md) | 作図：図形・接続・手で置いた位置・スタイル |
| [`spec/table.md`](spec/table.md) | 表：結合セル・ブロック・名前付き範囲・スタイル |
| [`spec/inline-text.md`](spec/inline-text.md) | ラベルとセルの中で使える書式 |

## ライセンス

**ソースは公開していますが、オープンソースではありません。**
再配布は自由、改変は許諾していません（ビルド・バンドル・最小化は改変に当たりません）。

| | |
|---|---|
| [`legal/LICENSE.draft.md`](legal/LICENSE.draft.md) | 条文のドラフト。**まだ効力を持ちません**（法務確認前） |
| [`legal/CLA.draft.md`](legal/CLA.draft.md) | 貢献の許諾のドラフト。著作権は貢献者が持ったままです |
| [design/licensing.md](design/licensing.md) | 方針とその理由 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 報告と PR の手順 |

## 設計

決定事項は [design/decisions.md](design/decisions.md) に集約してある。未実装の一覧は
[design/backlog.md](design/backlog.md)、まだ決めていないことは [design/open-issues.md](design/open-issues.md)。
