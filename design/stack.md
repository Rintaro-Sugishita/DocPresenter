# 実装スタックと言語境界

作成: 2026-09-21 / 対象: [PDF 生成エンジン §8](pdf-engine.md) の「HTML 生成を C# と JS のどちらに置くか」
関連: [編集 UI 設計案](editor-model.md) / [作図モデル](diagram-model.md)

## 0. 決定事項（ロック済み）

- **レンダリング系は TypeScript とする。** 素の JavaScript は書かない（`strict` 前提）。
- **HTML 生成は TS 側に置く**（§1）。
- **案 1（TypeScript 単一言語）に確定**（§3・§4）。C# は使わない。
- `ErCreator.Canvas` は**再利用しない**。ただし**移植元の参照実装として扱う**（§4）。
- **単一言語のまま、パッケージは 4 つに分ける**（[パッケージ分割](packaging.md)）。`base` / `diagram` / `markdown` / `editor`。作図と Markdown エンジンはそれぞれ単独で出せる形に保つ。

## 1. なぜ HTML 生成が TS 側なのか

HTML への描画は**あちこちで使う**。

| 用途 | 実行場所 |
|---|---|
| 編集画面のプレビュー | ブラウザ |
| HTML 出力（R4） | ブラウザ／CLI |
| **PDF パイプラインの入力**（[決定済み](pdf-engine.md)） | ブラウザ |
| レビュー用ビューア（[R10](review-model.md)） | ブラウザ |

**すべてブラウザ文脈である。** ここで C# 側に置くと、同じ処理のたびにモデルを境界越しに渡すことになる。TS 側に置けば境界が消える。

## 2. 芋づる式に決まること

HTML が TS 側に来ると、**独立には決められない**ものが続く。

### 2.1 図の SVG 描画も TS 側になる

図の SVG 出力は、編集キャンバス・HTML 出力・PDF パイプラインの三箇所で使う。HTML と同じ理由で TS 側に置くのが自然。

### 2.2 すると作図・表のエディタも TS 側が自然になる

編集キャンバスが扱うのは、SVG 描画と同じモデル・同じ当たり判定・同じ座標系である。描画が TS でエディタが C# だと、**モデルと幾何計算を二重に持つ**ことになる。

**ここで `ErCreator.Canvas` の再利用が成立しなくなる。**

これまで繰り返し「Blazor の共有キャンバスがそのまま使える」と述べてきたが、**その前提はレンダリング系を C# に置く場合のものだった**。訂正する。

### 2.3 VS Code 拡張は元々 TS が自然

VS Code の拡張 API（カスタムエディタ、`NotebookSerializer`）は TypeScript である。TS で書けば**そのまま乗る**。Blazor だと WebView に載せて双方向にマーシャリングすることになり、余計な層が 1 枚増える。

### 2.4 CLI も Node になる

PDF のレイアウトにブラウザが要る（[決定済み](pdf-engine.md)）ため、CLI は headless Chrome を駆動する。これは Node / TS の領域。

## 3. 言語境界の三案

### 案 1 — TypeScript 単一言語

| | |
|---|---|
| TS | パーサ・中間モデル・全レンダラ（HTML / PDF / SVG / PPTX / AI 向け）・エディタ・CLI |
| C# | 使わない |

- **境界が存在しない。** モデルの型定義も直列化も一箇所
- Web・VS Code 拡張・CLI が同一コアを共有する
- デスクトップは Tauri / Electron で同じものを包むか、当面 Web に寄せる
- **代償**: `ErCreator.Canvas` の再利用を諦める。WPF シェルも作り直しになる

### 案 2 — C# コア ＋ TS レンダラ

| | |
|---|---|
| C# | パーサ・中間モデル・PPTX（OpenXML SDK） |
| TS | HTML・PDF・SVG・エディタ |

- ErCreator との型・ロジック共有が残る
- **代償**: **モデルの型定義が二重になる**。境界を越えるたびに直列化が要る。エディタが TS なのにモデルが C# なので、編集操作のたびに往復する

### 案 3 — C# 中心のまま（現状維持）

- [PDF の決定](pdf-engine.md)と衝突する。PDF パイプラインは TS でしか書けないため、結局境界が生じる
- **実質的に成立しない**

## 4. 推奨 — 案 1（TypeScript 単一言語）

判断は「境界のコストを恒久的に払うか、移植コストを一度払うか」に尽きる。

**得られるもの**

- 言語境界が無い。中間モデルの定義が一箇所にしかない
- **VS Code 拡張がネイティブに書ける。** [三面単一実装](editor-model.md)が最も素直に成立する
- PDF パイプライン（Paged.js ＋ pdf-lib）と同じ言語
- CLI が Puppeteer をそのまま使える

**失うもの、と見積もり**

`ErCreator.Canvas` の再利用（Geometry / Grid / Pointer / Selection / History / Shapes / Clipboard / TSV 貼り付け）は諦めることになる。ただし**これは設計の作り直しではなく移植である**。当たり判定・スナップ・範囲選択・undo スタックといったアルゴリズムはそのまま持ち込める。参照実装がある移植は、白紙からの実装とは負荷が違う。

PPTX（OOXML）については、C# の OpenXML SDK の型安全性は失う。ただし実体は **ZIP ＋ XML の組み立て**であり、DrawingML を直接書く方針である以上、SDK の恩恵はもともと大きくない。

ER 図（`.ermlx`）は YAML であり、TS で読める。[ErCreator への委譲](diagram-model.md)は**編集とモデルの権威を委ねる**という意味であって、DocPresenter 側で描画できないという意味ではない。

## 5. パッケージ構成（案）

境界が無いため、分割は関心事だけで決められる。

```
core/        中間モデル・パーサ（.md / .dgm / .table）・採番と相互参照の解決
render/      HTML / SVG / PDF / PPTX / AI 向け構造化出力
editor/      キャンバス・グリッド・当たり判定・undo（ErCreator.Canvas からの移植先）
review/      コメントの移送（git diff）・ソースマップ・PDF 注釈の取り込み
app-web/     ブラウザ版
app-vscode/  VS Code 拡張（core / render / editor をそのまま参照）
cli/         Node。Puppeteer で headless Chrome を駆動
```

`app-vscode` が `core` / `render` / `editor` を**そのまま参照できる**ことが、この構成の要点である。

## 6. 未確定事項

- ~~デスクトップ配布形態~~ → **決定**: **専用アプリは作らず、VS Code 拡張が担う**（[提供形態](platforms.md)）
- **ErCreator との関係** — コードを共有しない以上、連携は `.ermlx` というファイル形式を介したものになる。それで十分か
- パッケージ分割の粒度（§5 は案）と、ビルド構成
