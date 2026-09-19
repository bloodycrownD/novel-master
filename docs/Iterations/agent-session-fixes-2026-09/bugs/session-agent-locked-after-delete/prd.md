---
date: 2026-09-19
dependency: iterations/agent-session-fixes-2026-09/prd.md
---

# session-agent-locked-after-delete Bug PRD

## 背景

会话绑定的智能体存的是 agentId 引用（chat_session.agent_config_json，无外键）。删除智能体（设置页入口）后引用悬空，会话侧 meta 解析失败归一为 `source:'none'`，双端 UI 按「source 非 session 即锁定」的设计把智能体卡锁死——而重新选择恰恰是修复悬空引用的唯一 UI 途径，形成死锁；同时发消息走同一条解析链也会失败，会话完全不可用。

## 现象描述

删除智能体后，引用它的会话里智能体卡呈锁定态，点击只弹「当前会话未绑定有效智能体，无法在会话内切换」提示，不弹选择器，无法切换到其它智能体；该会话发送消息也失败。

## 复现步骤

1. 创建智能体 A，新建会话并绑定 A；
2. 设置页删除智能体 A；
3. 打开该会话的详情抽屉（desktop）/ 详情页或聊天顶栏（mobile），点智能体卡——只弹提示，无法切换。

## 预期行为

智能体被删后，会话的智能体卡进入「待重选」态：可点击、弹出选择器、选择任一存在的智能体后绑定恢复、发送消息恢复。模型卡在重选前保持锁定（智能体没了，pin 的模型无从解析）。

## 实际行为（修复前）

- `agentLocked = source !== 'session'` 把「智能体已删除」与「meta 加载中」一并锁死，点击只弹 toast 不弹 picker；
- 该锁卡行为被 chat-session-detail-page 迭代固化为预期（双端测试断言钉死）。

## 影响范围

- desktop：SessionDetailDrawer（会话详情抽屉）；
- mobile：SessionDetailScreen（详情页）、ChatConversationPanel/ChatMetaBar（聊天顶栏）三处消费方；
- core 不动（删除不级联的现状保留，见父 PRD「明确不做」）。

## 验收标准

1. 智能体被删后（source='none' 且 meta 已加载）：双端智能体卡可点击并弹出选择器，卡片/文案呈现「已被删除，请重新选择」语义；
2. 选择新智能体后：会话绑定恢复，meta 显示新智能体，发送消息恢复；
3. 模型卡在重选前保持锁定；meta 加载中智能体卡仍不可点（避免加载期误操作）；
4. 正常会话（source='session'）行为不变。

## 回归测试要点

- 双端原有「none 态锁卡」断言已更新为新口径（智能体卡放开、模型卡仍锁）；
- meta 加载中不可点；正常路径不受影响。
