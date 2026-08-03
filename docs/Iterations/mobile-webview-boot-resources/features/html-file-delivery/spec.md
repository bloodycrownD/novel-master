---
date: 2026-07-17
agile_trace: true
---

# html-file-delivery 实现规格（SPEC）

> **过渡交付**：本 feature 的「assembled `.html` + `source.html`」为 boot-resources 阶段交付面。**加载终局**见 [`Iterations/mobile-webview-boot-bundler`](../../../mobile-webview-boot-bundler/spec.md)（`uri` + esbuild IIFE + 原生 assets/bundle）。父 SPEC 文首已标 Superseded。

## 根因 / 方案摘要

巨型 `*.generated.ts` 把整页 HTML 嵌进 TS，diff/审查差、与父级「真实 HTML 交付」冲突。定案：**组装写真实 `.html`**；**加载主路径 A**（过渡）：Metro/Jest 将 `.html` 变为 UTF-8 字符串模块 → 薄 TS export → WebView 仍 `source={{ html, baseUrl }}`（本 feature 不做 uri/android_asset；终局由 bundler 接替）。

## 变更点清单

1. `assemble-webview-html.mjs`：`writeAssembledHtml` → `transcript.assembled.html` / `document.assembled.html`；移除 `writeGeneratedTs` / `toTsStringLiteral`
2. 删除 `transcript-html.generated.ts`、`document-html.generated.ts`
3. 薄 `transcript-html.ts` / `document-html.ts`：`import html from '...assembled.html'` 再 export 符号 + BASE_URL
4. Metro：`html` 移出 `assetExts`、加入 `sourceExts`；`metro-html-transformer.js` 返回 `module.exports = "<content>"`
5. Jest：`test-utils/html-string-transformer.js` + `transform['^.+\\.html$']` 对称
6. `src/types/html-modules.d.ts`：`*.html` 默认导出 `string`
7. 父级 `prd.md` / `spec.md` 对齐定案；本目录敏捷留痕

## 产物路径（定案）

```text
apps/mobile/src/web/chat-transcript/transcript.assembled.html
apps/mobile/src/web/rich-document/document.assembled.html
```

## Metro / Jest 要点

| 侧 | 配置 |
|----|------|
| Metro | `assetExts` 去掉 `html`；`sourceExts` 含 `html`；`babelTransformerPath` → `metro-html-transformer.js` |
| Jest | `transform['^.+\\.html$']` → `html-string-transformer.js`（`module.exports = JSON.stringify(src)`） |
| TS | `declare module '*.html' { const html: string; export default html }` |

Babel `_interopRequireDefault` 对无 `__esModule` 的 CJS 字符串导出可正确得到 default。

## 测试策略

- T-AG-01：assemble 成功
- T-AG-02：既有契约测仍从 `CHAT_TRANSCRIPT_HTML` / `RICH_DOCUMENT_HTML` 取值（import 面不变）
- 门禁：改资产后跑 assemble；可 `git diff --exit-code` 防漂移

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| Metro/Jest 对 `.html` 处理不一致 | 两侧均返回同一 CJS 字符串模块形态 |
| 误把 `html` 留在 `assetExts` | 显式 filter + 契约测覆盖 import |

回滚：恢复 `writeGeneratedTs` 与 `*.generated.ts`，或 `git revert` 本敏捷提交。
