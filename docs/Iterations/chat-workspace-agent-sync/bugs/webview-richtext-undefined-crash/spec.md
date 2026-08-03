---
date: 2026-06-13
---

# webview-richtext-undefined-crash Bug 修复规格（SPEC）

## 根因分析

`ChatTranscriptWebView` 中监听 `flags?.richText` 变化的 `useEffect` 误用裸标识符 `richText`（未在作用域内定义），依赖数组虽含 `flags?.richText`，effect 体内直接读 `richText` 在 Hermes 下抛出 `ReferenceError`，React 呈现为 Render Error。

该回归来自两事件 UX 重构合并 effect 时的笔误；堆栈常落在相邻的 `streamToolInvoking` effect 附近，易误判为 bridge 类型问题。

## 修复方案

1. effect 内显式 `const richText = flags?.richText ?? false`
2. 补 `if (!webReady) return` 与其他 effect 一致
3. 单测覆盖 `richText` 切换与 `toolInvoking` bridge

## 变更点清单

| 文件 | 变更 |
|------|------|
| `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx` | 修复 richText 作用域 |
| `apps/mobile/__tests__/chat-transcript-webview.test.tsx` | 回归用例 |

## 测试策略

### 测试用例

- `toolInvoking` false→true：post `streamToolInvoking` active=true
- `flags.richText` false→true：不抛错，post `sessionSnapshot`

## 风险与回滚方案

- 风险极低；回滚为错误写法会恢复崩溃
