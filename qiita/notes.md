# Qiita 記事の投稿メモ

本文は `article.md`。Qiita の本文欄には `article.md` の中身を全部そのまま貼る。

## Qiita の入力欄

- タイトル：ソースは差分レビューするのに設計書はできない、をなんとかしたかった
- タグ：設計書, Git, VSCode, ドキュメント, レビュー

## 公開状況（2026-11-17 時点）

- VS Code 拡張 0.1.3 で、変更箇所付き出力（「変更箇所付き…」ボタン）と「表を Excel で開く」が公開された。記事の内容は 0.1.3 の README と合っている。
- スクリーンショット `6-changes.png` も main にあり、記事に入れた。
- **CLI はまだ未公開**（`packages/cli` は `private: true`）。記事では「予定」とだけ書いている。npm で公開したら、表現を見直す。
- 拡張の README.ja.md の変更箇所の節にある CLI の例 `docpresenter build … --diff-from` は、サブコマンド名が誤り（正しくは `export`）。

## 確認済みの事実

- PDF の注釈の取り込み、回答の PDF への掲載、PPTX からの読み戻し、ラベルと項目一覧の連動、型の候補は、公開済みの拡張にある。
- シーケンス図は Mermaid で描ける（` ```mermaid ` と `.mmd`）。
- D2 は Go 製（Dart ではない）。
- 記事の画像 6 枚（`dgm-flow`, `2-canvas`, `3-table`, `4-fields`, `5-choices`, `6-changes`）は main ブランチにある。
