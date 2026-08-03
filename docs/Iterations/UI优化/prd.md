---
date: 2026-06-29
dependency:
  - Iterations/mobile-app/prd.md
---

# UI 优化 迭代 PRD

## 背景

Mobile / Desktop 等客户端的**轻量 UI 打磨**集合迭代。不承载大范围新功能，以 `features/`、`bugs/` 下敏捷项为单位交付。

## 目标

- 减少冗余信息层级、对齐用户心智
- 每项变更独立可验收、可回滚

## 范围

### 包含

- 各敏捷 feature / bug 子目录（`features/<名称>/`、`bugs/<名称>/`）

### 不包含

- Core / 协议层变更
- 与 `mobile-app` P0 清单冲突且未在子项 PRD 中显式修订的 IA 大改

## 敏捷项索引

| 类型 | 名称 | 路径 | 状态 |
|------|------|------|------|
| feature | session-list-header-project-name | `features/session-list-header-project-name/` | 已完成 @ 0de08bbd |
