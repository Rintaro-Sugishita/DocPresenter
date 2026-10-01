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

設計時点の画面は作図で起こす。画像ではないので、項目の追加や文言の変更が差分に出る。

@import "auth-design/login-screen.dgm" {#fig-login-design caption="ログイン画面（画面設計）"}

画面項目の定義を @tbl-screen-items に示す。No は @fig-login-screen の丸番号に対応する。

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

## エラーコード {#sec-errors}

ログイン機能が返すエラーを @tbl-error-codes に示す。表が長いので、この表だけ用紙を横向きにする。

@import "auth-design/error-codes.table" {#tbl-error-codes caption="エラーコード一覧" page="landscape"}

---

@import "auth-design/revision.md"
