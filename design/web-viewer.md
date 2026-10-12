# Web 版の閲覧ページ — GitHub の URL を渡してプレビューする（引き継ぎメモ）

2026-10-13 記。VS Code 拡張側の作業（フォルダ分け・テンプレート・テーマ・新しい図のコマンドまで）を
コミットした時点で、Web 版の実装をクラウドのセッションに引き継ぐためのメモ。**段階 1 は実装済み（§6）。**

## 0. 目的

**誰でも設計書を読めるようにする。** GitHub に上がっている `.md`（または `.dgm`）の URL を渡すと、
DocPresenter の組版でそのままプレビューが出るページを作る。VS Code も Git も無い人（顧客・他部署）が対象。

## 1. 決まっていること

| 項目 | 決定 | 根拠 |
|---|---|---|
| 進め方 | **段階 1 から**：公開リポジトリの URL を貼るとプレビューできる閲覧ページ（**サーバ無し**） | ユーザー合意（2026-10-12） |
| 段階 2 | 認証中継を使った非公開リポジトリ対応 | [提供形態 §3.2](platforms.md) |
| 段階 3 | ブラウザ上でのレビュー指摘（後回しにした「案 B」と合流） | [サーバの位置づけ](server-architecture.md) / [レビューモデル §9.6](review-model.md) |
| Web 版の位置づけ | 「お試しと閲覧」が既定 | [decisions.md](decisions.md) |
| 中身の経路 | **設計書の中身はサーバを通さない**。GitHub REST API と raw 配信は CORS 対応なのでブラウザから直接読む | [提供形態 §3.2 制約 2](platforms.md) |

## 2. 段階 1 の仕様（案）

### 2.1 入口

- 閲覧ページ `…/view.html?src=<GitHub の URL>`。共有リンクとしてそのまま配れる形にする。
- 受け付ける URL：
  - `https://github.com/<owner>/<repo>/blob/<ref>/<path>`（ブラウザで見ている URL をそのまま貼れる）
  - `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>`
  - 余力があれば `…/tree/<ref>/<folder>`（フォルダの文書一覧を出す）
- URL 入力欄のある最初の画面も用意する（`src` が無いとき）。

### 2.2 ref とパスの切り分け（要注意）

ブランチ名に `/` が入る（このリポジトリの既定ブランチ自体が `claude/docpresenter-service-6rm7u3`）ので、
`blob/<ref>/<path>` は URL だけでは切れない。

- `GET /repos/{owner}/{repo}/branches` と `/tags`、または `GET /repos/{owner}/{repo}/commits/{候補}` を
  長い候補から順に試して、存在する最長の ref を採る。
- 40 桁の SHA ならそのまま。
- 解決した ref は**コミット SHA に固定**して表示する（画面に SHA を出す）。レビューの指摘はコミットに
  結び付く（[review-model.md](review-model.md)）ので、それと揃う。共有リンクも SHA 付きにできるようにする。

### 2.3 ファイルの集め方

**`Workspace.read` は同期**（[packages/build/src/workspace.ts](../packages/build/src/workspace.ts)）なので、
ビルドを呼ぶ前に必要なファイルを全部取ってきて、メモリ上の `Workspace` を作る。

- 取得は `https://raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>`（API の回数制限にかからない）。
- 何を取るか：
  1. 渡された文書。
  2. その `@import` を再帰的にたどったもの（`.md` `.dgm` `.table` `.mmd`、`overlay` の画像、部品ライブラリ）。
     パスは**取り込む側のファイルからの相対**で解決する。
  3. 画像（png/jpg/gif/svg）は `dataUrl()` 用にバイトで取り、`data:` URL にする。
  4. テーマ：`.docpresenter/themes/<theme>/theme.css` → `themes/<theme>/theme.css` → 同梱、の順
     （`themeOf`/`themePaths`、[build.ts](../packages/build/src/build.ts)）。
  5. 他文書への参照 `@文書番号:ラベル` を解決するなら、リポジトリの `.md` 一覧が要る →
     `GET /repos/{o}/{r}/git/trees/{sha}?recursive=1` を **1 回だけ**呼んで一覧を得る（認証なしで 60 回/時の制限内）。
     一覧は `Workspace.list()` にもそのまま使える。
- `@import` をたどる処理は、ビルドのグラフ読み（[graph.ts](../packages/build/src/graph.ts)）と同じ規則で。
  可能ならグラフ側に「足りないパスを返す」関数を足して、取得 → 再読込を不足が無くなるまで回す形にすると、
  規則が二重にならない。

### 2.4 表示

- ビルドの HTML 出力（`build(workspace, { formats: ['html'] })`）をそのまま iframe か本体に出すのが最短。
- 余力があれば、シート表示（[packages/editor](../packages/editor/)）の**閲覧モード**で出す。編集は無効。
- PDF はブラウザで組版して書き出せる（[pdf-engine.md §7.7](pdf-engine.md)、デモ画面のボタンで実績あり）。
  「PDF をダウンロード」ボタンを付ける。
- Mermaid は `@docpresenter/editor/mermaid` の描画を使う。
- 言語は [tools/web-shell/locale.mjs](../tools/web-shell/locale.mjs) の仕組み（初回に尋ねて localStorage、`?lang=`）を使う。

### 2.5 失敗の出し方

黙らない。どれも画面に理由を出す。

| 状況 | 出すこと |
|---|---|
| 非公開リポジトリ・存在しない（404） | 「公開されていないか、見つかりません」。段階 2（ログイン）の予告 |
| API の回数制限（403、`x-ratelimit-remaining: 0`） | 解除される時刻（`x-ratelimit-reset`） |
| 取り込み先が無い | ビルドの診断（diagnostics）をそのまま一覧で |
| 文書でない URL | 受け付ける URL の形を示す |

### 2.6 置き場所と配信

- 静的ページだけで成り立つので GitHub Pages などに置ける。サーバは要らない。
- ソースは新しいパッケージ `packages/app-web`（[backlog.md](backlog.md) #10）。束ねは既存の
  [tools/build-editor-demo.mjs](../tools/build-editor-demo.mjs)（rolldown で 1 枚の HTML にしている）を手本にする。
- フォントは閲覧者の PC のものを使う（PDF に埋め込むのも閲覧者のフォント）。

## 3. 検証の手順

- 単体テスト（vitest）：URL の切り分け（`/` 入りのブランチ・タグ・SHA・raw URL）、`@import` の閉包の収集
  （`fetch` を差し替えて、フォルダ分けした文書・`../../shared/` の参照・画像を含める）。
- 実物：このリポジトリ（公開にするか、公開の検証用リポジトリを用意）の `sample/docs/auth-design.md` と、
  フォルダ分けした文書（`docs/<領域>/<名前>.md`）を開いて、VS Code 拡張の書き出しと同じ見た目になること。
- Playwright で画面を確かめる既存のやり方は `tools/check-*.mjs` / `tools/shot-*.mjs` を参照。

## 4. 決まったこと（2026-10-12）

| 項目 | 決定 |
|---|---|
| 公開先 | **このリポジトリの GitHub Pages**。`https://rintaro-sugishita.github.io/DocPresenter/view.html?src=<GitHub の URL>`（`/DocPresenter/` 直下でも同じページが開く）。配信は `.github/workflows/pages.yml` |
| ドメイン | 取得しない。`github.io` のまま |
| `.dgm` 単体の URL | **受け付ける**。図だけを 1 枚の文書として出す（その場で `@import` 1 行の文書を組み立てる） |
| `tree/` の URL | **段階 1 に入れる**。フォルダの下の `.md` と `.dgm` を一覧にし、押すとその文書を開く |

残る検討：非公開リポジトリの閲覧者に GitHub アカウントを求めない手段（書き出した HTML/PDF の配布、案 B のサーバ）は段階 3 で。

## 5. 引き継ぎ時点の状態

- ブランチ：`claude/docpresenter-service-6rm7u3`（既定ブランチ）。テスト 687 件・`tools/check-*.mjs` は全件通過。
- VS Code 拡張の配布用パッケージは `tools\package-vscode.bat`（`out/vsix/` に出る）。
- 直近で入ったもの（Web 版にも関係する）：
  - 書き出しはフォルダの構成を保つ（`outputStem`、`docs/` は付けない）。
  - テーマは `.docpresenter/themes/` を優先（`themeOf`）。
  - テンプレートの差し込み口 `{{root}}`（リポジトリ直下への相対パス）。
  - PDF にはレビュー指摘と回答が注釈として入る（`docpresenter.pdfReviewNotes`）。閲覧ページの PDF も同じ経路を通る。

## 6. 段階 1 の実装（2026-10-12）

| 部分 | 場所 | 中身 |
|---|---|---|
| URL と ref | [packages/app-web/src/github.ts](../packages/app-web/src/github.ts) | `blob/` `tree/` `raw/`・raw ホスト（`refs/heads/` 付きも）・リポジトリだけの URL を受ける。ref はブランチとタグの一覧（各 1 ページ）から最長一致、無ければ `commits/{候補}` を短い順に。SHA ならそのまま。応答はページを開いているあいだ覚えておく（言語を変えても API を使わない） |
| ファイル集め | [packages/app-web/src/view.ts](../packages/app-web/src/view.ts) `gather` | **規則を二重に持たない**ために、§2.3 の「足りないパスを返す関数」ではなく、組版そのものを回して「読もうとして無かったパス」を集め、取ってきてまた回す。取り込み・overlay の画像・部品ライブラリ・テーマは、ビルドと描画が読むとおりに集まる。400 ファイルを超えたら止めて言う |
| `.dgm` 単体 | 同 `viewingRoot` | 図の隣に `@import "<図>"` だけの文書を組み立てる（図の中の相対パスがそのまま効く） |
| `tree/` | 同 `viewableUnder` | フォルダの下の `.md` と `.dgm`（`.docpresenter/` などの道具の置き場は除く）。リンクは SHA 固定 |
| 画面 | [packages/app-web/src/viewer.ts](../packages/app-web/src/viewer.ts) | 本文はビルドの HTML 出力の body。テーマはリポジトリのもの（`themeOf`）→ 同梱。Mermaid は `@docpresenter/editor/mermaid` |
| PDF | 同 `makePdf` ＋ [fonts.ts](../packages/app-web/src/fonts.ts) | 組版は画面と同じ。フォントは**閲覧者の PC のもの**をローカルフォント API（`queryLocalFonts`、Chrome / Edge）で読む。使えないブラウザでは理由を出して作らない。レビュー指摘も注釈として載る（`.review.yml` を押したときに取る） |
| 束ね・配信 | [tools/build-web-viewer.mjs](../tools/build-web-viewer.mjs) → `out/web/`、[.github/workflows/pages.yml](../.github/workflows/pages.yml) | `view.html`（と同じ中身の `index.html`）・`viewer.js`・`harfbuzz-subset.wasm`。既定ブランチへの push で Pages に出る |
| 検証 | `packages/app-web/test/`（単体 27 件）、[tools/check-web-viewer.mjs](../tools/check-web-viewer.mjs)（ブラウザ 28 項目） | ブラウザ検証は GitHub を sample/ で差し替え、`/` 入りブランチ・図・画像・Mermaid・PDF・`.dgm`・フォルダ・404・回数制限・電話の幅を見る |

**公開に要る設定**：リポジトリの Settings → Pages → Source を「GitHub Actions」にする。リポジトリが非公開のままでも、
閲覧ページ自体は（プランが許せば）公開できるが、**閲覧ページが読めるのは公開リポジトリの文書だけ**である。

**分かっている残り**

- 束（`viewer.js`）が 6.6 MB ある。大半は Mermaid。Mermaid を使う文書のときだけ後から読み込む形にすると軽くなる。
- 他文書への参照 `@文書番号:ラベル` の解決は、ビルド側にまだ無い（[backlog.md](backlog.md) #13b と同じく、ビルドに入れば閲覧ページにも効く）。
