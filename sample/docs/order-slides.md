---
document: SD-ORDER-001
title: 注文受付 説明資料
version: 1.0
status: draft
author: 設計チーム
updated: 2026-10-08
theme: default
output: [pptx, html]
---

# 注文受付 説明資料

PowerPoint で直して読み戻す（PPTX の読み戻し）を試すための、短い説明資料である。

---

## 注文の流れ {#sec-flow}

注文を受けてから出荷までの流れを @fig-order-flow に示す。

@import "order-slides/order-flow.dgm" {#fig-order-flow caption="注文の流れ"}

---

## システム構成 {#sec-system}

注文に関わる構成を @fig-order-system に示す。

@import "order-slides/order-system.dgm" {#fig-order-system caption="注文受付のシステム構成"}

---

## 注文の状態 {#sec-states}

注文の状態の移り変わりを @fig-order-states に示す。

@import "order-slides/order-states.dgm" {#fig-order-states caption="注文の状態遷移"}

---

## 状態の一覧 {#sec-state-list}

各状態の意味と次の操作を @tbl-order-states に示す。

@import "order-slides/order-states.table" {#tbl-order-states caption="注文の状態"}

---

@import "order-slides/revision.md"

