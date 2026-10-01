---
date: 2026-09-28
---

# 落库形态去 base64 + VFS 版本链打包（vfs content pack）技术规格（SPEC）

需求来源：用户口述（2026-09-28：「方案还是收敛到那两件：先去 base64（消息 +33%、VFS 2.37MB、file_cache 0.07MB，零风险），然后 VFS 做 delta」）
＋ 上游实测结论（`docs/apm/memory/20260927-worktree-123-verify-guide.md`）
＋ **本轮复测修正**（见「实测基线与口径修正」——「VFS delta 82.6% / 10.7MB」为重复计数口径错误，真实值 61.3% / 3.06MB）
＋ **Part B 重写（2026-09-28 晚，用户拍板）**：原纯 pack 方案经真库 PoC（五路线对比）与归因分析（差距由成员明文 vs deflate 32KB 窗口驱动）重写为**混合方案**（小组 pack + 大文件组 fossil-delta 链，两张表 format 分派）；MCP 调研推翻「纯 JS 无 delta 编码器」旧结论（`fossil-delta`）；混合 dry-run 在真库副本全绿（`tmp/poc-hybrid.mjs`）。方案讨论全程见同主题记忆文件。

前置依赖：~~`docs/Iterations/message-content-compression/`（尚未合并）~~ **已满足**——Part A 已随 v1.5.25 发布（2026-09-28），本 SPEC Part B 基于发布后 main（`feat/vfs-content-pack` 分支基 `71527442`）。

---

## 设计目标

两条线，按收益/风险排序执行：

| 线 | 内容 | 预期收益（真库副本实测） | 风险 | 是否本期必做 |
|---|---|---|---|---|
| **Part A** | 落库压缩形态去 base64（RN 端由 `zlib-b64` 文本改二进制 BLOB），三张 blob 表统一 | **省 13.30MB**（message 10.864 + VFS 2.366 + file_cache 0.07） | 低（读路径三形态已兼容、无 schema 变更、降级安全） | ✅ 已随 v1.5.25 发布 |
| **Part B（混合方案）** | VFS 同一 entry 的非 head 历史版本打包：**小文件组 pack（拼接单流 zlib）+ 大文件组 fossil-delta 链式差量**，两张旁路表，`format` 列分派 | 新库 dry-run：VFS 内容存储 **-51.9%**（8.81→4.23MB 表占用）、全库 **-7.4%**（61.78→57.22MB，含 VACUUM） | 中（收口 content store 六方法 + 两张新表；fossil 住 pack 容器规避行间引用） | 本轮执行（2026-09-28 重写定稿） |

Part A 已随 v1.5.25 发布（真机升级链全绿，64.76MB 收敛态）。Part B 在该形态上再降到 **约 57.2MB**（新库 `tmp/nm-real-v2.db` dry-run 实测口径：候选 740 hash、155 组、流 1.62MB，`tmp/poc-hybrid.mjs` 可复跑）。

非目标（本期不做，均已实测否决，见「已否决方案与依据」）：换压缩算法、内容级去重（CAS/CDC）、按会话打包、delta 住 blob 原表（行间引用形态）、字典链压缩、CHECK 值域收窄。

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

### Part B（2026-09-28 重写）：VFS 非 head 历史版本混合打包（pack + fossil-delta）

**方案演进**：原方案为纯 pack（拼接单流）。2026-09-28 重写为**混合方案**——归因实测发现 pack 的收益损失集中在「成员明文 > 32KB 的组」（deflate 滑动窗口只看得到前版本末 32KB，该类组 pack 只省 32.3%）；引入 `fossil-delta`（纯 JS 双向 delta 编解码器，fossil SCM 算法，跨窗口显式 copy/insert 匹配）处理大文件组后，该类组省幅升到 79.5%。**fossil 住进 pack 容器（组内链式、base 为同组前驱成员），规避了 delta 住 blob 原表的全部结构性代价（行间引用 / GC 保活 / 回滚物化 / byte_len 失真）**。全部数字来自真库 dry-run（`tmp/nm-real-v2.db`，v1.5.25 归一后形态；脚本 `tmp/poc-hybrid.mjs`、`tmp/poc-breakdown.mjs` 可复跑）。

**核心思路**：一个 entry 的非 head 历史版本按版本序分组（≤8 成员/组、≤1MB 明文/组），**小组用 pack**（明文拼接、单流 zlib）**、大组用 fossil 链**（首成员全量 zlib + 后续成员相对前驱的 `createDelta` 差量再 zlib），配一张 member 偏移索引；读取时按 `content_hash` 先查 blob 表、未命中查 member 按 `format` 分派解码。**对外语义完全不变**——所有调用方仍只看到「`content_hash` → 明文」。

**分组与编码选型**（全部有实测依据）：

- 候选谓词：`vfs_revision.status='active' AND content_hash IS NOT NULL`，且该 hash **仍是 blob 行**（`JOIN vfs_content_blob`）、**未被任何 entry 作为 live head**（`NOT EXISTS (SELECT 1 FROM vfs_entry e WHERE e.content_hash = r.content_hash)`）；按 `entry_id` 分组，`COUNT(DISTINCT content_hash) >= 2` 才处理；跨 entry 共享 hash 归首遇 entry（member 主键一 hash 一行）。
- 编码选型阈值：**组内成员平均明文 ≥ `FOSSIL_GROUP_PLAIN_THRESHOLD_BYTES = 24KB` → fossil 链，否则 zlib-concat**。阈值扫描（16/24/32/48/64KB）实测 24KB 最优（流 1.608MB）、16~32KB 区间平缓（总差 26KB）——阈值不脆，微调无风险。归因数据：平均 <32KB 的组（150 个）fossil 反输 pack 5.2%，平均 ≥32KB 的组（5 个）fossil 赢 79.5%——**差距由「单版本明文 vs deflate 32KB 窗口」驱动**。
- 已生成的 pack 永不重写（零写放大）；新版本照常独立 blob 行落库，攒够下一组再打下一包。

**存储模型**（两张新表，canonical DDL + `SCHEMA_BOOT_VERSION` 17→18）：

```sql
CREATE TABLE IF NOT EXISTS vfs_content_pack (
  pack_id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('zlib-concat-v1','fossil-chain-v1')),
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

**`member.offset/length` 的语义按 `format` 解释**（dry-run 已验证的布局）：

- `zlib-concat-v1`：offset/length = **组流解压后明文**的切片区间（`unzlibSync(bytes).subarray(offset, offset+length)`）。
- `fossil-chain-v1`：offset/length = **`bytes` 内的段区间**（length = 段压缩字节长）。段表布局：`4B 段数（LE）+ N×4B 各段压缩长（LE）+ 段数据连排`；段 0 = `zlib(首成员明文全量)`，段 i = `zlib(createDelta(明文[i-1], 明文[i]))`。读成员 k = 解段表 → 解段 0 得 v0 → 沿链 `applyDelta` 到段 k（组内 ≤8 段，链式读放大有界）。
- `member.compressed_byte_len` 恒为**从被替换 blob 行原样复制的 `byte_len`**（两格式同口径）——fossil 组严禁记 delta 长度，否则 `findContentSizeByPath` 的大文件闸门（`CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES`，按压缩侧 4× 折算）会完全失真、超大文件被放行。
- 流内重复明文（同组同 hash 多次出现）只保留一份，多成员共享 `(offset, length)`；`content_hash` 主键保证一 hash 一行。

**读路径**（`SqliteVfsContentStore` 唯一收口点，六方法 + 一处回退；现状行号见探索报告：put:43 / get:75 / getMany:99 / findExistingBlobHashes:136 / ensureBlob:158 / gc:178）：

- `get(hash)`：先查 `vfs_content_blob`（命中走原路径，**热路径零改动**）→ 未命中查 member（JOIN pack 取 format+bytes）→ 按 format 分派（pack 切片 / fossil 沿链 apply）→ 两者都无维持原错误文案 `vfs_content_blob 缺失: {hash}`（文案被测试与调用方依赖，不改）。
- `getMany(hashes)`：维持 500 分块（`CONTENT_GETMANY_CHUNK_SIZE`）；blob 命中走原路；member 命中按 `pack_id` 聚合——pack 组整组只解压一次、fossil 组沿链 apply 时复用中间结果（同组连续成员共享前驱明文）；`resolveScanRows` 的缺失升级语义不变。
- `ensureBlob(hash, null)` 与 `findExistingBlobHashes()`：**UNION member 表判定「已存在」**——`seed-live-head-revisions`（L70，fallback null 必抛）、`seed-fork-copy-parity`（L77）、`backfill-missing-revision`（L58）、`vfs-tree-copy`（L220 快路径判定）对已打包 hash 均不得误报缺失。
- `put(plain)`：插入 blob 行时若同 hash 存在 member 行则删除该 member（**回滚抽回语义**：`resetHeadToVersion`/`revive-deleted-entry` 的 put 幂等保活把历史版本抽回独立 blob 行当 head；pack 流内该段成死区，等整组无成员随空 pack GC——dry-run 已验证此语义，含最难的 fossil 首成员抽回：同组剩余 7 成员仍从段链读回全等）。**纪律：这条路径绕过 `vfs_revision` 的 ref_count 三触发器新建 blob 行，`ref_count` 必须现场重算**（`COUNT(vfs_revision WHERE content_hash = ?)`，与 unpack 重建 blob 行同款口径）——该 hash 早已被若干 revision 行引用，当初 INSERT 时触发器 UPDATE 静默命中 0 行，DEFAULT 0 会让后续删任一引用 revision 撞 `CHECK (ref_count >= 0)` 事务回滚，无 CHECK 时更会误删仍被引用的 blob 行致正文不可读；同款修复也须覆盖 unpack 侧「INSERT OR IGNORE 命中既有残行」的重算缺口。
- `gc()`：原 blob 清扫后追加两步——(1) 删孤儿 member（`content_hash NOT IN (entry ∪ revision)`，复用 `gc()` 现有引用集 SQL 口径，防两套口径漂移）；(2) 删空 pack（按 member 表实际 `COUNT(*)`，不信任 `member_count` 列）。单层判定、无不动点（pack 自包含，fossil 的 base 是同组段内前驱、非跨行引用）。
- `findContentSizeByPath`（`sqlite-vfs-entry.repository.ts` L241-253）：blob 行缺失时回退 `member.compressed_byte_len`，闸门口径与今天逐字节一致。

**触发器不变量**（ref_count 三触发器安全的前提，探索报告核实成立）：

- INV1 **live head 必有权威副本（blob 行或 member 行）**：打包谓词排除所有 entry 的 head、head 变更走 put（member 抽回），故正常形态下 head 都落 blob 行；但判定不写成「必有 blob 行」——`ensureBlob` / `findExistingBlobHashes` 以 **UNION member** 判「已存在」，tree-copy / seed 快路径的「hash 已存在即直接落 head」分支可能让 entry head 指向**只有 member 行**的 hash，此时仍是合法权威副本（读路径 `get` 有 member 分派），只是形态异常。
- INV2 **新 revision 只引用 live head hash 或新 put 的 hash**：tree-copy / seed / backfill / fork-copy 引用的都是 head（探索报告逐点核实）；两者都必有权威副本（head 走 blob、跨 entry 归首遇的 member-only head 走 member） → `trg_revision_insert_inc_blob_ref` 的 UPDATE 永不命中 0 行。
- INV3 **一 hash 至多一处权威副本**（blob 行或 member 之一）：put 抽回 + 打包删行双向保证。
- 配套：`integrity-repair` 可选增加检测项「head hash 无 blob 行**、或存在 member 行**」（INV1 违例即报警）——检测项的「或存在 member 行」前置是必需的，否则 UNION member 常态下的跨 entry 归首遇形态会被全量误报。

**打包任务**（core，新增 `runVfsContentPacking`，对齐 `blob-binary-normalization.ts` 骨架）：

- **无终态完成标记**（版本持续增长，与骨架模板的最大分叉）：每次入口重扫候选谓词；真库候选谓词查询毫秒级（115 组），无需缓存。
- 每组单事务：**事务外**经 content store 读组内明文（三形态兼容，与归一任务交错安全——归一只改 encoding/bytes 形态不改明文）→ 选编码 → 事务内 INSERT pack + members + DELETE blob 行（原子，中断不留半打包态）。**事务回调内不得引用外层 conn**（AsyncMutex 不可重入）。
- 坏组（某成员明文解压失败）整组跳过、计入 `failedGroups`；收尾重扫按 **entry 口径**判定：正常收敛下每个仍未收敛的候选 entry 必含至少一个坏组（好组落库后 blob 行已删，该 entry 若无坏组即整体退出候选），故**可归因剩余候选 entry 数 > `failedGroups`** 即 `stalled: true`（照骨架语义：谓词天然收敛，打转即异常——处理过却未收敛）；违反则本轮停手、不写 `failedGroups` 快照、不挂收尾维护。**并发豁免**：该不变量只在「本轮无新数据写入」时成立——用户保存新版本会把旧 head 的 hash 变成非 head 候选、该 entry 收尾重扫的 `maxVersion` 必然变大；故 `stalled` 判据只对「本轮开始时已存在（入口扫描见过）且期间无新版本（收尾 `maxVersion` 与入口相等）」的 entry 生效（候选谓词已 SELECT `r.version`，数据现成），把并发写入造成的剩余摘出归因集，避免一次保存就误判打转、连带跳过收尾 VACUUM（本轮删 blob 释放的页留在库里不还）。**写零候选水位的前置仍维持「收尾剩余候选 entry 数 == 0」的全库口径**，不按归因集收窄——并发写入造成的新候选下一轮仍需被发现，不能被水位短路掉。
- KKV module `nm-vfs-pack`：`startupMaintenancePending`（收尾维护兜底，照骨架）+ `failedGroups` 快照（UI 第三态）。
- 预算 `DEFAULT_VFS_PACK_SYNC_BUDGET_MS = 30_000`（CLI 三任务串行最坏 60+60+30=150s；真库 Node 实测搬运全程 1.85s，Hermes 放大后仍在预算内）；批间 `setTimeout(0)` 让步 + `shouldPause` 三端守卫（mobile: agent+maintenanceBusy；desktop: agent+cloudSync+maintenanceBusy；cli 无守卫）。**让步粒度 = entry**（组事务本身是短事务，组内不再让步）；预算检查同为组粒度（打完一组即查 deadline），`shouldPause` 守卫在 entry 与组两级各查一次。
- 收尾维护：仅本轮 `packedGroups > 0` 时挂 `runStartupMaintenanceOnce`（删 blob 行的页回收需要 VACUUM）；desktop 照抄 `beforeMaintenance/afterMaintenance` 回调缝包住 VACUUM 段置 busy。
- 状态查询 `getVfsContentPackStatus(conn)`：`{ pendingGroups, memberCount, streamBytes, failedGroups }`；**自建 3s 采样节流**（照 blobBinary 私有 WeakMap 模式 + `__resetStatusSamplingThrottleForTests` 钩子；desktop 2s 轮询下合并为约一次/3s 真采样，完成判定不走缓存直调）。UI 两态「无需处理 / 剩余 N 组」+ `failedGroups > 0` 第三态。

**完整性校验 + 反向展开（应急回滚）**：

- `verifyVfsContentPacks(conn)`：逐 member 校验——pack 组切片明文 hash == content_hash；fossil 组沿链 apply 后 hash == content_hash。
- `unpackVfsContent(conn)`：先写后删、可重复执行；**重建 blob 行的 `ref_count` = `COUNT(vfs_revision WHERE content_hash = ?)` 现场重算**（ref_count 只由 revision 触发器维护，unpack 绕过触发器直接 INSERT，必须重算——本条为旧方案缺口，T-VP16 锁定）。

**为什么是混合而不是另两条路**（全部有实测）：

- **纯 pack**：小文件组最优（deflate 熵编码 + 整流上下文），大文件组受 32KB 窗口限死（该类组省 32.3%）。
- **纯 fossil 链**：全库口径反而比混合差 4.5%（1.697 vs 1.608MB）——小文件上 delta 指令流开销 + insert 段失去整流上下文，输给 pack 5.2%。
- **delta 住 blob 原表 / 字典链**：行间引用、GC 保活、回滚物化、byte_len 失真——已否决（见「已否决方案与依据」）；fossil 进 pack 容器后这四条全部消失。

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
| 13 | 测试 | 见「测试策略」；`content-store.test.ts` / `file-cache-store.test.ts` / `message-content-codec-roundtrip.test.ts` 的 b64 写用例改写为存量读兼容用例；**`apps/mobile/jest.config.js` 的 `transformIgnorePatterns` 追加 `\|fossil-delta`**——`fossil-delta@2` 是纯 ESM（`type: module`、无 exports map），经 moduleNameMapper 直连 `dist/public/vfs.js` 的 vfs 服务链路（createVfsService → content store → pack-codec）会拉到它，不纳入 babel transform 会在 Jest 里炸 ESM 语法（主入口 core-shim 不经此链路，别按 shim 口径排查） | A+B |
| 14 | 文档 | CHANGELOG Unreleased；RULE.md（形态归一与打包列约定、`byte_len` 语义） | A+B |
| 15 | KKV 新 key：`startupMaintenancePending` | 收尾维护失败时的兜底标记（module `nm-blob-binary`）：入口读到即无视 `processedAny` 强制补跑一次维护链路；**清标记以 `runStartupMaintenanceOnce` 返回非 `null` 为条件**（同进程重入时保留待下次冷启动） | A |
| 16 | KKV 写路径总表 | 本迭代全部 KKV 写路径清点：`nm-blob-binary` ×4（`vfsContentDone` / `fileCacheDone` / `messageContentDone` / `startupMaintenancePending`）＋ `nm-message-content` ×2（`compactionDone` / `startupMaintenancePending`，消息压缩任务各自的独立 pending key，不共享单 key）＋ `nm-vfs-pack` ×3（`startupMaintenancePending` 收尾维护兜底，照骨架语义 / `failedGroups` 坏组快照，仅收敛轮写、预算中途退出与 stalled 不写——半程计数会低估上一轮完整快照 / `zeroCandidateWatermark` 零候选水位指纹，命中即短路谓词，详见「实现期补充三」） | A+B |

## 详细实现步骤

**Part A（建议立即执行）**

- Step 1 — phase-debase64-codec — blocking: yes — qa: auto：三处写侧收口恒二进制（含删除注入参数与死代码）；读路径三形态一行不动；更新驱动注释。
- Step 2 — phase-debase64-tests — blocking: yes — qa: auto：改写存量 b64 写用例为「存量行读兼容」用例；新增「新写入恒二进制（三表）」断言；T-BB1~T-BB3、T-BB8。
- Step 3 — phase-debase64-task — blocking: yes — qa: auto：`runBlobBinaryNormalization` + `getBlobBinaryStatus` + 维护链路会话级去重；T-BB4~T-BB7。
- Step 4 — phase-debase64-wire — blocking: yes — qa: auto：三端调度接线 + 存储页状态行 + IPC DTO + 导出快照。
- Step 5 — phase-debase64-regression — blocking: yes — qa: auto：core 全量（先重建 dist）＋ desktop ＋ mobile ＋ 全仓 typecheck。
- Step 6 — phase-debase64-verify — blocking: no — qa: manual_user：真机（荣耀 EBG-AN00）验收——库体积、三表形态直查（`SELECT encoding, TYPEOF(bytes), COUNT(*)`）、逐条解压校验、二次启动零重扫、读写/搜索/回滚正常。

**Part B（2026-09-28 重写为混合方案定稿；前置：Part A 已随 v1.5.25 发布，分支 `feat/vfs-content-pack` 基 `main@71527442`）**

- Step 7 — phase-vfs-pack-deps — blocking: yes — qa: auto（依赖引入 + Node 侧回环）；Hermes 探针部分 qa: manual_user（真机 + Metro 热更，探针脚本落库断言）：`packages/core` 引入 `fossil-delta@^2.0.0`（dependencies，照 fflate 同位；ESM-only 无坑——npm 元数据实测 `type: module` + 有 `main` 无 exports map，三端全链 ESM/Metro 可解析）；**Hermes 真机探针验证**（探针挂 Metro 热更，不用重打包；结果落库 + adb 拉库断言，沿用 tmp 探针先例）：createDelta/applyDelta 回环正确性 + 1MB 语料编码耗时（Node 实测 1.85s 全量 / 单组毫秒级，Hermes 放大 5-10× 预算内）。**若 Hermes 不通：降级为纯 pack（阈值分支移除，format 只留 zlib-concat-v1），本步骤是 fossil 线的硬门禁。**
- Step 8 — phase-vfs-pack-schema — blocking: yes — qa: auto：两表 DDL（`vfs-content-pack-schema.ts` 新文件，注册进 `NOVEL_MASTER_SCHEMA_STATEMENTS` 排 blob 表之后）+ `SCHEMA_BOOT_VERSION` 17→18（撞号顺延注释）+ schema 三用例（新库建表 / 存量库慢路径 / 快路径不建）；T-VP17。
- Step 9 — phase-vfs-pack-store — blocking: yes — qa: auto：content store 六方法改造（`get`/`getMany` 按 format 分派、`ensureBlob`/`findExistingBlobHashes` UNION member、`put` 抽回删 member、`gc` 追加两步）+ `findContentSizeByPath` 回退 `member.compressed_byte_len`；T-VP1/2/4/5/6/11/14/15。
- Step 10 — phase-vfs-pack-task — blocking: yes — qa: auto：`runVfsContentPacking`（谓词/分组/选型阈值/单事务/预算/坏组/stalled/收尾维护回调缝）+ `getVfsContentPackStatus`（3s 采样节流）+ `verifyVfsContentPacks` + `unpackVfsContent`（ref_count 重算）；T-VP3/8/10/12/13/16/18~21。
- Step 11 — phase-vfs-pack-wire — blocking: yes — qa: auto：三端调度接线（mobile/desktop 新服务 + cli 内联追加，预算 30s）+ 双端指标卡第四行「历史版本打包」（mobile `migrationRows` + `storage-config-migration-values.ts` 取值纯函数；desktop `MIGRATION_ROWS` + `migrationRowValue` + DTO + `getDbMaintenanceStats` 采样）+ 导出并入主入口区 + `main-entry-allowlist.json` 快照同步；T-VP22。
- Step 12 — phase-vfs-pack-regression — blocking: yes — qa: auto：core 全量（先重建 dist；重点回滚/checkpoint/tree-copy/fork-copy/scanContents 链路）+ desktop + mobile + 全仓 typecheck（renderer 不新增债）；T-VP7。
- Step 13 — phase-vfs-pack-verify — blocking: no — qa: manual_user：真机验收——VFS 内容体积（对照 dry-run 预期 −4.5MB 量级）、文件树/预览/读写、历史版本回滚（重点 fossil 组 entry）、checkpoint 恢复、二次启动收敛、指标卡第四行两态渲染。

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
- T-VP1 — blocking: yes — 打包后逐版本读回等值（含同组重复 hash 共享成员；pack 与 fossil 两种 format 各至少一组）（映射 Step 9）
- T-VP2 — blocking: yes — 打包后 head 全有权威副本：打包任务跑完后所有 `vfs_entry.content_hash` 都有权威副本——**正常形态下均为 blob 行**（回归判据仍取 blob 全集：`COUNT(*) FROM vfs_entry WHERE content_hash IS NOT NULL AND content_hash NOT IN (SELECT content_hash FROM vfs_content_blob) === 0`），跨 entry 共享 hash 归首遇导致的 member-only head 由 INV1 的宽松式（blob 行**或** member 行）覆盖（映射 Step 9/10）
- T-VP3 — blocking: yes — pack 自包含校验：逐 member `hash(还原明文) == content_hash`（pack 切片 / fossil 链 apply 两种还原路径都校验）（映射 Step 10）
- T-VP4 — blocking: yes — GC 语义：无引用 pack 被回收；任一成员被引用则整包保留；孤儿 member 回收；`ref_count` 触发器与 pack 删除互不干扰（映射 Step 9）
- T-VP5 — blocking: yes — `ensureBlob(hash, null)` 与 `findExistingBlobHashes` 对已打包 hash 判定为「已存在」，tree-copy / seed / fork-copy 不误报（映射 Step 9）
- T-VP6 — blocking: yes — `findContentSizeByPath` 对已打包 hash 返回原 `byte_len`（fossil 组断言不回退 delta 长度；闸门口径不变，超限文件仍走占位）（映射 Step 9）
- T-VP7 — blocking: yes — 回滚链路在 pack 形态下全绿：`resetHeadToVersion` / `restore-path` / `revive-deleted-entry` / checkpoint capture-restore / `sweepSessionRevisions`（映射 Step 12）
- T-VP8 — blocking: yes — 打包幂等/可重入：中断不留半打包态；重跑不重复打包已打包版本（谓词天然收敛）（映射 Step 10）
- T-VP10 — blocking: yes — 反向展开：`unpackVfsContent` 后 pack/member 清空、独立 blob 行齐备且读回等值，可重复执行（映射 Step 10）
  （注：无 T-VP9——旧版用例清单即无该编号，编号不回收；新用例自 T-VP11 起）
- T-VP11 — blocking: yes — fossil 链编解码回环：段表解析、逐层 apply 后明文与原件逐字节全等（Node 侧 740/740 已验，测试用构造语料固化）（映射 Step 9）
- T-VP12 — blocking: yes — 阈值分组：24KB 上下两组分别落 `zlib-concat-v1` / `fossil-chain-v1` 的 format 断言（映射 Step 10）
- T-VP13 — blocking: yes — fossil 组读放大上限：单次读 = 解首段 + ≤7 次 apply；构造最坏组（8 成员 × 大明文）Node 耗时护栏 ≤50ms 量级（数量级回归线，非实测值卡线）（映射 Step 10）
- T-VP14 — blocking: yes — 抽回死区语义：put 抽回 fossil 组首成员后，H0 走 blob 路径读回全等、同组剩余成员仍从段链读回全等、pack 流字节不变（dry-run 实测场景固化）（映射 Step 9）
- T-VP15 — blocking: yes — 混合 getMany：跨 blob / pack / fossil 三源批量读取，pack 组只解压一次、fossil 组复用链式中间结果（映射 Step 9）
- T-VP16 — blocking: yes — unpack 的 ref_count 重算：展开后 blob 行 `ref_count == COUNT(vfs_revision 引用数)`，后续 revision 删除触发器归零回收不误删（映射 Step 10）
- T-VP17 — blocking: yes — schema 三用例：新库 DDL 建表（`user_version === SCHEMA_BOOT_VERSION` 常量断言）/ 存量库慢路径补建 / 快路径不建（照 `session-run-state-schema.test.ts` 先例）（映射 Step 8）
- T-VP18 — blocking: yes — 坏组跳过：某成员明文解压失败的组整组保留、`failedGroups` 计数、不阻断其它组收敛（映射 Step 10）
- T-VP19 — blocking: yes — 预算中断续跑：收紧预算让任务批间收手，重启续跑收敛（映射 Step 10）
- T-VP20 — blocking: yes — stalled：可归因剩余候选 **entry** 数 > `failedGroups` 时 `stalled: true` 不挂收尾维护；反例断言并发豁免——任务期间给某 entry 追加更大版本号时 `stalled===false && done===true && maintCalls===1`（映射 Step 10）
- T-VP21 — blocking: yes — 收尾维护观测：`maintCalls` 回调计数——首轮确有打包 `maintCalls===1`、稳态零候选 `maintCalls===0`、pending 兜底路径（**独立测试文件**承载进程级标记正向路径，照 `blob-binary-normalization-maintenance.test.ts` 先例）（映射 Step 10）
- T-VP22 — blocking: yes — 三端源码/UI 契约（照 Part A 的 cr-21/cr-06 先例）：mobile 指标卡第四行渲染两态 + 取值纯函数（`storage-config-migration-values` 直 import 测试）；desktop `MIGRATION_ROWS` 顺序与 `migrationRowValue` 分支 + DTO 字段 + handler 兜底（采样抛错时指标卡字段降级不拖垮主统计）（映射 Step 11）

**实测数字与产物口径注记**：`流 1.608MB` = 阈值扫描 24KB 档最优值；`1.620MB` = 32KB 档（dry-run 实际采用档位）——两数并存是阈值扫描结果，非矛盾。dry-run 脚本与库副本为主仓 `tmp/` 本地实测产物（`tmp/poc-hybrid.mjs`、`tmp/nm-real-v2.db`、`tmp/nm-hybrid-sim.db`），不随分支提交；关键行为结论（读回全等/幂等/抽回死区/ref_count 语义）已固化为 T-VP1/3/10/14/16 用例，实现侧无需依赖本地产物。

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
| T-VP1 | `packages/core/test/vfs/content-store-pack.test.ts`（「T-VP1: 打包后逐版本读回等值（pack 与 fossil 两 format；含同组重复 hash 共享成员）」） | 两种 format 逐版本 `get` 读回逐字节全等；同组重复 hash 共享同一 member |
| T-VP2 | 同上（「T-VP2a: blob 命中优先于 member」＋「T-VP2b: 打包任务跑完后所有 entry head 均有 blob 行（正常形态判据）」） | blob 命中优先于 member 分派（互斥夹具：head 与 member 垃圾 offset 同存）；打包后全库无「head 有 hash 却无 blob 行」 |
| T-VP3 | `packages/core/test/infra/vfs-content-packing.test.ts`（「T-VP3: verifyVfsContentPacks 两 format 全过；篡改 member offset 报失败（牙齿）」＋「T-VP3b（pbp-24）」） | 逐 member hash 校验两 format 全过；篡改 offset 必报失败（牙齿）；verify/unpack 按 pack 逐个载入、零全量 bytes 查询 |
| T-VP4 | `content-store-pack.test.ts`（「T-VP4: GC 语义——无引用 pack 回收 / 成员被引用整包保留 / 孤儿 member 回收 / ref_count 触发器互不干扰」） | 四项 GC 语义逐条断言；`gc()` 返回值 = blob / member / 空 pack 三表删除行数之和 |
| T-VP5 | 同上（「T-VP5: ensureBlob(hash,null) 与 findExistingBlobHashes 对已打包 hash 判已存在」＋「T-VP5b: …chunk 满载 500…」） | UNION member 判已存在，tree-copy / seed / fork-copy 不误报；chunk 满载 500 全判已存在且单语句绑定变量 ≤500（老 Android SQLite 999 上限） |
| T-VP6 | 同上（「T-VP6: findContentSizeByPath 回退 member.compressed_byte_len（fossil 组不回退 delta 长度）」＋「T-VP6b: pack/member 形态下 compressed_byte_len 超闸门仍走占位、闸门内读真文」） | 回退值恒等于被替换 blob 行的 `byte_len`；消费端 `loadOrFillFileCache` 探针在超限组返占位、闸门内返真实正文 |
| T-VP7 | `vfs-content-packing.test.ts`（「T-VP7（pbp-12）：已打包 entry 的回滚/复活/checkpoint/sweep 四条链路」） | 成员全落 member 的数据面上跑 `resetHeadToVersion` / restore-path / `revive-deleted-entry` / checkpoint capture-restore / `sweepSessionRevisions`；每次 put 抽回 member −1、读回逐字节等值 |
| T-VP8 | 同上（「T-VP8: 打包幂等/可重入——组事务中断回滚无半态；重跑不重复打包」） | 事务中断替身（member 落库前崩溃）→ 三表全回滚；重跑不重复打包已打包版本 |
| T-VP10 | 同上（「T-VP10: 反向展开——unpack 后 pack/member 清空、blob 行齐备读回等值、可重复执行」） | 展开后两表清空、独立 blob 行齐备且读回等值；重复执行幂等 |
| T-VP11 | `content-store-pack.test.ts`（describe「pack-codec: T-VP11 fossil 链编解码回环」＋「T-VP11a 防御: delta 自述输出规模超上限的坏段在 apply 前被拦（堆增量 <50MB）」） | 段表解析 + 逐层 apply 后明文与原件逐字节全等；伪造超大 `limit` 的坏段在 apply 前被拦、堆增量 <50MB |
| T-VP12 | `vfs-content-packing.test.ts`（「T-VP12: 阈值分组——24KB 上下两组分别落 zlib-concat-v1 / fossil-chain-v1」） | 阈值两侧分别落两 format 的断言 |
| T-VP13 | 同上（「T-VP13: fossil 组读放大上限——最坏组（8 成员 × ~120KB）单次读 ≤50ms 且链式解压计数=8」） | 计数断言（解压次数 = 8）为主牙齿，计时为 fflate 口径护栏 |
| T-VP14 | `content-store-pack.test.ts`（「T-VP14: 抽回死区——put 抽回 fossil 组首成员后 blob/member 双侧读回全等、pack 流字节不变」） | 抽回后 H0 走 blob 路径、同组剩余成员仍从段链读回、pack 流字节不变 |
| T-VP15 | 同上（「T-VP15: 混合 getMany 跨 blob/pack/fossil 三源——pack 组只解压一次、fossil 组复用链式中间结果」） | 跨三源批量读取的解码次数与中间结果复用断言 |
| T-VP16 | `vfs-content-packing.test.ts`（「T-VP16: unpack 的 ref_count 重算」＋「T-VP16b: put 抽回 blob 行现场重算 ref_count」＋「T-VP16c: unpack 幂等修复 ref_count」） | 展开后 `ref_count == COUNT(vfs_revision 引用数)`、删引用逐级递减且不撞 CHECK；put 抽回落 ref_count=2；既有 ref_count=0 残行也被重算、后续删引用不抛 |
| T-VP17 | `packages/core/test/bootstrap/vfs-content-pack-schema.test.ts`（describe「vfs_content_pack 两表 schema 升级（T-VP17）」，三 it） | 新库 DDL 建表与 `user_version === SCHEMA_BOOT_VERSION`；老库慢路径补建升版；已升版库快路径不重跑 |
| T-VP18 | `vfs-content-packing.test.ts`（「T-VP18: 坏组跳过——解压失败成员所在组整组保留、failedGroups 计数、不阻断其它组」） | 坏组整组保留、计数、不阻断其它组收敛 |
| T-VP19 | 同上（「T-VP19: 预算中断续跑——收紧预算批间收手，重启续跑收敛」） | 打断轮确定口径整对象断言（`done:false` / `packedGroups:1`）；续跑守恒式 `packedGroups` 之和 == 3 |
| T-VP20 | 同上（「T-VP20: stalled——组落库后 blob 行未删（打转）→ stalled:true、不挂收尾维护」＋「W1-P1-5（pbp-5）」） | 真打转判 `stalled:true` 且不挂收尾维护；并发豁免——任务期间追加更大版本号 ⇒ `stalled===false && done===true && maintCalls===1` |
| T-VP21 | 同上（「T-VP21: 收尾维护观测——首轮确有打包 maintCalls===1、稳态零候选 maintCalls 不再增加」）＋姊妹文件 `packages/core/test/infra/vfs-content-packing-maintenance.test.ts`（「第一条: 预置 startupMaintenancePending + 零候选 → maintCalls===1 且 pending 被清」／「稳态: 零候选、无 pending → maintCalls===0」） | 主文件观测首轮/稳态；独立文件承载进程级 pending 标记正向路径 |
| T-VP22 | `apps/desktop/test/migration-row-value.test.ts`（「vfsPack 第四行夹具 + MIGRATION_ROWS 项顺序（T-VP22）」）＋ `apps/desktop/test/db-maintenance-vfs-pack-stats.test.ts`（describe「db/stats vfsPack 字段契约（T-VP22）」）＋ `apps/mobile/__tests__/storage-config-migration-values.test.ts`（describe「vfsPackValue 夹具（T-VP22 第四行，无终态两态 + 坏组第三态）」）＋ `apps/mobile/__tests__/storage-config-screen-source.test.ts`（「T-VP22: 第四行取值走 vfsPackValue 纯函数、数据源是 vfsPack state 接线」） | desktop 行序 + `migrationRowValue` 分支 + DTO 字段 + handler 兜底（采样抛错 ⇒ `vfsPack===null` 且主统计不塌）；mobile 取值纯函数三态与源码接线 |

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

**迁移生命周期（退役时间表，用户拍板 2026-09-28）**

- **V0（本迭代）**：后台归一任务（`runBlobBinaryNormalization` + 适配器注册表）+ 三形态读兼容（zlib 二进制 / zlib+存量 base64 文本 / zlib-b64）常驻运行。
- **V1（约 10 个 tag 后退役，与 message-content-compression spec 的迁移生命周期 V1 及 RULE 的 migration 清理节奏同轮执行）**：删除迁移代码确保整洁——归一任务本体与适配器注册表、三端调度接线（mobile / desktop / cli 服务）、KKV 标记（module `nm-blob-binary` 全部 key）、读路径的 zlib-b64 与存量 base64 文本兼容分支（zlib-codec 收敛为单形态二进制）、相关测试与指标卡「去 base64」两行。**删除前提**与 compression 侧 V1 同款：启动收尾须保证库里无 zlib-b64 残留（强制收尾门/基线抬升的细则届时与 compression V1 一并细化，两任务本就同批调度）。
- 参考时点：本批发版 tag 起 10 个 tag 后（本版预计 v1.5.25 → 约 v1.5.35）。

**Part B（混合方案）**

- 风险（按严重度）：① 跨「`hash` ⇒ blob 行」契约的收口改造（`get`/`getMany`/`ensureBlob`/`findExistingBlobHashes`/`put`/`gc`/`findContentSizeByPath` + seed/fork/tree-copy/backfill 消费方），漏一处即读失败或双份存储——探索报告已给全部落点，T-VP 系列逐点覆盖；② GC 误删导致明文丢失——「pack 自包含 + 单层引用判定 + T-VP3 校验」三重兜底，回滚前可先 `verifyVfsContentPacks`；③ 读放大：pack 组整组解压（≤1MB 明文）/ fossil 组 ≤7 次链 apply，Node 实测最坏 7.1ms、Hermes 预估 ×5-10（Step 7 真机探针实测定案）；④ 回滚卡顿敏感路径（`rollback-large-jank` 刚修）新增解压成本，Step 12 用既有回滚用例回归；⑤ **不可降级**：旧版本 app 读不到已打包 hash（member 概念不存在）——发布后回退 APK 将无法读历史版本，回退路径 = 装新版跑 `unpackVfsContent`（**发版前须用户知情确认**）；⑥ fossil-delta 供应链：npm 单包、零运行时依赖、BSD，锁 `^2.0.0`；Hermes 兼容性 Step 7 实测，不通则降级纯 pack（阈值分支移除，方案退化为已验证的 zlib-concat 单格式）；⑦ 触发器 0 行 UPDATE 的静默性——INV1/INV2 不变量保证不触发，`integrity-repair` 增加检测项作防御。
- 回滚：`unpackVfsContent` 反向展开（ref_count 重算，可重复执行）→ 删两张表 → `SCHEMA_BOOT_VERSION` 不回退（只升不降）。
- 实证基线（新库 dry-run，`tmp/poc-hybrid.mjs`）：155 组（150 pack + 5 fossil）、740 成员读回 740/740 全等、head 228/228 零影响、幂等谓词剩 144（= 不可成组孤立 hash）、GC 0/0、抽回事务 7.7ms + 死区语义全绿、库 61.78→57.22MB（−7.4%，对照实验排除 VACUUM 虚胖）。
- **与 `read-tool-result-ref` 迭代的集成备注（2026-09-29 审查轮确认正交）**：两者在 `contentStore.get` 汇合（read-ref 的 hydrate → `findByEntryAndVersion` → `contentStore.get`；本方案恰改造 `get` 加 member 分派且签名不变），任一先上线链路均闭合；但两者 Step 12 / Step 7 均点名回滚/fork 套件——**两者都落地后需合跑一次回滚 + fork + checkpoint 套件回归**（记入合并后 QA）。

## 实现期补充（A1 落地记录，2026-09-28）

A1（VFS + file_cache 去 base64 + 归一任务 + 三端接线）已按本 spec 落地（分支 `feat/blob-binary-normalization`），以下是实现期相对 spec 原文的新增与分叉，均有测试或实测证据，供 A2 与 Part B 对齐：

| 项 | 说明 |
|---|---|
| `BlobBinaryRunResult` 实际字段 | `{ done, normalizedCount, failedCount, stalled }`（spec 原文只写 `{ done, normalizedCount }`） |
| `failedCount`（单行容错） | 单行 base64 解码失败不再抛穿整轮：坏行原样保留、跳过归一、计入 `failedCount` 并 warn；该表照常置完成标记——否则每次启动重扫同一批坏行、任务永不收敛。读路径对同类坏行本就是自愈的，两侧口径一致 |
| `stalled` + 零进展护栏 | 连续 3 批「谓词非空但 UPDATE 恒 `changes = 0`」即 warn 并 `stalled = true` 收手本轮；两端调度服务见 `stalled === true` 立即停止本进程重试（否则 app 层的「立即续跑」会把它放大成热循环）。护栏**不**要求满批——谓词是实时重扫的，任何批大小的零进展都是异常信号 |
| 收尾维护容错 | 归一完成后挂的 `runStartupMaintenanceOnce` 包 try/catch：VACUUM 失败（磁盘满 / 库被锁）只 warn 不穿透——CLI 启动链路没有 try/catch，裸奔会让每条命令失败，且进程级去重在每个新进程复位、会反复重试注定失败的 VACUUM |
| 预算常量分叉 | 新建 `DEFAULT_BLOB_BINARY_SYNC_BUDGET_MS = 60_000`（与消息侧 `DEFAULT_COMPACTION_SYNC_BUDGET_MS` 同值不同名）：后者所在模块已随 1.5.29 落地为 message-content-decompression（分支上仍是旧的 `message-content-compaction` 文件名），故同名不同模块、无法直接引用 |
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

## 实现期补充三（性能修复轮，2026-09-29）

合并 main@4cd06bb0（v1.5.27）后，按全局压缩性能盘点（brain-storm 三路真库实测）落三项修复，均为实现期对 spec 原文的口径补充：

- **vfs_entry(content_hash) 索引**（对 spec「候选谓词查询毫秒级…无需缓存」的升级）：谓词 `NOT EXISTS` 原为 O(revision×entry) 无索引全扫——真库形态 121→68ms、合成 2 万 revision/5 千 entry 8.9s→0.37s。随 v18 语句集建出、不单独 bump（本分支未发布）；同轮把 `assertMinimumBaseline` 提前到 DDL 循环之前——pre-1.4.27 老库原会被索引 DDL 的 `no such column` 顶掉友好升级提示。
- **零候选水位短路**（对「无终态标记」的补充而非替代）：KKV `nm-vfs-pack/zeroCandidateWatermark` 存自失效指纹（revisionCount / entryCount / entryHeadDigest / blobCount / packCount / memberCount），仅完整扫描收敛为零候选且零坏组时写入；任何可能新增候选的数据面变更都会改指纹并恢复全扫（entryHeadDigest 兜住 resetHeadToVersion 类计数不变但审计改变的面）。稳态入口轮 265.9→1.74ms、status 采样 126.6→1.91ms。
- **Node 侧原生 zlib 加速器**：`registerZlibCodecAccelerator` 宿主注册制（core src 禁静态 `node:` import 保 Metro 安全）；desktop main / cli runtime 注册 node:zlib；未注册/异常一律回落 fflate。千条会话 listBySession 254.4→99.2ms、解压 6.9×、写侧 deflate 不劣化。
- 测试账目：索引 5 例 + 水位 4 例 + 加速器 5 例；core 全量 3005（唯二红=既有 usage-stats 时区基线）；desktop/cli typecheck 绿；v17 副本实跑升级链（索引与 pack 两表均建出）。

## 已否决方案与依据（避免重复调研）

| 方案 | 实测/结论 |
|---|---|
| 换压缩算法（brotli / zstd） | 逐条口径最多 +12%（brotli q9/zstd19 = 2.51:1 vs deflate 2.24:1）；Hermes 无 WebAssembly，wasm 套件不可用；纯 TS `zstdify` 实测会崩且更差 |
| 内容级去重（CAS / CDC 分块） | 消息精确去重仅 0.03%；CDC 去重 + 逐块压缩反而更差（2.01:1 vs 2.24:1） |
| 按会话/时序打包（消息侧） | 移动端只值 +12%（deflate），读放大涨到 1MB |
| ~~git 式 diff delta 编码器：无现成实现~~ | **2026-09-28 修正**：MCP 调研找到 `fossil-delta`（纯 JS 双向、BSD、零依赖）——「无现成实现」不再成立。其显式跨窗口匹配对大文件组比 pack 好 79.5%，**已纳入混合方案**（fossil 进 pack 容器）；「delta 住 blob 原表 / 行间引用」形态仍否决（见下行） |
| delta 住 blob 原表（不加表形态） | 行间引用（base 依赖）、GC 保活（组长行保活语义碎裂）、回滚抽回首成员需重组整组、byte_len 失真——「省两张表的可见成本、埋核心表的隐性成本」，否决 |
| 字典链（前一版本作字典） | 与 pack 相当（depth≤8 时 2.945MB vs 3.020MB）；**归因补正（2026-09-28）**：其弱势根源是 fflate 字典只对末 32KB 生效（deflate 窗口物理上限）——大文件组（成员 >32KB）正是 fossil 显式匹配的碾压区 |
| preset dictionary 大词典 | fflate 实测只对**末尾 32KB** 生效；deflate 窗口物理上限 |
| 收窄 `encoding` CHECK 值域为只 `'zlib'` | SQLite 不支持 ALTER CHECK，需整表 rebuild，收益为 0（读路径本就兼容多形态） |
| 纯 fossil（全组链式） | 全库口径比混合差 4.5%（1.697 vs 1.608MB）：小文件上 delta 指令流开销 + insert 段失去整流上下文，输 pack 5.2% |
| bsdiff / HDiffPatch（后缀数组类） | patch 质量最优（比 fossil 类好 10-20%）但编码端计算重；无纯 JS 实现，Hermes 上后缀排序不可行；「桌面编码移动只 apply」不成立（mobile 也产生新组）——将来上 JSI 原生模块再重估 |

## Context Bundle

```yaml
iteration_name: binary-blob-and-vfs-pack
requirement_path: 用户口述（2026-09-28）＋ docs/apm/memory/20260927-worktree-123-verify-guide.md（Part B 2026-09-28 晚重写：混合方案）
spec_path: docs/Iterations/binary-blob-and-vfs-pack/spec.md
explore_summary: >
  Part A 已随 v1.5.25 发布（三表二进制化 + 归一任务 + 指标卡）。Part B（2026-09-28 重写）：
  content store port 六方法（put:43/get:75/getMany:99/findExistingBlobHashes:136/ensureBlob:158/
  gc:178）是 hash→明文唯一收口；blob 表 WITHOUT ROWID + TEXT PK，ref_count 三触发器只认
  vfs_revision 行（entry 不参与 ref_count，仅参与 gc 引用集）、「hash ⇒ blob 行」契约散点 =
  content store 六方法 + findContentSizeByPath(L241-253) + seed/fork/tree-copy/backfill 消费方；
  打包任务骨架照 blob-binary-normalization（谓词/keyset/单行短事务/KKV/预算/回调缝/maintCalls
  模式），最大分叉 = 无终态标记（入口重扫谓词 + 状态查询自建 3s 节流）；fossil-delta ESM-only
  实测无模块形态坑（type:module + 有 main 无 exports map）；SCHEMA_BOOT_VERSION 当前 17 → 18；
  UI 指标卡第四行走 ic-22 纯函数模块模式。真库 PoC/dry-run 全绿：五路线对比、归因（大小驱动）、
  混合 dry-run（建表/搬运/读校验/幂等/GC/抽回死区/对账 −7.4%）。
impact_files:
  - packages/core/package.json（fossil-delta 依赖）
  - packages/core/src/bootstrap/vfs/vfs-content-pack-schema.ts（新）+ novel-master-bootstrap.ts（注册 + BOOT 18）
  - packages/core/src/domain/vfs/content-store/impl/sqlite-vfs-content-store.ts（六方法）
  - packages/core/src/domain/vfs/content-store/logic/（pack/fossil 解码逻辑，与 zlib-codec 平级）
  - packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts（findContentSizeByPath 回退）
  - packages/core/src/infra/db-maintenance/impl/vfs-content-packing.ts（新）+ index.ts + src/index.ts
  - apps/{mobile,desktop}/src/services 或 main/services（新调度服务）+ 挂载点 + 指标卡第四行 + DTO
  - apps/cli/src/runtime.ts（内联预算制追加）
  - packages/core/test/（vfs-content-packing.test.ts 新 + 独立维护观测姊妹文件 + schema 三用例 + allowlist 快照）
constraints:
  - Part B bump SCHEMA_BOOT_VERSION 17→18（新表 DDL）；blob 表 DDL 与三触发器冻结不动
  - 大库数据搬运禁走 migration 框架；谓词驱动后台任务 + 每组单事务 + 事务内禁用外层 conn
  - 读路径多形态兼容是契约；错误文案「vfs_content_blob 缺失: {hash}」不变
  - INV1/INV2/INV3 触发器不变量（head 必有 blob 行 / 新 revision 只引用 head 或新 put / 一 hash 一权威副本）
  - member.compressed_byte_len 恒为原 blob 行 byte_len 复制（fossil 组严禁记 delta 长度）
  - mobile jest 消费 core dist；新增导出同步 main-entry-allowlist 快照；断言按 scope 过滤（bootstrap 种子污染）
  - 验收断言牙齿三判据（恒真/恒红/互斥夹具）；收尾维护观测走 maintCalls 回调计数 + 独立测试文件
  - 真机验收一律从 UI 操作，库只读；Hermes 探针验证先行（Step 7，不通降级纯 pack）
blocking_steps: [7, 8, 9, 10, 11, 12]
```
