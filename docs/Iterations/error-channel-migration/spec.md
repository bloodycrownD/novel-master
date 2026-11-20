---
date: 2026-11-14
---

# 错误通道收敛（一期）技术规格

## 设计目标

把 `packages/core/src/errors` 从「8 个 per-domain Error 类 + 39 个工厂函数 + 三套通道」收敛为 **一个 `AppError` 类 + 一张自带 message 模板的码表 + 一张参数类型表 + 一个守卫**，并为本工程后续两期定下类型基础。

**一期的边界**：只改「错误实例怎么造」，不改「怎么传播」。`new AppError(key, params)` 是终态构造方式；它外面是 `throw`、`return Result.err(...)` 还是 `return Outcome.failed(...)`，由所在函数的现状决定，二期统一改签名。一期**不**把 `throw` 改成 `return err`——那会连锁调用方，让两件事缠在一起。

**期次归属裁决**：apps 侧的类构造点（`apps/cli/src/config/load-agent-prompt-layout.ts`、`apps/cli/src/provider/commands.ts`、`apps/mobile/src/services/vfs-zip.service.ts` 等）**归一期**——类删除后这些点必编译红，不能留到三期。三期的 apps 条目只覆盖「错误对象已统一之后」的通道问题（分派链、`IpcErrorPayload`、public 面）。

## 需求来源

用户口述（无 `prd.md`）。总纲见 `docs/iterations/error-channel-migration/strategy.md`。

关键决策（对话中已拍板）：

1. **已知走返回值，未知走 throw**——厘清 Java `InterruptedException`（外部强制、自己控制不了）与协作式检查点（自己主动问）的差别之后定下的第一原则。
2. **控制流不是错误**：`Outcome<T>` 四分支平级（completed / cancelled / replaced / failed），`Interrupt` 表达中断，`AppError` 只表达业务错误。
3. **`Result` 保留**给纯计算函数（解析、校验、编译），不参与控制流。
4. **工厂函数全部消失**：唯一职责是复用 message 模板，模板搬进码表后没有存在理由。依据 nm-code-style SKILL.md:41-42「不要给错误工厂再包一层」。
5. **per-domain Error 子类全部退役**，统一 `new AppError(key, params)`；域字段进 `params`，靠 `ErrorParamsMap` 保持强类型。
6. **三期路线**：一期 errors/、二期 core、三期 apps + 导出面。

## 总体方案

### 2.1 四类型落地

新增 `errors/outcome.ts`：

```ts
/** 控制流中断：只表达流程被打断，不含成功、不含错误。 */
export type Interrupt =
  | { readonly kind: "cancelled"; readonly reason: AbortReason }
  | { readonly kind: "replaced" };

/** 一次操作的完整结果：成功 / 被中断 / 被替换 / 失败，四分支平级。 */
export type Outcome<T> =
  | { readonly kind: "completed"; readonly value: T }
  | { readonly kind: "cancelled"; readonly reason: AbortReason }
  | { readonly kind: "replaced" }
  | { readonly kind: "failed"; readonly error: AppError };

export function mapOutcome<T, U>(o: Outcome<T>, fn: (v: T) => U): Outcome<U>;
export function andThenOutcome<T, U>(o: Outcome<T>, fn: (v: T) => Outcome<U>): Outcome<U>;
export function matchOutcome<T, R>(o: Outcome<T>, on: {
  completed: (v: T) => R; cancelled: (r: AbortReason) => R;
  replaced: () => R; failed: (e: AppError) => R;
}): R;
export function interruptOf(o: Outcome<unknown>): Interrupt | null;
```

`AbortReason` 定义在 `domain/abort`；若 `signal-abort-scope` 尚未落地，先在 `outcome.ts` 内定义同名联合（`"user-stop" | "timeout" | "shutdown" | "parent"`），待那边落地改为 import。**依赖方向**：`AbortReason` 是纯类型，宁可放 `common/` 也不让 `errors/outcome.ts` import `domain/abort`——`errors/` 是全仓最底层，反向依赖 domain 会与 74 个 domain 文件的 `errors/either` import 形成环。

### 2.2 码表承载 message 模板

`error-codes.ts` 每条从 `{ code, desc }` 扩展为 `{ code, desc, messageKey? }`：

```ts
export interface ErrorCodeDef { readonly code: ErrorNumber; readonly desc: string; readonly messageKey?: CoreMessageKey }

export const ErrorCodes = {
  SKILL_MISSING_PROJECT_ID: { code: 107003, desc: "skill project id missing", messageKey: "error.skill.missing_project_id" },
  CHAT_NOT_FOUND: { code: 106003, desc: "chat entity not found", messageKey: "error.chat.not_found" },
  // ...
} as const satisfies Record<string, ErrorCodeDef>;
```

**码值与 desc 必须照抄现码表现状，不得改号改文案**（示例中的数字是 `error-codes.ts:90` / `:84` 的实测值）。

**messageKey 的三处同步**（缺一即红）：

1. `errors/error-codes.ts` 每条登记 `messageKey`；
2. `i18n/keys.ts` 的 `CORE_MESSAGE_KEYS` 追加对应 key——它是**封闭联合**（`keys.ts:56-313`），未登记的字符串过不了 `CoreMessageKey` 类型；
3. `i18n/catalog/{zh-CN,en-US}.yaml` 补双语条目——`catalog.test.ts:31-32` 锁死「zh-CN 展平 key 集合 === CORE_MESSAGE_KEYS」双向覆盖；en-US 侧现状是「允许部分缺失、缺 key 回退 zh-CN」（`catalog.test.ts:33` 起），因此**本期新增的全部 key 必须两边都写**，T-K1 对 en-US 只断言「新增 key 全覆盖」，既有缺口（如 `error.skill.missing_project_id` 现在 en-US 无条目）顺手补齐但不作为红门。

参数类型表：

```ts
/** 每个 key 的 message 参数；未登记 = 无参数。字段名沿用现有 details 的实际命名，不改名。 */
export interface ErrorParamsMap {
  SKILL_MISSING_PROJECT_ID: { skillName: string };
  SKILL_INVALID_NAME: { skillName: string; reason: string | CoreMessageDescriptor };
  CHAT_NOT_FOUND: { kind: string; id: string; messageId?: string; projectId?: string; sessionId?: string };
  SESSION_FS_ROLLBACK_MESSAGE_NOT_FOUND: { messageId: string; sessionId?: string; logicalPath?: string };
  // 域字段一律可选（与现有 options 形态一致），只有 message 组装必需项才必填
}
export type ErrorParams<K extends ErrorKey> = (K extends keyof ErrorParamsMap ? ErrorParamsMap[K] : Record<string, never>) & {
  readonly detail?: string;
  /** descriptor 通道：需要走 CoreMessageDescriptor 的 key 用这个成员 */
  readonly descriptor?: CoreMessageDescriptor;
};
```

**命名规则（硬，四条）**：

1. **`ErrorParamsMap` 成员用 camelCase，与现有 details 字段名逐字一致**（`skillName` 不改名、`messageId` 补进 `CHAT_NOT_FOUND`）——这是 T-F1/T-F2「details 逐字一致」的前提。
2. **`messageParams` 由构造器转成 snake_case**（`skillName → skill_name`），catalog 模板占位是 snake_case（`common/i18n.ts:57-58` 的 `/\{(\w+)\}/` 精确匹配、无归一）。
3. **catalog 既有模板占位符随字段名同步改名**：`error.skill.missing_project_id` 的 `{name}` → `{skill_name}`、`rollback_revision_backfill_required` 的 `{paths}` → `{missing_logical_paths}` 等。**这一步列入变更点清单的 catalog 行，T-K1 增加「每条 messageKey 的占位符 ⊆ 该 key 的 snake_case 字段名集合」断言**——不加上这条，skill 家族 7 个 key 会渲染出字面 `{name}`。
4. **数组型参数由调用点先 join**：`missing_logical_paths: paths.join(", ")`，map 声明为 `string` 而非 `string[]`——translator 对数组按 `\n` join，直接传数组会把既有 ", " 分隔符改成换行，属用户可见变更。

**`descriptor` 通道**：终态不是所有错误都能用「key + params」表达。`skillNotFoundInDomain`（带 hint 子 descriptor）、`sessionFsRollbackUndoSendEmptyTarget`（rewind/undo_send 双 key）、`*_INVALID_PATH`（自由 reason）必须走 `CoreMessageDescriptor`。因此 `ErrorParams` 保留可选 `descriptor?: CoreMessageDescriptor` 成员，`firstDescriptorOf` 优先读它、再回退到「params 顶层第一个 descriptor 成员」。

### 2.3 构造器与 7 个类的退役

```ts
export class AppError<K extends ErrorKey = ErrorKey> extends Error {
  readonly key: K;
  readonly code: ErrorNumber;
  readonly desc: string;
  readonly messageKey?: CoreMessageKey;
  readonly messageParams?: MessageParams;
  readonly details?: Readonly<ErrorParams<K>>;

  constructor(key: K, params?: ErrorParams<K>, options?: ErrorOptions) {
    const def = ErrorCodes[key];
    const descriptor = firstDescriptorOf(params);
    super((params as { detail?: string })?.detail ?? def.desc, { cause: (params as { cause?: unknown })?.cause ?? options?.cause });
    this.name = key;                                  // 结构守卫依赖，必须写
    this.key = key;
    this.code = def.code;
    this.desc = def.desc;
    this.messageKey = descriptor?.key ?? def.messageKey;
    this.messageParams = descriptor?.params ?? (params == null ? undefined : toSnakeCase(params));
    this.details = params;
  }
}
```

**`firstDescriptorOf` 契约**（可测）：先读 `params.descriptor`；无则遍历 params 的顶层成员值，返回第一个满足 `typeof v === "object" && v != null && "key" in v && typeof v.key === "string"` 的值；无则 `undefined`。

**`this.name = key`**：`isVfsError` / `isSessionFsError` 的结构判别靠 `name`，漏写即断（总纲 §7.2-6）。

**Message 取值顺序（必须与既有 wire 语义一致）**：`params.detail` → **`def.desc`**。descriptor 命中时 `Error.message` 仍取英文 `desc`（`app-error.ts:29-33` 类注释与 `localized-message.ts` 明写「AppError 例外，用英文 desc」）；`messageKey` / `messageParams` 才是 i18n 通道。**不要把 `descriptor.key` 放进 message 取值链**——那会让 7 个 skill 工厂与 `chatInvalidArgument` 的 usage.* 分支迁移后 `Error.message` 从 `"skill project id missing"` 变成 `"error.skill.missing_project_id"`，T-F1/T-F2 必红。

**`cause` 双通道**：`ToolError` 的 cause 现在存在 `Error.cause`（`tool-errors.ts:59-62` 经 `options` 传入），不在 `details`。迁移后构造器把 `params.cause` 同时写进 `Error.cause`（见上面的 `super(..., { cause })`）与 `details.cause`，两条消费路径都不破：`format-ipc-error.ts:112` / mobile `format-error.ts:36` / `format-vfs-error-for-user.ts:53` 读 `error.cause`，`useChatComposerController.ts:676` / `agent-run.service.ts:92` 读 `(err as Error).cause`。

**旧签名重载（Step 2-10 过渡期）**：Step 11 已删除。

7 个类的字符串 code → 新 key 映射：

| 旧类 | 旧 code | 新 key 前缀 | 域段 | 域字段去向 |
|---|---|---|---|---|
| `PromptError` | `INVALID_YAML` / `INVALID_BLOCK` / `UNKNOWN_FIELD` / `UNSUPPORTED_SYNTAX` | `PROMPT_*` | 117 PROMPT | `offset` 进 params；动态文案进 `detail` |
| `ConfigDecodeError` | `INVALID_SCHEMA` / `ENCODE_NOT_SUPPORTED` | `CONFIG_DECODE_*` | 109 CONFIG | 无 |
| `VfsError` | 9 码 | `VFS_*` | 102 VFS | `path` + `VfsReplaceNotFoundDetails` 六字段进 params |
| `ToolError` | 5 码 | `TOOL_*` | 104 TOOL | `toolName`、`cause`、`ZodIssue[]` 进 params |
| `ProviderError` | 15 码 | `PROVIDER_*` | 105 PROVIDER | `providerId`、`modelId` 进 params |
| `SessionFsError` | 9 码 | `SESSION_FS_*` | 116 SESSION_FS | 7 个域字段全部进 params（均可选） |
| `VfsZipError` | 8 码 | `VFS_ZIP_*` | 102 VFS | 无 |

码值按域段顺序追加、不复用、不改号；旧字符串 code 只做映射，不删除任何已有条目。实际新增条目以码表缺口为准（约 32-40 条）。**一期额外追加 3 条控制流码**：`TASK_CANCELLED`（123001）、`TASK_REPLACED`（123002）、`TOOL_CANCELLED`（104 段）——前两条供总纲 §四矩阵的 cancelled/replaced 使用，第三条供二期工具取消判别；后续两期直接引用，不再改码表结构。

**条件模板例外**：`skillNotFoundInDomain` 有「other 是否存在 → 两条不同 messageKey」的分支，translator 无 select 语法（`common/i18n.ts:57-58` 只做 `{name}` 替换）。处置：保留为 `skills.service.ts` 内的私有函数（去 `export`），spec 附录记录；该函数体内的 `new AppError(...)` 是一期 grep 门的唯一例外。

### 2.4 守卫收敛与 legacy mapper 契约

**结构守卫改双形态**（一期内）：

```ts
// vfs-errors.ts
export function isVfsError(error: unknown, code?: VfsErrorCode | VfsErrorKey): error is ...
// 判据（按顺序，全部沿 cause 链回溯）：
//   ① 旧形态：error.name === "VfsError" 且 typeof error.code === "string"（可选精确匹配 code）
//   ② AppError 形态：结构判别 error.name 以 "VFS_" 开头 且 typeof error.code === "number"
//      —— 不用 instanceof：测试环境存在 src/dist 双模块实例，instanceof 会 false negative
```

**判据必须沿 cause 链回溯**：现有 `isVfsError`（`vfs-errors.ts:82-85`）与 `isSessionFsError`（`:82-91` `unwrapCause`）都沿 `cause` 递归查找，`isRollbackVfsDegradableError` 的「含 cause 链」语义靠它（`useChatTabMessageActions.ts:347` 在用）。总纲 §7.2-3 明文「保持结构判别（name + code + **cause 链**）」，实现时保留递归。

第二种形态**只由 `legacy-vfs-error.ts` 的 mapper 生产**：mapper 不再 `new VfsError(...)`（类已删），改为手搓 `Object.assign(new Error(message), { name: "VfsError", code: "NOT_FOUND", path })`，保持 apps/CLI 的 `name + code` 消费不变。`isSessionFsError` 同构。

**core 内部的约 40 处 `isVfsError(error, "NOT_FOUND")` 类调用点全部改为 `isAppError(error, "VFS_NOT_FOUND")`**（`restore-path.ts:96/129`、`revive-deleted-entry.ts:70/91`、`vfs-tools.ts:445`、`fs-command.ts:156/161`、`read-user-vfs-save-baseline.ts:21`、`vfs-move.ts:58`）——它们拿到的是 domain 返回的 AppError，不是 legacy 形态。

**rollback 守卫与 helper** 的处置：

- 保留实现、双形态：`isSessionFsError`、`isRollbackRevisionBackfillRequiredError`、`isRollbackVfsDegradableError`（mobile `useChatTabMessageActions.ts:347` 在用）——共 **3 个守卫**。
- `isRollbackConflictError`：**删除**（全仓生产零调用，仅 `public/session-fs.ts:12` 重导出）——与 Step 3 的「删 2 个零调用守卫/helper」一致。
- `readRollbackRevisionBackfillMissingPaths` 改为从 `details` 读 `missingLogicalPaths`（原读顶层字段）。
- `formatRollbackRevisionBackfillAlertMessage`（零调用）删除。

**`VfsError` 类型别名的去留（已裁决：不保留）**：`VfsError` 既是类也是类型，类删除后若再留 `type VfsError = AppError` 的别名过渡，会让「类已退役」在类型层面完全看不出来——实施 agent 在新代码里写 `VfsError` 编译器不拦，二/三期再清时又得重扫一遍。因此本期直接把持有它的两处签名收窄：

- `domain/vfs/logic/format-vfs-error-for-llm.ts:9` 删 `import type { VfsError }`、`:69` 签名 `VfsError | AppError` → `AppError`；
- 两个调用方（`format-tool-output.ts:306/318` 附近的 vfs 分支、`format-vfs-error-for-user.ts:66`）同波改判为 `isAppError` / `isVfsError` 结构判别。

`VfsErrorCode` 与 `VfsErrorKey` 是**字符串短码联合**（不是类类型），legacy mapper 与 `isVfsError` 的第二个参数要它，保留；它们与 `AppError` 的 `ErrorKey`（number + key）是两套，不要合并。

**`instanceof` 全量改判**：全仓 `instanceof PromptError/VfsError/ToolError/ProviderError/SessionFsError/ConfigDecodeError/VfsZipError` 改 `isAppError(error, "KEY")` 或 `isSessionFsError` / `isVfsError`。`isAppError` 语义不变、**不支持前缀通配**。

### 2.5 双端格式化链（一期只做「类退役导致的分支删除」，不做「三端统一」）

三端统一是三期的活；一期只保证类退役后三条链仍编译、行为等价：

- 删除 `instanceof PromptError/VfsError/ToolError/ProviderError/SessionFsError/ConfigDecodeError/VfsZipError` 分支；
- 对应语义改 `isAppError(error, key)` / `isVfsError(error)` / `isSessionFsError(error)`；
- **`ToolError` 的 cause 解包保留**：原逻辑是「ToolError 的 cause 是 VFS 错误就透传 vfs code」，改为 `isAppError(error, "TOOL_FAILED") && isVfsError(error.cause ?? error.details?.cause)` 形态（cause 双写见 §2.3），行为不变；
- **mobile 的 `ProviderError` 两条硬编码中文保留**：改为 `isAppError(error, "PROVIDER_API_KEY_NOT_SET")` / `isAppError(error, "PROVIDER_MODEL_NOT_SAVED")` 两个分支，文案不动（进 catalog 是三期）；
- **`TdbcError`、`AgentTurnError` 分支保留**（这两类不在本期退役范围）；
- **`TYPED_ERROR_NAMES` 与 `sessionFsMissingPaths` 搬家（双轨，不能只改一轨）**：desktop `format-ipc-error.ts:73-82` 现在靠 `name ∈ TYPED_ERROR_NAMES + 字符串 code` 为**旧形态对象**产出旧短码。一期后一条链同时收两类值：
  - **AppError 形态**（core 内部经端口抛上来的）：按 `error.key` 前缀判断，直出 key；
  - **legacy 手搓形态**（`legacy-vfs-error.ts` 产出的，没有 `key` 字段）：**保留 name + 字符串 code 判别**，继续产出旧短码——renderer 的 `NOT_FOUND`（`PreviewPane.tsx:152`）等分支靠它。

  只改成「按 key 前缀」会让 legacy 对象拿不到 code，renderer 分支断供。`:84-90` 的 `missingLogicalPaths` 提取改从 `error.details` 读，`IpcErrorPayload.missingLogicalPaths` 字段与 renderer `ConversationPanel.tsx:740` 的消费不变。

## 最终项目结构

```
packages/core/src/errors/
  app-error.ts        # AppError（单类 + params 构造器 + firstDescriptorOf + toSnakeCase）+ ErrorParamsMap + AppErrorWire + isAppError
  error-codes.ts      # 码表（code + desc + messageKey，只追加）
  either.ts           # Result（保留，纯计算用）
  outcome.ts          # 新增：Outcome<T> / Interrupt + 组合子
  vfs-errors.ts       # 只留 isVfsError（双形态）+ VfsErrorCode/VfsErrorKey 类型别名
  session-fs-errors.ts # 3 个守卫（双形态）+ readRollbackRevisionBackfillMissingPaths（改读 details）
  provider-errors.ts  # 2 个文案 builder 内联到调用点（删 export）
  skill-errors.ts     # 删除（skillNotFoundInDomain 降为 skills.service 私有）
  kkv-errors.ts / preferences-errors.ts / vfs-zip-errors.ts / chat-errors.ts / config-decode-errors.ts / prompt-errors.ts / tool-errors.ts / compaction-conditions-errors.ts
                      # 全部删除
```

15 文件 → 6 文件。

## 变更点清单

| 文件 | 变更 |
|---|---|
| `errors/outcome.ts`（新） | `Outcome<T>` / `Interrupt` / 组合子 |
| `errors/app-error.ts` | 构造器改 `(key, params?, options?)` + 旧签名兼容重载；新增 `firstDescriptorOf` / `toSnakeCase` / `ErrorParamsMap`；`this.name = key` |
| `errors/error-codes.ts` | 每条补 `messageKey`；新增约 32-40 条 + `TASK_CANCELLED` / `TASK_REPLACED` / `TOOL_CANCELLED` **3 条控制流码**（123/123/104 段） |
| `i18n/keys.ts` | `CORE_MESSAGE_KEYS` 追加约 30-40 个新 key（封闭联合） |
| `i18n/catalog/zh-CN.yaml` / `en-US.yaml` | 双语补条（`catalog.test.ts` 双向覆盖锁） |
| `errors/prompt-errors.ts` / `config-decode-errors.ts` | 删除；19 + 4 处构造点改 `new AppError(...)` |
| `errors/vfs-errors.ts` | 删类与 4 个死码工厂；`isVfsError` 改双形态；保留 `VfsErrorCode`（字符串短码联合，legacy mapper 用）与 `VfsReplaceNotFoundDetails`；**`VfsError` 这个「类类型」不保留别名**（见下条裁决） |
| `errors/tool-errors.ts` | 删类与 5 个工厂；约 32 处构造点改写 |
| `errors/provider-errors.ts` | 删类；约 39 处构造点改写；2 个文案 builder 内联到调用点后删 export |
| `errors/session-fs-errors.ts` | 删类与 3 个死码/helper；约 17 处构造点改写；**3 个守卫**（`isSessionFsError` / `isRollbackRevisionBackfillRequiredError` / `isRollbackVfsDegradableError`）改双形态；`readRollbackRevisionBackfillMissingPaths` 改读 details |
| `errors/vfs-zip-errors.ts` / `chat-errors.ts` / `skill-errors.ts` / `kkv-errors.ts` / `preferences-errors.ts` / `compaction-conditions-errors.ts` | 删除；约 50 + 26 + 少量调用点改写 |
| `public/session-fs.ts` / `skills.ts` / `kkv.ts` / `compaction.ts` / `index.ts` | 删工厂重导出 |
| `public/vfs.ts` / `provider.ts` / `prompt.ts` | 删退役类的类型导出（`VfsError`/`VfsZipError`/`ProviderError`/`PromptError`） |
| `service/vfs/impl/legacy-vfs-error.ts` | mapper 改手搓旧形态对象（`name + 字符串 code`），不再依赖已删类；双映射表（VFS / VFS_ZIP）保留 |
| `service/chat/impl/skills.service.ts` | 收编 `skillNotFoundInDomain` 私有函数 |
| `domain/vfs/logic/format-vfs-error-for-user.ts` | 删 `instanceof VfsError`（`:66`）与 `new VfsError(...)`（`:78`）；cause 解包（`:53`）改判 `error.cause` |
| `domain/vfs/logic/format-vfs-error-for-llm.ts` | 删 `import type { VfsError }`（`:9`）；签名 `VfsError \| AppError` 收窄为 `AppError`（`:69`）；`details?.details` 双层回退（`:76`）按新 params 形态改写 |
| `test/errors/app-error.test.ts` | 补 params 构造用例、`messageKey ∈ CORE_MESSAGE_KEYS` 断言、**`DOMAIN_RANGES` 追加 123 IPC 段** |
| `apps/desktop/src/main/ipc/format-ipc-error.ts` | 删类分支改 `isAppError` / `isVfsError`；cause 解包改判 `details.cause`；`missingLogicalPaths` 改读 `details` |
| `apps/mobile/src/errors/format-error.ts` | 同上；`ProviderError` 两分支改判 key |
| `apps/cli/src/cli-errors.ts` | 两条链删类分支改 `isAppError`（合并在三期） |
| `apps/desktop/src/main/services/vfs-zip.service.ts` / `apps/mobile/src/services/vfs-zip.service.ts` | 类退役后构造点改 `new AppError("VFS_ZIP_*", ...)` |
| `apps/cli/src/config/load-agent-prompt-layout.ts` / `model/commands.ts` / `provider/commands.ts` | 同上（`PromptError` / `ProviderError` 构造点） |
| `test/errors/either.test.ts` / `test/tool/format-tool-output.test.ts` | `VfsError` → `AppError`；`vfsReplaceNotFound` → `buildReplaceNotFoundError` |
| `apps/desktop/test/format-ipc-error.test.ts` | 直调 `sessionFsRollbackNoCheckpoint` 的 import 改直接构造 `AppError` |
| `test/message-checkpoint/rollback-revision-backfill.test.ts` | 删 `formatRollbackRevisionBackfillAlertMessage` 断言；`err.missingLogicalPaths` 顶层读取改读 `details` |
| `test/package-exports-t0.test.ts` | 删 `kkvNotFound(...).key` 直调；指向 `test/package-exports/` 的 allowlist |
| `test/package-exports/{public-subpath-allowlist,snapshots/*-allowlist}.test.ts` | 7 个 public allowlist 快照 + main-entry 快照同步 |
| `apps/mobile/__tests__/{format-error,vfs-zip.service}.test.ts` | 构造点改 `AppError` |

## 详细实现步骤

- Step 1 — phase-types — blocking: yes — qa: auto：新增 `errors/outcome.ts` + `test/errors/outcome.test.ts`（T-O1/T-O2）；`AbortReason` 放 `common/` 或 outcome.ts 内联。零调用点变更。
- Step 2 — phase-code-table — blocking: yes — qa: auto：`ErrorCodes` 补 `messageKey`；新增约 32-40 条 + **3 条控制流码**（`TASK_CANCELLED` 123001 / `TASK_REPLACED` 123002 / `TOOL_CANCELLED` 104 段）；`i18n/keys.ts` 与双 catalog 同步（**含既有模板占位符改 snake_case**）；`DOMAIN_RANGES` 追加 123 IPC 段登记；`app-error.ts` 新增 `ErrorParamsMap` / `firstDescriptorOf` / `toSnakeCase`、构造器改新签名并保留旧签名重载、补 `this.name = key` 与 `cause` 双写；T-K1/T-K2。
- Step 3 — phase-dead-code — blocking: yes — qa: auto：删 **4 个零调用工厂**（`vfsInvalidName`、`vfsReplaceNotFound`、`sessionFsRestoreRevisionMissing`、`sessionFsRollbackNoCheckpoint`）+ **2 个零调用守卫/helper**（`isRollbackConflictError`、`formatRollbackRevisionBackfillAlertMessage`）；同步删 public 重导出与 2 个测试直引；T-D1/T-D2。
- Step 4 — phase-factory-chat — blocking: yes — qa: auto：删 `chat-errors.ts`（2 工厂，约 50 处）、`kkv-errors.ts`（1 个）、`preferences-errors.ts`（1 个）、`compaction-conditions-errors.ts`（1 个）；T-F1。
- Step 5 — phase-factory-skill — blocking: yes — qa: auto：删 `skill-errors.ts` 10 个工厂（26 处；`skillNotFoundInDomain` 降为 service 私有）；T-F2。
- Step 6 — phase-class-prompt-config — blocking: yes — qa: auto：`PromptError`（19 处）/ `ConfigDecodeError`（4 处）退役；T-M1/T-M2。
- Step 7 — phase-class-vfs-tool — blocking: yes — qa: auto：`VfsError` / `ToolError`（约 32 处）退役；`isVfsError` 改双形态；`legacy-vfs-error.ts` mapper 改手搓旧形态；T-M3/T-M4。
- Step 8 — phase-class-provider-sessionfs — blocking: yes — qa: auto：`ProviderError`（39 处）/ `SessionFsError`（17 处）/ `VfsZipError` 退役；**3 个守卫**改双形态；`readRollbackRevisionBackfillMissingPaths` 改读 details；`apps/*/vfs-zip.service.ts`、`apps/cli/*` 构造点同波；T-M5/T-M6/T-M7。
- Step 9 — phase-guards — blocking: yes — qa: auto：全仓 `instanceof` 改 `isAppError` / `isVfsError` / `isSessionFsError`；core 内约 40 处 `isVfsError(error, "CODE")` 改 `isAppError(error, "VFS_KEY")`；renderer `ConversationPanel.tsx:736-749` 的 `ROLLBACK_*` 分支改新 key（**必须在本期完成**，否则一期末回滚 backfill 弹窗静默失效）；T-G1。
- Step 10 — phase-format-chains — blocking: yes — qa: auto：三条链删类分支、保留 ToolError cause / Provider 文案 / TdbcError / AgentTurnError / SkspError 分支；`TYPED_ERROR_NAMES` 与 `missingLogicalPaths` 搬家；T-F3。
- Step 11 — phase-export-surface — blocking: yes — qa: auto：public 面删退役类与工厂重导出（含 `vfs.ts` / `provider.ts` / `prompt.ts`）；`test/package-exports/` 7 个 allowlist 快照 + main-entry 快照更新；T-E1。
- Step 12 — phase-verify — blocking: yes — qa: auto：`npm run typecheck` + core/desktop/mobile/cli 测试 + `check-style.mjs --changed` 三段 PASS + **一期 grep 门**（`grep -rnE "class +[A-Za-z0-9_]+.*extends +Error" packages/core/src/errors/ | grep -v "class AppError"` 为空——注意必须是这条正则，朴素的 `grep "extends Error"` 会把 `K extends ErrorKey` 这类泛型约束误命中成 2 条；`grep -rn "return new AppError" packages/core/src/errors/` 也为空——`skillNotFoundInDomain` 收官时按 nm-code-style 单点内联进了 `skills.service.ts` 的 `toWriteNotFoundError`）。

依赖：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12。Step 3 与 4 可互换；Step 4-8 各自独立可提交（都在 Step 2 的新构造器就绪后）。

**一期结束时的仓库状态**：

- 错误**构造**统一：无工厂、无 per-domain 子类；所有业务错误是 `new AppError(key, params)`；三端类构造点已同波改完。
- 错误**传播**未统一：domain/service 内仍有 `throw new AppError(...)`（过渡形态），二期改。
- 仓库可编译、测试全绿；`legacy-vfs-error.ts` 手搓旧形态对象，apps/CLI 的 `name + code` 消费路径不变。

## 测试策略

### 测试用例

- T-O1 — blocking: yes — `Outcome` 四分支穷尽 + `matchOutcome` 四回调各调用一次。
- T-O2 — blocking: yes — `interruptOf` 从 cancelled/replaced 提取，completed/failed 返回 null。
- T-K1 — blocking: yes — 码表新增条目落在 `DOMAIN_RANGES` 对应域段（含新增的 123 IPC 段）、数值唯一、既有条目（code + desc）零改动、每条 `messageKey ∈ CORE_MESSAGE_KEYS` 且双 catalog 覆盖；**每条 messageKey 的模板占位符集合 ⊆ 该 key 的 snake_case 字段名集合**（防 `{name}` 渲染成字面量）。
- T-K2 — blocking: yes — `new AppError("KEY", params)` 的参数名/类型编译期校验（`@ts-expect-error` 断言错误参数名报错；`detail` 可选通道可用）。
- T-D1 — blocking: yes — 删 6 个零调用符号后全仓 `tsc` 绿；public 重导出与 2 个测试直引同步。
- T-D2 — blocking: yes — `format-tool-output.test.ts` 改用 `buildReplaceNotFoundError` 后文案逐字一致。
- T-F1 — blocking: yes — chat/kkv/preferences/compaction 四组工厂删除后，约 50 处构造点产出的 `key`/`code`/`message`/`messageParams`/`details` 与改造前逐字一致（**含 `CHAT_NOT_FOUND` 的 `messageId` 分支；messageParams 必须是 snake_case 且能命中 catalog 占位符**）。
- T-F2 — blocking: yes — skill 10 工厂删除后 26 处同上；`skillNotFoundInDomain` 条件模板按其私有实现验证。
- T-M1 — blocking: yes — `PromptError` 4 码映射 + `offset` 进 params + `detail` 覆盖文案。
- T-M2 — blocking: yes — `ConfigDecodeError` 2 码映射。
- T-M3 — blocking: yes — `VfsError` 9 码映射 + `path` / `VfsReplaceNotFoundDetails` 六字段落在 params（**字段名不改、类型强**）。
- T-M4 — blocking: yes — `ToolError` 5 码映射 + `toolName` / `cause` / `ZodIssue[]` 落在 params；**嵌套 cause 用例**（ToolError 包 VfsError）。
- T-M5 — blocking: yes — `ProviderError` 15 码映射 + `providerId`/`modelId` 落在 params；`messageKey`/`messageParams`（snake_case）正确。
- T-M6 — blocking: yes — `SessionFsError` 9 码映射 + 7 个域字段落在 params、类型不退化为 unknown；**只有 message 组装必需项必填**（如 `SESSION_FS_ROLLBACK_MESSAGE_NOT_FOUND` 的 `messageId` 必填），其余可选。
- T-M7 — blocking: yes — `VfsZipError` 8 码映射。
- T-G1 — blocking: yes — `isAppError(e, "KEY")` 与 `isVfsError` / `isSessionFsError` 双形态：AppError 形态（key 前缀）与 legacy 旧形态对象（name + 字符串 code）都能判中；src/dist 双实例场景下不误判。
- T-F3 — blocking: yes — 三条链对同一组输入（7 类各一条 + ToolError 包 VFS cause 的嵌套用例 + SessionFs backfill 带 `missingLogicalPaths` 用例）产出与改造前逐字一致；双端镜像文案逐字 diff。
- T-F4 — blocking: yes — `cli-errors.ts` 删类分支后输出与基线快照一致。
- T-E1 — blocking: yes — public 面：退役类与工厂符号不再导出；7 个 allowlist 快照 + main-entry 快照绿；apps 三端 import 编译通过。

## 风险与回滚方案

| 风险 | 影响 | 缓解 |
|---|---|---|
| 40-52 条新码带 messageKey 但 i18n 未同步 | 编译红或 `catalog.test.ts` 红 | Step 2 三处同波（error-codes / keys.ts / 双 catalog）；T-K1 双向覆盖断言 |
| camelCase params 直通翻译链 | 用户看到裸 `{session_id}` | 构造器 `toSnakeCase` 归一；T-M5/T-M6 锁 messageParams 形态 |
| 结构守卫断供（类删除后无生产者） | 约 40 处 core 分支 + apps code 分支静默失灵 | §2.4 双形态守卫 + legacy mapper 手搓旧形态；T-G1 双形态断言 |
| `this.name = key` 漏写 | `isVfsError` 结构判别失效 | 构造器硬编码写入；T-G1 断言 `name === key` |
| message 取值顺序与既有 wire 语义不一致 | 日志文案漂移 | 取值顺序 `detail → desc`（`descriptor.key` 只走 messageKey/messageParams 通道）；T-M1~T-M7 逐条锁 |
| `legacy-vfs-error` 手搓对象与真类行为差异 | apps 侧 `instanceof` 或原型方法失效 | apps 侧只消费 `name + code + message`（已核实）；T-F3 覆盖 |
| public 撤导出波及 apps | 跨包编译红 | 一期只撤退役类与死码工厂；导出面大盘留三期；Step 11 单独提交 |
| 迁移中途停下 | 两种风格并存 | Step 2 保留旧签名重载，Step 4-10 各组独立可提交 |

回滚：每 Step 一个提交，按 `phase-<id>` 分组；Step 3/4/5 可独立 revert；Step 2 与 6-10 强耦合，需整组回退。
