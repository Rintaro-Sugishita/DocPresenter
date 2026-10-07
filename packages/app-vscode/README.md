# DocPresenter（VS Code 拡張）

設計書（`.md` ＋ `.dgm` ＋ `.table`）を、VS Code の中で**画面のまま**編集する。

## 始める

新しいリポジトリでは、コマンド **「DocPresenter: 作業場を初期化する」** を実行する。題・ファイル名・文書番号を
聞いたあと、次のものを置いて最初の文書を開く。**既にあるファイルは書き換えない**（そのままと報告する）。

```
docs/<ファイル名>.md            最初の文書。frontmatter・概要（目的・対象範囲・用語）・改訂履歴の取り込みまで書いてある
docs/<ファイル名>/revision.md   その文書の改訂履歴
docs/assets/                   画像の置き場
shared/glossary.table          複数の文書から引く用語集
.docpresenter/guide.md         書き方の仕様書（Claude Code などのエージェント向け）
.docpresenter/spec/            .dgm・.table・ラベル内書式の形式の仕様
CLAUDE.md / AGENTS.md          guide.md を読むよう指示する節を追記（無ければ作る）
.gitignore                     書き出し先（out/）を追記
```

追記は一度だけなので、もう一度実行しても増えない。

## 開く

- エクスプローラーで `.md` か `.dgm` を右クリック → **「DocPresenter で開く」**。エディタ右上のボタンからも開ける。
  - `.md` はシートが並び、図や表はその場で編集できる。
  - `.dgm` はその図だけを開く。図を押すと編集できる。書き換わるのはその `.dgm` だけである。
- 編集は **1 操作 ＝ 1 つのバイト範囲**として書き戻される。VS Code の取り消し・未保存の点・git の差分が
  そのまま効くのは、編集を `WorkspaceEdit` として渡しているからである。

## 図表の名前を変える

図や表に乗ると右上に **「名前・題・ラベル」** が出る（図の上で右クリックしても同じ）。3 つをまとめて変えられる。

| 変えるもの | 書き換わるところ |
|---|---|
| **ファイル名** | ファイルが同じフォルダの中で改名され、**この文書とほかの文書の `@import` 行**が新しい名前を指す。フォルダと拡張子は変わらない |
| **題** | `@import` 行の `caption="…"`。番号（図 3 など）は自動で前に付く。空にすると題を外す |
| **ラベル** | `@import` 行の `#fig-…` と、**本文のすべての `@fig-…`**。図は `fig-`、表は `tbl-` で始める |

- 書き換わるのは名前が書かれた行だけで、文書は 1 つの編集として書き戻される（取り消しも 1 回）。ほかの文書の書き換えとファイルの改名は、まとめて 1 つの `WorkspaceEdit` になる。
- 使えない名前（同じ文書で使われているラベル、本文から参照されているラベルを外す、すでにあるファイル名など）は、理由を言って断る。
- ラベルの参照を直すのは**この文書の中だけ**。別の文書から `@文書:ラベル` で参照しているものは直らない。
- `.dgm` の中からほかのファイルを指している行（`overlay` の画像、部品ライブラリ）は直らない。

## 書き出す

| やりたいこと | 操作 |
|---|---|
| 開いている文書を 1 つの形式で | 文書の上の **「書き出し: HTML / PDF / PPTX」**。エディタ右上の「…」メニュー、コマンド「DocPresenter: この文書を PDF に書き出す」なども同じ |
| `output:` を持つ文書をすべて、各文書の指定どおりに | コマンド **「DocPresenter: 出力対象をすべて書き出す（各文書の output: どおり）」** |
| `output:` を持つ文書をすべて、形式を指定して | コマンド **「DocPresenter: 出力対象をすべて、形式を指定して書き出す…」**（HTML / PDF / PPTX から選ぶ。`output:` より優先） |

- 書き出し先は `out/build`（設定 `docpresenter.outDir` で変更可）。
- PDF の組版は DocPresenter の画面がする。まとめて書き出すときは「DocPresenter 書き出し」という画面が横に開き、
  終わると閉じる。フォントはこの PC のもの（Windows では游ゴシック、コードは MS ゴシック）を埋め込む。

## コードと Mermaid

- コードブロックは言語名（` ```sql ` など）で色が付き、上に言語名が出る。DocPresenter の画面では、
  その横の **「コピー」** でコードブロックの全文をコピーできる。
- ` ```mermaid ` と `.mmd` は図になる。ブロックにマウスを載せると右上に **「図 / コード / 両方」** の切り替えが出る。
  押すと `{view="…"}` がファイルに書かれ、書き出した HTML・PDF・PPTX もそのとおりになる。

### 色が付く言語

開きの行に書く言語名（別名も可）。これ以外の名前は色を付けず、書いた名前をそのまま上に出す。

| 言語 | 書ける名前 |
|---|---|
| Bash / シェル | `bash` `sh` `zsh` `shell` `console` |
| PowerShell | `powershell` `ps` `ps1` |
| JavaScript | `javascript` `js` `jsx` `mjs` `cjs` |
| TypeScript | `typescript` `ts` `tsx` `mts` `cts` |
| JSON | `json` |
| YAML | `yaml` `yml` |
| XML / HTML / SVG | `xml` `html` `xhtml` `svg` |
| CSS | `css` |
| SQL | `sql` |
| Python | `python` `py` |
| Java | `java` |
| Kotlin | `kotlin` `kt` |
| C# | `csharp` `cs` `c#` |
| Go | `go` `golang` |
| Diff | `diff` `patch` |
| INI / TOML | `ini` `toml` |
| Dockerfile | `dockerfile` `docker` |
| Markdown | `markdown` `md` |
| テキスト（色なし） | `plaintext` `text` `txt` |
| Mermaid（図になる） | `mermaid` |

## 作る

```
npx tsc --build                  # 型検査（packages/app-vscode を含む）
node tools/build-vscode.mjs      # media/ に extension.cjs ＋ webview.js ＋ exporter.js ＋ theme.css ＋ mermaid-page.js ＋ harfbuzz-subset.wasm
```

## 表示言語

**VS Code の表示言語に従う。** 日本語なら日本語、それ以外は英語になる（コマンド名・設定の説明・通知・
編集画面・書き出した文書の表紙や目次まで）。切り替えは VS Code の「Configure Display Language」で行い、
この拡張に専用の設定は無い。

- 拡張ホストの文言は `src/messages.ts`、`package.json` の文言は `package.nls.json`（英）/ `package.nls.ja.json`（日）。
- 編集画面（WebView）へは、`open` メッセージの `locale` で同じ言語を渡す。
- 「作業場を初期化する」で置く最初の文書・用語集・`CLAUDE.md` への追記も、その言語で書く
  （`.docpresenter/guide.md` は今のところ日本語のみ）。

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
| **PDF をまとめて書く** | まとめてのビルドには組版する画面が無いので、PDF は文書ごとにボタンで書く。まとめて書くなら `node tools/build.mjs` |
| **PowerPoint で Mermaid を編集** | Mermaid の図は画像で載る。PowerPoint で動かせる図形にしたいなら `.dgm` で描く |
| **部品ライブラリの編集** | 画面からは選べるが、部品そのものはソースで書く |
