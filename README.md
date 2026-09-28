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
| `packages/editor` | 設計書の編集 UI：シート・本文ブロック・表のグリッド | 製品の一部 |

## 動かす

```
npm install
npm test                        # 単体テスト
npx tsc --build                 # 型検査とビルド

node tools/build-editor-demo.mjs   # 設計書の編集画面   → out/editor.html
node tools/build-canvas-demo.mjs   # 作図だけのページ   → out/canvas-app.html
node tools/render-sample.mjs       # サンプルを HTML に → out/auth-design.html

for f in tools/check-*.mjs; do node "$f"; done   # ブラウザ検証
```

`out/canvas-app.html` は base ＋ diagram だけで作られている。文書エンジンは 1 バイトも入っていない
（`out/canvas/index.html` はそれを 1 枚に畳んだもの）。

## ライセンス

**ソースは公開していますが、オープンソースではありません。**
再配布は自由、改変は許諾していません（ビルド・バンドル・最小化は改変に当たりません）。
`.dgm` と `.table` の**記法そのものは誰が実装しても構いません**。
方針は [design/licensing.md §6](design/licensing.md)、貢献の手順は [CONTRIBUTING.md](CONTRIBUTING.md) にあります。

## 設計

決定事項は [design/decisions.md](design/decisions.md) に集約してある。未実装の一覧は
[design/backlog.md](design/backlog.md)、まだ決めていないことは [design/open-issues.md](design/open-issues.md)。
