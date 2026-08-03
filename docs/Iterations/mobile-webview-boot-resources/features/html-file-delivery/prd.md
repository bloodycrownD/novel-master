---
date: 2026-07-17
dependency: Iterations/mobile-webview-boot-resources/prd.md
---

# html-file-delivery Feature PRD

## 背景与变更动机

父级资源化已将 boot/壳 CSS 迁为独立真源，但组装仍写入巨型 `*.generated.ts` 整页字符串——审查与 diff 成本高，与「真实 HTML 交付」定案不一致。本敏捷将组装产物改为提交入库的 `*.assembled.html`，并由 Metro/Jest 以 UTF-8 字符串模块导入，保持 WebView `source={{ html, baseUrl }}` 与导出符号不变。

## 范围说明（相对原需求）

- **包含**：assemble 写 `transcript.assembled.html` / `document.assembled.html`；删除巨型 `*.generated.ts` HTML 交付；薄 TS `import` + 导出 `CHAT_TRANSCRIPT_HTML` / `RICH_DOCUMENT_HTML` / `*_BASE_URL`；Metro（`html` 出 `assetExts`、入 `sourceExts` + transformer）与 Jest 对称；`*.html` TS 模块声明；父级 SPEC 对齐；本敏捷留痕。
- **不包含**：改 `uri` / `android_asset` 加载；改 WebView 组件行为或桥协议；重做 boot 职责拆分。

## 影响模块与接口

| 模块 | 影响 |
|------|------|
| `scripts/assemble-webview-html.mjs` | 写出真实 `.html`，不再 `writeGeneratedTs` |
| `transcript-html.ts` / `document-html.ts` | `import` 组装 HTML 为字符串再 export |
| `metro.config.js` / `metro-html-transformer.js` | `.html` → `module.exports = "<content>"` |
| `jest.config.js` / `html-string-transformer.js` | 同上，契约测无需改断言面 |
| `src/types/html-modules.d.ts` | `declare module '*.html'` |
| WebView 组件 | 导入符号不变，尽量不改 |

## 验收标准

- [x] 仓库主交付为 `*.assembled.html`；不存在巨型 `transcript-html.generated.ts` / `document-html.generated.ts`。
- [x] 导出符号与 `source={{ html, baseUrl }}` 主路径保持。
- [x] `assemble:webview-html` 与相关契约 Jest 全绿。
- [x] 父级 SPEC 结构树 / Step 与定案一致；本敏捷 PRD/SPEC 留痕。

## 测试用例

| ID | 说明 |
|----|------|
| T-AG-01 | `npm run assemble:webview-html -w @novel-master/mobile` 成功并写出双端 `.assembled.html` |
| T-AG-02 | Jest：`chat-transcript-boot-script` / `chat-transcript-rich-styles` / `rich-document-boot-script` 全绿 |
| T-AG-03 | 仓库无作为主交付的 HTML `*.generated.ts` |
