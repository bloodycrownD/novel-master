---
date: 2026-07-03
---

# mobile-rollback-scroll-stick Bug 修复规格（SPEC）

> **父级 PRD**：[../../prd.md](../../prd.md)  
> **Bug PRD**：[prd.md](./prd.md)  
> **分支**：`fix/mobile-rollback-scroll-stick`

## 根因 / 方案摘要

**根因**：`ChatTranscriptWebView` messages effect 在列表缩短（`messages.length < prevCount`）时仍调用 `sendSessionSnapshot('preserve')`。WebView `applySnapshot` 的 preserve 分支按距底偏移恢复 scroll，在 flex-end 布局 + tail 大幅缩短时视口落在错误位置。

**方案**：列表缩短时改发 `scrollIntent: 'stick'`，WebView 侧已有 `stickToBottom` 分支，无需改动 `main.ts`。

数据层 `reloadMessages(true)` 已正确，本次仅改 RN 编排层 scroll intent。

## 变更点清单

| 文件 | 变更 |
|------|------|
| `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx` | `messages.length < prevCount` → `stick`，否则 `preserve` |
| `apps/mobile/__tests__/chat-transcript-webview.test.tsx` | 新增 shrink→stick、同长度→preserve 用例 |
| `apps/mobile/e2e/helpers/scroll-anchor.ts` | `assertAnchorStableAfterRollback` → `assertBottomAfterRollback` |
| `apps/mobile/e2e/specs/chat.rollback.e2e.ts` | 回滚后断言贴底；新增贴底回滚用例 |

## 详细改动说明

### ChatTranscriptWebView messages effect

```typescript
const shrink = messages.length < prevCount;
sendSessionSnapshot(shrink ? 'stick' : 'preserve');
```

**触发 shrink 的路径**：

- `handleRollbackFromMessage` → `reloadMessages(true)`
- 批量删除 → `truncateMessagesAfter` → `reloadMessages(true)`

**不触发 shrink 的路径**（仍 preserve）：

- 压缩（`hideMessagesInRange`，条数不变）
- 批量隐藏/恢复（hidden 标志变，条数不变）
- 消息内容编辑（条数不变）

### E2E

- 移除「上滚后回滚锚点稳定」断言（与 stick 策略冲突）
- 改用 `assertBottomAfterRollback`（`offsetFromBottom ≤ 80px`，与 WebView `NEAR_BOTTOM_THRESHOLD_PX` 对齐）

## 测试策略

### 单元测试

| ID | 场景 | 预期 |
|----|------|------|
| T-shrink | messages 从 N 条变为更少 | `sessionSnapshot.scrollIntent === 'stick'` |
| T-preserve | 同长度、hidden 标志变 | `scrollIntent === 'preserve'` |

### E2E

| ID | 场景 | 预期 |
|----|------|------|
| E2-stick-mid | 上滚后回滚 | 回滚后贴底 |
| E2-stick-bottom | 贴底时回滚 | 回滚后仍贴底 |

### 验证命令

```bash
cd apps/mobile && npm test -- --testPathPattern=chat-transcript-webview.test.tsx --no-coverage
cd apps/mobile && npm run e2e -- --spec e2e/specs/chat.rollback.e2e.ts
```

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 中间阅读回滚不再保留锚点 | 产品已确认：回滚后一律贴底 |
| 批量删除同走 stick | 可接受；删除后查看尾部是合理默认 |
| 与 `chat-rollback-vfs-tool-fixes` spec 验收冲突 | 本 bug spec  supersede 中间锚点验收；WebView offset 恢复逻辑保留供非 shrink 场景使用 |

**回滚**：revert `ChatTranscriptWebView.tsx` 单行分支即可恢复 preserve 行为。
