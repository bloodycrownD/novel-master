# p25 波 1 — C 类族判定（只读产出）

> 判定人：p25 波 1 只读 agent。基线 = p24-subject-cluster-core（worktree `feat/error-channel-slim`）。
> 判据：spec §一/§三（同主体多动词 → 收 namespace；单点/跨域杂烩/主体不成立 → 跳过）。
> 对照先例：p24 波 1 C 类 core 侧判定（见 `docs/apm/memory/20261119-p23-p24-iteration-execution.md`：FileCachePayload 跳过跨域不搬、VfsZip core 侧一文件一 namespace 收 7 文件、resolvePathsNeedDeleteInTransaction 收成 ReconcilePaths）。
> 四族全部给出结论，无「未判定」（spec §六第 8 条）。
>
> ⚠️ 行号基线：本判定取证时 p25 波 0 A 类 agent 正在同 worktree 并行改 `session-stream-unit*.ts`（SessionViewCache/RowWindow 族），该文件行号以本文件为准、随后续提交可能再漂移；**函数名与文件是稳定锚点**，实施时以 grep 定位为准。

---

## 族 1：StreamRowIds ×5 — **跳过**（不建跨文件 namespace）

### 现状（5 动词分居 3 文件，口径同旧 spec 71f7558fe：apply/get/idle/inherit/trim）

| 动词 | 位置 | 形态 |
|---|---|---|
| `applyStreamRowIds(rows, ids): Rows` | `apps/mobile/src/components/chat/transcript-stream-projection.ts:116` | **唯一裸顶层 export function** |
| `getStreamRowIds(): StreamRowIds` | `apps/mobile/src/services/session-stream-unit.ts:998` | `SessionStreamUnit` 公开方法 |
| `inheritStreamRowIds(map): void` | `apps/mobile/src/services/session-stream-unit.ts:1018` | `SessionStreamUnit` 公开方法 |
| `idleStreamRowIds(sessionId)` | `apps/mobile/src/services/session-stream-unit-manager.service.ts:1245` | manager 私有方法 |
| `trimStreamRowIds(map)` | `apps/mobile/src/services/session-stream-unit.ts:1700` | 文件私有函数（绑 unit 侧上限常量，:336 注释「manager 出表合并同口径」） |
| （口径外第 6 处）`recordStreamRowId(messageId, streamId)` | `apps/mobile/src/services/session-stream-unit.ts:1432` | `SessionStreamUnit` 私有方法 |

### 主体判定：不成立（作为「收进 namespace」的前提）

5 个动词的状态所有者分属三个主体，收成一个 namespace 要跨三层搬状态：

1. **unit 实例状态**（`streamRowIdsValue` 字段，session-stream-unit.ts:437）：get/inherit/record/trim 四个动词全在 `SessionStreamUnit` 类内操作这一个字段——「概念单元拥有全部操作」已经被 **class** 满足。namespace 不能充当实例状态的接收者（nm-code-style 规则；参考 327061a8c「命名容器不充当接收者归因目标」），把方法搬进 object 等于把实例字段改模块级全局态，破坏 copy-on-write 引用稳定契约（:1387 附近 keep-local 注释明确点名「共享 pendingAdoptions 队列与 streamRowIds copy-on-write」）。
2. **manager 的 idle 视图缓存**（`idleMessageViews`）：`idleStreamRowIds` 读的是 manager 自己的出表缓存（:1246），与 unit 实例状态是两个所有者。
3. **投影参数变换**：`applyStreamRowIds` 不持有 row-ids 状态，`ids` 只是入参；它的主体是「流式行投影」，与同文件 `buildStreamingRows`（:71）/`buildStreamingTranscriptRow`（:142）同族（文件头 :4-7 明写三入口分工）。

### 结论：跳过

- 不建跨文件 `StreamRowIds` namespace：4/5 是类方法或文件私有，本就不在 p25 裸函数口径（816 函数）内；唯一裸函数 `applyStreamRowIds` 的主体归属是投影文件不是 row-ids 状态。
- `applyStreamRowIds` 随 `transcript-stream-projection.ts` 走 p25 波 4 components 桶的机械规则：文件 namespace = `TranscriptStreamProjection`（文件名 PascalCase）；成员名均不含文件主体词，**全部保留原名**（`buildStreamingRows` / `applyStreamRowIds` / `buildStreamingTranscriptRow`）。
- 状态侧（get/inherit/record/trim + `StreamRowIds` 类型别名 :1697）维持类方法形态，登记保留。

### 消费面规模

- `applyStreamRowIds`：4 调用点，**全部**在 `ChatConversationWebView.tsx`（:1110/:1230/:1789/:1811）——单消费文件。
- `EMPTY_STREAM_ROW_IDS` 常量（:25，const 非 function，不在 816 口径内）：3 消费文件（`ChatConversationWebView.tsx:403` / `SubagentSessionScreen.tsx:328` / `ChatTabProvider.tsx:277`）；manager 内有同名文件私有镜像（`session-stream-unit-manager.service.ts:166`），镜像不动。

### 波 7 实施提示

无实施项（跳过族）。若波 4 桶收 `transcript-stream-projection.ts`：`EMPTY_STREAMING_ROWS`/`EMPTY_STREAM_ROW_IDS` 两个稳定空引用常量按桶规则决定是否随收（const 不在 spec §3.1「文件内全部裸 export function」强制口径内，但同文件收口时建议一并进 namespace 以保持单出口）；3 个消费文件的 import 同步改。

---

## 族 2：DbMaintenance do/handle/run — **收**（文件级 namespace，随各自桶）+ **删 `doDbMaintenance`**（动词漂移修正）

### 现状

| 位置 | 函数 |
|---|---|
| `apps/desktop/src/main/ipc/handlers/db-maintenance.ts` | `handleDbStats` :20 / `handleDbMaintenance` :31 / **`doDbMaintenance`** :43 |
| `apps/desktop/src/main/services/db-maintenance.service.ts` | `getDbMaintenanceStats` :17 / `runDbMaintenance` :42 |
| `apps/mobile/src/services/db-maintenance.service.ts` | `statDatabaseFileBytes` :27（文件私有）/ `getDbMaintenanceStats` :38 / `runDbMaintenance` :54 |
| 两平台 `services/db-maintenance-busy.ts` | `maintenanceBusy`（export const，非裸函数口径） |

### 主体判定：成立（分层三主体，各自成族；不跨层并文件）

- **core 先例**（p24 已收）：`packages/core/src/infra/db-maintenance/impl/db-maintenance.service.ts:19` — `export const DbMaintenance = { readStorageStats, create }`，core 层主体 = PRAGMA 原语 + 维护链（GC → checkpoint → VACUUM）。
- **desktop service**：get/run 双动词同一主体（db 维护编排骨架），与 core 形态对齐但**不同主体**（core 是原语层，apps 是平台编排骨架；mobile service 文件头 :5-7 明写「清理执行链在 core `DbMaintenance.create`…本服务只补 mobile 侧事情」）。
- **mobile service**：同样 get/run 双动词 + 1 文件私有采样助手；签名与 desktop 不同（`runtime` 入参 vs `checkpoint` option）——双端镜像，不是可合并的同主体。
- **handler 层**：IPC 边界转码（Result → IpcResult、runAbortable 装配），主体是「db-maintenance 的 IPC 面」。
- **`maintenanceBusy` 不属本族**：它是 backup/cloud-sync/maintenance 三域共享的并发原语（desktop 4 文件、mobile 4 文件消费），主体是「维护互斥旗」，维持现状不动。

**do/handle 转手判定（旧 spec 预案命中）**：`doDbMaintenance`（handlers/db-maintenance.ts:43-45）是**单行转手 wrapper**——把 `scope` 换成 `checkpoint` 闭包后转调 `runDbMaintenance`，唯一调用者是同文件 `handleDbMaintenance:35`。属 nm-code-style 明文的「单行转手 wrapper 删除」；动词统一后 handler 层 `handle*`、service 层 `run/get`，无漂移。

### 结论：收 + 删

spec §五「不改任何函数体」的显式例外条款（「除 C 类判定出动词漂移需删重复入口的 DbMaintenance」）覆盖本族删除动作。

**成员映射草案**（按机械规则：文件名 PascalCase、剥主体词）：

| 文件 | namespace | 成员映射 |
|---|---|---|
| `desktop/src/main/ipc/handlers/db-maintenance.ts` | `DbMaintenance` | `handleDbMaintenance` → `handle`（剥主体词）；`handleDbStats` → **保留**（不含主体词，保留区分性修饰）；`doDbMaintenance` → **删除**（checkpoint 闭包内联进 `handle`）；`DbMaintenanceRunRequest` type 导出不动 |
| `desktop/src/main/services/db-maintenance.service.ts` | `DbMaintenanceService` | `runDbMaintenance` → `run`；`getDbMaintenanceStats` → `getStats` |
| `mobile/src/services/db-maintenance.service.ts` | `DbMaintenanceService` | `runDbMaintenance` → `run`；`getDbMaintenanceStats` → `getStats`；`statDatabaseFileBytes` 文件私有随收（:27） |

三个 namespace 名互不冲突（不同模块）；mobile `DbMaintenanceService` 与 core 的 `DbMaintenanceService` **port 类型**不在同一 import 域，无撞名。

### 消费面规模

- desktop handler：`handler-registry.ts` 2 绑定点（:350 `bindNoArg(IPC_CHANNELS.DB_STATS, handleDbStats)` / :351 `bindReq(IPC_CHANNELS.DB_MAINTENANCE, handleDbMaintenance)`）。
- desktop service：1 消费文件（handler import :12）。
- mobile service：1 消费文件（`StorageConfigScreen.tsx` :63 getStats、:123 run）。
- `doDbMaintenance`：1 调用点（同文件 :35）。
- 测试消费：`apps/desktop/test/db-maintenance-handlers.test.ts`（直接 import `handleDbMaintenance`/`handleDbStats`/`runDbMaintenance`，6+ 调用点）；`apps/mobile/__tests__/db-maintenance.service.test.ts`、`apps/mobile/__tests__/storage-config-screen-cancel.test.tsx`。

合计生产消费文件 5 个 / 调用与绑定点约 7 处 + 测试文件 3 个。

### 波 7 实施提示

1. 删 `doDbMaintenance` 时把 `checkpoint: () => scope.checkpoint()` 内联进 `handleDbMaintenance:35` 的 `runAbortable` 回调；:39-42 的维护段注释（不可中断窗口语义）随迁到 `handle` 上。
2. handler-registry 绑定改 `DbMaintenance.handleDbStats` / `DbMaintenance.handle` 形态，`bindNoArg`/`bindReq` 签名不变（函数引用）。
3. desktop 测试 `db-maintenance-handlers.test.ts` 的 import 同步改名；mobile 两个测试文件核对直接 import 面。
4. mobile service 侧无 keep-public/keep-local 标注（:27/:38/:54 均无），改名无标注冲突。
5. mobile 侧文件已 import core 的 `DbMaintenance` namespace（:12）——本地 namespace 命名 `DbMaintenanceService` 避开同名，实施时注意两条 import 并存的读写清晰度。

---

## 族 3：HostMessage.handle ×4 — **跳过**（登记保留）

### 现状（四个 webview runtime 各一份 `handleHostMessage`）

| runtime | 位置 | 消息词汇表 |
|---|---|---|
| chat-transcript | `apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts:44` | 12 型：init / sessionSnapshot / prependPage / appendTailRows / streamDelta / streamBlockCommit / streamStatus / streamReset / flagsUpdate / themeUpdate / closeMenu / closeMermaidViewer |
| code-editor | `apps/mobile/src/web/code-editor/webview/runtime/bridge.ts:13` | 4 型：init / themeUpdate / setDocument / blur |
| composer-input | `apps/mobile/src/web/composer-input/webview/runtime/bridge.ts:18` | 6 型：init / themeUpdate / setText / setSelection / setDisabled / blur |
| rich-document | `apps/mobile/src/web/rich-document/webview/runtime/bridge.ts:29` | 7 型：init / setDocument / themeUpdate / setAnnotateEnabled / setAnnotations / clearAnnotateSelection / closeMermaidViewer |

### 主体判定：不成立（四份是四个 runtime 各自的入口，不是同一分派逻辑的四次复制）

- 四份的共同部分**只有信封解析与 v/type 校验**（`matchHostMessage(raw, BRIDGE_V)`），该部分已在十八期 C8 收进 `apps/mobile/src/web/shared/host-message-channel.ts:30`——真正的共享已经收完。
- case 体各调各的 runtime 模块（transcript 的 render/snapshot + stream、code-editor 的 editor、composer-input 的 editor、rich-document 的 annotate + documentViewSlot），消息词汇表互不相同，不存在可上提的分派逻辑。
- 词汇交集只有 `init`/`themeUpdate` 两型 → theme 处理也已收进 `@web/shared/host-theme`（bridge 文件头注明 web/C-orch-2）。
- 抽 `createHostMessageHandler(config)` 只会加一层表驱动间接，删不掉任何真实重复；且每份只有 1 个接线消费点，改造收益为零。

### 结论：跳过（登记保留）

旧 spec 预案的两分支中命中后者（「四个 runtime 各自的入口」）。`handleHostMessage` 的名字相似是**入口约定**不是复制信号。

### 消费面规模

每份恰 1 个接线消费（`bindHostMessageChannel(handleHostMessage)`：`chat-transcript/.../boot/boot-transcript.ts:12` / `code-editor/webview/main.ts:8` / `composer-input/webview/runtime/factory.ts:75` / `rich-document/webview/main.ts:50`）+ transcript 特有第二消费者 `host-downtranslate.ts:17,69`（宿主 v2 信封下行翻译后转调 runtime 版）。合计 5 个消费文件。

### 波 7 实施提示

无实施项（跳过族）。注意：四个 `bridge.ts` 文件本身还有其他裸 export（`post`、`setDocument`、`documentViewSlot`、`HostTheme` re-export 等），随 p25 波 4 web 桶按机械规则收文件 namespace——`handleHostMessage` 不含文件主体词，届时成员名保留原名；`rich-document` 的 `documentViewSlot` 与 `setDocument` 是视图槽门面（P0-3），收口时勿动槽语义。

---

## 族 4：VfsZip mobile 侧 — **跳过跨文件族**（分层成立）；mobile 文件自身随桶收 `VfsZipService`

### 现状（mobile 侧全部集中在 1 个文件）

| 函数 | 位置 |
|---|---|
| `exportVfsZip(runtime, scope, options)` | `apps/mobile/src/services/vfs-zip.service.ts:55` |
| `pickZipFileBytes()` | 同文件 :77 |
| `importVfsZip(runtime, scope, options)` | 同文件 :98（带 `nm-style: keep-public` 标注：测试锁名） |
| `resolveWorkspaceZipName(runtime, scope)` | 同文件 :29（文件私有，`nm-style: keep-local` 标注） |

### 主体判定：与 core 不同主体（原语 vs 流程分层成立）；mobile 自身单文件成族

- **core 侧处置（p24 先例，本族对照基准）**：core 收 **7 个一文件一 namespace** —— `VfsZipBuild` / `VfsZipParse` / `VfsZipValidate` / `VfsZipArchive` / `VfsZipCentralDir` / `VfsZipPath` / `VfsZipFilenameDecode`（`packages/core/src/domain/vfs/logic/vfs-zip-*.ts`），**不做单一 VfsZip namespace**（裁决理由：各文件错误联合类型互不相同，见 p24 记忆文档）。core 层主体 = zip 编解码**原语**。
- **mobile 层主体 = 平台流程层**：picker + 缓存落盘 + core 原语编排。调用链：
  - 导出：`exportVfsZip` → `VfsZipPath.resolveDirectoryPath` → `VfsServiceFactory.createZipIo(runtime.conn).export` → `VfsZipArchive.assert` → `exportBytesViaDocumentPicker`（document-io，document picker 落盘）；
  - 导入：`importVfsZip` → `pickZipFileBytes`（picker + keepLocalCopy + `VfsZipArchive.assert`）→ `VfsZipPath.resolveDirectoryPath` → `createZipIo().import`。
  - 文件头 :6-7 明写分工：「ZIP 基名推导、目录路径规范化与归档完整性校验都在 core（`@novel-master/core/vfs`）；本模块只保留 picker / 缓存落盘」。
- 原语与流程分层成立 → **不并入 core 家族**（与旧 spec C 类预案一致：「若判分层则跳过，并把调用链写进 notes」，关联二十期 vfs-zip 劈三段问题）。
- mobile 自身：文件内 3 裸函数 + 1 私有助手同属「mobile vfs-zip 导入/导出流程」主体，**成族但为单文件族**——由 p25 波 3 services 桶的机械规则覆盖，无需 C 类跨文件特判。desktop 侧对应流程在 `desktop/src/main/ipc/handlers/vfs.ts`（`importVfsZipBytes` :59/:353/:382，:299 注释标明原 exportVfsZipWithDialog 已内联），不属本族，随波 5 桶走。

### 结论：跳过跨文件收口；文件级收口随桶（非 C 类特判项）

`apps/mobile/src/services/vfs-zip.service.ts` 按桶规则收 namespace = `VfsZipService`（文件名 PascalCase；全仓 grep 无撞名）。成员映射草案：`exportVfsZip` → `export`、`importVfsZip` → `import`、`pickZipFileBytes` → 保留原名（不含主体词）；`resolveWorkspaceZipName` 文件私有随收，keep-local 注释保留。

### 消费面规模

- `exportVfsZip`：2 消费文件（`components/vfs/VfsFileManager.tsx:51,914` / `screens/stack/SkillsSettingsScreen.tsx:28,195`）。
- `importVfsZip`：1 消费文件（`VfsFileManager.tsx:51,811`）。
- `pickZipFileBytes`：1 消费文件（`components/skills/NewSkillModal.tsx:19,116`）。
- 测试锁定：`apps/mobile/__tests__/vfs-zip.service.test.ts` 直接 import `exportVfsZip`/`importVfsZip` 并 jest.mock `@/services/vfs-zip.service` 模块接缝 + mock core `VfsServiceFactory.createZipIo`；`importVfsZip` 的 keep-public 标注点名 4 个 file-manager 集成测试锁名。
- `apps/mobile/test-utils/core-shim.ts:15-16` 转发 core 侧 `VfsZipBuild`/`VfsZipParse`（dist 转发层，属 core 侧导出面，本族不改）。

### 波 7 实施提示（桶实施时）

1. **keep-public 标注与改名冲突**：`importVfsZip` 的标注理由是「测试直接 import 断言 + 集成测试 mock 模块接缝，测试锁名」。namespace 化后顶层名删除即自动消解标注语义（namespace export 本身就是公开面）；实施时删标注、同步改 `vfs-zip.service.test.ts` 的直接 import 与断言名（`VfsZipService.import`）。
2. jest.mock 的**模块接缝 mock**（mock `@/services/vfs-zip.service`）不受成员改名影响，但 mock `@novel-master/core/vfs` 的 `VfsServiceFactory.createZipIo` 接缝保持不动（core 侧不改）。
4 个 file-manager 集成测试的 mock 断言目标核对一遍（标注点名）。
3. `pickZipFileBytes` 被 skills 域复用（NewSkillModal 导入技能 zip）——收进 `VfsZipService` 后 NewSkillModal import 同步改；这是本文件唯一的跨域消费，改名时勿漏。
4. 若二十期 vfs-zip 再劈段，本文件是流程层（第三段）的落点：core 原语（VfsZipBuild/Parse 等七 namespace）→ core 服务端口（VfsServiceFactory.createZipIo）→ 各端流程层（mobile 本文件 / desktop handlers/vfs.ts）。

---

## 汇总表

| 族 | 判定 | 理由一句话 |
|---|---|---|
| StreamRowIds ×5 | **跳过**（不建跨文件 namespace） | 4/5 动词是类方法/私有方法/文件私有，状态所有者是 `SessionStreamUnit` 类（copy-on-write 契约）；唯一裸函数 `applyStreamRowIds` 的主体是流式行投影，随投影文件桶收 `TranscriptStreamProjection` |
| DbMaintenance do/handle/run | **收**（三文件各收 namespace）+ **删 `doDbMaintenance`** | `do` 是单行转手 wrapper（唯一调用者同文件），删后动词统一 handle（IPC）/run+get（service）；三主体分层（core 原语/apps 骨架/IPC 边界）各按文件收，不跨层并文件 |
| HostMessage.handle ×4 | **跳过**（登记保留） | 四个 runtime 各自入口，消息词汇表互不相同；共享的信封解析已收 `matchHostMessage`（十八期 C8），theme 已收 `@web/shared/host-theme`，无可上提的重复 |
| VfsZip mobile 侧 | **跳过跨文件族**；文件随桶收 `VfsZipService` | mobile 是 core 七 namespace 原语之上的平台流程层（分层成立不并入 core）；文件内 3 裸函数单文件成族，机械桶规则覆盖，非 C 类特判项 |
