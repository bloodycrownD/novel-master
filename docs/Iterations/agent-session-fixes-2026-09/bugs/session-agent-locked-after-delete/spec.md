---
date: 2026-09-19
agile_trace: true
---

# session-agent-locked-after-delete 实现规格（SPEC）

## 根因 / 方案摘要

删除智能体不级联（`agentRegistry.delete` 只删行+重置 workspace 指针）→ 引用会话 agentId 悬空 → `resolveAgentForProject` 抛错 → 双端 meta 归一 `source:'none'` → UI 按 `source !== 'session'` 锁死智能体卡（chat-session-detail-page 迭代的有意设计）→ 重选被锁，死锁。

方案（用户拍板最小修复）：仅放开重选——`source==='none'` 且 meta 已加载时，智能体卡从锁死改为「待重选」（可点、弹 picker、换绑即恢复）；模型卡保持锁定；不加级联/校验/广播。

## 变更点清单

| 提交 | 内容 |
|------|------|
| `85feda7d` | desktop：SessionDetailDrawer 的 `agentLocked` 拆为仅「meta 未加载」时锁定，新增 `agentDeleted = meta != null && source === 'none'`；none 态 openAgentPicker 不再早退、正常弹 picker 并 toast「智能体已被删除，请重新选择」；加载中 toast 改「智能体信息加载中，请稍候再试」；智能体卡渲染「智能体已删除 · 点击重选」badge（shell.css 新增 `--reselect` 警示色样式）；模型卡维持锁定；头注释口径更新；测试断言同步 |
| `98b70d83` | mobile：chat-agent-meta.ts 拆分 `isAgentLocked`（仅未加载锁）/`isModelLocked`（维持 source!=='session'），新增 `isAgentDeleted` 与 `AGENT_RESELECT_TOAST`/`AGENT_RESELECT_HINT` 常量；SessionDetailScreen、ChatConversationPanel、ChatMetaBar 三处消费方同步（none 态点智能体卡弹重选提示+开 picker）；旧「与 B-1 方案一致」互引注释清理；chat-agent-meta.test 补拆分语义用例、screen 测试断言更新 |

## 详细改动说明

- 锁定语义拆分：原 `locked = source !== 'session'` 混合了「加载中」与「已删除」两种状态，本次拆开——加载中仍锁（防误操作），已删除放开（待重选）。
- 切换链路零改动：`ipcSessionsSetAgentBinding`（desktop）/ `selectSessionAgent` → `updateSessionAgentConfig`（mobile）本就不校验存在性，none 态直写新 agentId 即恢复；picker 当前值高亮在 none 态拿不到有效 id 就不高亮，未补字段。
- core 零改动：删除不级联的现状保留（取舍见父 PRD「明确不做」）。

## 测试策略

- desktop：session-detail-drawer.test.ts 12/12（断言更新为 none 态放开/模型锁/旧文案退役）；
- mobile：session-detail-screen + chat-agent-meta 24/24，触碰模块关联的 8 个测试文件 72/72；
- desktop 全量 480/484——3 个失败为 Secret Service 环境既有问题（git stash 基线复跑同样失败，与本改动无关）；
- 根 typecheck 全绿。

### 测试用例

1. none 态：智能体卡可点、弹 picker、toast 重选语义；模型卡锁定只弹提示；
2. meta 加载中：智能体卡不可点，toast 加载中语义；
3. isAgentLocked/isModelLocked/isAgentDeleted 拆分语义（mobile 单元）；
4. 正常 source='session' 路径不受影响。

## 风险与回滚方案

- 两个提交独立可 revert，双端行为对称；
- 放开后的唯一残留：重选前该会话发不出消息（显式「待重选」状态可见，非暗坑）；若产品未来想要删除级联，父 PRD 已记录否决理由与前提。
