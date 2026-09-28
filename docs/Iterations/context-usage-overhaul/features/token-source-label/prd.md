---
date: 2026-09-28
dependency: iterations/context-usage-overhaul/prd.md
---

# token-source-label（标签体系更换）PRD

## 背景

承接迭代总纲范围第 4 条。现状「预估/上次请求」只表达值来源不表达词表（GLM 用户误读为路由 bug）；`~` 前缀表达近似不直观；counterKind 已透传到 desktop renderer 但 UI 不消费；core 存在两份重复的 `formatPromptTokenUsageLabel` 实现、双端三处标签格式不一致。用户拍板新体系：完整标签 =【源记号 连接符 百分比 上下文 token 数】——`远程 =`（usage 真值）/ `glm =`（家族词表精确）/ `gpt =`（OpenAI 家族精确）/ `gpt ≈`（cl100k 估算兜底）。源记号如实反映实际词表，天然杜绝谎报误读。

## 目标（含成功指标）

1. 标签自解释：三要素（源记号/连接符/数值）双端一致单源；`~` 退役。
2. 降级诚实：家族词表加载失败退 cl100k 时显示 `gpt ≈` 而非原家族名。
3. 消除重复实现：core 两份 usage label 收敛为一份；desktop renderer X1 违规 import 清零。

## 范围

### 包含范围

- core 新映射函数（源记号 + 连接符 + 完整标签拼装）单源维护
- desktop：main 拼装完整 label 经 IPC 下发（Response 加 label 字段），renderer 纯渲染；SessionDetailDrawer 既有 3 处 X1 违规 import 清理；chip UI 区块重排（pct 一体化显示不重复）
- mobile：service 层拼装（可直接 import core）
- 双端旧断言测试更新；`~` 前缀全部退役

### 不包含范围

- counterKind/estimated 的产出语义不动（压缩 0.85 安全系数联动、CLI `prompt render --tokens` 的 JSON 契约字段均保持）
- 用量统计页（token-usage-stats）的展示不动
- metric-detail-sheet 弹窗内标签（该 feature 自行复用本 feature 映射）

## 核心需求

1. 映射规则：`source=api → 远程 =`；`counterKind=tiktoken 且 est=false → gpt =`；`counterKind∈家族名 且 est=false → 家族名 =`；`est=true（家族词表失败或 heuristic 兜底）→ gpt ≈`；未知家族名原样显示。
2. 展示名映射：tiktoken/gpt2→`gpt`、qwen2→`qwen`、llama/llama3→`llama`、command-r→`command`，其余（glm/claude/deepseek/gemma/mistral/yi/jamba/nemo）原样。
3. 无窗口态退化格式：`远程 = 2.3K tokens`（无百分比与分母）。
4. 字符折算终极档（词表彻底建不起来）记号：同 `gpt ≈`，不与 cl100k 兜底区分（终极档极难触发，区分需动驱动契约，拍板不做；spec-check 第 1 轮 P0-1 定稿）。

## 验收标准

- Given API 真值命中 → 「远程 = N% X/Y」；Given glm 词表精确 → 「glm = N% X/Y」；Given OpenAI 家族精确 → 「gpt = N% X/Y」；Given 家族词表失败退 cl100k → 「gpt ≈ N% X/Y」。
- 双端同场景标签逐字符一致；全部 UI 与测试无 `~` 前缀残留。
- renderer（desktop）对 `@novel-master/core*` 的 import 违规清零（lint X1 过）。
