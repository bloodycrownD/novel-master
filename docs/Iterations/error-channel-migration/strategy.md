---
date: 2026-11-14
---

# 错误通道迁移总纲

本文件是「错误通道迁移」工程的纲领，各期 spec 引用它，不重复定义原则与类型。任何一期不得私自新增例外或改类型语义——要改先改本文件。

## 一、背景与目标

### 1.1 现状（2026-11-14 实测）

| 指标 | 实测 |
|---|---|
| `packages/core/src/errors` | 15 文件、1430 行；8 个 `extends Error` 类、39 个错误工厂（**纯转发仅 4 个**，35 个带 message 格式化）、6 个守卫、2 个文案 builder |
| 全仓自定义 Error 类 | 32 个（errors/ 8 + core 其余 15 + 跨包 3 + apps 6） |
| `throw` 处数 | 约 875（core/service 261、core/domain 211、core/infra 100、apps 约 285、其余零散） |
| 提到 `Result` 的生产文件 | 约 217，其中直接 import `errors/either` 的 50 个 |
| `Result.attempt*` / `revive` | **零生产调用** |
| 边界 `if (!r.ok) throw r.error` | 生产接线仅 2 处（desktop / mobile 的 user-vfs-turn-execute） |
| 失败通道 | 三套并存：core `Result`（domain 74 文件）、app `IpcResult` 裸对象（desktop 30 文件）、纯 `throw`（service / cli） |

结论：「Either 已迁移一部分」实际只覆盖 **domain 纯函数**；service 层、IPC、CLI 全未接，且 `Result` 未进 `public`，双端只经函数签名间接消费类型。

### 1.2 目标

1. 把「已知 / 未知」的边界划死：**已知失败与中断走返回值，未知异常走 throw**。
2. 收敛错误模型：一个 `AppError` 类 + 一张码表 + 一个守卫，不再有 per-domain Error 子类。
3. 取消等控制流不伪装成错误：`Interrupt` 独立于 `AppError`。
4. 分三期落地，每期可独立验收、可停。

## 二、第一原则

> **已知的走返回值，未知的走 throw。**

### 2.1 判定树

一个 `throw` 该不该迁，按顺序问三个问题：

1. **这是已知失败/中断，还是未知异常？**
   - 已知（域校验失败、业务规则拒绝、用户取消、任务被替换）→ 走返回值
   - 未知（不变量破坏、`Result.revive` 形状违约、不可能分支）→ **保留 throw**
2. **调用方能否基于这个值做出不同决策？**
   - 能（重试、降级、换提示、展示不同文案）→ 必须是返回值，且载荷带足以决策的信息
   - 不能，只能原样上报 → 返回值即可，不必额外设计载荷
3. **这个 throw 是否出现在我们定义不了签名的边界？**
   - 是（`fetch` 的 abort、`better-sqlite3` 的回滚、`raceWithAbort` 的 reject）→ **保留 throw**，在适配层转码
   - 否（我们自己写的函数）→ 走返回值

### 2.2 三类「已知」与两类「未知」

| 分类 | 机制 | 典型 |
|---|---|---|
| 已知成功 | `Outcome.completed` | 长循环跑完 |
| 已知中断 | `Outcome.cancelled` / `Interrupt` | 用户点停止、`scope.abort()`、库被替换 |
| 已知失败 | `Outcome.failed` / `AppError` | 校验失败、路径非法、资源不存在 |
| 未知异常 | throw 到边界 | 空指针、断言失败、`INFRA_INVARIANT_VIOLATION` |
| 平台强制 | throw + 适配层转码 | `fetch` abort、事务回滚、`raceWithAbort` reject |

「中断」与「失败」的区别是语义而非机制：中断表示**任务没有完成，但没有出错**，不需要错误码、不需要 i18n、不进统计的错误率。

## 三、四类型与职责边界

### 3.1 `Outcome<T>`（新）

```ts
/** 一次操作的完整结果：成功 / 被中断 / 被替换 / 失败，四个分支平级。 */
export type Outcome<T> =
  | { readonly kind: "completed"; readonly value: T }
  | { readonly kind: "cancelled"; readonly reason: AbortReason }
  | { readonly kind: "replaced" }
  | { readonly kind: "failed"; readonly error: AppError };
```

- 用于**可能失败、也可能被中断**的操作：长循环、service 方法、handler 的 `doWork`。
- 禁止把 `Interrupt` 塞进 `failed`，也禁止把 `AppError` 塞进 `cancelled`。
- 组合子（`map` / `andThen` / `match`）随类型一起提供，语义与 `Result` 同类方法一致：`completed` 分支才继续，其余原样透传。

### 3.2 `Interrupt`（新）

```ts
/** 中断信号：只表达流程被打断，不含成功、不含错误。 */
export type Interrupt =
  | { readonly kind: "cancelled"; readonly reason: AbortReason }
  | { readonly kind: "replaced" };

checkpoint(): Interrupt | null;   // null = 继续跑
```

- 协作式：只在代码显式调 `checkpoint()` 的位置感知，不是抢占式。
- 与 Java `InterruptedException` 的关系：语义角色相同（都表示「操作未完成，因为被打断」），机制不同——Java 由阻塞方法自动抛，我们由调用方主动查。
- **不携带错误信息**：没有错误码、没有 i18n key。需要向用户展示文案时，由边界按 kind 决定（如「已取消」）。
- 并入 `Outcome` 时直接作为 `cancelled` / `replaced` 分支，不额外包装。

### 3.3 `AppError`（既有，唯一错误类）

终态是**一个类**：`AppError<K extends ErrorKey>`，配一张 `ErrorCodes` 码表（6 位 DDDSSS，只追加不复用）与一个 `isAppError(error, key?)` 守卫。一期把另外 7 个 per-domain Error 子类与 39 个工厂函数全部退役，收敛到这个类。

- 字段：`key` / `code`（数字）/ `desc` / `messageKey?` / `messageParams?` / `details?`。
- **码表承载 message 模板**：每条 `ErrorCodes` 从 `{ code, desc }` 扩展为 `{ code, desc, messageKey? }`；参数类型由 `ErrorParamsMap` 单独声明，`new AppError(key, params)` 的 params 名与类型编译期校验。
- **构造器**：`(key, params?, options?)`。`params` 里任一枚为 `CoreMessageDescriptor` 时由 `findDescriptor` 取出作为该次错误的 messageKey；`params.detail` 用于覆盖动态文案。
- **不再有 per-domain Error 子类**：`PromptError` / `VfsError` / `ToolError` / `ProviderError` / `SessionFsError` / `ConfigDecodeError` / `VfsZipError` 全部退役，域字段进 `params`（强类型，不退化）。
- **不再有工厂函数**：nm-code-style §3 第 45 条——「不要给错误工厂再包一层：`agentDoomLoop()` 这种只有 `new AgentError` 的 wrapper 直接删，调用点写 `new AgentError(...)`」。工厂唯一的职责是复用 message 模板，模板搬进码表后函数没有存在理由。

### 3.4 `Result<T, E>`（既有，保留）

- 用于**纯计算、不可能被中断**的函数：解析、校验、编译、序列化。
- 与 `Outcome` 的边界：**函数是否会调 `checkpoint()` / 是否可能被取消**。会 → `Outcome`；不会 → `Result`。
- 已返回 `Result` 的 74 个 domain 文件中，纯计算的保持不动；会调 `checkpoint` 的改 `Outcome`（二期处理）。

### 3.5 四者关系

```
一次操作的结果
├─ Outcome<T>
│   ├─ completed(value)        ← 成功
│   ├─ cancelled(reason)       ← Interrupt
│   ├─ replaced                ← Interrupt
│   └─ failed(AppError)        ← 业务错误
└─ Result<T, E>（纯计算，无中断可能）
    ├─ Ok(value)
    └─ Err(E)                  ← E 通常是 AppError
```

## 四、通道转码矩阵

内部产出 → 边界行为 → 外部形态：

| 内部结果 | 桌面 IPC handler | 移动 service/UI | CLI | 跨进程 |
|---|---|---|---|---|
| `completed(value)` | `{ ok: true, data }` | 正常返回 | exit 0 | 序列化 value |
| `cancelled(reason)` | `{ ok: false, error: { code: "TASK_CANCELLED" } }`，renderer 静默 | 账本记 `"cancelled"`，UI 回到可操作态 | exit 130 | 不跨进程 |
| `replaced` | `{ ok: false, error: { code: "TASK_REPLACED" } }` + 重载提示 | 提示「库已替换」并重载 | exit 130 | 不跨进程 |
| `failed(AppError)` | `formatIpcError(err)` 映射 code/message | `formatError(err)` + i18n | `cli-errors` 格式化 | `AppErrorWire` |
| 未知 throw | `INFRA_UNEXPECTED_ERROR` + 日志 | 兜底文案 | 非零 exit + 堆栈 | 不跨进程 |

**`TASK_CANCELLED` / `TASK_REPLACED` 是一期码表登记的正式 ErrorKey**（123 IPC 段）——不是 IPC 层私有码，也不存在「ABORTED」这个独立字符串。这样 `IpcErrorPayload.code` 的取值空间可以收敛为「只允许 ErrorKey」而不留例外。

**禁止**：把 `cancelled` 映射成用户可见错误 toast；把 `failed` 吞成 `cancelled`；让 `Interrupt` 跨进程。

## 五、平台例外清单

只有以下例外允许 throw，新增例外必须先改本文件：

1. **`fetch` 的 `AbortError`**——平台在取消时 reject，签名不是我们的；`isAbortLikeError` 按 `name === "AbortError"` 判别。
2. **事务回滚（better-sqlite3 与 tdbc 同判）**——`db.transaction(fn)` / `conn.transaction(fn)` 只认「抛错回滚」，`fn` 内 `if (!r.ok) throw r.error` 是必需的；`fn` 直接 return 会 commit 半写（p26 R1 起按此判据登记实例文件，throw-audit 规则对「`.transaction(...)` 回调实参内的 throw」AST 自动放行）。
3. **`Promise.race` / `raceWithAbort` 的 reject**——Promise 只有 reject 通道，没有返回值通道。
4. **`AbortSignal.throwIfAborted()`**——标准库 API，形态固定。
5. **`LlmProtocolAdapter` 与 sse parser 出口的 ProviderError throw 通道**（2026-11-16 六期收口裁决）——port 契约 `listModels`/`chat` 返回 `LlmListModelsResult`/`LlmChatResult`（无失败位），retry 按 catch + code 分派是 spec-2 §2.1 明文保留的协议；内部 `fetchJson`/`assertOk`/`assertSseParseSucceededOrThrow` 已 Result 化，adapter 与 `*-sse-parser` 的流出口把 Result 失败解包转 throw 喂给 transport 的 catch → reject。仅限 `infra/llm-protocol` 的三个 adapter 与三个 sse-parser 文件。
6. ~~**`IntegrityRepairOperation.detect/repair` 的报告契约**（2026-11-16 六期收口裁决）——接口「只认报告/异常」，`runAll` 捕异常写进修复报告；repo 已 Result 化，操作实现在读 repo 处解包转 throw 由 `runAll` 收口。~~ **已随 p26 R4 退役（2026-11-20）**：接口改为 `detect(): Promise<Result<IntegrityRepairDetection, AppError>>` / `repair(): Promise<Result<void, AppError>>`，已知失败沿 Result 上行、runAll 的 catch 降级为平台异常兜网；本例外不再授权任何 unwrap-throw。
7. **unwrap-throw 边界转码**（2026-11-20 p26 R1 裁决，门⑦ ALLOW_FILES 与 throw-audit baseline 双登记）——`throw x.error` 在以下边界形态合法：
   - **a. runner 收口漏斗**：`run-agent-turn.ts` 的 `run`（throw 喂同函数 catch 的统一收口——FAILED('') 补发 + onRunFailed 记账，直接 return 会跳过终态事件）与 `mapResolveError`（OrThrow 转码边界，desktop rejection 契约，十八期 T3 已审）。
   - **b. IPC handler 边界**：`apps/desktop/src/main/ipc/handlers/agent-registry.ts` 的 exportYaml（依赖调用只有 throw 通道，handler catch 转 IpcResult 线格式）。
   - **c. AgentSession.list port 契约**：`chat-agent-session.ts` / `assemble-agent-runner-deps.ts`——已知失败抛出交 agent-runner 主 catch 收口（步进漏斗）；list 的消费点在 runner 步进循环内，Result 化只会把 unwrap-throw 挪进 runner（同款 `raiseRunError` 形态已存在），不改变净违规数。
   - **d. 写库边界契约**：`provider-table-snapshot.ts` 的 restore——对外契约「任意行非法则抛 AppError（`DB_BACKUP_*`）」，调用方按 catch 收口（文件 JSDoc 自白）。
   - **e. 校验槽位回调（zod preprocess 同款例外）**：`vfs-character-card.service.ts` / `yaml-shared.ts` 的 assertFileName 槽——DocumentIo 槽位契约只认 throw，没有 Result 通道；Result 边界在 `CharacterCardDocumentPick` / `YamlDocumentPick`。

## 六、三期路线

### 6.0 为什么按层切而不是按模块切

两种切法都可行，选按层（errors/ → core → apps）是因为 `errors/` 是全仓公共依赖：

- **按模块切**（一期 vfs 端到端、二期 chat 端到端…）每期结束状态最干净，但 `error-codes.ts`、`app-error.ts`、`public/*.ts` 会被每一期反复改，码表被反复追加，同一文件在三个期里各动一次——冲突面和回归面都更大。
- **按层切**每期改动面收敛，类型与码表只动一次；代价是每期末存在明确的中间态。

中间态不是「迁不干净」，前提是**每期末的状态写死，并且有机械门禁收口**：

| 期末 | 构造（造错误） | 传播（错误怎么出去） | grep 门（可执行） |
|---|---|---|---|
| 一期后 | **全仓统一**：无工厂、无 per-domain 子类，一律 `new AppError(key, params)` | 未统一：domain/service 内仍有 `throw new AppError(...)`（过渡形态） | ① `grep -rn "extends Error" packages/core/src/errors/ \| grep -v "class AppError"` 必须为空；② `grep -rn "return new AppError" packages/core/src/errors/` 仅允许 `skillNotFoundInDomain`（service 私有，例外已登记） |
| 二期后 | 同上 | **core 统一**：域逻辑与校验返回 `Result`/`Outcome`，只有边界与平台例外 throw | `grep -rn "throw new AppError" packages/core/src/{domain,service}` 的命中必须全部落在白名单（白名单 = §2.3 硬清单 16 处不变量文件 + 26 处事务回调文件 + 边界文件，随 spec-2 冻结） |
| 三期后 | 同上 | **全仓统一**：apps 三端走同一分派链 | ① 全仓 `throw new AppError` 命中 ⊆ 二期白名单 ∪ apps 边界白名单；② `packages/{core,apps}/src` 内 `instanceof (Vfs\|Tool\|Provider\|SessionFs\|VfsZip\|Prompt\|ConfigDecode)Error` 为空；③ `isVfsError(...)` **带字符串短码实参**的调用为零——双形态守卫本身保留（它是 apps 的生产消费者），门只抓 `isVfsError(x, "NOT_FOUND")` 这种旧短码实参；④ `IpcErrorPayload.code` 取值抽查全为 `ErrorKey` |

另需独立判据（grep 抓不到）：`throw r.error` 的解包形态——二期后 `packages/core/src/{domain,service}` 内该形态只允许出现在事务回调与判定为「边界」的函数内（按 §2.4 规则逐文件裁决，验收按文件清单）。

三条 grep 门 + 解包判据写进各期收尾 Step 的验收项，不是建议——这是防止「改了一半忘了」的唯一机械保障。验收按**文件清单**锁定，处数只作参考（实测与早期估算有 30-90% 偏差：desktop 65 throw/210 catch、mobile 120/377、cli 134/9；core domain 211/45、service 264/37、解包 105 处）。

### 6.1 三份 spec

| 期 | spec | 范围 |
|---|---|---|
| 一期 | `spec.md` | errors/ 收敛：1 类 + 1 码表 + 1 参数表，0 工厂 0 子类 |
| 二期 | `spec-2-core.md` | core 通道统一：592 处 throw 按五类处置 |
| 三期 | `spec-3-apps.md` | apps 三端 + public 导出面收口 |

| 期 | 范围 | 文件数 | 改动行数 | 依赖 | 可停点 |
|---|---|---|---|---|---|
| 一期 | 类型落地 + `errors/` 收敛（1 类 + 1 码表 + 1 参数表，0 工厂 0 子类） | 80-90 | 1000-1200 | 无 | errors/ 单点收敛 |
| 二期 | core domain + service 统一 | 180-220 | 1500-1800 | 一期 | core 全绿 |
| 三期 | apps 三端 + public 导出面 | 140-160 | 1100-1400 | 二期 | 全仓统一 |

### 一期（`error-channel-migration/spec.md`）

1. 新增 `errors/outcome.ts`：`Outcome<T>` / `Interrupt` + 组合子，零调用点变更。
2. 码表每条补 `messageKey`，新增 `ErrorParamsMap` 参数类型表，`AppError` 构造器改 `(key, params?, options?)`。
3. 删 6 个零调用死码。
4. **39 个工厂与 7 个 Error 子类全部退役**，约 300 处构造/调用点改 `new AppError(key, params)`。
5. `instanceof XxxError` 改 `isAppError(error, key)`；`isVfsError` / `isSessionFsError` 的结构判别保留。
6. 双端三条格式化链适配：`format-ipc-error` / `format-error` / `cli-errors`。

### 二期（core 统一）

- domain 211 处 throw 分类：域校验约 100 处 → `Outcome.failed`；控制流 10 处 → `Interrupt`；编程错误与平台边界保留。
- service 261 处 throw：内部调用解包，边界保留 `if (!r.ok) throw r.error`。
- 74 个已返回 `Result` 的 domain 文件：会调 `checkpoint` 的改 `Outcome`，纯计算的保持。

### 三期（apps + 导出面）

- desktop：`IpcResult` 与 `Outcome` 的关系定死，30 个 Result 文件、60 处 throw、164 处 catch 适配。
- mobile：`format-error` 链改，97 处 throw、40 个 Result 文件适配。
- cli：`cli-errors` 链去重（同一条 instanceof 链抄了两遍），123 处 throw 适配。
- public：errors 相关符号裁决（以一期完成后的实际导出面为准），双端 import 改路径，`test/package-exports/public-subpath-allowlist.test.ts` 的 `SUBPATHS` 加 `"errors"`、`snapshots/*-allowlist.json` 逐个重生成（含新建第 17 个）。

## 七、验收口径与不变量

### 7.1 每期通用

- `tsc` 全绿；该层测试全绿；`check-style.mjs --changed` 的 signatures / inline / methods 三段 PASS。
- **行为等价**：错误码数值、`desc`、i18n key、`message` 内容零变化（一期迁移 8 个类时，旧字符串 code → 新 key 的映射必须逐条对照）。
- 测试断言从「`instanceof XxxError`」改为「`isAppError(e, "KEY")`」时，锁的是同一语义，不是放宽。

### 7.2 不变量

1. **码表只追加**：数值不复用、不改号；删除类时旧码保留（标 `历史保留`）。
2. **`AppErrorWire` 跨进程格式不变**：`{ key, code, desc, message, messageKey?, messageParams?, details? }`。
3. **`isVfsError` / `isSessionFsError` 保持结构判别**（`name + code` + cause 链），不得改 `instanceof`——测试环境存在 src/dist 双模块实例。一期后这两个守卫改为**双形态**：接受 `AppError`（判断 `key` 前缀）与「旧形态对象」（`name === "VfsError"` + 字符串短码），后者仅由 `legacy-vfs-error.ts` 的 mapper 生产，三期删 mapper 后该分支一并删除。
4. **`Result` 现有 74 个 domain 文件的纯计算用法不被迫改**。
5. **`isAppError` 语义不变**：`instanceof AppError && (key === undefined || error.key === key)`；**不支持 `"VFS_*"` 这类前缀通配**——需要前缀判别时用 `error.key.startsWith("VFS_")` 或新增专用守卫，不扩 `isAppError`。
6. **`AppError.name === key`**：构造器必须写 `this.name = key`（`isVfsError` / `isSessionFsError` 的结构判别依赖 `name`）。
7. **`messageParams` 用 snake_case**：catalog 模板占位是 `{snake_case}`（`common/i18n.ts` 的 `/\{(\w+)\}/` 精确匹配、无归一），因此 `AppError` 构造器负责把 `params` 的 camelCase 成员名转成 snake_case 再写入 `messageParams`；`details` 保留 camelCase（供内部消费）。

### 7.3 码表域段（实测，`error-codes.ts:14-20`）

101 AGENT / 102 VFS（含 VFS_ZIP_*、VFS_CONTENT_*）/ 103 VFS_CHARACTER_CARD / 104 TOOL / 105 PROVIDER / 106 CHAT / 107 SKILL / 108 COMPACTION_CONDITIONS(001-499)+SMART_SORT_RULE(500-999) / 109 CONFIG(001-499)+PREFERENCES(500-999) / 110 INFRA / 111 DEPTH / 112 EVENTS / 113 FEATURE_FLAGS / 114 FORMAT / 115 KKV / 116 SESSION_FS / 117 PROMPT / 118 SESSION_KKV / 119 SESSION_RUN_STATE / 120 USAGE / 121 WORKPLACE。

**新增域段**：122 CLOUD_SYNC（云同步 **12** 个码整体迁入，见三期）、123 IPC（`TASK_CANCELLED` / `TASK_REPLACED` / `IPC_INVALID_URL` / `IPC_INVALID_MENU` / `IPC_NO_WINDOW` / `IPC_INVALID_ARGUMENT`）。域段登记在 `test/errors/app-error.test.ts` 的 `DOMAIN_RANGES`。

**码表的「只动一次」指结构**：`{ code, desc }` → `{ code, desc, messageKey }` 的扩展与 `ErrorParamsMap` 的建立只在一期做一次；**条目**允许各期追加（只追加、不改号、不复用），追加时同步 `i18n/keys.ts` 与双 catalog。

## 八、风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 8 个类迁移时旧 code → 新 key 映射漏项 | 错误码语义漂移，埋点/日志断档 | 迁移前先落一张「旧 code → 新 key」完整映射表，逐条测试锁 |
| `instanceof` 改 `isAppError` 时跨包序列化产物不满足 | 边界判不出错，文案兜底 | `isAppError` 保留 instanceof 语义，跨进程侧统一走 `AppErrorWire` 重建 |
| 双端格式化链漏一端 | 一端弹正确文案、一端兜底 | 双端镜像逐字 diff（项目记忆 #242 同款口径） |
| public 撤导出破坏跨包 | apps 编译红 | 一期只撤**退役类与死码工厂**的导出（7 个类 + 6 个死码 + 已删工厂，属编译强制），并同波更新 allowlist 快照；导出面「大盘裁决」留三期 |
| 中途停在半程 | 仓库两种风格并存 | 每期独立可停；一期完成即 errors/ 自洽，二期完成后 core 自洽 |

回滚策略：每期一个独立提交群，按 `phase-<id>` 切分，任一波失败整波回退，不影响已完成的波。
