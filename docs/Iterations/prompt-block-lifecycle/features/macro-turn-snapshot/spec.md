---
date: 2026-08-14
agile_trace: true
---

# macro-turn-snapshot 实现规格（SPEC）

## 根因 / 方案摘要

宏展开的「每步实时」发生在三条互相独立的链路：dynamic 区（`buildPromptLlmInputFromLayout`）、customAttach（`prepareUserMessagesForPrompt` 入口）、compaction token 计数（`resolveCurrentPromptTokens` → serialize → 再组装再展开）。且 `agent-runner` 的 `promptRenderCtx` 原本不传 `now`，dynamic 区每步兜底 `new Date()`；`wt` 服务每 step 经工厂重建（每次 new `DefaultWorkplaceService`），`liveViewInflight` 并发去重跨 step 失效。

方案：在 run 开始（step 循环外）取一次快照——`turnNow = new Date()` 与条件预取的 filetree 字符串——沿既有 ctx 透传链注入三条链路，回合内所有 step 复用。不引入 Proxy、不改函数签名结构，全部为可选字段。

## 变更点清单

| 文件 | 改动 |
|------|------|
| `expand-dynamic-macros.ts` | `DynamicMacroContext` 加 `filetree?: string`；`content.includes("$filetree")` 时优先取 `ctx.filetree`，缺省回退 `ctx.workplace.renderFileTree()` |
| `prompt-render-context.ts` | `PromptRenderContext` 加 `filetree?: string`（注释说明优先级） |
| `render-prompt.ts` | `buildPromptAssemblyFromLayout` / `buildPromptLlmInputFromLayout` 两处 `expandDynamicMacros` 调用透传 `filetree: ctx.filetree` |
| `prepare-user-messages-for-prompt.ts` | runtime 加 `filetree?: string`；入口 extraInfo 展开透传 |
| `agent-runner.ts` | `wt` 提升到 `try` 块开头（循环外仅取一次）；`turnNow` 固定；`resolveTurnFiletreeSnapshot` 条件预取；prepare 与 `promptRenderCtx` 传 `now: turnNow, filetree: turnFiletree` |
| 测试 | `expand-dynamic-macros.test.ts` 补 T-SNAP1；新建 `agent-runner-macro-turn-snapshot.test.ts`（T-SNAP2 / T-SNAP3） |

## 详细改动说明

### 快照预取的判定范围

`collectMacroExpandableText` 拼接 **customAttach（若为 string）+ 开启 `dynamicEnabled` 的 dynamic 块 content**，对拼接文本做 `includes("$filetree")` 预检（沿用域内既有 leaky 预检风格）。persist 区不做宏展开（原样注入），不参与预检。命中才调 `renderFileTree()` 一次；未命中返回 `undefined`，下游回退实时渲染——但既然文本不含该宏，实际不会走到渲染路径，行为等价旧代码。

### 错误处理路径

快照初始化（wt 获取 + 预取）放在 `try` 块内、step 循环前：`renderFileTree` 抛错时走 runner 统一 catch，与改前「step 内抛错」的错误路径等价。

### 三链路共享

- prepare（extraInfo）：runtime 新字段直传；
- dynamic 区：`promptRenderCtx.filetree` → `render-prompt` 透传；
- compaction token 计数：复用同一 `promptRenderCtx`（runner 传入 `shouldRequestCompaction`），自动共享 `turnNow` 与快照。

### wt 实例提升

`this.deps.workplace(wtScope)` 从循环内移到循环外一次获取。工厂每调用 new 新 `DefaultWorkplaceService`，旧写法使 `liveViewInflight`（in-flight Promise 去重，无结果缓存）跨 step 失效；提升后同一 run 内并发 `renderFileTree` / `materializeLiveView` 共享去重。

## 测试策略

### 测试用例

- **T-SNAP1**（expand 单测）：`ctx.filetree` 提供时 `renderFileTree` 零调用、输出含快照内容——钉死「快照优先」语义。
- **T-SNAP2**（runner 端到端）：两 step run（第一步返回 tool_use 驱动第二步），mock `renderFileTree` 每次调用返回**不同**内容——断言 callCount === 1 且两个 step 的 dynamic 合成消息（`prompt:ctx`）文本逐字一致。返回值可变保证「若走实时渲染文本必然不一致」，断言有判别力。
- **T-SNAP3**（runner 端到端）：配置只用 `$time` / `$week_cn`，断言 `renderFileTree` 零调用、customAttach 仍展开注入 `<extra-info>`——钉死「未用宏不白付预取」。
- **回归**：`test/prompt/*.test.ts` + `agent-runner-template-blocks.test.ts` 共 111 例。

已知环境问题（与本次改动无关，main 基线复现）：依赖 TDDBC 测试连接的用例（如 `prepare-user-messages-for-prompt.test.ts`、DB fixture 系）在本机挂起，无法作为回归信号。

## 风险与回滚方案

- **风险 1（产品语义）**：`$time` 冻结在回合开始，长回合（数十分钟）末尾模型看到的时间偏旧；`$filetree` 不反映回合中 agent 自己写盘产生的新文件（工具轮次已告知模型）。两者均为有意接受的行为变更，已记入 PRD。
- **风险 2（兼容）**：所有新字段可选、缺省回退旧行为；预览 / 双端 session-prompt-input / CLI 不传新字段，语义不变。
- **回滚**：revert 单个 commit（`c14e7fe`）即可，无 schema / wire 变更、无迁移。
