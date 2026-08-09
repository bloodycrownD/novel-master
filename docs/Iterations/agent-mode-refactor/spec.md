---
date: 2026-08-07
---

# Agent Mode 重构（mode 字段替代全局名单）技术规格（SPEC）

> 需求文档：`docs/Iterations/agent-mode-refactor/prd.md`
> 依赖前置：`agent-subagent`（已实现，本次为其子代理配置机制做重构）

## 设计目标

把子代理的「可调用性」从一份独立的全局名单（KKV `subagentNames`）改成每个 agent 自带 `mode` 字段（`primary` / `subagent` / `all`），并让 `task` 工具不再凭空消失——即便用户没配过任何子代理，主代理也始终能看到 `task` 工具和它的说明文案。

设计参照 opencode 的 `mode` 方案，但**不引入** opencode 的 `build/plan/compaction/title/summary` 这类系统主代理语义；本项目的 `mode` 纯粹用来区分「能不能被 `task` 工具调用」。

## 总体方案

### 核心思路：属性跟着实体走

现在「能不能被当子代理调」活在一份独立名册里（存 agent `name` 字符串），agent 一改名/删除就悬空。改法是把这个属性变成 agent 自身的 `mode` 字段，`task` 工具的候选列表直接从 registry 现读现过滤。

### 关键设计决策（基于探索报告证据）

| 决策点 | 结论 | 依据 |
|---|---|---|
| `Tool.description` 怎么动态拼 | **Tool 接口 description 改函数类型**：`(ctx: Ctx) => string`。task 和所有内置工具统一用函数返回描述，task 从 `ctx.subagent?.callableAgents ?? []`（装配期预算好的候选数组）同步拼文案 | `Tool.description` 当前是 `readonly string`（`tool.ts` L22）。探索确认生产代码只有一处消费 `tool.description`（`toolsFromRegistry`，`tool-definitions.ts` L19），改为直接 `tool.description(ctx)`。装配期把 `agentRegistry.list().filter(mode !== "primary")` 预算成数组塞进 ctx，lambda 同步读，规避 async 问题 |
| task 注册路径收敛 | **task 作为静态对象在 `registerBuiltinTools` 里注册**，`registerBuiltinTools` 回归无参签名；删除 `createSubagentTool` 工厂 + `registerSubagentTool` 独立函数 | 现有两条平行路径是技术债（C-orch 反模式）。改 Tool.description 为 union 后，task 的动态性自包含在 description lambda 里，不需要外部工厂烘焙字符串 |
| `subagentCallable` 旧字段 | **直接删除 preprocess strip**：subagent 功能未发布（不在任何 tag、v1.4.18 无 `subagent-tool.ts`），无旧数据需兼容 | git 历史确认：subagent 纯开发中未发布，不存在带 `subagentCallable` 的正式数据 |
| 内置 `general` 与用户重名 | **upsert 时禁止 `name === "general"`**，抛 `INVALID_SCHEMA` | general 是虚拟内置 agent，不允许用户创建同名 agent；比「强制 mode」更干净，消除开放点 |
| 缺省值归属 | `AgentDefinition.mode` 为 `optional`，**不在模型层填默认值**；由消费侧（`run-agent-turn` 装配期、picker 过滤）按 `def.mode ?? "all"` 解释 | wire 双向 codec 保持「无 mode 不写出」，导出 bundle 干净；旧数据自洽 |
| 测试范围 | core **已有大量内嵌单测**（`packages/core/test/` 下约 30 个子目录），PRD FR-7 点名的部分文件（如 `subagent-tool.test.ts`、`agent-tool-policy*.test.ts`、`agent-registry-list-seed.test.ts`、`agent-tool-policy-task-whitelist.test.ts`）实际存在，会在 Step 8/9/10/11 改装配链路后编译断裂或断言失效。务实路线：(a) **新增 `phase-test-fix`** 紧跟 `phase-core-tool` 之后，逐个修复这些既有测试，否则编译断裂会挡住后续 phase 的 build；(b) 更新现有 CLI e2e + bundle schema 测试的迁移断言；(c) 给移动 `agent-picker` 测试补 mode 过滤用例；(d) 给 `agent-registry-list-seed.test.ts` 补 T-G1 断言。PRD FR-7 里另一些文件的实际情况需要区分对待：`run-agent-turn*.test.ts` 等 4 个 `packages/core/test/service/agent/` 下的测试文件**实际存在**且 mock 了被删的 `AgentTurnRuntimePort.state.getSubagentNames`，Step 11 后会触发 excess property check 编译断裂，必须纳入 `phase-test-fix`；`persistent-state*.test.ts` **存在但仅测 setCurrent/Current 等 getter，不引用被删的三方法，无需改动**；`resolve-agent-tool-registry*.test.ts` 经探索确认主仓库确实不存在，本迭代不新建 | core 既有单测是装配链路的真实回归网，比原 SPEC 设想的宽得多，必须随装配链路改造同步修，不能跳过 |

### 实施依赖链（顺序不可乱）

```
phase-model（FR-1 加字段 + FR-2 schema 迁移 + FR-5 general seed）
  → phase-core-tool（FR-3 工具改造：装配段换数据源 + run() 加 mode 过滤 + task 不进校验 known-names）
    → phase-test-fix（修复 core 既有单测：Step 8/9/10/11 改装配链路后编译断裂/断言失效的一批测试，必须紧跟 phase-core-tool，否则后续 phase 的 build 被挡住）
      → phase-persist-cleanup（FR-4 删持久化层：装配段不再读 getSubagentNames 后才安全删）
        → phase-form-state（共享表单 state 加 mode，被两端 UI 依赖）
  phase-desktop（FR-4 桌面拆除 + FR-6 选择器 + AC-7 picker 过滤）  ← 依赖 persist-cleanup + form-state
  phase-mobile（FR-4 移动拆除 + FR-6 选择器 + AC-7 picker 过滤）   ← 依赖 persist-cleanup + form-state，可与 desktop 并行
phase-test-doc（FR-7 测试 + 文档）  ← 最后
```

`phase-desktop` 和 `phase-mobile` 文件域不重叠，可同 wave 并行。`phase-test-fix` 必须排在 `phase-persist-cleanup` 之前——core 的内嵌单测（`subagent-tool*.test.ts`、`agent-tool-policy*.test.ts`、`tool-schema-descriptions.test.ts`、`service/agent/` 下的 `run-agent-turn*.test.ts` 等 4 个）在装配链路改完后立刻编译断裂，不清掉就过不了后续 phase 的 build。

## 最终项目结构

本次为重构，不新增顶层目录。删除项与改动项见「变更点清单」。

变更后 agent 配置的单一事实来源是：`AgentDefinition.mode` 字段（DB 落库）→ registry `list()` 读取 → `task` 工具装配期过滤。不再有任何独立的「子智能体名单」存储。

## 变更点清单

### [改] 核心模型与 schema（phase-model）

| 文件 | 行号 | 符号 | 改动 |
|---|---|---|---|
| `packages/core/src/domain/agent/model/agent-definition.ts` | L16-30 | `AgentDefinition` | 新增 `readonly mode?: "primary" \| "subagent" \| "all"`（插在 `description` L19 之后） |
| `packages/core/src/domain/agent/model/agent-definition.schema.ts` | L122-140 | `agentDefinitionDocumentSchema` | 加 `mode: z.enum(["primary","subagent","all"]).optional()`（L128 `description` 之后） |
| 同上 | L176-199 | `documentToDefinition` | 返回对象补 `...(doc.mode != null ? { mode: doc.mode } : {})` |
| 同上 | L201-244 | `definitionToDocument` | 返回对象补 `...(def.mode != null ? { mode: def.mode } : {})` |
| 同上 | L246-259 | `agentDefinitionWireSchema` preprocess | **删除** `subagentCallable` silent-strip 预处理整段（未发布无旧数据）；mode 由 strict schema 直接收 |
| `apps/cli/src/agent/schemas/agents-bundle.schema.ts` | L18-41 | `agentBundleEntrySchema` | 内层 object 加 `mode` 枚举（L39 `description` 之后）；**删除** preprocess L19-30 的 `subagentCallable` silent-strip（未发布无旧数据） |
| `packages/core/src/service/agent/default-subagent-definition.ts` | L19-29 | `DEFAULT_SUBAGENT_DEFINITION` | 显式加 `mode: "subagent"`（L21 `description` 之后） |
| `packages/core/src/service/agent/impl/agent-registry.service.ts` | L52-69 | `upsert` | 加 `general` 重名禁止：`trimmedName === "general"` 时抛 `INVALID_SCHEMA`（见「general 禁止重名」） |
| 同上 | L97 | `delete` 注释 | 「子智能体名单兜底依赖它」过时注释顺手改 |
| `examples/agents.yaml` | L4-36 | writer/summarizer/general | general 补 `mode: subagent`，其余补 mode 示例；修 L29 过时注释 |

**general 禁止重名**（`agent-registry.service.ts` `upsert` 内，L58-64 name 非空校验之后、`assertUniqueDisplayName` 之前）：

```ts
// 内置 general 是虚拟 agent，禁止用户创建同名
if (trimmedName === DEFAULT_SUBAGENT_DEFINITION.name) {
  throw new AgentConfigError(
    "INVALID_SCHEMA",
    `"${DEFAULT_SUBAGENT_DEFINITION.name}" 是内置智能体名称，不可使用`,
  );
}
```

### [改] task 工具装配链路（phase-core-tool）

| 文件 | 行号 | 符号 | 改动 |
|---|---|---|---|
| `packages/core/src/domain/tool/model/tool.ts` | L22 | `Tool.description` | 改函数类型：`readonly description: (ctx: Ctx) => string` |
| `packages/core/src/domain/tool/builtin/vfs-tools.ts` | 全文 | 6 个 vfs 工具 | description 从字面量字符串改成 `() => "..."` 箭头函数 |
| `packages/core/src/domain/tool/builtin/chat-grep-tool.ts` | L88-115 | `createChatGrepTool` 返回对象 | description 从字面量字符串改成 `() => "..."` 箭头函数。该文件是废弃文件不进注册，但 `Tool.description` 改成函数类型后这里不跟着改会 TS 类型不匹配编译失败 |
| `packages/core/src/infra/llm-protocol/logic/tool-definitions.ts` | L12-23 | `toolsFromRegistry` | 加 `ctx: Ctx` 参数；description 读取改直接 `tool.description(ctx)` |
| `packages/core/src/service/agent/impl/agent-runner.ts` | L193 | `toolsFromRegistry` 调用 | 传 `this.deps.toolCtx`（L75 已有） |
| `packages/core/src/domain/tool/builtin/builtin-tool-context.ts` | L31-56 | `BuiltinToolSubagentContext` | 加 `readonly callableAgents: readonly { name: string; description?: string }[]`（装配期预算的候选列表） |
| `packages/core/src/domain/tool/builtin/subagent-tool.ts` | L80-188 | `createSubagentTool` 工厂 | **删除**工厂；task 改为静态导出对象 `subagentTool`，description 写 lambda 从 `ctx.subagent?.callableAgents ?? []` 拼文案 |
| `packages/core/src/service/agent/logic/run-agent-turn.ts` | L108-111 | `AgentTurnRuntimePort.state` | 删 `getSubagentNames` 类型声明 |
| 同上 | L370-386 | `runAgentTurn` task 装配段 | 整段改写：删 `getSubagentNames` + `add("general")` 兜底 + `defByName` 过滤；改为 `const callable = allDefs.filter(d => d.mode !== "primary" && d.name !== definition.name).map(d => ({name: d.name, description: d.description}));` callable 塞进下方 toolCtx 的 `subagent.callableAgents`。task 不再在这里注册（task 是内置工具，L364 probe `registerBuiltinTools` 时就注册了） |
| 同上 | L520-540 | `runChildAgent` task 装配段 | 同上改写：删名单逻辑；预算 callable 塞进子 agent ctx 的 `subagent.callableAgents`。task 注册与否由 `resolveAgentToolRegistry` 的 depth 判断控制（depth≥2 deny） |
| 同上 | L403-447 | 主 agent `subagent` ctx | 加 `callableAgents: callable`（depth、parentSignal、runChildAgent 等保留） |
| 同上 | L562-617 | 子 agent `subagent` ctx | 加 `callableAgents: callable`（depth、parentSignal 等保留） |
| `packages/core/src/domain/agent/logic/validate-agent-tool-policy.ts` | L52-75 | `validateAgentToolPolicy` | **中心过滤（根治 AC-9）**：函数签名 `validateAgentToolPolicy(tools, registryNames: ReadonlySet<string>)`，在函数体开头（`if (tools == null) return` 前后均可）从 `registryNames` 构造一个不含 `"task"` 的新 Set，后续 `assertKnownNames` 改用这个过滤后的 Set。这样 `registeredToolNames: probe.list()` 全部 **7 个调用点（7 个文件）**——无论走 `validateAgentDefinition` 还是直连 `validateAgentToolPolicy`——都自动覆盖：`run-agent-turn.ts`（1 处）、`run-agent.handler.ts`（events 自动化，1 处）、`apps/cli/src/agent/commands.ts`（`validateDefinitionForCli`）、`apps/cli/src/agent/registry-commands.ts`、`apps/desktop/src/main/ipc/handlers/agent-registry.ts`（`handleAgentRegistryUpsert` + `handleAgentRegistryCreateBlank`）、`apps/desktop/src/main/services/agent-yaml.service.ts`、`apps/mobile/src/services/agent-yaml.service.ts`。task 仍进 `registerBuiltinTools`（对 LLM 可见），但校验 policy 时不把 task 当合法名，保证用户写 `tools.allow/deny: ["task"]` 仍报 `INVALID_TOOL_POLICY` |

> task 作为静态内置工具，在 `registerBuiltinTools` 里和 vfs 工具一起注册。task 是否对 LLM 可见由 `resolveAgentToolRegistry` 的 depth 判断控制（depth≥2 deny）。description lambda 从 `ctx.subagent?.callableAgents ?? []` 读装配期预算好的候选列表拼文案——因为内置 `general` 永远 `mode: "subagent"` 在 registry 里，callable 列表至少含 general（排除当前 agent 自身后），所以 task 的描述始终有内容。

**保留不动（双保险/锁死规则）**：

| 文件 | 行号 | 说明 |
|---|---|---|
| `packages/core/src/domain/agent/logic/resolve-agent-tool-registry.ts` | L43-63 | `depth >= 2` deny task，递归上限双保险 |
| `packages/core/src/config-forms/agent/agent-tool-catalog.ts` | L4-18 | task 不进 `BUILTIN_TOOL_CATALOG`；注释更新为「task 始终注册但不进用户 allow/deny」 |
| `packages/core/src/domain/tool/builtin/vfs-tools.ts` | L38-45 | `FILE_TOOL_NAMES` 6 件 |

### [改] core 既有单测修复（phase-test-fix）

core 在 `packages/core/test/` 下有约 30 个子目录的内嵌单测。Step 8（`Tool.description` 改函数、`toolsFromRegistry` 加 ctx）、Step 9（删 `createSubagentTool`/`registerSubagentTool`）、Step 10（task 进 `registerBuiltinTools`）、Step 11（删 `AgentTurnRuntimePort.state.getSubagentNames` 声明 + 装配段改读 `agentRegistry.list()`）改完后，以下既有测试会编译断裂或断言失效。本 phase 逐个修复，是后续 phase build 的前置。

| 文件 | 行号 | 改动 |
|---|---|---|
| `packages/core/test/tool/subagent-tool.test.ts` | L8 `import { createSubagentTool }` | Step 9 删工厂后该 import 必断。改为引用静态导出 `subagentTool` |
| 同上 | L16 `import { registerBuiltinTools, registerSubagentTool }` from `register-builtin-tools.js` | Step 10 删 `registerSubagentTool` 独立函数后该 import 必断。删掉 `registerSubagentTool`，只保留 `registerBuiltinTools` |
| 同上 | mock `BuiltinToolSubagentContext` 构造处 | 补 `callableAgents: [{ name: "general", description: "..." }]`，让 description lambda 有数据可读 |
| 同上 | L197-231（T-T7/T-T7b）多处 `xxx.description.includes(...)` | 这些断言直接对 `createSubagentTool(...)` 返回的 **Tool 对象** 取 `.description`（如 L199 `withGeneral.description.includes("general")`、L202/L203 `empty.description.includes(...)`、L206-231 T-T7b 里多处 `tool.description.includes(...)`）。Step 8 把 `Tool.description` 改成函数后这些全部编译断裂，phase-test-fix 原条目漏掉了。又因 Step 9 删工厂改静态 `subagentTool`，`createSubagentTool([...])` 调用本身也失效。**T-T7/T-T7b 需整体重写**：不再用工厂传入候选列表，改为通过 `mockCtx.subagent.callableAgents` 传入候选，断言改写成 `subagentTool.description(mockCtx).includes(...)` |
| `packages/core/test/tool/subagent-tool-parallel.test.ts` | L7 `import { createSubagentTool }` | 同上：改为静态 `subagentTool`；mock ctx 补 `callableAgents`（该文件实际无 `registerSubagentTool` import） |
| 同上 | L104/L145 `registry.register(createSubagentTool(["general"]))` 用法（T-T4/T-T5 测试内）| Step 9 删工厂后该调用必断。改为直接用静态 `subagentTool`：`registry.register(subagentTool)`，或经 `registerBuiltinTools` 注册 |
| `packages/core/test/agent/agent-tool-policy.test.ts` | L7/L29/L41/L54 `toolsFromRegistry(filtered)` 不传 ctx | Step 8 给 `toolsFromRegistry` 加必填 ctx 后这些调用编译失败。补传构造好的 `BuiltinToolContext` mock（含 `subagent.callableAgents`） |
| 同上 | L26/L28 `assert.equal(filtered.list().length, vfsRegistryNames().length)` 等隐含「恰好 6 个」的断言 | Step 10 task 进 `registerBuiltinTools` 后变成 7 个。把 `vfsRegistryNames()` 调用处改为同样走 `registerBuiltinTools`（本来就是这样，会自动同步为 7），或者在断言里显式排除 task；不要写死 6 |
| `packages/core/test/tool/tool-schema-descriptions.test.ts` | L4/L10 `toolsFromRegistry(registry)` 不传 ctx | 同上补 ctx |
| 同上 | L12 `assert.match(edit!.description, /尾追/)` | **无需改动**：`edit` 来自 `toolsFromRegistry(registry).find(...)`，是 `LlmToolDefinition`，其 `description` 仍是 string（`toolsFromRegistry` 内部已调 `tool.description(ctx)`，见 `adapter.port.ts` L21-25）。按 Tool 对象改成 `edit!.description(mockCtx)` 反而编译失败 |
| 同上 | L26 `assert.equal(registry.list().length, 6)` | task 进注册后变 7，同步改 7，或改断言为 `>= 6` 且 `includes("task")` |
| `packages/core/test/agent/agent-tool-policy-task-whitelist.test.ts` | L11-14 `vfsRegistryNames()` + L20-34 `tools.allow/deny: ["task"]` 应报错断言 | 该文件直连调 `validateAgentToolPolicy({allow:["task"]}, registryNames)`，绕过 `validateAgentDefinition`。Step 12 采用中心过滤后，`validateAgentToolPolicy` 内部剔除 task，该测试无需改动即可通过。本 phase **保留不动**，仅在清单里声明「保留并验证通过」（覆盖 AC-9） |
| `packages/core/test/tool/subagent-tool-vfs.test.ts` | L7 `import { createSubagentTool, type TaskToolInput, type TaskToolOutput }` | Step 9 删工厂后该 import 必断。L7 改为静态 `subagentTool` 的 import，`TaskToolInput`/`TaskToolOutput` 类型 import 按新 API 调整（若新 API 仍导出这两个类型则保留，否则按实际签名修正） |
| 同上 | L90 `createSubagentTool(["general"])` 用法 | 不再调工厂，直接用静态 `subagentTool`（task 入参通过 mock ctx 的 `callableAgents` 提供） |
| `packages/core/test/provider/model-request-tools-stream.test.ts` | L231 `toolsFromRegistry(registry)` 不传 ctx | Step 8 给 `toolsFromRegistry` 加必填 ctx 后编译失败。补传构造好的 ctx mock（含 `subagent.callableAgents`） |
| 同上 | L235 `assert.equal(typeof t.description, "string")` | **无需改动**：`t` 是 `toolsFromRegistry(registry)` 的循环变量，是 `LlmToolDefinition`，其 `description` 仍是 string（`toolsFromRegistry` 内部已调 `tool.description(ctx)`）。按 Tool 对象改成 `t.description(mockCtx)` 反而编译失败 |
| `packages/core/test/tool/tool-registry.test.ts` | L12/L28/L38/L52 `description: "echo"/"dup"/"dup2"/"x"` | Step 8 把 `Tool.description` 改成 `(ctx: Ctx) => string` 后，字符串字面量无法赋给函数类型，TS 编译失败。把所有内联 Tool 字面量的 `description: "xxx"` 改成 `description: () => "xxx"`（箭头函数返回原字符串） |
| `packages/core/test/tool/tool-runner.test.ts` | L22/L44/L65 `description: "sum"/"fail"/"bad output"` | 同上：内联 Tool 字面量 description 字符串改箭头函数 |
| `packages/core/test/tool/tool-runner-parallel.test.ts` | L144 `description: "slow"` | 同上 |
| `packages/core/test/chat/user-vfs-turn.service.test.ts` | L382/L651 `description: "writes without user-ops derivation"/"boom"` | 同上：内联 Tool 字面量 description 字符串改箭头函数 |
| `packages/core/test/tool/chat-grep-tool.test.ts` | L114-126 `it("registers 6 V2 file tools...")` + `assert.equal(registry.list().length, 6)` + `deepEqual(..., ["edit","fs","glob","grep","read","write"])` | Step 10 task 进 `registerBuiltinTools` 后变 7 个。length 改 7；deepEqual 名单补 `"task"`（注意排序后位置）；测试标题「registers 6 V2 file tools」改「7」 |
| `packages/core/test/tool/vfs-tools.test.ts` | L40-44 `it("registers exactly 6 builtin tools via registerBuiltinTools")` + `assert.equal(registry.list().length, 6)` | 同上：length 改 7，或改 `>= 6 && includes("task")` 更稳；测试标题「registers exactly 6 builtin tools」改「7」 |
| `packages/core/test/service/agent/run-agent-turn.test.ts` | L97-102 mock `state` | 该 mock 含 `getSubagentNames: async () => []`。Step 11 删掉 `AgentTurnRuntimePort.state.getSubagentNames` 类型声明后，该对象赋给 `AgentTurnRuntimePort["state"]` 会触发 TS excess property check 编译断裂。**删除 mock state 里的 `getSubagentNames` 行** |
| 同上 | L103-106 mock `agentRegistry` | 该 mock 只有 `listAgentIds` + `get`，缺 `list()` 方法。Step 11 装配段改读 `agentRegistry.list()` 后运行时 `undefined is not a function`。**补 `list: async () => [definition]`**（沿用同一文件里已有的 `definition` fixture，确保 callable 预算有内容） |
| `packages/core/test/service/agent/annotate-drafts-send.test.ts` | L72-77 mock `state` | 同上：删 mock state 里的 `getSubagentNames` 行（excess property check） |
| 同上 | L78-81 mock `agentRegistry` | 同上：mock 缺 `list()`，补 `list: async () => [definition]` |
| `packages/core/test/service/agent/cli-run-agent-turn-parity.test.ts` | L70-75 mock `state` | 同上：删 mock state 里的 `getSubagentNames` 行。`agentRegistry` 用真实 registry（L76 `agentRegistry: registry`），已有 `list()`，不需补 |
| `packages/core/test/service/agent/run-agent-turn-project-agent.test.ts` | L55-60 mock `state` | 同上：删 mock state 里的 `getSubagentNames` 行。`agentRegistry` 用真实 registry（L61 `agentRegistry: registry`），已有 `list()`，不需补 |
| `packages/core/test/persistent-state/persistent-state.test.ts` | 全文 | **无需改动**：该文件存在，但只测 `setCurrent/Current/AgentId/ModelId/SessionId/RegexGroupId`，不引用被删的 `getSubagentNames/setSubagentNames/resetSubagentNames` 三方法。删持久化三方法不会让它断裂。本 phase 仅声明「保留不动」，纠正原 SPEC「不存在」的错误断言 |

> phase-test-fix 还需修 `packages/core/test/service/agent/` 下 4 个测试（见上方清单末几行）。其中 `run-agent-turn*.test.ts`、`persistent-state*.test.ts` **实际存在**，与原 SPEC「不存在」的断言相反：前者 mock 了被删的 `getSubagentNames`，必须修；后者不引用被删方法，无需改动（仅在清单里声明「保留不动」）。`resolve-agent-tool-registry*.test.ts` 确实不存在（仓库里只有 `resolve-agent-for-project.test.ts`，不含 `resolve-agent-tool-registry`），本迭代不新建。

### [删除] 持久化层（phase-persist-cleanup）

| 文件 | 行号 | 操作 |
|---|---|---|
| `packages/core/src/service/persistent-state/persistent-state.port.ts` | L47-54 | [删除] `getSubagentNames/setSubagentNames/resetSubagentNames` 三方法签名及注释 |
| `packages/core/src/service/persistent-state/impl/persistent-state.service.ts` | L20, L116-138 | [删除] `KEY_SUBAGENT_NAMES` import + 三方法实现 |
| `packages/core/src/service/persistent-state/impl/workspace-state-keys.ts` | L16 | [删除] `KEY_SUBAGENT_NAMES = "subagentNames"` |

> DB 里残留的 `subagentNames` KKV key 不主动清理（PRD 非目标）。

### [删除] 桌面 IPC（phase-desktop）

| 文件 | 行号 | 操作 |
|---|---|---|
| `apps/desktop/src/main/ipc/handlers/subagent-names.ts` | 整文件 | [删除] |
| `apps/desktop/src/main/ipc/handler-registry.ts` | L136-139, L377-378 | [删除] import + `bindNoArg(SUBAGENT_NAMES_GET)` / `bindReq(SUBAGENT_NAMES_SET)` |
| `apps/desktop/shared/ipc-types.ts` | L146-148, L752-755 | [删除] `SUBAGENT_NAMES_GET/SET` channel + `SubagentNamesSetRequest` 类型 |
| `apps/desktop/renderer/ipc/invoke-registry.ts` | L68, L487-494 | [删除] `SubagentNamesSetRequest` import + `ipcSubagentNamesGet/ipcSubagentNamesSet` |
| `apps/desktop/renderer/ipc/client.ts` | L134-135 | [删除] 两个 re-export |

### [删除] 桌面 UI 名单页（phase-desktop）

| 文件 | 行号 | 操作 |
|---|---|---|
| `apps/desktop/renderer/features/settings/SubagentRosterView.tsx` | 整文件 | [删除] |
| `apps/desktop/renderer/features/settings/SettingsViews.tsx` | L3 | [删除] `export { SubagentRosterView }` |
| `apps/desktop/renderer/features/settings/settings-nav.ts` | L9, L29, L55 | [删除] `SettingsViewId` 的 `"subagentRoster"`、`SETTINGS_NAV` 条目、`SETTINGS_TOP_LEVEL` 映射 |
| `apps/desktop/renderer/layout/SettingsOverlay.tsx` | L21-25, L112-113 | [删除] import + `case "subagentRoster"` 分支 |

### [改] 共享表单 state（phase-form-state）

| 文件 | 行号 | 符号 | 改动 |
|---|---|---|---|
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | L48-72 | `AgentEditorFormInput` | 加 `mode: "primary" \| "subagent" \| "all"`（L49 `name` 后） |
| 同上 | L433-443 | `definitionToForm` | 读出时 `mode: def.mode ?? "all"` |
| 同上 | L536-546 | `buildAgentDefinitionFromForm` | 组装 def 时写 `definition.mode = input.mode`；若 `input.mode === "all"` 可省略不写（保持 bundle 干净）或显式写——选择显式写 `all` 以减少歧义 |
| 同上 | 选项常量区 | 新增 `MODE_OPTIONS` | 参照 `TOOL_MODE_OPTIONS` 写法，导出 `{ value, label }[]`：`[{value:"all",label:"都可以"},{value:"primary",label:"仅主代理"},{value:"subagent",label:"仅子代理"}]` |
| `packages/core/test/config-forms/agent-editor-state.test.ts` | fixture / round-trip 断言处 | `AgentEditorFormInput` 加了必填 `mode` 后，fixture 不补会 TS 报错；`definitionToForm`/`buildAgentDefinitionFromForm` 的 round-trip 断言也要同步加 `mode` 字段校验（如 fixture 补 `mode: "all"`，round-trip 断言 `assert.equal(form.mode, "all")`） |

### [改] 桌面 AgentEditor mode 选择器 + picker 过滤（phase-desktop）

| 文件 | 行号 | 改动 |
|---|---|---|
| `apps/desktop/renderer/features/settings/AgentEditorView.tsx` | L104-142 | 加 `const [mode, setMode] = useState<"primary"\|"subagent"\|"all">("all")` |
| 同上 | L292 附近（`loadAgent`） | `setMode(def.mode ?? "all")` |
| 同上 | L424-443（`save` → `buildAgentDefinitionFromForm` 入参） | 透传 `mode` |
| 同上 | L661-662 之间（基本信息 section，description 之后） | 新增 `<SettingsField label="角色">` + 原生 `<select>`（沿用 toolsMode L724-734 的 `<select>` 风格，不引入新控件） |
| `apps/desktop/src/main/ipc/handlers/agent.ts` | L112-117（`handleAgentListPicker` 循环内） | `get` 拿到 `def` 后加 `if (def.mode === "subagent") continue;`（AC-7） |

### [删除 + 改] 移动端（phase-mobile）

| 文件 | 行号 | 操作 |
|---|---|---|
| `apps/mobile/src/screens/stack/SubagentRosterScreen.tsx` | 整文件 | [删除] |
| `apps/mobile/src/navigation/RootNavigator.tsx` | L20, L113-116, L193-196 | [删除] import + `SubagentRosterStackScreen` 包装 + `Stack.Screen` 注册 |
| `apps/mobile/src/navigation/types.ts` | L15 | [删除] `SubagentRoster: undefined` 路由 |
| `apps/mobile/src/navigation/header-config.ts` | L20 | [删除] `SubagentRoster` header 配置 |
| `apps/mobile/src/screens/tabs/ProfileTabScreen.tsx` | L38-48 | [删除] `CONFIG_MENU` 里 `{ icon: '🤝', label: '子智能体名单', route: 'SubagentRoster' }` 条目 |
| `apps/mobile/src/components/agent/AgentEditorForm.tsx` | L123-140 | 加 `const [mode, setMode] = useState<"primary"\|"subagent"\|"all">("all")` |
| 同上 | L233-243（`populateFormFromDefinition`） | `setMode(def.mode ?? "all")` |
| 同上 | L478-498（`handleSave` → `buildAgentDefinitionFromForm`） | 入参加 `mode` |
| 同上 | L835-857（基本信息 `FormSectionCard` 内，名称之后、描述之前） | 新增 `FormSelectField`（已 import L53）绑定 `MODE_OPTIONS` |
| `apps/mobile/src/services/agent-picker.ts` | L24-29（`loadAgentPickerRows`）, L67-72（`loadSessionAgentPickerRows`） | `get` 拿到 `def` 后加 `if (def.mode === "subagent") continue;`（AC-7） |

### [改] 测试 + 文档（phase-test-doc）

| 文件 | 行号 | 改动 |
|---|---|---|
| `apps/cli/test/agent-registry-e2e.test.ts` | L64-113（E4/T-C3） | 「subagentCallable 被 silent strip」断言改成「迁移成 `mode: "subagent"`」：`shown.stdout` 应匹配 `/mode"\s*:\s*"subagent"/`，不再断言 `doesNotMatch(/subagentCallable/)`（迁移后仍可不含该字段，但重点是 mode 出现） |
| `apps/cli/test/agents-bundle.test.ts` | L45-66（T-C3a） | 同上：`assert.equal(entry.mode, "subagent")` 替换 `assert.equal(entry.subagentCallable, undefined)` |
| `apps/mobile/__tests__/agent-picker-modal.test.ts` | L12 | mock `mockGet` 返回补 `mode: "all"`；新增一个 `mode: "subagent"` 被过滤掉的用例（覆盖 AC-7） |
| `docs/Iterations/agent-subagent/cli-acceptance.md` | L15, L61-90, L147-153, L193, L203 | `subagentCallable` → `mode`；yaml 示例改 `mode: subagent`；装配期描述改 mode 过滤 |
| `packages/core/test/agent/agent-registry-list-seed.test.ts` | L59-77（「upsert 同名 general 后 DB 优先」） | Step 6 禁止 `name === "general"` 重名后，原 `registry.upsert(name: "general")` 会抛错。改写为 `assert.rejects(registry.upsert(...), /INVALID_SCHEMA/)`；Step 30 另新增「空 DB 时 `general.mode === "subagent"`」断言 |
| `packages/core/test/agent/agent-definition-io.test.ts` | L116-135 | 若存在则改迁移断言；若不存在则**新建**聚焦单测覆盖迁移逻辑（`subagentCallable:true → mode:"subagent"`、显式 mode 优先、false/缺省 → 无 mode） |

## 兼容性说明

- **subagent 功能未发布，无迁移负担**：git 历史确认 subagent 功能不在任何已发布 tag 里（v1.4.18 无 `subagent-tool.ts`），是纯开发中未发布的特性。因此 schema 里现有的 `subagentCallable` silent-strip preprocess **直接删除**，不需要迁移成 `mode`（没有旧数据需要兼容）。
- **schemaVersion 锁死 1**：core 根 schema（L125）和 bundle 根 schema（L46）都是 `z.literal(1)`，加可选 `mode` 字段不破坏向前兼容。已落库的 agent 文档（无 mode）继续能解析，按 `all` 解释。
- **DB 残留 KKV**：`nm-workspace-state` 模块的 `subagentNames` key 删除常量后成孤儿数据，无人读取，不主动清理（PRD 非目标）。
- **`general` 禁止重名**：本次起，upsert 时 `name === "general"` 直接拒绝（抛 `INVALID_SCHEMA`）。之前允许 DB 同名覆盖 general，现在禁止——但因为是未发布功能，无存量数据受影响。
- **公共 API 签名变更**：`packages/core/src/public/provider.ts` L114 re-export 的 `toolsFromRegistry` 新增必填 `ctx` 参数（Step 8）。这是 core 公共导出的破坏性变更。core 内部唯一消费点是 `agent-runner.ts` L193（Step 8 同步改）；core 内嵌单测的消费点在 phase-test-fix 统一修。三端（desktop/mobile/cli）不直接调 `toolsFromRegistry`，不受影响。

## 详细实现步骤

- Step 1 — phase-model — blocking: yes — qa: auto：`AgentDefinition` 加 `mode?` 字段（`agent-definition.ts` L16-30）
- Step 2 — phase-model — blocking: yes — qa: auto：core wire schema 加 `mode` 枚举 + `documentToDefinition`/`definitionToDocument` 双向透传（`agent-definition.schema.ts` L122-244）
- Step 3 — phase-model — blocking: yes — qa: auto：core wire schema preprocess 删 `subagentCallable` silent-strip 整段（`agent-definition.schema.ts` L246-259，未发布无旧数据）
- Step 4 — phase-model — blocking: yes — qa: auto：CLI bundle schema 加 `mode` 枚举 + 删 preprocess silent-strip（`agents-bundle.schema.ts` L18-41）
- Step 5 — phase-model — blocking: yes — qa: auto：`DEFAULT_SUBAGENT_DEFINITION` 加 `mode: "subagent"`（`default-subagent-definition.ts` L19-29）
- Step 6 — phase-model — blocking: yes — qa: auto：registry `upsert` 加 general 重名禁止（`agent-registry.service.ts` L52-69）；过时注释清理
- Step 7 — phase-model — blocking: no — qa: auto：`examples/agents.yaml` 补 mode 示例 + 修注释
- Step 8 — phase-core-tool — blocking: yes — qa: auto：`Tool` 接口 description 改函数类型 `(ctx: Ctx) => string`（`tool.ts` L22）；6 个 vfs 工具 description 改箭头函数（`vfs-tools.ts`）；**废弃的 `chat-grep-tool.ts` L88-115 的 `createChatGrepTool` 返回对象同步把 description 改成 `() => "..."`（否则 TS 类型不匹配编译失败）**；`toolsFromRegistry` 加 ctx 参数直接调 `tool.description(ctx)`（`tool-definitions.ts` L12-23）；`agent-runner.ts` L193 调用处传 toolCtx
- Step 9 — phase-core-tool — blocking: yes — qa: auto：`subagent-tool.ts` 删 `createSubagentTool` 工厂，task 改静态导出对象 `subagentTool`（description 写 lambda 从 `ctx.subagent?.callableAgents ?? []` 拼）；run() 内 `defs.find` 加 `mode !== "primary"` 过滤；`BuiltinToolSubagentContext` 加 `callableAgents` 字段（`builtin-tool-context.ts` L31-56）
- Step 10 — phase-core-tool — blocking: yes — qa: auto：`register-builtin-tools.ts` 收敛：`registerBuiltinTools` 注册 task 静态对象（签名不动）；删 `registerSubagentTool` 独立函数
- Step 11 — phase-core-tool — blocking: yes — qa: auto：`runAgentTurn` 装配段改写：删名单逻辑，预算 callable 塞进 toolCtx（L370-386, L403-447）+ 删 `getSubagentNames` 声明（L108-111）；`runChildAgent` 同样改写（L520-540, L562-617）
- Step 12 — phase-core-tool — blocking: yes — qa: auto：**task 不进校验 known-names（AC-9 锁规则保防）**：放弃散点 filter，改为在 `validate-agent-tool-policy.ts` 的 `validateAgentToolPolicy`（L52-75）内部**中心过滤**——函数体开头从 `registryNames` 构造不含 `"task"` 的新 Set，`assertKnownNames` 用该过滤后的 Set。这样 `registeredToolNames: probe.list()` 全部 7 个调用点（7 个文件，枚举见变更点清单 phase-core-tool 段：`run-agent-turn.ts` 1 处、`run-agent.handler.ts` events 自动化 1 处、CLI `commands.ts`/`registry-commands.ts`、桌面/移动 `agent-yaml.service.ts`、桌面 `agent-registry.ts` 两处）都自动覆盖。probe 仍注册 task（对 LLM 可见），但校验 policy 时 task 不当合法名，保证用户写 `tools.allow/deny: ["task"]` 仍报 `INVALID_TOOL_POLICY`
- Step 13 — phase-test-fix — blocking: yes — qa: auto：修 `subagent-tool.test.ts`（L8 改静态 `subagentTool` import + L16 删 `registerSubagentTool` import 只留 `registerBuiltinTools` + mock ctx 补 `callableAgents` + **L197-231 的 T-T7/T-T7b description 断言整体改写**为用 `mockCtx.subagent.callableAgents` 传候选 + `subagentTool.description(mockCtx).includes(...)`）、`subagent-tool-parallel.test.ts`（L7 同改；该文件无 `registerSubagentTool` import；**L104/L145 的 `registry.register(createSubagentTool(["general"]))` 改为 `registry.register(subagentTool)` 或经 `registerBuiltinTools`**）、以及 `subagent-tool-vfs.test.ts`（L7 同改静态 import，`TaskToolInput`/`TaskToolOutput` 类型 import 按新 API 调整；**L90** 用法同步，直接用 `subagentTool`，不再调工厂）。**同时修 `packages/core/test/service/agent/` 下 4 个测试**（它们的 mock state 含被删的 `getSubagentNames`，Step 11 后 excess property check 编译断裂）：`run-agent-turn.test.ts`（L97-102 删 mock state 的 `getSubagentNames` 行 + L103-106 mock agentRegistry 补 `list: async () => [definition]`，否则 Step 11 装配段改读 `agentRegistry.list()` 会运行时崩）、`annotate-drafts-send.test.ts`（L72-77 同删 `getSubagentNames` + L78-81 mock agentRegistry 补 `list`）、`cli-run-agent-turn-parity.test.ts`（L70-75 同删 `getSubagentNames`；L76 用真实 registry 不需补 `list`）、`run-agent-turn-project-agent.test.ts`（L55-60 同删 `getSubagentNames`；L61 用真实 registry 不需补 `list`）
- Step 14 — phase-test-fix — blocking: yes — qa: auto：修 `agent-tool-policy.test.ts`：L7/L29/L41/L54 `toolsFromRegistry(filtered)` 补 ctx；L22/L26/L28 隐含「恰好 6 个」的断言改为跟随 `registerBuiltinTools`（自动同步为 7）或显式排除 task，不写死 6
- Step 15 — phase-test-fix — blocking: yes — qa: auto：修 `tool-schema-descriptions.test.ts`：L4/L10 `toolsFromRegistry(registry)` 补 ctx；**L12 无需改动**（`edit` 是 `LlmToolDefinition`，description 经 `toolsFromRegistry` 后仍为 string，当 Tool 对象改函数调用反而编译失败）；L26 `length === 6` 同步改 7。同时修 `model-request-tools-stream.test.ts`（同类修复）：L231 `toolsFromRegistry(registry)` 补传 ctx mock；**L235 无需改动**（`t` 是 `LlmToolDefinition`，description 仍为 string）。**新增 4 个内联 Tool 字面量文件修复**（Step 8 把 `Tool.description` 改函数类型后，字符串字面量无法赋给函数类型，编译断裂；这些文件用 `registry.register({ description: "xxx", ... })` 内联构造 Tool 对象）：`tool-registry.test.ts`（L12/L28/L38/L52 的 `description: "echo"/"dup"/"dup2"/"x"`）、`tool-runner.test.ts`（L22/L44/L65 的 `description: "sum"/"fail"/"bad output"`）、`tool-runner-parallel.test.ts`（L144 的 `description: "slow"`）、`user-vfs-turn.service.test.ts`（L382/L651 的 `description: "writes without user-ops derivation"/"boom"`）——统一把 `description: "xxx"` 改成 `description: () => "xxx"`。**新增 2 个 registerBuiltinTools 数量断言修复**（Step 10 task 进注册后 6→7，写死 6 的断言失败）：`chat-grep-tool.test.ts`（L114-126 length 改 7 + deepEqual 名单补 `"task"` + 标题「registers 6 V2 file tools」改「7」）、`vfs-tools.test.ts`（L40-44 length 改 7 或 `>= 6 && includes("task")` + 标题「registers exactly 6 builtin tools」改「7」）
- Step 16 — phase-test-fix — blocking: yes — qa: auto：**保留** `agent-tool-policy-task-whitelist.test.ts` 不改（Step 12 在 `validateAgentToolPolicy` 内部中心过滤掉 task 后该测试应照常通过）；本 Step 仅声明「保留并验证通过」，跑一遍确认 `tools.allow/deny: ["task"]` 仍报 `INVALID_TOOL_POLICY`
- Step 17 — phase-persist-cleanup — blocking: yes — qa: auto：删持久化端口三方法（`persistent-state.port.ts` L47-54）
- Step 18 — phase-persist-cleanup — blocking: yes — qa: auto：删持久化实现三方法 + import（`persistent-state.service.ts` L20, L116-138）
- Step 19 — phase-persist-cleanup — blocking: yes — qa: auto：删 KKV key（`workspace-state-keys.ts` L16）
- Step 20 — phase-form-state — blocking: yes — qa: auto：`agent-editor-state.ts` 加 `AgentEditorFormInput.mode` + `definitionToForm` 读 mode + `buildAgentDefinitionFromForm` 写 mode + 新增 `MODE_OPTIONS` 常量（L48-72, L433, L536）；**同步改 `packages/core/test/config-forms/agent-editor-state.test.ts`：fixture 补 mode、round-trip 断言加 mode**
- Step 21 — phase-desktop — blocking: yes — qa: auto：删桌面 IPC handler 整文件 + handler-registry 注册 + ipc-types channel/类型 + invoke-registry/client（5 文件）
- Step 22 — phase-desktop — blocking: yes — qa: auto：删桌面 SubagentRosterView 整文件 + SettingsViews re-export + settings-nav 三处 + SettingsOverlay 分支（4 文件）
- Step 23 — phase-desktop — blocking: no — qa: auto：桌面 AgentEditorView 加 mode state/loadAgent 回填/save 透传/select 渲染（L104-142, L292, L424-443, L661-662）
- Step 24 — phase-desktop — blocking: yes — qa: manual_user：桌面 `handleAgentListPicker` 加 mode=subagent 过滤（`agent.ts` L112-117）。桌面 picker 是 IPC handler 路径，无现成自动化回归网，本 Step qa 标 `manual_user`，桌面端 subagent 过滤手测覆盖在 T-U1
- Step 25 — phase-mobile — blocking: yes — qa: auto：删移动 SubagentRosterScreen 整文件 + RootNavigator 注册 + types 路由 + header-config + ProfileTabScreen 入口（5 文件）
- Step 26 — phase-mobile — blocking: no — qa: auto：移动 AgentEditorForm 加 mode state/populate/save/FormSelectField 渲染（L123-140, L233-243, L478-498, L835-857）
- Step 27 — phase-mobile — blocking: yes — qa: auto：移动 `agent-picker.ts` 两处加 mode=subagent 过滤（L24-29, L67-72）
- Step 28 — phase-test-doc — blocking: yes — qa: auto：改 CLI e2e + bundle schema 测试的 `subagentCallable` 断言（`agent-registry-e2e.test.ts` L64-113 的 E4/T-C3 改成验证 mode 字段导入导出；`agents-bundle.test.ts` L45-66 的 T-C3a 同步）
- Step 29 — phase-test-doc — blocking: yes — qa: auto：移动 `agent-picker-modal.test.ts` mock 补 mode + 新增 subagent 过滤用例（L12）
- Step 30 — phase-test-doc — blocking: yes — qa: auto：**T-G1 接线**：改 `packages/core/test/agent/agent-registry-list-seed.test.ts`，新增断言「空 DB 时 `list()` 返回的 general 满足 `general.mode === "subagent"`」（覆盖 FR-5 / T-G1）；**同时改写既有测试**「upsert 同名 general 后 DB 优先」（L59-77）——因 Step 6 禁止 `name === "general"` 重名，原 upsert 现在会抛错，该测试改为 `assert.rejects(registry.upsert(...), /INVALID_SCHEMA/)`，保留「空 DB 时 general.mode === "subagent"」断言不变
- Step 31 — phase-test-doc — blocking: no — qa: manual_user：更新 CLI 验收文档（`cli-acceptance.md` L15/L61-90/L147-153/L193/L203）
- Step 32 — phase-test-doc — blocking: yes — qa: manual_user：三端 build 验证（desktop electron build + mobile android build + cli bundle schema 导入导出回归）；真机验收 task 工具始终可见 + mode 切换生效

## 测试策略

### 测试用例

- T-T1 — blocking: yes — task 始终可见：空工作区（无自定义 agent）启动主对话，`task` 在已注册工具列表中，描述含 `general`（覆盖 Step 9/10，AC-1）
- T-T2 — blocking: yes — mode 驱动候选：`mode: "subagent"` 的 agent 出现在 task 描述；改 `primary` 后消失；改 `all` 后出现（覆盖 Step 8/9，AC-2）
- T-T3 — blocking: yes — 自递归防护：当前主代理自身不在自己的 task 候选里（覆盖 Step 9，AC-3）
- T-T4 — blocking: yes — 递归上限：`depth >= 2` 调 task 被拒（覆盖 Step 9/10，AC-4，回归）
- T-C1 — blocking: yes — 名单零残留：全局搜 `getSubagentNames/setSubagentNames/resetSubagentNames/SubagentRoster/ipcSubagentNames/SUBAGENT_NAMES_/KEY_SUBAGENT_NAMES` 零命中（dist/worktree 不计）（覆盖 Step 17-22/25，AC-5）
- T-C4 — blocking: yes — task 不进用户 allow/deny：`tools.allow: ["task"]` / `tools.deny: ["task"]` 仍报 `INVALID_TOOL_POLICY`（覆盖 Step 12，AC-9）。回归网是 `agent-tool-policy-task-whitelist.test.ts`（Step 16 保留验证通过）
- T-G1 — blocking: yes — general mode 固定：`DEFAULT_SUBAGENT_DEFINITION.mode === "subagent"`；`agent-registry-list-seed.test.ts` 断言空 DB 时 `list()` 返回的 `general.mode === "subagent"`；upsert 同名 general 抛 `INVALID_SCHEMA`（禁止重名）（覆盖 Step 5/6/30，FR-5）
- T-P1 — blocking: yes — 主代理选择过滤：`mode === "subagent"` 的 agent 不出现在主代理选择列表。移动端自动化在 `agent-picker-modal.test.ts`（Step 29）；桌面 picker（`handleAgentListPicker`）无自动化回归网，走手测（覆盖 Step 24/27，AC-7）
- T-U1 — blocking: no — qa: manual_user — 三端 mode 选择器一致 + 桌面 picker 过滤：移动端、桌面端新建 agent 默认「都可以」，切换后保存生效；**桌面端 `handleAgentListPicker` 的 subagent 过滤一并手测**（Step 24 标 manual_user）（覆盖 Step 23/24/26，AC-7/AC-8）
- T-B1 — blocking: yes — qa: manual_user — 三端 build 通过 + CLI bundle 导入导出回归（覆盖 Step 32，AC-9）

### 测试矩阵

| Step | 覆盖测试 |
|---|---|
| Step 5/6 | T-G1 |
| Step 8/9/10/11 | T-T1, T-T2, T-T3, T-T4 |
| Step 12 | T-C4 |
| Step 13-16 | T-T1, T-T2, T-T3, T-T4（修复后回归网重新走通）, T-C4（Step 16 保留验证） |
| Step 17-22/25 | T-C1 |
| Step 24/27 | T-P1 |
| Step 23/24/26 | T-U1 |
| Step 28/29 | T-P1（移动端自动化部分） |
| Step 30 | T-G1（list-seed 接线） |
| Step 32 | T-B1 |

### 关于 PRD FR-7 测试文件清单的说明

PRD FR-7 列出一批要更新的 core 测试文件，探索结果与原 SPEC 的断言不一致，需要更正：

- **core 有大量内嵌单测**（`packages/core/test/` 下约 30 个子目录），并非「core 目前无内嵌单测」。PRD FR-7 点名的下列文件**实际存在**，且会在装配链路改造后编译断裂或断言失效，已纳入新增的 `phase-test-fix`（Step 13-16）：
  - `core/test/tool/subagent-tool.test.ts`（L8 import `createSubagentTool`）、`subagent-tool-parallel.test.ts`（L7 import `createSubagentTool`，另有 L104/L145 的工厂用法）：import 已删的 `createSubagentTool`
  - `core/test/agent/agent-tool-policy.test.ts`：调 `toolsFromRegistry` 不传 ctx、断言恰好 6 个工具
  - `core/test/tool/tool-schema-descriptions.test.ts`：`toolsFromRegistry(registry)` 不传 ctx；description 字符串断言**无需改**（经 `toolsFromRegistry` 后仍是 string）
  - `core/test/tool/subagent-tool-vfs.test.ts`：L7 import `createSubagentTool`（Step 9 删工厂后断）+ L90 工厂用法
  - `core/test/provider/model-request-tools-stream.test.ts`：L231 `toolsFromRegistry(registry)` 不传 ctx；L235 字符串断言**无需改**（经 `toolsFromRegistry` 后仍是 string）
  - `core/test/agent/agent-tool-policy-task-whitelist.test.ts`：存在且应保留——Step 12 中心过滤掉 task 后它照常通过，是 AC-9 锁规则的回归网
  - `core/test/tool/tool-registry.test.ts`（L12/L28/L38/L52）、`tool-runner.test.ts`（L22/L44/L65）、`tool-runner-parallel.test.ts`（L144）、`chat/user-vfs-turn.service.test.ts`（L382/L651）：都用 `registry.register({ description: "xxx", ... })` 内联构造 Tool 对象，Step 8 改函数类型后字符串字面量编译断裂，统一改 `description: () => "xxx"`。PRD FR-7 未点名，本轮探索补入 phase-test-fix（Step 15）
  - `core/test/tool/chat-grep-tool.test.ts`（L114-126 写死 length===6 + 名单缺 task）、`vfs-tools.test.ts`（L40-44 写死 length===6）：Step 10 task 进 `registerBuiltinTools` 后变 7 个，断言同步改 7。PRD FR-7 未点名，本轮探索补入 phase-test-fix（Step 15）
- **PRD FR-7 点名但主仓库确实不存在的文件**（不新建，超出本迭代范围）：`resolve-agent-tool-registry*.test.ts`（仓库里只有 `packages/core/test/service/agent/resolve-agent-for-project.test.ts`，不含 `resolve-agent-tool-registry`）。
- **PRD FR-7 点名且实际存在的文件，需纳入 `phase-test-fix`**（原 SPEC 误记为「不存在」）：`packages/core/test/service/agent/run-agent-turn.test.ts`（L97-102 mock `state.getSubagentNames` + L103-106 mock `agentRegistry` 缺 `list()`）、`annotate-drafts-send.test.ts`（L72-77 + L78-81 同上）、`cli-run-agent-turn-parity.test.ts`（L70-75 同删 `getSubagentNames`）、`run-agent-turn-project-agent.test.ts`（L55-60 同删 `getSubagentNames`）。Step 11 删 `getSubagentNames` 类型声明后，mock 对象赋给 `AgentTurnRuntimePort["state"]` 触发 excess property check 编译断裂，详见变更点清单 phase-test-fix 段。
- **存在但无需改动的文件**：`packages/core/test/persistent-state/persistent-state.test.ts` **实际存在**（原 SPEC 误记为「不存在」），但只测 `setCurrent/Current/AgentId/ModelId/SessionId/RegexGroupId`，不引用被删的 `getSubagentNames/setSubagentNames/resetSubagentNames` 三方法，删持久化三方法不会让它断裂，本迭代保留不动。
- **存在但本轮新增/改写断言的文件**：`core/test/agent/agent-registry-list-seed.test.ts`（Step 30 补 T-G1 的 `general.mode === "subagent"` 断言，并把既有「upsert 同名 general 后 DB 优先」L59-77 改写为 `assert.rejects(..., /INVALID_SCHEMA/)`）；`core/test/config-forms/agent-editor-state.test.ts`（Step 20 补 fixture/round-trip 的 mode）

综上，本迭代的测试回归网比原 SPEC 设想的宽得多：既有 core 单测必须随装配链路同步修，不能跳过；CLI e2e + bundle schema + 移动 picker 测试同步更新；确实不存在的文件不新建。

## 风险与回滚方案

### 风险

1. **task 进 toolProbe 的风险已规避**：task 虽然在 `registerBuiltinTools` 里注册（probe 也含 task），但 probe 只读 `tool.name` 列表（`ToolRegistry.list()` 返回 name 数组），从不调 `toolsFromRegistry`、从不读 description。所以 probe 路径对 task 的 description lambda 无感知。
2. **task 进校验 known-names 的风险已规避（Step 12）**：task 进 `registerBuiltinTools` 后，各调用点把 probe 的 `list()` 寒进 `validateAgentDefinition` 当 known-names。如果不处理，用户写 `tools.allow: ["task"]` 就不再报 `INVALID_TOOL_POLICY`，AC-9 锁规则运行时失效。Step 12 在 `validateAgentToolPolicy` 内部中心过滤掉 task，所有经 `validateAgentDefinition` 传入 `registeredToolNames` 的调用点（7 个文件，枚举见 phase-core-tool 段变更点清单）都自动覆盖。task 仍注册（对 LLM 可见）但不当合法校验名。回归网是 `agent-tool-policy-task-whitelist.test.ts`（Step 16 保留验证通过）。
3. **候选为空时 task 仍注册**：callable 为空时 task 仍在 `registerBuiltinTools` 里注册（对 LLM 可见），description 显示「（暂无）」类占位文案。callable 是否为空只影响 description 文案，**不影响 task 注册**——这与 T-T1「task 始终可见」一致。T-T1 的「空工作区」场景因内置 `general` 永远 `mode: "subagent"` 存在，候选非空，描述含 `general`。
4. **general 禁止重名的行为变化**：现有允许 DB 同名覆盖 general，本次改为 upsert 拒绝。因为是未发布功能，无存量数据受影响。
5. **三端 build 失败风险**：删除持久化方法后，三端 runtime 工厂注入的 `state` 实现如果还引用了这三个方法会编译失败。需在三端 build 时验证（T-B1）。探索确认 core 层唯一读取点是 `run-agent-turn.ts`（Step 11 改完后无人读），但三端 runtime 的 `PersistentState` 实现类要确认没有别处引用。

### 回滚

本次改动集中在 `feat/merge-subagent` 分支，按 phase 提交。若某 phase 出问题，可 `git revert` 对应 commit。整体回滚则 reset 到 PRD commit（`82efbe3f`）之前。由于 subagent 功能未发布，无存量数据兼容问题，回滚干净。

## 开放点（已全部解决）

1. **task 注册路径收敛 + Tool 模型改进**：`Tool.description` 改函数类型 `(ctx) => string`，task 作为静态内置工具注册，description 函数自包含动态性；`registerBuiltinTools` 回归无参签名，删除 `registerSubagentTool`。用户已确认。
2. **general 禁止重名**：upsert 时 `name === "general"` 直接拒绝，用户已确认。
3. **无迁移负担**：subagent 功能未发布（不在任何 tag），直接删 schema 的 `subagentCallable` strip，不做迁移逻辑。用户已确认。
