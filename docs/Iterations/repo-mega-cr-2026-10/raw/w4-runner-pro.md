---
zone: w4-runner-pro
agent: 检察官（对抗对 · 猎杀问题向）
files_scanned: 19
scope: packages/core/src/service/agent/**（全部 19 个 .ts 文件，逐行读完）
independence: 未读取 docs/Iterations/repo-mega-cr-2026-10/raw/ 下任何文件
decision_awareness: 已读 docs/apm/RULE.md 全文 + docs/Iterations/ 相关既有迭代档；拍板项（停止即时生效的入口注册 / 回合快照 / controller 幂等反注册 / streamRegistry 句柄所有权 / 回合快照预取）一律标 intentional
---

## 摘要

`service/agent` 是 agent 回合的**编排层**：外层 `runAgentTurn`（前奏：backfill → 解析 agent → 校验 → append 用户消息 → capture checkpoint → 校验定义 → 装配工具上下文）把一次「发送」交给内层 `DefaultAgentRunner`（每 step：列消息 → 拼常驻工作区 → prepare → 压缩评估 → 协议归一 → 请求 → doom-loop 守卫 → 并行工具 → checkpoint → 落 tool_results）。旁挂四张进程内表：abort registry（停止入口）、stream registry（流式 partial）、agent registry（定义 CRUD）、turn-snapshot 宏。另有 `runChildAgent` 递归装配子代理。全区约 3.6k 行。

## 职责与边界

- **不负责** prompt 拼装细节（在 `service/prompt`）、提示词渲染（在 `domain/chat/logic`）、协议适配（在 `infra/llm-protocol`）、工具实现（在 `domain/tool/builtin`）。
- **负责** 回合生命周期、事件收口、abort 传播、工具上下文装配、压缩编排接线、token 占用锚点。
- **边界模糊点**：`resolve-agent-for-project.ts` / `agent-run-shared.ts` 是「历史遗留的解析层」，`assemble-agent-runner-deps.ts` 同时服务对话轨与一条**已不存在的**事件轨（见 F-w4-runner-pro-08）。

## 对外接口（`packages/core/src/public/agent.ts` 全量转出）

| 符号 | 定义位置 |
|---|---|
| `runAgentTurn` / `AgentTurnError` / `AgentTurnRuntimePort` / `RunAgentTurnOptions` | `logic/run-agent-turn.ts:319` / `:167` / `:96` / `:251` |
| `createAgentRunner` / `CreateAgentRunnerDeps` | `create-agent-runner.ts:68` / `:28` |
| `createAgentAbortRegistry` / `createAgentStreamRegistry` | `create-agent-abort-registry.ts:16` / `create-agent-stream-registry.ts:23` |
| `createAgentRegistryService` / `DefaultAgentRegistryService` | `create-agent-registry-service.ts:19` / `impl/agent-registry.service.ts:61` |
| `ChatAgentSession` / `InMemoryAgentSession` | `impl/chat-agent-session.ts:22` / domain |
| `resolveAgentForProject` / `resolveCurrentAgentDefinition` / `resolveApplicationModelIdForRun` | `logic/resolve-agent-for-project.ts:45` / `logic/agent-run-shared.ts:74` / `:101` |
| `PENDING_RUN_ID` + 5 个生命周期纯函数 | `logic/agent-run-lifecycle-helpers.ts:21-77` |
| `assembleAgentRunnerDeps` / `DEFAULT_AGENT_MAX_STEPS` / `DEFAULT_SUBAGENT_DEFINITION` | `logic/assemble-agent-runner-deps.ts:47` / `logic/agent-run-max-steps.ts:8` / `default-subagent-definition.ts:19` |

消费方（实测 grep）：desktop `main/services/agent-run.service.ts:65` + `main/ipc/handlers/agent.ts:431`；mobile `services/agent-run.service.ts:65` + `session-stream-unit-manager.service.ts:1138`；cli `agent/commands.ts:212`。

## 数据访问

| 数据 | 触点 | file:line |
|---|---|---|
| `chat_message`（append / list / delete） | 前奏 append 用户消息、runner 落 assistant/tool_results | `run-agent-turn.ts:724`、`:742`；`agent-runner.ts:690`、`:745`、`:932`、`:894` |
| 消息 checkpoint（capture / release / backfill） | 前奏 + 每 mutating step | `run-agent-turn.ts:612`、`:755`、`:765`；`agent-runner.ts:873` |
| session KKV `nm-*` prompt token 占用 | 每 step 锚点 + run 收尾 | `agent-runner.ts:374`、`:987`、`:948`、`:995` |
| `workplace_dir_rule`（经 toolCtx.workplace） | 工具侧补默认规则 | `run-agent-turn.ts:855`、`:1205` |
| VFS（session scope） | annotate 行号反查、工具读写 | `run-agent-turn.ts:675`、`:810`、`:1180` |
| 技能 meta 域（effectiveSkills 预算） | 前奏装配期 | `run-agent-turn.ts:192`（主）/ `:1154`（子） |
| `llm_saved_model` / provider 表 | 每 run 一次 + **每 step 一次** | `agent-runner.ts:301`、`:561` |
| 全量会话正文（gemini function-name 回查） | 每 step | `agent-runner.ts:587-588` |

## 依赖关系

- **入**：domain/agent（定义校验、doom-loop、tool policy）、domain/tool（ToolRegistry / ToolRunner / 内置工具注册）、service/prompt、service/workplace、service/skills、service/chat（messages / transcript effects）、service/message-checkpoint、service/session-kkv、infra/llm-protocol、infra/tokenizer、infra/events。
- **出（被谁消费）**：`public/agent.ts` → desktop renderer/main、mobile services、cli。
- **区内依赖**：`run-agent-turn.ts` → `create-agent-runner` → `impl/agent-runner` → `assemble-agent-runner-deps` → `run-agent-turn`（**成环**，靠 `public/agent.ts` 收口；`assemble-agent-runner-deps.ts:13` 还反向 type-import 了 `ChatAgentSession`，把 service 层的会话适配器绑进装配器签名）。

## 发现清单

### F-w4-runner-pro-01 | P2 | `logic/run-agent-turn.ts:489,609,618,632,646,720,754,783,955,1011`

```ts
let stage = "start";
...
stage = "runner.run";     // :955
runnerEntered = true;     // :973
...
if (runnerEntered) { options?.onRunFailed?.({ stage, ... }) }   // :1009-1011
```

**描述**：`stage` 唯一的读取点是 catch 里的 `onRunFailed`（`:1011`），而该读取被 `if (runnerEntered)` 包住；`runnerEntered` 只在 `:973` 置真，而 `stage` 在 `:955` 已被写成 `"runner.run"`，其间无任何再赋值。⇒ **`onRunFailed.stage` 恒为 `"runner.run"`**。

**后果链**：前奏的 7 个 stage 标签（`backfill-baseline-checkpoints` / `resolve-agent`（两处，`:618` 与 `:646` 同名不同义）/ `resume-check-last-message` / `append-user-message` / `capture-baseline-checkpoint` / `validate-agent-definition`）全是**死写**；desktop `agent-run.service.ts:97-99` 与 mobile `agent-run.service.ts:83-84` 都把 `ctx.stage` 打进错误日志——线上 agent 失败日志里这个字段永远没有诊断价值，前奏期故障（用户最关心的那类）与 runner 期故障在日志上完全同形。

**建议**：要么把 `onRunFailed` 拆成「前奏失败 / runner 失败」两个入口（各自带真实 stage），要么在前奏 catch 里也回调（改契约）。至少先删掉误导性的 `resolve-agent` 重复标签。

**置信**：confirmed

---

### F-w4-runner-pro-02 | P2 | `impl/agent-runner.ts:341-343`（+ 10 处调用点 `:400,407,437,457,524,646,683,803,891,917`）

```ts
const handleAbort = async (_branch: string): Promise<void> => {
  stopReason = "cancelled";
};
```

**描述**：两个坏味道叠在一起。① `async` 函数体内**没有任何 await**，却被 10 处 `await handleAbort("...")` 逐一 await——每次命中多插一个微任务让出。② 参数 `_branch` 全部 10 个调用点都传了精心命名的分支标签（`loop_start` / `after_session_list` / `after_assemble_workplace` / `after_prepare_user_messages` / `after_compaction_eval` / `model_request_catch` / `post_model` / `before_tool_run` / `after_tool_checkpoint` / `catch_abort`），**一个都没被记录**。

**后果链**：这套标签体系（配合 2026-09-30 那轮「停止不即时生效」排查新增的 6 个检查点）看上去是停灵诊断的骨架，实际落进黑洞。线上出现「点了停止但没反应」时，日志里**无法区分**是卡在 assemble、prepare 还是 compaction 评估——而这正是 RULE 与迭代文档反复记载的病灶类型。同时每 step 的 6 个 abort 检查点各多一个微任务让出。

**建议**：改成同步 `const markAborted = (branch: string) => { stopReason = "cancelled"; abortBranch = branch; }`，并把 `abortBranch` 挂进 FINISHED 事件 payload 或至少 `console.debug` 一次；10 处 `await` 全部去掉。

**置信**：confirmed

---

### F-w4-runner-pro-03 | P2 | `impl/agent-runner.ts:403,527,548`

```ts
let stepCompactionEmitted = false;                       // :403 循环内声明
...
if (shouldCompact && !stepCompactionEmitted) {           // :527
```

**描述**：`stepCompactionEmitted` 在 **for 循环体内**声明（每 step 重置为 false），全函数只有两处触点：`:527` 读、`:548` 写。读发生在写之前、且同一 step 内没有任何其它路径能置真。⇒ `!stepCompactionEmitted` **恒为 true**，这个防重复守卫是纯装饰。

**后果链**：从代码形状看它像「一次 run 内只压一次」的保护，实际不提供任何保护。真正的 run 级语义要靠把变量提到循环外来实现；一旦有人照着这个假守卫的意图去改（比如再加一处压缩入口），会误以为已有去重。

**建议**：删掉该变量与 `&& !stepCompactionEmitted`（当前 `getHideStartDepth + runCompaction` 每 step 至多执行一次的保证来自它就在 if 里）；若确实需要 run 级去重，提到循环外并按 sessionId 记。

**置信**：confirmed

---

### F-w4-runner-pro-04 | P2 | `impl/agent-runner.ts:301` vs `:561-565`

```ts
// 循环外，run 一次：
const savedModelForAppend = await this.deps.savedModels.findById(options.savedModelId);   // :301
// 循环内，每 step：
const protocol = await inferLlmProtocolFromSavedModelId(options.savedModelId, this.deps.savedModels, this.deps.providers);  // :561
```

**描述**：`inferLlmProtocolFromSavedModelId` 内部第一件事就是 `savedModels.findById(savedModelId.trim())`，命中后再按需 `providers.findById`。这些入参在整个 run 内**恒定不变**，而 `:301` 已经把同一个 `savedModel` 查出来缓存成 `savedModelForAppend` 了。同一个 step 循环里，`tools`（`:273`）与 `skillsIndex`（`:277`）都被正确提升到循环外并注明「每 run 一次」，唯独协议推断留在循环内。

**后果链**：`maxSteps` 默认 20（`logic/agent-run-max-steps.ts:8`），多步 run 每步白付 1~2 次 DB 查询（saved_model + provider），全部走 `packages/core` 的 tdbc 驱动。20 步 run ≈ 20~40 次多余查询，且都在首字延迟的关键路径上。

**建议**：提到循环外与 `tools`/`skillsIndex` 并列；更进一步可直接由 `savedModelForAppend.providerId` + `providers` 推出 protocol，命中内置 UUID 表时零 IO。

**置信**：confirmed

---

### F-w4-runner-pro-05 | P2 | `impl/agent-runner.ts:713-725`

```ts
if (publishRunLifecycle) {
  bus.publish(EVENT_AGENT_STEP_COMMITTED, { sessionId, projectId, runId, phase: "assistant" });
  this.deps.streamRegistry?.reset(sessionId);   // :724  ← 状态维护被事件开关裹住
}
```

**描述**：`streamRegistry.reset` 是**数据面**操作（清 partial 累积），却被塞进「是否发布生命周期事件」的分支里。同一 step 的另一半——`streamRegistry.append`——的门槛却是另一个条件（`options.stream && publishRunLifecycle`，`:597`）。三处条件耦合在两个不同语义上，形状上互相矛盾。

**后果链**：`publishRunLifecycle: false` + `stream: true` 的组合（`agent.port.ts:26` 明文允许）会让 `wrapStreamForBus` 不装配（`:597` 走 `options.onStream` 分支）→ append 不发生；但只要哪天有人放开 `append` 的门槛（比如为「非流式也记 partial」），reset 仍被锁在事件开关里，partial 会跨 step 无限累积。当前无生产调用方传 `publishRunLifecycle: false`，属潜伏缺陷。

**建议**：把 `reset` 移出 `if (publishRunLifecycle)`，与 `append` 共用同一个 `streamActive = options.stream` 判据。

**置信**：confirmed（当前形态） / suspected（触发条件）

---

### F-w4-runner-pro-06 | P2 | `impl/agent-runner.ts:909-912` + `:248`

```ts
if (step + 1 >= maxSteps) {
  stopReason = "max_steps";
  break;
}
```

**描述**：`stopReason` 在 `:248` 已初始化为 `"max_steps"`；此处 `break` 之后紧接 `}` 关闭 for 循环体，`for (let step = 0; step < maxSteps; step++)`（`:398`）在 `step+1 === maxSteps` 时**本来就会自然终止**。⇒ 整个 if 是「赋一个已是当前值的常量 + 跳出一个本来也会结束的循环」。

**后果链**：读者会以为 max_steps 分支做了额外收尾（实际没有），改动时容易在它周围堆逻辑而误以为受保护。

**建议**：删除；如需表达「工具轮之后不再请求下一轮」，改在 `:898` 之后加注释说明「for 条件自然收敛」。

**置信**：confirmed

---

### F-w4-runner-pro-07 | P2 | `impl/agent-runner.ts:690` → `:789-800` → `:930`

```ts
assertNoDoomLoopInBlocks(result.blocks, { threshold: doomLoopThreshold });   // :789
```

**描述**：doom-loop 两道守卫（`:789` 单轮内、`:798` 跨轮 A-B-A-B）抛错的位置在 **assistant 消息已 append 之后、tool_results 落库之前**。此时 `assistantAppendedInRun === true`，catch 里的失败消息落库条件 `persistMessages && !assistantAppendedInRun`（`:930`）不成立 ⇒ **不落任何错误消息**，直接发 FAILED 再 rethrow。

**后果链**： doom loop 是设计上可预期的失败（用户可见的「模型在原地打转」），但转录里留下的是一条**只有 tool_use、没有 tool_result 的悬空 assistant**，且没有任何文字说明这次 run 失败了。下一轮 LLM 侧靠 `normalizeOrphanToolResultsForLlm`（`:580`）兜住合成，UI 侧则是一个永远不收敛的工具调用 chip + 一条 toast。这是本区唯一一处「失败不留痕」的路径。

**建议**：给 doom-loop 单独一条 catch 分支（或在 `:789` 之前先判 `assertNo*` 是否会抛，抛则先落错误消息再抛），保证可预期的策略性失败也有可回查的转录痕迹。

**置信**：confirmed

---

### F-w4-runner-pro-08 | P2 | `impl/agent-runner.ts:844-845` + `:899-907`

```ts
const vfsMutated = anyToolUseMutatesWorkspace(toolUses);   // :844 按「请求」判定
vfsMutatedInRun = vfsMutatedInRun || vfsMutated;
```

**描述**：`vfsMutated` 依据 `toolUses`（模型**请求**的工具调用列表）判定，而不是 `outcomes`（**实际执行结果**）。三类假阳性和一类假阴性：
- degraded 调用（`:815-826`，参数 JSON 非法、**根本没跑**）只要名字是 `write`/`edit` 就计突变；
- 工具跑失败（ToolError / VFS 冲突）同样计突变；
- `fs` 命令在 `:866` 的 checkpoint 门与 `:965` 的 FINISHED 门都靠它（`vfsMutated && persistMessages && assistantMessage != null`）。

**后果链**：desktop `ShellNavProvider.tsx:341` 按 `p.vfsMutated !== true` 决定是否**整棵工作区树 reload**；一次参数写错的 `write` 就会触发全树刷新。`messageCheckpoint.capture`（`:873`）也会为一个没成功的写拍一次 checkpoint（多一版快照，undo 点变密）。假阴性方向没有（判定是保守的），所以是性能/噪声问题不是正确性问题。

**建议**：改成按 outcomes 判定——`outcomes[i].ok === true && anyToolUseMutatesWorkspace([toolUses[i]])`；degraded 项天然 `ok:false` 被排除。

**置信**：confirmed

---

### F-w4-runner-pro-09 | P2 | `logic/run-agent-turn.ts:1119` / `:1319`（对比 `:466-477`）

```ts
  try {
    runtime.abortRegistry?.register(childSessionId, childController);   // :1120
    ...
  } finally {                                                            // :1319 —— 只有 finally，没有 catch
```

**描述**：主 run 有一整套终态兜底：`publishPreludeRunFailed`（`:466-477`）+ `runnerEmittedTerminal` 观测窗（`:519-532`），专门解决「前奏抛错 → 双端 refcount 永久泄漏 / uiRunning 卡死」（`:453-465` 注释写得很清楚）。**`runChildAgent` 侧完全没有对称实现**：它的 try 只有 finally（清理 controller/partial），没有 catch（补发 FAILED）。代码里也没有 `markRunnerTerminal` 等价物。

**后果链**：子 run 的前奏段有 4 处真 IO —— `agentRegistry.list()`（`:1144`）、`assembleSkillsToolContext`→`effectiveSkills`（`:1154`）、`session.append("user", prompt)`（`:1194`）、`preferences.getSubagentStreamEnabled()`（`:1298`，非 `PreferencesError` 时 `:1300` 直接重抛）。任一处抛错 ⇒ 该 childSessionId **一条终态事件都不发**（STARTED 也没发过，因为 STARTED 在 `agent-runner` 内）。而 `createChildSession` 早已 publish 过 `EVENT_SUBAGENT_CHILD_SESSION_CREATED`（`:1229`），mobile 子会话页据此建单元 ⇒ 单元永远停在 starting/running，只有 task 工具把错误回流给父模型、父 run 继续跑。`:1113-1115` 的注释只承诺了「finally 包络住 await 抛错」，没承诺终态事件——这正是主 run 在 r3-run-1/r3-run-3 反复修的两件事。

**建议**：给 `runChildAgent` 的 try 加 catch，`publishPreludeRunFailed(runtime, childScope, error)` 后 rethrow（`publishPreludeRunFailed` 已经是 scope 化的，直接复用）。

**置信**：confirmed（代码形状） / suspected（UI 挂起后果，跨 zone 未验证）

---

### F-w4-runner-pro-10 | P2 | `logic/run-agent-turn.ts:655-937`（整段）

```ts
  await options?.onAfterResolveModel?.({   // :655 缩进 2
  ...
  const runner = createAgentRunner(         // :929 缩进 2
  ...
  );                                        // :937 缩进 2
    // 检查点②：...                        // :939 缩进 4
```

**描述**：`runAgentTurnWithController` 的收口 `try`（`:585`）体在 `:586-653` 是 4 空格缩进，从 `:655` 突然掉到 2 空格，直到 `:937` 才在 `:939` 回到 4 空格。实测（PowerShell 逐行量缩进）：`:650`=4、`:655`=2、`:937`=2、`:939`=4。中间约 **283 行**整体少缩进一级。

**后果链**：纯格式缺陷，但危害实打实——`try` 体被切成两段视觉块，review 时极易把 `:655-937` 误读成已经出了 try/catch 作用域（`:993` 的 `catch` 与 `:1019` 的 `finally` 归属变得难以目测），而这一段恰恰是 r3-run-1/r3-run-3/r3-run-4 四轮打补丁的战场（检查点①②③④ 全在里面）。也是后续任何 diff 的噪声源。

**建议**：整段补一级缩进，一次性提交、单独成 commit（避免与逻辑改动混在一起）。

**置信**：confirmed

---

### F-w4-runner-pro-11 | P2 | `logic/assemble-agent-runner-deps.ts:19,32-37,50-56`

```ts
/** AgentTurnRuntimePort 或 EventActionDeps 的 runtime 切片（modelRequests、eventBus 等）。 */   // :19
    readonly savedModels?: SavedModelRepository;   // :35
    readonly providers?: Pick<ProviderRepository, "findById">;   // :37
...
const savedModels = input.runtime.savedModelRepo ?? input.runtime.savedModels;
...
    savedModels: savedModels as SavedModelRepository,   // :56
```

**描述**三重问题：
1. `:19` 注释引用的 `EventActionDeps` **全仓不存在**（`git grep EventActionDeps` 只命中本行与 `docs/Iterations/implementation-simplification/spec.md:198`）。
2. `savedModels` / `providers` 两个别名分支**无任何生产调用方**：唯一两个调用点 `run-agent-turn.ts:930` 与 `:1281` 传的都是 `AgentTurnRuntimePort`，其字段名是 `savedModelRepo` / `providerRepo`。`?? ` 右侧恒为 undefined。
3. `:56` 的 `as SavedModelRepository` 是**掩盖 undefined 的类型断言**：`savedModelRepo` 在 `AssembleAgentRunnerDepsInput` 里是**可选**的（`:33`），两者都没给时 `savedModels` 运行期就是 `undefined`，而 `DefaultAgentRunner` 在 `impl/agent-runner.ts:301` 直接 `this.deps.savedModels.findById(...)` ⇒ TypeError，堆栈指向 runner 内部而不是装配点。

**后果链**：装配器对外是 public 导出（`public/agent.ts:83`），外部调用方按类型传参会得到「编译通过、运行期崩在别处」的结果；「事件轨」这条注释会让人以为还有第二条装配路径需要维护（实际已无）。

**建议**：删掉 `EventActionDeps` 引用与两个别名字段；`savedModelRepo` 改必填，去掉 `as`（让类型系统兜住）；若要保留事件轨口子，用显式判空 `if (savedModels == null) throw new Error(...)`。

**置信**：confirmed

---

### F-w4-runner-pro-12 | P2 | `logic/resolve-agent-for-project.ts:50-51` + `logic/run-agent-turn.ts:123`

```ts
export async function resolveAgentForProject(runtime, projectId: string, sessionId: string) {
  void projectId;          // :50
  void runtime.projects;   // :51
```

**描述**：函数把两个入参显式 `void` 掉。但 `AgentTurnRuntimePort`（`run-agent-turn.ts:123`）仍把 `projects: ProjectService` 列为**必填**成员，desktop / mobile / cli 三个 runtime 都被迫实现一个本模块从不读的依赖。返回值 `ResolvedAgentForProject` 的 `source: "session"`（`:24`）是单值判别式（项目智能体下线前的遗留），`run-agent-turn.ts:619-623` 也只取 `.definition`，`agentId` 字段被丢弃。

**后果链**：`projects` 成为一个「必须实现但没人用」的必填依赖，第三方 runtime 作者会为一个空契约写代码；`source` 单值判别式会误导后来者以为还有第二种来源分支。

**建议**：`resolveAgentForProject` 签名去掉 `projectId`（同步改 `run-agent-turn.ts:621` 调用点）；`ResolvedAgentForProject` 收成 `{ agentId, definition }`；`AgentTurnRuntimePort.projects` 若无其它消费方则移除（desktop `handlers/agent.ts:41` 附近另有独立 import，需一并核）。

**置信**：confirmed

---

### F-w4-runner-pro-13 | P2 | `agent-stream-registry.port.ts:76-82` vs `create-agent-stream-registry.ts:19-20,65-79`

```ts
 * - `get` 返回只读快照（读频低，物化点收敛到这里：join 一次）；当前为
 *   内部/测试用途（无生产调用方），保留以维持对称读口（core-transport Q3）；
```

**描述**：port 头注释（`:8-10`）把整个 registry 的存在意义写成「子会话流式输出期间用户晚于 run 启动才进入子会话页面…UI 进入时可以直接查询已累积的全部 partial，不依赖订阅时机」。实测 grep：
- `AgentStreamPartial` 全仓只出现在 port、工厂、`public/agent.ts:47` 三处；
- apps 侧 `streamRegistry` 只有 `createAgentStreamRegistry()` 的构造（`create-desktop-runtime.ts:130`、`create-mobile-runtime.ts:94`、cli `runtime.ts:234`）与类型声明（`types.ts:98` / `:97`），**没有任何 `.get(` / `.has(` 调用**；
- mobile 的 partial 走自己的 `SessionStreamUnit.partialTextSegments`（`apps/mobile/src/services/session-stream-unit.ts:334`），从 bus delta 自建；desktop 根本没有对应读取。

**后果链**：`register` / `append` / `reset` / `unregister` 四张表在**生产环境是只写不读的黑洞**——`append` 在每个 text-delta / thinking-delta 上 `push` 一个字符串（`create-agent-stream-registry.ts:58-63`），一路累积到 step 结束再被 `reset` 清空，全程无人 `join`。也就是每个 run 的每个 token 都在做无用功（数组 push + 引用计数），换来的语义承诺没有任何兑付方。注释里那句「无生产调用方」是实现者自己承认的。

**建议**：二选一——① 真接线（补一条 `streamRegistry.get(sessionId)` 的 IPC 读口，子会话页首屏用）；② 判定为死子系统，整块删除（port + 工厂 + `public/agent.ts:46-49` 导出 + `agent-runner.ts:603/724` 两处调用 + 三个 runtime 的构造），并同步删掉 port 头注释里那句已失效的立论。

**置信**：confirmed

---

### F-w4-runner-pro-14 | P2 | `impl/ephemeral-overlay-agent-session.ts`（全文件 91 行）+ `agent.port.ts:24`

```ts
 * Used by {@link runRunAgentAction} so event-triggered agents do not persist turns.   // :4
```

**描述**：整个 `EphemeralOverlayAgentSession` 唯一的激活条件是 `AgentRunOptions.persistMessages === false`（`impl/agent-runner.ts:228-230`）。实测 grep：生产代码里**没有任何调用方传 `persistMessages: false`**——`run-agent-turn.ts:976-986` 根本不传该字段（默认 true），`runChildAgent` 的 `:1314` 显式传 `true`。于是连带以下全是死代码：
- `EphemeralOverlayAgentSession` 整类（`list` 拼接、`append` 的 `ephemeral-${seq}` 假 id、`nextSeq = 1_000_000_000` 魔数、`truncateAfterMessage` 的三分支 overlay 截断逻辑）；
- `agent-runner.ts` 里 5 处 `persistMessages` 分支（`:366`、`:504`、`:743`、`:868`、`:930`、`:983`）；
- 类头 `{@link runRunAgentAction}` 指向的符号**全仓不存在**（只在 `docs/Iterations/**` 的历史 spec 里出现）。

**后果链**：`persistMessages` 是 `AgentRunOptions` 的公开字段（`agent.port.ts:24`），外部 runtime 作者读到注释会以为 overlay 是一等公民；实际上 91 行 overlay 逻辑 + 6 处分支没有任何运行期覆盖，测试之外不可达，且永远不会被真机路径验证到。

**建议**：确认 `event-triggered agent` 功能是否已下线。若已下线，删类 + 删 `AgentRunOptions.persistMessages` + 删 6 处分支（保留失败消息/占位消息那两处的语义需重新落到「总是落库」）；若还要保留，先补一条生产调用方并修掉失效的 `{@link}`。

**置信**：confirmed

---

### F-w4-runner-pro-15 | P2 | `domain/agent/session/agent-session.port.ts:51-60`（接口） + `impl/chat-agent-session.ts:53-59` + `impl/ephemeral-overlay-agent-session.ts:71-90`

```ts
  /** 用途：agent turn abort 时回滚到 turn 起点，避免残留 partial assistant 消息。 */
  truncateAfterMessage(afterMessageId: string | null): Promise<void>;
```

**描述**：`AgentSession` 的 4 个方法里，`list` / `append` 每次 run 都在用，但 `hideRange` / `truncateAfterMessage` **在生产代码里零调用**（实测 `git grep "\.hideRange("` 与 `.truncateAfterMessage(`：`packages/core/src` 内只有三处**实现/委托**，`impl/message-transcript-effects.service.ts` 走的是 `messages.hideRange` 而非 session 抽象；`runner` 从不调）。port 注释宣称 `truncateAfterMessage` 的用途是「agent turn abort 时回滚到 turn 起点」——而 `agent-runner.ts:682-684,729-731` 的 abort 路径明确是**保留** partial assistant（注释：「abort 时仍写入 partial assistant（用户能看到模型刚吐出的内容）」），与 port 注释的语义**正好相反**。

**后果链**：三个实现（`ChatAgentSession` / `EphemeralOverlayAgentSession` / `InMemoryAgentSession`）都被迫实现两个无人调用的方法，其中 overlay 那份还带着 22 行精心写的三分支截断逻辑。`packages/core/test/agent/agent-runner-abort-rollback.test.ts:584` 有一条**只断言方法存在性**的用例（「静态契约校验」），把死接口钉在测试里——将来想删得先改测试。

**建议**：确认 abort 回滚语义已改向「保留 partial」后，从 `AgentSession` 摘掉 `hideRange` / `truncateAfterMessage`（连带三个实现与那条存在性测试）；压缩链路已经统一走 `MessageTranscriptEffectsService`，session 抽象不需要这两个口子。

**置信**：confirmed

---

### F-w4-runner-pro-16 | P2 | `logic/run-agent-turn.ts:329-341` + `:1086-1098`

```ts
callerSignal.addEventListener("abort", () => internalController.abort(callerSignal.reason), { once: true });
// :1086-1098 同款（子 run 挂到 parentSignal）
```

**描述**：两处都在共享的 `AbortSignal` 上挂监听器，且**全程没有 `removeEventListener`**（实测 `git grep removeEventListener -- packages/core/src/service/agent` 无命中）。`{ once: true }` 只在 abort 真正发生时自清理——不 abort 就永久挂着。
- `:335` 的监听器挂在 **caller 传入的 signal** 上。若调用方复用同一个长寿命 signal（组件级 / 会话级）连续发 N 次消息，就会挂 N 个闭包。
- `:1091` 的监听器挂在 **父 run 的 `internalController.signal`** 上。父 run 存活期内每派发一个 task 子 run 就多挂一个（`maxSteps` 默认 20）。

**后果链**：内存上是闭包线性增长（每个闭包持有一个 `AbortController`）；在 Node 侧 `AbortSignal` 有 `MaxListenersExceededWarning` 阈值（10+），desktop main 跑满 10 个子 run 就开始打警告噪声。功能上无害，但属于典型的「忘了摘的监听器」债。

**建议**：`runAgentTurn` 的 `finally` 里 `callerSignal?.removeEventListener("abort", handler)`（把 handler 提成具名引用）；`runChildAgent` 的 `finally` 里对 `parentSignal` 做同样处理。

**置信**：confirmed

---

### F-w4-runner-pro-17 | P2 | `logic/run-agent-turn.ts:847-928` vs `:1196-1278`

**描述**：主 run 与 `runChildAgent` 的 `BuiltinToolContext` 装配是**逐字段复制**：`vfs` / `projectId` / `sessionId` / `listSessionMessages` / `sessionKkv` / `workplace(kind:"session")` / `skills` / `agents` / `search` / `subagent{agentRegistry,messages,sessions,createChildSession,resolveChildModelId,runChildAgent,depth,parentSignal,callableAgents}` / `allowedPaths: undefined` / `resourceQuota: undefined`——13 个字段、82 行 vs 82 行，只有 5 处**故意的**差异（`vfs` 取父 scope、`workplace` 取 `parentSessionId`、`sessionId` 取子会话、`depth`、`parentSignal`）。

**后果链**：两份代码已经出现可见漂移：`registerBuiltinTools` 的 probe 变量名一边叫 `toolProbe`（`:784`）一边叫 `baseRegistry`（`:1140`）；`resolveChildModelId` 的报错文案靠「子/孙」两个字区分（`:898` vs `:1247`）而不是靠参数；`agents` 注入的注释一边说「子/孙摘除后不注入」（`:1212`）一边说「mode==="all" 的子 agent 且 depth<2 时才可能注入」（实际语义是 `resolveAgentToolRegistry` 的 mode/depth 判定，注释不准）。任何新增 `BuiltinToolContext` 字段（例如本轮若要给工具加 `sessionKkv` 派生能力）都必须记得改两处，漏一处就是子 agent 静默缺能力。

**建议**：抽 `buildToolContext({ runtime, scope, vfsScope, session, registry, probeNames, allDefs, depth, parentSignal, savedModelId, workspaceModelId })` 一个函数，两处调用只传差异参数。

**置信**：confirmed

---

### F-w4-runner-pro-18 | P2 | `logic/run-agent-turn.ts:1144` + `:1172-1177`

```ts
const childAllDefs = await runtime.agentRegistry.list();     // :1144 全量拉 agent 定义
...
const childAgentsCtx = assembleAgentsToolContext(runtime.agentRegistry, childAllDefs, baseRegistry.list(), registry);  // :1172
```

**描述**：`runChildAgent` 无条件执行 `agentRegistry.list()`（一次拉全部 agent 定义的 IO）。但 `list()` 的两个消费方里，`assembleAgentsToolContext` 在 `registry` 不含 `agent` 工具时**立即返回 undefined**（`:231`），而 `task` 工具的子代理（`mode === "subagent"`）与孙代理（`depth >= 2`）都被 `resolveAgentToolRegistry`（`domain/agent/logic/resolve-agent-tool-registry.ts:69-73`）**强制摘除 `agent` 工具**。⇒ 对绝大多数子 run（唯一可达的 task 目标都是 subagent 或孙 agent），这次 IO 拉回来的数据只有一个消费者会立刻丢弃。

**后果链**：主 run 的检查点③注释（`:796-799`）明确把 `agentRegistry.list()` 称为「前奏尾段的第一件真 IO 活，大会话上窗口不小」并为此加了一道 abort 检查点；子 run 侧同样这次 IO 却既无检查点（`:1144` 前后只有子检查点①在它之前、②在 skills 之后）也无可省。递归派发时这次 IO 出现在**每一个** task 工具调用里，深度 2 以内是乘法。

**建议**：把 `list()` 降级为「`registry.list()` 含 `agent` 才拉」的惰性求值（或直接 `await runtime.agentRegistry.list()` 挪到 `childAgentsCtx` 分支内）；`callable`（`:1145-1147`）仍需全量，保留一次即可，但要与 `agents` 快照共用同一次拉取结果（现在已经是共用，问题只在「必拉」）。

**置信**：confirmed（形状） / suspected（收益量级）

---

### F-w4-runner-pro-19 | P2 | `logic/run-agent-turn.ts:342` + `create-agent-abort-registry.ts:20-22`

```ts
register(sessionId, controller) { map.set(sessionId, controller); }   // 无条件覆盖
```

**描述**：`runAgentTurn` 在**函数入口**无条件 `register`（`:342`，这是 RULE 与 desktop 注释记载的拍板：「受理即在途」）。`abortRegistry.register` 的实现是 `map.set` 直接覆盖。⇒ 同一 sessionId 上若存在第二个 run（未被 host 门禁挡住），第一个 run 的 controller **被静默夺权**。

**后果链**：用户点停止 → `abort(sessionId)` 命中的是**新 run** 的 controller；旧 run 从此**再也无法被 registry 中断**（`unregister` 的所有权比对保护了 map 不被误删，但保护不了「旧 controller 已不在 map 里」这件事）。旧 run 继续写消息、发事件，直到自己跑完。更糟的是：旧 run 的 `finally` 因所有权不匹配而不删 map，此时新 run 若已结束，map 里**空无一物**而旧 run 仍在跑 ⇒ `abortRegistry.has()` 返回 false，mobile `startRun`（`session-stream-unit-manager.service.ts:1088-1091`）的「该会话已有进行中的生成」门禁失效，用户可以再发一次。

**建议**：`register` 改成「已存在且未 unregister 时抛错 / 返回 false」，或在 `runAgentTurn` 入口做一次 `if (runtime.abortRegistry?.has(scope.sessionId)) return syntheticCancelledResult()` 式的自守。当前三端 host 都有门禁（desktop `isDesktopAgentActive()`、mobile `abortRegistry.has`、cli 无并发），所以是**防御纵深缺失**而非现网必现。

**置信**：suspected（host 门禁存在，但 core 层无自守；后果链完整可推）

---

### F-w4-runner-pro-20 | P2 | `impl/agent-runner.ts:962-991` + `:519-532`

```ts
const offTerminalWatch = subscribeQuietly(runtime, EVENT_AGENT_RUN_FINISHED, markRunnerTerminal());
const offFailedWatch   = subscribeQuietly(runtime, EVENT_AGENT_RUN_FAILED,  markRunnerTerminal());
runnerEntered = true;
```

**描述**：`runnerEmittedTerminal` 的判据是「观测窗内**任一**带本 sessionId 的 FINISHED/FAILED 事件」（`:529`）。它没有 runId 维度的过滤——`markRunnerTerminal` 拿不到、也不比 runId。于是同一 sessionId 上任何来源的终态事件都会把标志置真，包括：
- 另一个并发 run 的终态（见 F-19）；
- 上一个 run 的**迟到**终态（bus 是同步分发，理论上不会迟到，但 `wrapStreamForBus` 的 `queueMicrotask` 合并刷新（`:1044-1051`）证明事件并非全部同步——delta 是微任务延后的，理论上同族机制未来也可能落到终态上）。

**后果链**：主 run 的前奏 catch（`:1002-1004`）看到 `runnerEmittedTerminal === true` 就会**跳过补发 FAILED('')**，双端于是收不到终态 → desktop `activeRuns` refcount 泄漏 / renderer `uiRunning` 永久 true（正是 `:453-465` 注释里描述的那个灾难场景）。

**建议**：`markRunnerTerminal` 改成比对 `payload.runId === runId`（`runId` 在 `agent-runner` 内生成，但事件 payload 已带；`runAgentTurn` 侧可用「非空 runId 且等于本次 runner 的」——若拿不到 runner 的 runId，至少改成「`payload.runId !== ''`」以排除前奏哨兵）。当前的 `sessionId` 单维过滤比注释承诺的「永远是本 run 窗口内的事实」弱。

**置信**：suspected

---

### F-w4-runner-pro-21 | P3 | `logic/run-agent-turn.ts:133-134`

```ts
/** 用户 VFS 写入端口：executeOp 由 VFS 写链路直接消费，本模块不再使用该成员。 */
readonly userVfsTurn?: UserVfsTurnService;
```

**描述**：接口成员自带「本模块不再使用」的注释。实测 `git grep userVfsTurn -- packages/core/src/service/agent` 只命中这一行；`create-user-vfs-turn-service.ts:67` 另有一份独立的 `listSessionMessages` 供给，与本区无关。

**后果链**：`AgentTurnRuntimePort` 是 public 契约，成员即承诺；一个显式声明「不使用」的必填语义（虽然标了 `?`）仍会让每个 runtime 实现者困惑。RULE 第 12 条已记载 user ops 链路整体拆除，本条是那条拆除在接口层的残留。

**建议**：删除该成员及其 import（`run-agent-turn.ts:71`）。

**置信**：confirmed

---

### F-w4-runner-pro-22 | P3 | `logic/agent-run-shared.ts:40-49` vs `:57-71`

```ts
export async function resolveCurrentAgentId(runtime: AgentRunRuntimePort) {
  const fromState = await runtime.state.getCurrentAgentId();
  if (fromState != null && fromState !== "") return fromState;
  const ids = await runtime.agentRegistry.listAgentIds();
  return ids[0];
}
```

**描述**：`resolveWorkspaceAgentForNewSession`（`:57-71`）是它逐行同构的复制（入参收窄版，注释也自认「同语义」）。两个函数都被 desktop `handlers/agent.ts:66` / mobile `agent-display-label.ts:11` 消费。

**后果链**：同一「state 优先、registry 首项兜底」的规则有两份实现，改一处漏一处就是两个入口解析出不同 agentId——而这正是 F-23 那条分歧的放大器。

**建议**：保留一个，另一个改成薄封装（`resolveCurrentAgentId` 传 runtime，第二个传 `{state, agentRegistry}` 子集即可，无需复制函数体）。

**置信**：confirmed

---

### F-w4-runner-pro-23 | P3 | `logic/run-agent-turn.ts:619-623` vs `apps/desktop/src/main/ipc/handlers/agent.ts:418-421`

```ts
// core runAgentTurn 内部（唯一真源）：
const definition = (await mapResolveError(() => resolveAgentForProject(runtime, scope.projectId, scope.sessionId))).definition;
// desktop IPC 入口的前置校验：
await resolveDesktopSavedModelId(rt, (await resolveCurrentAgentDefinition(rt)).definition, req.sessionId);
```

**描述**：同一个 run 有**两条 agent 解析路径**：
- `runAgentTurn` 内部走 `resolveAgentForProject`（`resolve-agent-for-project.ts:53`）→ **会话的 `agentId`**；
- desktop IPC 入口的预检走 `resolveCurrentAgentDefinition`（`agent-run-shared.ts:74`）→ **`state.getCurrentAgentId()` 的 workspace 指针**。

RULE 第 36 条已写明「`resolveAgentForProject` 现在永远走 session 分支」，也就是 workspace 指针对 run **没有决定权**。于是预检校验的模型（`resolveApplicationModelIdForRun(rt, workspaceAgentDef, sessionId)`）与实际会跑的模型（`resolveApplicationModelIdForRun(rt, sessionAgentDef, sessionId)`，`:647-649`）**可能来自两个不同 agent**。

**后果链**：会话选的 agent 没配模型 → 预检（拿 workspace agent 过）放行 → 用户消息已 append 之后才在 `runAgentTurn` 的 `resolve-agent` 阶段抛 `AgentTurnError`；反过来（workspace agent 没配模型、会话 agent 配了）则是**误报阻塞**——明明能跑，IPC 层先拒了。附带成本：每次发送多一次 `state` + `agentRegistry.get` + `getSessionAgentConfig` 的重复 IO。

**建议**：IPC 入口的预检改成走 `resolveAgentForProject(rt, projectId, sessionId)`（或干脆删掉预检，让 `runAgentTurn` 自己的 `mapResolveError` 承担报错——它已经会把 `AgentRunResolveError` 映射成 `AgentTurnError`）。mobile 侧无此预检，属 desktop 单点。

**置信**：confirmed（路径分歧） / suspected（用户可见后果，跨 zone）

---

### F-w4-runner-pro-24 | P3 | `logic/run-agent-turn.ts:289-298` + `apps/desktop/src/main/services/agent-run.service.ts:22-29` + `apps/mobile/src/services/agent-run.service.ts`

```ts
async function mapResolveError<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (error) {
    if (error instanceof AgentRunResolveError) throw new AgentTurnError(error.message);
    throw error;
  }
}
```

**描述**：同一函数三份拷贝（core / desktop / mobile）。三份的 `AgentRunResolveError → AgentTurnError` 映射语义必须永远一致，否则同一个错误在 core 里已转、到 app 层又转一次（或没转），错误码语义漂移。

**后果链**：目前三份逻辑等价所以没出事，但这是一个「改一处不改两处就漂」的复制点，且 `mapResolveError` 明明是纯函数、可以随 `runAgentTurn` 一起导出。

**建议**：把 `mapResolveError` 加进 `public/agent.ts` 导出（或直接导出 `resolveApplicationModelIdForRun` 的转译版），三处统一引用。

**置信**：confirmed

---

### F-w4-runner-pro-25 | P3 | `logic/run-agent-turn.ts:184,203,225`（`export`）+ `public/agent.ts`（无对应导出）

**描述**：`assembleSkillsToolContext` / `assembleSearchToolContext` / `assembleAgentsToolContext` 三个装配器都 `export`，但 `packages/core/src/public/agent.ts` 没有转出它们。实测消费方：`run-agent-turn.ts` 内部两处 + **三份 core 测试**（`test/tool/agent-tool.test.ts:17`、`test/tool/search-tool.test.ts:14`、`test/tool/skill-tool.test.ts:20` 直接 `from "../../src/service/agent/logic/run-agent-turn.js"` 深引）。

**后果链**：为测试而 `export` 的生产符号，测试绕过 public barrel 深引 service 内部路径——`run-agent-turn.ts` 因此成为「既导出对外契约又导出测试缝」的混合模块；将来若把装配逻辑拆文件，测试全线断。

**建议**：要么进 public barrel 并把三份测试改成从 `@novel-master/core/agent` 引，要么收进同文件内部 `function`（测试改用 `runAgentTurn` 端到端覆盖）。

**置信**：confirmed

---

### F-w4-runner-pro-26 | P3 | `impl/agent-registry.service.ts:120-140`

```ts
let otherName: string;
try { const otherDef = await this.deps.repository.get(otherId); otherName = otherDef == null ? otherId.trim() : otherDef.name.trim(); }
catch { otherName = otherId.trim(); }
```

**描述**：`assertUniqueDisplayName` 在循环里对每个 agentId 单独 `repository.get`（N+1 查询，一次 upsert 触发 N 次解码查询），且解码失败时**静默降级成用 UUID 当显示名**参与比较。

**后果链**：两个方向都会出错——① 一行坏数据（`prompts_json` 非法）会让它的「名字」变成 UUID，与新 agent 名撞上时报 `DUPLICATE_NAME`，错误信息误导（用户根本没起过这名）；② 坏数据行的真实重名则被漏检，允许落库两个同名 agent（而 `task` 工具按 name 查找，`subagent-tool` 会取到不确定的那一个）。`upsert` 是低频路径，N+1 的性能不是问题，正确性与可诊断性才是。

**建议**：解码失败时**跳过**该行并 `console.warn` 记录 agentId（而不是拿 id 顶替名字）；或改成一次性 `list()` 后在内存里比 name（`list()` 已经在 registry 内存在，`run-agent-turn.ts:794` 每次发送都调它）。

**置信**：confirmed

---

### F-w4-runner-pro-27 | P3 | `impl/agent-registry.service.ts:157` vs `:108-112`

```ts
if (wireName === DEFAULT_SUBAGENT_DEFINITION.name) {   // :157  未 trim
...
if (trimmedName === DEFAULT_SUBAGENT_DEFINITION.name) { // :108 已 trim
```

**描述**：upsert 侧用 `defaulted.name.trim()` 比对保留名，delete 侧直接用 wire 里的原始 `name` 比对。两条路径对同一个保留名的判定口径不一致。

**后果链**：历史脏数据（`name` 带首尾空白，如 `"general "`）能通过 delete 门，把内置保留名 agent 删掉；`list()`（`:72`）的同名检查同样用未 trim 的 `def.name`，会出现「DB 有 `general ` → 不追加虚拟 general → `task` 按 name 找不到真身」。

**建议**：三处统一走一个 `normalizeDisplayName(raw)` helper（trim + 空串归一）。

**置信**：suspected（需要一条脏数据才能触发，但存量库不可证）

---

### F-w4-runner-pro-28 | P3 | `create-agent-stream-registry.ts:80-90`

```ts
unregister(sessionId, handle) {
  const current = map.get(sessionId);
  if (current == null) return;
  // 所有权比对：handle 一致才删。handle 省略时（兼容路径）直接删。
  if (handle != null && current.handle !== handle) return;
  map.delete(sessionId);
}
```

**描述**：port 注释（`agent-stream-registry.port.ts:90-92`）说「handle 省略时不比对直接删，兼容不关心所有权的调用方」。实测：**没有任何调用方省略 handle**——`run-agent-turn.ts:1027` 与 `:1327` 都传 handle，并且两处都额外用 `if (streamHandle != null)` 守卫（注释明确解释「handle 为 undefined 时不能反注册，会误删同 sessionId 上别的 run 的 partial」）。

**后果链**：这个「兼容路径」没有任何用户，却是一条能误删别人 partial 的地雷（对比 abort registry 的 `unregister(sessionId, controller)` 是**必填** controller，类型层面就杜绝了这条路径——两个姊妹 API 的安全等级不一致）。将来有人照着 port 注释写 `unregister(sessionId)`，直接踩雷。

**建议**：把 `handle` 改必填（`unregister(sessionId: string, handle: AgentStreamRegistryHandle): void`），与 `AgentAbortRegistry.unregister` 对齐；两处 `if (streamHandle != null)` 守卫随之可以简化成「未 register 就不调」。

**置信**：confirmed

---

### F-w4-runner-pro-29 | P3 | `impl/agent-runner.ts:987-999` vs `:964-972`

```ts
if (publishRunLifecycle) { bus.publish(EVENT_AGENT_RUN_FINISHED, { ..., vfsMutated: vfsMutatedInRun }); }   // :964
// ……
const picked = pickLastPromptUsage(rounds);
if (persistMessages && stopReason === "completed" && picked !== undefined) { writeSessionApiPromptTokenEntry(...); }  // :987
```

**描述**：run 级 API 占用**终值**的写入发生在 FINISHED **之后**。FINISHED 是同步分发（`SimpleEventBus.publish`，`infra/events/simple-event-bus.ts:52-63`），下游此刻就能读到旧值。

**后果链**：desktop `handlers/agent.ts:259-262` 的 `onCoreRunFinished → refreshChatTokenStatsAfterRun` 正是「run 结束跑一次 token 读口」的注入点，它在 FINISHED 回调里同步读占用；命中的是**上一次**写入的值。多数情况下两值相同（`:770` / `:898` 的 step 锚点已写过同一批消息的 usage），差异出现在「终 step 的 usage 缺 `promptTokens`、`picked` 取自前步」这条已被 `:976-978` 注释承认的路径上——此时 chip 会停在旧锚点。

**建议**：把终值写入挪到 FINISHED publish **之前**（`writeSessionApiPromptTokenEntry` 是同步热层 + fire-and-forget KKV，挪动无 IO 代价），或让读口在 FINISHED 后延迟一个 tick。

**置信**：suspected

---

### F-w4-runner-pro-30 | P3 | `logic/run-agent-turn.ts:567-604,774-781,800-804,828-832,941-947,1130-1134,1164-1168`

```ts
const afterListCancelled = preludeAbortResult();
if (afterListCancelled != null) {
  publishPreludeRunFinished(runtime, scope);
  return afterListCancelled;
}
```

**描述**：「检查点命中 → 发 FINISHED('') → 返回合成 cancelled」这个 4 行块在主 run 出现 **5 次**、子 run **2 次**，共 7 份逐字复制（只有变量名不同）。而 `preludeAbortResult()`（`:567-568`）与 `publishPreludeRunFinished()`（`:407-418`）本来就是为此而抽的两个 helper，唯独把两者配对调用这步没抽。

**后果链**：这 7 处是 r3-run-1/3/4 三轮补丁的产物，每轮都在复制粘贴。语义一旦要改（比如 payload 加字段、终态类型细分），要改 7 处，漏一处就是「有的检查点发 FINISHED 有的不发」——而这正是 `:405` 那条不变式（`runAgentTurn` 返回 cancelled ⇒ 恰好一条 FINISHED('')）的破口。

**建议**：抽 `const finishPreludeCancel = (): AgentRunResult => { publishPreludeRunFinished(runtime, scope); return syntheticCancelledResult(); }`，7 处收敛为 `if (internalController.signal.aborted) return finishPreludeCancel();`。

**置信**：confirmed

---

## 争议与存疑

1. **F-19（register 覆盖夺权）我判 suspected 而非 confirmed**：三端 host 都有并发门禁（desktop `handlers/agent.ts:410` `isDesktopAgentActive()`、mobile `session-stream-unit-manager.service.ts:1088-1091`、`cli` 串行），core 层被绕过的窗口极窄。但「core 自己的 `AgentAbortRegistry` 端口文档（`:25-28`）明确把覆盖写成预期行为」这一点，让我不认为这是纯粹的疏漏——它更像是**没意识到覆盖会夺走旧 run 的中断能力**。建议主代理裁决时同时看 defense-paired 机位的意见。

2. **F-20（`runnerEmittedTerminal` 只按 sessionId 过滤）**：我没能构造出「同 sessionId 两个 run 且终态交错」的可复现路径（host 门禁挡着），所以只给 suspected。但判据本身的强度确实低于 `:514-517` 注释宣称的「永远是本 run 窗口内的事实」——注释承诺的是 runId 语义，代码实现的是 sessionId 语义。这个**注释与实现的口径差**本身我认为是 confirmed 的坏味道。

3. **F-13（streamRegistry 死子系统）与 F-14（EphemeralOverlay 死代码）**：两者都是「实现自己承认无生产调用方」的形态，但**我不能排除**它们是给尚未落地的新功能预留的（例如 RULE 提到的子会话流式首屏方案）。我倾向于按「要么接线要么删」处理，而不是直接删——但这需要主代理确认路线图。

4. **F-09（子 run 无终态兜底）**：代码形状确凿（try/finally 无 catch，与主 run 的 `publishPreludeRunFailed` 形成刺眼对比）。但「子会话页会不会真的挂起」跨到 mobile zone，我没有独立验证 `SessionStreamUnit` 的 starting 态超时/keep-alive 兜底（`startKeepAliveQuietly` / `settledGraceMs` 可能已经兜住了）。留给 W4 辩护者与 mobile 机位对质。

5. **F-23（双 agent 解析路径）**：路径分歧确凿，但 desktop 预检的实际用户可见后果依赖 `resolveCurrentAgentDefinition` 与 `resolveAgentForProject` 在真实数据上是否真的返回不同 agent（取决于用户有没有设过 workspace currentAgentId）。RULE 第 36 条说「永远走 session 分支」，暗示 workspace 指针已近乎无人维护——若真如此，预检校验的几乎总是一个不存在的 agent 的模型。

6. **未纳入指控的拍板项**（按 PLAN 第 3 条标 intentional，不当问题报）：
   - `runAgentTurn` 入口即 `abortRegistry.register`（受理即在途）——RULE + `apps/desktop/src/main/ipc/handlers/agent.ts:269-283` 明写拍板；我只就「覆盖夺权」这一未被拍板覆盖的**衍生**后果报了 F-19。
   - 回合快照（`turnNow` / `resolveTurnFiletreeSnapshot` 每 run 取一次）——RULE「回合快照（macro turn snapshot）」条目明写。
   - `unregister` 带所有权比对的幂等兜底（`:353` 外壳 + `:1021` 内层双调）——`:351-352` 注释明写。
   - `wt` 提升到循环外（`agent-runner.ts:391-393`）——RULE「常驻工作区」条目明写（注：RULE 说该问题源于实例级 `liveViewInFlight`，而 `service/workplace/impl/workplace-view-cache.ts:51` 显示它已升级为 conn 级，RULE 这段文字已过期，建议主代理顺带更新）。
   - `publishPreludeRunFinished` 的 `runId: ''` / `vfsMutated: false` 硬约束——`:396-405` 与 `apps/desktop/renderer/providers/ShellNavProvider.tsx:341` 双向锁定。
   - pathTail 并发盲区（VFS 工具）——RULE 末节拍板接受，本区只消费不产生。
