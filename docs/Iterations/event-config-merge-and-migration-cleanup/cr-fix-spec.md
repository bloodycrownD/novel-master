# CR Fix Spec — event-config-merge-and-migration-cleanup

> 本文件只描述本轮 code review 的「应如何修复」与「应如何闭合 Spec/实现差异」，不替代业务 spec/prd。
> 业务 spec/prd 只读，禁止在此文件外修改。

---

## 元信息（Meta）

| 字段 | 值 |
|------|-----|
| repo | `D:\Dev\Js\novel-master` |
| base_sha | `v1.4.20` |
| head_sha | `c7d109ba`（含未提交工作区改动） |
| prd_path | `docs/Iterations/event-config-merge-and-migration-cleanup/prd.md` |
| spec_path | `docs/Iterations/event-config-merge-and-migration-cleanup/spec.md` |
| review_round | 1 |
| dag_version | 1 |
| wave | 首轮全部 must-fix（P0/P1/P2），覆盖三个 review scope（A/B/C） |
| status | **draft** |
| 范围约束 | 只改文档（本文件）/ spec / 实现代码由下游 wave 落地；本 wave 只产出 fix-spec，不动业务 spec/prd、不动实现代码 |

> 工作区说明：head 指向 `c7d109ba`，且工作区有未提交改动；下游执行时需先把未提交改动按 Token Usage / Bug1-4 / StreamRegistry 分组整理成独立 commit（见 K 节）。

---

## Must-Fix 条目

> 每条须含：id、严重度、维度、文件、问题、改法、验收/测试、来源（round / scope）。

### CR-1 [P0] 测试 mock 作用域错位导致整个测试文件 ReferenceError

- **严重度**：P0
- **维度**：G（测试正确性）
- **文件**：`apps/mobile/__tests__/use-chat-tab-message-actions-rollback.test.ts`
- **问题**：`mountActions`（L107 起的模块顶层函数）内部引用了 `mockRefreshChatTokenLabel`，但该 const 是在 L139 的 describe 回调里声明的。顶层函数按词法作用域解析不到 describe 闭包里的 const，所以 T-M1 / T-M2 / T-S5 在调用 `mountActions([anchor])` 时统一抛 `ReferenceError: mockRefreshChatTokenLabel is not defined`。
- **改法**：把 `const mockRefreshChatTokenLabel = jest.fn();` 从 describe 内挪到模块顶层（与 L38-41 那一组 `mockRollbackToMessage` 等放一起），describe 内删掉该声明。
- **验收/测试**：
  - `apps/mobile/__tests__/use-chat-tab-message-actions-rollback.test.ts` 全部用例能 mount 通过（不再 ReferenceError）。
  - mobile jest 环境当前 broken（见「CR 备注」），无法实际跑通；至少 `npx tsc --noEmit -p apps/mobile/tsconfig.json` 通过。
- **来源**：round 1 / scope C（C/G-1）

---

### CR-2 [P0] streamRegistry 无 per-step reset，多步 run 中段重进会重复渲染

- **严重度**：P0
- **维度**：B（行为回归）、C-orch（orchestration 一致性）
- **文件**：
  - `packages/core/src/service/agent/logic/run-agent-turn.ts`
  - `packages/core/src/service/agent/impl/agent-runner.ts`
  - `packages/core/src/service/agent/agent-stream-registry.port.ts`
- **问题**：SPEC 与 port 注释写的是「step commit 时 reset」，但实现里 `run-agent-turn` 只在 run 开始时 register 一次、run finally 里 unregister 一次；`wrapStreamForBus` 每个 delta 都 append，全程不重置；`agent-runner` 发布 `EVENT_AGENT_STEP_COMMITTED` 时也没有 reset。结果就是用户在 step N≥2 进行中重进子会话时，`streamRegistry.get(sessionId)` 拿到的是 step1+…+stepNpartial 的拼接，前几步已经落库的文本会被当成一条大 delta 重复推到 stream tail（旧路径里 `subagent-stream-cache` 在 `handleStepCommitted` 会 clear，新路径丢了这步清理）——属于可见回归。
- **改法（推荐）**：在 `agent-runner.ts` 发布 `EVENT_AGENT_STEP_COMMITTED`（`phase:'assistant'` 那段，成功 append assistant message 之后）调一次 `this.deps.streamRegistry?.register(sessionId)`（port 本就写明「再次 register 会重置」），让下一步从空累积开始；run-agent-turn 入口的 register 负责建立首步基线，step 边界由 runner 负责重置。同时把 port 注释里「step commit / run 结束时 unregister」的语义顺成「commit 时重置、run 结束时移除」。
- **验收/测试**：
  - 新增 core 测试覆盖「多 step run：step1 commit 后 registry 被重置，step2 delta 不含 step1 文本」。
  - manual_user：真机多步子会话退出再进入，不重复渲染（见「合并后 QA」）。
- **来源**：round 1 / scope C（B-1）

---

### CR-3 [P1] 两端 miss→backfill 逻辑重复，未收敛到 core

- **严重度**：P1
- **维度**：C-orch、C(DRY)
- **文件**：
  - `apps/desktop/src/main/services/chat-prompt-tokens.service.ts`
  - `apps/mobile/src/services/chat-prompt-tokens.service.ts`
  - `packages/core/src/infra/tokenizer/logic/resolve-prompt-tokens-with-backfill.ts`（新建）
  - `packages/core/src/infra/tokenizer/index.ts`
  - `packages/core/src/public/provider.ts`
- **问题**：desktop（L122-127 附近）和 mobile（L71-88）是同一段「resolve → source==='local' → backfillCacheFromMessages → 重新 resolve」的两份副本，只有 params 提取方式不同。本次新引入且语义完全一致，按 C-orch 必须收敛，否则 resolve 行为一变就要两端同步改，漂移风险高。
- **改法**：新建 `packages/core/src/infra/tokenizer/logic/resolve-prompt-tokens-with-backfill.ts`，导出 `resolvePromptTokensWithBackfill(sessionId, rawMessages, params)`（内部先调 `resolveCurrentPromptTokens`，miss 后 backfill 再 resolve）；经 `infra/tokenizer/index.ts` + `public/provider.ts` 导出；两端 service 改调该 helper。
- **验收/测试**：
  - `packages/core/test/infra/tokenizer/` 下补该 helper 的 wiring 用例。
  - 两端 service 行为不变（集成测见 CR-4）。
- **来源**：round 1 / scope B（B/C-orch-1）

---

### CR-4 [P1] service 层 miss→backfill 缺集成测试，mobile 把 backfill mock 死

- **严重度**：P1
- **维度**：G（测试覆盖）
- **文件**：
  - `apps/desktop/test/chat-prompt-tokens.test.ts`
  - `apps/mobile/__tests__/chat-prompt-tokens.test.ts`
- **问题**：desktop 只有一个预置 cache 命中的用例，完全跳过 miss→backfill；mobile L22 把 `backfillCacheFromMessages` 直接 mock 成 `() => false`，回填链路在测试里被关死，接口一变 mobile 感知不到。
- **改法**：
  1. desktop 加一个 it：清空 cache → `messages.append` 一条带 `usage.promptTokens` 的 assistant → `loadChatPromptTokenStats` → 断言 `tokenCount===promptTokens` && `counterKind==='api'` && `estimated===false`（对应 AC-14）。
  2. mobile 把 backfill mock 改成委托真实实现（`jest.requireActual` 或 `mockImplementation`），补一个 it：`mockResolveCurrentPromptTokens` 第一次返回 `source:'local'`、第二次返回 `source:'api'`，断言 backfill 被调用且第二次 resolve 的 `rawMessages` 来自 bundle。
- **验收/测试**：
  - 新增 it 本身即验收。
  - mobile jest 环境若仍 broken，至少 tsc 通过，并注明「jest 环境修复后补跑」。
- **来源**：round 1 / scope B（B/G-1）

---

### CR-5 [P1] desktop rollback-annotate-restore.test.ts 被 Bug1 打穿未更新

- **严重度**：P1
- **维度**：G（测试与实现不一致）
- **文件**：`apps/desktop/test/rollback-annotate-restore.test.ts`（不在原 scope 清单，但被直接打中）
- **问题**：Bug1 在 `applyUndoAnnotateRestore` 开头无条件调用 `clearChatAnnotateDrafts`。现有 T-UOL7「annotate 附件 → store 新 mint id + chip；与未发送并存」（L21 起）和 rewind 用例（L125）先 `addChatAnnotateDraft` 再调用，断言未发送草稿保留——新逻辑会清掉，三处断言全挂。
- **改法**（产品已拍板，见「决策记录」）：清空逻辑按**锚点消息角色**区分，不再无条件清：
  - 锚点为 **assistant 消息** → 直接清空全部批注草稿（含未发送草稿）。
  - 锚点为 **user 消息** → 保留未发送草稿，并从该 user 消息附件重新投影批注（即「重新投影」）。
  - 实现要点：`applyUndoAnnotateRestore` 当前签名只接收 `attachments`，不感知锚点消息角色，需要扩展——由调用方传入锚点角色（如新增参数 `anchorRole: 'user' | 'assistant'`，或在调用处按角色分支后分别调用），函数内部按角色决定「清空」还是「保留未发送 + 反投影」。同时与 mobile 侧对齐（mobile 当前是 `if (mode === 'rewind')` 才清，维度不同，需统一到「按角色」这条规则）。
  - 测试用例随之更新：T-UOL7（L21）按「user 锚点 → 保留未发送 + 反投影」断言；rewind 到 assistant 的用例（L125）按「清空」断言 chips 为空。
- **验收/测试**：
  - 用例按新规则更新后通过。
  - mobile/desktop 两端语义对齐（都按锚点角色区分）。
- **来源**：round 1 / scope C（C/G-2）
- **决策记录**（用户 round 2 拍板）：「对于 assistant 消息直接清空，对于 user 消息则是重新投影。」原 Q1 已闭合。

---

### CR-6 [P1] subagent-stream-cache.tsx 孤儿死代码

- **严重度**：P1
- **维度**：C（死代码）
- **文件**：`apps/mobile/src/screens/stack/subagent-stream-cache.tsx`
- **问题**：`RootNavigator` 已删 `SubagentStreamCacheProvider` 包裹，`SubagentSessionScreen` 已删 `useSubagentStreamCache` 的 import/调用，全仓零引用，该文件纯死代码。SPEC 未列删除。
- **改法**：删除该文件；确认 tsc 通过、grep 无残留引用。
- **验收/测试**：
  - `npx tsc --noEmit -p apps/mobile/tsconfig.json` 通过。
  - `grep` `apps/mobile/src` 对 `subagent-stream-cache` 零命中。
- **来源**：round 1 / scope C（C-1）

---

### CR-7 [P1] streamRegistry.unregister 缺所有权比对，与 abortRegistry 不对称

- **严重度**：P1
- **维度**：B（并发安全）、C-orch（对称性）
- **文件**：
  - `packages/core/src/service/agent/agent-stream-registry.port.ts`
  - `packages/core/src/service/agent/create-agent-stream-registry.ts`
  - `packages/core/src/service/agent/logic/run-agent-turn.ts`
- **问题**：`run-agent-turn` 的 finally 里 `abortRegistry.unregister(sessionId, controller)` 带所有权比对（防止新 run 覆盖误删），而 `streamRegistry.unregister(sessionId)` 不带。若同一 sessionId 先后并发 run A/B，A 的 finally 晚于 B 的 register 时，会把 B 刚 register 的空 partial 删掉，B 后续 delta append 因 `current==null` 静默 no-op，子会话重进查不到。
- **改法（择一，倾向 1）**：
  1. 给 `AgentStreamRegistry` 加 `unregister(sessionId, token?)` 形态，token 用 runId 或 register 返回的句柄，finally 里比对，与 `abortRegistry` 对齐。
  2. 不加所有权，但在 port 注释里明确「调用方须保证同一 sessionId 不并发 run」，并把 run-agent-turn 两个 finally 的注释对齐该说明。
- **验收/测试**：
  - 方案 1 补并发场景测试。
  - 方案 2 仅注释 + 审查。
- **来源**：round 1 / scope C（B-2）

---

### CR-8 [P2] MessageUsage 与 LlmTokenUsage 类型重复定义

- **严重度**：P2
- **维度**：C(DRY)
- **文件**：
  - `packages/core/src/domain/chat/model/message-usage.ts`
  - `packages/core/src/infra/llm-protocol/ports/adapter.port.ts`
- **问题**：两份都是 `{ promptTokens?, completionTokens?, totalTokens? }`（readonly）结构等价但分别声明，后续一侧加字段（`cachedTokens` / `reasoningTokens`）极易漏改另一侧。
- **改法**：复用一份。注意 domain→infra 方向依赖是否符合项目层次约定（domain 不应反向 import infra）：若禁止该方向，则反向让 adapter 复用 domain 的 `MessageUsage`（adapter re-export 或 type alias）。二选一删另一份字面量。
- **验收/测试**：
  - tsc 通过。
  - grep 确认 `MessageUsage` / `LlmTokenUsage` 单一定义点。
- **来源**：round 1 / scope A（A/C-1）

---

### CR-9 [P2] LLM 返回空 blocks 但带 usage 时 usage 静默丢弃

- **严重度**：P2
- **维度**：B（行为语义）
- **文件**：
  - `packages/core/src/service/agent/impl/agent-runner.ts`（L392-400 gate）
  - `docs/Iterations/event-config-merge-and-migration-cleanup/prd.md`（AC-13）
  - `docs/Iterations/event-config-merge-and-migration-cleanup/spec.md`
- **问题**：gate 是 `if (result.blocks.length > 0 && meaningful)`，usage 只在内部展开。某 round LLM 只回 thinking-only / 空 blocks 但仍报 usage（`finish_reason=length` / `refusal` / 纯 reasoning 模型）时，该 round usage 不落任何 message，token 计数会少计。
- **改法（用户已拍板：方案 1）**：维持现状（LLM 给了 usage 就存，无 assistant message 的 round 不持久化 usage），在 PRD AC-13 / spec 显式写明该语义。理由（用户）：usage 为空时有估算兜底（heuristic counterKind），不会导致 UI 无计数。
- **验收/测试**：文档更新即验收（PRD AC-13 / spec 补一句「无 assistant message 的 round 不持久化 usage，由估算兜底」）。
- **来源**：round 1 / scope A（A/B-1）
- **同文件提示**（review-full round 2）：CR-2 与 CR-9 同触达 `agent-runner.ts`——CR-2 改 step commit 处的 registry reset 调用，CR-9 改 step commit 的 gate 条件，两者在同一函数块内但改动点不重叠。落地时注意顺序（先定 gate 再补 reset，或反之，按 Q2 决策），不会互相覆盖，无硬冲突。

---

### CR-10 [P2] counterKind 'heuristic' 语义过载

- **严重度**：P2
- **维度**：C（命名 / 语义）
- **文件**：
  - `packages/core/src/infra/tokenizer/logic/format-counter-kind-label.ts`
  - `apps/mobile/src/services/chat-prompt-tokens.service.ts`
  - `apps/desktop/src/main/services/chat-prompt-tokens.service.ts`
- **问题**：`'heuristic'` 同时承载「API 命中」「heuristic 兜底」「savedModelId 缺失的纯字符估算」三种语义，后续若想细分标签（如 savedModelId 缺失时显示「未配置模型」）无可区分字段。AC-17 行为当前一致（都显示「自动」）。
- **改法（择一）**：
  1. savedModelId 缺失分支用新 counterKind 常量（如 `'unresolved'`），由 `formatCounterKindLabel` 映射到「自动」，heuristic fallback 保持 `'heuristic'`（推荐，语义可追溯）。
  2. 若判 over-scope，至少在 `format-counter-kind-label.ts` 的 JSDoc 补一句「`'heuristic'` 含 savedModelId 缺失的字符估算场景」。
- **验收/测试**：
  - 方案 1 补对应 label 映射测。
  - 方案 2 注释即验收。
- **来源**：round 1 / scope B（B/A-1）

---

## Spec deviations（实现与 SPEC 不符，须在 SPEC 或实现侧闭合）

> 本节描述 SPEC 文案与实现的不一致，以及应在哪一侧闭合。本 wave 只在 fix-spec 内记录，不动业务 spec。

- **SD-1**：spec L343 / L362 / L386 写 `SCHEMA_BOOT_VERSION` 5→6，实际是 4→5（BASE v1.4.20 为 4）。改 SPEC 文案为 4→5。来源：scope A。
- **SD-2**：spec 未提「`parseUsage` 三列全 NULL 时返回 undefined 而非空对象」的语义保证（实现有且测试覆盖），建议 SPEC 补一句。来源：scope A。
- **SD-3**（已闭合）：AC-13 语义已澄清为「LLM 给了就存」（见 CR-9 决策），`MessageUsage` 三字段可选是合理的。需在 PRD AC-13 / spec 补一句说明。来源：scope A。
- **D-1**（已闭合）：两端批注清空逻辑不对称问题，产品已拍板统一为「按锚点消息角色区分」（见 CR-5 决策）。mobile/desktop 两端需对齐到同一规则。
- **D-2**：SPEC L321 / port 注释「step commit 时 reset」实现未做（见 CR-2）。CR-2 闭合即消解。
- **D-3**：SPEC 未列 `subagent-stream-cache.tsx` 删除（见 CR-6）。CR-6 闭合即消解。

---

## Open questions / 待拍板

- **Q1**（已答复，round 2）：用户决策——按锚点消息角色区分（assistant 清空 / user 重新投影），见 CR-5。已闭合。
- **Q2**：mobile agent run 全程是否都在 RN bundle 同进程（streamRegistry 才能拿到 delta）？请确认无 worker / native 桥另一端路径。
- **Q3**：`sessionApiPromptTokenCache` 是否有 TTL / 淘汰策略？回填进来的老 `updatedAt` 会不会被立刻淘汰？需查 `session-api-prompt-token-cache.ts` 实现。
- **Q4**：`SessionPromptInputBundle` 在两端重复定义，是否迁到 core 共享类型？（更大收敛，本期可能 over-scope）
- **Q5**：desktop `loadChatPromptTokenStatsFallback` 与 mobile fallback 鲁棒性差异（existing），是否本期顺手统一？
- **OQ（scope A）**：AC-15 整体由 backfill scope 收尾，本 scope 只证「数据已具备」。

---

## 合并后 QA（manual_user）

- 真机多步子会话退出再进入不重复渲染（验证 CR-2）。
- rewind/undo 后批注草稿行为符合「assistant 清空 / user 重新投影」规则（AC-9，验证 CR-5）。
- 回滚后 token 计数来自 API 值（AC-14）、两端刷新（AC-16）。
- Token 标签显示「自动」（AC-17）。

---

## CR 备注（环境）

- **mobile jest 环境当前 broken**：`@react-native/babel-preset@0.85.3` 无 metro caller 时不启用 TS parser，而 jest rootDir 指向仓库根，导致 `apps/mobile/babel.config.js` 不生效。CR-1 / CR-4 / CR-5 的 mobile 测试代码必须正确，但实际跑通依赖 jest 环境修复（建议方向：jest 专用 babel config，最轻量）。此项不阻塞 fix-spec-ready，但阻塞 verify。
- **desktop `chat-prompt-tokens.test.ts` 有 pre-existing fixture 问题**：before hook 需 provider 已注册，HEAD 上就跑不过。

---

## K 节建议（下游执行时闭合）

- lint / format（本 skill 不跑）。
- 工作区未提交改动整理成独立 commit（按工作流分组：Token Usage / Bug1-4 / StreamRegistry）。

---

## 条目状态汇总

| id | 严重度 | 来源 | 状态 |
|----|--------|------|------|
| CR-1 | P0 | round 1 / scope C | 已写入（mobile verify 受环境阻塞） |
| CR-2 | P0 | round 1 / scope C | 已写入 |
| CR-3 | P1 | round 1 / scope B | 已写入 |
| CR-4 | P1 | round 1 / scope B | 已写入（mobile verify 受环境阻塞） |
| CR-5 | P1 | round 1 / scope C | 已写入（Q1 已拍板：按锚点角色区分） |
| CR-6 | P1 | round 1 / scope C | 已写入 |
| CR-7 | P1 | round 1 / scope C | 已写入（含方案二选一） |
| CR-8 | P2 | round 1 / scope A | 已写入 |
| CR-9 | P2 | round 1 / scope A | 已写入（方案 1：给了就存 + 文档明确） |
| CR-10 | P2 | round 1 / scope B | 已写入（含方案二选一） |
