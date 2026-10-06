# DocPresenter（VS Code 拡張）

設計書（`.md` ＋ `.dgm` ＋ `.table`）を、VS Code の中で**画面のまま**編集する。

- `.md` を開いて **「DocPresenter: この文書を開く」**。シートが並び、図や表はその場で編集できる。
- 編集は **1 操作 ＝ 1 つのバイト範囲**として書き戻される。VS Code の取り消し・未保存の点・git の差分が
  そのまま効くのは、編集を `WorkspaceEdit` として渡しているからである。
- **「DocPresenter: ビルド」** で HTML と PPTX を `out/build`（設定で変更可）に書く。

## 作る

```
npx tsc --build                  # 型検査（packages/app-vscode を含む）
node tools/build-vscode.mjs      # media/extension.cjs ＋ webview.js ＋ theme.css
```

## 試す

リポジトリを VS Code で開いて **F5**（`npm run build:vscode` でビルドしてから、標本の `sample/` を
開いた拡張ホストが立ち上がる）。

## 配る

```
cd packages/app-vscode && npx @vscode/vsce package --no-dependencies
code --install-extension docpresenter-0.1.0.vsix
```

## この版でやらないこと

| | |
|---|---|
| **PDF** | 組版はブラウザにさせる作りで、WebView をその用途で使うのは次の段。いまは `node tools/build.mjs` を使う |
| **部品ライブラリの編集** | 画面からは選べるが、部品そのものはソースで書く |
