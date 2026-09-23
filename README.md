# DocPresenter

Git で差分管理できる、システム開発ドキュメントのためのツール。

Markdown を 1 次ソースとして、作図・外部ファイル参照・複雑なテーブルを扱い、
**HTML / PDF / PPTX** を同一ソースから生成する。Web とエディタ（VS Code）の
双方で編集でき、成果物も中間ファイルも人間がレビューできる形で保つことを狙う。

> 現在は企画・調査フェーズです。

## スコープ

**対象は「新規に Markdown で書き始めるチーム」**。既存 Excel 設計書のインポート、および
Word / Excel 形式での出力はスコープ外とする（[判断の根拠](docs/research/excel-migration-japan.md#0-決定事項ロック済み)）。

## 目指すもの

ファイルの読者は**人間と AI の二人**であり、どちらも**ソースファイルそのもの**を読める状態を土台に置く。

| # | 要件 |
|---|---|
| R1 | Markdown 記法による文章構築 |
| R2 | 簡便さと複雑さを兼ね備えた作図 |
| R3 | 外部ファイル参照 |
| R4 | HTML 化 |
| R5 | PDF 化 |
| R6 | PPTX 化（編集可能な PowerPoint） |
| R7 | 複雑なテーブル（セル結合など） |
| R8 | Web / VS Code 双方での編集 |
| R9 | AI が正確に読めること（機械可読出力） |
| R10 | Git を使わない参加者がレビューできること |
| R11 | 図表・章番号の自動採番と相互参照 |
| R12 | 横断一覧とトレーサビリティの生成 |

詳細と設計制約は [要件定義](design/requirements.md) を参照。

## 実装状況

| パッケージ | 内容 |
|---|---|
| `packages/core` | `.md` / `.table` のパーサとモデル、採番と参照解決、診断 |
| `packages/render` | HTML レンダラ（ソースマップを `data-span` として埋め込む） |
| `themes/default` | 既定テーマ（スタイルトークンを解決する CSS） |

`node tools/render-sample.mjs` で [サンプル](sample/) を `out/auth-design.html` に描画できる。

## 検証

- [日本語テキストが選択可能な PDF を出せるか](prototype/pdf-text/FINDINGS.md) — 検証済み・問題なし
- [表ごとに用紙を横向きにできるか](prototype/paged-landscape/FINDINGS.md) — 検証済み・別パス方式で可能
- [表のページ分割とヘッダ行の繰り返し](prototype/table-paging/FINDINGS.md) — 検証済み・自前分割で可能

## ドキュメント

- [既存サービス調査](docs/research/existing-solutions.md) — 先行事例の棚卸しと、DocPresenter が埋めるべきギャップ
- [Excel 脱却要求の整理と要件の充足性検証](docs/research/excel-migration-japan.md) — 日本市場の要求と、要件の過不足・スコープ判断
- [要件定義](design/requirements.md) — 二つの軸（人間可読性・機械可読性）と R1〜R11
- [決定事項の総覧](design/decisions.md) — これまでの決定を一箇所に集約
- [未決事項の一覧](design/open-issues.md) — 各設計ドキュメントの未決事項を集約し、着手順に整理
- [作図モデル設計案](design/diagram-model.md) — PPTX / draw.io / Mermaid の「いいとこ取り」
- [表モデル設計案](design/table-model.md) — セル結合・罫線・セル内 Markdown
- [レビューモデル設計案](design/review-model.md) — 顧客が PDF に注釈を書く体験のまま、構造を復元する
- [編集 UI 設計案](design/editor-model.md) — Markdown に浮く埋め込みオブジェクト
- [参照記法の比較](design/reference-syntax.md) — 埋め込みオブジェクトをどう書くか
- [横断一覧設計案](design/index-model.md) — インデックスと一覧生成
- [ビルド単位設計案](design/build-model.md) — 何を出力対象とし、何を集めるか
- [出力モデル設計案](design/output-model.md) — ページとスライドの区切り
- [テーマ設計案](design/theme.md) — フォントとページ設計
- [PPTX 出力設計案](design/pptx-model.md) — スライド分割とレイアウト
- [PDF 生成エンジンの比較検討](design/pdf-engine.md) — ブラウザ組版と Typst
- [実装スタックと言語境界](design/stack.md) — TypeScript をどこまで広げるか
- [提供形態](design/platforms.md) — デスクトップ・Web・CLI と改訂履歴
- [ライセンス方針](design/licensing.md) — 本体は非オープンソース、中継サーバのみ公開
- [サーバの位置づけ](design/server-architecture.md) — 同時編集とコメント収集をどう扱うか
