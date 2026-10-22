---
document: SD-AUTH-001
title: 認証機能 設計書
version: 1.2
status: draft
author: 設計チーム
updated: 2026-09-21
theme: default
output: [html, pdf]
---

# 認証機能 設計書

## 概要 {#sec-overview}

本書は、会員向け Web サービスにおける認証機能の設計を示す。
対象は ID・パスワードによるログイン、およびアクセストークンの発行・失効である。
外部 IdP との連携は本書の対象外とし、別途「外部連携設計書」に定める。

---

## システム構成 {#sec-architecture}

認証に関わる構成要素を @fig-architecture に示す。

@import "../shared/system-architecture.dgm" {#fig-architecture caption="認証まわりのシステム構成"}

認証 API は社内ネットワークからのみ接続を受け付ける。Web フロントは DMZ に配置し、
認証 API への呼び出しは gRPC で行う。セッションキャッシュには Redis を用いる。

---

## ログイン機能 {#sec-login}

### 画面遷移 {#sec-login-flow}

ログイン時の画面遷移を @fig-login-flow に示す。

@import "auth-design/login-flow.dgm" {#fig-login-flow caption="ログイン画面遷移"}

認証失敗が 5 回に達した時点でアカウントをロックする。ロックの解除は
管理者による手動操作のみとし、時間経過による自動解除は行わない。

### 画面項目 {#sec-screen-items}

ログイン画面の外観を @fig-login-screen に示す。

@import "auth-design/login-screen-overlay.dgm" {#fig-login-screen caption="ログイン画面（実装後の画面への注釈）"}

注釈を重ねない素の画面は @fig-login-shot に示す。幅と寄せは取り込み行に書く。

@import "assets/login-screen.png" {#fig-login-shot caption="ログイン画面（撮ったまま）" width="55%" align="center"}

設計時点の画面は作図で起こす。画像ではないので、項目の追加や文言の変更が差分に出る。
見た目は @sec-screens の部品テンプレートが持つので、この図のファイルに色は書かれていない。

@import "auth-design/login-screen.dgm" {#fig-login-design caption="ログイン画面（画面設計）"}

画面項目の定義を @tbl-screen-items に示す。No と必須の印は @fig-login-design の画面から付き（読む順に 1, 2, 3…）、@fig-login-screen の丸番号もこれに揃えてある。

@import "auth-design/screen-items.table" {#tbl-screen-items caption="ログイン画面 項目定義"}

### 処理シーケンス {#sec-login-sequence}

ログイン成功時の処理シーケンスを @fig-login-sequence に示す。

@import "auth-design/login-sequence.mmd" {#fig-login-sequence caption="ログイン処理シーケンス"}

---

## トークン管理 {#sec-token}

### 状態遷移 {#sec-token-lifecycle}

アクセストークンの状態遷移を @fig-token-lifecycle に示す。
各状態の用語は @tbl-glossary を参照のこと。

@import "auth-design/token-lifecycle.dgm" {#fig-token-lifecycle caption="アクセストークンの状態遷移"}

### データモデル {#sec-token-model}

認証に関係する会員ドメインのデータモデルを @fig-customer-domain に示す。

@import "../shared/customer-domain.ermlx" {#fig-customer-domain caption="会員ドメイン ER 図"}

---

## 用語 {#sec-glossary}

本書で用いる用語を @tbl-glossary に示す。全社共通の用語集からの抜粋である。

@import "../shared/glossary.table" {#tbl-glossary caption="用語集（抜粋）" rows="認証関連"}

---

## 画面部品 {#sec-screens}

画面はすべて同じ部品テンプレート（`shared/ui-parts.dgm`）から組む。部品は絵ではなく
**名前の付いた見た目と既定の大きさ**で、画面側のファイルには「何が、どこに」しか残らない。

@import "../shared/ui-parts.dgm" {#fig-ui-parts caption="画面部品テンプレート"}

再設定とロックの画面も同じ部品でできている。@fig-reset-screen と @fig-locked-screen に示す。
入力部品を一通り使った画面を @fig-search-screen に、タブを使った画面を @fig-detail-screen に示す。
部品の `icon:` に書ける絵は @fig-icons のとおりで、これは製品が持っているものである。

@import "auth-design/password-reset-screen.dgm" {#fig-reset-screen caption="パスワード再設定画面（画面設計）"}

@import "auth-design/locked-screen.dgm" {#fig-locked-screen caption="アカウントロック画面（画面設計）"}

@import "auth-design/search-screen.dgm" {#fig-search-screen caption="利用者検索画面（画面設計）"}

タブと、枠より長い一覧を持つ画面を @fig-detail-screen に示す。**見出しは全部描き、中身は
選んだ 1 枚だけを描く**。一覧は枠に入りきらない行を描かず、縁のバーで続きがあることを示す。

@import "auth-design/detail-screen.dgm" {#fig-detail-screen caption="利用者詳細画面（画面設計）"}

@import "../shared/icon-list.dgm" {#fig-icons caption="同梱の絵（icon: に書ける名前）"}

---

## エラーコード {#sec-errors}

ログイン機能が返すエラーを @tbl-error-codes に示す。表が長いので、この表だけ用紙を横向きにする。

@import "auth-design/error-codes.table" {#tbl-error-codes caption="エラーコード一覧" page="landscape"}

---

@import "auth-design/revision.md"
