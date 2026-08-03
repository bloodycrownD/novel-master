---
date: 2026-07-18
dependency: Iterations/mobile-webview-preact-htm/prd.md
---

# webview-path-alias Feature PRD

## 背景与变更动机

Preact+TSX 分层后，CT 到 `shared` 的相对路径常达 4 层（`../../../../shared/...`），可读性差。WebView boot 使用独立 esbuild / `tsconfig.webview-boot`，原先无路径别名；RN 侧已有 `@/* → src/*`，若 WebView 复用 `@/` 易误 import 宿主代码。

## 范围说明（相对原需求）

在父迭代（Preact+TSX）之上增加 **WebView 专用**路径别名，不改产品行为与桥协议。

**包含**

- 约定 `@web/*` → `apps/mobile/src/web/*`
- `tsconfig.webview-boot` + `build-webview.mjs`（含富 CSS 辅助 build）同步配置
- 首批 6 处深相对 import 样例改写
- README 最短说明

**不包含**

- 复用 Metro `@/*`
- 全仓扫改所有相对路径
- 改宿主 `webview-host` / RN 组件 import

## 影响模块与接口

| 模块 | 影响 |
|------|------|
| `tsconfig.webview-boot.json` | 新增 `paths` |
| `scripts/build-webview.mjs` | esbuild `alias` |
| CT/RD 样例源文件（6） | import 写法 |
| `apps/mobile/README.md` | 文档 |

对外 API / 桥 / 产物布局：**无变更**。

## 验收标准

- [ ] Given `@web/shared/...` import，When `build:webview`，Then 双包 IIFE 正常产出
- [ ] Given 同上，When `tsc -p tsconfig.webview-boot.json`，Then 无路径解析错误
- [ ] Given README，When 查阅 Path aliases，Then 写明 `@web` 仅 WebView、勿用 `@/` 写 boot 源码
- [ ] Given 未改的深相对文件，When 构建，Then 仍可通过（别名与相对路径可并存）

## 测试用例

| ID | 说明 |
|----|------|
| T-WPA-01 | `build:webview` 绿 |
| T-WPA-02 | `tsc -p tsconfig.webview-boot.json` 绿 |
| T-WPA-03 | 相关 boot-script 意图仍绿（回归） |
