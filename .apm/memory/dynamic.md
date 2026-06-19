---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-06-19 16:00:00'
---
# 动态记忆 — stream-display-rewrite

## 状态：spec 修订待用户确认（九项风险已写入）

## 已定决策
- Runtime: useExternalStoreRuntime（无 setMessages；Spike 验 warn/workaround）
- Bus: runtime 独占 STREAM+STEP+RUN+RUN_FAILED；Composer library **零 Bus**
- agentRunning: useChatLibraryRuntime 暴露（ChatTabScreen 不读旁路 stream）
- Tool: TOOL_USE 订阅；废弃 useStreamToolInvoking
- Display: Ingress 32ms；Apply 默认 re-render ~20Hz（Spike 写死；字符配额备选）

## 文档
- `.apm/kb/docs/Iterations/stream-display-rewrite/{prd,spec,research}.md`

## 下一步
- 用户确认 spec → feature/stream-display-rewrite Step 0
