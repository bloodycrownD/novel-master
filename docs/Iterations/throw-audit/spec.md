# throw-audit：throw 通道重盘 + drivers 风格清账

> 目标仓库：`D:/worktree/error-channel-slim`（分支 `feat/error-channel-slim`）
> 基线：`p25-subject-cluster-apps`（`2a2b38208`）+ 修复提交 `94221e911`
> 目标 tag：`p26-throw-audit`
> 范围裁定（用户拍板）：做 §二 R1/R2/R3/R4；**不做 renderer 359 条 signatures 的规则裁决**（待用户另行决策）

## 一、背景：三个欠账，一个根因

### 1.1 门⑦ 回归：0 → 18 处

五期收口时 `check-unwrap-throw.mjs` FIND=0，现在 **FIND 18**。p24/p25 的 namespace 化与签名改造期间新引入了一批 unwrap throw，另有白名单该登记未登记、cli 未排除（违反 #276）。18 处清单见 §三 R1。

### 1.2 drivers 的 92 条 signatures 违规

新 nm-style 扫描面（1402 文件）下，**packages drivers 桶 92 条**首次可见：`tdbc-driver-op-sqlite` 37（`connection.ts` 25）、`tdbc-conformance` 23、`llm-sse-native` 19（p25 期间新增的包）、`tdbc-driver-better-sqlite3` 6、`sksp-windows` 4 + `sksp-android` 3。driver 代码不是 UI，一行写完规则适用——**机械清**。

### 1.3 throw 扫描的口径漂移

五个 throw 形态的历史账全部失真：

| 形态 | 历史收口 | 现状 |
|---|---|---|
| `throw x.error`（门⑦） | 五期 0 | **18** |
| `throw createAbortError` | 十九期 32→21（白名单+档3） | 口径不明（粗估 2-9） |
| `throw new AppError` | 五期后 47 | 33 |
| `throw new Error` | 九期 211 全处置（保留带 keep） | 65 带标记 / 总数口径不明 |

根因：**所有 throw 盘点都是一次性 grep + 手工定性**，扫描面、过滤正则（反斜杠坑三次）、keep 注释识别全不统一。门⑦ 只覆盖一个形态，其余三个没有工具。

### 1.4 附带：IntegrityRepairOperation 接口缺口

`detect(): Promise<Detection>` / `repair(): Promise<void>` 无失败通道，逼实现者 throw、`runAll` 靠 try-catch 收编（`provider-identity-repair.ts:64/83` 自白注释）。接口是自定义的，应改 Result 通道——与 R1 同一判据域。

## 二、范围

| 编号 | 内容 | 性质 |
|---|---|---|
| R1 | 门⑦ 18 处定性修复 + cli 排除 + 白名单登记 | 回归修复，**最高优先** |
| R2 | packages drivers 92 条 signatures 机械清 | 机械改造 |
| R3 | throw-audit 规则进 `tools/nm-style`（四形态工具化 + baseline + gate） | 工具开发 |
| R4 | `IntegrityRepairOperation` 接口 Result 化 | 接口改造 |

**执行顺序**：R3 波 0 先出全量表 → R1 按表修复；R2 / R4 与 R1 并行（零交集）。

## 三、R1：门⑦ 18 处定性修复

现有 18 处（门⑦ 实跑输出），**执行者用 R3 的表重新定性，不盲照抄本预判**：

```
apps/desktop/src/main/ipc/handlers/agent-registry.ts:221        throw def.error;
apps/mobile/src/services/session-stream-unit-manager.service.ts:1058/1109
apps/mobile/src/services/session-stream-unit.ts:1230/1288
apps/mobile/src/services/vfs-character-card.service.ts:24
apps/mobile/src/services/yaml-shared.ts:53
packages/core/src/domain/message-checkpoint/logic/truncate-tail-in-transaction.ts:60
packages/core/src/infra/db-backup/provider-table-snapshot.ts:87
packages/core/src/service/agent/impl/chat-agent-session.ts:48
packages/core/src/service/agent/logic/assemble-agent-runner-deps.ts:69
packages/core/src/service/agent/logic/run-agent-turn.ts:396
packages/core/src/service/agent/logic/run-agent-turn.ts:588
packages/core/src/service/chat/impl/message.service.ts:314/331
packages/core/src/service/chat/impl/session.service.ts:348/351
apps/cli/src/prompt/commands.ts:110   ← 不修，见下
```

判定判据（与门⑦ 一致）：

1. **所在函数返回 `Result`/`Outcome`** → 违规，改 `return r`（或 `return Result.err(...)`），签名沿调用链接力。
2. **返回普通类型 + 同函数有 catch** → 边界转码，**登记 `scripts/check-unwrap-throw.mjs` 的 ALLOW_FILES**，理由写到行注释。预判：`run-agent-turn.ts:396`（`mapResolveError` OrThrow 边界，十八期 T3 已审）、`agent-registry.ts:221`（IPC throw 边界）。
3. **事务回滚 / 控制信号转码** → 白名单登记。预判：`truncate-tail-in-transaction.ts:60`（better-sqlite3 事务内）、`provider-table-snapshot.ts:87`（dump 的 Result 出口 rethrow，若确认边界转码）。
4. **cli 1 处**：不改代码；`check-unwrap-throw.mjs` 扫描面加 `apps/cli` 排除（与 nm-style 的 suppressPrefixes 口径一致）。

## 四、R2：drivers 92 条机械清

| 包 | 文件 | 条数（约） |
|---|---|---|
| `tdbc-driver-op-sqlite` | `src/connection.ts`（25）+ 其余 | 37 |
| `tdbc-conformance` | `src/nested-batch.ts`（20）+ 其余 | 23 |
| `llm-sse-native` | `src/transport.ts`（16）+ `native.ts` | 19 |
| `tdbc-driver-better-sqlite3` | — | 6 |
| `sksp-windows` / `sksp-android` | — | 7 |

规则：
- **只改形态不改逻辑**：实参/形参/声明/赋值/导入合并到一行（`--print-width 200` 宽度内）。超 200 字符的行**不许硬塞**——那说明签名过长，报出来另行处理，不许为过门加参数对象（那是 p23 的活，已做完）。
- 每包独立 commit。
- **改完由主代理串行重建该包 dist**（#279），再跑 apps 测试。禁止子代理并行 build。
- 清理后 `nm-style check --changed <该包>` signatures 段归零才算片完成。

## 五、R3：throw-audit 规则（本轮核心产出）

进 `tools/nm-style`，作为第五条规则（signatures / hygiene / bare-exports / dup / oop 之外）。

### 5.1 扫描四形态

```
T1  throw <expr>.error          （unwrap throw：r.error / x.error / inserted.error / read.error / outcome.error …）
T2  throw createAbortError(...) （裸 AbortError 载荷）
T3  throw new AppError(...)     （业务错误现场构造）
T4  throw new Error(...)        （裸 Error）
```

AST 扫描（吃 symbol-index），每处产出：

```
形态 | file:line | 所在函数（含类方法路径）| 函数返回类型（symbol-index 查，八值形态）| 同函数有 catch? | 邻近 keep 注释?
```

### 5.2 判定矩阵

| 条件 | verdict |
|---|---|
| 函数返回 `Result`/`Outcome` | **VIOLATION**（改 return，唯一修法） |
| 返回普通类型 + 同函数 catch | **BOUNDARY**（合法，但必须登记白名单文件+行，带理由） |
| 命中白名单三类（事务回调 / tdbc 驱动层 / 控制信号转码类名单：`DatabaseReplacedError` / `CoordinatedWriteRollbackError` / `ChatPromptBuildBailedError`） | **ALLOWED** |
| 返回普通类型 + 无 catch | **VIOLATION-B**（该层应改返 Result） |
| 邻近 `nm-throw: keep` 注释 | **KEEP**（进 baseline，需理由） |

### 5.3 命令面与门

```bash
nm-style throw-audit --all            # 全量表（四形态 × 判定）
nm-style throw-audit --gate           # VIOLATION > 0 或未登记 BOUNDARY > 0 → exit 1
nm-style throw-audit --write-baseline # 存量定性后落 baseline JSON
```

- 扫描面：`packages` + `apps` + `tools` 全量（**含 renderer**——throw 不分 UI 与逻辑），排除 `apps/cli`、`dist`、`test`（`--include-tests` 才扫）。
- baseline 首次落盘：把现存 33 处 `new AppError`、`new Error` 带注释存量、`createAbortError` 白名单、门⑦ 登记后的边界转码**逐条定性入表**。定性不了的标 `UNTRIAGED` 并计数——**gate 不拦 UNTRIAGED，但报告必须显总数**（防静默膨胀）。
- 接入 `nm-style check` 汇总行与根 npm script。

## 六、R4：IntegrityRepairOperation 接口 Result 化

```ts
// 现
detect(): Promise<IntegrityRepairDetection>;
repair(): Promise<void>;
// 改
detect(): Promise<Result<IntegrityRepairDetection, AppError>>;
repair(): Promise<Result<void, AppError>>;
```

波及：接口 + 5 个实现（`ProviderIdentityRepairOperation` / `ProviderSecretRenameOperation` / `VfsEntrySequenceRepairOperation` / `BaselineCheckpointBackfillOperation` 等，执行者以 `implements IntegrityRepairOperation` grep 为准）+ `runAll`/`runOnly` 的 try-catch 降级为兜网（只捕平台异常，业务失败走 Result 汇总进报告 `error` 字段）+ 相关测试。

**约束**：报告条目的语义不变——detect 失败与 repair 失败仍各记一条、`needsRepair` 判定逻辑不变。改完跑 integrity-repair 全部测试。

## 七、明确不做

- **renderer 359 条 signatures**：待用户裁决规则适用边界，本轮不碰。
- **apps/cli**：全部 throw / 风格 / 测试不碰（#276）。
- **档3 的 8 处 `throw createAbortError`**（Result 通道设计决策）：R3 出表后下一轮处理，本轮只入表定性。
- **UNTRIAGED 存量的修复**：出表定性是本轮，修复视量另排。
- 不改任何与 throw 无关的逻辑；R2 不改签名结构。

## 八、执行步骤

1. **波 0（R3 工具）**：`throw-audit` 规则 + 四形态扫描 + 判定矩阵 + `--gate` + `--write-baseline`。跑全量出表。产出：四形态全量表 + UNTRIAGED 计数。
2. **波 1（R1，依赖波 0）**：按表修 18 处 + cli 排除 + 白名单登记。门⑦ FIND=0 收片。
3. **波 2（R2，与波 1 并行）**：drivers 四包并行清（每包一片），主代理串行重建 dist。
4. **波 3（R4，与波 1/2 并行）**：接口 Result 化 + runAll 兜网化 + 测试适配。
5. **波 4（收敛）**：根 typecheck + core/desktop/mobile 全量 + `nm-style check`（signatures drivers 桶 0 / bare-exports 0 / dup 新增 0 / throw-audit gate 绿）+ drivers 相关 apps 测试。
6. **波 5**：提交 + tag `p26-throw-audit`（任一项不达标按真实状态提交，tag 加 `-partial` 并写明）。

**分片纪律**（#277）：每片拿到的是按片切好的确定文件清单；R2 各包零交集；R1 与 R4 有潜在交集（`chat-agent-session.ts` 若同时是 R1 修复点与 R4 消费方）——**R1 先动 R4 后动，串行**。

## 九、验收

```
1. 根 typecheck                          exit 0（15 workspace）
2. core / desktop / mobile 全量测试       exit 0
3. 门⑦ check-unwrap-throw.mjs            FIND 0（且不再报 apps/cli）
4. nm-style throw-audit --gate           exit 0；UNTRIAGED 数量写进报告
5. nm-style check --changed packages     signatures 段 drivers 五包 = 0
6. R4 后 integrity-repair 相关测试        全绿，报告语义不变
7. dup-gate                              新增 0
8. 每个 R1 修复点的定性（VIOLATION 修复 / BOUNDARY 登记 / ALLOWED）逐条在 commit message 列明
```

## 十、风险

| 风险 | 缓解 |
|---|---|
| R1 改 `return` 引发签名接力（session/message service 层最深处） | 允许分 commit 逐函数接力；接力链超过 5 层的先停下报「建议单独一轮」 |
| R2 的超长行塞不进 200 宽度 | 明确「不塞硬行」，报出来另行处理；禁止顺手改签名 |
| symbol-index 对 `.tsx` / 匿名函数内的 throw 定位不准 | R3 先在 core 上对拍门⑦ 的 18 处，一致再铺全量 |
| R4 改接口波及 runAll 报告聚合逻辑 | 报告语义不变是硬约束；测试先行（改前记录现有报告断言） |
| drivers dist 与 apps 测试时序 | #279：主代理串行重建；先 build 后 test |
| throw-audit baseline 把未定性存量静默固化 | UNTRIAGED 强制显数 + 报告首行；gate 不放行新增 VIOLATION |
