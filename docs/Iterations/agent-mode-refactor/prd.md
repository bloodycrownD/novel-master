---
date: 2026-08-07
dependency: []
---

# Agent Mode 重构：从全局名单到 mode 字段

## 背景

现在的子代理（subagent）能力是用一张「全局子智能体名单」来驱动的——用户得单独进一个叫「子智能体名单」的配置页，把 agent 的名字勾选进名单，主代理装配 `task` 工具时再去读这张名单决定能调谁。这套方案跑起来之后暴露了几个互相纠缠的问题，集中在「工具不显示」「配置不直观」「数据容易悬空」这三件事上。

**第一个痛点是 `task` 工具会凭空消失。** `run-agent-turn.ts` 在装配每个回合的工具时，会先读名单，如果名单里一个可调 agent 都没有，就干脆不注册 `task` 工具（L384-386 的 `if (subagentCallableAgents.length > 0)`）。结果就是用户没配过名单时，主代理压根看不到 `task` 工具，自然也看不到那句介绍「你可以调用的 subagent 如下……」的文案——这正是用户反馈的「task 工具没注册、文案不显示」的根因。工具的可见性被绑死在一份可能为空的外部名单上，这个耦合本身就挺别扭的。

**第二个痛点是名单是一份「悬空指针温床」。** 名单里存的是 agent 的 `name`（字符串），而 agent 是可以被改名、删除的。一旦用户把名单里的 agent 改名或删掉，名单里就留下一个指向虚无的旧名字，`run-agent-turn` 装配期 `defByName.get(name)` 拿不到定义就静默过滤掉，表现就是「我明明开过这个子代理，怎么突然不能调了」。要根治就得让「能不能被当子代理调」这个属性跟着 agent 自己走，而不是活在另一份独立的名册里。

**第三个痛点是配置入口分散、不直观。** 现在移动端有 `SubagentRosterScreen`、桌面端有 `SubagentRosterView`，是一个和「智能体配置」同级的独立页面。用户想开某个 agent 的子代理能力，得离开 agent 编辑页、另起一页去勾选，认知成本高。而且 agent 编辑表单里早就把废弃的 `subagentCallable` 开关删掉了，结果「这个 agent 能不能当子代理」这件事在编辑页里完全无处可设，只能去那个独立名单页——这对用户来说是反直觉的。

**第四个痛点是内置 `general` 的兜底逻辑撒在三个地方。** `general` 是出厂的虚拟子代理（`DEFAULT_SUBAGENT_DEFINITION`），它的合并发生在 `AgentRegistryService.list()`（DB 没有就补一个），装配期 `run-agent-turn` 又 `subagentNameSet.add("general")` 兜底一次，`runChildAgent` 里再来一次。同一个「general 永远可用」的语义被重复实现，后面要改行为很容易漏掉其中一处。

参照 opencode 的做法，这些问题可以用一个很小的设计改动一起解决：给每个 agent 加一个 `mode` 字段，让它自己声明「我是主代理 / 子代理 / 都行」，再把 `task` 工具改成始终注册的内置工具。这份 PRD 就是把这次重构的需求讲清楚。

## 目标用户

- **普通用户**：希望开箱即用——装好就能在主对话里看到 `task` 工具、能调内置 `general` 子代理，不用先去翻配置页。
- **重度定制用户**：希望一眼看清自己每个 agent 的角色（能不能被当子代理调），并且在 agent 编辑页里就地切换，不用跨页维护一份名单。

## 场景

### 场景 1：开箱即用的子代理

新用户没配过任何 agent，直接进主对话。因为内置 `general` 的 `mode` 是 `subagent`，`task` 工具始终注册，所以用户立刻能看到 `task` 工具和它的说明文案，主代理也能马上派 `general` 去干活。整个流程不需要用户先去「子智能体名单」页勾选任何东西——因为那个页面压根就不存在了。

### 场景 2：在 agent 编辑页就地切换角色

用户新建或编辑一个 agent（比如叫 `researcher`），在编辑表单里直接把它的 `mode` 从默认的 `all` 切成 `subagent`，保存。下次主代理装配工具时，`task` 工具的说明文案里就会自动出现 `researcher` 的名字和描述。反过来把 `mode` 切回 `primary`，它就从子代理候选里消失、只能当主代理用。整个操作都在 agent 编辑页内完成，不再有独立的名单页。

### 场景 3：改名 / 删除不再悬空

用户把 `researcher` 改名成 `lore-keeper`，因为「能不能当子代理」是 agent 自身的 `mode` 属性跟着实体走，所以新名字立刻生效，不会有旧名字残留在某份外部名单里。删除一个 agent 同理——实体没了，它自然就不在候选里，不存在清名单的收尾工作。

### 场景 4：CLI bundle 导入导出兼容

用户用 `nm agent import / export` 倒腾 agent 配置。导入旧 bundle（带废弃的 `subagentCallable: true`）时，schema 预处理把它迁移成等价的 `mode: "subagent"`，不报错也不丢语义；导出新 bundle 时写出 `mode` 字段。CLI 里不再需要单独的子代理名单命令。

## 功能需求

### FR-1：AgentDefinition 增加 `mode` 字段

在 `AgentDefinition`（`packages/core/src/domain/agent/model/agent-definition.ts`）上新增只读字段 `mode`，类型为 `"primary" | "subagent" | "all"`，语义沿用 opencode：

- `primary`：只能作为主代理使用，不出现在 `task` 工具的子代理候选里。
- `subagent`：只能被 `task` 工具调用，不能被选为当前会话的主代理。
- `all`：既能当主代理，也能当子代理。**用户自定义 agent 的默认值。**

内置虚拟 `general` 的 `mode` 固定为 `"subagent"`（见 FR-5）。`mode` 缺省时按 `"all"` 处理（兼容无该字段的旧数据）。

### FR-2：wire schema 同步 `mode` 并迁移旧字段

`agent-definition.schema.ts` 与 CLI 的 `agents-bundle.schema.ts` 都要：

- 把现在的 `subagentCallable` silent-strip 预处理，改成「迁移」语义：遇到 `subagentCallable: true` 就等价转成 `mode: "subagent"`，其余值按 `mode` 缺省处理。
- 在 strict 文档 schema 里正式收下 `mode: z.enum(["primary","subagent","all"]).optional()`，`documentToDefinition` / `definitionToDocument` 双向都要带上。
- `schemaVersion` 仍锁死 `1`（加可选字段不破坏版本），但在 schema 注释里写明 `mode` 是本次新增。

### FR-3：`task` 工具改为始终注册的内置工具

把 `task` 从「装配期条件注册」改成「始终注册的内置工具」：

- `registerBuiltinTools`（`register-builtin-tools.ts`）里直接注册 `task`，不再依赖外部传进来的 agent 列表。
- `Tool.description` 因为是静态字符串，动态的子代理候选列表改用**运行时拼接**：参照 opencode 的 `describeTask`，在工具实际生效时（装配期或工具描述被读取时）从 `agentRegistry.list()` 过滤出 `mode !== "primary"` 的 agent，拼成「你可以调用的 subagent 如下：name：描述」那段文案。
- 这样即便用户一个子代理都没配，`task` 工具也始终可见（至少有内置 `general`），彻底解决「工具凭空消失、文案不显示」的问题。
- `run-agent-turn.ts` 和 `runChildAgent` 里读 `getSubagentNames` 的那段逻辑全部删掉，改成 `agentRegistry.list().filter(d => d.mode !== "primary")`。
- 子代理候选里排除当前 agent 自身（防自递归）这条规则保留。

### FR-4：移除全局子智能体名单（配置 + 持久化 + IPC + 导航 + UI）

整条「全局名单」链路要连根拔起，因为它的职责已经被 `mode` 字段取代：

- **持久化端口**：从 `PersistentState`（`persistent-state.port.ts`）删掉 `getSubagentNames / setSubagentNames / resetSubagentNames` 三个方法，以及实现层（`persistent-state.service.ts`）和 KKV key 定义（`workspace-state-keys.ts` 里的 `subagentNames`）。现有数据库里残留的 `subagentNames` key 不做主动清理（反正没人读了），但要在 PRD 里记一笔。
- **桌面 IPC**：删掉 `apps/desktop/src/main/ipc/handlers/subagent-names.ts` 及其注册，删掉 `invoke-registry.ts` / `client.ts` 里的 `ipcSubagentNamesGet/Set`、`IPC_CHANNELS.SUBAGENT_NAMES_GET/SET`、`SubagentNamesSetRequest` 类型。
- **桌面 UI**：删掉 `SubagentRosterView.tsx`、`settings-nav.ts` 里的 `subagentRoster` 导航项、`SETTINGS_TOP_LEVEL` 对应条目。
- **移动端 UI**：删掉 `SubagentRosterScreen.tsx`，移除 `RootNavigator` / 导航 types / header-config 里的对应路由。
- **task 工具的 `subagentCallable === true` 校验**：`subagent-tool.ts` 里 run 时的查找从「按名单 + callable 标志」改成「按 `mode !== "primary"`」，文件头注释里那句过时的 `subagentCallable === true` 也一并改掉。

### FR-5：内置 `general` 统一为 `mode: "subagent"`，收敛兜底逻辑

`DEFAULT_SUBAGENT_DEFINITION`（`default-subagent-definition.ts`）显式带上 `mode: "subagent"`。`AgentRegistryService.list()` 合并虚拟 `general` 的逻辑保留（DB 同名优先），但装配期和 `runChildAgent` 里那两处 `add("general")` 兜底删掉——因为 `task` 工具现在直接从 `list()` 过滤 `mode !== "primary"`，`general` 天然就在里面，不需要再手动塞名字。`general` 不可删除、不可关闭的语义保持不变。

### FR-6：agent 编辑表单增加 `mode` 选择器（移动端 + 桌面端）

在 `AgentEditorForm`（移动端）和对应的桌面编辑视图里，加一个 `mode` 选择控件，三个选项：「主代理 / 子代理 / 都可以」，对应 `primary / subagent / all`。新建 agent 默认选「都可以」。内置 `general` 因为是虚拟 agent 不进编辑页，所以它的 `mode` 用户改不到，保持 `subagent`。`mode === "subagent"` 的 agent 不应出现在「选择当前会话主代理」的列表里（这条在验收里覆盖）。

### FR-7：测试与文档同步

- 更新 `run-agent-turn*.test.ts` 的 mock：去掉 `getSubagentNames`，改成 mock `agentRegistry.list()` 返回带 `mode` 的定义。
- 更新 `subagent-tool.test.ts`：候选集合改成按 `mode` 过滤。
- 更新 `agent-registry-list-seed.test.ts`：断言 `general` 的 `mode === "subagent"`。
- 更新 CLI bundle schema 测试（`agents-bundle.test.ts`、`agent-registry-e2e.test.ts`）：把「subagentCallable 被 silent strip」改成「迁移成 `mode: "subagent"`」。
- 删除 `agent-tool-policy-task-whitelist.test.ts` 里跟名单相关的断言（`task` 不进用户 `tools.allow/deny` 这条锁死规则本身保留，只是不再依赖名单）。
- 更新 `docs/Iterations/agent-subagent/cli-acceptance.md` 里关于 `subagentCallable` 的描述。

## 验收标准

- **AC-1（工具始终可见）**：在一个没有任何用户自定义 agent 的全新工作区里启动主对话，`task` 工具出现在已注册工具列表中，其描述文案包含 `general` 及其描述；不报「task 未装配」之类错误。
- **AC-2（mode 驱动候选）**：新建一个 `mode: "subagent"` 的 agent，`task` 工具描述里出现它；把它改成 `primary`，描述里消失；改成 `all`，出现。内置 `general` 始终在候选里。
- **AC-3（自递归防护）**：当前主代理自身不出现在自己的 `task` 候选里。
- **AC-4（递归上限）**：`depth >= 2`（孙 agent）调用 `task` 仍被拒（registry 层 deny + 工具内双保险都在）。
- **AC-5（名单链路彻底移除）**：全局搜索 `getSubagentNames / setSubagentNames / resetSubagentNames / SubagentRoster / ipcSubagentNames / SUBAGENT_NAMES_` 零命中（dist 产物与 worktree 不计）；持久化端口不再有这三个方法签名。
- **AC-6（旧数据兼容）**：导入一个带 `subagentCallable: true` 的旧 agents bundle，导入后该 agent 的 `mode` 为 `subagent`；导入不带 `mode` 也不带 `subagentCallable` 的 agent，`mode` 默认为 `all`；两种情况都不报 schema 错误。
- **AC-7（主代理选择过滤）**：`mode === "subagent"` 的 agent 不出现在「选择当前会话主代理」的 UI 列表里。
- **AC-8（三端一致）**：移动端、桌面端、CLI 三处的 `mode` 语义一致；agent 编辑表单的 mode 选择器在移动端和桌面端行为一致。
- **AC-9（测试通过）**：FR-7 列出的测试文件全部更新并通过；`task` 工具仍不进用户可配的 `tools.allow/deny`。

## 非目标

- 不改递归深度上限（仍是主→子→孙，孙不能再派）。
- 不改 `parent_session_id` 级联（已经完整打通，不动）。
- 不改子代理的 VFS 视图策略（仍是与父会话同一工作区视图）。
- 不改 `task` 工具的回流协议（仍是末条 assistant text 回流 + `subagentSessionId` 供 UI 跳转）。
- 不主动清理数据库里残留的 `subagentNames` KKV key（没人读即可，避免写迁移脚本）。
- 不引入 opencode 的 `build/plan/compaction/title/summary` 这些 `primary` 专属角色语义——本项目当前没有这类系统主代理概念，`mode` 只用来区分「能不能被 task 调」。
