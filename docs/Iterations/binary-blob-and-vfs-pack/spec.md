---
date: 2026-09-28
---

# 落库形态去 base64 + VFS 版本链打包（vfs content pack）技术规格（SPEC）

需求来源：用户口述（2026-09-28：「方案还是收敛到那两件：先去 base64（消息 +33%、VFS 2.37MB、file_cache 0.07MB，零风险），然后 VFS 做 delta」）
＋ 上游实测结论（`docs/apm/memory/20260927-worktree-123-verify-guide.md`）
＋ **本轮复测修正**（见「实测基线与口径修正」——「VFS delta 82.6% / 10.7MB」为重复计数口径错误，真实值 61.3% / 3.06MB）。

前置依赖：`docs/Iterations/message-content-compression/`（分支 `feat/message-content-compression`，**尚未合并**）。本 SPEC 的 Part A 必须在该分支合并到 main 之后执行（合并前先解 CHANGELOG / `sqlite-message.repository.ts` / `SCHEMA_BOOT_VERSION`（分支为 17）三处合并冲突）。

---

## 设计目标

两条线，按收益/风险排序执行：

| 线 | 内容 | 预期收益（真库副本实测） | 风险 | 是否本期必做 |
|---|---|---|---|---|
| **Part A** | 落库压缩形态去 base64（RN 端由 `zlib-b64` 文本改二进制 BLOB），三张 blob 表统一 | **省 13.30MB**（message 10.864 + VFS 2.366 + file_cache 0.07） | 低（读路径三形态已兼容、无 schema 变更、降级安全） | 是 |
| **Part B** | VFS 同一 entry 的非 head 版本打包成一个压缩流 + 偏移索引（pack），替代「每版本一条独立压缩 blob」 | **省 3.06MB**（VFS 内容侧 6.080MB → 3.020MB） | 高（跨 8 处「hash ⇒ blob 行」隐含契约、新增两张表与后台任务） | 待用户拍板（收益远小于 Part A，工程量数倍于 Part A） |

Part A 完成后真机库约 79.0MB → **约 65.7MB**；Part B 再降到 **约 62.6MB**（均含 VACUUM 归还，按真库副本口径推算）。

非目标（本期不做，均已实测否决，见「已否决方案与依据」）：换压缩算法、内容级去重（CAS/CDC）、按会话打包、git 式 diff delta 编码器、字典链压缩、CHECK 值域收窄。

## 实测基线与口径修正

数据来源：真库副本 `tmp/nm-real.db`（2026-09-27 22:34 从荣耀 EBG-AN00 `run-as` 拉取，111,120,384 字节，`user_version=16`，即 message-content-compression 迁移**前**）。复测脚本：`tmp/vfs-pack-measure3.mjs`、`tmp/dict-vs-pack.mjs`（本轮新增/复用，输出 `.out.txt` 同目录）。

### 口径修正（重要）

- 旧结论「VFS 多版本 entry 独立压 12.936MB → 拼接 2.252MB，省 10.683MB / 82.6%」**基线错误**：把被多个版本共享的 blob 按 revision 行重复计入。
- 正确口径（按 `content_hash` 去重）：多版本 entry 命中的唯一 blob **6.080MB**（另一次独立复测 6.113MB，一致）→ 打包后 **3.020MB**，**省 3.06MB / 61.3%**。
- 理论下限（全链单流、不保 head 独立）为 **2.242MB**，与旧记录的「2.252MB」一致——**终点数字本来就对，错的只是基线**。

### 三张 blob 表现状（真库副本）

| 表 | 行数 | 现状存储 | 去 base64 后 | Part A 省 |
|---|---|---|---|---|
| `chat_message.content_blob` | 5350（全部已压缩） | 43.435MB（`zlib-b64`） | 32.571MB | **10.864MB** |
| `vfs_content_blob` | 1112（1099 b64 + 13 二进制） | 9.472MB | 7.105MB | **2.366MB** |
| `session_file_cache_blob` | 37（全 b64） | 0.278MB | 0.218MB | **0.06MB** |

明细：消息明文 73.199MB，二进制 deflate 2.25:1 / base64 口径 1.69:1（+33.4% 纯膨胀）。VFS 唯一明文 14.374MB，二进制口径 2.02:1。

### 顺带实测到的两条既有脏数据（本 SPEC 必须一并收口）

1. **`byte_len` 写法三态混杂**：`vfs_content_blob` 1112 行里 859 行 = base64 文本长度、71 行 = 二进制长度、97 行 = 二进制长度 − 2。归一任务必须**重算 `byte_len` = 落库字节的物理长度**。
2. **`encoding='zlib'` 但存的是 base64 文本**的历史形态（quick-sqlite 时代）在解码层有兜底分支，转换谓词必须用 `TYPEOF()` 判别而不是只看 `encoding`。

### 读放大与分桶（Part B 设计依据）

- 多版本 entry 150 个（其中 141 个「所有版本 ≤32KB」→ 省 70.6%；9 个含 >32KB 版本 → 省 32.3%）。
- 分组 pack（≤8 版本 / ≤1MB 明文一组、live head 保持独立）：190 组，单组最大明文 503KB、最大流 215KB。

## 总体方案

### Part A：三处写侧形态收口 + 一个存量归一任务

**写侧（3 处）**：平台分支判定整体删除，三处一律落二进制（`encoding='zlib'` + `tightBytes(compressed)`）：

| 位置 | 现状 | 改后 |
|---|---|---|
| `sqlite-vfs-content-store.ts`（`put`） | `preferZlibB64 ?? isReactNativeRuntime()` 分叉 | 恒二进制；`SqliteVfsContentStoreOptions.preferZlibB64` 删除 |
| `file-cache-blob-codec.ts`（`encodeFileCacheValue`） | `forceZlibB64 ?? isReactNativeRuntime()` | 恒二进制；`forceZlibB64` 参数删除；`byteLen` = 二进制长度 |
| `message-content-codec.ts`（`encodeMessageContent`，分支内文件，合并后在主干改） | 同上 | 同上 |

依据：op-sqlite 二进制 BLOB 读写往返已在真机 6 项探针全 PASS（`docs/apm/memory/20260927-worktree-123-verify-guide.md`）。**读路径一律不动**——`decodeCompressedBytes` 的三形态兼容（`zlib` 二进制 / `zlib` + 存量 base64 文本 / `zlib-b64`）是既有契约，存量行不转换也能读。`base64ToBytes` 与 `VFS_CONTENT_ENCODING_ZLIB_B64` 常量保留（读侧存量要用），仅 `bytesToBase64` 因失去生产调用方而删除。

**归一任务（core，新增）**：`runBlobBinaryNormalization`，表适配器参数化三张表，形态与 worktree 的 `message-content-compaction.ts` 同构：

- 谓词（三表同形）：`encoding = 'zlib-b64' OR (encoding = 'zlib' AND TYPEOF(bytes) = 'text')`；消息侧列名映射为 `content_encoding` / `content_blob`。
- 每批 ≤100 行，`SELECT` 只取主键 + `encoding` + `bytes`；每行短事务：base64 解码 → 二进制 → `UPDATE ... SET bytes=?, encoding='zlib', byte_len=?`（谓词进 `WHERE` 保证并发幂等）。
- 批间 `setTimeout(0)` 让步 + 单轮同步预算 60s（沿用既有 `DEFAULT_COMPACTION_SYNC_BUDGET_MS` 口径）；中断随时可重启，重启按谓词续扫。
- 完成标记：KKV module `nm-blob-binary`，key 按表 `messageContentDone` / `vfsContentDone` / `fileCacheDone`（三表各自短路，互不牵连）。
- 收尾维护：**仅在本轮确有推进（成功改写 ≥1 行）且全部表完成时**跑一次收尾维护链路（GC → checkpoint → VACUUM，经会话级去重入口 `runStartupMaintenanceOnce` 挂载）——稳态（标记已置、谓词空）零成本短路；上一轮维护失败由持久化标记 `startupMaintenancePending` 补跑。**手动路径 `runDatabaseMaintenance` 刻意不受该去重约束**（用户手动点「数据清理」必须每次真跑）。
- 状态查询 `getBlobBinaryStatus(conn)` 返回**已注册适配器**对应各表的 `{ done, pendingCount, failedCount }` 供存储页显示；**`done && failedCount > 0` 时状态行显示「已完成（N 条需人工处理）」**（第三态文案）。`failedCount` 的含义是「本轮跳过、解码失败的坏行，行原样保留、读路径按 miss 自愈」，不是「数据损坏待修」。未注册进适配器注册表的表不由 core 回报，UI 以 `—` 占位（与存储页既有占位风格一致）。
- **两端形状不统一是有意为之，不要求统一**：desktop 走 IPC DTO 惯例，状态查询结果保留 `{ tables }` 包装以便后续加字段；mobile 不走 IPC、由 service 侧拍平成数组直接喂列表渲染。这是两端的惯例差异，不是待收敛的偏差。

**为什么不用 schema migration**：`schema_migrations` 只有两态（`id` + `applied_at_ms`），无进度列；大库 data migrate 须「事务外、分批、可跨 boot 重入」，而 bootstrap 是单事务同步——既有纪律（空占位登记禁令 + `vfs-content-blob-zlib-v1` 先例）指向「谓词驱动后台任务」而非 migration。

**无 schema 变更**：三张表的 `encoding` CHECK 值域已含 `'zlib'`，读路径三形态已兼容，故 **Part A 刻意不 bump `SCHEMA_BOOT_VERSION`**（若与 Part B 同轮上线，则由 Part B 统一 bump 一次）。

**降级安全**：老版本 app 的 `decodeCompressedBytes` 同样认 `zlib` + 二进制，新形态对降级安装可读（`zlib-b64` 行也不消失）。

### Part B：VFS 同一 entry 的非 head 版本打包（content pack）

**核心思路**：把一个 entry 的多个历史版本明文按版本序拼成一个连续流、单次 deflate 压缩，配一张偏移索引；读取时按 `content_hash` 查索引、整组解压后切片返回。**对外语义完全不变**——所有调用方仍只看到「`content_hash` → 明文」。

存储模型（两张新表，canonical DDL + `SCHEMA_BOOT_VERSION` +1）：

```sql
CREATE TABLE IF NOT EXISTS vfs_content_pack (
  pack_id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('zlib-concat-v1')),
  bytes BLOB NOT NULL,
  byte_len INTEGER NOT NULL,
  member_count INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vfs_content_pack_member (
  content_hash TEXT NOT NULL PRIMARY KEY,
  pack_id INTEGER NOT NULL,
  offset INTEGER NOT NULL,
  length INTEGER NOT NULL,
  compressed_byte_len INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_vfs_content_pack_member_pack
  ON vfs_content_pack_member(pack_id);
```

- `member.length` = 明文切片字节数（解压流内 `slice(offset, offset+length)`）；`member.compressed_byte_len` = **从被替换的 blob 行原样复制的 `byte_len`**，使 `findContentSizeByPath` 的闸门口径与今天逐字节一致。
- 流内重复明文（同组内同一 hash 出现多次）只保留一份，多个成员指向同一 `(offset, length)`；`content_hash` 主键保证一 hash 一行。

**读路径**（`SqliteVfsContentStore`，唯一收口点）：

- `get(hash)`：先查 `vfs_content_blob`（命中即走原路径，热路径零改动）→ 未命中再查 `vfs_content_pack_member` → 命中则整组解压 + 切片；两者都无 → 维持原错误语义 `vfs_content_blob 缺失: {hash}`。
- `getMany(hashes)`：批量查 blob；缺失项按 `pack_id` 聚合，**每组只解压一次**再切片填表。
- `ensureBlob(hash, null)` 与 `findExistingBlobHashes()`：必须把 member 视为「已存在」，否则 tree-copy / seed / fork-copy 会对已打包的 hash 误报缺失。
- `put(plain)`：插入新 blob 行时，若同 hash 存在 member 行则删除该 member（保证「一 hash 只有一处权威副本」，避免双份存储）。
- `gc()`：在原 blob 清扫之后追加两步——(1) 删孤儿 member（`content_hash NOT IN (entry ∪ revision)`）；(2) 删**已无任何成员**的 pack（按 member 表实际 `COUNT(*)` 判定，**不依赖 `member_count` 列**——该列只作写入期校验与观测用，避免反规范化计数漂移）。单层 `NOT IN` 判定，**不需要不动点迭代**（pack 自包含，不存在链式引用）。

**打包任务**（core，新增 `runVfsContentPacking`）：

- 候选谓词：`vfs_revision.status='active' AND content_hash IS NOT NULL AND ref_count > 0`，且该 hash **仍是 blob 行**（`JOIN vfs_content_blob`）、**未被任何 entry 作为 live head**（`NOT EXISTS (SELECT 1 FROM vfs_entry e WHERE e.content_hash = r.content_hash)`）；按 `entry_id` 分组，`COUNT(DISTINCT content_hash) >= 2` 才处理。
- 每批一个 entry：取组内明文（走 content store，自动兼容混存形态）→ 按 ≤8 版本 / ≤1MB 明文切组 → **单事务**落 `vfs_content_pack` + members + 删除对应 blob 行（原子，中断不留半打包态）。
- 已打包 hash 的 blob 行已删，谓词天然排除 → 幂等；新版本继续以独立 blob 落库，攒够 2 个再打新包（**已生成的 pack 永不重写**，零写放大）。
- 无终态完成标记（版本会持续增长），状态查询 `getVfsContentPackStatus(conn)` 直接返回 `{ pendingGroups, memberCount, streamBytes, invalidCount }`；`invalidCount = 0` 即「无需处理」。
- 完整性校验 + 回滚：`verifyVfsContentPacks(conn)` 逐 member 校验「切片明文 hash == content_hash」，`unpackVfsContent(conn)` 把 pack 反向展开为独立 blob 行（先写后删、可重复执行）——这是 Part B 的回滚/应急手段。

**为什么是 pack 而不是另外两条路**（均有实测数据）：

- **字典链**（每版本用前一版本明文当 fflate preset dictionary，head 独立）：实测 depth≤8 时 2.945MB、depth→∞ 时 2.771MB——**比 pack 略好（约 75KB）**，但代价是「blob 行之间出现引用」，`gc()` 的 `NOT IN` 要加保活规则、深链读放大（最深 72）、`byte_len` 失真。为 75KB 引入跨行依赖不划算。
- **git 式 diff delta 编码器**：仓库无现成实现，Hermes 无 WebAssembly（RULE 已登记），需自研编码器 + 解码器 + 链深/重定基策略，且实测的 61.3% 本来就来自「拼接单流」这个机制，没有证据支持再上一套 diff。
- **字典窗口的物理上限**（实测 fflate 0.8.3）：preset dictionary 只对**末尾 32KB** 有效（40KB 字典里靠前的段完全用不上），这也是「大词典」方案被否决的原因。

## 最终项目结构

```
packages/core/src/
  domain/vfs/content-store/impl/sqlite-vfs-content-store.ts   # A：删 b64 分支；B：member 读路径 / gc / put / ensureBlob / findExistingBlobHashes
  domain/vfs/content-store/logic/blob-bytes-codec.ts          # A：删 bytesToBase64（base64ToBytes 保留）
  domain/session-kkv/logic/file-cache-blob-codec.ts           # A：删 forceZlibB64 分支
  domain/chat/logic/message-content-codec.ts                  # A：同上（合并后在主干改）
  domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts # B：findContentSizeByPath 回退 member.compressed_byte_len
  bootstrap/vfs/vfs-content-pack-schema.ts                    # B：新（两张表 DDL）
  bootstrap/novel-master-bootstrap.ts                         # B：SCHEMA_BOOT_VERSION +1（A 单独上线时不 bump）
  infra/db-maintenance/impl/blob-binary-normalization.ts      # A：新（三表归一任务 + 状态）
  infra/db-maintenance/impl/vfs-content-packing.ts            # B：新（打包任务 + 状态 + 校验 + 反向展开）
  infra/db-maintenance/impl/db-maintenance.service.ts         # A：维护链路会话级去重
  infra/db-maintenance/index.ts + src/index.ts                # A/B：导出（并入既有主入口导出区，不新增 exports 子路径）
apps/mobile/src/services/blob-binary-normalization.service.ts # A：新（守卫 + 循环调度）
apps/mobile/src/services/vfs-content-packing.service.ts       # B：新
apps/mobile/src/runtime/novel-master-context.tsx              # A/B：挂载
apps/desktop/src/main/services/{blob-binary-normalization,vfs-content-packing}.service.ts  # A/B：新
apps/desktop/src/main/main.ts                                 # A/B：挂载
apps/cli/src/runtime.ts                                       # A/B：内联预算制执行
apps/{mobile,desktop} 存储页                                        # A/B：状态行
```

## 变更点清单

| # | 文件 | 变更 | 线 |
|---|------|------|----|
| 1 | `sqlite-vfs-content-store.ts` | `put` 删 RN 分支恒二进制；删 `preferZlibB64` 选项；B 的 member 读路径/`gc`/`ensureBlob`/`findExistingBlobHashes`/`put` 删同 hash member | A+B |
| 2 | `blob-bytes-codec.ts` | 删 `bytesToBase64`；保留 `base64ToBytes` / `VFS_CONTENT_ENCODING_ZLIB_B64` / `isReactNativeRuntime`（后者若无调用方一并删） | A |
| 3 | `file-cache-blob-codec.ts` | 删 `forceZlibB64` 分支与参数；`byteLen` 改二进制长度 | A |
| 4 | `message-content-codec.ts` | 同 #3（合并后主干执行） | A |
| 5 | `infra/db-maintenance/impl/blob-binary-normalization.ts`（新） | 三表适配器 + 谓词 + 分批 + 每表 KKV 标记 + 状态查询 | A |
| 6 | `db-maintenance.service.ts` | **新增 `runStartupMaintenanceOnce`：会话级去重的收尾维护入口**；手动路径 `runDatabaseMaintenance` **刻意不受其约束**（用户手动点「数据清理」必须每次真跑，不被启动去重标记 gate 住） | A |
| 7 | `infra/db-maintenance/index.ts` + `src/index.ts` | 新任务与状态查询导出（同步 `test/package-exports/snapshots/main-entry-allowlist.json`） | A+B |
| 8 | 三端调度 + 存储页 | 新增服务文件、挂载点、IPC DTO 字段、状态行（mobile `StorageConfigScreen` / desktop `SettingsViews.tsx`） | A+B |
| 9 | `bootstrap/vfs/vfs-content-pack-schema.ts`（新）+ `novel-master-bootstrap.ts` | 两表 DDL + `SCHEMA_BOOT_VERSION` +1（含撞号顺延注释；**仅 Part B 需要**） | B |
| 10 | `sqlite-vfs-entry.repository.ts` | `findContentSizeByPath` 在 blob 行缺失时回退 `member.compressed_byte_len` | B |
| 11 | `infra/db-maintenance/impl/vfs-content-packing.ts`（新） | 候选谓词 / 分组打包 / 单事务落库 / 状态 / 校验 / 反向展开 | B |
| 12 | `packages/tdbc-driver-op-sqlite/src/bindings.ts` | 更新「blob 绑参尚未真机验证」注释（已真机实测通过） | A |
| 13 | 测试 | 见「测试策略」；`content-store.test.ts` / `file-cache-store.test.ts` / `message-content-codec-roundtrip.test.ts` 的 b64 写用例改写为存量读兼容用例 | A+B |
| 14 | 文档 | CHANGELOG Unreleased；RULE.md（形态归一与打包列约定、`byte_len` 语义） | A+B |
| 15 | KKV 新 key：`startupMaintenancePending` | 收尾维护失败时的兜底标记（module `nm-blob-binary`）：入口读到即无视 `processedAny` 强制补跑一次维护链路；**清标记以 `runStartupMaintenanceOnce` 返回非 `null` 为条件**（同进程重入时保留待下次冷启动） | A |
| 16 | KKV 写路径总表 | 本迭代全部 KKV 写路径清点：`nm-blob-binary` ×4（`vfsContentDone` / `fileCacheDone` / `messageContentDone` / `startupMaintenancePending`）＋ `nm-message-content` ×2（`compactionDone` / `startupMaintenancePending`，消息压缩任务各自的独立 pending key，不共享单 key） | A |

## 详细实现步骤

**Part A（建议立即执行）**

- Step 1 — phase-debase64-codec — blocking: yes — qa: auto：三处写侧收口恒二进制（含删除注入参数与死代码）；读路径三形态一行不动；更新驱动注释。
- Step 2 — phase-debase64-tests — blocking: yes — qa: auto：改写存量 b64 写用例为「存量行读兼容」用例；新增「新写入恒二进制（三表）」断言；T-BB1~T-BB3、T-BB8。
- Step 3 — phase-debase64-task — blocking: yes — qa: auto：`runBlobBinaryNormalization` + `getBlobBinaryStatus` + 维护链路会话级去重；T-BB4~T-BB7。
- Step 4 — phase-debase64-wire — blocking: yes — qa: auto：三端调度接线 + 存储页状态行 + IPC DTO + 导出快照。
- Step 5 — phase-debase64-regression — blocking: yes — qa: auto：core 全量（先重建 dist）＋ desktop ＋ mobile ＋ 全仓 typecheck。
- Step 6 — phase-debase64-verify — blocking: no — qa: manual_user：真机（荣耀 EBG-AN00）验收——库体积、三表形态直查（`SELECT encoding, TYPEOF(bytes), COUNT(*)`）、逐条解压校验、二次启动零重扫、读写/搜索/回滚正常。

**Part B（需用户拍板后执行）**

- Step 7 — phase-vfs-pack-schema — blocking: yes — qa: auto：两表 DDL + `SCHEMA_BOOT_VERSION` +1 + bootstrap 测试（新库建表 / 存量库慢路径建表 / 快路径不建）。
- Step 8 — phase-vfs-pack-store — blocking: yes — qa: auto：store 读路径（`get`/`getMany` 先 blob 后 member）、`ensureBlob` / `findExistingBlobHashes` 认 member、`put` 删同 hash member、`gc` 两步清扫；T-VP1~T-VP5。
- Step 9 — phase-vfs-pack-size — blocking: yes — qa: auto：`findContentSizeByPath` 回退 member；T-VP6。
- Step 10 — phase-vfs-pack-task — blocking: yes — qa: auto：`runVfsContentPacking` + 状态 + 校验 + 反向展开；T-VP3、T-VP8、T-VP10。
- Step 11 — phase-vfs-pack-wire — blocking: yes — qa: auto：三端调度 + 存储页状态行（「无需处理 / 剩余 N 项」两态）。
- Step 12 — phase-vfs-pack-regression — blocking: yes — qa: auto：core 全量（重点回滚/检查点链路）+ 三端 + typecheck；T-VP7。
- Step 13 — phase-vfs-pack-verify — blocking: no — qa: manual_user：真机验收——VFS 内容体积、文件树/预览/读写、历史版本回滚、checkpoint 恢复、二次启动收敛。

## 测试策略

新增/改写（core `node:test`；跑法与 flag 见 RULE「Windows 下跑本仓测试的两个假信号」）：

- T-BB1 — blocking: yes — 新写入恒二进制：三表各写一条后 SQL 直查 `encoding='zlib'` 且 `TYPEOF(bytes)='blob'`（映射 Step 1/2）
- T-BB2 — blocking: yes — 存量 `zlib-b64` 文本行读回等值（三表，直插 SQL 构造）（映射 Step 1/2）。**口径更正**：file_cache 侧的实际用例编号是 **T-R7**（`file-cache-store.test.ts`），与 core/vfs 侧 T-BB2 同名不同物
- T-BB3 — blocking: yes — `encoding='zlib'` + 文本字节的历史脏形态读回等值（映射 Step 1/2）
- T-BB4 — blocking: yes — 归一任务幂等：连跑两遍，第二遍 `compactedCount=0` 且不产生 UPDATE（映射 Step 3）。**拆两条**：一条钉「标记短路」（连跑第二遍零改写零 SQL），一条钉「清标记后谓词幂等」（删两表完成标记后第二遍仍零改写——幂等由谓词保证、不被标记遮蔽）
- T-BB5 — blocking: yes — 可重入：批间中断后重启续跑收敛（映射 Step 3）。**口径更正**：「模拟杀进程」的实际实现是**预算耗尽**（收紧单轮同步预算让任务在批间收手），不是真杀进程
- T-BB6 — blocking: yes — 归一后表单一致：`encoding='zlib'`、`TYPEOF(bytes)='blob'`、`byte_len = 物理字节长度`（映射 Step 3）。**口径更正**：断言的形态组合数为 **5**（不是 6）
- T-BB7 — blocking: yes — 零丢失：混合语料归一前后逐条解压比对全等（映射 Step 3）。**口径更正**：语料是**构造语料**（伪随机长文 / 中文文本 / 工具块模拟，并非真实附件形态）
- T-BB8 — blocking: no — perf 阈值：单批 100 行耗时 ≤30s（含维护链路）、写入路径压缩耗时与改动前同级（映射 Step 2/5）
- T-VP1 — blocking: yes — 打包后逐版本读回等值（含同组重复 hash 共享成员）（映射 Step 8）
- T-VP2 — blocking: yes — live head 永不被打包：打包任务跑完后，所有 `vfs_entry.content_hash` 仍是 `vfs_content_blob` 行（映射 Step 8/10）
- T-VP3 — blocking: yes — pack 自包含校验：逐 member `hash(切片明文) == content_hash`（映射 Step 10）
- T-VP4 — blocking: yes — GC 语义：无引用 pack 被回收；任一成员被引用则整包保留；孤儿 member 回收；`ref_count` 触发器与 pack 删除互不干扰（映射 Step 8）
- T-VP5 — blocking: yes — `ensureBlob(hash, null)` 与 `findExistingBlobHashes` 对已打包 hash 判定为「已存在」，tree-copy / seed / fork-copy 不误报（映射 Step 8）
- T-VP6 — blocking: yes — `findContentSizeByPath` 对已打包 hash 返回原 `byte_len`（闸门口径不变，超限文件仍走占位）（映射 Step 9）
- T-VP7 — blocking: yes — 回滚链路在 pack 形态下全绿：`resetHeadToVersion` / `restore-path` / `revive-deleted-entry` / checkpoint capture-restore / `sweepSessionRevisions`（映射 Step 12）
- T-VP8 — blocking: yes — 打包幂等/可重入：中断不留半打包态；重跑不重复打包已打包版本（映射 Step 10）
- T-VP10 — blocking: yes — 反向展开：`unpackVfsContent` 后 pack/member 清空、独立 blob 行齐备且读回等值，可重复执行（映射 Step 10）

### T 编号 → 实际用例文件 → 断言要点映射（文档同步，2026-09-28）

T 编号与实际落地用例的可追溯映射（行号为集成分支 `integration/binary-storage` 当前实测；fix-spec 修复轮新增用例落地后以实际用例名为准回填）：

| T 编号 | 实际用例文件 | 断言要点 |
|---|---|---|
| T-BB1 | `packages/core/test/vfs/content-store.test.ts`（「T-BB1: 新写入恒为二进制 BLOB」）；fc 侧 `packages/core/test/session-kkv/file-cache-store.test.ts`（「T-BB1 encodeFileCacheValue 恒落二进制」+「T-BB1b set 落库」） | SQL 直查 `encoding='zlib'`、`TYPEOF(bytes)='blob'`、`byte_len` 为二进制物理长度 |
| T-BB2（core/vfs 侧） | `packages/core/test/vfs/content-store.test.ts`（「T-BB2: 存量 zlib-b64 文本行仍可读」） | get / getMany / ensureBlob 对直插的存量 b64 文本行均认、读回等值 |
| T-R7（fc 侧，即原记「T-BB2」） | `packages/core/test/session-kkv/file-cache-store.test.ts`（「T-R7 存量 zlib-b64 文本行」） | get 还原原文；bad-bytes 坏行对应 T-R8（get 返 null 不抛，自愈） |
| T-BB3 | vfs 侧 `content-store.test.ts`（「encoding=zlib 且 bytes 为 base64 string 时兜底解码」）；fc 侧 `file-cache-store.test.ts`（「T-BB3 历史脏形态」） | 历史脏形态（`zlib` + base64 文本）读回等值 |
| T-BB4（标记短路） | `packages/core/test/infra/blob-binary-normalization.test.ts`（「T-BB4：幂等——连跑两遍」+「标记短路面：已置完成标记的表不跑 COUNT」） | 第二遍 `normalizedCount=0`、零 UPDATE、数据快照不变；已置标记的表不跑谓词 COUNT |
| T-BB4（清标记后谓词幂等，fix-spec cr-07 拆出） | 同上文件（以实际用例名为准） | 删两表完成标记后第二遍仍零改写——幂等由谓词保证，不被标记遮蔽 |
| T-BB5 | `blob-binary-normalization.test.ts`（「T-BB5：可重入——批间中断（模拟杀进程）」） | 预算耗尽模拟中断，重启续跑收敛；中断轮内已完成的表标记已置 |
| T-BB6 | `blob-binary-normalization.test.ts`（「T-BB6：形态一致」） | 三字段组合数 5；`byte_len = LENGTH(bytes)` |
| T-BB7 | `blob-binary-normalization.test.ts`（「T-BB7：零丢失——混合语料」） | 构造语料归一前后逐条解压比对全等；fc 侧含真实读链路断言（fix-spec cr-11） |
| T-BB8 | perf 阈值用例（以实际用例名为准） | 单批 100 行 ≤30s、写入路径压缩耗时与改动前同级 |
| chat_message 适配器（A2 新增） | `blob-binary-normalization.test.ts`（「chat_message 适配器：zlib-b64 行转二进制、坏行跳过计数、legacy 明文行不动、独立完成标记」） | 列名映射（content_encoding/content_blob）、按 id 游标、`messageContentDone` 标记 |
| cr-06 配套 | `blob-binary-normalization.test.ts`（「cr-06：旧版 ISO 字符串标记向后兼容 + 状态查询纯读无副作用」；坏行用例「解码失败的坏行不阻断收敛」） | 标记 JSON 可解析出 `failedCount`、旧 ISO 值兼容归零、状态查询前后 `kkv_entry` 不变 |
| T-DM3 / T-DM4 | `packages/core/test/infra/db-maintenance.test.ts` | 启动维护链路去重（同进程第二次返 null）；手动「数据清理」不受启动去重标记影响 |

**新增用例登记（fix-spec 修复轮配套，cr-07 ~ cr-21 / cr-24 ~ cr-35 及集成分支 ic 系列；统一以实际落地用例名为准）**：

- **收尾维护观测（cr-01 / cr-25 / cr-31）**：`maintCalls` = 进入收尾维护段的次数（含被进程级去重短路的调用，不代表 VACUUM 真跑），判据一律走 `afterMaintenance` 回调计数——稳态 `maintCalls===0`、缺失标记但谓词空、首轮确有归一 `maintCalls===1`。
- **NF-2 拆分两条互不重叠**：(a)「纯坏行表（0 正常行）」→ `normalizedCount===0`、`failedCount===100`、`done===true`、`maintCalls===0`；(b)「坏行满批 + 尾部正常行（100 坏 + 20 好）」→ 20 行全归一、`failedCount===100`、`maintCalls===1`。四处（cr-01/cr-02/cr-24/本清单）统一引用同一对名称与同一套期望。
- **新测试文件** `packages/core/test/infra/blob-binary-normalization-maintenance.test.ts`（独立进程承载 pending 标记正向路径，已随集成分支落地）：:99「第一条：预置 startupMaintenancePending + 无待归一行 → maintCalls===1 且 pending 被清」；:133「稳态：三表标记已置、无 pending → maintCalls===0」。
- **同进程二次调用**（cr-32）：预置 pending → 先跑一次 `runStartupMaintenanceOnce` 落位进程级标记 → 再调归一 → `maintCalls===1` 且 `startupMaintenancePending` **未被误清**。
- **收尾谓词校验族**（cr-02 / cr-24 / cr-35）：既有「零进展护栏」用例改题「收尾谓词校验判定残留非坏行 → `stalled:true`、标记未置」（`updateCount===2`）；新增「1 正常行 + 1 打转行」反例；三表口径含「`chat_message` 前 100 条 id 全坏」专门用例（A2 三表化，ic-36a）。
- **既有整对象断言补字段**（cr-27 / ic-36e）：core `blob-binary-normalization.test.ts` 与 mobile `db-maintenance.service.test.ts` 的 `deepEqual`/`toEqual` 断言以 `grep -n` 实测清单为准（core 至少 :372/:415/:736/:848/:871/:878 六处，另 :401/:406/:407/:612/:636/:890 同口径复核；mobile :138 全对象、:166 数组两处），只补 `failedCount` 字段、不得改成部分比对。
- **空库首启三表化**（cr-09 / ic-36b）：空库状态查询断言含 `messageContent` 行；执行侧互不牵连（cr-10 / ic-36b）覆盖第三表。
- **desktop busy 契约**（cr-03 / cr-26）：VACUUM 执行瞬间 `isDesktopDbMaintenanceBusy()===true`、VACUUM 抛错后仍复位、归一循环进行中不置 busy；**rebootstrap 重挂**（cr-05）：换连接后允许重挂。
- **mobile 采样降级**（cr-04）：`getBlobBinaryStatus` 抛错时 `getDatabaseMaintenanceStats` 不整体 reject，`blobBinary` 返回空数组。
- **三端源码 / handler 契约**（cr-21）：mobile 三行状态行顺序与取值；desktop 类名与「ORDER 从 LABELS 派生」；desktop handler 兜底（采样抛错时 `tables: []` 且 `fileBytes` 仍在）。
- **OQ-C UI 第三态源码契约**（cr-06）：两端状态行渲染分支含 `failedCount > 0` 第三态与「需人工处理」字样。
- 纯措辞/注释同步项（cr-33 的 `stalled` 三处文档、cr-34 / cr-36 的 spec 文本项）不产生用例，属文档 diff 复检。

## 风险与回滚方案

**Part A**

- 风险：写入路径从 TEXT 挪到 BLOB 通道（真机已 6 项探针验证，剩余风险为并发/大值场景）；存量行形态长期混存（读路径天然兼容，不影响正确性）。
- 风险：**状态查询的归一谓词 COUNT 不可索引**——`getBlobBinaryStatus` 每表一次 `COUNT(*) ... WHERE <归一谓词>`，谓词作用在 `bytes` 的 `TYPEOF`/长度上无法走索引；未完成态下 desktop 存储页的 2s 轮询会触发全表扫，接入大表（`chat_message` 约 43MB）后从「慢」升级为「持续吃 IO」。**已由本轮 ic-06 落地缓解：core 采样侧对触 COUNT 的未完成态采样加 3s 节流**（窗口内重复调用回放上次采样值，desktop 2s 轮询合并为约一次/3s 真采样；谓词本身仍不可索引，可选索引随下一轮 `SCHEMA_BOOT_VERSION` bump）；后续若再接入更大的表，须先复核采样口径（标记已置则直接读标记快照、不再 COUNT）。
- 风险：**`startupMaintenancePending` 在用户手动「数据清理」成功后会变陈旧**——手动清理把 freelist 收干净后该标记仍留在 `kkv_entry`，下次冷启动会多跑一次全库 VACUUM（一次性浪费、非正确性问题）；默认在手动路径成功后顺带清该标记。
- 风险：**备份导入未完成库时，完成标记随库文件旅行**——导入「迁移进行到一半」的库文件后，标记与数据一起被覆盖，新库会重新压缩/归一（谓词重扫）。这是幂等设计的一部分（重扫幂等、无正确性损失），不修行为。
- 风险：**压缩与归一双任务并发的理论态缝隙（ic-32）**——压缩任务恒写 `content_encoding='zlib'` + 二进制 BLOB；若某端驱动有缺陷把二进制绑成 TEXT 存回（归一谓词第二 disjunct 针对的历史脏形态），而归一的 `messageContentDone` 标记已置（该表已完成短路），这批新脏行不会被归一任务自动重扫。兜底手段：手动清 `messageContentDone`（KKV module `nm-blob-binary`）触发重扫（代码侧半边见 message-content-compaction.ts 文件头的风险登记）。
- 回滚：停用归一任务即可（读路径两形态都认）；如需彻底回退形态，写一个谓词 `encoding='zlib' AND TYPEOF(bytes)='blob'` 的反向任务（注意这会把所有三端写入的二进制行一起转回，仅应急用）。

**Part B**

- 风险（按严重度）：① 跨「`hash` ⇒ blob 行」的 8 处隐含契约（`get`/`getMany`/`ensureBlob`/`findExistingBlobHashes`/`put`/`gc`/`findContentSizeByPath`/触发器注释），漏一处即读失败或双份存储；② GC 误删导致明文丢失——由「pack 自包含 + 单层引用判定 + T-VP3 校验」三重兜底，且回滚前可先 `verifyVfsContentPacks`；③ 读放大：读一个已打包版本需整组解压（单组上限 1MB 明文 / 215KB 流），`getMany` 按组去重；④ 回滚卡顿敏感路径（`rollback-large-jank` 刚修）新增解压成本，需在 Step 12 用既有回滚用例回归。
- 回滚：`unpackVfsContent` 反向展开（可重复执行）→ 删两张表 → `SCHEMA_BOOT_VERSION` 不回退（只升不降，对齐既有纪律）。
- 决策建议：Part B 收益 3.06MB，改动面覆盖 VFS 读写的所有主力路径，**建议作为 Part A 合并后的独立迭代单独评审**；若用户认为 3MB 不值得该风险，可只做 Part A（本 SPEC 的 Part B 即为该决策的完备案卷）。

## 实现期补充（A1 落地记录，2026-09-28）

A1（VFS + file_cache 去 base64 + 归一任务 + 三端接线）已按本 spec 落地（分支 `feat/blob-binary-normalization`），以下是实现期相对 spec 原文的新增与分叉，均有测试或实测证据，供 A2 与 Part B 对齐：

| 项 | 说明 |
|---|---|
| `BlobBinaryRunResult` 实际字段 | `{ done, normalizedCount, failedCount, stalled }`（spec 原文只写 `{ done, normalizedCount }`） |
| `failedCount`（单行容错） | 单行 base64 解码失败不再抛穿整轮：坏行原样保留、跳过归一、计入 `failedCount` 并 warn；该表照常置完成标记——否则每次启动重扫同一批坏行、任务永不收敛。读路径对同类坏行本就是自愈的，两侧口径一致 |
| `stalled` + 零进展护栏 | 连续 3 批「谓词非空但 UPDATE 恒 `changes = 0`」即 warn 并 `stalled = true` 收手本轮；两端调度服务见 `stalled === true` 立即停止本进程重试（否则 app 层的「立即续跑」会把它放大成热循环）。护栏**不**要求满批——谓词是实时重扫的，任何批大小的零进展都是异常信号 |
| 收尾维护容错 | 归一完成后挂的 `runStartupMaintenanceOnce` 包 try/catch：VACUUM 失败（磁盘满 / 库被锁）只 warn 不穿透——CLI 启动链路没有 try/catch，裸奔会让每条命令失败，且进程级去重在每个新进程复位、会反复重试注定失败的 VACUUM |
| 预算常量分叉 | 新建 `DEFAULT_BLOB_BINARY_SYNC_BUDGET_MS = 60_000`（与消息侧 `DEFAULT_COMPACTION_SYNC_BUDGET_MS` 同值不同名）：后者所在文件在未合并的 `message-content-compression` 分支上，本分支无法引用 |
| `messageContent` 类型预置 | `BlobBinaryTableId` 联合已含 `"messageContent"`，A2 只加适配器数据、不改类型定义。两端 UI **有意不设 `messageContent` 状态行**（发版形态下压缩搬运直接写二进制，不存在用户可见的中间态，见「实现期补充二」的范围拍板）；未注册进适配器注册表的表才由 UI 以 `—` 占位（与存储页既有占位风格一致、布局不随注册表增减跳动） |
| 三端守卫组合 | mobile 当前仅 `isMobileAgentActive`（main 上 mobile 无维护/备份 busy 标志，注释已留扩展点）；desktop 为 agent + 云同步 + 维护 busy 三条；cli 无守卫（进程内单轮） |
| app 层失败策略 | mobile：归一任务 error → warn 并本进程收手；desktop：error → warn 并本进程收手；cli：error → 上抛（CLI 启动链路无 try/catch 兜底，裸抛让命令显式失败） |
| CLI 内联预算制口径 | 稳态零成本短路；仅在本轮确有推进（成功改写 ≥1 行）且全部表完成时跑一次收尾维护链路；上一轮维护失败由持久化标记补跑。已知代价：CLI **首轮**（库中确有待搬运/待归一行时）仍同步阻塞——压缩与归一两任务各 60s 预算、最坏合计约 120s，超预算残余由下次命令或双端启动续跑 |
| desktop 备份导入去重契约 | 「备份导入不重入」的契约是**去重键 = 连接身份**：`rebootstrapDesktopRuntime`（备份导入 / 云同步 pull）换连接后本任务视为可重入、允许重挂，远端库回灌后会重新归一；仅「连接仍在却失败」的真失败才 warn 并本进程收手 |
| A1 / A2 拆分 | 本轮只做 VFS + file_cache 两表；`chat_message` 的写侧 codec 切换与归一适配器属 A2，待 `feat/message-content-compression` 合并（须用户指令）后执行 |

验证证据（A1 终态，实测）：core 全量 2788/2786 pass（2 条既有 usage-stats 时区红灯）；core 定向 34/34；mobile `tsc -p tsconfig.build.json` 绿 + jest 定向 15/15（全量 1534/1535，唯一红为既有 `mermaid-fullscreen.test.ts`）；desktop main `tsc` 绿 + 相关测试 8/8（renderer `tsc` 为既有 349 条债，与本次改动行区间交集为 0）；cli `tsc` 绿 + 启动链路冒烟通过；实库副本端到端 `{done:true, normalizedCount:1136, failedCount:0, stalled:false}`、二次运行 `normalizedCount:0` 且不下发 UPDATE、1149 个 hash 逐条 sha256 比对零丢失、两表全 `blob`+`zlib` 且 `byte_len = LENGTH(bytes)`、副本 111,120,384 → 107,528,192 字节。

## 实现期补充二（集成分支 + A2 + 存储页指标卡 + 真机验收，2026-09-28 下午）

**范围拍板（用户）**：压缩与去 base64 一起发布 → 开集成分支 `integration/binary-storage` 一起开发测试；存储页第三条进度是「content json 压缩」（真实用户升级要经历的长耗时搬运）而非「消息正文去 base64」（发版形态下压缩搬运直接写二进制，不存在用户可见中间态）；三条进度是指标不是菜单项，改指标卡只读展示。**消息正文『去 base64』不设状态行——发版形态下压缩搬运直接写二进制，不存在用户可见的中间态（`messageContent` 的 `failedCount` 属 engine 内部观测，不入 UI）**；core 状态查询照常回报该表，仅两端迁移卡不渲染它。

| 项 | 说明 |
|---|---|
| 集成 merge `15721863` | `feat/message-content-compression` 并入：15 处文本冲突全按并集解；**BOOT_VERSION 撞号实锤**——两边都是 16 但含义不同（main v16 = stream-metrics 两列，mcdev v16 = chat_message 压缩两列；其真机构建用的 17 一直没提交回分支、设备库已是 17），按撞号纪律顺延为 **17**（v16 保留主干含义，压缩两列重编号 v17；若用 16，真实 1.5.24 存量库走快路径、压缩列永远补不上） |
| 语义冲突（合并工具不可见） | mcdev 的 `message-content-codec` 引用 A1 已删除的 `bytesToBase64`/`isReactNativeRuntime`——merge 提交内联为私有（保持 mcdev zlib-b64 写侧行为），随后 A2 翻转时整体删除 |
| A2 `27273a2f` | `encodeMessageContent` 删平台分支与 `forceZlibB64`：三端恒 `zlib`+二进制；归一任务注册 `chat_message` 适配器（谓词 per-adapter 列名映射、无 `byte_len` 列双参 UPDATE、SELECT 列别名统一行形状）；legacy 明文行（`content_encoding IS NULL`）不命中谓词，与 compaction 任务互不越界 |
| 存储页指标卡 `05ffcb53` + cr-06 | mobile `FormSectionCard`「存量数据迁移」三行静态状态行（消息正文压缩 / 版本内容去 base64 / 文件缓存去 base64），desktop 同语义 `SettingsActionSection`；cr-06 一并落地：完成标记值升 JSON（含 `failedCount` 快照、旧 ISO 值兼容归零）、`getBlobBinaryStatus` 纯读回报 `failedCount`、UI 第三态「已完成（N 条需人工处理）」 |
| 测试账目 | core 归一套件 12/12（含 chat_message 适配器用例、cr-06 A/C + 纯读断言）+ 压缩/维护/file_cache/VFS 27/27 + codec 回环 7/7；mobile jest 19/19；desktop 8/8；三端 typecheck 绿 |

真机验收（荣耀 EBG-AN00，Metro 构建跑集成分支 JS）：

- **A1 单独链**（pre-debase64 快照起步）：两表 1112+40 行全 `zlib`+`blob`、`byte_len` 零违例、1112 个 hash 逐条零丢失、VFS 9,931,792 → 7,449,238（−2.37MB 与副本预测吻合）、`chat_message` 5350 行未波及、双标记 11:42:27 落位。
- **cr-01 P0 真机实证**：稳态（标记已置、谓词空）下两次无操作冷启动，76MB 主库两次全文件重写（mtime 11:53/11:55），12 张表跨启动**逐字节内容零变化**（含 5350 行 chat_message、100,276 行 message_checkpoint_file）——零数据变更的全文件重写即维护链路白跑的现场证据。rootpage 对比在「刚 VACUUM 过的干净库」上不可判别（VACUUM 确定性复制出相同布局），逻辑层 diff 才是可靠判据。
- **集成完整升级链**（恢复 pre-mc 备份 111.1MB、user_version 16 起步）：BOOT 17 慢路径补列 → 压缩搬运 5350 条（**直接写二进制，`b64_rows=0`**）→ 三表归一 → 收尾维护，约 2 分钟收敛到 **64,757,760 字节（−46.4MB / −41.8%）**；消息 5350/5350 逐条解压与迁移前明文比对零差异；vfs 1112 hash 零丢失；三个完成标记均为新 JSON 格式；存储页指标卡三行「已完成」实测渲染正确。

**遗留开放问题（发版前置）**：内嵌生产 bundle（`--dev false` + `useDevSupport=false`）启动即崩——第一崩『SettingsManager not found』是 dev bundle 配 devSupport=false（内嵌包必须 `--dev false`，已定位并修正出包脚本）；换生产 bundle 后另崩『Error: Got unexpected undefined』（minified 栈指向 `get UIManager`，未定位）。发版走的正是生产 bundle，需用 `--dev false --minify false` 出可读栈的包复现查清。

## 已否决方案与依据（避免重复调研）

| 方案 | 实测/结论 |
|---|---|
| 换压缩算法（brotli / zstd） | 逐条口径最多 +12%（brotli q9/zstd19 = 2.51:1 vs deflate 2.24:1）；Hermes 无 WebAssembly，wasm 套件不可用；纯 TS `zstdify` 实测会崩且更差 |
| 内容级去重（CAS / CDC 分块） | 消息精确去重仅 0.03%；CDC 去重 + 逐块压缩反而更差（2.01:1 vs 2.24:1） |
| 按会话/时序打包（消息侧） | 移动端只值 +12%（deflate），读放大涨到 1MB |
| git 式 diff delta 编码器 | 无现成实现，需自研编解码；实测收益已由「拼接单流」取得，无增量证据 |
| 字典链（前一版本作字典） | 与 pack 相当（depth≤8 时 2.945MB vs 3.020MB），但引入跨行引用/GC 保活/链深读放大，为 75KB 不值得 |
| preset dictionary 大词典 | fflate 实测只对**末尾 32KB** 生效；deflate 窗口物理上限 |
| 收窄 `encoding` CHECK 值域为只 `'zlib'` | SQLite 不支持 ALTER CHECK，需整表 rebuild，收益为 0（读路径本就兼容多形态） |

## Context Bundle

```yaml
iteration_name: binary-blob-and-vfs-pack
requirement_path: 用户口述（2026-09-28）＋ docs/apm/memory/20260927-worktree-123-verify-guide.md
spec_path: docs/Iterations/binary-blob-and-vfs-pack/spec.md
explore_summary: >
  写侧形态分叉共 3 处（vfs content store put / file cache codec / message codec），全部靠
  isReactNativeRuntime 运行时探测，注入参数只有单测在用；读路径 decodeCompressedBytes 三形态
  兼容已是既有契约（存量 zlib-b64 行不转换也能读）；直接 SQL 读 blob 表只有 2 个真实落点
  （content store 全方法、entry repo 的 findContentSizeByPath）；三表 encoding CHECK 均已含
  'zlib'，去 base64 不需要任何 schema 变更。VFS 侧 hash→明文的所有读取都收敛在 content store，
  但 ensureBlob / findExistingBlobHashes / gcd 与 ref_count 触发器都隐含「hash ⇒ blob 行」假设。
  搬运基建可复用 message-content-compaction（谓词 + 分批 + 单行短事务 + KKV 标记 + 挂 VACUUM），
  schema migration 框架无进度语义、不可用于数据搬运。
impact_files:
  - packages/core/src/domain/vfs/content-store/impl/sqlite-vfs-content-store.ts
  - packages/core/src/domain/vfs/content-store/logic/blob-bytes-codec.ts
  - packages/core/src/domain/session-kkv/logic/file-cache-blob-codec.ts
  - packages/core/src/domain/chat/logic/message-content-codec.ts
  - packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts
  - packages/core/src/infra/db-maintenance/impl/
  - packages/core/src/bootstrap/vfs/vfs-content-pack-schema.ts (新)
  - apps/{mobile,desktop,cli} 调度与存储页
constraints:
  - Part A 不 bump SCHEMA_BOOT_VERSION（无 DDL/align 变更）；Part B 必须 bump（新表）
  - 大库数据搬运禁走 migration 框架（无进度语义 + 空占位登记禁令），一律谓词驱动后台任务
  - VACUUM 必须事务外直调；事务回调内不得使用外层 conn（AsyncMutex 不可重入，死锁无异常）
  - 读路径多形态兼容是契约，不得写死单一 encoding
  - mobile jest 消费 core dist，回归前必须重建；新增 core 导出须同步 main-entry-allowlist 快照
  - 真机验收一律从 UI 操作，库只读（拉取查完即弃）
blocking_steps: [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]
```
