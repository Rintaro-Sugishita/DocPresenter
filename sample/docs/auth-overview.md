---
document: SD-AUTH-000
title: 認証機能 概要
version: 1.2
status: draft
author: 設計チーム
updated: 2026-09-21
theme: default
output: [html]
---

# 認証機能 概要

報告・レビュー向けの短い文書である。詳細は別文書（`docs/auth-design.md`）にある。

---

## 全体像 {#sec-whole}

システム構成を @fig-architecture に示す。DMZ には Web フロントだけを置き、
認証 API と会員 DB は社内ネットワークに閉じる。

@import "../shared/system-architecture.dgm" {#fig-architecture caption="認証まわりのシステム構成"}

---

## 画面の流れ {#sec-flow}

ログインの画面遷移を @fig-login-flow に示す。連続失敗 5 回でアカウントをロックする。

@import "auth-design/login-flow.dgm" {#fig-login-flow caption="ログイン画面遷移"}

---

@import "../shared/revision.md"
