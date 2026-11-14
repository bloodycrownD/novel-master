---
date: 2026-11-14
---

# 错误通道统一（二期：core）技术规格

## 设计目标

把 `packages/core` 的 throw 面按「五类处置」统一为返回值通道：域校验与业务规则拒绝返回 `Result.err` / `Outcome.failed`，控制流信号返回 `Outcome.cancelled` / `Interrupt`，编程错误与平台边界保留 `throw`（后者在适配层转码）。

一期已把错误模型收敛为单一 `AppError`；二期只改「错误怎么传播」，不改「错误怎么造」。

## 需求来源

总纲 `docs/iterations/error-channel-migration/strategy.md` §二（第一原则）与 §六（三期路线）。期次边界：一期 errors/ 收敛 → **二期 core 通道** → 三期 apps + 导出面。

## 总体方案

### 2.1 五类处置（实测基线，2026-11-14 复核）

`packages/core/src` 实测 **592 处 `throw` / 120 个文件**：service 264/37、infra 100/31、**domain 211/45**。严格解包 `if (!x.ok) throw x.error` **105 处**（domain 74 / service 31）。

| 类 | 判据 | 处置 | 处数 |
|---|---|---|---|
| A 域校验 | 纯函数可判定失败，如 `AGENT_INVALID_SCHEMA`、`TOOL_SEARCH_INVALID_ARGUMENT` | `Result.err(new AppError(...))` | 约 120 |
| B 业务规则拒绝 | 资源不存在、状态冲突、上限，如 `CHAT_NOT_FOUND`、`AGENT_NOT_FOUND` | `Result.err` / `Outcome.failed` | 约 110 |
| C 编程错误 | 不变量破坏、不可能分支，如 `INFRA_INVARIANT_VIOLATION`、`Result.revive` 形状违约 | **保留 throw** | **16** |
| D 平台边界 | 事务回滚、HTTP/SSE、abort 竞速 | **保留 throw** + 适配层转码 | 约 90 |
| E 控制流信号 | 用户取消、任务被替换 | `Outcome.cancelled` / `Interrupt` / 专用取消码 | 2 哨兵 + 8 处工具取消 |

**建议保留 throw 的两组协议**（不计入 A/B）：`tool-runner` 的 ToolError 契约（并发协议只有 throw/reject 通道）、`llm-protocol` 的 ProviderError（retry 按 catch + code 分派）。

### 2.2 控制流迁移的两条不同路径

**路径一：两个哨兵改 `Interrupt`（真正走返回值）**

1. `service/workplace/assemble-workplace-display.ts`：`shouldStop` 从 `() => boolean` + throw 哨兵，改为 `() => Interrupt | null`；函数返回值改 `Outcome<T>`；删 `WorkplaceAssemblyAbortedError`。
2. `infra/tokenizer/logic/resolve-current-prompt-tokens.ts`：`shouldBail` 同理；删 `PromptTokenResolveBailedError`。

**同波必须改的调用方（core 3 处 + apps 4 处，一个不能少）**：

- `service/agent/impl/agent-runner.ts:353-363`——模块注释明写「run 侧错误沿既有 catch 冒泡、`signal?.aborted` 为真即路由进 `handleAbort("catch_abort")`，无需专门 catch」。改成返回值后这条机制死亡，**必须显式检查 `Outcome.cancelled` 并路由进 `handleAbort`**，否则取消被当成功继续跑。
- `domain/compaction-conditions/triggers/token-ratio.trigger.ts:49`——消费 `resolveCurrentPromptTokens` 返回值。
- `infra/tokenizer/logic/resolve-prompt-tokens-with-backfill.ts:37`——有显式 `Promise<ResolvedPromptTokens>` 签名注解，必编译红。
- `apps/desktop/src/main/services/session-prompt-input.service.ts` / `apps/mobile/src/services/session-prompt-input.service.ts`——删 `WorkplaceAssemblyAbortedError` catch，改判 `Outcome.cancelled`。
- `apps/desktop/src/main/services/chat-prompt-tokens.service.ts` / `apps/mobile/src/services/chat-prompt-tokens.service.ts`——删 `PromptTokenResolveBailedError` catch，改判 `Outcome.cancelled`。
- **导出面联动（同波，否则 apps 无法 import 新符号）**：删 `public/provider.ts:166-168`、`public/workplace.ts:65`、`infra/tokenizer/index.ts:75` 的哨兵类导出；为 apps 4 文件增补 `Outcome` / `Interrupt` 的 public 导出（就近走 `@novel-master/core/workplace` 与 `@novel-master/core/tokenizer`，不动导出面大盘——那是三期）。

**路径二：工具取消保留 throw 协议，用专用码判别**

`tool-runner.ts` 的并发协议是 `Promise.allSettled` + `ParallelToolOutcome{ ok: true | false }`，**没有 Result 通道**；`buildToolResultBlock` 只渲染 `ok:false` + `formatToolErrorForLlm`。把取消改成 `Outcome.cancelled` 要重设计整个并行工具协议。

因此工具取消**不迁返回值**，改为「保留 throw + 专用可判别码」：

- 一期码表已登记 `TOOL_CANCELLED`（104 TOOL 段）；
- 8 处取消形态统一为 `throw new AppError("TOOL_CANCELLED", { toolName, detail })`：
  - 预检取消 5 处：`curl-tool.ts:297`、`search-tool.ts:195/207`、`tool-runner.ts:64`、`template-engine.ts:97`
  - 在途取消 3 处：`curl-tool.ts:311-313/328`、`template-engine.ts:188`、`duckduckgo.ts:121`
- `buildToolResultBlock`（`build-tool-result-block.ts:280-295`）与 `formatToolErrorForLlm` 按 `isAppError(error, "TOOL_CANCELLED")` 分类，工具结果块呈现为 cancelled（UI 不弹错误文案）；
- T-C4 逐点锁 8 处，防「预检 vs 在途时序不同导致两种分类」。

### 2.3 保留 throw 的硬清单（16 处，逐一核实存在）

`i18n/catalog.ts:20/34/41/46`、`service/integrity-repair.ts:104/112`、`service/coordinated-write.ts:98/103`、`errors/either.ts:219`、`domain/prompt/logic/normalize-agent-prompt-layout.ts:96`、`domain/provider/logic/provider-identity-repair.ts:71`、`domain/vfs/logic/vfs-tree-copy.ts:38`、`infra/llm-protocol/logic/registry.ts:51`、`service/agent/impl/agent-runner.ts:474`、`service/vfs/impl/vfs-zip-io.service.ts:60`、`bootstrap/schema-migrations/index.ts:68`。

**事务回调内的解包 throw 约 26 处保留**（better-sqlite3 靠抛错回滚，总纲 §五例外 2）：`session.service.ts:407`、`message.service.ts:415`、`revision-aware-vfs.service.ts:128` 等 `conn.transaction(...)` 内。

`request-abort.ts:37` 是 `if (signal?.aborted === true) return true`——**无 throw**，不属于本清单（早期版本误列）。

### 2.4 事务外/内解包判定

core 现有 105 处 `if (!r.ok) throw r.error`（domain 74 / service 31）：

- **事务内** → 保留（回滚机制依赖）。
- **事务外、且该函数本身不返回 `Result` 也不返回 `Outcome`** → 保留为边界 throw（合规）。
- **事务外、且该函数应返回 `Result` 或 `Outcome`** → 改为 `return r`，决定权交给上层。

判据必须同时写 `Result` 与 `Outcome`——`assemble-workplace-display.ts:199` 的 `if (!resolved.ok) throw resolved.error` 届时所在函数返回 `Outcome`，只写 `Result` 会判错。

### 2.5 `legacy-vfs-error.ts`：二期只改调用点，不改输出形态

`revision-aware-vfs.service.ts` 实际有 **12 处** `throwLegacyVfs` 调用（事务外 11：`:64/71/88/103/145/179/182/185/194/197/200`；事务内 1：`:128`），不是 6 处。

二期处置：**映射表保持「AppError key → 旧短码」输出不变**——因为它的消费方有 **6 个文件、约 50 处**调用点（`scoped-vfs` 15、`vfs-batch-io` 14、`vfs.service` 9、`vfs-zip-io` 2+4、`character-card-import` 2、`physical-vfs` 3），全在 apps/CLI 侧按 `name + code` 消费；apps 改认 key 是三期的事。二期只把 `revision-aware-vfs.service.ts` 的 12 处调用点按 §2.4 规则裁决（事务内保留、事务外改 `throw result.error` 时**仍过 mapper**）。

映射表改输出 key、删文件整体并入三期。

### 2.6 `cloud-sync` 整波移入三期

`cloud-sync-coordinator` 的 **16 处** `throw new CloudSyncError(...)`（`cloud-sync-status.ts` 另有 1 处）**二期不动**。原因：`CloudSyncError` 是 core 里未被一期退役的活类（`infra/cloud-sync/errors/cloud-sync-errors.ts`），desktop `format-ipc-error.ts:97` 与 `cloud-sync.service.ts:107/301` 按 `isCloudSyncError` + `error.code` 分支消费；二期改成 `Result.err` 会让这些 catch 全部落空，而应用侧的替代接线属于三期的「apps 通道统一」范围。三期整体退役 `CloudSyncError`（12 个码进 122 CLOUD_SYNC 段）+ 同波改 apps。

## 最终项目结构

core 目录结构不变。新增/变更仅：

```
packages/core/src/
  errors/outcome.ts              # 一期已建，二期接首批用户
  common/abort-reason.ts         # AbortReason 纯类型（若一期未并入 outcome.ts）
  service/workplace/assemble-workplace-display.ts     # shouldStop → Interrupt
  infra/tokenizer/logic/resolve-current-prompt-tokens.ts # shouldBail → Interrupt
  domain/tool/**                 # 8 处取消统一 TOOL_CANCELLED 码
  service/agent/impl/agent-runner.ts   # abort 路由改判 Outcome.cancelled
  service/vfs/impl/legacy-vfs-error.ts # 形态不变（三期删）
```

## 变更点清单

| 文件 | 变更 |
|---|---|
| `service/workplace/assemble-workplace-display.ts` | `shouldStop` 改 `Interrupt \| null`；返回值改 `Outcome<T>`；删哨兵类 |
| `infra/tokenizer/logic/resolve-current-prompt-tokens.ts` | `shouldBail` 同理；删哨兵类 |
| `service/agent/impl/agent-runner.ts` | `:353-363` 改判 `Outcome.cancelled` 并路由 `handleAbort` |
| `domain/compaction-conditions/triggers/token-ratio.trigger.ts` | 适配新返回值 |
| `infra/tokenizer/logic/resolve-prompt-tokens-with-backfill.ts` | 签名适配 |
| `apps/{desktop,mobile}/src/…/session-prompt-input.service.ts` | 删哨兵 catch，改判 `Outcome.cancelled` |
| `apps/{desktop,mobile}/src/…/chat-prompt-tokens.service.ts` | 同上 |
| `public/provider.ts`（`:166-168`）/ `public/workplace.ts`（`:65`）/ `infra/tokenizer/index.ts`（`:75`） | 删哨兵类导出；为 apps 4 文件增补 `Outcome` / `Interrupt` 导出 |
| `domain/tool/builtin/curl-tool.ts` / `search/search-tool.ts` / `search/engines/{template-engine,duckduckgo}.ts` / `logic/tool-runner.ts` | 8 处取消 → `TOOL_CANCELLED` 码 |
| `domain/tool/logic/build-tool-result-block.ts` / `format-tool-error-for-llm.ts` | 按 `TOOL_CANCELLED` 分类呈现 cancelled |
| `service/chat/impl/session.service.ts` | 13 处 A/B 类 → `Result.err`；fork 事务内 1 处保留 |
| `service/chat/impl/message.service.ts` | 15 处改写；`:200` 裸穿 `ContentError` 改显式 `return err` |
| `service/chat/impl/{project,usage-stats,message-transcript-effects,user-vfs-turn}.service.ts` | A/B 类改写 |
| `service/agent/impl/agent-registry.service.ts` / `logic/agent-run-shared.ts` / `logic/run-agent-turn.ts` | B 类改写 |
| `service/vfs/impl/revision-aware-vfs.service.ts` | 12 处调用点按 §2.4 裁决（事务内保留、事务外过 mapper） |
| `domain/vfs/logic/vfs-path-mapper.ts` | 4 处 throw 与同文件 Result 通道合并 |
| `domain/tool/builtin/search/search-config.ts` | 10 处 throw 与既有 Result 版本合并 |
| `service/{skills,kkv,smart-sort-rule}/impl/*.service.ts` | A/B 类改写 |

**不做**：`cloud-sync-coordinator`（移三期）、`legacy-vfs-error.ts` 映射表形态（移三期）。

## 详细实现步骤

- Step 1 — phase-interrupt — blocking: yes — qa: auto：两个哨兵改 `Interrupt`；**同波**改 core 3 处调用方 + apps 4 处 catch；删两个哨兵类；T-C3。
- Step 2 — phase-tool-cancel — blocking: yes — qa: auto：8 处取消统一 `TOOL_CANCELLED`；`build-tool-result-block` / `format-tool-error-for-llm` 分类；T-C4。
- Step 3 — phase-chat-services — blocking: yes — qa: auto：chat 六文件 A/B 类改写；事务内 throw 保留；T-C1。
- Step 4 — phase-agent-services — blocking: yes — qa: auto：agent 三文件改写；T-C2。
- Step 5 — phase-vfs-services — blocking: yes — qa: auto：`revision-aware-vfs` 12 处调用点裁决；`legacy-vfs-error` 形态不动；T-C6。
- Step 6 — phase-domain-dual — blocking: yes — qa: auto：`vfs-path-mapper` 与 `search-config` 单一通道统一；T-C5。
- Step 7 — phase-skills-kkv-sort — blocking: yes — qa: auto：三组改写。
- Step 8 — phase-verify — blocking: yes — qa: auto：`npm run typecheck` + core 全量测试 + `check-style` 三段 + **二期 grep 门**（`throw new AppError` 命中 ⊆ 白名单：§2.3 的 16 处 + 26 处事务回调 + 边界文件；`throw r.error` 解包命中 ⊆ 事务回调与边界清单）。

依赖：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8。Step 1 必须先于其余（Outcome 唯一真实用户）；Step 3-7 文件集不相交，可并行波。

## 测试策略

### 测试用例

- T-C1 — blocking: yes — chat 六文件：A/B 类改写后 `Result.err` 的 `key`/`details` 与改造前 throw 等价；事务内 throw 仍抛出并触发回滚。
- T-C2 — blocking: yes — agent 三文件同上；`run-agent-turn` 的 abort 分支不因改写误判。
- T-C3 — blocking: yes — 两个哨兵改 `Interrupt` 后：core 返回 `Outcome.cancelled`，**agent-runner 显式路由 `handleAbort`**（不是静默继续跑），apps 四文件 catch 同一语义；双端逐字 diff。
- T-C4 — blocking: yes — 8 处工具取消（5 预检 + 3 在途）全部产出 `TOOL_CANCELLED`，工具结果块分类为 cancelled、UI 不弹错误。
- T-C5 — blocking: yes — `vfs-path-mapper` 与 `search-config` 各自只剩单一通道。
- T-C6 — blocking: yes — `revision-aware-vfs` 12 处裁决后：事务内仍抛、事务外经 mapper 仍产出旧形态；apps 三端 `isVfsError` 消费零变化。
- T-C7 — blocking: yes — 16 处编程错误 + 26 处事务内解包 + 105 处解包判定后，未被误迁（反向断言仍抛）。
- T-C8 — blocking: yes — 二期 grep 门通过：白名单命中外零命中。

## 风险与回滚方案

| 风险 | 影响 | 缓解 |
|---|---|---|
| Step 1 漏改 agent-runner 的 abort 路由 | 停止按钮静默失效（取消被当成功） | T-C3 显式断言 `handleAbort` 被调用；同波清单写死 3 core + 4 apps |
| 工具取消预检/在途分类不一致 | 同一取消出现两种 UI | T-C4 逐点锁 8 处 |
| 两层接力漏层 | 失败被吞 | 每文件组 `tsc` + T-C1/T-C2 |
| `legacy-vfs-error` 被顺手改成输出 key | apps 54 处消费点静默失配 | 二期禁止改形态；T-C6 断言旧形态 |
| `cloud-sync` 被顺手改 | desktop catch 全落空 | 二期明确不做；三期整体处理 |
| 解包判据只写 Result 漏 Outcome | `assemble-workplace-display.ts:199` 判错 | §2.4 显式写「Result 或 Outcome」 |
| Outcome `failed` 分支零调用 | 类型半死 | 三期首批接入（apps 失败路径）；二期只保证 cancelled 有真用户 |

回滚：每 Step 一个提交；Step 1 因跨端必须整组回退；Step 3-7 按文件组独立回退。
