# D2-vfs：vfs 切片

## 元信息

- 模块：`domain/vfs` + `service/vfs` + `bootstrap/vfs`（含 `bootstrap/schema-migrations/vfs-*` 与 `bootstrap/novel-master-bootstrap.ts` 的 vfs 调度钩子）
- 文件范围：domain/vfs 51 文件 5 512 行 + service/vfs 15 文件 2 076 行 + bootstrap/vfs 3 文件 127 行 + 3 条 vfs schema migration（`vfs-entry-id-redesign-v1` / `vfs-content-blob-zlib-v1` / `vfs-revision-ref-count-v1`）+ `novel-master-bootstrap.ts` 的 vfs 相关段落
- 相关 Iterations：VFS、vfs-directory-nodes、vfs-move-and-frontmatter-bugfix、vfs-revision-storage-optimize、vfs-tool-error-diagnostics、vfs-unified-root、vfs-user-ops-unified-tool-turn、vfs-version-redesign、vfs-zip-io-agent-tool-policy、vfs-zip-native-compression、remove-mobile-vfs-zip-native、virtual-worktree、worktree-engine-convergence、worktree-vfs-ui-refresh-fix、chat-project-vfs、workspace-chat-vfs-upgrade、mobile-worktree-vfs-perf（17 个）
- lens 命中：L1✓ L2✓ L3✓ L4✓ L5✓ L6✓ L7✓ L8✓ L9✓ L10–（未直接命中） L11✓
- 轮次：phase2 round 1

## 模块画像

vfs 是仓库的复杂度黑洞，也是最重的有状态子系统。物理上它管三张 SQLite 表：`vfs_entry`（当前文件树，`entry_id` 主键 + `(scope_key, path)` 唯一约束）、`vfs_revision`（append-only 历史版本，`(entry_id, version)` 复合主键，软删靠 `status='deleted'` 墓碑）、`vfs_content_blob`（zlib 压缩 + 内容寻址 blob，带 `ref_count`）。三张表挂在一起靠两条引用计数：blob 的计数器由 SQL 触发器维护（revision INSERT/DELETE/UPDATE 时自动 ±1，归零删 blob），revision 的可达性计数器由应用层（`revision-ref-count.ts` + `revision-aware-vfs.service.ts`）在 checkpoint 增删和 live head 转移时维护。这两套计数器在 schema 注释里被明确写成「不同层级、并存不矛盾」，但任何动表结构的 migration 都得同时想清楚两边对齐——`vfs-entry-id-redesign-v1` migration 就为此写了大量双路径守卫代码。

数据流的主干是这样一条链：调用方走 `ScopedVfsService`（公共面入口，把 logical path 翻成 scopeKey）→ `RevisionAwareVfsService`（在 `runInTransactionOrConn` 内包一次写）→ `writeWithRevision` 等内部函数 → `SqliteVfsEntryRepository` + `SqliteVfsRevisionRepository` + `SqliteVfsContentStore`。一次普通 write 的步骤是：取 entry → 校验乐观版本号 → 同文短路 → 写 entry 行的 `content_hash`（明文 NULL）→ append 一条 revision（触发器自动给 blob +1）→ 应用层 `adjustRef +1` 给 revision 可达性。这条链事务边界画得严，单条写原子；问题全在跨操作编排（agent-runner 多步无事务）和跨端校验（zip 校验三端深度不同）。

vfs 几乎被整个仓库消费：三端 app 经 `@novel-master/core/vfs` 拿 `createVfsService` / `createScopedVfsService` / `createVfsZipIoService` / `createVfsBatchIoService` / `createCharacterCardImportService` 五个 factory + 一堆路径 helper；message-checkpoint 通过 revision-ref-count 反向依赖 vfs 的可达性 API；agent-tool 切片里的 vfs-tool-suite 和 tool policy 又会反向调 vfs 写能力。这条反向耦合在 phase3 跨切片时要重点看。

## 功能正确性核对

### F1（A）`vfs-version-redesign` PRD 承诺的「session 切换时跑 repairRefCounts」完全未实现

- 涉及角度：L1（数据模型）+ 功能正确性核对（PRD vs 代码）+ L4（吞错）+ L5（并发）
- 位置：`packages/core/src/bootstrap/novel-master-bootstrap.ts:106-113`；`docs/Iterations/vfs-version-redesign/prd.md:136`
- 矛盾点：vfs-version-redesign PRD 第 8 节「GC 与一致性补全」白纸黑字写「`repairRefCounts` 补空闲调度钩子，在 bootstrap 完成后**或 session 切换时**跑一次（core 内调度，不推给 apps）」。但代码里只有「bootstrap 完成后且仅当本次跑了 entry-id migration」一个触发点，session 切换调度完全不存在。spec.md（Step 15）已经把这条收窄到「新 migration 跑完后条件触发」，PRD 没同步收窄——PRD 比 spec 更激进，代码只兑现 spec 那部分。
- 依据：grep `repairRefCounts` 在 `packages/core/src` 下只有 `revision-ref-count.ts` 定义处 + `novel-master-bootstrap.ts:112` 一处调用，apps 层零调用。`message-rollback-execution-redesign` 的 cr-fix-spec.md L153 的 SD-repair-idle 已明确把这条标为「PRD 验收含『空闲校验可纠偏』；`repairRefCounts` 未接线生产调度 → fixed / 已收窄（rollback prd 注明 API 已实现、生产调度留后续 Step）」——也就是说 impl-docs 早就承认这是「留后续迭代」。
- 影响：当前实现在「migration 刚跑完、boot 后跑了 global scope 一次」之后，ref_count 偏高的 revision（异常路径、跨 session 引用计数漂移）没有任何空闲修复机制，只能等下次启动且再触发一次 migration——但 migration runner 是 id-based 幂等的，第二次启动直接跳过，`_entryIdMigrationJustApplied` 永远不会再变 true。**也就是说生产路径里 repairRefCounts 实际上只跑一次就再也不会跑**。L5 把「跨 await 读-改-写」按 floor 单调语义降级到 C，但前提是「后续会再跑修复」——这个前提并不成立。
- 建议：方向二选一。(a) 把 PRD/spec 同步改成「仅 migration 触发一次」，承认长期靠 floor 语义兜底；(b) 真按 PRD 接一个空闲调度钩子（比如 session 切换、用户主动 trigger、KKV 写一条 needs-repair flag 在下次 boot 检查）。建议方向 (b)，因为 ref_count 漂移到「偏高」是隐性数据正确性问题，没有可观测信号。

### F2（B）`repairRefCounts` 用空 sessionId 调用，checkpoint 指针路径静默空跑

- 涉及角度：L1 + 功能正确性核对 + L4
- 位置：`packages/core/src/bootstrap/novel-master-bootstrap.ts:112`；`packages/core/src/domain/vfs/logic/revision-ref-count.ts:85-122`
- 矛盾点：bootstrap 调用是 `repairRefCounts(revisionRepo, entryRepo, checkpoints, "global", "/", "")`——最后一个 `sessionId` 传空字符串。函数内部第 100 行 `await checkpoints.listFilePointersForSession(sessionId)` 拿的是「该 session 的 checkpoint 文件指针」，传 `""` 进去对一个 global scope 来说没有 session 概念，这一步对 expected Map 的贡献是 0。结果：global scope 的 repair 只看 live heads，完全不看 checkpoint 引用。对 global 来说这恰好是合理的（global 没 checkpoint 引用），但函数签名让人以为它会同时考虑 checkpoint 与 live heads，**这种「靠传空串让一段逻辑静默空跑」的耦合非常隐蔽**——任何人改 `listFilePointersForSession` 的空入参语义都会撞到。
- 依据：`revision-ref-count.ts` 顶部注释自己写「bootstrap W3 作为全局 template 兜底以 (global, /) 触发，只覆盖 global scope，session/project 靠 migration 保留 ref_count」——意图是对的，但实现靠 sessionId 空串达成「忽略 checkpoint」的效果。
- 建议：要么给 `repairRefCounts` 拆出 `repairLiveHeadsOnly`（语义明确），要么在函数签名里把 sessionId 改成 `sessionRef?: { sessionId: string }`（不传就不查 checkpoint），让空跑显式。

### F3（B）`vfs-zip-io-agent-tool-policy` PRD 的「失败整域回滚」承诺对 zip 路径成立，对 backfillBaselineCheckpoints 路径有隐性长事务

- 涉及角度：功能正确性核对 + L5（长事务）
- 位置：`packages/core/src/service/vfs/impl/vfs-zip-io.service.ts:177-213`
- 核对：PRD 验收「校验通过但写入过程中发生错误 → 该域工作区已回滚至导入前状态」兑现得很干净——`this.conn.transaction(async (tx) => {...})` 把 `releaseAndDeleteVfsPrefix` + `ensureEmptyDirectoryRow` + 批量 `insertFileSeedingRevision` + `backfillBaselineCheckpoints` 全包进单事务，catch 后包成 `IMPORT_FAILED`。语义对得上。
- 隐性问题：`backfillBaselineCheckpoints` 跑在事务内（line 202-212），它是「session scope 导入完成后，给所有没有 checkpoint 的 message 补 baseline 快照」。如果一个 session 已经积累了大量无 checkpoint 的消息（agent-runner 无事务路径的孤儿，见 D1-04 / D1-07），导入这个 session 会触发全量补 baseline，事务持有时间会爆炸。AsyncMutex 期间所有其他写都被阻塞（D1-05 已确认 SQLite 单连接 + mutex 是全仓库串行）。
- 建议：把 `backfillBaselineCheckpoints` 拆到事务提交之后（与 `runDeferredBlobGc` 同模式），或者加个 message 数量阈值，超过就分批。

### F4（B）`vfs-revision-storage-optimize` PRD 的「同文短路」承诺兑现，但走 content-blob 解码

- 涉及角度：功能正确性核对 + L2（隐性成本）
- 位置：`packages/core/src/service/vfs/impl/revision-aware-vfs.service.ts:371-373`；`packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:828-847`
- 核对：PRD 第 1 条「同文短路：对已存在文件，若写入正文与当前 live 正文逐字相同，则不升 version、不追加 revision」兑现了——`writeWithRevision` 第 371 行 `if (existing.content === content) return { version: existing.version }`。
- 隐性成本：`existing.content` 不是直接从 entry 行读出来的列值（entry 行的 `content` 列在 entry_id 化后永远是 NULL，见 L1-B），它来自 `rowToEntry` → `resolveEntryPlainContent` → 按 `content_hash` 去 `vfs_content_blob` 查明文。**所以每次 write 都要先做一次 content-blob lookup 才能判定是否同文**。这个 lookup 本身不是 N+1（write 单次只查一条），但意味着 write 路径上「同文短路」并不便宜——它要付一次 blob 解码（zlib 解压）+ 字符串相等比较的代价。
- 建议：算功能性正确，仅记录隐性成本。如果未来 vfs write 成为热路径，可考虑在 entry 行冗余一个短 hash（比如 content 前 64 字节的 hash）做快速短路。

## 交叉发现（核心产出）

### S1 双计数器 + 静默 repair + 单次调度 = ref_count 长期偏高无信号

- 涉及角度：L1（双计数器）+ L4（吞错）+ L5（非原子读改写）+ F1（PRD 承诺未兑现）
- 位置：`bootstrap/vfs/vfs-content-blob-schema.ts:1-24`、`bootstrap/vfs/vfs-revision-schema.ts:13-64`、`bootstrap/novel-master-bootstrap.ts:106-113`、`domain/vfs/logic/revision-ref-count.ts:85-122`
- 矛盾点：
  - L1 单看说「两套计数器并存合理」；
  - L4 单看说「`.catch(() => {})` 吞错」；
  - L5 单看说「repair 非原子但 floor 单调语义兜底，降级到 C」；
  - 把三条叠在 F1 的「生产路径只跑一次」事实上，结论就翻盘了：repair 的 floor 兜底**依赖「后续会再跑」**，而代码实际上后续永远不会跑（migration 是幂等的，第二次启动直接跳过）。这意味着任何一次 repair 失败（SQL 错误、运行时异常）或者 repair 漏修一行（并发 capture 把 ref_count bump 上去、stale want 漏算）造成的 ref_count 偏高，会**永久停留**。
  - 偏高的 ref_count 不会立即崩，但它会让 `deleteUnreferencedUnderScope` 漏删 revision 行（ref_count > 0 不删），revision 表慢慢膨胀；更严重的是触发器维护的 blob ref_count 与应用层 revision ref_count 走的是两条独立链，**应用层偏高不会反向修正 blob 计数**——blob 会按触发器正确归零删除，但 revision 行因为应用层计数偏高而残留，留下一堆「指向已删 blob 的 revision 行」。
- 依据：bootstrap line 112 的 `.catch(() => {})`；`vfs-revision.port.ts` 的 `repairRefCountFloor` 注释「保守纠偏、只增不减」；message-rollback-execution-redesign/cr-fix-spec.md SD-repair-idle 已承认生产调度未接线。
- 建议（不改代码，给方向）：
  1. 在 `.catch` 里至少 `console.warn("[bootstrap] repairRefCounts failed", error)`，把 L4-B 的吞错先止血；
  2. 真正补一个空闲调度（session 切换 / 用户主动触发 / KKV needs-repair flag），让 PRD 兑现；
  3. 在 `repairRefCounts` 函数注释里写清「依赖后续重复调用，单次调用不保证一致」——避免后续维护者按「单次强一致」扩语义。
- 这条是切片的 S 级头号发现。

### S2 vfs-zip 校验三端深度不同 × core 没有兜底 = 同一坏文件错误时机不同

- 涉及角度：L6（B-2 校验深度三端不同）+ L8（✅ core 路径穿越防护完备）+ 公共面
- 位置：`apps/cli/src/vfs/commands/export-zip.ts`（不校验）；`apps/desktop/src/main/services/vfs-zip.service.ts:25-38`（PK 魔数）；`apps/mobile/src/services/vfs-zip.service.ts:55-95`（PK + EOCD）；core 侧 `domain/vfs/logic/vfs-zip-validate.ts`
- 矛盾点：
  - L8 单看 core 侧说「vfs 路径穿越防护完备（含 zip bomb 上限）」，是对的——`vfs-zip-validate.ts` 的 `assertZipEntryNameAllowed` + `validateVfsZipEntries` 拒绝 backslash / `..` / Windows 绝对路径 / 跨域前缀，加上 32MB / 5000 entry / 512 字符路径上限，全到位。
  - L6 单看说「三端 `assertZipArchive` 深度不同：CLI 不校验、Desktop 查 PK 魔数、Mobile 扫 EOCD」。
  - 把两条叠起来看：**core 的 `vfs-zip-validate.ts` 是 import 路径上的校验，而三端不一致的 `assertZipArchive` 是 export 路径前的预检**。这两套校验目标不同——validate 是防恶意/损坏 zip 进入 import 流程，assertZipArchive 是防 export 阶段把不可读的字节当 ZIP 处理。L6 标的是 export 预检不一致，core 的 validate 不会救它，因为 export 阶段还没走到 validate。
  - 结果：用户在 desktop 上 export 一个截断 zip 文件（其实更可能是从外部源拿到一个 zip 准备 import 但走错了入口），desktop 预检通过、core validate 通过（validate 不查 EOCD 结构完整性，只查路径与编码），然后才在 unzip 阶段失败；mobile 在预检阶段就拒绝。错误码、错误消息、错误时机三端都不同。
- 依据：对比 core `vfs-zip-validate.ts` 与三端 `vfs-zip.service.ts` 的 `assertZipArchive` 实现；L6-B-2 已确认重复实现且行为不同。
- 建议：把 mobile 的 EOCD 扫描版 `assertZipArchive` 下沉到 core（比如 `domain/vfs/logic/vfs-zip-validate.ts` 加一个 `assertZipStructure(bytes)`），三端 import 入口先调它再做 validate。同时 L6-B-3 提到的 `vfsZipExportFileName` 三处复制粘贴也一并下沉到 core 的 zip helper。

### A1 ScopedVfsService + RevisionAwareVfsService 双层重复 normalize，被 42 处引用放大

- 涉及角度：L2-F6（path-mapper 重复 normalize）+ L3（path-mapper 是 42 次引用的 hub）+ 公共面
- 位置：`service/vfs/impl/scoped-vfs.service.ts:43-160`；`service/vfs/impl/revision-aware-vfs.service.ts:152,170,230,267,280,315`；`domain/vfs/logic/vfs-path-mapper.ts:39-60`
- 矛盾点：L2 已经标过 B 级「toPhysicalPath 在单次调用链里 normalize 跑 3 次」，但 L2 只看了 path-mapper 内部。叠加 ScopedVfsService 这一层后真实重复次数是 3：
  1. `ScopedVfsService.write` 第一步 `resolveLogicalPath(path)` → normalize 第 1 次；
  2. 同函数第二步 `assertLogicalPathAllowed(scope, logical)` 内部又 `resolveLogicalPath(logical)` → normalize 第 2 次；
  3. 把 logical 透传给 `RevisionAwareVfsService.write` → `writeWithRevision` 第 315 行 `normalizePath(path)` → normalize 第 3 次。
  - ScopedVfsService 13 个方法（list/mkdir/read/write/replace/glob/grep/delete/resetHeadToVersion/hardDelete/renamePath×2/renamePrefix）**每一个都重复这套双层 normalize**。L3 判定 path-mapper 是「port 型 hub、被广泛引用是正常」是对的，但被广泛引用 + 每次调用都做 3 倍功，叠加效应在 zip import 路径上更明显：`vfs-zip-validate.ts:117-209` 的 `assertLogicalAllowed(scope, logical)` 在循环里对每条 zip entry 调一次，5000 条 entry 就是 5000 × 3 = 15000 次 normalize。
- 依据：scoped-vfs.service.ts 全文每个方法都先 `resolveLogicalPath` 再 `assertLogicalPathAllowed`，两个函数都在 path-mapper.ts 里都调 `normalizePath`。
- 建议：让 `assertLogicalPathAllowed` 接收已 normalized 的路径（不再内部 resolve），调用方传 normalized 进来即可。`resolveLogicalPath` 本身保留，因为对外 API 要容忍用户传 `notes/a.md` 这种相对路径。改完后单次调用链 normalize 从 3 次降到 1 次，对 42 个引用点整体省 2/3 的 normalize 调用。

### A2 vfs-zip-io / vfs-batch-io 的 rethrow 把 cause 拍成字符串，错误类型与 stack 全丢

- 涉及角度：L4-B（多处 rethrow 丢 cause 链）+ 公共面（导出的 VfsZipError / VfsError 类型）
- 位置：
  - `service/vfs/impl/vfs-zip-io.service.ts:214-224`（`throw vfsZipError("IMPORT_FAILED", message)`）
  - `service/vfs/impl/vfs-batch-io.service.ts:303-313`（catch 后只把 message 装进 `failed[].message` 返回 report）
  - `service/vfs/impl/character-card-import.service.ts:151-161`（同款）
- 矛盾点：L4 已经把这条标过 B 级，单看「rethrow 丢 cause 链」是仓库通病。切片层面叠加上公共面发现：`@novel-master/core/vfs` 导出 `VfsZipError` / `VfsError` / `CharacterCardError` 三个错误类型 + `isVfsError` / type guard，**但导出的错误对象里不带 cause**。三端 app 拿到错误后想做「按错误码分类处理」（比如 IMPORT_FAILED 走 toast，NOT_CONFIRMED 走确认弹窗）是 OK 的，但想做「显示原始堆栈 / 上报错误追踪」就拿不到原始 cause。L4 单角度判 B 是对的；叠加公共面看，这条还是「错误对象的对外契约不完整」——类型导出了但诊断字段没导出。
- 依据：L4-D1-04 的 B 级条目，`errors/vfs-zip-errors.ts` 构造函数未收 `cause`。
- 建议：给 `VfsZipError` / `VfsError` 构造函数加 `options?: { cause?: unknown }` 透传给 `super(message, { cause })`（ES2022 标准、向后兼容）；rethrow 处改成传 cause。

### B1 vfs_entry.content 列保留 + entry_id 化后所有 INSERT 都写 NULL = schema 噪音 + 读路径分支负担

- 涉及角度：L1-B（content 列保留但新路径永不写入）+ L3（schema 噪音）+ F4（同文短路依赖 content-blob 解码）
- 位置：`bootstrap/vfs/vfs-schema.ts:13-24`；`domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:230,250,263`（所有 INSERT 都硬编码 `content=NULL`）；`domain/vfs/content-store/logic/resolve-stored-content.ts:47-61`
- 矛盾点：L1-B 标过 B 级「content 列保留但新路径永不写入」。切片层面叠加发现：`resolve-stored-content.ts` 的读路径还在 `if (fields.content != null) { return fields.content }` 兼容遗留明文（migration 窗口期未迁明文）。稳态库里 content 永远 NULL，这条分支永远走不到，但分支本身的存在让代码读起来像「content 还有用」，诱导维护者继续往里写。同时 F4 的同文短路绕了一圈从 blob 解明文，也跟这列保留互相加强「content 像主存储」的错觉。
- 依据：`vfs-schema.ts` 顶部注释「§A：暂不删该列，数据模型终态图保留它」；`vfs-content-blob-zlib-v1.ts` 的 `migratePlaintextToBlobs` 把 content 置 NULL。
- 建议：下一次 vfs 大改迭代时走 SQLite rebuild（vfs 已经有这套基建，见 `vfs-entry-id-redesign-v1`），把 `content` 列删掉，同时清掉 `resolve-stored-content.ts` 的明文回退分支。短期不动。

### B2 vfs-tree-copy.ts 的 @deprecated alias 与新名 sweepRevisionsUnderScope 并存

- 涉及角度：L9（迭代残留）+ 公共面（导出形状）
- 位置：`domain/vfs/logic/vfs-tree-copy.ts:280-303`
- 矛盾点：`releaseAndDeleteVfsPrefix` 标 `@deprecated`，被 `sweepRevisionsUnderScope` 包装。这是 vfs-version-redesign PRD §8 承诺的「releaseAndDeleteVfsPrefix 改走统一 sweep 路径」的产物，PRD 兑现了。但旧名仍然 export，并且 `vfs-zip-io.service.ts:182` / `vfs-tree-copy.ts:260` 还在用旧名（不是新名）。结果是「deprecated 函数仍被同模块内部消费」——这与「deprecated = 准备删除」的语义冲突。
- 依据：`grep releaseAndDeleteVfsPrefix` 在 `packages/core/src` 仍有 4 处调用点。
- 建议：要么把 4 处内部调用全换成 `sweepRevisionsUnderScope` 再真把旧名删掉，要么去掉 `@deprecated` 标注承认它是稳定 API。两选一，别长期挂着。

## 债务清单

| # | 严重度 | 标题 | 涉及角度 |
|---|-------|------|---------|
| S1 | **S** | 双计数器 + 静默 repair + 单次调度 = ref_count 长期偏高无信号 | L1+L4+L5+F1 |
| S2 | **S** | vfs-zip 校验三端深度不同 × core 没有兜底 = 错误时机不一致 | L6+L8+公共面 |
| F1 | **A** | vfs-version-redesign PRD「session 切换跑 repairRefCounts」未实现 | L1+L4+功能正确性 |
| F2 | **B** | repairRefCounts 用空 sessionId 调用，checkpoint 路径静默空跑 | L1+L4+功能正确性 |
| F3 | **B** | zip import 的 backfillBaselineCheckpoints 跑在事务内，长 session 长事务 | 功能正确性+L5 |
| F4 | **B** | 同文短路依赖 content-blob 解码，每次 write 付一次解压 | 功能正确性+L2 |
| A1 | **A** | ScopedVfs + RevisionAwareVfs 双层重复 normalize，42 引用放大 | L2+L3+公共面 |
| A2 | **A** | vfs-zip-io / vfs-batch-io rethrow 把 cause 拍字符串 | L4+公共面 |
| B1 | **B** | vfs_entry.content 列保留 + 读路径明文回退分支是噪音 | L1+L3+F4 |
| B2 | **B** | releaseAndDeleteVfsPrefix 标 @deprecated 仍被同模块消费 | L9+公共面 |

单角度已发现、本切片仅引用不展开：L1 双引用计数器并存（D1-01 A）；L1 rowToRevision N+1 隐患（D1-01 B）；L1 迁移循环逐行 INSERT（D1-01 B）；L2 user-vfs-save-mapping O(n³)（D1-02 F2）；L2 vfs-grep invert 内存放大（D1-02 F12）；L2 vfs-batch-roundtrips 串行 await（D1-02 F13）；L4 runInTransactionOrConn 依赖 NESTED_TRANSACTION 错误码（D1-04 B）；L4 bootstrap repairRefCounts 完全静默（D1-04 B，被 S1 升级吸收）；L5 vfs 跨操作编排无串行（D1-05 B，被 AsyncMutex 兜底）；L5 bootstrap 异步 repair 跨 await 读改写（D1-05 C，被 S1 升级吸收）；L6 vfsZipExportFileName 三处复制粘贴（D1-06 B-3）；L7 vfs 乐观锁冲突路径无测试（D1-07 A）；L8 vfs 路径穿越防护完备（D1-08 ✅）；L9 VfsZipIoService knip 误判（D1-09 + D0-3）；L11 vfs-zip-native-compression spec.md 描述已撤销功能（D1-11 B）。

## 与其他模块的耦合点

给 phase3 跨切片用：

- **D2-chat-message**：message-checkpoint 通过 `revision-ref-count.ts` 的 `incrementRefsForCheckpointFiles` / `decrementRefsForCheckpointFiles` / `repairRefCounts` 反向依赖 vfs ref_count。`SqliteMessageCheckpointRepository.insertCheckpoint` 跨 message-checkpoint 和 vfs 两个 context 改 ref_count，事务边界在 chat-message 切片定，但 ref_count 数据正确性影响在 vfs 这边——L1 已标 N+1（D1-01 A），切片叠加发现：ref_count 调整序列「先 decrement 旧 ref → 删旧行 → 插新行 → increment 新 ref」如果上层 service 没包事务就会泄漏。这条要在 phase3 拉两个切片一起评。
- **D2-agent-tool**：agent-runner 的多步无事务（append assistant + capture + append toolResults）直接影响 vfs 的 revision 链——capture 失败留下「有 user 消息但无 baseline checkpoint」，回滚时 reconcile 拿不到 anchor，会回退到空树。这条 L4 已经标过，但 vfs 切片确认了下游影响：vfs 的 `restore-mutating-path-heads.ts` 在快照为空时会按目标 revision 重建 live，但「空快照」与「无快照」在代码里区分不严格，rollback 空树可能误删整个工作区文件。
- **D2-chat-message（zip import 反向）**：F3 的 `backfillBaselineCheckpoints` 在 zip import 事务里跑，意味着 chat-message 切片的 checkpoint 写入路径在 vfs 切片的事务边界里被同步触发。两切片的事务嵌套模型要对齐。
- **D2-prompt**：prompt 不直接消费 vfs，但 `vfs-tool-error-diagnostics` 与 `vfs-user-ops-unified-tool-turn` 涉及 prompt 输出的 action XML 格式（`buildUserVfsActionXml`），prompt 切片如果改 action XML schema 会反向打到 vfs。
- **D2-compaction**：无直接耦合。
- **D2-provider-llm**：无直接耦合。
- **公共面**：`@novel-master/core/vfs` 暴露 5 个 factory + 一组 path helper + zip parse/build + character-card 解析。三端 app 全部经此入口。任何对 `createVfsService` / `createScopedVfsService` / `createVfsZipIoService` 签名的改动都是破坏性变更，因为 core 还停在 0.0.0（L8-A 已标）。

## 覆盖声明

查了的：
- 全部 bootstrap/vfs 三件套 schema（vfs-schema / vfs-content-blob-schema / vfs-revision-schema，含触发器 DDL）
- `bootstrap/novel-master-bootstrap.ts` 的 vfs 调度钩子（W3 异步 repair）+ `bootstrap/schema-migrations/vfs-entry-id-redesign-v1.ts` 前 90 行（探测 + Step 2 / 5b）
- 全部 service/vfs/impl 5 个 service（revision-aware-vfs / scoped-vfs / vfs.service / vfs-batch-io / vfs-zip-io / character-card-import，最后两个扫了关键 catch 段）
- domain/vfs/logic 关键文件：vfs-path-mapper、revision-ref-count、user-vfs-save-mapping、vfs-zip-validate、vfs-tree-copy、deferred-blob-gc
- domain/vfs/repositories/impl：sqlite-vfs-entry.repository（rowToEntry + insert/update 全路径）+ normalize-path
- domain/vfs/content-store/logic/resolve-stored-content
- 公共面：`packages/core/src/public/vfs.ts`、`packages/core/package.json` exports
- 关键迭代 PRD：vfs-revision-storage-optimize、vfs-zip-io-agent-tool-policy、vfs-zip-native-compression、remove-mobile-vfs-zip-native、vfs-version-redesign
- 关键迭代 SPEC 段：vfs-zip-io-agent-tool-policy spec、vfs-zip-native-compression spec、vfs-version-redesign spec、message-rollback-execution-redesign spec/cr-fix-spec（ref_count 与 deferred gc 合同部分）
- 11 份 D1 lens 报告中所有 vfs 命中段

没查的（为什么）：
- `sqlite-vfs-revision.repository.ts` 全文（只查了 rowToRevision 路径，按 L1-B 已知 N+1 隐患处理）。该文件 28 次引用是热点但单角度问题已被 L1/L2 覆盖。
- `vfs-zip-build.ts` / `vfs-zip-parse.ts` / `vfs-zip-central-dir.ts` 全文（L2 自评提到这两块未深读，切片沿用）。L8 已确认 zip slip 防护完备，不需要重复查。
- `vfs-grep.ts` 全文（L2-F12 已覆盖 invert 内存放大）。
- `vfs-move.ts` / `vfs-copy.ts` / `vfs-rename-primitive.ts` 全文（只在 revision-aware-vfs.service 看了它们的接入点）。vfs-version-redesign PRD §4 已确认 rename 从 O(N×N) 降为 O(1) SQL，这条债务已闭合。
- `service/vfs/build-user-vfs-turn-op.ts`、`build-user-vfs-turn-op.ts`、`build-user-vfs-turn-op.ts` 等 user-ops 链路（属 agent-tool 切片职责）。
- 三端 app 的 vfs-zip.service.ts 全文（L6 已覆盖校验深度差异）。
- mobile/desktop 的 VfsFileManager UI 层（属 L6 apps 层）。
- 测试目录 `packages/core/test/vfs/**`（按 D0-1 测试密度 1/178 + L7-A「乐观锁冲突路径无测试」已知覆盖薄，切片不重复核测试用例）。

为什么没查：本次是 readonly CR，单切片能投入的预算有限。未查文件的单角度问题已被对应 lens 覆盖，切片的价值在交叉发现，所以集中精力在 lens 已命中段 + 功能正确性核对 + 公共面上。

未宣布 ready。本切片只给建议，最终收敛由主代理在 phase4 synthesis 做。
