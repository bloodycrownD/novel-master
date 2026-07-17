---
date: 2026-07-17
agile_trace: true
---

# split-transcript-boot-runtime 实现规格（SPEC）

## 根因 / 方案摘要

父级资源化落地后，`boot/runtime.js` 仍承载状态、滚动、渲染、菜单、快照、流式与 host 桥等全部「其余」逻辑。本敏捷在**不改变 WebView 加载 API**的前提下，按职责将巨石切为独立 concat 片段，继续由 `assemble-webview-html.mjs` 打成单 IIFE 注入 HTML。

## 变更点清单

1. 删除 `apps/mobile/src/web/chat-transcript/boot/runtime.js`
2. 新增切片：`html-escape.js`、`state.js`、`scroll.js`、`tool-render.js`、`row-render.js`、`menu.js`、`stream.js`、`snapshot.js`、`rows-click.js`、`bridge.js`（theme 并入 bridge；保留既有 `stream-markdown.js` / `vfs-tool-path.js` / `main.js`）
3. 更新 `concatTranscriptBoot` 顺序与顶部定案注释
4. 重生成 `transcript-html.generated.ts`（及 constants）
5. `chat-transcript-set-floor-menu.test.ts` 注释路径改为 `menu.js`

## 详细改动说明

### Concat 顺序（定案）

```text
1. generated-constants.js
2. shared/boot/decode-entities.js
3. html-escape.js
4. stream-markdown.js
5. state.js
6. vfs-tool-path.js
7. scroll.js
8. tool-render.js
9. row-render.js
10. menu.js
11. stream.js
12. snapshot.js
13. rows-click.js
14. bridge.js
15. main.js
```

约束：无 ES module；同 IIFE 共享词法作用域；`function` 声明风格避免 TDZ；`main.js` 必须最后。

### 职责映射

| 文件 | 职责 |
|------|------|
| `html-escape.js` | HTML 转义（供 markdown 等使用） |
| `state.js` | `state` / schema / `VFS_FILE_TOOLS` |
| `scroll.js` | 贴底、near-bottom、滚动快照 |
| `tool-render.js` | 工具摘要与 tool group UI |
| `row-render.js` | 消息行 / 气泡 / 附件组渲染 |
| `menu.js` | 锚定菜单与长按 |
| `stream.js` | 流式 tail / delta / batch DOM |
| `snapshot.js` | snapshot / prepend / commit 编排 |
| `rows-click.js` | 行内点击 |
| `bridge.js` | `post`、主题、`onHostMessage` |

## 测试策略

### 测试用例

- 组装脚本成功写出 transcript / rich-document 生成物
- 既有契约测从组装 HTML 抽取 `<script>`：`chat-transcript-boot-script`、`chat-transcript-rich-styles`、`chat-transcript-set-floor-menu`、`rich-document-boot-script`

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| concat 顺序错误导致运行期 ReferenceError | 契约 `new Function` + 真机 smoke；保持 function 提升 |
| 生成物未提交导致漂移 | 改资产后必跑 assemble 并入库 |

回滚：恢复 `runtime.js` 单文件 concat 列表，或 `git revert` 本敏捷提交。
