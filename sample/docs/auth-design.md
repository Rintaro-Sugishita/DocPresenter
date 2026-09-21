---
document: SD-AUTH-001
title: 認証機能 設計書
version: 1.2
status: draft
author: 設計チーム
updated: 2026-09-21
---

# 認証機能 設計書

## 1. 概要

本書は、会員向け Web サービスにおける認証機能の設計を示す。
対象は ID・パスワードによるログイン、およびアクセストークンの発行・失効である。
外部 IdP との連携は本書の対象外とし、別途「外部連携設計書」に定める。

## 2. システム構成

認証に関わる構成要素を図 2.1 に示す。

@import "../shared/system-architecture.dgm"

*図 2.1 認証まわりのシステム構成*

認証 API は社内ネットワークからのみ接続を受け付ける。Web フロントは DMZ に配置し、
認証 API への呼び出しは gRPC で行う。セッションキャッシュには Redis を用いる。

## 3. ログイン機能

### 3.1 画面遷移

ログイン時の画面遷移を図 3.1 に示す。

@import "auth-design/login-flow.dgm"

*図 3.1 ログイン画面遷移*

認証失敗が 5 回に達した時点でアカウントをロックする。ロックの解除は
管理者による手動操作のみとし、時間経過による自動解除は行わない。

### 3.2 画面項目

ログイン画面の外観を図 3.2 に示す。

@import "auth-design/login-screen-overlay.dgm"

*図 3.2 ログイン画面*

画面項目の定義を表 3.1 に示す。番号は図 3.2 の丸番号に対応する。

@import "auth-design/screen-items.table"

*表 3.1 ログイン画面 項目定義*

### 3.3 処理シーケンス

ログイン成功時の処理シーケンスを図 3.3 に示す。

@import "auth-design/login-sequence.mmd"

*図 3.3 ログイン処理シーケンス*

## 4. トークン管理

### 4.1 状態遷移

アクセストークンの状態遷移を図 4.1 に示す。

@import "auth-design/token-lifecycle.dgm"

*図 4.1 アクセストークンの状態遷移*

### 4.2 データモデル

認証に関係する会員ドメインのデータモデルを図 4.2 に示す。

@import "../shared/customer-domain.ermlx"

*図 4.2 会員ドメイン ER 図*

## 5. 用語

本書で用いる用語を表 5.1 に示す。全社共通の用語集からの抜粋である。

@import "../shared/glossary.table" {line_begin=1 line_end=8}

*表 5.1 用語集（抜粋）*
