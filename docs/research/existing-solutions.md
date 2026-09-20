# 既存サービス調査 — 「Git で差分管理できるシステム開発ドキュメント」の先行事例

調査日: 2026-09-20 / 対象: DocPresenter の企画前提となる先行技術・競合の棚卸し

## 1. 調査の前提

DocPresenter が満たしたい要件を、調査の評価軸として次の 7 つに分解した。

| # | 要件 | 評価軸としての読み替え |
|---|---|---|
| R1 | Markdown 記法による文章構築 | プレーンテキスト 1 次ソース。Git の行差分がそのままレビュー単位になるか |
| R2 | 簡便さと複雑さを兼ね備えた作図 | 数行で描ける手軽さと、大規模図のレイアウト品質・表現力の両立 |
| R3 | 外部ファイル参照 | 他ドキュメント／ソースコード／データの取り込み（transclusion）と鮮度保証 |
| R4 | HTML 化 | 単体で配布・閲覧できる成果物 |
| R5 | PDF 化 | 印刷・納品品質（ページ、目次、相互参照） |
| R6 | PPTX 化 | 報告・レビュー用。**編集可能な** PowerPoint であること |
| R7 | 複雑なテーブル | セル結合（colspan/rowspan）、セル内改行・箇条書き、列幅制御 |
| R8 | Web / VSCode 双方での編集 | 執筆環境の二面待ち。人間がレビュー可能な中間ファイル |

## 2. カテゴリ別の先行事例

### A. 単一ソースから多形式を出版する基盤（最も思想が近い層）

| プロダクト | 概要 | R1 | R2 | R3 | R4 | R5 | R6 | R7 |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Quarto** | Pandoc ベースの出版システム。`{{< include >}}` で外部 md 取り込み、Mermaid/Graphviz 同梱、revealjs/pptx/beamer/docx/PDF(Typst・LaTeX) を同一ソースから出力。VS Code 拡張あり | ◎ | ○ | ◎ | ◎ | ◎ | ○ | △ |
| **Pandoc** | 変換基盤そのもの。grid table で結合セルを表現可、`--reference-doc` で pptx/docx テンプレ指定 | ◎ | × | ○ | ○ | ○ | ○ | ○ |
| **AsciiDoc / Asciidoctor** | `include::` による強力なモジュール化と、`2+|` `.2+|` 等のセル結合を持つ表記法。Antora で複数リポジトリ横断のドキュメントサイト | ○ | ○ | ◎ | ◎ | ◎ | × | ◎ |
| **Sphinx / MyST** | `literalinclude` でソースコードの行範囲を引用。相互参照・用語集が強い。PDF は LaTeX 経由 | ○ | ○ | ◎ | ◎ | ○ | △ | △ |
| **Typst** | Rust 製の新世代組版。表現力の高い表とプログラマブルな組版、高速コンパイル。HTML 出力は 0.14 時点でも experimental、PPTX は無し。Web アプリに Git Sync（実験的）あり | ○ | △ | ○ | △ | ◎ | × | ◎ |
| **Re:VIEW** | 日本発。書籍制作向けで PDF/EPUB は堅いが、設計書用途・PPTX は対象外 | ○ | △ | ○ | ○ | ◎ | × | ○ |

**所見**: 「思想」としては **Quarto がほぼ同一**。1 つの .qmd から HTML/PDF/PPTX/スライドを出し、include で外部参照し、Git で差分管理する — DocPresenter の R1・R3〜R6 はすでに実現されている。ただし後述のギャップがある。

### B. スライド（PPTX）特化

| プロダクト | 強み | 弱み |
|---|---|---|
| **Marp** | Markdown → HTML/PDF/PPTX。VS Code 拡張の体験が良く、日本での採用も多い | PPTX は既定で「画像貼り付け」。`--pptx-editable` は experimental で、複雑テーマでは再現性が落ちる |
| **Slidev** | Vue ベースで開発者体験が最も良い。PDF/PNG/PPTX エクスポート | Web 技術前提、PPTX は画像化寄り。設計書本体の用途ではない |
| **reveal.js / Quarto revealjs** | HTML スライドとしては最高品質 | PPTX への変換は別経路 |
| **Pandoc pptx / md2pptx / python-pptx** | ネイティブ .pptx を生成しテキストが編集可能 | レイアウト自由度が低く、凝ったデザインは苦手 |

**所見**: **PPTX はどのエコシステムでも一貫して「二級市民」**。「Markdown から出した pptx を PowerPoint 側で編集し続けられる」を本気で満たすものはほぼ無い。ここは明確な空白地帯。

### C. 作図（diagram as code）

| プロダクト | 位置づけ |
|---|---|
| **Mermaid** | 最も普及。GitHub がネイティブ描画。3〜5 行で書ける簡便さが最大の武器だが、**ノードが 10〜12 を超えるとレイアウト品質が崩れる** |
| **D2**（2022, Terrastruct） | Mermaid の簡便さと PlantUML の表現力の中間。複雑図のレイアウト品質が明確に上 |
| **PlantUML** | UML 14 種を網羅。エンタープライズの事実上の標準だが記法が重い |
| **Graphviz** | 大規模グラフ。低レベルで手書きには向かない |
| **Structurizr (C4)** | モデルを 1 度定義し、抽象度の異なる複数ビューを生成する **モデルファースト**。ErCreator の `.ermlx` と同じ発想 |
| **Excalidraw / draw.io** | 手書き GUI。`.excalidraw.svg` / `.drawio.svg` は Git に置けるが、中身は機械生成 XML で**差分が人間に読めない** |

**所見**: 「簡便さ ⇄ 複雑さ」を 1 つの記法で両立しているものは無い。実運用は Mermaid と PlantUML/drawio の**併用**でお茶を濁しているのが現状。GUI で描いても Git 差分が読める形で保存する、という要求は未解決。

### D. ドキュメントサイト / SaaS

- **Docusaurus / MkDocs Material / Starlight / Nextra / Antora**: HTML サイト生成は強いが、PDF は後付けプラグイン、PPTX は対象外。
- **GitBook / Mintlify**: Git リポジトリと双方向同期し、**Web エディタと VS Code の両方**で編集できる。R8 の参考実装として最も近い。ただし出力は Web サイト中心。
- **Notion / Confluence / esa / Kibela / DocBase**: Git 差分管理の外にあり、思想として対照群。
- **Swimm**: ドキュメントをコードに結び付け、コード変更時にドキュメントの**陳腐化を CI で検出**する。R3（外部ファイル参照）の理想形。

### E. 日本のシステム開発ドキュメント文脈

- **フューチャー社「Markdown設計ドキュメント規約」** — 設計ドキュメントを全面 Markdown 化し、Pull Request でレビューする運用を規約として公開。「設計ドキュメント腐る問題」への Git 運用の実践報告あり。
- **NTTデータ「プレインテキスト形式の設計書」** — プレーンテキスト設計書による生産性向上の取り組み。
- **excel2md / 各種 Excel→Markdown 変換 OSS** — 既存 Excel 設計書資産の移行需要が顕在化している。生成 AI に設計書を読ませるために Markdown 化する、という動機が 2025〜2026 の主流。

**所見**: 日本市場には「Excel 設計書からの脱却」という強い需要があり、その受け皿が「素の Markdown + 各社独自規約」で止まっている。**製品として埋めている国産サービスは見当たらない。**

## 3. 結論 — 同一思想のものはあるか

**あるが、完全な重なりは無い。**

- 思想（単一テキストソース → 多形式出版 → Git レビュー）では **Quarto がほぼ同一**であり、DocPresenter はまず Quarto を「超えるべき基準」と見なすべき。
- ただし次の 4 点は、Quarto を含むどの既存プロダクトも満たしていない。

### ギャップ（＝DocPresenter の勝ち筋候補）

1. **編集可能な PPTX**
   全エコシステムで最も弱い。「レビュー用に配る pptx を、受け取った側が PowerPoint で直せる」は未達成領域。OOXML を直接生成し、レイアウトプレースホルダに流し込む実装で差別化できる。

2. **日本の設計書が要求する複雑テーブル**
   標準 Markdown にセル結合は無く、HTML table を直書きすると R4 以外の出力が壊れる。Pandoc grid table / AsciiDoc の結合記法はあるが手書きは苦痛。
   → **ErCreator の `.ermlx` と同じく「表をモデルとして持ち、記法は入力手段の 1 つ」** にするのが本命。GUI で編集しても YAML 系テキストとして差分が読める形。

3. **作図の簡便さ × 複雑さの両立**
   Mermaid の敷居の低さを保ちつつ、ノード数が増えたら D2 相当のレイアウトに逃がす。GUI 編集（Excalidraw 的）とテキストの**双方向**変換ができ、かつ保存形式が人間可読であること。ここも ErCreator のモデルファースト思想の直接の応用先。

4. **外部ファイル参照の「鮮度保証」**
   include はどこにでもあるが、参照先のコードが変わったときに検知する仕組みは Swimm 以外にほぼ無い。CI で陳腐化検出まで含めれば設計書の「腐る問題」に直接効く。

さらに **R8（Web と VSCode の両対応）** を満たすものは GitBook / Mintlify / Typst web app 程度で、上記 1〜4 と組み合わせた製品は存在しない。

## 4. 設計方針への示唆（次段階の論点）

- **独自記法は発明しない。** Markdown（CommonMark + GFM）を基礎に、Quarto/MyST 流のディレクティブ拡張で表・図・参照を表現する。学習コストと既存資産の移行性が最大の参入障壁になるため。
- **中間モデルを持つ。** ErCreator の `.ermlx` に相当する、YAML ベースの人間可読な中間表現（仮称 `.docmlx`）を置き、Markdown ⇄ モデル ⇄ 各出力の三角形にする。GUI 編集と Git 差分の両立はこの中間層でしか解けない。
- **出力経路の想定**: HTML は自前レンダラ、PDF は Typst または Chromium ヘッドレス、PPTX は OOXML 直生成（Pandoc 経由にしない）。
- **エディタ戦略**: Web（ブラウザ完結・アップロード無し）を主、VS Code 拡張を従。ErCreator の Blazor WebAssembly 版と同じ「データを外に出さない」訴求が、業務設計書では特に効く。

## 5. 未調査・次に確認すべきこと

- Quarto の pptx 出力の実測（テンプレ適用時の編集可能性・レイアウト再現度）
- Pandoc grid table / AsciiDoc 結合記法で、実際の日本の設計書テーブルがどこまで表現できるかの限界確認
- D2 のライセンス（現在の OSS 化状況）と組み込み可否
- ErCreator の `.ermlx` 資産を DocPresenter から参照する形（ER 図を設計書に埋め込む）の実現性

## 参考

- [Quarto — Presentations / PowerPoint](https://quarto.org/docs/reference/formats/asciidoc.html)
- [Typst Documentation — HTML export](https://typst.app/docs/reference/html/) / [Git Sync](https://typst.app/docs/web-app/git-sync/)
- [Best Diagram-as-Code Tools 2026: Mermaid, D2, PlantUML and More](https://infrasketch.net/blog/best-diagram-as-code-tools-2026)
- [Text to Diagram Tools Comparison — D2 vs Mermaid vs PlantUML vs Graphviz](https://text-to-diagram.com/?example=text)
- [Markdown to PowerPoint: Best Conversion Paths Compared](https://deckary.com/blog/markdown-to-powerpoint)
- [Markdown Slides: Best Tools, Export Paths, and When to Use Them](https://deckary.com/blog/markdown-slides)
- [フューチャー — Markdown設計ドキュメント規約](https://future-architect.github.io/arch-guidelines/documents/forMarkdown/markdown_design_document.html)
- [フューチャー技術ブログ — 設計ドキュメント腐る問題、Git管理で運用してみた結果](https://future-architect.github.io/articles/20231101a/)
- [NTTデータ — プレインテキスト形式の設計書で、生産性を向上](https://www.nttdata.com/jp/ja/trends/data-insight/2021/0602/)
- [生成AI時代の Docs as & with Code の実践](https://zenn.dev/dajiaji/articles/24086666031199)
- [Markdownの表（テーブル）の書き方 — セル結合・改行](https://markdown-viewer.net/guide/markdown-table/)
- [awesome-docs（ドキュメントツール一覧）](https://github.com/testthedocs/awesome-docs)
