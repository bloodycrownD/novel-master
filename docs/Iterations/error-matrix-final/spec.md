# 错误通道终态收敛（矩阵下半句废除 + 三控制流类退役）

- 迭代名：error-matrix-final
- 基线：p27-backlog 分支 @ `f8573b7c4`（写 spec 时 HEAD）
- 需求来源：用户三轮裁决（2026-11-21 对话）——
  1. `run(): Promise<Result<void, AppError>>` 返回 Result 却仍 throw，语义劈叉；
  2. `CoordinatedWriteRollbackError` 等 extends Error 自定义类应被四类型收编，不应有白名单外的第三形态；
  3. `DatabaseReplacedError` / `ChatPromptBuildBailedError` 的「跨端协议」理由成本不高，一并收敛；
  4. **矩阵下半句废除**：「未知走 throw」改为未知也走返回值——`INFRA_UNEXPECTED_ERROR` + `cause` 存原始异常；throw 只剩平台强制。

## §一 矩阵修订（新旧对照）

| 失败种类 | 旧矩阵 | 新矩阵 |
|---|---|---|
| 已知业务失败 | `Result.err(AppError)` | 不变 |
| 已知非业务控制流（取消/替换/弃权） | 自定义 extends Error 哨兵 + throw + instanceof | **返回值承载**：`Outcome` 分支 / `Result` 成功值里的哨兵字段（如 `null`） |
| 未知异常 | **throw 穿透**，中间层不吞 | **`Result.err(INFRA_UNEXPECTED_ERROR)`**，`cause` 存原始异常（AppError `params.cause` 双写机制现成：`Error.cause` + details 两条消费路径） |
| 编程错误 / 不变量 | `throw new TypeError` 等散形 | `assert` / `AssertionError`（七期口径，不变） |
| 平台强制 | throw（转码矩阵例外） | **唯一保留的 throw**，见 §一.1 |

### §一.1 平台强制保留清单（终态，不再扩）

| # | 场景 | 理由 |
|---|---|---|
| P1 | better-sqlite3 `db.transaction` 回调内 throw | 驱动靠异常触发回滚，无 Result 通道 |
| P2 | `Promise.race` reject 载荷（timeout/abort 竞速） | Promise 无 Result 通道 |
| P3 | fetch AbortError（`isAbortLikeError` 转码前） | 平台行为 |
| P4 | `AbortSignal.throwIfAborted()` | 平台 API |
| P5 | tdbc 驱动层（`packages/core/src/infra/tdbc/`、`packages/tdbc-driver-*`） | 驱动协议类 `TdbcError`，infra 边界 |

### §一.2 「中间层不吞」原则的新表述

旧原则「中间层不得 catch 未知异常转 Result」作废。新原则：**中间层 catch 未知异常后，若做了资源清理（回滚/释放），清理完成后系统状态已变，原异常不再精确描述当前状态——此时转 `Result.err(INFRA_UNEXPECTED_ERROR, {cause})` 是诚实标记而非伪装**。禁止的仍是「吞」（catch 后不透传不标记）与「降级伪装」（把未知包装成业务 key）。

## §二 extends Error 终态名单

现状 9 文件 / 11 类。本轮后保留：

| 类 | 位置 | 定性 |
|---|---|---|
| `AppError` | `errors/app-error.ts` | 业务错误唯一载体 |
| `AssertionError` | `common/assert.ts` | 编程错误 |
| `TdbcError` | `infra/tdbc/errors.ts` | 驱动协议（P5） |
| `SkspError` | `infra/sksp/sksp-error.ts` | 平台驱动协议（P5 同层） |
| SqlTemplate 错误类 | `infra/sql-template/errors.ts` | 模板解析引擎内部（P5 同层；执行前已转 Result） |
| `llm-sse-native` transport | 三方流边界 | 平台穿透（P3 同层） |
| `tokenizer-driver-rn` bridge | RN 原生桥 | 平台穿透（P3 同层） |

本轮退役 3 个：`CoordinatedWriteRollbackError`（§三 R1）、`DatabaseReplacedError`（R2）、`ChatPromptBuildBailedError`（R3）。
判定器 `CONTROL_SIGNAL_CLASSES`（throw-audit.ts:86）随之清空；「控制信号转码」白名单类别（§5.2）在 spec-2 §2.4 与总纲五登记作废。

## §三 三个类的收敛方案（已侦察，形态写死）

### R1 `CoordinatedWriteRollbackError` → 纯 Result

`packages/core/src/service/coordinated-write.ts`（`run(): Promise<Result<void, AppError>>` 内 4 处 throw）：

| 站点 | 现状 | 改为 |
|---|---|---|
| `:95/:98` `throw new TypeError`（register 校验） | 编程错误 | `assert(cond, msg)`（`common/assert.ts`） |
| `:133` `throw new CoordinatedWriteRollbackError(rootCause, rollbackErrors)` | 回滚阶段失败，携带 `{step,error}[]` 聚合 | `Result.err(new AppError("INFRA_ROLLBACK_DEGRADED", { detail: 动态文案 }, { cause: rootCause }))`，rollbackErrors 结构进 details |
| `:137` `throw rootCause`（未知异常透传） | 矩阵旧下半句 | `Result.err(INFRA_UNEXPECTED_ERROR, { cause: rootCause })`（§一.2：回滚已完成、状态已变，转 Result 是诚实标记） |

- 码表：`INFRA_ROLLBACK_DEGRADED = 110006`（110 段 006 空闲）。
- 类与文件内定义删除；`run-agent-turn.ts:806` 消费分支加 key 分级（`INFRA_ROLLBACK_DEGRADED` → WARN 日志 + FAILED 记账，业务失败照旧），`message-transcript-effects.service.ts` 消费点同核对。
- 行为改进：回滚损坏不再穿 :1119 大兜底（现在混在普通异常里），而是走 :806 显式记账分支。
- 测试 `coordinated-write.test.ts`：`assert.rejects` / catch-name 断言改判 `Result` + key + `details.rollbackErrors`；`failure-injection.ts` 注释同步。

### R2 `DatabaseReplacedError` → 码 + params

port 签名本就是 `Result<{databaseReplaced}, AppError>`；实现绕过签名硬 throw 仅为「Err 分支装不下已换代标志」。收敛：

- 码表：`DB_SYNC_REPLACE_INCOMPLETE = 125015`（125 段 014 已占用，015 空闲）。
- 构造点改 `return Result.err`（函数签名本返 Result 或改返 Result）：
  - `apps/desktop/src/main/services/db-backup.service.ts:154`（`replaceLiveDatabase` 改返 `Result<void, AppError>`；覆盖失败且回滚成功 → `INFRA_UNEXPECTED_ERROR{cause}`；回滚失败分支现有 `INFRA_UNEXPECTED_ERROR` 形态统一）
  - `apps/mobile/src/services/db-backup.service.ts:127`（同构）
  - `providerTablesRestored` 值进 `params`；`detail` 保留现有人读文案（含 recoveryHint）
- 消费点 `instanceof` → `error.key === "DB_SYNC_REPLACE_INCOMPLETE"`：
  - `apps/desktop/src/main/ipc/handlers/cloud-sync.ts:155`：rebootstrap 后 `return {kind:"failed", error}`（**基线 KEEP 站点 `cloud-sync.ts#throw new Error(...)` 一并退役**，handler 不再需要 nm-throw）
  - `apps/desktop/src/main/services/cloud-sync.service.ts:272` 反判 → key 判
  - `apps/mobile/src/services/cloud-sync.service.ts:402` → key 判
- `map-cloud-sync-sdk-error.ts` 透传条件扩 DB_BACKUP 域（现仅 CLOUD_SYNC 域透传；否则 mobile UI 侧「已换代」信息被 map 降级吞掉）。
- core 侧：`infra/cloud-sync/index.ts` 与主 barrel 删导出、`ports/db-sync.port.ts:18` 注释重写、删 `model/database-replaced-error.ts`；`run-scope.ts:106` 注释更新。
- 测试：`apps/desktop/test/db-backup-rollback-safety.test.ts:186`（instanceof → key）、`apps/mobile/__tests__/cloud-sync.service.test.ts:297`（构造 → key 判定）。

### R3 `ChatPromptBuildBailedError` → 返回值哨兵（null）

无状态控制流哨兵（无参构造，8 个构造点：desktop tokens×2 + desktop session-prompt-input×3 + mobile session-prompt-input×3；消费收口双端 `isChipBailError` → null）。语义是「会话已失效，别再算」——与 abort 的 checkpoint 同构；类注释自述「后续迭代再收敛到 Outcome/Interrupt」，即本轮。

形态：**弃权 = 无结果，是数据不是错误**。`buildAdapter` / `computeStats` 链路返回 `Result<T | null, AppError>`，弃权路径 `Result.ok(null)`，调用方判 null 保留旧标签（与现有 `isChipBailError → null` 收口语义逐字对齐）。core 侧已 Outcome 化的 `Outcome.cancelled/replaced` 分支在上层直接映射 null，**删除「Outcome 控制流信号转抛异常哨兵」的反向转码**（desktop `session-prompt-input.service.ts:99-103` 现状注释自述此形态）。

- core：删 `service/chat/model/chat-prompt-build-bailed-error.ts` + 主 barrel 导出。
- desktop：`session-prompt-input.service.ts`（:52/:76/:103）、`chat-prompt-tokens.service.ts`（:251/:423 + `isChipBailError` + :244 注释）——`isChipBailError` 退役。
- mobile：`session-prompt-input.service.ts`×3、`chat-prompt-tokens.service.ts`（`isChipBailError` 同型）。
- 执行时核对：mobile 侧构造点是否与 desktop 逐一对称（侦察显示计数对称 3+3，行号与上游签名执行时逐点核）。

## §四 R4 存量 throw 按新矩阵收敛（174 站点重定性）

基线现状（throw-audit --json 实测）：

| verdict | 数 | 新矩阵定性 |
|---|---|---|
| ALLOWED | 21 | 平台强制白名单（transaction/tdbc 文件规则）——**保留** |
| KEEP | 65 | 带 keep 注释存量——**逐条复核**：R1-R3 连带消一批（如 handler 的 nm-throw）；其余按新矩阵改 Result 或登记平台强制 |
| BOUNDARY | 23 | plain 函数 catch-rethrow 边界转码——新矩阵下仅「平台强制转码」合法（P1-P5）；其余改 Result |
| VIOLATION | 3 | 返回 Result 却 throw——真违规，直接改 |
| VIOLATION-B | 62 | plain 函数 throw——登记债（core T3×13/T1×15/T4×2、mobile T1×14/T4×16/T3×1、desktop T4×4、pkgs×2）——按新矩阵收敛 |

分布：core 53 / mobile 63 / desktop 22 / pkgs 16（cli 已排除）。R4 按「同文件两类 throw 同片」分片（五期纪律），每片先定性表后改码；事务回调内（P1）与 `keep` 且属 P1-P5 的站点登记白名单。

**边界（handler）特别说明**：desktop/mobile IPC handler 内 `try { throw } catch { formatIpcError }` 形态——深层 Result 化后 handler catch 只应收到平台强制；若 catch 体内仍做 `throw new Error` 拼用户文案，改为在 catch 前的 Result 路径直接携带 descriptor（R2 desktop handler 先例）。

## §五 判定器与门禁改动

1. `CONTROL_SIGNAL_CLASSES` 清空（三类退役后 scope 文本判定分支保留但名单为空；确认无消费者后连分支删）。
2. throw-audit 判定矩阵更新：
   - `plain` 返回类型 + T1/T3/T4 → VIOLATION（不变）；
   - **`plain` + catch-rethrow 不再 BOUNDARY**：BOUNDARY 收窄为「P1-P5 文件/语句模式命中」；其余 plain 内 catch 后 rethrow = VIOLATION-B（新矩阵：转 Result）；
   - `Promise<Result/Outcome>` 返回类型的 throw → VIOLATION（不变，R1 前 3 处即此类）。
3. 基线重建（`--write-baseline`）：终态目标 **ALLOWED（P1-P5 白名单）之外全仓 throw 站点 = 0**；gate exit 0。
4. 门⑦（`check-unwrap-throw.mjs`）维持（unwrap 语义已并入 throw-audit）。
5. `extends Error` 计数门：终态 ≤ 7 类（§二名单）。

## §六 波次编排

| 波 | 内容 | 依赖 |
|---|---|---|
| W0 | 码表 2 码（110006 / 125015）+ catalog 重生成 + 单测 | — |
| W1 | R1 CoordinatedWrite（core 单文件 + 码表 + 测试 + 消费方分级） | W0 |
| W2 | R2 DatabaseReplacedError（core port/实现侧 + desktop ×4 + mobile ×3 + mapper + 删类 + 测试 ×2） | W0 |
| W3 | R3 ChatPromptBuildBailedError（core 删类 + desktop ×4 + mobile ×3，null 哨兵链路） | W0 |
| W4 | R4 分片收敛（core / mobile / desktop / pkgs 四片并行；每片先定性表后改码；同文件两类 throw 同片） | W1-W3 |
| W5 | 判定器更新 + 基线重建 + 全量门 + tag `p28-matrix-final` | W4 |

W1-W3 文件交集核查：`db-sync.port.ts` 仅 W2；`session-prompt-input.service.ts` 仅 W3；W1/W2/W3 互斥 ✅。

## §七 验收门（全绿才打 tag）

1. 根 typecheck 15 workspace exit 0；
2. core / desktop / mobile 全量测试绿；
3. `extends Error` 全仓（除 test/cli）类数 ≤ 7，名单与 §二逐字对齐；
4. throw-audit 全量：非平台强制站点 = 0，基线重建后 gate exit 0；
5. `CONTROL_SIGNAL_CLASSES` 为空数组或分支已删；
6. nm-style 三段 + dup-gate + public-ownership PASS（新码与删类引起的导出面变化零悬空）。

## §八 风险与不做清单

- **不做**：`TdbcError` / `SkspError` / SqlTemplate / llm-sse-native / tokenizer-rn 的类收敛（P5 平台协议，属驱动边界；执行前已转 Result 的不变）。
- **不做**：React renderer 的 `throw new Error`（UI 错误边界 catch 渲染，非数据通道——VIOLATION-B 中 renderer 站点单独定性，属 UI 语义，不按数据通道矩阵改）。
- 行为变化点（须在 commit message 声明）：①回滚损坏从异常通道改 Result 通道（desktop/mobile 日志与告警路径变宽）；②mobile 侧「已换代」错误经 mapper 透传后 UI 文案更精确；③bail 弃权从异常改 null（无 UI 可见变化）。
- 风险：R4 的 mobile 63 站点里含 `session-stream` 等 abort 邻接链——定性时须对照 signal-abort-scope spec 的 checkpoint 契约（`Interrupt` 判空 `!= null`），禁止把取消信号改判业务失败。
