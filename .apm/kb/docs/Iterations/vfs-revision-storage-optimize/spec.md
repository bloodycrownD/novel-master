---
date: 2026-07-25
---

# vfs-revision-storage-optimize 技术规格（SPEC）

## 需求来源

- PRD：`.apm/kb/docs/Iterations/vfs-revision-storage-optimize/prd.md`
- 前置：`Iterations/message-checkpoint-v2`（整树 `{path→version}` 指针 + 可达性 GC；本迭代不改其 message/checkpoint 合同）
- 探索依据：2026-07-25 多路只读探索（write/revision、checkpoint/GC/补偿、schema/备份、测试/平台）
- 拍板：压缩算法 **zlib**；失败补偿 **方案 B**；不做 delta

## 设计目标

1. **同文不升 version**：相对 live head 正文全等则不 bump、不 append；写 API 仍成功返回既有 version。
2. **内容寻址 + zlib**：明文经 ContentStore → SHA-256 + zlib → SQLite `BLOB`；多 revision 与 live entry 共享同一 blob。
3. **旧库迁移**：升级时把 inline TEXT 迁入 blob 并按 hash 去重；不强制删除同文 version 行。
4. **user vfs 失败补偿不注水**：拨回快照 head（或 absent 硬删），再按可达集删除本批产生的不可达中间 revision；禁止「再 write 叠假历史」。
5. **对外无感**：`VfsService` 常规读写 / ZIP / grep / 编辑器 / Agent 继续 UTF-8 `string`；`.nmbackup` 仍整库带走。
6. **不做 delta**；不引入 isomorphic-git；不把 blob 存库外。

## 总体方案

### 分层

```text
VfsService.write/read (string)
        │
RevisionAwareVfsService.writeWithRevision  ← 同文短路；失败补偿走 reset/hardDelete 原语
        │
SqliteVfsEntryRepository / SqliteVfsRevisionRepository
        │
VfsContentStore (put/get/gc)  ← sha-256 + zlib（fflate zlib 封装）；表 vfs_content_blob
        │
SQLite (同一 novel.db)
```

### ContentStore

- 表：`vfs_content_blob(content_hash TEXT PRIMARY KEY, encoding TEXT NOT NULL, bytes BLOB NOT NULL, byte_len INTEGER NOT NULL)`
  - `content_hash`：UTF-8 明文的 SHA-256 hex（小写）
  - `encoding`：存储格式标识。Node / 桌面测 **`'zlib'`**（raw zlib bytes）；Hermes / RN 上 `put` 落 **`'zlib-b64'`**（`blob-bytes-codec.ts`：zlib 后再 base64 编码以规避 RN BLOB 绑定问题）。读路径按 `encoding` 字段解码，**禁止**写死单一格式。
  - `bytes`：zlib 压缩后字节
  - `byte_len`：**压缩后**字节长度（= `bytes.byteLength`；诊断用；禁止存明文长度冒充）
- API（端口层）：
  - `put(plain: string) → contentHash`
  - `get(hash) → string`
  - `gc(referencedHashes: ReadonlySet<string>) → deletedCount`
- put：已存在同 hash 则复用行，不重复插入
- 禁止对 BLOB 使用 `String(row.bytes)`；TDBC 读写用 `Uint8Array`；RN 绑定须 tight `ArrayBuffer` copy（沿用 sksp/C4 约定）

#### SHA-256 选型（钉死）

- 跨端统一用 **`@noble/hashes/sha256`**（core 新增依赖；mobile 已有同族依赖可对齐版本）。
- 允许在 `logic/hash-content.ts` 做薄封装（UTF-8 → hex），内部只走 noble；**禁止**以 `node:crypto` / RN native crypto 作为唯一实现。
- 若日后改 Web Crypto，须仍保证 Node + RN 同构输出；本迭代不引入双实现。

#### zlib 封装（fflate）

- **复用** core 已有 `fflate` 依赖；**新建** `logic/zlib-codec.ts`，对外只暴露 `zlibSync` / `unzlibSync`（或等价命名），内部调用 fflate 的 zlib 路径。
- 与 ZIP 用的 `deflateSync` / `inflateSync` / `zipSync` / `unzipSync` **模块边界分离**：ContentStore 不得直接 import ZIP 编解码入口；ZIP 路径不得调用 ContentStore 的 zlib 封装（除非明确共享底层 helper 且两边注释边界）。
- 禁止以 `node:zlib` 或 RN native zlib 作为唯一压缩实现。

#### ContentStore.gc 引用集（钉死 · 全库）

`vfs_content_blob` **整库共享**（跨 session / project），不是 session 私有表。

- `gc(referencedHashes)` 的 `referencedHashes` **必须**是全库引用集：  
  `SELECT content_hash FROM vfs_entry WHERE content_hash IS NOT NULL`  
  ∪  
  `SELECT content_hash FROM vfs_revision WHERE content_hash IS NOT NULL`  
  （实现可写成一次查询或 store 内 `collectAllReferencedHashes()`）。
- **blob GC 算法唯一入口（钉死）**：全库 blob gc **只**经 `collectAllReferencedHashes` + `ContentStore.gc` 这一套算法；禁止旁路助手或第三套 collect/gc 逻辑。
  - **现网（`message-rollback-execution-redesign` 已落地）**：算法仍唯一，**触发为 deferred**——revision 打扫（`sweepSessionRevisions` 或等价）**不再**末尾同步跑 blob gc；改由 `runDeferredBlobGc` 统一调度（业务路径事务后 / 空闲 / 周期可选触发）。调用方不得手写第二套 gc。
  - `sweepSessionRevisions` 仅删本 session 不可达 revision 行；blob 回收须经 `runDeferredBlobGc`（内部仍为 collect+gc）。
  - **调用方**一律只经上述入口触发 blob gc（不得在调用后再手拼 `ContentStore.gc`）：
    - `message.service`（单条删消息后 sweep + deferred gc）
    - `truncate-tail-in-transaction`（`sweepRevisions: true` 时）
    - `user-vfs-turn` 失败补偿末尾（restore 尝试结束后不论是否 composite）
    - `session.service` / `project.service` / `sessionTemplatePull` 等 session 删路径（事务后 deferred gc）
- **明确禁止**：用「当前 session 前缀下的局部 keepSet」去 `DELETE` keepSet 之外的全部 blob 行——会误删其它 session 仍在引用的正文。
- `sweepSessionRevisions` 仍可只删本 session 不可达 `(path,version)` 行；但紧随其后的 blob gc **不得**把 keepSet 缩成 session 局部。

### entry / revision 列与可空合同（钉死）

#### Canonical DDL

- `vfs_entry`：
  - `content TEXT NULL`（**从现网 `TEXT NOT NULL` 改为可空**）
  - 新增 `content_hash TEXT NULL`
- `vfs_revision`：
  - `content TEXT`（本就可空，**保持可空**）
  - 新增 `content_hash TEXT NULL`
- **禁止**用空串 `''` 表示「已迁出 / 无正文」；迁移后与新写入统一用 **`NULL`**。全文（DDL、迁移、读路径、测例）不得再写「NULL 或空串」含糊语。

#### 旧库去掉 `NOT NULL`

SQLite 不能可靠 `ALTER COLUMN` 去掉 `NOT NULL`。迁移 `vfs-content-blob-zlib-v1` **必须**对旧库 `vfs_entry` 做 **table rebuild**（或文档等价的 rebuild：建新表 → 拷数据 → drop 旧表 → rename → 重建索引），使结果列定义与 canonical 一致：`content TEXT NULL` + `content_hash TEXT NULL`。  
`vfs_revision` 仅 ADD `content_hash`（content 已可空）；若实现选择一并 rebuild 亦可，但非必须。

#### 行语义（迁移后 / 新写入）

| 行类型 | `content` | `content_hash` | 说明 |
|--------|-----------|----------------|------|
| active 文件（entry / revision `status` 非 deleted） | **`NULL`** | 非空 hex | 正文真源 = ContentStore.get(hash) |
| 目录 entry（`entry_kind='directory'`） | **`NULL`** | **`NULL`** | 无正文；禁止写空串冒充；不 put blob |
| deleted revision（`status='deleted'`） | **`NULL`** | **`NULL`** | 墓碑无正文 |
| 迁移中尚未 put 完的行 | 可暂留旧明文 | NULL | 可重入：有明文则 put → 写 hash → 再 `content=NULL` |

- **不要**用未实现的 `storage_kind='external'` / `external_uri` 表示 blob。

#### domain / port 形状（钉死 · SQL 列 vs 读出 DTO vs 写入 API）

| 层 | `content` / `content_hash` 合同 |
|----|--------------------------------|
| **SQL 列** | `content TEXT NULL` + `content_hash TEXT NULL`；迁移后 / 新写入的 active 文件 **`content=NULL`**，真源只认 `content_hash` → blob |
| **读出 DTO**（`VfsEntry` / `VfsRevision` 及 `find*` 返回值） | 对上层仍解出明文 **`content: string`**（遵守下方 NULL 读路径：deleted / directory 例外）；调用方继续当普通字符串用，不感知 hash/blob |
| **写入 API**（entry `insert`/`update`/set-head；revision `append`；seed-fork / backfill） | **repo 内** `ContentStore.put(plain)`；SQL **只落** `content_hash`，`content=NULL`；**禁止** append / seed-fork 再把明文写入 `content` 列当真源 |

写路径入参仍可收 `content: string`（端口不必改成传 hash）；落库前由 repo 负责 put + 写 hash。读路径在 repo 解完后，上层（含 `restore-path`、`loadRevisionContent`）拿到的已是明文，不得再把 SQL `NULL` 当空串兜底。

#### NULL content 读路径（钉死）

repo / ContentStore 解正文时（顺序钉死，directory 须显式分支，不得靠「双 NULL 碰巧」）：

1. `status === 'deleted'`（revision）→ 对上层视为无正文（`null` / 不暴露伪字符串）；**禁止** `String(null)` → `"null"`。
2. **`entry_kind === 'directory'`（entry）→ 不解 ContentStore**；不对调用方泄漏 SQL `NULL` 或伪串 `"null"`。domain / `VfsService.read` 对目录仍走 `IS_DIRECTORY`；若下层必须带 `content` 字段，目录侧用 `""` 或不暴露该字段——**禁止** `String(row.content)` / `String(null)`。
3. `content_hash` 非空 → `ContentStore.get(hash)` 得 UTF-8 string。
4. `content_hash` 为空且 `content` 非空 → 仅迁移窗口 / 遗留行：读旧明文（bootstrap 完成前）；迁移完成后 active 文件不应长期停留此态。
5. 二者皆 `NULL` 且非 deleted、**非 directory** → 视为损坏/不一致，按实现约定抛错或记日志；**仍禁止**把 SQL `NULL` 经 `String(...)` 变成 `"null"` 交给调用方。
6. `VfsService.read` 对文件仍返回完整 `string`；对目录仍 `IS_DIRECTORY`，不把 `NULL` content 泄漏成 `"null"`。

### 同文短路（write）

在 `writeWithRevision`（更新已有 file 分支）：

1. 若 `versionCheck` 且 `expectedVersion` 过期 → 仍 `CONFLICT`（短路不得绕过乐观锁）
2. 解出 live 明文后与写入正文比较：全等 → **不** `update`、**不** `append`，返回 `{ version: 当前 head }`
3. 异文 → `ContentStore.put` → entry 只写 `content_hash`（`content=NULL`）+ bump head → revision append（只存 `content_hash`，`content=NULL`）

新建文件：put + insert + append（首版）；同样只落 hash。

### 失败补偿（方案 B）

#### 接线矩阵（钉死）

现状：`restoreMutatingPathHeads(vfs, snapshots, paths)` **只持 `VfsService`**；`user-vfs-turn` 失败路径同样只拿到 session 的 `vfs`。

**本迭代选定接线：**

1. 在 **`VfsService` 端口**增加补偿专用方法（由 `RevisionAwareVfsService` 实现，底层走 entry/revision repo + ContentStore）：
   - `resetHeadToVersion(path, version)`：语义见下方「`resetHeadToVersion` 合同」；**不** append 新 revision 行。
   - `hardDelete(path, options?)`：物理删除 entry（及约定子树），**不** append `status='deleted'` 墓碑 revision。
2. **装饰 / 默认实现接线（钉死）**：
   - `ScopedVfsService`：对 `resetHeadToVersion` / `hardDelete` 做**逻辑路径 → 物理路径**转发（与现有 write/read/delete 同一套 scope 映射），再调底层 vfs；T-FR* / T-FR-D* **用 `sessionVfs`（Scoped）** 跑，禁止只测未加 scope 的裸 RevisionAware。
   - `DefaultVfsService`（无 revision 层）：`resetHeadToVersion` → **throw / unsupported**（补偿合同依赖 revision，不得静默 no-op）；`hardDelete` **可等同**现有物理 `delete`（无墓碑可 append 时与硬删一致即可）。
3. `restoreMutatingPathHeads` **继续只注入 `VfsService`**，改为调用上述原语，**禁止**默认走 `vfs.write` / 常规会注水的 `vfs.delete`（常规 delete 若会 append 墓碑则补偿不得用它）。
4. **不**把 restore 改成直接注入 Sqlite repo（避免 user-vfs-turn / 测试夹具双套装配）；repo 能力收敛在 RevisionAware 实现内部。
5. 调用链：

```text
user-vfs-turn 失败
  → restoreMutatingPathHeads(vfs, snapshots, paths)
       → present:   vfs.resetHeadToVersion(path, snapshot.version)
       → absent:    vfs.hardDelete(path, { recursive: true })
       → directory: 见下表
  → sweepSessionRevisions(session…)  // revision 打扫 only；blob 经 runDeferredBlobGc
```

**restore 部分失败与 sweep+gc（钉死）**：`restoreMutatingPathHeads` 允许对多 path 收集错误并抛 **composite error**；无论是否抛出、是否部分 path 失败，user-vfs-turn 在 **restore 尝试结束后**仍须执行 **一次** revision 打扫（`sweepSessionRevisions`）；blob 回收经 **`runDeferredBlobGc`**（同一 collect+gc 算法）。禁止「composite 就跳过清理」。

#### `resetHeadToVersion(path, version)` 合同（钉死）

`present` 补偿与 `directory` 快照内文件拨回 **共用**本合同；禁止 present 走 `vfs.write` 升版「碰巧 insert 重建」。

前置：读取目标 `(path, version)` 的 revision 行。

| 条件 | 行为 |
|------|------|
| revision **缺失**，或 revision `status='deleted'` | **明确抛错**（不可拨回）；不得静默跳过、不得改走 write |
| live **entry 存在** | **不** bump version、**不** append revision；把 entry 的 `content_hash` / `version` / `head_version` / `mtime`（及约定字段）拨回该 revision 对应值；`content=NULL`；经 entry 的 **不 bump set-head API**（见下），**禁止**复用会升版的 `update` |
| live **entry 不存在** | 先确保父目录存在；再按该 revision 的 `content_hash`（及 `mtime` 等）**重建** live 文件行（等价 `insertAtVersion` + hash，`content=NULL`）；目标 version = 该 revision.version；**仍禁止** `vfs.write` / 常规 insert 升版注水 |

底层依赖：entry port 必须提供 **不 bump 的 set-head API**（名称实现自定，语义钉死）：
- entry 已存在 → 按指定 version/hash/mtime 写回 head，**不** `version+1`；
- entry 不存在 → `insertAtVersion`（或等价）写入指定 version + `content_hash`（`content=NULL`）；
- **禁止**补偿路径复用会 bump 的 `update` / 常规 `write` 路径。

#### 快照行为

| snapshot | 行为 |
|----------|------|
| `present` | `resetHeadToVersion(path, snapshot.version)`（含「entry 已删则按 revision 重建」）；**不** append；snapshot.`content` 为 capture 遗留，补偿只用 version |
| `absent` | `hardDelete(path, { recursive: true })`；**不** append deleted 墓碑 |
| `directory` | 见下方 directory 规则 |

**分叉保留：** message 回滚的 `restorePathToRevision` 仍可通过 `vfs.write` 升出新 live head（产品允许 live ≠ 锚点 version）；同文则吃短路。测例须写清「补偿 ≠ message 回滚」。

#### directory 补偿规则（钉死）

对 `kind === 'directory'` 的 snapshot（根路径记为 `D`，`files` 为快照时递归列出的文件列表）：

1. **快照外新文件硬删**：补偿时列出 `D` 下当前所有文件；凡路径不在 `snapshot.files` 集合内的，对该文件 `hardDelete`（不注水墓碑）。快照后新建、或批次中多出来的文件一律清掉。**list 遇 `NOT_FOUND` ≡ 无快照外文件**（当作空列表，继续拨回快照内）。
2. **快照内文件拨回**：对 `snapshot.files` 每一项调用 `resetHeadToVersion(file.path, file.version)`，**完整遵守**上方 `resetHeadToVersion` 合同（含 entry 已删则重建 live 行）；**仍不** `write` 升版。snapshot 上的 **`content` 字段为 capture 遗留**，补偿**只用 `version`**（经 `resetHeadToVersion`），不得再靠快照明文 `write`。
3. **空目录（`files.length === 0`）**：硬清 `D` 下残留文件/子树后，确保目录存在（`mkdir` / `insertDirectory` 或保留 directory 行）；**不**对虚空路径循环 write。
4. **禁止**：对每个子文件 `vfs.write(content)` 升出版本；禁止「整树 delete 再 write 重建」作为默认实现（那会注水 revision）。

> 实现注：若当前树已乱到难以逐文件 reset，允许「先 hardDelete 快照外路径 + 对快照内 path reset」的组合；仍禁止 write 注水。

### Revision GC + blob GC

1. 现有 `sweepSessionRevisions` 删除不可达 `(path,version)` 行（session 范围）
2. **全库**收集仍被 `vfs_entry` ∪ `vfs_revision` 引用的非空 `content_hash`
3. `ContentStore.gc` 删除无引用 blob

**算法唯一入口（钉死）**：步骤 2–3 的 collect+gc **只**此一套实现，封装为 **`runDeferredBlobGc`**（`message-rollback-execution-redesign` 已落地）。`sweepSessionRevisions` **不再**末尾同步 blob gc；user-vfs 补偿末尾、message 删除、truncate-tail、session 删等路径在 revision 打扫后**可选**调度 `runDeferredBlobGc`。不旁路第二次手写 gc。

触发点：既有 message delete / truncateTail（`sweepRevisions: true`）之外，**加上** user vfs 失败补偿末尾（restore 尝试结束后，**不论**是否 composite error）。两处均须遵守「全库引用集」合同。

### 迁移

- 新 migration：`vfs-content-blob-zlib-v1`（stem=`id`），登记 `SCHEMA_MIGRATIONS`
- 同步更新 canonical `vfs-schema.ts` / `vfs-revision-schema.ts` + blob DDL（`vfs_entry.content` 改为 `TEXT NULL`）
- **`up()`（schema 阶段，bootstrap 事务内）**：
  1. 建 `vfs_content_blob`
  2. **旧库 `vfs_entry` table rebuild**（去掉 `content NOT NULL`，加入 `content_hash`）
  3. `vfs_revision` ADD `content_hash`（或等价）
  4. **mark migration applied**（schema 就绪即可启动；**不**在事务内扫全库明文）
  5. 新库路径 B：DDL 已完整且无待迁明文 → no-op（仍 mark applied）
- **明文 data migrate（bootstrap 事务外，`runVfsContentBlobDataMigration`）**：
  - 扫仍有明文的 entry/revision（`content IS NOT NULL`）→ `put` → 写 `content_hash` → **`content=NULL`**
  - **RN 工程折中**：Hermes 上长事务 + 大批量 BLOB 写入曾触发闪退，故 data migrate **拆到事务外**，每批 1 行 + yield，可跨多次 boot 重入续迁
  - 目录行：确保 `content`/`content_hash` 均为 `NULL`
  - 可重入：已有 hash 且 content 已 NULL 则跳过
  - **中间态读路径**：schema 已 mark applied、明文尚未迁完时，靠 `resolve-stored-content` 读遗留 `content` 列（行为可接受）
- **禁止**只靠 `alignSchemaColumns` 完成「去掉 NOT NULL」
- 极大库首次打开 / 升级可能分多次 boot 完成 data migrate；耗时写入发布说明

### 旁路写路径（钉死）

凡会落 `vfs_entry` / `vfs_revision` 正文真源的路径，统一：

| 路径 | 要求 |
|------|------|
| `writeWithRevision` / 常规 write | `put` → 只写 `content_hash`；`content=NULL` |
| seed-fork | 目标 session 行复用源侧同一 `content_hash`（**共享同一 blob 行**）；禁止再 put 一份明文副本，禁止把明文写入 `content` |
| backfill | 同上：只落 hash；已有 blob 则复用 |
| `vfs-tree-copy` / `replaceVfsSubtree` | 经 ContentStore：拷贝时复制 `content_hash`（或 put 同源明文一次）；live **禁止**继续 `insert/update` 明文真源 |
| `vfs-batch-io` | 同上 |
| `insertDirectory` / mkdir 落库 | **`content=NULL` 且 `content_hash=NULL`**（禁止现网式 `''`）；不 put blob |
| 凡 `insert` / `update` 文件行 | **只落 `content_hash`**，`content=NULL`；禁止再写明文真源 |

ZIP 导出继续吃 `scanContents`（或等价）解出的 UTF-8 string；解出逻辑遵守「NULL content 读路径」。

## 最终项目结构

```text
packages/core/src/
  domain/vfs/content-store/
    vfs-content-store.port.ts
    impl/sqlite-vfs-content-store.ts
    logic/hash-content.ts          # @noble/hashes/sha256 → hex
    logic/zlib-codec.ts            # fflate zlibSync/unzlibSync；Node encoding='zlib'，RN 经 blob-bytes-codec 落 zlib-b64
  bootstrap/vfs/
    vfs-content-blob-schema.ts     # 或并入 vfs-schema
    vfs-schema.ts                  # content TEXT NULL + content_hash
    vfs-revision-schema.ts         # + content_hash（content 保持可空）
  bootstrap/schema-migrations/
    vfs-content-blob-zlib-v1.ts    # 含 vfs_entry rebuild
    index.ts                       # 登记
  service/vfs/impl/revision-aware-vfs.service.ts  # + resetHeadToVersion / hardDelete
  service/vfs/impl/scoped-vfs.service.ts          # 逻辑→物理转发 resetHead/hardDelete
  service/vfs/impl/default-vfs.service.ts         # resetHead throw；hardDelete≈delete
  domain/vfs/ports/vfs-service.port.ts            # 补偿原语进端口
  domain/vfs/ports/...entry...                    # 不 bump 的 set-head（含 insertAtVersion+hash）
  domain/vfs/logic/restore-mutating-path-heads.ts
  domain/vfs/repositories/...
  domain/message-checkpoint/logic/revision-gc.ts  # sweepSessionRevisions revision-only；blob 经 runDeferredBlobGc
  service/chat/impl/user-vfs-turn.service.ts      # restore 后不论 composite 仍 sweep 一次；loadRevisionContent 不靠 NULL??""
  domain/message-checkpoint/logic/restore-path.ts # 吃 repo 已解出的明文；禁止 rev.content ?? "" 把 NULL 当空串
```

apps/desktop、apps/mobile、apps/cli：**常规读写预期零改**；补偿原语仅内部/测试使用，不要求 UI 直调。

## 变更点清单

| 模块 | 变更 |
|------|------|
| ContentStore 新建 | put/get/gc + zlib 封装 + `@noble/hashes` sha256；gc 引用集全库 |
| schema + migration | blob 表；`vfs_entry.content` 改可空（rebuild）；`content_hash`；明文回填后 `NULL` |
| entry/revision repo | 经 store 解/写；禁止 `String(BLOB)` / `String(null)`；读路径显式 directory 分支；形状见「SQL 列 vs 读出 DTO vs 写入 API」 |
| `SqliteVfsRevisionRepository.find*` | **必须**按 NULL 读路径解出明文 `content: string`（active 文件走 `ContentStore.get`）；禁止把 SQL `NULL` 原样塞进 DTO 再靠调用方 `?? ""` |
| `restore-path.ts` / `user-vfs-turn` `loadRevisionContent` | **不得**再靠 `rev.content ?? ""` 把未解出的 NULL 当空串；repo 已解出后自然安全，或改走 `ContentStore.get` / 读服务 |
| entry port | **不 bump 的 set-head API**（存在则拨回 hash/version/mtime；无行则 `insertAtVersion`+hash）；**禁止**补偿复用会升版的 `update` |
| `insertDirectory` | 落库 **`content=NULL`、`content_hash=NULL`**（替换现网 `''`） |
| 凡 insert/update/append 文件 | **只落 `content_hash`**，`content=NULL`；append/seed-fork 禁止明文列当真源 |
| VfsService 端口 | `resetHeadToVersion` / `hardDelete`（不 append revision；合同见上） |
| ScopedVfsService | 逻辑→物理转发 `resetHeadToVersion` / `hardDelete` |
| DefaultVfsService | 无 revision：`resetHeadToVersion` throw/unsupported；`hardDelete` 可等同 `delete` |
| RevisionAware write | 同文短路；异文只存 hash；`resetHead` 走 set-head 原语 |
| restoreMutatingPathHeads | 改调补偿原语；directory 快照外硬删 + reset（list `NOT_FOUND`≡无外文件）；禁 write 注水；snapshot `content` 仅 capture 遗留 |
| user-vfs-turn | restore 尝试结束后 **不论 composite error** 仍做一次 revision 打扫；blob gc 经 **`runDeferredBlobGc`**（collect+gc 算法唯一入口） |
| revision-gc / sweep | `sweepSessionRevisions` revision-only；blob 经 `runDeferredBlobGc`（见 `message-rollback-execution-redesign`） |
| seed-fork / backfill / tree-copy / batch | 只落 `content_hash`；fork 共享同一 blob |
| 测试 | 见下；T-FR* 用 `sessionVfs`；补偿 sweep 测例 **T-UO-SWEEP1**（扩展现有 T1，勿与 attachment 的 T-UO1 撞名） |

## 详细实现步骤

- Step 1 — phase-content-store — blocking: yes — qa: auto：落地 `VfsContentStore`（put/get/gc）+ `zlib-codec`（fflate）+ `@noble/hashes` SHA-256；单测 T-CS1/T-CS2；gc 测须覆盖「他 session 引用不可误删」
- Step 2 — phase-schema-migrate — blocking: yes — qa: auto：DDL（content 可空）+ `vfs-content-blob-zlib-v1` rebuild + 可重入；T-MG1
- Step 3 — phase-repo-wire — blocking: yes — qa: auto：entry/revision repo 读写走 ContentStore；NULL 读路径（含 directory 显式分支）；`find*` 解出明文；entry **set-head** 不 bump API；`insertDirectory` 双 NULL；凡 insert/update/append 文件只落 hash；`scanContents`/`findByPath` 对文件仍返回明文 string；点名修 `restore-path.ts` / `loadRevisionContent` 的 `?? ""`；T-NULL-DIR
- Step 4 — phase-same-content-shortcircuit — blocking: yes — qa: auto：`writeWithRevision` 同文短路；T-SC1/SC2/SC3（含乐观锁仍 CONFLICT）
- Step 5 — phase-fail-restore-b — blocking: yes — qa: auto：`resetHeadToVersion`/`hardDelete` 挂上 VfsService + Scoped 转发 + Default throw；改 `restoreMutatingPathHeads`；T-FR1/FR2/FR3 + T-FR-D*（均经 `sessionVfs`）
- Step 6 — phase-compensate-sweep — blocking: yes — qa: auto：user-vfs restore 结束后不论 composite 仍 `sweepSessionRevisions` 一次；blob 经 **`runDeferredBlobGc`**；**扩展现有 user-vfs T1** → 测例 **T-UO-SWEEP1**（勿复用 attachment 的 T-UO1 名）
- Step 7 — phase-gc-blob — blocking: yes — qa: auto：落地 **`runDeferredBlobGc`**（collect+gc 唯一入口）；接线 message.service / truncate-tail / session 删；T-GC1/T-GC2 挂 deferred 入口
- Step 8 — phase-callers — blocking: yes — qa: auto：seed-fork / backfill / tree-copy / batch 只落 hash、fork 共享 blob；fork-copy-parity 仍断言可读 content
- Step 9 — phase-regression — blocking: yes — qa: auto：ZIP、grep、rollback R1/R8、capture 指针回归；T-IO1/T-RB1
- Step 10 — phase-manual-sample — blocking: no — qa: manual_user：用样例大库升级后看体积下降 + 抽样回滚（合并后用户执行）

## 测试策略

主战场 `packages/core/test`（`node:test` + `novelMasterTestFixture`）。desktop/mobile 不为 blob 加端测。

### 测试用例

- T-CS1 — blocking: yes — ContentStore：相同明文 → 相同 hash，blob 表仅一行
- T-CS2 — blocking: yes — put/get 往返（空串、中文、较长正文）；Node 侧 `encoding='zlib'`；RN 侧可读 `zlib-b64`；`byte_len` = 存储字节长度
- T-MG1 — blocking: yes — 旧 TEXT NOT NULL fixture 经 rebuild 后 `content` 可空；迁移后可读；二次 bootstrap 可重入；`content` 列为 NULL 后读仍明文；目录行 content/hash 皆 NULL
- T-SC1 — blocking: yes — 同文 write 两次：version 与 revision 行数不变
- T-SC2 — blocking: yes — 异文 write：version+1，两版可共享不同/相同 blob（按正文）；entry/revision 的 `content` 为 NULL
- T-SC3 — blocking: yes — `expectedVersion` 过期仍 CONFLICT（短路不绕过）
- T-NULL-DIR — blocking: yes — `insertDirectory` 后目录行 `content`/`content_hash` 皆 SQL `NULL`；读路径不解 ContentStore、不向调用方泄漏 `"null"`；负向断言禁止 `String(null)` / `String(row.content)` 产出伪串（可用 repo 层或扫描断言）
- T-FR1 — blocking: yes — present 补偿后 live 回到快照 version/正文，revision 行不因补偿净增「写回」版（经 `sessionVfs`）
- T-FR2 — blocking: yes — absent 补偿硬删，不注水 deleted 墓碑行（经 `sessionVfs`）
- T-FR3 — blocking: yes — **Given** present 快照文件在批次中被删掉（live entry 已不存在）但目标 revision 仍在，**When** `resetHeadToVersion` / present 补偿，**Then** 父目录就绪后按该 revision 的 `content_hash`/mtime 重建 live 行，version 回到快照值，**不** bump、**不** append 新 revision；可读正文与快照一致
- T-FR-D1 — blocking: yes — **Given** directory 快照含 `/d/a.md`，批次中新建 `/d/b.md`，**When** directory 补偿，**Then** `/d/b.md` 被 hardDelete 消失，`/d/a.md` 回到快照 version/正文且无写回注水 revision（经 `sessionVfs`）
- T-FR-D2 — blocking: yes — **Given** 空目录快照（`files.length===0`），批次中写入 `/empty/x.md`，**When** 补偿，**Then** `/empty/x.md` 不存在，空目录仍可 list
- T-FR-D3 — blocking: yes — **Given** directory 快照两文件，批次中改写其一并删除另一，**When** 补偿，**Then** 两文件均回到快照 version/正文（删掉的那份按 resetHead 重建），无额外写回 version
- T-FR-D4 — blocking: yes — **Given** directory 快照，批次中在快照外路径 `/d/sub/new.md` 新建，**When** 补偿，**Then** 该新文件硬删；快照内文件 head 不因补偿 bump
- T-GC1 — blocking: yes — 不可达 revision 删除后，无引用 blob 被 gc（经唯一入口）
- T-GC2 — blocking: yes — session A sweep 后 gc：**不得**删除仍被 session B 的 entry/revision 引用的 blob
- T-UO-SWEEP1 — blocking: yes — **扩展**现有 user-vfs-turn **T1**（失败回滚）：失败回滚后 revision 断言 + deferred blob gc 可回收 orphan。**禁止**再用 `T-UO1` 命名（与 `message-attachment-unified` 的 T-UO1 撞名）
- T-IO1 — blocking: yes — ZIP 导出仍为明文文件内容（读路径不出现 `"null"` 伪串）
- T-RB1 — blocking: yes — message rollback 语义保持（可升 live head；同文吃短路）
- T-FK1 — blocking: yes — fork-copy-parity：目标 session revision 可读；源/目标共享同一 `content_hash`/blob 行，不靠明文 backfill 堆第二份

映射：T-CS*→Step1；T-MG1→Step2；T-NULL-DIR→Step3；T-SC*→Step4；T-FR*/T-FR-D*→Step5；T-UO-SWEEP1→Step6；T-GC*→Step7；T-FK1→Step8；T-IO1/T-RB1→Step9。

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 大库迁移阻塞开库 | schema 事务内 mark applied；明文 data migrate 事务外分批 + yield，可跨 boot 重入；失败 schema 阶段则事务回滚不 mark |
| 旧库 `content NOT NULL` | migration 强制 table rebuild，与 canonical `TEXT NULL` 对齐 |
| RN BLOB 绑定 | 沿用 tight ArrayBuffer；conformance C4 + ContentStore 测 |
| 误用 `String(BLOB)` / `String(null)` | repo 层显式 Uint8Array / NULL / directory 分支；T-NULL-DIR 负向测 |
| session 局部 keepSet 误删他 session blob | SPEC 钉死全库引用集 + blob GC 唯一入口；T-GC2 |
| 补偿误删仍被 checkpoint 钉住的 version | 必须复用 `revisionReachableKey` 可达集，禁止「>snapshot.version 全删」 |
| present 补偿在 entry 已删时靠 write 重建注水 | `resetHeadToVersion` 合同 + set-head API；T-FR3 |
| restore composite 后跳过 sweep | 钉死「尝试结束后仍做一次」；T-UO-SWEEP1 |
| 算法文档漂移 | 本 SPEC 与 PRD 统一为 **zlib**；草稿 zstd 作废 |
| 回滚方案 | 未发布前可丢弃 migration；已发布库靠备份 `.nmbackup` 回退；不提供「解压回 TEXT 真源」的自动降级 |

## 禁止事项

1. 不做 git delta / pack / isomorphic-git
2. blob 不落库外；不用 `storage_kind=external` 冒充 content blob
3. checkpoint 不改存 blob id
4. 失败补偿禁止仅靠「再 vfs.write + 事后 sweep」交差；禁止补偿复用会 bump 的 entry `update`
5. apps 禁止直写 `vfs_revision` SQL
6. 禁止以 `node:zlib` 或 RN native zlib 作为唯一压缩实现（用 fflate zlib 封装）
7. 迁移后禁止长期双写明文真源；禁止用空串代替 `NULL`（含 `insertDirectory`）
8. 同文短路不得绕过乐观锁
9. ZIP deflate 与 ContentStore zlib 模块边界分离
10. 本迭代不把 message 回滚改成「只拨指针」
11. 禁止以 `node:crypto` 作为 SHA-256 唯一实现
12. 禁止 session 局部 keepSet 驱动的「删除 keepSet 外全部 blob」
13. 禁止旁路 collect+gc **算法**另开第三套全库/局部 gc。**触发**须经 `runDeferredBlobGc`（`collectAllReferencedHashes` + `ContentStore.gc`）；`sweepSessionRevisions` 末尾**不再**同步 blob gc
14. 禁止对 directory 行走 ContentStore.get，或把目录 `NULL` content `String(...)` 成 `"null"`
15. 禁止 `restore-path` / `loadRevisionContent` 用 `rev.content ?? ""` 把未解出的 SQL `NULL` 当空串
