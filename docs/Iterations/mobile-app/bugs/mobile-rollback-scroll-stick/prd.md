---
date: 2026-07-03
dependency: Iterations/mobile-app/prd.md
---

# mobile-rollback-scroll-stick Bug PRD

## 背景

Mobile 聊天 transcript 默认使用 WebView 引擎（`#rows { justify-content: flex-end }`）。消息回滚成功后数据层已通过 `reloadMessages(true)` 重载 tail，但展示层仍发送 `sessionSnapshot('preserve')`，在 flex-end 布局下视口恢复不准，表现为列表跳到中间而非底部。

此前 `chat-rollback-vfs-tool-fixes` 迭代在 WebView 内用 offset-from-bottom 修复「中间阅读回滚跳顶」；本次产品决策改为：**回滚后一律贴底**，与「进入消息页正常底部渲染」一致。

## 现象描述

- 在聊天 transcript 中长按消息执行回滚
- 回滚成功、下方消息消失
- 视口停留在列表中间，而非底部

## 复现步骤

1. 打开 Mobile 会话，发送若干条消息（≥3 条）
2. （可选）上滚 transcript 到中间位置
3. 长按某条消息 → 回滚 → 确认
4. 观察回滚后 scroll 位置

## 预期行为

- 回滚成功后 transcript **贴底**（距底部 ≤ 80px）
- 下方被截断的消息不再显示
- 压缩、批量隐藏等**不改变消息条数**的操作不受影响（仍保持当前 scroll 策略）

## 实际行为

- 回滚后视口常落在 transcript 中间
- 数据已正确缩短，问题仅在 scroll intent

## 影响范围

| 范围 | 说明 |
|------|------|
| WebView transcript（默认） | 回滚、批量删除等 tail 缩短场景 |
| Legacy MessageList | 不在本次修复范围 |
| 压缩 / 批量隐藏 | 消息条数不变，行为不变 |

## 验收标准

- [ ] 回滚成功后 transcript 贴底
- [ ] 批量删除 tail 后同样贴底
- [ ] 压缩、隐藏后 scroll 行为与改前一致（preserve）
- [ ] `chat-transcript-webview.test.tsx` 新增 shrink→stick、同长度→preserve 用例通过
- [ ] E2E `chat.rollback.e2e.ts` 回滚后 `assertBottomAfterRollback` 通过

## 回归测试要点

- 贴底回滚 → 仍贴底
- 中间位置回滚 → 回滚后贴底（不再保留锚点）
- 同长度 hidden 标志变更 → preserve，不强制贴底
