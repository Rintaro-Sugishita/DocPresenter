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

詳細と設計制約は [要件定義](design/requirements.md) を参照。

## ドキュメント

- [既存サービス調査](docs/research/existing-solutions.md) — 先行事例の棚卸しと、DocPresenter が埋めるべきギャップ
- [Excel 脱却要求の整理と要件の充足性検証](docs/research/excel-migration-japan.md) — 日本市場の要求と、要件の過不足・スコープ判断
- [要件定義](design/requirements.md) — 二つの軸（人間可読性・機械可読性）と R1〜R11
- [未決事項の一覧](design/open-issues.md) — 各設計ドキュメントの未決事項を集約し、着手順に整理
- [作図モデル設計案](design/diagram-model.md) — PPTX / draw.io / Mermaid の「いいとこ取り」
- [表モデル設計案](design/table-model.md) — セル結合・罫線・セル内 Markdown
- [レビューモデル設計案](design/review-model.md) — 顧客が PDF に注釈を書く体験のまま、構造を復元する
- [編集 UI 設計案](design/editor-model.md) — Markdown に浮く埋め込みオブジェクト
- [参照記法の比較](design/reference-syntax.md) — 埋め込みオブジェクトをどう書くか
- [サーバの位置づけ](design/server-architecture.md) — 同時編集とコメント収集をどう扱うか
