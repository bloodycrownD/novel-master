---
date: 2026-07-18
dependency: Iterations/mobile-webview-preact-htm/prd.md
---

# jsx-automatic-web-alias-cleanup Feature PRD

## 背景与变更动机

1. Classic JSX 要求每个 TSX 显式 `import { h }`，IDE 常标 unused，开发体验差。  
2. `@web` 别名落地后仍残留 3 处 `../../../../shared/ui/TrustedHtml`，与「跨 shared 用别名」约定不一致。

## 范围说明（相对原需求）

相对父迭代 Preact+TSX 与敏捷项 `webview-path-alias`：

**包含**

- WebView boot JSX 改为 **automatic**（`jsxImportSource: 'preact'`）
- 删除仅因 JSX 的 `import { h }`；`main` 手写 `h(...)` 保留
- 剩余 shared 深相对 import 全部改为 `@web/shared/...`
- 父 PRD/SPEC 同步 JSX 定案

**不包含**

- 改 HTML classic `<script src>` / IIFE / minify:false  
- 把 `main.ts` 改为 TSX  
- 包内浅相对（`ui ↔ runtime`）一律改 `@web`

## 影响模块与接口

| 模块 | 影响 |
|------|------|
| `build-webview.mjs` / `tsconfig.webview-boot.json` | JSX 模式 |
| 12 个 `.tsx` | 去掉 `h` import |
| 3 个 TrustedHtml 消费方 | `@web` 路径 |
| 父 PRD/SPEC | 文档定案 |

行为 / 桥 / 产物布局：**无产品变更**。

## 验收标准

- [ ] TSX 组件文件无需为 JSX 单独 `import { h }`
- [ ] `build:webview` + `tsc -p tsconfig.webview-boot` 绿
- [ ] `src/web` 无 `from '../…/shared…'` 相对 import
- [ ] boot-script 契约意图仍绿
- [ ] 父 SPEC JSX 行为描述为 automatic

## 测试用例

| ID | 说明 |
|----|------|
| T-JAC-01 | build:webview 绿 |
| T-JAC-02 | tsc webview-boot 绿 |
| T-JAC-03 | boot-script 回归绿 |
| T-JAC-04 | rg 无相对 shared import |
