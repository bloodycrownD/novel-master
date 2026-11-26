# 错误通道技术债清理设计（error-channel-debt）

本文档覆盖五项错误通道技术债的可执行设计。所有行号与现状代码均在本 worktree（分支 `feat/mcp-support`）逐文件核实过；文中「行号」指设计定稿时（提交 64820c7cf）的工作区代码行；实现落地后已整体漂移，以代码为准。**本版为第 3 轮修订**：历轮评审意见逐条回应见 §0.1（第 2 轮）与 §0.2（第 3 轮），各轮 P1 全部按保等价修订。设计原则遵循 `.agents/skills/nm-code-style/SKILL.md` §3（错误进 Either，不抛）与 §8 表（六形态 throw 盘点）：自己写的函数之间用 `Result` / `Outcome` 传失败与中断，取消不是错误（`Interrupt` 承载），只有平台契约逼着抛的地方才抛并标 `// nm-throw: keep — 理由`。

## 0. 背景事实核实出入（先读，影响后文口径）

任务给的背景事实与代码实况有四处出入，本设计一律以核实后的代码为准：

1. **背景事实 2 说「runParallel 靠 isAbortLikeError 把它收成 `{ok:false, error, kind:"cancelled", reason}`」——与代码不符。** 实况：`runParallel` 的 `drainQueue` catch（`packages/core/src/domain/tool/logic/tool-runner.ts:201-206`）调 `failedOutcome(error)`；`failedOutcome`（tool-runner.ts:52-54）按 `AppErrorOps.is(error, "TOOL_CANCELLED")` 判定。竞速取消的 `AbortError` 不是 `AppError`，判定不命中，实际落 `{ ok: false, error: AbortError }`——**没有 `kind` 字段**。`isAbortLikeError` 在工具系统内只出现在注释里（tool-runner.ts:88、:145、:203），无实际调用。因此「runParallel 的取消 outcome 形态」在本设计中是**要变**的（§1.4）。
2. **背景事实 3 说 McpFailure 的 kind 有六个——实况七个**（含 `unknown`，`packages/core/src/domain/mcp/model/mcp-failure.ts:12`）。不影响设计结论。
3. **背景事实 4 说 raiseRunError 有 13 处调用——grep 实况 12 处调用点**（`agent-runner.ts:263, 314, 341, 383, 402, 415, 513, 594, 633, 673, 747, 786`）+ 1 处定义（:930）+ 1 处接口类型声明（:919）。rethrowRunFailure 实况 4 处调用点（`run-agent-turn.ts:1084, 1370, 1422, 1546`）。
4. **`runChildAgent` 内 `rethrowRunFailure` 的注释（run-agent-turn.ts:1544-1545「转异常冒泡，与旧 throw 通道逐字一致」）描述的冒泡终点不成立。** 实际冒泡链（已逐环核实）：`runChildAgent` 无 catch（:1267 起）→ `toolCtx.subagent.runChildAgent` 闭包（run-agent-turn.ts:1006-1017，无 catch）→ task 工具 `run` 的 `await subagent.runChildAgent(...)`（`packages/core/src/domain/tool/builtin/subagent-tool.ts:237`，无 try/catch 包裹）→ reject 冒出 tool.run → `ToolRunner.call` 的 catch（tool-runner.ts:142-152）→ `normalizeToolFailure` 归一 → 父 run 收到的是**工具失败 outcome**，主 run 的 catch 根本收不到它。§3.4 的等价性论证依赖这一事实。

## 0.1 第 2 轮评审回应（逐条）

| # | 评审点 | 结论 | 落点 |
|---|---|---|---|
| 1 | §3.2 把 :633（空回复占位落库）纳入机械 `return finishRunFailure` 改造，会翻转「占位落库失败不把成功 run 翻成 FAILED」的显式语义（agent-runner.ts:630-644 实读确认：:633 在本地 try 内，Err 经 raiseRunError 进本地 catch :635-643 只记日志） | **采纳。** :633 移出机械清单（§3.2 改为 10 处），与 :786 并列按「`throw appended.error` + `nm-throw: keep` 喂本地 catch」处理——同一形态同一处理，保吞掉语义 | §3.2 |
| 2 | §4.4 漏了 `packages/core/src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts:68` 这处直接调 `parser.parse` 的调用方（我上轮 grep 输出被 `head -20` 截断漏掉，路径还写错成 `src/message-checkpoint/…`）；suite.ts 行号实为 :287 非 :280 | **采纳。** 该文件归 (b) 解包类，给 `throw rendered.error` + `nm-throw: keep` 改法（文件不在 tdbc-driver 白名单，keep 点名 :54 注释的事务回滚契约）；路径与行号全部修正 | §4.4 |
| 3 | §3.2 的机械改造漏掉主 catch :767-770 的 `signal?.aborted` 首条判定——现状「已知失败恰逢 signal 已中止」会被路由进 handleAbort（FINISHED/cancelled），改后直接 FAILED，属未声明终态翻转 | **采纳，按保等价修。** 取消优先路由收进 `finishRunFailure` 开头：失败入参到达时先判 `signal?.aborted \|\| AbortError 形态`，命中则 `handleAbort` + 内联取消收尾（FINISHED + KKV 失效 + `Result.ok` 取消形态，与主 catch 取消路径逐项等价）后返回；未命中才走失败收尾。这同时让 §3.3 两处内层 catch 的改造简化为直接 `return finishRunFailure(e)`，全部路径与现状逐项等价，§8 无新增差异条目 | §3.1、§3.3 |
| 4 | §5.4「17 个站点键」按 §5.3 自己的文本合并规则算出来是 16（raiseRunError 12 调用中 :594/:633/:786 同文本共 1 键 → 10 调用键 + 1 定义键；rethrowRunFailure 5）；T7 定义站点的键文本未定义，与 baseline 既有 `#throw error;` 键（实测 scripts/throw-audit-baseline.json:1213/:1231 存在）的碰撞关系未说明 | **采纳。** 键数修正为 16 并给推算表；T7 键文本定为合成文本 `never-throw helper: <名>`（不与 T1-T6 的 throw 语句原文键碰撞——`raiseRunError` 体内的 `throw error;` 本就是 baseline 已登记的 T6 站点，两者并存各占一键，⑤ 完成后一起 dropped） | §5.3、§5.4 |
| 5 | §4.2 递归解包清单漏 choose 分支内三处：readOpenTagHeader（parser.ts:211、:227）与 readCloseTag（:234） | **采纳。** 补进解包点清单 | §4.2 |
| 6 | T7 检测口径可被绕过：只认显式 `: never` 标注 + 单语句体，无标注恒抛函数（TS 推断 never）与多语句体逃逸 | **部分采纳（写明边界，不扩口径）。** 「返回类型**标注**为 never」是任务 E 的字面定义；推断型判定需要 TS type checker 的类型推断（AST-only 做不到），本轮不扩，§5.1 新增「检测边界」段如实声明。误报方向评审核过：`common/assert.ts:16` 的 assert 体是单条 if（非单条 ThrowStatement）且名字命中豁免，双重豁免无冲突 | §5.1 |

以下正文均已按上述结论修订。

## 0.2 第 3 轮评审回应（逐条）

| # | 评审点 | 结论 | 落点 |
|---|---|---|---|
| 1 | §3.6-4 改 `assembleSkillsToolContext` 签名后，漏了 `packages/core/test/tool/skill-tool.test.ts:527/:534/:552` 三处直接调用（grep 实读确认：:528/:553 `assert.equal(ctx, undefined)` 会因 `Result.ok(undefined) !== undefined` 断言红，:539-541 `ctx.projectId`/`ctx.effective` 在 Result 上不存在编译错） | **采纳。** §3.6-4 补三个用例的断言改法（意图不变：未注入→undefined、注入→ctx 字段、deny→undefined）；§6 ⑤ 组清单与 §7 验证补该测试文件 | §3.6-4、§6、§7 |
| 2 | §3.1/§9-2「`this.deps` 在箭头闭包里不可用」理由错误：`run()` 是实例方法（agent-runner.ts:110），箭头闭包词法捕获 `this`，`this.deps` 直用即可（handleAbort :230-232 同机制先例） | **采纳。** 注意段理由更正，两写法等价；§9-2 的 open question 撤销（实际不是问题） | §3.1、§9 |
| 3 | §4.2「解包点全清单」漏 parser.ts:30（`parseToAst` 内的 `parseChildren` 递归调用） | **采纳。** 清单补 :30（实读确认 :30 存在该调用） | §4.2 |
| 4 | §5.4 表格的 T8 键文本写成整条 if 语句原文，与 §5.1/§5.3 定义的「CallExpression getText() 归一」口径不一致（两种口径下「16 键」结论恰好都成立，但表格误导 baseline 键内容预期） | **采纳。** 表格统一为 CallExpression 口径 | §5.4 |
| 5 | T8 检测边界漏两种调用形态逃逸：间接引用调用（局部名）与元素访问 `AgentRunner["x"](e)` | **采纳（声明不扩口径）。** §5.1 检测边界段补全；两种形态需刻意改写才出现，现实代码未出现 | §5.1 |
| 6 | §5.5 自测用例缺 MethodDeclaration 形态——恰是唯一有真实实例的 T7 形态（全仓两处实例都是对象字面量 MethodDeclaration） | **采纳。** 用例清单补 MethodDeclaration | §5.5 |
| 7 | §4.4(a)「bootstrap 五件」实列六个文件，行号有漂移 | **采纳。** 改「六件」，行号统一为逐文件 grep 实测的 TdbcTemplate.query/execute 调用行 | §4.4 |
| 8 | §1.1「TOOL_PASSTHROUGH_KEYS（5 码 + TOOL_CANCELLED）」计数错——实为 4 个 ToolError 码 + TOOL_CANCELLED 共 5 元素（tool-runner.ts:34 实读） | **采纳。** 文字修正（:33 源码注释自身的「5 码」计法含糊，一并注明） | §1.1 |
| 9 | §8 D-1 只写竞速取消，未涵盖「工具自己抛 AbortError」来源（同一 catch 分支的两种来源，改前都按失败展示） | **采纳。** D-1 与 §1.6 措辞覆盖两种来源 | §1.6、§8 |
| 10 | §4.1 引用 connection.port.ts 行号偏 2 行（「Implementations must reject」在 :10-11、「Nested calls throw」在 :37） | **采纳。** 行号修正（实读确认） | §4.1 |

以下正文均已按上述结论修订（含第 2 轮）。

## 1. A 工具系统：取消统一走返回值（①组）

### 1.1 现状（已核实）

- `Tool.run` 契约：`run(input, ctx): Promise<Result<Output, AppError>>`（`packages/core/src/domain/tool/model/tool.ts:48`）——**签名不动**。
- `ToolRunner.call`（tool-runner.ts:92）返回 `Promise<Result<Output, AppError>>`：
  - 进入时已中止 → `Result.err(new AppError("TOOL_CANCELLED", {toolName}))`（tool-runner.ts:117，返回值通道）；
  - 在途取消竞速：`AbortScopeFactory.signalView(signal).race(work, () => AbortError.create())`（tool-runner.ts:125），竞速胜出的 `AbortError` 在 catch 里按形状判定（`name === "AbortError"`）**原样 throw**（tool-runner.ts:148，`nm-throw: keep` 注释 ：147）；
  - 其余未知异常 → `normalizeToolFailure`（tool-runner.ts:151）。
- `runParallel`（tool-runner.ts:160）→ `drainQueue`（:175-211）→ `await this.call(...)`（:197）；call 的 reject 在 catch（:201-206）里经 `failedOutcome` 收编（见 §0.1 的形态修正）；call 的 `Err` 返回值走 `failedOutcome(result.error)`（:200）。
- `normalizeToolFailure`（tool-runner.ts:40-45）：`AppError.name`（= key，见 `app-error.ts:188` `this.name = key`）在 `TOOL_PASSTHROUGH_KEYS`（4 个 ToolError 码 + TOOL_CANCELLED，共 5 元素，tool-runner.ts:34——:33 源码注释「原 ToolError 5 码」的计法含糊，实数 5 元素）内直通，否则包 `TOOL_FAILED`。

取消在工具系统内部因此有两种形态：返回值通道（TOOL_CANCELLED）与异常通道（AbortError）。本节把异常通道收掉。

### 1.2 改动：call 的 catch（tool-runner.ts:142-152）

前（:148）：

```ts
if (typeof e === "object" && e !== null && "name" in e && (e as { name: unknown }).name === "AbortError") throw e;
```

后：

```ts
// 在途竞速的取消：race 的 reject 载荷是 AbortError，在这里收成与「进入时已中止」
// （:117）同一条 Result.err(TOOL_CANCELLED) 通道；形状判定只认 name（跨 duplicate
// module / Hermes 无 DOMException，instanceof 会失灵，理由沿原 :145-146 注释）。
if (typeof e === "object" && e !== null && "name" in e && (e as { name: unknown }).name === "AbortError") {
    return Result.err(new AppError("TOOL_CANCELLED", {toolName: name}));
}
```

同函数的 `nm-throw: keep` 注释（:147）随 throw 一并删除；:87-90 的 `@remarks` 中「在途竞速以 AbortError.create() reject（平台协议例外……）由 runParallel 的 catch 收编」改写为「在途竞速的取消同样沿 Result.err(TOOL_CANCELLED) 返回（call 的 catch 收编）；Promise 不 reject」。:123-124、:130、:142-151 的关联注释同步改写（「竞速交给 signalView……AbortError 载荷原样上行」等表述随通道变更更新，理由与码表不变）。

**call 的新契约：执行段不 reject。** 已知失败、取消、未知异常全部沿 `Result.err` 返回（未知异常经 `normalizeToolFailure` 包 `TOOL_FAILED`）。try 块之外的 `registry.get` / `inputSchema.safeParse` / `ToolPathPolicy.check`（:93-108）维持现状（纯查询与 zod 校验，不抛；若抛属编程错误，与现状同为 reject 逃逸，不在本轮范围）。

### 1.3 怎么区分「竞速取消的 AbortError」与「工具自己抛的其它异常」

沿用现有形状判定 `name === "AbortError"`（tool-runner.ts:148 已有，跨 duplicate module / Hermes 无 DOMException 时 instanceof 失灵）：

- `name === "AbortError"` → 取消，收 `Result.err(TOOL_CANCELLED)`。工具若自己抛 `AbortError` 也归取消——取消语义本来就该落这条通道，且内置工具的取消本就以 `TOOL_CANCELLED` 的 `Err` 返回（curl-tool.ts:142、search-tool.ts:210、skill-tool.ts:312 等先例）；
- 其它一切 → `normalizeToolFailure`（TOOL_* 直通 / 包 `TOOL_FAILED`），与现状 :151 逐字一致。

判定顺序：AbortError 判定在 `normalizeToolFailure` 之前（与现状 catch 内顺序一致）。

### 1.4 runParallel 的取消 outcome 形态：变

- 改前：竞速取消落 `{ ok: false, error: AbortError }`（无 kind，见 §0.1）；返回值取消（工具返回或进入时已中止）落 `{ ok: false, error: AppError(TOOL_CANCELLED), kind: "cancelled", reason: "user-stop" }`。
- 改后：两种取消来源统一命中 `failedOutcome` 的 `TOOL_CANCELLED` 分支（tool-runner.ts:53），落 `{ ok: false, error: AppError(TOOL_CANCELLED), kind: "cancelled", reason: "user-stop" }`。**失败 outcome 形态不变**（`{ ok: false, error }`）。
- `ParallelToolOutcome` 类型定义（tool-runner.ts:26-29）**不变**；:23-25 的类型注释补一句「竞速取消自八期 AbortError 形态并入本形态」。
- `failedOutcome`（:52-54）与 `drainQueue` 的内层 catch（:201-206）**保留**：call 全路径不 reject 后该 catch 属防御（call 之外循环体异常、契约违约兜底），注释里「供上层用 isAbortLikeError 识别取消」的表述改为「取消 outcome 只来自 TOOL_CANCELLED 码」。

### 1.5 消费方清单（grep 核实，含改法）

`grep -rn "runParallel|toolRunner\.call|ToolRunner(" --include=*.ts packages apps`（生产代码，排除 test/dist）结果与逐项处置：

| # | 位置 | 依赖什么 | 改法 |
|---|---|---|---|
| 1 | `packages/core/src/service/agent/impl/agent-runner.ts:698` | `runParallel` 返回的 outcomes（不依赖 reject） | **零代码改动**。outcomes 进 `ToolResultBlock.build`（:709-724）；`build-tool-result-block.ts:271` 与 `format-tool-output.ts:308` 都按 `AppErrorOps.is(error, "TOOL_CANCELLED")` 判取消——改后竞速取消的 error 从 AbortError 变 AppError(TOOL_CANCELLED)，判定**开始命中**，见 §1.6 行为差异 D-1 |
| 2 | `packages/core/src/service/chat/impl/user-vfs-turn.service.ts:82` | `runParallel` 返回的 outcomes；`!outcome.ok` 时 `failed.error` 以 `unknown` 透传（`user-vfs-turn.port.ts:26` UserVfsTurnExecuteResult.error） | **零代码改动**。该链路的 `resolveToolCtx` 不注入 `signal`（`chat-service-factory.ts:202-213`，字段清单里没有 signal）→ `ToolRunner.call` 的竞速分支不可达（tool-runner.ts:125 `signal == null ? await work : ...`）→ 取消只能来自内置工具自己返回的 `TOOL_CANCELLED` Err，形态与改前一致 |
| 3 | `ToolRunner.call` 直接外部调用方 | — | **无**。grep `Runner\.call(` / `toolRunner\.call(` 生产零命中（builtin-tool-context.ts:203、tool-path-policy.ts:82/:125 是注释）；drainQueue:197 是唯一调用点 |
| 4 | tool-runner.ts:201-206 drainQueue 内层 catch | 「call 会 reject AbortError」 | 注释更新（§1.4），代码保留 |
| 5 | `packages/core/src/domain/mcp/logic/to-nm-tool.ts:68` | 「callTool 会 reject AbortError」 | 归 B（§2）改造，catch 整体删除 |
| 6 | `apps/desktop/src/main/ipc/format-ipc-error.ts:32` | `isAbortLikeError(err) → IPC_ABORTED` | **零改动**。它收编的是 IPC 边界的 AbortError（model-request、DocumentIo.write 等通道仍产 AbortError，见 `apps/mobile/src/services/db-backup.service.ts:222`、`model-request.service.ts:64/:222`）；工具系统不再产 AbortError 后该分支仍必需 |
| 7 | `apps/cli/src/cli-errors.ts:40` | `isAppError(error, "TOOL_CANCELLED")` → EXIT_CANCELLED | **零改动**。TOOL_CANCELLED 码保留，且 A 改后取消更稳定地落这条码 |

### 1.6 行为差异声明（A 唯一一处，属「通道」变更豁免范围）

**D-1：agent run 内取消形态的 tool_result 文案变化（覆盖同一 catch 分支的两种来源）。** 改前：在途竞速取消的 AbortError、以及工具自己抛的 AbortError，都会落到 outcome `{ ok: false, error }`（无 kind——竞速取消经 ：125→:201-206，工具自抛经 ：148 放行同口），`AppErrorOps.is(error, "TOOL_CANCELLED")` 不命中（build-tool-result-block.ts:271、format-tool-output.ts:308），按普通失败展示（错误文案）；改后两种来源统一收成 `TOOL_CANCELLED`，命中取消分类，展示「工具调用已取消」、块仍 `ok=false`（LLM 知道调用未完成——build-tool-result-block.ts:268 注释语义保持）。这正是通道统一的目的：取消不应伪装成失败。测试影响：`packages/core/test/tool/` 下钉过竞速取消 reject AbortError 的用例（如 tool-runner 相关测试）改为断言 `TOOL_CANCELLED` 的 Err / 取消 outcome；断言跟着新契约改，测试意图（取消路径存在且可识别）不变。

## 2. B MCP：callTool 取消走返回值（④组，第二轮）

### 2.1 形态选择与理由

选 **`Promise<Result<unknown, McpFailure> | Interrupt>`**（Result 与 Interrupt 的判别联合）：

- `callTool` 内部语言已经是 Result（`settlePromise` 把所有 SDK reject 收编成 Result，`create-mcp-connection-manager.ts:111`；`connectOnce` 全 Result）——成功/失败不动，只把 failCall 的 throw 分支换成返回中断；
- `Interrupt` 是全仓中断类型的唯一权威定义（`packages/core/src/errors/outcome.ts:10-25` 注释明示），「取消不是失败、不带错误码」的语义由它承载；MCP 取消时拿不到 scope reason（toolCtx 只有裸 signal），reason 按 `user-stop` 兜底——与 tool-runner 的既有兜底口径一致（tool-runner.ts:48-50 注释）；
- 仓内先例：`ParallelToolOutcome`（tool-runner.ts:26-29，Result 形态 + 中断扩展字段）、`ConnectFailure`（create-mcp-connection-manager.ts:88，`{kind:"failure"|...}` 自定义判别联合）——判别联合在本仓是成熟形态；
- 判定顺序固定：`if ("kind" in x)` 先判中断（Result 两侧 Ok/Err 均无 `kind` 字段，`in` 收窄干净），`x.ok` 再判 Result。

否决的备选：

- **`Outcome<unknown>`**：`Outcome.failed` 的 error 必须是 `AppError`（outcome.ts:32），McpFailure 不是 AppError，装不进去；把 McpFailure 包成 AppError 属造中间壳（SKILL §3 禁止）。
- **McpFailure.kind 加 "cancelled"**：违反 mcp-failure.ts:3-4 红线（内部码只有 7 个、不再细分），且「取消不是失败」——cancelled 挂在失败模型上语义就错了。
- **自定义三态 `{kind:"completed"|"cancelled"|"failed", failure}`**：复刻 Outcome 骨架却不与 Interrupt 共享类型，多造一个壳，否决。

### 2.2 port 签名前后对照（④组）

`packages/core/src/domain/mcp/ports/mcp-connection.port.ts:21-25`：

前：

```ts
/**
 * 调用 MCP 工具；取消不进 Result——`signal` 中止时原样以 AbortError reject
 * 透传（工具 run 负责转 TOOL_CANCELLED），已知失败沿 `Result.err` 带原文。
 */
callTool(serverId: string, toolName: string, args: unknown, signal: AbortSignal): Promise<Result<unknown, McpFailure>>;
```

后：

```ts
/**
 * 调用 MCP 工具；取消沿 `Interrupt.cancelled` 返回（reason 按用户停止兜底，
 * 与 tool-runner 同口径），replaced 对 MCP 无生产者、类型上穷尽即可；已知失败
 * 沿 `Result.err` 带原文。Promise 不 reject：未知异常由 settlePromise 收编。
 */
callTool(serverId: string, toolName: string, args: unknown, signal: AbortSignal): Promise<Result<unknown, McpFailure> | Interrupt>;
```

### 2.3 impl 签名前后对照（④组）

`packages/core/src/infra/mcp/impl/create-mcp-connection-manager.ts`：

failCall（:263-275）前（节选 throw 分支）：

```ts
const failCall = (config: McpServerConfig, generation: number, signal: AbortSignal, reason: ConnectFailure): Result<unknown, McpFailure> => {
    const error = reason.kind === "error" ? reason.error : null;
    if (error != null && (RequestAbort.isAbortLikeError(error) || signal.aborted)) {
        // nm-throw: keep — …（:266-267 注释）
        throw RequestAbort.isAbortLikeError(error) ? error : AbortError.create();
    }
    …
```

后：

```ts
const failCall = (config: McpServerConfig, generation: number, signal: AbortSignal, reason: ConnectFailure): Result<unknown, McpFailure> | Interrupt => {
    const error = reason.kind === "error" ? reason.error : null;
    // 取消是控制流不是失败：signal 已中止（或底层抛的是 abort 形态）沿 Interrupt 返回，
    // 不写连接状态（与改前 throw 分支跳过 stale 写回一致）。ctx 上是裸 signal，
    // reason 按用户停止兜底（tool-runner 同口径）。
    if (error != null && (RequestAbort.isAbortLikeError(error) || signal.aborted)) {
        return { kind: "cancelled", reason: "user-stop" };
    }
    …（:269-274 失败分支逐字不动）
```

`nm-throw: keep`（:266-267）删除——不再抛。stale 判定与状态写回（:270-274）的副作用顺序保持。文件头注释 :17（「callTool 对 AbortError 原样 reject 透传（取消不进 Result）」）改写为「callTool 的取消沿 Interrupt.cancelled 返回」。

callTool 本体（:277-287）签名同步为 `Promise<Result<unknown, McpFailure> | Interrupt>`，函数体逐字不动（failCall 返回中断后自然沿返回值上行）。

### 2.4 to-nm-tool 映射（④组）

`packages/core/src/domain/mcp/logic/to-nm-tool.ts`：

- `McpToolCallDeps.call`（:39-42）签名前 `Promise<Result<unknown, McpFailure>>` → 后 `Promise<Result<unknown, McpFailure> | Interrupt>`；字段注释同步。
- `run`（:61-91）：删 try/catch（:63-72）——callTool 新契约不 reject（契约违约的 mock reject 若为 AbortError 形态，会被 `ToolRunner.call` 的 catch 收成 `TOOL_CANCELLED`（§1.2），行为仍对；其它异常由 `normalizeToolFailure` 兜底，同现状非取消分支）。解包改判别：

前（:62-73 节选）：

```ts
let called: Result<unknown, McpFailure>;
try {
    called = await deps.call(snapshot.toolName, input, ctx.signal ?? NEVER_ABORTED_SIGNAL);
} catch (error: unknown) {
    if (…name === "AbortError"…) return Result.err(new AppError("TOOL_CANCELLED", {toolName: name}));
    return Result.err(new AppError("TOOL_FAILED", {toolName: name, cause: error, detail: `Tool failed: ${name}`}));
}
if (!called.ok) return Result.err(new AppError("TOOL_FAILED", {toolName: name, cause: called.error, detail: `${prefix} ${called.error.detail}`}));
```

后：

```ts
const called = await deps.call(snapshot.toolName, input, ctx.signal ?? NEVER_ABORTED_SIGNAL);
// 取消是控制流不是失败：callTool 以 Interrupt 表达（spec §五随通道迁移更新）；
// MCP 无 replaced 生产者，与 cancelled 同收 TOOL_CANCELLED（穷尽处理）。
if ("kind" in called) return Result.err(new AppError("TOOL_CANCELLED", {toolName: name}));
if (!called.ok) return Result.err(new AppError("TOOL_FAILED", {toolName: name, cause: called.error, detail: `${prefix} ${called.error.detail}`}));
```

TOOL_CANCELLED / TOOL_FAILED 的码、params、detail 前缀逐字保持（用户可见文案不变）。文件头注释 :9-11（AbortError reject 透传→TOOL_CANCELLED 一段）改写为 Interrupt 口径。

- `packages/core/src/domain/tool/builtin/register-builtin-tools.ts:70` 的闭包 `call: (toolName, args, signal) => connectionManager.callTool(...)` 直接透传，类型自动跟随，无代码改动。
- `apps/mobile/src/services/mcp-request-adapter.ts` 不改：它对着 requestFn 契约（AbortError 在 transport/requestFn 层仍是取消的运输格式，被 `settlePromise` 收进 Result 后由 failCall 判定），callTool 契约变化不影响该层。
- `McpFailure` 模型不动（7 kind 保持）。错误码与用户可见文案不变；`packages/core/test/mcp/` 下钉「callTool reject AbortError」的用例改为断言 Interrupt 返回。
- `docs/Iterations/mcp-support/spec.md`：§五「callTool 对 AbortError 原样 reject 透传」的取消通道描述同步改写。

## 3. C 智能体运行收尾不再用异常做跳转（⑤组，第二轮）

### 3.1 agent-runner.ts：提取具名收尾函数

在 `run()` 内、`handleAbort`（agent-runner.ts:230-232）之后定义闭包 `finishRunFailure`（与 handleAbort 并列，闭包形态的理由同 handleAbort 的 keep-closure 先例——收尾需要读 run() 的 `sessionId / projectId / runId / persistMessages / assistantAppendedInRun / session / bus / publishRunLifecycle` 等局部状态，参数化需一个巨型 params 对象且丢闭包可读性）：

```ts
/**
 * 已知失败的统一收尾（自主 catch else 分支提取）。入口先做**取消优先路由**
 * （等价于原主 catch :768 的首条判定——现状任何冒到主 catch 的异常，包括
 * raiseRunError 抛出的 AppError，只要 signal 已中止都会被路由进 handleAbort，
 * 走 FINISHED(cancelled) 而非 FAILED；提取后该判定随函数走，全部调用点行为不变）：
 * - 取消分支：handleAbort + 内联取消收尾（FINISHED 事件、KKV 失效、Result.ok
 *   取消形态——逐项复刻「break 落出主 try 后走 :819-855 正常收尾段」在
 *   stopReason="cancelled" 时的全部效果），不落失败消息、不发 FAILED；
 * - 失败分支：失败消息落库（幂等守卫）→ KKV 失效 → FAILED 事件 → AppError
 *   沿 Result.err 交回；非 AppError 的未知异常保持 throw（转码矩阵「未知
 *   throw」行，策略不动）。
 * 两条分支互斥，终态事件恰好一条。
 */
const finishRunFailure = async (e: unknown): Promise<Result<AgentRunResult, AppError>> => {
    // 取消优先路由（原主 catch :768-770 的判定，随提取搬入）：失败恰逢用户已
    // 点停止时按取消收尾，与现状冒泡到主 catch 的路由逐字一致。
    if (signal?.aborted || (e instanceof Error && e.name === "AbortError")) {
        await handleAbort("catch_abort");
        if (publishRunLifecycle) {
            bus.publish(EVENT_AGENT_RUN_FINISHED, { sessionId, projectId, runId, stopReason, vfsMutated: vfsMutatedInRun });
        }
        void SessionApiPromptTokenEntry.invalidate(deps.sessionKkv, sessionId);
        return Result.ok({ stepsExecuted, finished, stopReason, rounds });
    }
    const runError = e instanceof Error ? e.message : String(e);
    // （以下自 :773-815 逐行搬入，顺序不变）
    if (persistMessages && !assistantAppendedInRun) {
        try {
            const appended = await session.append("assistant", { blocks: [{ type: "text", text: `[生成失败] ${runError}` }] });
            // nm-throw: keep — 失败消息落库失败不掩盖原始失败：喂同函数 catch 记日志后
            // 继续发 FAILED（原 :786 raiseRunError 的字面等价，接住后唯一效果就是下方 catch 的 log.error）。
            if (!appended.ok) throw appended.error;
        } catch (appendError) {
            log.error("failure_message_append_failed", { stage: "failure_message_append", sessionId, projectId, error: appendError });
        }
    }
    void SessionApiPromptTokenEntry.invalidate(deps.sessionKkv, sessionId);  // 闭包外先 const deps = this.deps（原 :800）
    if (publishRunLifecycle) {
        bus.publish(EVENT_AGENT_RUN_FAILED, { sessionId, projectId, runId, error: runError });
    }
    if (e instanceof AppError) {
        return Result.err(e);
    }
    // nm-throw: keep — 主收尾出口的未知异常按转码矩阵保持 reject（Result 的 E 只装业务失败，不谎报），由 IPC 入口壳收口。
    throw e;
};
```

取消分支的等价性逐项核对（对照 break 后的正常收尾段 :819-855）：`stopReason` 已被 `handleAbort` 置 `"cancelled"`，FINISHED payload 的 `stopReason` / `vfsMutated`（读闭包 `vfsMutatedInRun`）与正常段同源；`finished` 在失败点必为 false（只由完成路径 :652 置真）；KKV 走 invalidate（正常段 cancelled 落 :846 else 分支，同款 fire-and-forget）；返回 `Result.ok({stepsExecuted, finished, stopReason, rounds})` 的字段值与 break 落出时一致。两路径发出的终态事件恰好一条（取消分支 return 后不再触达 :819 正常段）。

注意：原 `let runError`（:134）删除（只服务失败路径，收进闭包局部）。`run()` 是实例方法（agent-runner.ts:110），箭头闭包**词法捕获 `this`**——`this.deps` 在 finishRunFailure 里直用即可，无需别名（同在 run() 内的 handleAbort 箭头闭包 ：230-232 即同机制先例）；`const deps = this.deps;` 只是可选的局部别名，两写法语义相同（上方示意按 `deps` 别名写）。主 catch（§3.4）的取消分支保持 `handleAbort("catch_abort")` 后**不 return**、自然落出走正常段——与 finishRunFailure 的取消分支互斥（主 catch 走 finishRunFailure 时已内含同样判定，两条入口不会双发 FINISHED）。

### 3.2 raiseRunError 的 12 处调用点改造（10 处机械 + 2 处例外）

**机械改造 10 处**（无本地 try/catch 截胡，直接换出口）：`if (!x.ok) AgentRunner.raiseRunError(x.error);` → `if (!x.ok) return finishRunFailure(x.error);`。位置：agent-runner.ts:263、:314、:341、:383、:402、:415、:513、:594、:673、:747。失败恰逢 signal 已中止的边界由 finishRunFailure 开头的取消优先路由保等价（§3.1）。

**例外 2 处**（都在本地 try/catch 内，现状语义是「Err 喂本地 catch 只记日志、run 照常收尾」，机械 return 会翻转语义）：

- :633（空回复占位消息落库，agent-runner.ts:630-644；:636 注释原文「占位落库失败不把成功 run 翻成 FAILED：记日志后照常收尾」）；
- :786（失败收尾里的错误消息落库，随函数体搬入 finishRunFailure，§3.1）。

同款处理：`if (!appended.ok) AgentRunner.raiseRunError(appended.error);` → `if (!appended.ok) throw appended.error;`，并在 throw 上方标：

```ts
// nm-throw: keep — 占位/错误消息落库失败不把 run 翻成 FAILED：喂同函数本地 catch
// 记日志后照常收尾（原 raiseRunError 的字面等价，接住后唯一效果就是 catch 的 log.error）。
```

TS 收窄不破：`return` 与 never 调用同样参与控制流分析，`x.value` 的既有收窄模式（:915-917 注释所述）保持成立，只需更新该注释的表述。

### 3.3 两处内层 catch

取消优先路由已收进 `finishRunFailure` 开头（§3.1），两处内层 catch 都直接换出口，无需各自补 abort 判定：

- **model request catch（:515-521）**：`throw e`（:521）→ `return finishRunFailure(e)`。abort 判定（:516）与 `handleAbort("model_request_catch") + break` 分支保留在前（取消路径不进 finishRunFailure，行为与现状一致，branch 标签是纯文档参数、不涉行为）；走到 `return finishRunFailure(e)` 时若 signal 已中止，finishRunFailure 的取消路由与原「冒到主 catch 被 :768 路由」效果一致。欠账注释（:520）删除。
- **checkpoint capture catch（:727-738）**：log.error 保留；`throw error`（:738）→ `return finishRunFailure(error)`。「capture 失败恰逢 signal 已中止」由 finishRunFailure 的取消优先路由兜住（原路径该 throw 冒到主 catch 走 `handleAbort("catch_abort")`，现在走同一 handleAbort 标签的同款分支）。欠账注释（:737）删除。

### 3.4 主 catch 瘦身（:767-817）

```ts
} catch (e: unknown) {
    if (signal?.aborted || (e instanceof Error && e.name === "AbortError")) {
        // catch 命中 AbortError：走统一 abort 处理（保留 partial）
        await handleAbort("catch_abort");
    } else {
        return finishRunFailure(e);
    }
}
```

大 try 之后只兜未知异常（模型传输层抛错、未预期 bug）；try 后的正常收尾段（:819-855，FINISHED 事件 + KKV 写/失效 + `Result.ok`）逐字不动。「未知异常保持 throw」策略不动（策略现在落在 finishRunFailure 末尾）。

**取消（handleAbort）与失败（finishRunFailure）两条收尾路径的共用与不重复**：

- **终态事件恰好一条**：收尾在 finishRunFailure 入口处分岔——取消形态（`signal?.aborted` / AbortError）走内部取消分支发 FINISHED 后 return；失败形态走失败分支发 FAILED 后 return，不再触达 ：819 正常段。主 catch 的取消分支不经 finishRunFailure（直接 `handleAbort` + 落出走正常段 FINISHED），finishRunFailure 的取消分支与其行为逐项一致（§3.1 等价性核对）；两处取消入口互斥（主 catch 首条判定接住的不会进 else 分支），不会双发。run-agent-turn 侧的 `runnerEmittedTerminal` 观测（run-agent-turn.ts:1063-1064）照旧把真实 FAILED 置真，不会补发 FAILED('')。
- **不重复落库**：失败消息只在 finishRunFailure 失败分支落（`assistantAppendedInRun` 幂等守卫随闭包保留，豁免注释 ：775-782 一并搬入）；取消路径（两个入口都不落）不落失败消息（保留 partial assistant，:230-232 注释语义）。capture 失败消息（:730-736 的 log）只是日志不是落库，不涉重复。
- **KKV 失效各一次**：失败路径在 finishRunFailure 失败分支内（原 ：800）；取消/完成路径走主 catch 入口的 try 后 else 分支（原 ：846）或 finishRunFailure 取消分支内联的同款失效。入口互斥故不重复，fire-and-forget（不 await）保持。

### 3.5 删除 raiseRunError

`AgentRunnerHelpers` 接口（:918-921）删 `raiseRunError` 成员（只剩 `wrapStreamForBus`）；`AgentRunner` 对象的实现（:925-933）删除；:501、:915-917、:926-929 的关联注释同步改写。

### 3.6 run-agent-turn.ts：同款处理

1. **提取 `finishTurnFailure`**（run() 内闭包，声明在收口 try 之前——主 catch 与 try 内 return 共用；无 await，同步函数）：

```ts
/**
 * 已知失败的统一收尾（自主 catch 提取）：终态补发判定（runnerEmittedTerminal）→
 * onRunFailed 判定（runnerEntered）→ AppError 沿 Result.err 交回；未知异常保持
 * throw（转码矩阵「未知 throw」行，IPC 入口壳收口）。终态事件恰好一条：
 * 补发 FAILED('') 只在 core 全程没发过真实终态时发生。
 */
const finishTurnFailure = (error: unknown): Result<AgentRunResult, AppError> => {
    if (!runnerEmittedTerminal) {
        AgentTurnRunner.safePublish(runtime, EVENT_AGENT_RUN_FAILED, {
            sessionId: scope.sessionId,
            projectId: scope.projectId,
            runId: "",
            error: error instanceof Error ? error.message : String(error),
        });
    }
    if (runnerEntered) {
        options?.onRunFailed?.({ stage, error, scope, savedModelId: failureSavedModelId ?? "", stream });
    }
    if (error instanceof AppError) {
        return Result.err(error);
    }
    // nm-throw: keep — 主收尾出口的未知异常按转码矩阵保持 reject，由 IPC 入口壳收口。
    throw error;
};
```

主 catch（:1092-1131）瘦身为 `catch (error) { return finishTurnFailure(error); }`，:1093-1130 的三段长注释压缩搬入闭包 doc（判据一/判据二的原文语义保留）。

2. **:1084** `if (!runResult.ok) AgentTurnRunner.rethrowRunFailure(runResult.error);` → `if (!runResult.ok) return finishTurnFailure(runResult.error);`（内层 finally 的终态观测退订 :1086-1090 在 return 前照跑）。

3. **runChildAgent 三处（:1370、:1422、:1546）→ 直接 `return Result.err(x.error)`。** 等价性论证（依赖 §0 第 4 条 的冒泡链核实）：改前 rethrow 的 AppError 经 subagent-tool run 透传 reject（subagent-tool.ts:237-238 上方无 try/catch），被 `ToolRunner.call` 的 catch 收 `normalizeToolFailure`（tool-runner.ts:151）→ 父 run 的工具失败 outcome；改后 err 沿 `subagent-tool.ts:238`（`if (!runOutcome.ok) return Result.err(runOutcome.error)`）→ `ToolRunner.call` :131 的**同一条** `normalizeToolFailure` 出口（TOOL_PASSTHROUGH_KEYS 直通判定相同）→ 最终 outcome 逐字相同。finally 反注册（:1548-1560）两形态都照跑。孙代理递归同理逐层透传。:1544-1545 的「转异常冒泡（本函数无 catch……）与旧 throw 通道逐字一致」注释改写为「沿 Result 交回 task 工具，经 ToolRunner 归一出口收编（与改前异常通道同口）」。

4. **assembleSkillsToolContext 的转抛一并收掉**（run-agent-turn.ts:352-365，:360-361 的欠账 throw）：签名前 `Promise<BuiltinToolSkillsContext | undefined>` → 后 `Promise<Result<BuiltinToolSkillsContext | undefined, AppError>>`（成功 → Result.ok(ctx)；技能工具未注册 → Result.ok(undefined)；读取失败 → Result.err(effective.error)，不再 throw）。两个调用点：
   - 主装配点 ：927：`const skills = await AgentTurnRunner.assembleSkillsToolContext(...); if (!skills.ok) return finishTurnFailure(skills.error);`（原 throw 进主 catch → FAILED('') 补发 + Result.err，finishTurnFailure 逐字覆盖）；
   - 子装配点 runChildAgent :1382：`if (!skills.ok) return Result.err(skills.error);`（原 throw 经工具链被 ToolRunner.call 收编，与 §3.6-3 同口等价）。

   **测试适配（grep 全仓引用核实：生产调用恰为上述两处，测试侧有 3 处直接调用）**：`packages/core/test/tool/skill-tool.test.ts:509-553` 的 describe「assembleSkillsToolContext（主/子两装配点共用）」——:527、:534、:552 直接 `await AgentTurnRunner.assembleSkillsToolContext(...)`。断言随新契约改（意图逐字保留）：
   - :526-529 与 :547-553 的 undefined 用例：`const r = await AgentTurnRunner.assembleSkillsToolContext(...); assert.ok(r.ok); assert.equal(r.value, undefined);`
   - :531-545 的字段用例：`const r = await ...; assert.ok(r.ok); const ctx = r.value; assert.ok(ctx != null); assert.equal(ctx.projectId, "proj-9"); assert.equal(ctx.effective.length, 2);`（:542-544 的 effectiveSkills 调用记录断言不动）。
   该文件挂 ⑤ 组改造（§6），回归在 test/tool 目录跑（§7）。

5. **删除 rethrowRunFailure**：接口成员（:262）、实现（:315-318）、:256-259 的 never 收窄注释同步更新（`return finishTurnFailure(...)` 同样参与收窄）。

## 4. D SQL 模板解析器改用 Result（②组）

### 4.1 边界选择（先读，决定调用方改法）

**解析器内核全 Result 化；tdbc 桥（TdbcTemplate）是唯一的 Result→reject 转码边界。** 理由：

- 全仓 30+ 个仓储/服务持有 `SqlTemplateParser`，查询全部经 `TdbcTemplate.query/execute`（grep 核实：`packages/core/src/domain/**/impl/sqlite-*.repository.ts` 等，清单见 §4.5）；这些模板全是代码内常量，解析失败 = 编程错误。把 `Result` 推给几百个仓储调用点，等于为不可达分支付全仓改造成本（SKILL §3「这个 Result 真的有失败分支吗」）。
- `TdbcConnection.execute/query` 的平台契约本来就是 reject（`packages/core/src/infra/tdbc/ports/connection.port.ts:10-11`「Implementations must reject with {@link TdbcError} `CONNECTION_CLOSED` after {@link close}」、:35「Nested calls throw `NESTED_TRANSACTION`」）——模板解析失败沿同一 reject 通道上行，bootstrap 事务回滚语义不变（现状就是 reject，背景事实 5）。
- `template-helper.ts` 位于 throw-audit 白名单 `tdbc-driver` 类内（throw-audit.ts:95：`packages/core/src/infra/tdbc/` 前缀 → ALLOWED），边界 throw 的盘点成本为零。

### 4.2 签名前后对照（全部列全）

**parser.ts（`SqlTemplateParse` namespace，递归下降内核）**：

| 函数 | 前 | 后 |
|---|---|---|
| parseToAst | `(template: string): AstNode[]` | `(template: string): Result<AstNode[], SqlTemplateError>` |
| parseChildren | `(template, pos, closeTag): AstNode[]` | `(template, pos, closeTag): Result<AstNode[], SqlTemplateError>` |
| parseNodesUntilClose | `(template, pos, closeTag, nodes): boolean` | `(template, pos, closeTag, nodes): Result<boolean, SqlTemplateError>`（true=遇闭合标签，语义不变） |
| readCloseTag | `(template, offset): { name: string; end: number }` | `(template, offset): Result<{ name: string; end: number }, SqlTemplateError>` |
| readOpenTagHeader | `(template, offset, tagName): { attrs: Map<string, ParsedAttribute>; bodyStart: number }` | `(template, offset, tagName): Result<{ attrs: Map<string, ParsedAttribute>; bodyStart: number }, SqlTemplateError>` |
| requireAttr | `(attrs, name, tagName, offset): ParsedAttribute` | `(attrs, name, tagName, offset): Result<ParsedAttribute, SqlTemplateError>` |

18 处 `throw new SqlTemplateError(...)`（parser.ts:32、:48、:89、:101、:120、:123、:133、:146、:203、:225、:244、:247、:252、:258、:268、:279、:297、:305）→ `return Result.err(new SqlTemplateError(...))`（构造参数逐字不动：码、message、offset/tagName 全保持）。

**递归下降短路模式（不许 helper 再抛）**——每个递归调用点解包透传，错误原对象接力（offset/tagName 不丢、不二次包装）：

```ts
// parser.ts:149 前后对照（parseNodesUntilClose 内）
const { attrs, bodyStart } = SqlTemplateParse.readOpenTagHeader(template, start, tagName);   // 前（失败即 throw）
// 后：
const opened = SqlTemplateParse.readOpenTagHeader(template, start, tagName);
if (!opened.ok) return Result.err(opened.error);
const { attrs, bodyStart } = opened.value;
```

子递归同理，解包点全清单：:30（`parseToAst` 内）与 ：155/:160/:175/:186/:214/:229 的 `parseChildren` 调用、:117（parseNodesUntilClose 内）与 ：234（choose 分支内）的 `readCloseTag`、:149/:211/:227 的 `readOpenTagHeader`（:211 是 `<when>` 头、:227 是 `<otherwise>` 头）、:154/:165-166/:212 的 `requireAttr`——形态统一为 `const x = SqlTemplateParse.fn(...); if (!x.ok) return Result.err(x.error);`。`parseChildren` 对 `parseNodesUntilClose` 的调用（:43）同款。choose 分支 while 循环内的失败（:203、:225、:244、:247）直接 `return Result.err(...)`（原 throw 位置即 return 位置，控制流不变）。

**expression.ts（`SqlTemplateExpression`）**：

| 函数 | 前 | 后 |
|---|---|---|
| evaluateTest | `(expr: string, stack: ContextStack, options?: EvaluateTestOptions): boolean` | `(expr: string, stack: ContextStack, options?: EvaluateTestOptions): Result<boolean, SqlTemplateError>` |

3 处 throw（expression.ts:104 空表达式、:107 禁止语法、:119 catch 转包）→ `Result.err`；:119 的 `cause` 载荷保持（`new SqlTemplateError("EXPRESSION_ERROR", msg, { ...errorOptions, cause: err })`）。`mapOutsideStringLiterals` / `normalize` / `bindToContext` 纯函数不抛，签名不动。`new Function` 编译缓存（:112-116）不动。

**evaluator.ts（`TemplateEvaluator`，非 throw 但短路链必须打通）**：

| 函数 | 前 | 后 |
|---|---|---|
| evaluate | `(nodes: AstNode[], params: Record<string, unknown>): SqlParseResult` | `(nodes: AstNode[], params: Record<string, unknown>): Result<SqlParseResult, SqlTemplateError>` |
| evaluateNodes | `(nodes, stack, state): void` | `(nodes, stack, state): Result<null, SqlTemplateError>`（void 无失败通道，成功值无意义用 null） |

两个 `evaluateTest` 调用点（evaluator.ts:49、:98）解包短路：`const test = SqlTemplateExpression.evaluateTest(...); if (!test.ok) return Result.err(test.error); if (!test.value) break/skip;`。foreach 的 `items.forEach((item, index) => {...})`（:71-83）回调内递归——forEach 无法短路，改 `for (let index = 0; index < items.length; index++)` 循环（迭代顺序不变），命中失败立即 `return Result.err(...)`。default 分支的 `_exhaustive: never`（:109-112）是穷尽断言，不动。

**对外入口（sql-template/index.ts:50）**：

前：`parse(template: string, params: Record<string, unknown>): SqlParseResult`
后：`parse(template: string, params: Record<string, unknown>): Result<SqlParseResult, SqlTemplateError>`

`TemplateParser.parse`（parser.ts:321-327）：返回类型 `Result<AstNode[], SqlTemplateError>`；**缓存只存成功结果**（`if (!ast.ok) return ast; this.astCache.set(template, ast);`）——失败不缓存，与 throw 时代「失败路径无缓存副作用」一致。

### 4.3 TdbcTemplate 桥（Result→reject 唯一边界）

`packages/core/src/infra/tdbc/logic/template-helper.ts:18-29`，`execute` 与 `query` 同款：

```ts
async execute(connection: TdbcConnection, parser: SqlTemplateParser, template: string, params: Record<string, unknown>): Promise<ExecuteResult> {
    const parsed = parser.parse(template, params);
    // nm-throw: keep — tdbc 驱动层 reject 契约（TdbcConnection.execute/query 契约即
    // reject：CONNECTION_CLOSED / NESTED_TRANSACTION，connection.port.ts:10-11/:35），
    // 模板解析失败沿同一 reject 通道上行，仓储调用点的错误语义不变；本文件在
    // throw-audit 白名单 tdbc-driver 类内（throw-audit.ts:95）。
    if (!parsed.ok) throw parsed.error;
    return connection.execute(parsed.value.sql, parsed.value.parameters);
}
```

### 4.4 调用方分类与改法（grep 核实）

直接消费 `parser.parse` 的生产点全清单（grep -rn "\.parse(" 过滤 safeParse/JSON.parse/parseInt 与其它 Parser 类型后实测，与 `SqlTemplateParser` 实例相关的共四处）：template-helper.ts:19/:27（§4.3 桥）、sql-template/index.ts:51（入口自身）、tdbc-conformance/src/suite.ts:287、sqlite-message-checkpoint.repository.ts:68。据此调用方分三类：

- **(a) 走 TdbcTemplate 的（零改动）**：`packages/core/src/domain/**/impl/sqlite-*.repository.ts`（agent-definition、base-sqlite-chat、kkv、provider、saved-model、session-kkv、session-run-state、skill-disabled-rule、smart-sort-rule、usage-record、vfs-content-store、vfs-entry、vfs-revision、workplace）+ `packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts`、`sqlite-project.repository.ts` + `packages/core/src/domain/provider/logic/find-saved-model-references.ts`、`packages/core/src/domain/session-kkv/logic/deferred-file-cache-gc.ts`、`packages/core/src/service/chat/impl/usage-stats.service.ts`、`packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts`、`packages/core/src/infra/sksp/impl/base-sqlite-secret-store.ts`、bootstrap 六件（行号均指逐文件 grep 实测的 TdbcTemplate.query/execute 调用行：novel-master-bootstrap.ts:268/:340、provider/seed-builtin-providers.ts:28、schema-align/schema-column-alignments.ts:116、schema-migrations/schema-migrations-table.ts:29/:39、skills/seed-builtin-skills.ts:173/:195、smart-sort-rule/builtin-smart-sort-rules.ts:130）。这些文件只 new parser 并传给 TdbcTemplate，parse 返回类型变化被桥吸收，**零代码改动**。
- **(b) 直接调 parser.parse 的（解包，共两处生产点）**：
  1. `packages/core/src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts:68`——模块级私有 `insertMultiValues`（:56-70，`seedCheckpoints` 端口方法的分块播种）内 `const rendered = parser.parse(template, { rows: chunk });` + `await conn.execute(rendered.sql, params);`。改为：

     ```ts
     const rendered = parser.parse(template, { rows: chunk });
     // nm-throw: keep — 仓储方法的失败契约就是 reject（:54 注释原文「块内失败时抛错，
     // 由外层事务整体回滚（调用方均在事务内）」，seedCheckpoints 经端口被 ForkCopySeeder
     // 的 seed 事务调用）：解析失败沿同一 reject 通道触发整体回滚，与 TdbcTemplate 桥同口。
     if (!rendered.ok) throw rendered.error;
     await conn.execute(rendered.sql, params);
     ```

     该文件不在 throw-audit 白名单（tdbc-driver 只认 `packages/core/src/infra/tdbc/` 与 `packages/tdbc-*` 前缀，throw-audit.ts:95），`insertMultiValues` 也不是 `.transaction(fn)` 的回调实参——靠上面的 `nm-throw: keep` 注释判 KEEP（理由点名契约与接住方：seedCheckpoints 调用链的事务回滚）。不登记 UNTRIAGED。
  2. `packages/tdbc-conformance/src/suite.ts:287`（C10 套件）——`const parsed = parser.parse("INSERT …", { id: 5, label: "from-parser" }); if (!parsed.ok) throw parsed.error;`（套件属测试性消费，assert 解包亦可；保持「模板坏 → 测试红」意图）。
- **(c) 导出面**：`packages/core/src/index.ts:9-10` 的导出符号不变（`SqlTemplateParser` / `SqlTemplateError` / `SqlTemplateErrorCode` / `SqlParseResult` 等）；返回类型变化随类型导出自然生效，`SqlTemplateError` 类保留（Result 的 E 用它）。apps 侧无 `SqlTemplateParser` 直接消费（grep 核实零命中）。
- **(d) 对应测试**：`packages/core/test/infra/sql-template/`——`assert.throws(SqlTemplateError)` 的用例改为 `Result` 断言（`!ok && error.code === "UNCLOSED_TAG"` 等）；错误码、offset、tagName 断言逐字保留（测试意图不变：坏模板仍被拒且携带定位信息）。`packages/core/test/infra/tdbc/` 与 bootstrap 测试不需改（reject 语义未变）。

### 4.5 观察项（不在本轮改）

`SqlTemplateErrorCode` 的 `INVALID_COLLECTION`（errors.ts:7）全仓无生产者（grep 仅命中类型定义），属无生产者的死码候选——不在本任务范围，留给后续内联轮次。

## 5. E 盘点工具新增「转抛 helper」检测：T7/T8（③组）

### 5.1 形态编号与定义

`tools/nm-style/src/rules/throw-audit.ts` 扩两个形态（文件头注释 :2-10、`ThrowForm` 类型 :42 同步）：

- **T7 转抛 helper 定义站点**：函数（FunctionDeclaration / MethodDeclaration / PropertyAssignment 的箭头函数 / VariableDeclaration 的箭头函数）满足全部条件：
  1. 返回类型标注为 `never`（`retBucketOf` 已有 never 桶，:163-175）；
  2. 函数体是单条 `ThrowStatement`；**或**体是单条 `ReturnStatement` 且返回表达式是对某个 T7 的调用（传递链，两遍收集到不动点：先收直接形态，再扩展「体只 return 调用已知 T7」的候选，直到不再新增）；
  3. 不属断言豁免（见 §5.2）。
- **T8 转抛 helper 调用站点**：任意 `CallExpression`，callee 为裸 `Identifier` 或 `PropertyAccessExpression`（末段标识符命中 T7 名单——覆盖 `AgentRunner.raiseRunError(x)` / `AgentTurnRunner.rethrowRunFailure(x)` 的对象属性调用形态）。`ThrowSite` 增加可选字段 `helper?: string`，T8 站点填 helper 名（任务要求的「每一处调用带 helper 名」）。

**站点键文本（baseline 键的身份成分）**：T8 取 CallExpression 原文空白归一（含实参，与 T1-T6 的「语句原文」惯例同构）；T7 定义站点取**合成文本** `never-throw helper: <名>`。合成文本的理由：T7 若取函数体内 throw 语句原文（如 `throw error;`），会与 baseline 既有的 T6 键碰撞——`raiseRunError` 体内的 `throw error;` 本就是 `scripts/throw-audit-baseline.json` 已登记条目（实测存在键 `packages/core/src/service/agent/impl/agent-runner.ts#throw error;`），而 `throwGateCompare`（throw-audit.ts:321-337）只查键存在不查 form，撞键会让 T7 站点被误判「已登记」。合成文本后 T6 与 T7 并存各占一键：baseline 重写时 T7 入 UNTRIAGED（T6 沿用既有登记），⑤ 删除 helper 后两键一起 dropped。

**检测边界（如实声明）**：T7 按「返回类型**标注**为 never」判定（`retBucketOf` 只读显式 typeNode，:163-175，typeNode 缺失即 none 桶）——这是任务 E 的字面定义口径。四类形态不在 T7/T8 范围内，逐一声明：

- ①未标注但恒抛的函数（TS 推断 never）——判定需要 type checker 的推断类型，AST-only 做不到，本轮不扩（若后续要扩，需在 `throwSitesOfText` 之外引入 `ts.createProgram` 做类型检查，成本另评）；
- ②多语句体的 helper（如「清理后 throw」形态）——不属于「转抛 helper」定义（那是 catch-清完再抛，由 T1-T6 的 catch 判定覆盖）；
- ③间接引用调用（`const r = AgentRunner.raiseRunError; r(e);`）——callee 是不在名单里的局部名，不产生 T8 站点；
- ④元素访问调用（`AgentRunner["raiseRunError"](e)`）——callee 非 Identifier / PropertyAccessExpression，不产生 T8 站点。

③④需刻意改写才能绕过，现实代码未出现（grep 核实无此形态），按「边界如实声明、不扩口径」处理。因此 T7/T8 的盘点覆盖面 = 显式标注 never 的转抛 helper、其直呼调用（裸标识符与属性访问链），设计按此口径验收。

### 5.2 断言类豁免（不算转抛 helper）

满足任一条即不产生 T7/T8 站点：

- 名字以 `assert` 开头（大小写不敏感，覆盖 `assert` / `assertNever` / `assertXxx`——SKILL §3「编程错误不占产品码」的合法不变量通道）；
- T7 函数体 throw 的表达式含 `new AssertionError(...)`（名字不带 assert 的断言别名豁免）。

`nm-throw: keep` 注释**不豁免收集**：带 keep 的 T7/T8 照常产生站点，verdict 判 KEEP（与 T1-T6 的 KEEP 优先矩阵一致，verdictOf :231-237 不改）。

两条豁免叠加核过误报方向（第 2 轮评审核实）：`packages/core/src/common/assert.ts:16` 的 `assert` 函数体是单条 `if`（:18 throw 在 if 内，不是单条 `ThrowStatement`）——连 T7 的体形态条件都不满足，加上名字豁免是**双重不命中**；`AssertionError` 类真实存在（assert.ts:10），别名豁免（条件 2）不是死条款。当前生产代码未发现会被误报的断言 helper。

### 5.3 判定规则与实现落点

- 收集与扫描都在 `throw-audit.ts`：T7 收集器挂进 `throwSitesOfText`（:266-271）的文件解析流程（新增一个 `collectT7Sites`，与 `collectThrowSites` 并列跑同一 SourceFile）；T8 依赖 T7 名单，需要**两遍扫描**——先扫全部文件收 T7 名单，再对每个文件跑 T8 收集。`scanThrowAudit`（:290-302）改为两阶段：pass1 收全量 T7 + 各文件 T1-T6/T7 站点；pass2 用全量 T7 名单补收 T8 站点。
- verdict 沿用现有矩阵（KEEP > ALLOWED > VIOLATION > BOUNDARY > VIOLATION-B）：
  - T7 定义站点：ret 桶 = never → 落 VIOLATION-B（无 catch）——这类 helper 的唯一修法就是删除，判定正确；
  - T8 调用站点：按所在函数返回形态判——`agent-runner.run`（async-result）里的 12 处 → VIOLATION、`run-agent-turn` 侧 4 处按所在函数形态各判；普通函数有 catch → BOUNDARY；无 catch → VIOLATION-B。
- 站点键同构：`${file}#${text}`（text = 站点原文空白归一；T8 取 CallExpression 的 `getText()` 归一，含实参）。同文件同文本的多个调用点共享一个 baseline 条目（与 T1-T6 对同文本 throw 的既有处理一致——agent-runner.ts:594 与 :633 的 CallExpression 原文同为 `AgentRunner.raiseRunError(appended.error)`，共享键）。
- 白名单（`ALLOWED_FILE_RULES` :93-97）与事务回调判定对 T7/T8 照常适用（`allowCategoryOf` 以站点节点入参，T7 传函数节点所在位置、T8 传调用点位置，`isTransactionCallbackArgument` 需兼容「祖先函数」语义不变）。

### 5.4 与 baseline / gate 的关系（时序）

1. ③ 落地 T7/T8 后，`nm-style throw-audit --gate` 会把存量站点判为未登记阻断。站点键推算（按 §5.3 的「同文件同文本共享键」规则）：

   | helper | 定义键 | 调用键 | 合计 |
   |---|---|---|---|
   | raiseRunError | 1（`never-throw helper: raiseRunError`） | 10（12 处调用中 :594/:633/:786 的 CallExpression 原文相同——`AgentRunner.raiseRunError(appended.error)`，按 §5.1/§5.3 的 T8 键口径归一空白后共 1 键，其余 9 处文本互异） | 11 |
   | rethrowRunFailure | 1（`never-throw helper: rethrowRunFailure`） | 4（:1084/:1370/:1422/:1546 文本互异） | 5 |

   **合计 16 个站点键**。与既有 baseline 键的关系：raiseRunError 体内的 `throw error;` 与 run-agent-turn 内层的 `throw e;` 等 T6 站点已被现行 baseline 登记（实测键 `packages/core/src/service/agent/impl/agent-runner.ts#throw error;` 等存在）——T7 用合成文本（§5.1）不与之碰撞，两键并存。
2. **baseline 由流程统一重写**（本设计不改 `scripts/throw-audit-baseline.json`——任务硬规则）：③ 合入后流程跑 `nm-style throw-audit --write-baseline`，16 个键入表为 UNTRIAGED（gate 不拦但报告首行显数）。
3. ⑤ 完成后 raiseRunError / rethrowRunFailure 全部删除，16 个键进入 `dropped`（throwGateCompare :335 已有该通道），欠账清零。全仓现状无第三个 never-throw helper（grep `): never {|: never =>` 生产代码仅上述两处；§5.1 的传递链形态当前无实例，检测器仍须支持）。
4. 文字同步：`tools/nm-style/src/cli.ts:34`（帮助文本「六形态」→「八形态」）、:591（形态图例补 T7/T8）、`.agents/skills/nm-code-style/SKILL.md:54`（「抛异常的写法只有六种」段补 T7/T8 与「断言豁免」口径）。

### 5.5 工具自测

`tools/nm-style/test/` 新增 T7/T8 用例（走 `throwSitesOfText` 内存构造）：never+throw 定义被报（T7，**两种形态都钉**——对象字面量 MethodDeclaration（`raiseRunError(error: unknown): never {` 即真实形态，全仓两处实例皆是）与 PropertyAssignment 箭头）、裸调用与属性链调用各报一条 T8（带 helper 名）、`assertXxx` 与 `throw new AssertionError` 豁免、keep 注释判 KEEP、传递链（body 只 return 调用另一 T7）被报。运行命令见 §7。

## 6. 分工与波次（五组互不等待）

| 组 | 波次 | 文件清单 | 依赖 |
|---|---|---|---|
| ① 工具系统 | 第一轮 | `packages/core/src/domain/tool/logic/tool-runner.ts`（§1.2/:142-152、§1.4/:201-206 注释）；`packages/core/test/tool/` 相关用例断言更新 | 无 |
| ② SQL 模板 | 第一轮 | `packages/core/src/infra/sql-template/parser.ts`、`expression.ts`、`evaluator.ts`、`index.ts`；`packages/core/src/infra/tdbc/logic/template-helper.ts`；`packages/tdbc-conformance/src/suite.ts:287`；`packages/core/src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts`（:68 解包，见 §4.4(b)——严格说越出②的任务清单、属⑤的「其余消费方」，单文件单函数改动，归②顺手改，归属请主代理确认）；`packages/core/test/infra/sql-template/`。其余 bootstrap 与仓储调用方零改动 | 无（与①③完全无关） |
| ③ 盘点工具 | 第一轮 | `tools/nm-style/src/rules/throw-audit.ts`、`tools/nm-style/src/cli.ts`（文字）、`.agents/skills/nm-code-style/SKILL.md`（:54）、`tools/nm-style/test/`。baseline 由流程统一重写 | 无（与①②完全无关） |
| ④ MCP | 第二轮 | `packages/core/src/domain/mcp/ports/mcp-connection.port.ts`、`packages/core/src/infra/mcp/impl/create-mcp-connection-manager.ts`、`packages/core/src/domain/mcp/logic/to-nm-tool.ts`；`packages/core/test/mcp/`；`docs/Iterations/mcp-support/spec.md`。register-builtin-tools.ts 类型自动跟随无改动 | 逻辑上独立（callTool 契约变化不依赖①代码）；按任务要求排第二轮，回归跑在①之后 |
| ⑤ 智能体收尾 | 第二轮 | `packages/core/src/service/agent/impl/agent-runner.ts`、`packages/core/src/service/agent/logic/run-agent-turn.ts`、`packages/core/test/tool/skill-tool.test.ts`（assembleSkillsToolContext 三用例断言随新契约改，§3.6-4）；`packages/core/test/agent/` 回归。A 的消费方适配经 §1.5 核实为零代码改动（agent-runner 与 user-vfs-turn 链均无需改） | ①的新契约（test/tool 回归口径）；C 本身不依赖④ |

## 7. 验证命令（各组改完必跑）

```bash
# 类型检查（①②④⑤ 各自跑）
node D:/worktree/mcp-support/node_modules/typescript/bin/tsc --noEmit -p packages/core/tsconfig.json   # cwd=D:/worktree/mcp-support

# core 测试（按组）
cd D:/worktree/mcp-support/packages/core && node scripts/run-tests.mjs --dir test/tool      # ①⑤
cd D:/worktree/mcp-support/packages/core && node scripts/run-tests.mjs --dir test/infra/sql-template   # ②
cd D:/worktree/mcp-support/packages/core && node scripts/run-tests.mjs --dir test/infra/tdbc           # ②回归
cd D:/worktree/mcp-support/packages/core && node scripts/run-tests.mjs --dir test/mcp       # ④
cd D:/worktree/mcp-support/packages/core && node scripts/run-tests.mjs --dir test/agent     # ⑤
cd D:/worktree/mcp-support/packages/core && node scripts/run-tests.mjs --dir test/tool      # ⑤（skill-tool.test.ts 的 assembleSkillsToolContext 断言随 §3.6-4 新契约改，与 ① 的 test/tool 回归同目录）

# ③ 盘点工具自测（SKILL §8：glob 带引号、并发钉死）
cd D:/worktree/mcp-support/tools/nm-style && node --test --test-concurrency=1 "test/*.test.mjs"

# ③ 落地后、⑤ 完成后各跑一次（baseline 重写由流程统一执行）
nm-style throw-audit --gate
nm-style check --changed
```

不跑 build、不跑 apps 测试（流程统一跑）；不重写 `scripts/throw-audit-baseline.json`；不跑 `npm install`。

## 8. 全局行为差异清单（通道变更豁免范围内的全部差异）

第 2 轮评审的三处 P1 全部按**保等价**修订（§0.1）：:633/:786 保吞掉语义（§3.2 例外处理）、失败恰逢取消走取消优先路由（§3.1）、message-checkpoint 解包保 reject 契约（§4.4）——均不产生新的行为差异条目。清单仍是四处：

1. **D-1（§1.6）**：agent run 内竞速取消的 tool_result 从「错误文案」变「已取消」（AppErrorOps.is 开始命中）。通道统一的直接目的。
2. **D-2（§2.4）**：MCP 工具取消的到达路径从「AbortError reject → catch 转 TOOL_CANCELLED」变为「Interrupt 返回 → 判别转 TOOL_CANCELLED」——模型可见错误码与文案逐字不变，无用户可见差异。
3. **D-3（§3.6-3）**：runChildAgent 失败的到达路径从「reject 穿 task 工具被 ToolRunner.call catch 收编」变为「Result 交回 task 工具走同一 normalizeToolFailure」——最终 outcome 逐字相同，无用户可见差异。
4. **D-4（§4.3）**：SQL 模板解析失败对仓储仍以 reject 冒泡（桥转码），bootstrap 回滚语义不变，无用户可见差异。

「错误码与用户可见文案保持」的硬规则在 D-2/D-3/D-4 上逐字成立；D-1 是任务 A 明确要求的通道统一后果，已显式声明。

## 9. Open questions / blockers

1. **§0 的四处背景事实出入**需要主代理知悉（尤其第 1、4 条——它们直接改变了 A 的形态变化判定与 C 的等价性论证基础；本设计以代码实况为准）。
2. `assembleSkillsToolContext` 的转抛收掉（§3.6-4）超出任务 C 点名的「rethrowRunFailure 删除」字面范围，但它是同一欠账注释（:360）标记的转抛形态、且收口函数已经就位——若主代理认为越界，可从⑤中拆出，不影响其余设计。
3. `sqlite-message-checkpoint.repository.ts`（§4.4(b)）严格说越出任务②的文件清单（它是 parse 签名变化的直接编译受害者，单文件单函数改动）——文档暂归②顺手改，归属（②或⑤）请主代理确认。
4. §5.3 的 T8 两遍扫描会让 `throw-audit` 全量扫描耗时约翻倍（每文件解析两次）——若不可接受，可改为 pass1 缓存 SourceFile 复用；实现组自测后定。

## 10. 落地后回填（2026-11-26）

- §5.4 写的时序没有发生：实际是五组改造全部落地后才一次性重写基线（提交 c88fcc9e0），那 16 个键从未以 UNTRIAGED 入表，直接随 raiseRunError / rethrowRunFailure 的删除而消失。终态与 §5.4 第 3 步一致：gate 通过、UNTRIAGED 0。
- §9-4 的耗时疑问已消解：实现是第一遍扫描缓存语法树、第二遍复用，同一文件只读取并解析一次（tools/nm-style/src/rules/throw-audit.ts 的 throwAuditFiles）。
- 实现时确认的两处检测边界（现仓无实例，如需扩口径另行决定）：表达式体箭头 `(): never => neverFn()` 不产生 T7；`const f = function (): never { … }` 这种函数表达式绑定不在收的四类绑定形态内。
- 随动越出原清单的三个直接调用方（infra/tdbc/logic/template-helper.ts、domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts、packages/tdbc-conformance/src/suite.ts）已按 §4.3 / §4.4(b) 改完（提交 7dc46cf1a）；前两处是「tdbc 查询链只以 reject 报错」这一契约的转码边界，标了 nm-throw: keep。
- 顺带修掉盘点工具的一个旧缺陷（提交 5e5c90fdb）：嵌套闭包规则收集解构声明的名字时递归走错了函数，标识符从未入集，导致主仓上 T-NC6 一直是红的；改走 collectBindingNames 后转绿。这是修工具缺陷，不是放宽检查。
