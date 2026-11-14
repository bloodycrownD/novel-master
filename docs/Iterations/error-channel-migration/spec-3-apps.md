---
date: 2026-11-14
---

# 错误通道统一（三期：apps + 导出面）技术规格

## 设计目标

把 desktop / mobile / cli 三端的错误通道对齐到二期的 core 契约，并把 `packages/core/src/public` 的 errors 导出面收口到「只有真实消费者才导出」。

三期的两个硬决策：**`IpcResult` 的线格式不变**（只改 `error.code` 的取值空间）；**`Result` / `Outcome` 首次进 public 面**。

## 需求来源

总纲 `docs/iterations/error-channel-migration/strategy.md` §六。期次边界：一期 errors/ 收敛 → 二期 core 通道 → **三期 apps + 导出面**。

**交接约束**：一期已完成 7 个类的退役与 apps 侧构造点改写，二期已完成 core 通道统一（含两个哨兵与 apps 四个 catch 文件）。三期面对的是「错误对象已统一、传播已统一」的仓库，只处理通道形状与导出面。

## 总体方案

### 3.1 `IpcResult` 线格式不变，只改 `error.code` 取值空间

现状（`apps/desktop/shared/ipc-types.ts:216-223`）：

```ts
export type IpcErrorPayload = { readonly code: string; readonly message: string; readonly missingLogicalPaths?: readonly string[] };
export type IpcResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: IpcErrorPayload };
```

**不改**：`data` 字段名、`{ ok, data } | { ok, error }` 形状、纯数据载体（structured clone）。改成 core `Result`（`value` 字段、类实例过 IPC 丢原型）会打断 25 个 handler 的 160 处 `ok: true` + renderer 214 处 `.ok`，收益为零。

**改**：`error.code` 的取值空间统一为 `AppError.key`，不留冗余 `key?` 字段。

**全部非 ErrorKey 码需要迁入码表**（一期只迁了 5 个格式链码；下列是**本期新发现**的 handler 直构与活类码）：

| 现有码 | 来源 | 新 key | 域段 |
|---|---|---|---|
| `VALIDATION` | `ZodError`（`formatIpcError:100`） | `INFRA_VALIDATION_FAILED` | 110 |
| `AGENT_RUN_ERROR` | `AgentTurnError`（`:120`） | `AGENT_RUN_FAILED` | 101 |
| `ERROR` | 兜底分支（`:133`、`handlers/usage-stats.ts:168` **与** `:226`） | `INFRA_UNEXPECTED_ERROR` | 110 |
| `AGENT_BUSY` | handler 直构（`handlers/agent.ts:406`） | `AGENT_BUSY` | 101 |
| `AGENT_NOT_FOUND` | handler 直构（`handlers/agent-registry.ts:103`） | `AGENT_NOT_FOUND`（**已是 ErrorKey 101007，直接复用**） | 101 |
| `AGENT_RUN_IN_FLIGHT` | handler 直构（`handlers/compaction.ts:49`） | `AGENT_RUN_IN_FLIGHT` | 101 |
| `PROVIDER_MISMATCH` | handler 直构（`handlers/provider-models.ts:153`） | `PROVIDER_MODEL_MISMATCH` | 105 |
| `INVALID_URL` | handler 直构（`handlers/app-info.ts:107`） | `IPC_INVALID_URL` | 123 IPC |
| `INVALID_MENU` / `NO_WINDOW` | handler 直构（`handlers/shell.ts:15/19/31`） | `IPC_INVALID_MENU` / `IPC_NO_WINDOW` | 123 IPC |
| `INVALID_ARGUMENT` | handler 直构（`handlers/app-ui.ts:39`） | `IPC_INVALID_ARGUMENT` | 123 IPC |
| `ALREADY_UP_TO_DATE` / `NEED_PULL_FIRST` | `CloudSyncError`（`:174/293`、mobile `:411`） | `CLOUD_SYNC_ALREADY_UP_TO_DATE` / `CLOUD_SYNC_NEED_PULL_FIRST` | 122 CLOUD_SYNC |
| 其余 **10 个** `CloudSyncErrorCode` | `cloud-sync-errors.ts:16-28`（联合共 **12** 个成员，全部有构造点） | `CLOUD_SYNC_*` | 122 CLOUD_SYNC |

**`CloudSyncError` 整体退役（清扫面必须同波，实构 33 处）**：

- core：`infra/cloud-sync/impl/cloud-sync-coordinator.ts` **16 处**、`cloud-sync-status.ts:63`、`infra/cloud-sync/index.ts:9` barrel 再导出、`i18n/error-message.ts:16/64` 的 `isCloudSyncError` + `CloudSyncErrorCode` import；
- desktop：`services/cloud-sync.service.ts` **6 处构造**（`:118/128/136/158/400/434`）+ `:107` catch + `:301` 的 `code === "ALREADY_UP_TO_DATE"` 分支；
- mobile：`services/cloud-sync.service.ts` **3 处构造** + `:411` 的 `ALREADY_UP_TO_DATE` 分支、`services/map-cloud-sync-sdk-error.ts` **7 处构造**（`:142-167`）、`CloudSyncProgressScreen.tsx:147` 与 `cloud-sync-progress-log.ts:82` 的 `error.code` 读取；
- **`packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts` 6 处实构**（`:75/81/84/138/147/217`）——该包从 `@novel-master/core` 桶导入 `CloudSyncError`（`:9`），类删除即编译红，不能漏；
- `apps/mobile/src/services/map-cloud-sync-sdk-error.ts:132` 的 `isCloudSyncError` 直通分支同波改前缀判断；
- `format-ipc-error.ts:97` 的 `isCloudSyncError` 分支改 `isAppError(error) && error.key.startsWith("CLOUD_SYNC_")`。

生产实构总数 **39 处**（coordinator 16 + status 1 + desktop 6 + mobile 3 + map 7 + s3 driver 6）。

**`VfsSingleFileError` 四种失败语义必须拆四个 key**（`vfs-single-file.service.ts` 实测 4 处构造）：

| 位置 | 语义 | 新 key |
|---|---|---|
| `:103` | 文件过大 | `VFS_SINGLE_FILE_TOO_LARGE` |
| `:107` | 读取失败 | `VFS_SINGLE_FILE_READ_FAILED` |
| `:109` | 文件不存在 | `VFS_SINGLE_FILE_NOT_FOUND` |
| `:169` | 导出目标非单文件 | `VFS_SINGLE_FILE_EXPORT_TARGET_INVALID` |

四个 key 均落 102 VFS 段，各配 `messageKey` 与 `ErrorParamsMap` 条目。

**`IpcErrorPayload.code` 终态**：只允许 `ErrorKey`，无例外。

**renderer 的 code 分支清单**（实测 3 个文件 6 处，不是 5 个）：

- `ConversationPanel.tsx:736-749`——`ROLLBACK_*` 三个分支：**一期已完成**（随 SessionFsError 退役改 key），三期只验证。
- `SettingsViews.tsx:309/330`——`ALREADY_UP_TO_DATE` / `NEED_PULL_FIRST`，改 `CLOUD_SYNC_*`。
- `PreviewPane.tsx:152`——`NOT_FOUND`（旧 VFS 短码），改 `VFS_NOT_FOUND`。
- `chat-link-route.ts:85/100` 只写日志不分支；`workspace-actions.ts:43-45` 只转交 payload，不分支。

### 3.2 三端格式化链统一

现状三条链互不相同：

| 端 | 独有分支 |
|---|---|
| desktop `format-ipc-error.ts` | `ZodError` + `formatZodIssues`、`VFS_APP_KEY_TO_CODE` 兼容映射、`AgentTurnError`、`TYPED_ERROR_NAMES` |
| mobile `format-error.ts` | `ProviderError` 硬编码中文 switch、`TdbcError` |
| cli `cli-errors.ts` | 同一条 instanceof 链字面重复两遍、`SkspError` |

**统一分派顺序（10 条，PROVIDER_* 与 ToolError cause 解包都必须在通配之前）**：

1. `ZodError` → `INFRA_VALIDATION_FAILED`，**message 保留 desktop 的 `formatZodIssues` 中文逐字段文案**（`format-ipc-error.ts:29-47`）；mobile/cli 无 Zod 入口，不复制该表（T-A4 的镜像口径对此条豁免）。
2. `isAppError(error) && error.key.startsWith("VFS_")` → vfs 文案（`vfsUserMessage` + `coreT`）。
3. `isAppError(error) && error.key.startsWith("PROVIDER_")` → **码表 `messageKey` + `coreT`**（mobile 两条硬编码中文在一期已改判 key、文案原样；三期把文案搬进 catalog，废除 switch）。
4. `isAppError(error) && error.key.startsWith("CLOUD_SYNC_")` → 码表 `messageKey` + `coreT`。
5. **`ToolError` 含 VFS cause 的解包**（`isAppError(error, "TOOL_FAILED") && isVfsError(error.cause)`）→ 透传 vfs code/message。**这条不能丢**：现 `format-ipc-error.ts:111-119` 就做这件事，一期也明确保留（一期 spec §2.5），三期若砍掉，嵌套错误会落第 6 条输出 `TOOL_FAILED`，renderer `PreviewPane.tsx:152` 的 `VFS_NOT_FOUND` 分支不再命中，违反行为等价。
6. `isAppError(error)` → `userMessageOf` + `coreT`。
7. `TdbcError` → message + cause。
8. `AgentTurnError` → `AGENT_RUN_FAILED`。
9. `Error` → `INFRA_UNEXPECTED_ERROR`（`name` 只进日志，不进 code）；非 Error → `String(error)`。

`SkspError` 无 `messageKey`，落第 9 条后输出 `error.message` 与现 `visibleMessage` 等价，**行为不变，不单独加分支**（T-A7 基线快照锁）。

`isAppError(error, "VFS_*")` 是伪代码——`isAppError` 只做字面量全等（总纲 §7.2-5），前缀判别一律写 `error.key.startsWith(...)`。

### 3.3 public 导出面收口

**基准**：本节的裁决对象是**一期 Step 11 完成后实际留在 public 面的符号**，不是当前仓的 41 个。一期已删除的符号（7 个 per-domain 类、全部工厂、6 个死码、`isRollbackConflictError`、`formatRollbackRevisionBackfillAlertMessage`、`kkvNotFound`、`preferencesInvalidValue`、`compactionConditionsInvalidSchema`、10 个 `skill*`、`sessionFs*` 的 4 个死码工厂）**不在本期裁决范围**——它们一期就没了。

**执行方式（避免清单失真）**：Step 6 开始时先跑一次 `grep -rn "^export" packages/core/src/public/*.ts packages/core/src/index.ts`，以实际输出为清单，按下表规则逐符号裁决，并把结果写进本 Step 的提交说明。

| 规则 | 处置 |
|---|---|
| apps 三端有生产消费者 | 保留 export |
| 仅测试引用 | 撤 export，测试改直接构造 `AppError` |
| 零消费者 | 撤 export |
| `Result` / `Outcome` / `Interrupt` / 组合子 | **新增** export（见 3.4） |
| `ErrorKey` / `ErrorNumber` / `ErrorCodes` | 保留（`ipc-types.ts` 收窄 `code` 取值空间后是真实消费者） |

**必保留（apps 生产消费者，已逐一实证）**：`AppError`、`isAppError`、`isVfsError`、`isSessionFsError`、`isRollbackVfsDegradableError`、`isRollbackRevisionBackfillRequiredError`、`readRollbackRevisionBackfillMissingPaths`、`vfsUserMessage`。

**`isSessionFsError` 不在此列**——apps 全树（含测试）grep 零命中，只有 core 内部消费（`message-rollback.service.ts:217/249`）。按规则表「零消费者 → 撤 export」处理：public 面撤出，core 内部照用；二期/一期已建立的 `isAppError(error, "SESSION_FS_*")` 形态在前缀判别处等价。

**注意双导出位**：`AppError` / `isAppError` 在 `public/agent.ts:15` 与 `public/vfs.ts:13` 各一处；撤并时两个位置同步（`kkvNotFound` 的两个位置一期已删，不再涉及）。

**锁测试的真实位置**（不是 `package-exports-t0.test.ts` 或 `duplicate-export-consistency.test.ts`）：

- `packages/core/test/package-exports/public-subpath-allowlist.test.ts:5-21`——`SUBPATHS` 数组（现 15 项）需加 `"errors"`；
- `packages/core/test/package-exports/snapshots/*-allowlist.json`——现 16 个快照（`main-entry-allowlist.json` + 15 个子路径），撤导出后逐个重生成，**新增的 `./errors` 子路径要新建第 17 个快照**；
- `main-entry-allowlist.test.ts` 消费 `main-entry-allowlist.json`，`index.ts` 撤导出（含一期已删 `kkvNotFound:101` 等）会让它红；
- `duplicate-export-consistency.test.ts` 只断言 compaction 子入口与 depth-slice 源同源，**与 errors 双导出位无关**，不会红。

`public-skills.ts` 不在 SUBPATHS、也没有快照锁——skills 撤导出无测试覆盖，是既有缺口，本期顺手补一个快照。

### 3.4 `Result` / `Outcome` 首次进 public

```ts
// packages/core/src/public/errors.ts（新）
export { Result, Ok, Err, type ResultWire } from "../errors/either.js";
export { type Outcome, type Interrupt, mapOutcome, andThenOutcome, matchOutcome, interruptOf } from "../errors/outcome.js";
export { AppError, isAppError, type AppErrorWire } from "../errors/app-error.js";
export { type ErrorKey, type ErrorNumber, ErrorCodes } from "../errors/error-codes.js";   // 注意：两个类型定义在 error-codes.ts，不在 app-error.ts
```

`package.json` 新增 `"./errors"` 子路径；`public-subpath-allowlist.test.ts` 的 `SUBPATHS` 与快照同步。

### 3.5 CLI exit code 三档与 cancelled 管线

现状只有 `EXIT_USAGE=1` / `EXIT_RUNTIME=2`。三期新增：

```ts
export const EXIT_CANCELLED = 130;
```

**cancelled 的到达机制**（二期后 cancelled 是 `Outcome.cancelled` 返回值，不是 throw）：

- 命令函数返回 `Outcome<T>` 的，在 `main.ts` 两个边界（`:117-120` / `:187-189`）判 `if (outcome.kind === "cancelled" || outcome.kind === "replaced") return EXIT_CANCELLED;`；
- 仍是 throw 形态的（工具取消 `TOOL_CANCELLED`），由 `exitCodeForError` 判 `isAppError(error, "TOOL_CANCELLED")` → `EXIT_CANCELLED`；
- 不打印错误文案，只打一行「已取消」到 stderr。

## 最终项目结构

```
packages/core/src/public/errors.ts        # 新增
packages/core/package.json                # 新增 "./errors" 子路径
packages/core/src/infra/cloud-sync/errors/cloud-sync-errors.ts  # 删除（类退役）
packages/core/src/service/vfs/impl/legacy-vfs-error.ts          # 删除（apps 已改认 key）
apps/desktop/src/main/ipc/format-ipc-error.ts   # 统一 10 条分派（含 Zod）
apps/mobile/src/errors/format-error.ts          # 统一 9 条分派（无 Zod 表）
apps/cli/src/cli-errors.ts                      # 两链合一 + EXIT_CANCELLED
```

## 变更点清单

| 文件 | 变更 |
|---|---|
| `apps/desktop/shared/ipc-types.ts` | `IpcErrorPayload.code` 取值空间改 `ErrorKey`（不增 `key?`） |
| `apps/desktop/src/main/ipc/format-ipc-error.ts` | 按 3.2 重写 **10 条**分派；删 `VFS_APP_KEY_TO_CODE` 与 `TYPED_ERROR_NAMES`；`isCloudSyncError` 改前缀判断 |
| `apps/desktop/src/main/ipc/handlers/{agent,agent-registry,app-info,app-ui,compaction,provider-models,shell,usage-stats}.ts` | 10 处直构 payload 的 code 改新 key（`usage-stats` 两处 `:168/:226`） |
| `apps/desktop/renderer/features/settings/SettingsViews.tsx` | 2 处分支改 `CLOUD_SYNC_*` |
| `apps/desktop/renderer/layout/PreviewPane.tsx` | 1 处分支改 `VFS_NOT_FOUND` |
| `apps/desktop/src/main/services/cloud-sync.service.ts` | **6 处构造**（`:118/128/136/158/400/434`）改 `AppError`；`:107` catch 与 `:301` 分支改 key |
| `apps/mobile/src/services/cloud-sync.service.ts` | **3 处构造**改 `AppError`；`:411` 的 `ALREADY_UP_TO_DATE` 分支改 key |
| `apps/mobile/src/services/map-cloud-sync-sdk-error.ts` | **7 处构造**（`:142-167`）改 `AppError` |
| `apps/mobile/src/screens/…/CloudSyncProgressScreen.tsx` / `services/cloud-sync-progress-log.ts` | `error.code` 读取改 key（`:147` / `:82`） |
| `apps/desktop/src/main/**`（全树） | **65 处 throw** 按二期五类处置（`services/**` 只占 43 处，清单按 main 全树锁） |
| `apps/desktop/src/main/**` | 七类相关 `instanceof` 全改 `isAppError` + `error.key.startsWith("CLOUD_SYNC_")`（`isCloudSyncError` 本 Step 已退役，不能作为改写目标） |
| `apps/mobile/src/errors/format-error.ts` | **9 条**分派（无 Zod 表）；Provider 文案进 catalog |
| `apps/mobile/src/errors/vfs-single-file-error.ts` | 类退役，4 处构造拆 4 个 key |
| `apps/mobile/src/services/{cloud-sync,vfs-zip,vfs-single-file}.service.ts` | vfs-zip 的 4 处构造**一期已改**；本期只处理 cloud-sync 与 vfs-single-file |
| `apps/mobile/src/**` | 约 19 处错误类 `instanceof` 改 `isAppError` |
| `apps/cli/src/cli-errors.ts` | 两链合一 + `EXIT_CANCELLED` |
| `apps/cli/src/main.ts` | 两个边界加 `Outcome.cancelled` 与 `TOOL_CANCELLED` 分支 |
| `apps/cli/src/**` | 134 处 throw 按五类处置 |
| `packages/core/src/infra/cloud-sync/errors/cloud-sync-errors.ts` | 删除 |
| `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts` | **16 处**构造改 `AppError("CLOUD_SYNC_*")` |
| `packages/core/src/infra/cloud-sync/impl/cloud-sync-status.ts` | `:63` 构造改 `AppError` |
| `packages/core/src/infra/cloud-sync/index.ts` | 删 `CloudSyncError` barrel 再导出 |
| `packages/core/src/i18n/error-message.ts` | 删 `isCloudSyncError` / `CloudSyncErrorCode` import（`:17/64`），改 `CLOUD_SYNC_*` key 分支 |
| `packages/core/src/errors/error-codes.ts` | 追加 **26 条**：101 三条（`AGENT_RUN_FAILED`/`AGENT_BUSY`/`AGENT_RUN_IN_FLIGHT`）+ 105 一条 + 110 两条 + 123 四条 + 122 十二条 + 102 四条 |
| `packages/core/src/i18n/{keys.ts,catalog/*.yaml}` | 26 条码的 messageKey 与双语文案同步 |
| `packages/core/test/errors/app-error.test.ts` | `DOMAIN_RANGES` 追加 122 CLOUD_SYNC 段 |
| `packages/core/src/public/errors.ts` | 新增 |
| `packages/core/src/public/{agent,vfs,provider,session-fs,prompt,kkv,skills,compaction}.ts` | 按 3.3 撤导出 |
| `packages/core/src/index.ts` | 删 `kkvNotFound` / `preferencesInvalidValue` / `ToolError` / `ConfigDecodeError` / `CloudSyncError` 再导出 |
| `packages/core/package.json` | 新增 `./errors` 子路径 |
| `packages/core/src/service/vfs/impl/legacy-vfs-error.ts` | 删除 |
| `packages/core/test/package-exports/public-subpath-allowlist.test.ts` | `SUBPATHS` 加 `"errors"` |
| `packages/core/test/package-exports/snapshots/*-allowlist.json` | 16 个快照重生成 |

## 详细实现步骤

- Step 1 — phase-ipc-payload — blocking: yes — qa: auto：码表追加 **26 条**（101×3 / 105×1 / 110×2 / 123×4 / 122×12 / 102×4）+ i18n 与 `DOMAIN_RANGES` 同步；`CloudSyncError` 整体退役（core 类 + coordinator 16 处 + status 1 处 + barrel + `i18n/error-message.ts` + desktop 6 处构造与 2 处分支 + mobile 3+7 处构造与 2 处读取）；`IpcErrorPayload` 取值空间改 `ErrorKey`；`format-ipc-error` 重写 10 条分派；handler 10 处直构码与 renderer 3 处分支同步；T-A1/T-A2。
- Step 2 — phase-desktop-services — blocking: yes — qa: auto：desktop 65 处 throw 按五类处置；12 处 instanceof 改判；T-A3。
- Step 3 — phase-mobile-format — blocking: yes — qa: auto：`format-error` **9 条**分派（无 Zod 表）；Provider 两条文案进 catalog；`vfs-single-file-error` 退役；约 19 处错误类 instanceof 改判；T-A4/T-A5。
- Step 4 — phase-mobile-services — blocking: yes — qa: auto：mobile 120 处 throw 处置；T-A6。
- Step 5 — phase-cli — blocking: yes — qa: auto：`cli-errors` 两链合一 + `EXIT_CANCELLED`；`main.ts` cancelled 管线；134 处 throw 处置；T-A7。
- Step 6 — phase-public-exports — blocking: yes — qa: auto：新增 `public/errors.ts`；errors 相关导出面按 3.3 规则逐符号裁决（以 Step 开工时的 grep 实际输出为清单，结果写进提交说明）；`package.json` 加子路径；删 `legacy-vfs-error.ts`；`public-subpath-allowlist.test.ts` + 16 个快照更新 + 新建 `errors` 快照；T-A8。
- Step 7 — phase-mirror-diff — blocking: yes — qa: auto：17 对镜像 service 逐字 diff；已知差异（desktop `createLogger` / mobile `__DEV__`、`skipComposerStatusRefresh`、`PromptCountCancelledError`）列入白名单；T-A9。
- Step 8 — phase-verify — blocking: yes — qa: auto：`npm run typecheck` + 三端测试 + `check-style` 三段 + **三期 grep 门**：① 全仓 `throw new AppError` 命中 ⊆ 二期白名单（spec-2 §2.3 的 16 处 + 26 处事务回调）∪ **apps 边界白名单**（Step 1 开工前先 `grep -rn "throw new AppError" apps/` 生成文件清单，作为本次提交的附件冻存，后续期次不变）；② `packages/{core,apps}/src` 内 `instanceof (Vfs|Tool|Provider|SessionFs|VfsZip|Prompt|ConfigDecode)Error` 为空（一期已清 core 7 处与 apps 全量，本期只需确认无回潮）；③ `grep -rn "isVfsError([^)]*, *\"" packages/core/src/errors packages/core/src/domain packages/core/src/service apps/*/src` **带字符串短码实参**的调用为零（双形态守卫本身保留，不算命中——门只抓 `isVfsError(x, "NOT_FOUND")` 这种旧短码实参）。**已知不达标点**：`apps/desktop/src/main/ipc/handlers/physical.ts:87` 就是 `isVfsError(err, "NOT_FOUND")`，一期只认领 core 内部，**本期的 Step 2 必须顺手改成 `isAppError(err, "VFS_NOT_FOUND")`**，否则门永红；④ `grep -rn "IpcErrorPayload" apps/desktop | grep "code:"` 抽查取值全为 ErrorKey。

依赖：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8。Step 6 依赖 1-5 全部完成（public 撤导出需 apps 已改认 key）。

## 测试策略

### 测试用例

- T-A1 — blocking: yes — `formatIpcError` 对 10 条分派各一条输入（ZodError / VFS_* / PROVIDER_* / CLOUD_SYNC_* / **ToolError 包 VFS cause 的嵌套用例** / 其余 AppError / TdbcError / AgentTurnError / plain Error / 非 Error）产出 `code` 全为 `ErrorKey`、message 与基线逐字一致；handler 10 处直构 payload 抽查全为 ErrorKey。
- T-A2 — blocking: yes — renderer 3 个分支文件按新 key 命中；旧短码（`NOT_FOUND`/`ALREADY_UP_TO_DATE`/`NEED_PULL_FIRST`）不再出现。
- T-A3 — blocking: yes — desktop 65 处 throw 处置后失败语义等价（key 与文案逐字）。
- T-A4 — blocking: yes — mobile 9 条分派与 desktop 逐条逐字一致（第 1 条 Zod 为 desktop 独有，镜像门对此条豁免）。
- T-A5 — blocking: yes — Provider 两条文案进 catalog 后输出与改造前逐字一致。
- T-A6 — blocking: yes — mobile 120 处 throw 处置后，41 个 `formatError`/`toastMessage` 消费文件行为不变。
- T-A7 — blocking: yes — cli 两链合一后对 8 类错误输出与基线快照一致；`EXIT_CANCELLED=130` 在 `Outcome.cancelled` 与 `TOOL_CANCELLED` 两条路径命中；`SkspError` 输出不变。
- T-A8 — blocking: yes — public：8 个保留符号可导入；3 仅测试 + 30 零消费者符号不再导出；`public-subpath-allowlist.test.ts` + 16 个快照绿；`Result`/`Outcome` 可从 `@novel-master/core/errors` 导入。
- T-A9 — blocking: yes — 17 对镜像 service 逐字 diff，除已知白名单差异外零差异。

## 风险与回滚方案

| 风险 | 影响 | 缓解 |
|---|---|---|
| `IpcResult` 线格式被顺手改 | 63 个文件级联红 | 只改 `error.code` 取值空间；T-A1 锁 |
| `CloudSyncError` 退役漏改某一端 | 云同步错误静默落兜底 | Step 1 同波改 39 处构造（core 17 + desktop 6 + mobile 3 + map 7 + s3 driver 6）+ format 链 + i18n；T-A1/T-A2 |
| 分派链 3/4 顺序写反 | PROVIDER_* 分支不可达 | 顺序硬写 `VFS_* → PROVIDER_* → CLOUD_SYNC_* → 通配`；T-A1 十条全覆盖 |
| 双端镜像漂移 | 一端正确一端兜底 | T-A4/T-A9 逐字 diff；项目记忆 #242 |
| 锁测试指错文件 | Step 6 无从下手 | 已改为 `public-subpath-allowlist.test.ts` + `snapshots/*-allowlist.json` |
| CLI cancelled 无到达路径 | exit 130 永不触发 | §3.5 写死两条路径（Outcome + TOOL_CANCELLED）；T-A7 |

回滚：每 Step 一个提交；Step 6 跨包必须整组回退；Step 2/4/5 按端独立回退。
