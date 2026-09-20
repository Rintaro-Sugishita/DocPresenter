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

## ドキュメント

- [既存サービス調査](docs/research/existing-solutions.md) — 先行事例の棚卸しと、DocPresenter が埋めるべきギャップ
- [Excel 脱却要求の整理と要件の充足性検証](docs/research/excel-migration-japan.md) — 日本市場の要求と、要件の過不足・スコープ判断
- [作図モデル設計案](design/diagram-model.md) — PPTX / draw.io / Mermaid の「いいとこ取り」
