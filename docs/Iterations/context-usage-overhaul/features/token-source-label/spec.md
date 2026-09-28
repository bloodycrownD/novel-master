---
date: 2026-09-28
---

# token-source-label 技术规格（SPEC）

## 设计目标

以 core 单源映射函数产出新标签（源记号 + =/≈ 连接符 + 百分比 + 上下文数），替换「预估/上次请求 + ~」旧体系；desktop 走「main 拼好下发」消除 renderer X1 违规；收敛 core 两份重复 usage label。依赖 `fallback-caliber-align`（rn countTiktoken 升级真值后，GPT 家族双端才能同显 `gpt =`）。需求来源：`docs/Iterations/context-usage-overhaul/features/token-source-label/prd.md`。

## 总体方案

**core 新映射模块** `infra/tokenizer/logic/format-token-source-badge.ts`：

```ts
type TokenSourceBadge = { mark: string; connector: "=" | "≈" };
// mark: "远程" | 家族展示名 | "gpt"；连接符 = 精确 / ≈ 估算（终极档同 heuristic 行：gpt ≈）
formatTokenSourceBadge(source, counterKind, estimated): TokenSourceBadge
// 完整标签：有窗口 `${mark} ${connector} ${pct}% ${cur}/${cw}`；无窗口 `${mark} ${connector} ${X} tokens`
formatContextUsageLabel(count, contextWindow?, badge?): string
```

映射规则（输入域实锚：`source ∈ {api,local}`、`counterKind ∈ {api} ∪ 16 家族值`、`estimated ∈ bool`）：

| 条件 | mark | connector |
|---|---|---|
| source=api | 远程 | =（api ⇒ est=false 恒成立） |
| counterKind=tiktoken/gpt2 且 est=false | gpt | = |
| counterKind=家族名 且 est=false | 家族展示名（映射表） | = |
| counterKind=家族名 且 est=true（fa feature 修复后此态消失，防御保留） | gpt | ≈ |
| counterKind=heuristic（一切 cl100k 兜底，含字符折算终极档） | gpt | ≈ |

> 拍板（2026-09-28 spec-check 第 1 轮 P0-1）：字符折算终极档与 cl100k 兜底**合并为同一行**（同显 `gpt ≈`）。理由：终极档仅在词表彻底建不起来的异常场景出现、区分收益低；若要区分须给驱动加第四判别信号（counterKind 新档或 degraded 字段），动 fa+tl 两处契约不值。输入域注意：`(source, counterKind, estimated)` 三元组无法区分「cl100k 兜底」与「折算兜底」是**已知且接受**的语义。

家族展示名映射表（模块内常量）：tiktoken→gpt、gpt2→gpt、qwen2→qwen、llama3→llama、command-r→command，其余原样。未知 counterKind 原样透传 mark（防御未来家族）。**输入域注记**：`counterKind="gpt2"` 实际不可达（node 端 family=gpt2 报 `tiktoken`、rn 端报 `heuristic`、fa 修复后也报 `tiktoken`）——gpt2 映射行为纯防御输入，测试以直接构造 counterKind 值覆盖（不经驱动）。

**收敛重复实现**：`count-prompt-llm-input.ts:94-131` 的第二份 `formatPromptTokenUsageLabel`/`formatCompact` **零生产调用方**（git grep 核实：全部 import 走 `@novel-master/core/common` 版，CLI 零引用，desktop deprecated 链自拼不 import 它）——仅删导出链（`infra/tokenizer/index.ts:42`、`public/provider.ts:144`）与 allowlist 快照联动，无调用方需迁移。`format-token-source-label.ts`（旧「上次请求/预估」）与 `format-counter-kind-label.ts` 退役删除，调用方迁移到新模块（注意 `format-counter-kind-label` 的 mobile 测试断言 `__tests__/chat-prompt-tokens.test.ts:268-271` 随删除同步更新）。`apps/desktop/shared/logic/format-token-count.ts` 镜像本次不改数字语义则不动。

**desktop**：main `chat-prompt-tokens.service.ts` 的 `buildTokenStats` 产出 Response 时追加 `label: string` 字段（`formatContextUsageLabel` 拼好）；`shared/ipc-types.ts` 的 `PromptChatTokenStatsResponse` 加 `label`（:869-874 的 source 字段旧语义注释同步改写）。renderer `SessionDetailDrawer.tsx` 改纯渲染：`tokenCountLabel`（:77-88）与 Tooltip（:568-572）的本地拼装删除，直接用 `stats.label`；pct 头部（:546-551）与标签内 pct 二选一——UI 重排为「头部只渲染 label 一行」，`~` 拼接移除。X1 清理三处：`:64/:65`（label 相关 import）随改造删除；**:54 是 `@novel-master/core/events` 的事件常量与类型（与 label 无关）——事件常量经 `@shared` 薄再导出迁出（新建 `apps/desktop/shared/logic/events.ts`，先例 `format.ts`），事件订阅逻辑不动**。`formatChatTokenStatsLabel`（deprecated 链，`loadChatPromptTokenLabelResilient` 调用）**拍板删除**（零生产消费，git grep 核实仅测试引用；测试断言一并移除）。

**mobile**：`chat-prompt-tokens.service.ts` 的 `formatChatTokenLabel`（:58-71）改用 `formatContextUsageLabel` + badge；`ChatAgentMeta.tokenLabel` 保持 string 形态（ChatMetaBar 纯文本渲染不动）；类型注释过时示例顺带更新。

## 最终项目结构

```
packages/core/src/infra/tokenizer/logic/
  ├─ format-token-source-badge.ts   [新增] badge + 完整标签拼装（单源）
  ├─ format-token-source-label.ts   [删] 旧「上次请求/预估」
  ├─ format-counter-kind-label.ts   [删] 死导出
  └─ count-prompt-llm-input.ts      [改] 删重复 label 实现
packages/core/src/common/format-token-count.ts  [改] 吸收拼装、去 ~
apps/desktop/shared/ipc-types.ts                [改] Response + label
apps/desktop/src/main/services/chat-prompt-tokens.service.ts [改] buildTokenStats 产 label
apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx  [改] 纯渲染 + X1 清理 + UI 重排
apps/mobile/src/services/chat-prompt-tokens.service.ts       [改] formatChatTokenLabel 换新
```

## 变更点清单

| 文件 | 变更 |
|---|---|
| `format-token-source-badge.ts` | 新增 `formatTokenSourceBadge` / `formatContextUsageLabel` + 家族展示名常量表；导出进 `index.ts`/`public/provider.ts`（allowlist 快照联动） |
| `common/format-token-count.ts` | `formatPromptTokenUsageLabel` 改签名（去 estimated/~，接受 badge）；`formatTokenCount` 数字格式不动 |
| `count-prompt-llm-input.ts:94-131` | 删除（重复实现；**零生产调用方，仅删导出链** `infra/tokenizer/index.ts:42` / `public/provider.ts:144` 与 allowlist 快照联动） |
| `apps/desktop/shared/ipc-types.ts:863-876` | `PromptChatTokenStatsResponse` 加 `label: string` |
| `apps/desktop/src/main/services/chat-prompt-tokens.service.ts` | `buildTokenStats` 拼 label；deprecated 链**整体删除**（`formatChatTokenStatsLabel` + `loadChatPromptTokenLabelResilient`，零生产消费，测试断言一并移除——唯一口径，无「对齐」选项） |
| `apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx` | :54/:64/:65 删 core import；:77-88 `tokenCountLabel` 删（用 stats.label）；:546-549 pct 头部重排；:568-572 Tooltip 用 label |
| `apps/mobile/src/services/chat-prompt-tokens.service.ts:58-71` | `formatChatTokenLabel` 换新拼装；:73 过时注释更新 |
| 测试 | core `format-token-source-badge.test.ts`（新，替代 `format-token-source-label.test.ts`）；desktop `chat-prompt-tokens.test.ts`（`formatChatTokenStatsLabel` 断言随删除移除）；mobile `__tests__/chat-prompt-tokens.test.ts`（:2/:34-35/:268-271 旧断言重写）与 `__tests__/format-token-count.test.ts`（:18-24 estimated 用例随签名变更失效，同步更新）；CLI `prompt render --tokens` 契约回归 |

## 详细实现步骤

- Step 1 — phase-label-core — blocking: yes — qa: auto：新 badge 模块 + common 收敛 + 旧模块删除 + 导出面/快照 + core 单测（T-TL1/T-TL2）。
- Step 2 — phase-label-desktop — blocking: yes — qa: auto：main 拼 label 下发 + Response 字段 + renderer 纯渲染改造 + X1 清零 + UI 重排 + desktop 测试更新（T-TL3）。
- Step 3 — phase-label-mobile — blocking: yes — qa: auto：mobile service 换新 + jest 断言更新（T-TL4）。
- Step 4 — phase-label-verify — blocking: yes — qa: auto：双端一致性对拍（同输入 badge → 同 label 字符串，双端测试共享夹具）；CLI `prompt render --tokens` JSON 契约字段回归（counter/estimated 字段名不变）（T-TL5）。

## 测试策略

### 测试用例

- T-TL1 — blocking: yes — badge 映射断言（**可构造组合**逐行：api / tiktoken+false / glm+false / glm+true→gpt≈ / heuristic→gpt≈[含终极档同值] / 未知家族原样 / 家族展示名映射含防御性 gpt2）；断言有牙：改错任一映射必红。
- T-TL2 — blocking: yes — 完整标签格式：有窗口 `远程 = 42% 55/128K`（K/M 压缩、pct 封顶）；无窗口 `gpt ≈ 2.3K tokens`；非法 count 显示 `—`。
- T-TL3 — blocking: yes — desktop：Response.label 与 UI 渲染一致；X1 lint 通过（`npx eslint renderer/features/chat/SessionDetailDrawer.tsx` 零 error）；无 `~` 残留（全文断言）。
- T-TL4 — blocking: yes — mobile：同 T-TL3 等价断言（jest）；旧断言（`· 预估`、`^~`）确认已迁移。
- T-TL5 — blocking: yes — 契约回归：CLI stderr JSON 字段名不变；压缩触发器 `counterKind==="heuristic"` 联动测试全绿（映射只动展示层，生产语义零改动）。

## 风险与回滚方案

- **UI 重排回归风险**（desktop chip 区块结构变化）：Step 2 独立 commit，回滚仅 revert 该 commit（label 字段保留也不影响旧渲染）。
- **「glm+est=true → gpt ≈」防御分支**在 fa feature 修复后理论不可达：保留映射（防未来家族资产失败回潮），测试用直接构造输入锁定（不经驱动）。
- **deprecated 链路**（`loadChatPromptTokenLabelResilient` + `formatChatTokenStatsLabel`）已拍板删除（零生产消费，git grep 核实），相关测试断言一并移除。
