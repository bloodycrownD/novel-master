---
date: 2026-06-13
---

# missing-set-mobile-agent-active-import Bug 修复规格（SPEC）

## 根因分析

`781eb82` 重构 `ChatConversationPanel.tsx` 删除 metrics 相关 import 时，一并移除了：

```typescript
import { setMobileAgentActive } from '../../../runtime/agent-activity';
```

但 `onRunningChange` 回调仍保留 `setMobileAgentActive(running)` 调用。Hermes 对未声明标识符报 `Property 'setMobileAgentActive' doesn't exist`。

## 修复方案

恢复 `setMobileAgentActive` 的 import，调用逻辑不变。

## 变更点清单

| 文件 | 变更 |
|------|------|
| `apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx` | 补 import |

## 测试策略

### 测试用例

- `apps/mobile/__tests__/agent-activity.test.ts`（已有）
- 类型检查 / lint 确保无未定义引用

## 风险与回滚方案

- 无风险；纯缺失 import 补回
