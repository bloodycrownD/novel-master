---
date: 2026-07-23
agile_trace: true
---

# mobile-chat-codeblock-soft-wrap 实现规格（SPEC）

## 根因 / 方案摘要

`buildRichContentCssRules` 中 `pre` 仅设 `overflow-x: auto`，未覆盖 UA `white-space: pre`。改为 `white-space: pre-wrap` + `overflow-wrap: anywhere`，并保留 `overflow-x: auto` 兜底。

## 变更点清单

| 文件 | 变更 |
|------|------|
| `apps/mobile/src/web/shared/rich-content-styles.ts` | `pre` soft-wrap 规则 |
| `apps/mobile/__tests__/rich-content-styles.test.ts` | 断言聊天 + 文档 CSS 含 soft-wrap |

## 详细改动说明

```css
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow-x: auto;
  margin: 0.35em 0;
}
```

`CHAT_TRANSCRIPT_RICH_CSS` 与 `RICH_DOCUMENT_RICH_CSS` 同源生成，聊天与 VFS 预览一并生效。Desktop 不改。

## 测试策略

### 测试用例

- 宿主：`apps/mobile/__tests__/rich-content-styles.test.ts`
- 断言：`CHAT_TRANSCRIPT_RICH_CSS` / `RICH_DOCUMENT_RICH_CSS` 均含 `white-space: pre-wrap` 与 `overflow-wrap: anywhere`
- 命令：`npx jest __tests__/rich-content-styles.test.ts --no-coverage`（cwd `apps/mobile`）

## 风险与回滚方案

- 超长无空格 token 可能「难看地」折断；可接受。
- 真机须重新 `build:webview` 才见效。
- 回滚：还原 `pre` 单行规则即可。
