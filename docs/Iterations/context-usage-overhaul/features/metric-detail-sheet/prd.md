---
date: 2026-09-28
dependency: iterations/context-usage-overhaul/prd.md
---

# metric-detail-sheet（指标详情弹窗）PRD

## 背景

承接迭代总纲范围第 7 条。双端流式指标条（desktop `AgentStreamMetricsBar` / mobile `ChatStreamMetricsBar(Live)`）目前是纯渲染组件、无任何点击交互。用户希望点击后弹出详情，展示最近请求与会话累计的 token 计量。数据基础已齐备：`chat_message` 逐消息 token 列（prompt/completion/cache_read/cache_creation/model_name/provider）由 agent-runner 每步落库；命中率计费口径在用量统计页已有权威实现（anthropic 行 input 加回 cache 列）。

## 目标（含成功指标）

1. 双端指标条可点击弹出详情弹窗，一跳读到：最近请求（模型/输入/输出/缓存命中拆分与命中率）+ 会话累计（消息数/工具调用数/累计输入输出/当前上下文占用）。
2. 口径与用量统计页同源同计费口径；无 usage 数据显示占位不报错。

## 范围

### 包含范围

- core：usage-stats 会话维度查询（会话累计聚合 + 最近 usage 行）；会话级工具调用计数
- desktop：指标条 onClick + popover 弹窗；usageStats IPC 扩会话维度 kind
- mobile：指标条 Pressable + 底部 sheet（ModalShell）；子会话屏（SubagentSessionScreen）复用点同步接入
- 弹窗数据弹窗自取（不进指标条 props，保持 mobile 250ms tick 渲染隔离）

### 不包含范围

- 用量统计页本体不动
- 指标条不可见（无历史 run）时的替代入口不做（desktop 会话详情抽屉已有 token 区块兜底）
- 不做 run 级历史列表（每步明细），仅「最近一条 + 会话累计」两段

## 核心需求

1. 「最近请求」= 本会话最近一条有 usage 的 assistant 消息（step 级真值）；与指标条冻结值（run 级显示口径）天然不同源，弹窗内以字段口径标注（「最近请求」≠「最近一轮」），不做数值对齐。
2. 「会话累计」token 聚合含 hidden 行（与统计页「历史消耗」口径一致）；「消息数」按可见口径（与上下文 chip 一致）——两口径并存且分别标注。
3. 命中率公式沿用统计页：`cache_read / (billed_input)`，billed = anthropic 行 prompt+cache_read+cache_creation、其余协议 prompt；cache 列 NULL = 未上报（显示 —，不入分母），显式 0 合法。
4. 工具调用数 = 会话内 assistant 消息 tool_use 块总数（打开弹窗时现算，加载态展示）。

## 验收标准

- Given 会话已有带 usage 的 assistant 消息，When 点击指标条，Then 弹窗展示两段数据，数值与用量统计页同源同口径。
- Given openai 协议消息（无 cache_creation），Then 该字段显示 — 不报错。
- Given 无任何 usage 的会话，When 打开弹窗，Then 最近请求段显示占位（—），会话累计段正常显示消息数/上下文占用。
- 子会话屏指标条同样可点击弹窗（父会话工作区语义下数据按子会话自身统计）。
