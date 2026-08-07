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
| `Tool.description` 怎么动态拼 | **Tool 接口 description 改函数类型**：`(ctx: Ctx) => string`。task 和所有内置工具统一用函数返回描述，task 从 `ctx.subagent.callableAgents`（装配期预算好的候选数组）同步拼文案 | `Tool.description` 当前是 `readonly string`（`tool.ts` L22）。探索确认生产代码只有一处消费 `tool.description`（`toolsFromRegistry`，`tool-definitions.ts` L19），改为直接 `tool.description(ctx)`。装配期把 `agentRegistry.list().filter(mode !== "primary")` 预算成数组塞进 ctx，lambda 同步读，规避 async 问题 |
| task 注册路径收敛 | **task 作为静态对象在 `registerBuiltinTools` 里注册**，`registerBuiltinTools` 回归无参签名；删除 `createSubagentTool` 工厂 + `registerSubagentTool` 独立函数 | 现有两条平行路径是技术债（C-orch 反模式）。改 Tool.description 为 union 后，task 的动态性自包含在 description lambda 里，不需要外部工厂烘焙字符串 |
| `subagentCallable` 旧字段 | **直接删除 preprocess strip**：subagent 功能未发布（不在任何 tag、v1.4.18 无 `subagent-tool.ts`），无旧数据需兼容 | git 历史确认：subagent 纯开发中未发布，不存在带 `subagentCallable` 的正式数据 |
| 内置 `general` 与用户重名 | **upsert 时禁止 `name === "general"`**，抛 `INVALID_SCHEMA` | general 是虚拟内置 agent，不允许用户创建同名 agent；比「强制 mode」更干净，消除开放点 |
| 缺省值归属 | `AgentDefinition.mode` 为 `optional`，**不在模型层填默认值**；由消费侧（`run-agent-turn` 装配期、picker 过滤）按 `def.mode ?? "all"` 解释 | wire 双向 codec 保持「无 mode 不写出」，导出 bundle 干净；旧数据自洽 |
| 测试范围 | 务实路线：**不新建** PRD FR-7 列的那些 core 单测文件（`run-agent-turn*.test.ts` 等，经探索确认主仓库不存在）；改为 (a) 更新现有 CLI e2e + bundle schema 测试的迁移断言，(b) 给移动 `agent-picker` 测试补 mode 过滤用例，(c) 仅给「schema 迁移」这一个核心新增逻辑补一个聚焦单测 | core 目前无内嵌单测，装配链路靠 CLI e2e 覆盖；大范围新建单测超出本需求范围，回归靠现有 e2e + 三端 build |

### 实施依赖链（顺序不可乱）

```
phase-model（FR-1 加字段 + FR-2 schema 迁移 + FR-5 general seed）
  → phase-core-tool（FR-3 工具改造：装配段换数据源 + run() 加 mode 过滤）
    → phase-persist-cleanup（FR-4 删持久化层：装配段不再读 getSubagentNames 后才安全删）
      → phase-form-state（共享表单 state 加 mode，被两端 UI 依赖）
  phase-desktop（FR-4 桌面拆除 + FR-6 选择器 + AC-7 picker 过滤）  ← 依赖 persist-cleanup + form-state
  phase-mobile（FR-4 移动拆除 + FR-6 选择器 + AC-7 picker 过滤）   ← 依赖 persist-cleanup + form-state，可与 desktop 并行
phase-test-doc（FR-7 测试 + 文档）  ← 最后
```

`phase-desktop` 和 `phase-mobile` 文件域不重叠，可同 wave 并行。

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
| `packages/core/src/infra/llm-protocol/logic/tool-definitions.ts` | L12-23 | `toolsFromRegistry` | 加 `ctx: Ctx` 参数；description 读取改直接 `tool.description(ctx)` |
| `packages/core/src/service/agent/impl/agent-runner.ts` | L193 | `toolsFromRegistry` 调用 | 传 `this.deps.toolCtx`（L75 已有） |
| `packages/core/src/domain/tool/builtin/builtin-tool-context.ts` | L31-56 | `BuiltinToolSubagentContext` | 加 `readonly callableAgents: readonly { name: string; description?: string }[]`（装配期预算的候选列表） |
| `packages/core/src/domain/tool/builtin/subagent-tool.ts` | L80-188 | `createSubagentTool` 工厂 | **删除**工厂；task 改为静态导出对象 `subagentTool`，description 写 lambda 从 `ctx.subagent?.callableAgents` 拼文案 |
| `packages/core/src/service/agent/logic/run-agent-turn.ts` | L108-111 | `AgentTurnRuntimePort.state` | 删 `getSubagentNames` 类型声明 |
| 同上 | L370-386 | `runAgentTurn` task 装配段 | 整段改写：删 `getSubagentNames` + `add("general")` 兜底 + `defByName` 过滤；改为 `const callable = allDefs.filter(d => d.mode !== "primary" && d.name !== definition.name).map(d => ({name: d.name, description: d.description}));` callable 塞进下方 toolCtx 的 `subagent.callableAgents`。task 不再在这里注册（task 是内置工具，L364 probe `registerBuiltinTools` 时就注册了） |
| 同上 | L520-540 | `runChildAgent` task 装配段 | 同上改写：删名单逻辑；预算 callable 塞进子 agent ctx 的 `subagent.callableAgents`。task 注册与否由 `resolveAgentToolRegistry` 的 depth 判断控制（depth≥2 deny） |
| 同上 | L403-447 | 主 agent `subagent` ctx | 加 `callableAgents: callable`（depth、parentSignal、runChildAgent 等保留） |
| 同上 | L562-617 | 子 agent `subagent` ctx | 加 `callableAgents: callable`（depth、parentSignal 等保留） |

> task 作为静态内置工具，在 `registerBuiltinTools` 里和 vfs 工具一起注册。task 是否对 LLM 可见由 `resolveAgentToolRegistry` 的 depth 判断控制（depth≥2 deny）。description lambda 从 `ctx.subagent.callableAgents` 读装配期预算好的候选列表拼文案——因为内置 `general` 永远 `mode: "subagent"` 在 registry 里，callable 列表至少含 general（排除当前 agent 自身后），所以 task 的描述始终有内容。

**保留不动（双保险/锁死规则）**：

| 文件 | 行号 | 说明 |
|---|---|---|
| `packages/core/src/domain/agent/logic/resolve-agent-tool-registry.ts` | L43-63 | `depth >= 2` deny task，递归上限双保险 |
| `packages/core/src/domain/agent/logic/validate-agent-tool-policy.ts` | L7, L34 | `FILE_TOOL_NAMES` 白名单基线（6 件，不含 task） |
| `packages/core/src/config-forms/agent/agent-tool-catalog.ts` | L4-18 | task 不进 `BUILTIN_TOOL_CATALOG`；注释更新为「task 始终注册但不进用户 allow/deny」 |
| `packages/core/src/domain/tool/builtin/vfs-tools.ts` | L38-45 | `FILE_TOOL_NAMES` 6 件 |

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
| `packages/core/test/agent/agent-definition-io.test.ts` | L116-135 | 若存在则改迁移断言；若不存在则**新建**聚焦单测覆盖迁移逻辑（`subagentCallable:true → mode:"subagent"`、显式 mode 优先、false/缺省 → 无 mode） |

## 兼容性说明

- **subagent 功能未发布，无迁移负担**：git 历史确认 subagent 功能不在任何已发布 tag 里（v1.4.18 无 `subagent-tool.ts`），是纯开发中未发布的特性。因此 schema 里现有的 `subagentCallable` silent-strip preprocess **直接删除**，不需要迁移成 `mode`（没有旧数据需要兼容）。
- **schemaVersion 锁死 1**：core 根 schema（L125）和 bundle 根 schema（L46）都是 `z.literal(1)`，加可选 `mode` 字段不破坏向前兼容。已落库的 agent 文档（无 mode）继续能解析，按 `all` 解释。
- **DB 残留 KKV**：`nm-workspace-state` 模块的 `subagentNames` key 删除常量后成孤儿数据，无人读取，不主动清理（PRD 非目标）。
- **`general` 禁止重名**：本次起，upsert 时 `name === "general"` 直接拒绝（抛 `INVALID_SCHEMA`）。之前允许 DB 同名覆盖，现在禁止——但因为是未发布功能，无存量数据受影响。

## 详细实现步骤

- Step 1 — phase-model — blocking: yes — qa: auto：`AgentDefinition` 加 `mode?` 字段（`agent-definition.ts` L16-30）
- Step 2 — phase-model — blocking: yes — qa: auto：core wire schema 加 `mode` 枚举 + `documentToDefinition`/`definitionToDocument` 双向透传（`agent-definition.schema.ts` L122-244）
- Step 3 — phase-model — blocking: yes — qa: auto：core wire schema preprocess 删 `subagentCallable` silent-strip 整段（`agent-definition.schema.ts` L246-259，未发布无旧数据）
- Step 4 — phase-model — blocking: yes — qa: auto：CLI bundle schema 加 `mode` 枚举 + 删 preprocess silent-strip（`agents-bundle.schema.ts` L18-41）
- Step 5 — phase-model — blocking: yes — qa: auto：`DEFAULT_SUBAGENT_DEFINITION` 加 `mode: "subagent"`（`default-subagent-definition.ts` L19-29）
- Step 6 — phase-model — blocking: yes — qa: auto：registry `upsert` 加 general 重名禁止（`agent-registry.service.ts` L52-69）；过时注释清理
- Step 7 — phase-model — blocking: no — qa: auto：`examples/agents.yaml` 补 mode 示例 + 修注释
- Step 8 — phase-core-tool — blocking: yes — qa: auto：`Tool` 接口 description 改函数类型 `(ctx: Ctx) => string`（`tool.ts` L22）；6 个 vfs 工具 description 改箭头函数（`vfs-tools.ts`）；`toolsFromRegistry` 加 ctx 参数直接调 `tool.description(ctx)`（`tool-definitions.ts` L12-23）；`agent-runner.ts` L193 调用处传 toolCtx
- Step 9 — phase-core-tool — blocking: yes — qa: auto：`subagent-tool.ts` 删 `createSubagentTool` 工厂，task 改静态导出对象 `subagentTool`（description 写 lambda 从 `ctx.subagent?.callableAgents` 拼）；run() 内 `defs.find` 加 `mode !== "primary"` 过滤；`BuiltinToolSubagentContext` 加 `callableAgents` 字段（`builtin-tool-context.ts` L31-56）
- Step 10 — phase-core-tool — blocking: yes — qa: auto：`register-builtin-tools.ts` 收敛：`registerBuiltinTools` 注册 task 静态对象（签名不动）；删 `registerSubagentTool` 独立函数
- Step 11 — phase-core-tool — blocking: yes — qa: auto：`runAgentTurn` 装配段改写：删名单逻辑，预算 callable 塞进 toolCtx（L370-386, L403-447）+ 删 `getSubagentNames` 声明（L108-111）；`runChildAgent` 同样改写（L520-540, L562-617）
- Step 12 — phase-persist-cleanup — blocking: yes — qa: auto：删持久化端口三方法（`persistent-state.port.ts` L47-54）
- Step 13 — phase-persist-cleanup — blocking: yes — qa: auto：删持久化实现三方法 + import（`persistent-state.service.ts` L20, L116-138）
- Step 14 — phase-persist-cleanup — blocking: yes — qa: auto：删 KKV key（`workspace-state-keys.ts` L16）
- Step 15 — phase-form-state — blocking: yes — qa: auto：`agent-editor-state.ts` 加 `AgentEditorFormInput.mode` + `definitionToForm` 读 mode + `buildAgentDefinitionFromForm` 写 mode + 新增 `MODE_OPTIONS` 常量（L48-72, L433, L536）
- Step 16 — phase-desktop — blocking: yes — qa: auto：删桌面 IPC handler 整文件 + handler-registry 注册 + ipc-types channel/类型 + invoke-registry/client（5 文件）
- Step 17 — phase-desktop — blocking: yes — qa: auto：删桌面 SubagentRosterView 整文件 + SettingsViews re-export + settings-nav 三处 + SettingsOverlay 分支（4 文件）
- Step 18 — phase-desktop — blocking: no — qa: auto：桌面 AgentEditorView 加 mode state/loadAgent 回填/save 透传/select 渲染（L104-142, L292, L424-443, L661-662）
- Step 19 — phase-desktop — blocking: yes — qa: auto：桌面 `handleAgentListPicker` 加 mode=subagent 过滤（`agent.ts` L112-117）
- Step 20 — phase-mobile — blocking: yes — qa: auto：删移动 SubagentRosterScreen 整文件 + RootNavigator 注册 + types 路由 + header-config + ProfileTabScreen 入口（5 文件）
- Step 21 — phase-mobile — blocking: no — qa: auto：移动 AgentEditorForm 加 mode state/populate/save/FormSelectField 渲染（L123-140, L233-243, L478-498, L835-857）
- Step 22 — phase-mobile — blocking: yes — qa: auto：移动 `agent-picker.ts` 两处加 mode=subagent 过滤（L24-29, L67-72）
- Step 23 — phase-test-doc — blocking: yes — qa: auto：改 CLI e2e + bundle schema 测试的 `subagentCallable` 断言（`agent-registry-e2e.test.ts` L64-113 的 E4/T-C3 改成验证 mode 字段导入导出；`agents-bundle.test.ts` L45-66 的 T-C3a 同步）
- Step 24 — phase-test-doc — blocking: yes — qa: auto：移动 `agent-picker-modal.test.ts` mock 补 mode + 新增 subagent 过滤用例（L12）
- Step 25 — phase-test-doc — blocking: no — qa: manual_user：更新 CLI 验收文档（`cli-acceptance.md` L15/L61-90/L147-153/L193/L203）
- Step 26 — phase-test-doc — blocking: yes — qa: manual_user：三端 build 验证（desktop electron build + mobile android build + cli bundle schema 导入导出回归）；真机验收 task 工具始终可见 + mode 切换生效

## 测试策略

### 测试用例

- T-T1 — blocking: yes — task 始终可见：空工作区（无自定义 agent）启动主对话，`task` 在已注册工具列表中，描述含 `general`（覆盖 Step 9，AC-1）
- T-T2 — blocking: yes — mode 驱动候选：`mode: "subagent"` 的 agent 出现在 task 描述；改 `primary` 后消失；改 `all` 后出现（覆盖 Step 8/9，AC-2）
- T-T3 — blocking: yes — 自递归防护：当前主代理自身不在自己的 task 候选里（覆盖 Step 9，AC-3）
- T-T4 — blocking: yes — 递归上限：`depth >= 2` 调 task 被拒（覆盖 Step 8/10，AC-4，回归）
- T-C1 — blocking: yes — 名单零残留：全局搜 `getSubagentNames/setSubagentNames/resetSubagentNames/SubagentRoster/ipcSubagentNames/SUBAGENT_NAMES_/KEY_SUBAGENT_NAMES` 零命中（dist/worktree 不计）（覆盖 Step 12-17/20，AC-5）
- T-G1 — blocking: yes — general mode 固定：`DEFAULT_SUBAGENT_DEFINITION.mode === "subagent"`；upsert 同名 general 后仍为 subagent（覆盖 Step 5/6，FR-5）
- T-P1 — blocking: yes — 主代理选择过滤：`mode === "subagent"` 的 agent 不出现在主代理选择列表（覆盖 Step 19/22，AC-7）
- T-U1 — blocking: no — qa: manual_user — 三端 mode 选择器一致：移动端、桌面端新建 agent 默认「都可以」，切换后保存生效（覆盖 Step 18/21，AC-8）
- T-B1 — blocking: yes — qa: manual_user — 三端 build 通过 + CLI bundle 导入导出回归（覆盖 Step 27，AC-9）

### 测试矩阵

| Step | 覆盖测试 |
|---|---|
| Step 5/6 | T-G1 |
| Step 8/9/10/11 | T-T1, T-T2, T-T3, T-T4 |
| Step 12-17/20 | T-C1 |
| Step 19/22 | T-P1 |
| Step 18/21 | T-U1 |
| Step 23-24 | T-P1（自动化） |
| Step 26 | T-B1 |

### 关于 PRD FR-7 测试文件清单的说明

PRD FR-7 列出的 `run-agent-turn*.test.ts`、`subagent-tool.test.ts`、`agent-registry-list-seed.test.ts`、`agent-tool-policy-task-whitelist.test.ts`、`resolve-agent-tool-registry*.test.ts`、`persistent-state*.test.ts` 经探索确认**在主仓库不存在**——core 目前无内嵌单测，装配链路靠 CLI e2e 覆盖。本 SPEC 取务实路线：不新建这一批单测文件，改为更新现有 CLI e2e + bundle schema 测试 + 移动 picker 测试。若后续需要更强回归，可单独开迭代补 core 单测。

## 风险与回滚方案

### 风险

1. **task 进 toolProbe 的风险已规避**：task 虽然在 `registerBuiltinTools` 里注册（probe 也含 task），但 probe 只读 `tool.name` 列表（`ToolRegistry.list()` 返回 name 数组），从不调 `toolsFromRegistry`、从不读 description。所以 probe 路径对 task 的 description lambda 无感知。
2. **装配段改写后候选为空的边界**：当 registry 只有当前主代理一个 agent 且它不是 general 时，候选为空，`task` 不注册。这是合理行为（没有可调子代理），但要在 T-T1 验证「空工作区」场景——此时内置 general 存在，候选非空。
3. **general 禁止重名的行为变化**：现有允许 DB 同名覆盖 general，本次改为 upsert 拒绝。因为是未发布功能，无存量数据受影响。
4. **三端 build 失败风险**：删除持久化方法后，三端 runtime 工厂注入的 `state` 实现如果还引用了这三个方法会编译失败。需在三端 build 时验证（T-B1）。探索确认 core 层唯一读取点是 `run-agent-turn.ts`（Step 9/10 改完后无人读），但三端 runtime 的 `PersistentState` 实现类要确认没有别处引用。

### 回滚

本次改动集中在 `feat/merge-subagent` 分支，按 phase 提交。若某 phase 出问题，可 `git revert` 对应 commit。整体回滚则 reset 到 PRD commit（`82efbe3f`）之前。由于 subagent 功能未发布，无存量数据兼容问题，回滚干净。

## 开放点（已全部解决）

1. **task 注册路径收敛 + Tool 模型改进**：`Tool.description` 改函数类型 `(ctx) => string`，task 作为静态内置工具注册，description 函数自包含动态性；`registerBuiltinTools` 回归无参签名，删除 `registerSubagentTool`。用户已确认。
2. **general 禁止重名**：upsert 时 `name === "general"` 直接拒绝，用户已确认。
3. **无迁移负担**：subagent 功能未发布（不在任何 tag），直接删 schema 的 `subagentCallable` strip，不做迁移逻辑。用户已确认。
