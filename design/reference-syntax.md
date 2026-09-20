# 参照記法の比較 — 埋め込みオブジェクトをどう書くか

作成: 2026-09-20 / 対象: [編集 UI 設計案 §11](editor-model.md) の未確定事項「参照の記法」
関連: [要件定義](requirements.md)

## 1. 比較のための題材

同じ内容を各記法で書き、読みやすさと素の Markdown としての劣化具合を見る。

> 3.2 ログイン画面の節に、**画面遷移図**・**画面項目表**・**画面キャプチャ（幅指定あり）**・**共通用語集の一部（先頭 20 行のみ）**を置く。

## 2. 先行事例 — Markdown Preview Enhanced

MPE は**まさに同じことを既にやっている**。外部ファイルを種別ごとに適切な形でレンダリングして埋め込む。

| ファイル型 | MPE の扱い |
|---|---|
| `.csv` | **Markdown テーブルに変換** |
| `.mermaid` / `.dot` / `.plantuml` | **図として描画** |
| 画像各種 | 画像として埋め込み |
| `.pdf` | SVG に変換して埋め込み |
| Markdown | 解析して直接埋め込み |
| その他 | コードブロックとして表示 |

構文は 4 形式を受理する。

```
@import "your_file"
<!-- @import "your_file" -->
![](path/to/your_file)
![[ path/to/your_file ]]
```

属性も実績込みで設計されている。

```
@import "test.png"  {width="300px" height="200px" title="..." alt="..."}
@import "test.md"   {line_begin=2 line_end=10}
@import "test.json" {as="vega-lite"}
@import "test.puml" {code_block=true class="line-numbers"}
```

**`line_begin` / `line_end` は、[編集 UI 設計案](editor-model.md)で未確定にしていた「部分参照」への回答そのもの**である。共有の用語集から一部だけを引く、という需要に既に答えが出ている。

## 3. 候補と具体例

### 案 A — MPE 互換 `@import`

```markdown
## 3.2 ログイン画面

ログイン時の画面遷移を以下に示す。

@import "auth-design/login-flow.dgm"

画面項目は次のとおり。

@import "auth-design/login-items.table"

実際の画面イメージを示す。

@import "assets/login-screen.png" {width="600px"}

用語は全体で共通のものを用いる。

@import "shared/glossary.table" {line_begin=1 line_end=20}
```

### 案 B — フェンス ＋ `src` 属性

````markdown
## 3.2 ログイン画面

ログイン時の画面遷移を以下に示す。

```dgm src="auth-design/login-flow.dgm"
```

画面項目は次のとおり。

```table src="auth-design/login-items.table"
```

実際の画面イメージを示す。

```image src="assets/login-screen.png" width="600px"
```

用語は全体で共通のものを用いる。

```table src="shared/glossary.table" rows="1-20"
```
````

**中身が空のフェンスが並ぶ**のが致命的に不自然。2 行を消費し、視覚的にも重い。

### 案 C — 画像記法の拡張

```markdown
## 3.2 ログイン画面

ログイン時の画面遷移を以下に示す。

![ログイン画面遷移](auth-design/login-flow.dgm)

画面項目は次のとおり。

![画面項目](auth-design/login-items.table)

実際の画面イメージを示す。

![ログイン画面](assets/login-screen.png){width="600px"}

用語は全体で共通のものを用いる。

![用語集](shared/glossary.table){line_begin=1 line_end=20}
```

**完全に標準 Markdown**で、GitHub 上でも alt テキストが見える。ただし表を「画像」と書くのは意味的にねじれている。

### 案 D — ディレクティブ

```markdown
## 3.2 ログイン画面

ログイン時の画面遷移を以下に示す。

:::dgm src="auth-design/login-flow.dgm"
:::

画面項目は次のとおり。

:::table src="auth-design/login-items.table"
:::
```

案 B と同じく**閉じ記号が空で冗長**。MyST 等の先行はあるが、この用途では利点が出ない。

### 案 E — Quarto 風ショートコード

```markdown
## 3.2 ログイン画面

ログイン時の画面遷移を以下に示す。

{{< dgm auth-design/login-flow.dgm >}}

用語は全体で共通のものを用いる。

{{< table shared/glossary.table rows="1-20" >}}
```

1 行で済むが、`{{< >}}` は Hugo / Quarto の文脈が強く、標準 Markdown から見ると異物感が大きい。

## 4. 比較

| | A `@import` | B フェンス | C 画像記法 | D ディレクティブ | E ショートコード |
|---|:--:|:--:|:--:|:--:|:--:|
| 行数 | **1** | 2 | **1** | 2 | **1** |
| 視覚的な軽さ | ◎ | △ | ◎ | △ | ○ |
| 素の Markdown か | ✗ | ○ | **◎** | ✗ | ✗ |
| GitHub での見え方 | 文字列がそのまま出る | **空の箱** | **alt が出る** | 文字列が出る | 文字列が出る |
| 属性指定 | ◎ 実績あり | ○ | △ 拡張要 | ○ | ○ |
| 種別が明示される | 拡張子で決まる | ◎ 明示 | 拡張子で決まる | ◎ 明示 | ◎ 明示 |
| 部分参照 | **◎ `line_begin/end`** | 要設計 | 要設計 | 要設計 | 要設計 |
| 先行事例 | **MPE** | Mermaid 的 | **MPE** | MyST | Quarto |

## 5. 推奨 — A を正式記法とし、C も受理する

> **正式記法（ツールが書き戻す形）: `@import "path" {attr}`**
> **読み取り時は `![alt](path){attr}` も受理する**

MPE がこの 2 形式を両方受理しているので、**両対応は MPE 互換そのもの**であり追加コストがほとんど無い。

### `@import` を正式記法にする理由

1. **対象ユーザーが完全に重なる。** VS Code で Markdown を書き、図を描き、PDF に出す層は、まさに MPE の利用者層である。知っている記法をそのまま使える。
2. **属性設計が実績込みで手に入る。** 特に `line_begin` / `line_end` は部分参照の答えとして即使える。ゼロから設計して同じ結論に至る公算が高いものを、先に検証済みの形で借りられる。
3. **1 行で読みやすい。** 本文を目次のように見通せる状態（[編集 UI 設計案 §4](editor-model.md)）を最もよく保つ。
4. **既存 MPE 文書の受け入れ余地が生まれる。** 完全互換は狙わないが、記法が同じなら移行の敷居は明確に下がる。

### `![alt](path)` も受理する理由

GitHub 等、本製品のレンダラが無い環境で **alt テキストが表示される**のは実利がある。「ここに何の図があるか」が伝わる。

**ただし書き戻しは常に `@import` に統一する。** 人が `![]()` で書いた箇所は[書き戻しの規律](editor-model.md)によりそのまま保たれ、ツールが勝手に書き換えることはない。

### 採らない形式

- `<!-- @import "..." -->` — GitHub 上で**何も表示されず文書に穴が空く**。`@import` がそのまま文字列として見えるほうがまだよい
- `![[ ... ]]` — Wiki リンク風。Obsidian 系の文脈が混ざるため採らない

## 6. 種別の決定 — 拡張子で決める

`@import` は種別を書かないため、**拡張子がレンダラを決める**。これは MPE と同じ方式。

| 拡張子 | レンダラ |
|---|---|
| `.dgm` | 作図 |
| `.table` | 表 |
| `.png` / `.jpg` / `.svg` 等 | 画像 |
| `.md` | Markdown として展開 |
| その他 | コードブロック |

拡張子と違う扱いをしたい場合は、MPE と同じく `{as="..."}` で上書きできる。

## 7. 未確定事項

- **`.table` の中身の形式** — MPE は `.csv` を表として扱う。単純な表は CSV 互換にし、セル結合を伴うものだけ独自形式にするか。CSV 互換なら Excel から直接書き出せる利点がある
- **`line_begin` / `line_end` の妥当性** — 行番号による部分参照は、参照先の編集で簡単にずれる。[レビューモデル](review-model.md)で行番号を避けた判断と整合しない。名前による範囲指定（`{rows="基本用語"}` など）を併用すべきか
- **MPE 互換をどこまで謳うか** — コードチャンク実行など MPE 固有機能は対象外。互換性の範囲を明示しないと誤解を招く
