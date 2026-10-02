---
zone: core-vfs
agent: domain-survey
files_scanned: 57
scope: packages/core/src/domain/vfs/
head_sha: 以 git log -1 为准（本报告只读，未做任何 git 写）
---

## 摘要

VFS（虚拟文件系统）领域层：项目内所有「文件」的真源。逻辑路径树 + 内容寻址存储
（`vfs_entry` 当前 head / `vfs_revision` 版本链 / `vfs_content_blob` zlib blob）三张表，
外加 scope 键（global / project / session + 两个 meta 域）、路径映射、tree-copy /
move / rename / 恢复补偿、ZIP 导入导出、replace 定位与 LCS 诊断。共 57 文件、约 7.5k 行。
本区不含并发控制（乐观锁已按用户 2026-09-06 拍板全拆，见 RULE「VFS write/edit/skill 工具的并发语义」），
并发盲区一律按 intentional 处理，不计入发现。

## 职责与边界

- **持有**：`vfs_entry` / `vfs_revision` / `vfs_content_blob` 三表的全部 SQL
  （`repositories/impl/sqlite-vfs-entry.repository.ts` 984 行、
  `sqlite-vfs-revision.repository.ts` 650 行为最大两个文件）。
- **持有**：逻辑路径 ↔ scope_key ↔ 物理挂载前缀的映射与反解
  （`logic/vfs-path-mapper.ts`、`logic/infer-scope-from-path.ts`）。
- **持有**：纯函数层的业务规则——replace 定位归一化（`normalize-for-match.ts`）、
  LCS 诊断（`longest-common-substring.ts` / `compute-replace-not-found-error.ts`）、
  树拷贝与前缀清扫（`vfs-tree-copy.ts` / `revision-ref-count.ts`）、
  move/copy 组合（`vfs-move.ts` / `vfs-copy.ts`）、
  ZIP 解析与校验（`vfs-zip-*.ts` 6 个文件）、用户保存映射（`user-vfs-save-mapping.ts`）。
- **不持有**：事务边界、checkpoint 指针、workplace 规则、工具层限流——全在
  `service/vfs/`、`service/message-checkpoint/`、`domain/tool/`、`domain/workplace/`。
  本区所有函数都假设调用方已开事务或已接受无锁语义。

## 对外接口

- **ports**（domain 契约，service 层实现）：
  `VfsService`（`ports/vfs-service.port.ts`，read/write/replace/list/mkdir/delete/
  glob/grep/findContentSize/resetHeadToVersion/hardDelete/renamePath/renamePrefix）、
  `VfsRestorePort`、`VfsContentStore`、`VfsBatchIoService`、`VfsZipIoService`、
  `CharacterCardImportService`。
- **repositories**：`VfsEntryRepository`（321 行，31 方法）、
  `VfsRevisionRepository`（227 行，22 方法）。
- **公开导出面**（`packages/core/src/public/vfs.ts`）：把 `moveVfsPath` / `copyVfsPath` /
  `replaceVfsSubtree` / `mapUserSaveToToolUses` / `actionXmlToToolUses` /
  `toPhysicalPath` / `toLogicalPath` 等 20+ 个符号直接抛给 apps 层。

## 数据访问

| 表 / 存储 | 触点 | 证据 |
|---|---|---|
| `vfs_entry` | 点查 / 前缀扫描 / 插入 / 更新 / 批量删 / rename / 签名 | `sqlite-vfs-entry.repository.ts:79,127,287,319,391,494,506,636,912,935` |
| `vfs_revision` | append / ref_count ±1 / 批量 floor / 前缀 GC / 全局孤儿清扫 | `sqlite-vfs-revision.repository.ts:285,372,438,538,604,55` |
| `vfs_content_blob` | put / get / getMany / ensureBlob / gc | `sqlite-vfs-content-store.ts:52,94,145,194,213` |
| `vfs_entry.content`（遗留明文列） | 只读兜底，新写路径恒置 NULL | `resolve-stored-content.ts:54`；`sqlite-vfs-entry.repository.ts:287,306,320` |
| `sqlite_sequence` | 发号器修复（写系统表） | `entry-sequence-repair.ts:77-84` |
| `message_checkpoint_file`（读） | repairRefCounts 算期望 ref | `revision-ref-count.ts:113` |
| `workplace_dir_rule` | 不在本区（由 service 层 ensure-import-dir-rules 写） | — |

进程内缓存（非持久）：`infra/content-cache/logic/decoded-content-cache.ts`
内容正文池（键 = 明文 sha256，8M 字符 / 1024 条 LRU），本区 `get`/`getMany` 写入。

## 依赖关系

**import 谁**（跨区）：
`@/errors/vfs-errors`、`@/infra/tdbc/*`、`@/infra/sql-template`、
`@/infra/content-cache/logic/decoded-content-cache`、
`@/service/integrity-repair`（`IntegrityRepairOperation` 类型）、
`@/domain/message-checkpoint/repositories/message-checkpoint.port`（类型）、
`@/domain/tool/logic/fs-command-classify`（`extract-mutating-paths.ts`）、
`@/domain/character-card/model/character-card`（类型）、`fflate`、`diff`、`iconv-lite`、
`@noble/hashes`。

**被谁消费**（`git grep -l "domain/vfs/"`，生产侧 40+ 文件，重点）：
- `service/vfs/`：`impl/{vfs.service,revision-aware-vfs.service,scoped-vfs.service,physical-vfs.service,vfs-zip-io.service,vfs-batch-io.service,character-card-import.service}.ts`
- `service/message-checkpoint/logic/`：`revision-gc.ts`、`restore-path.ts`、
  `revive-deleted-entry.ts`、`detect-missing-revisions.ts`、`deferred-revision-orphan-gc.ts` 等 10 个
- `service/chat/impl/`：`session.service.ts:366`、`message.service.ts:334`、
  `project.service.ts:263,271`、`user-vfs-turn.service.ts`（快照/补偿）
- `service/skills/impl/skills.service.ts:551`（renamePrefix）、`service/template/logic/*`
- `domain/workplace/`、`domain/tool/builtin/vfs-tools.ts`、`domain/chat/logic/*`
- `public/vfs.ts` → apps（desktop/mobile 直接 import）

## 发现清单

### F-core-vfs-1 | P1 | `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:936`

```sql
SET path = REPLACE(path, #{oldWithSlash}, #{newWithSlash})
WHERE scope_key = #{scopeKey} AND path LIKE #{pattern} ESCAPE '\'
```

**描述**：目录前缀 rename 用 SQLite `REPLACE()` 做「前缀替换」，但 `REPLACE()` 替换的是
**字符串中所有出现**，不是仅前缀。当子路径里再次出现同名段时会被二次改写。
实测（better-sqlite3，tmp 探针已跑）：`/a`、`/a/sub`、`/a/sub/a`、`/a/sub/a/deep.md`、`/a/top.md`
执行 `renamePrefixInScope('/a' → '/b')` 后得到
`['/b', '/b/sub', '/b/sub/a', '/b/sub/b/deep.md', '/b/top.md']` —— `/a/sub/a/deep.md` 被改成
`/b/sub/b/deep.md`，路径静默损坏（entry_id / revision 仍指向它，后续 read 得到 NOT_FOUND）。
用户把 `/novel` 改名成 `/book`、而 `/novel` 下有 `/novel/novel/` 子目录，即命中。

**建议**：改用 `substr` 前缀拼接（`path = #{newWithSlash} || substr(path, length(#{oldWithSlash}) + 1)`），
不要依赖 REPLACE 的「全串替换」语义。补一条「子树含同名目录」的用例（现有
`test/vfs/vfs-rename-primitive.test.ts` T-V5 只覆盖 `%`/`_` 转义，未覆盖同名嵌套）。

**置信**：confirmed（本地 SQLite 实测复现）

### F-core-vfs-2 | P1 | `packages/core/src/domain/vfs/logic/compute-replace-result.ts:55-60`

```ts
let searchFrom = 0;
while (true) {
  const idx = normalizedContent.indexOf(normalizedOld, searchFrom);
  if (idx === -1) break;
  positions.push({ start: idx, end: idx + oldString.length });
  searchFrom = idx + normalizedOld.length;
}
```

**描述**：`replaceAll` 分支在 `oldString === ""` 时**死循环**。`"abc".indexOf("", 0) === 0`，
`searchFrom = 0 + 0 = 0` 永不推进。`positions` 数组同步无限增长 → 挂死 + OOM。
上游无任何拦截：`domain/tool/builtin/vfs-tools.ts:297` 的 `oldString: z.string()`（**无 `.min(1)`**，
对比同文件 `path: z.string().min(1)`），`service/skills/impl/skills.service.ts:392` 直传，
`vfs.service.ts:143` / `revision-aware-vfs.service.ts:107` 直调 `computeReplaceResult`。
即 LLM 一次 `edit(oldString: "", options: { replaceAll: true })` 就能把当前会话线程卡死。
（非 replaceAll 分支不挂死，但 `indexOf("")===0` 会把 `newString` 静默拼到全文头部，同样是错语义。）

**建议**：`computeReplaceResult` 入口加 `if (oldString.length === 0) throw vfsInvalidPath(...)`
或直接 `vfsReplaceNotFound`；同时给 `edit` 工具的 `oldString` 补 `.min(1)`（对齐 `path`）。

**置信**：confirmed（探针实测 `LOOPED FOREVER`，100001 次未退出）

### F-core-vfs-3 | P1 | `packages/core/src/domain/vfs/logic/longest-common-substring.ts:76`

```ts
const endInB = Math.min(...endsInB);
```

**描述**：两个叠加问题，都在 `edit` 未命中的诊断路径上（`compute-replace-not-found-error.ts:55`
对**全文**与 `oldString` 求 LCS）：

1. **栈溢出**：`endsInB` 收集所有达到 `maxLen` 的 `j`。当 `oldString` 是短重复串、
   文件里大量重复时（最典型：markdown 分隔线 `oldString="---"`、文件 15 万个 `-`），
   `endsInB` 长度 ≈ 文件长度。实测 5 万 OK / **15 万抛 `RangeError: Maximum call stack size exceeded`** /
   40 万同错。异常不是 `VfsError`，会穿透 `formatVfsErrorForLlm` 直接冒到工具层。
2. **内存爆炸**：全量 `number[][]` DP 矩阵，`(oldString.length+1) × (file.length+1)` 个格子。
   实测 `oldString=300 / file=300000` → heap 涨 **591MB**、耗时 534ms；
   `oldString=500 / file=1000000` → 3.8s。手机上直接 OOM 崩应用。

**建议**：`Math.min(...endsInB)` 换成循环求最小；DP 换成滚动两行（O(min) 空间）；
再加一条「`oldString` 或文件超过阈值时降级为「不做 LCS、只回基础诊断」的保护闸」
（参照 `character-card-limits.ts` 的闸门范式）。这是纯诊断信息，不值得为它拖垮进程。

**置信**：confirmed（探针实测 RangeError 与 591MB 堆增长）

### F-core-vfs-4 | P2 | `packages/core/src/domain/vfs/logic/vfs-tree-copy.ts:247-253`

```ts
const nextVersion = await nextUpdateVersion(
  repo, options?.revisions, toScope.scopeKey, f.targetPath, null
);
```

**描述**：`known` 传 `null` → `nextUpdateVersion` 内部 `repo.findByPath(scopeKey, path)`
（`vfs-tree-copy.ts:73`），而 `findByPath` 的 `rowToEntry` 会调
`resolveEntryPlainContent` **解出全文正文**（`sqlite-vfs-entry.repository.ts:968`），
仅为拿 `entryId` + `version`。目标 scope 已有同名文件时，每个文件付一次全量解压。
代码注释自己写了「tree-copy 到清空 scope 时不会走到」——但 `project.service.ts:263,271`
与模板 push 链路的目标 scope 并非总是空的。仓库里已有零解码的
`scanFileEntriesWithMeta`（`sqlite-vfs-entry.repository.ts:728`）可直接给 `entryId/headVersion`。

**建议**：快路径改用 `scanFileEntriesWithMeta(toScope.scopeKey, toPathPrefix)` 一次拿齐
entryId→headVersion，传给 `nextUpdateVersion` 当 `known`。

**置信**：suspected（调用链与解码路径确认，性能量级未在真机实测）

### F-core-vfs-5 | P2 | `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:685-726`

**描述**：`scanContents(scopeKey, prefix?)` 一次把 scope 下**全部文件正文**读进内存返回
`ReadonlyArray<{path, content}>`。消费方 `vfs.service.ts:184`（grep）、
`vfs-zip-io.service.ts:139`（ZIP 导出）、`vfs-tree-copy.ts:91`（回退路径）
都是「先全读再过滤」——grep 的 `pathGlob` 过滤发生在 SQL 之外
（`vfs.service.ts:185-187`），导出的 `directoryPath` 之外的文件也全进内存。
一个大工作区（几百 KB ~ 几 MB，RULE「常驻工作区」自述量级）单次 grep 会把整个 scope 正文驻留。

**建议**：grep / 导出链路改走 `scanFileEntriesWithMeta` 分页取 hash 再逐个
`contentStore.get`（配合已有的 decoded-content 池），或至少按 `pathGlob` 下推成 SQL 前缀过滤。

**置信**：confirmed（读码确认消费顺序）

### F-core-vfs-6 | P2 | `packages/core/src/domain/vfs/logic/user-vfs-save-mapping.ts:143-157`

```ts
const maxRadius = Math.max(baselineLines.length, savedLines.length);
for (let radius = 0; radius <= maxRadius; radius++) { ...
  const oldString = joinLines(baselineLines.slice(oldStart, oldEnd + 1));
  if (oldString === "" || countOccurrences(baseline, oldString) !== 1) continue;
```

**描述**：`expandAnchorHunk` 每轮对**全文**做一次 `countOccurrences`，且 slice/join 的
片段长度随 radius 线性增长 → 单个 hunk O(radius × filesize)，最坏 O(n²)。
实测（探针）：2k 行 16KB → 23ms；5k 行 40KB → 119ms；1 万行 80KB → **462ms**。
这是**用户点保存**的同步路径（mobile UI 线程），且 `mapUserSaveToToolUses` 会对每个
diff region 各调一次（`:213`），多 hunk 线性叠加。长章节（几万行）必然卡 UI。

**建议**：把「唯一性判定」改为对 baseline 做一次预索引（逐行 hash → 计数），
或先用整段（region ± 少量上下文）试探、只在失败时才逐步扩 radius；并给 radius 设上限
（超过 N 行直接判定 anchor-not-unique 走 write 兜底）。

**置信**：confirmed（探针实测三档耗时）

### F-core-vfs-7 | P2 | `packages/core/src/domain/vfs/logic/seed-live-head-revisions.ts:104-116`

```ts
const entry = await entryRepo.findByPath(scopeKey, logicalPath);
const entryId = entry?.entryId;
if (entryId != null) {
  const maxRevision = await revisionRepo.findMaxVersionForEntry(entryId);
  if (maxRevision != null) {
    await entryRepo.insertAtVersion(scopeKey, logicalPath, content, maxRevision + 1);
```

**描述**：`entryId != null` 意味着 `(scopeKey, logicalPath)` 上**已有 entry 行**，而
`insertAtVersion` 发的是裸 `INSERT INTO vfs_entry`（`sqlite-vfs-entry.repository.ts:306`），
`vfs_entry` 有 `UNIQUE(scope_key, path)`（`bootstrap/vfs/vfs-schema.ts:23`）→
必然 `UNIQUE constraint failed`。函数 doc 写的意图（「若路径上仍有历史 revision，
版本取 max+1」）在这里是**实现反了**：entry 还在时该做的是 `update`（改 head + 写新 revision），
不是 `insert`。当前两个调用方（`character-card-import.service.ts:151`、
`vfs-zip-io.service.ts:214`）都先 `releaseAndDeleteVfsPrefix` 把 entry 删干净了，
`findByPath` 恒返回 null → 走 else 的 `insert` 分支，所以这条分支今天是**死路径**，
但它承载的语义（版本接续）在任何「entry 未被删但需接续」的调用姿势下都会炸。

**建议**：要么删掉该分支并在 doc 写明「调用方必须先删干净 entry」，
要么改成 `updateWithContentHash` + `append`。

**置信**：confirmed（读码 + UNIQUE 约束确认；不可达性基于两个调用方当前顺序）

### F-core-vfs-8 | P2 | `packages/core/src/domain/vfs/logic/vfs-move.ts:122-128`

```ts
const entries = await vfs.list(normalizedTo, { recursive: false });
const hasDirRow = entries.some(
  (e) => e.kind === "directory" && normalizeDirPath(e.path) === normalizedTo
);
if (entries.length > 0 || hasDirRow) { throw vfsAlreadyExists(to); }
```

**描述**：`hasDirRow` 恒为 false。同文件 `:190-192` 的注释已经写明「list 只返回子项、
不含目录自身行，空目录下列表恒空」，`sqlite-vfs-entry.repository.ts:79` 的 SQL 也确实是
`path LIKE '<dir>/%'`（不含 `path = <dir>`）。所以目标是一个**空目录**时，
`entries.length === 0 && hasDirRow === false` → 检查放行，随后 `renamePrefixInScope`
把目标空目录的路径改写掉（用户无感知地被合并）。`hasDirRow` 是从早期语义遗留下来的死条件。

**建议**：删掉 `hasDirRow`，或改用一次 `findByPath(to)` 显式探测目录行存在。

**置信**：confirmed

### F-core-vfs-9 | P3 | `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:241-255`

```ts
`SELECT byte_len FROM vfs_content_blob WHERE content_hash = #{contentHash}`
```

**描述**：`SqliteVfsEntryRepository` 直接查 `vfs_content_blob` 表，绕过注入的
`VfsContentStore`（构造函数 `:58-63` 允许注入自定义 store）。换 content store 实现时
大小探测会与实际存储脱节。另注：RULE「体积/收益类实测结论」已记录 `byte_len` 存量
三态混杂（base64 文本长度 / 二进制长度 / 二进制长度−2），该列不能当精确字节数用——
`vfs-content-size.ts` 的 doc 已自陈「明文大小的下界」，这一点属 intentional，
但**跨层直查**本身不是。

**建议**：给 `VfsContentStore` 加 `byteSizeOf(hash)` 方法，走 port 不走表。

**置信**：confirmed

### F-core-vfs-10 | P3 | `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts:583-615`

```ts
const count = Number(before[0]?.n ?? 0);
...
return count;   // 返回的是 DELETE 之前的预计数，不是 result.changes
```

**描述**：`deleteUnreferencedUnderScope` 返回预扫描 COUNT 而非实际删除行数。
并发下（另一个事务同时删/插 revision）返回值会与真实删除量偏差；
`sweepSessionRevisions`（`revision-gc.ts:82`）把它直接加进返回值上报给上层。

**建议**：返回 `result.changes`。

**置信**：confirmed

### F-core-vfs-11 | P3 | `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts:356`

```ts
deleted += chunk.length;   // 累加「尝试删除数」而非实际 changes
```

**描述**：`deleteExceptReachable` 累加的是分块长度，不是 `executeTemplate` 的
`result.changes`。另外 `git grep` 显示该方法**生产侧已无消费方**
（`revision-gc.ts:7` 只在注释里提到它，Step 21 后 ref_count 路径恒为常态），
只剩 `test/message-checkpoint/rollback-reach-hash-batch.test.ts:230` 在用。

**建议**：返回真实 changes；或连同 port 一起退役（属 W3「迁移退役到期项」机位范围）。

**置信**：confirmed

### F-core-vfs-12 | P3 | `packages/core/src/domain/vfs/logic/infer-scope-from-path.ts:43`

**描述**：`inferScopeFromPhysicalPath` 是 entry_id 化之前的「物理路径反解 scope_key」
迁移专用函数（文件头注释自陈）。`git grep inferScopeFromPhysicalPath` 全仓仅命中定义处
与 `vfs-path-mapper.ts:187` 的一句注释，**零生产调用方、零测试**。

**建议**：随 W3「死路径狩猎」一并删除，避免后人误以为这是活的反解路径
（真正的反解现在由 `toLogicalPath` 承担）。

**置信**：confirmed

### F-core-vfs-13 | P3 | `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:882,887`

```ts
throw new Error(`vfs_content_blob 缺失: ${h}`);
throw new Error("vfs 正文损坏：active 文件 content 与 content_hash 均为 NULL");
```

**描述**：抛的是裸 `Error` 而非 `VfsError`。`formatVfsErrorForLlm`（`format-vfs-error-for-llm.ts:110`）
只认 `VfsError`，裸 Error 会走 `formatVfsErrorForUser` 的 `error instanceof Error → error.message`
兜底，把「blob 缺失」这种内部损坏文案直接抛给用户/LLM。

**建议**：包成 `new VfsError("NOT_FOUND", ...)` 或新增内部 code。

**置信**：confirmed

### F-core-vfs-14 | P3 | `packages/core/src/domain/vfs/logic/vfs-zip-validate.ts:55-60`

```ts
if (entryName.includes("..")) {
  throw vfsZipError("INVALID_PATH", `parent segment in ZIP entry: ${entryName}`);
}
```

**描述**：用**子串**判 `..` 而非路径段判。合法文件名 `第1..2章.md`、`a..b.txt`、
`..hidden.md` 一律被拒。这是保守闸门（宁可拒不可放行穿越），方向对但过宽。

**建议**：改成段级判定 `entryName.split("/").some((seg) => seg === "..")`。

**置信**：confirmed

### F-core-vfs-15 | P3 | `packages/core/src/domain/vfs/logic/vfs-zip-filename-decode.ts:23,25`

```ts
name = iconv.decode(Buffer.from(rawBytes), "gbk");
name = iconv.decode(Buffer.from(rawBytes), "cp437");
```

**描述**：core 领域层直接用 Node 全局 `Buffer`。mobile 侧靠 `apps/mobile/src/polyfills.ts:21`
的 `globalThis.Buffer = Buffer` 兜住——即**宿主必须先加载 polyfill**，
core 自身不保证。这是既有的跨端约定（不是缺陷），但 core 里另有一处
`blob-bytes-codec.ts:20` 用的是纯 JS `atob`，两处口径不一致，值得在 ARCHITECTURE 记一笔。

**建议**：与 `blob-bytes-codec` 统一走纯 JS base64 编解码，去掉 `Buffer` 依赖。

**置信**：confirmed

### F-core-vfs-16 | P3 | `packages/core/src/domain/vfs/logic/vfs-zip-parse.ts:41-56`

```ts
try { return parseVfsZipViaCentralDirectory(zipBytes); }
catch (centralDirError) { try { return parseVfsZipViaUnzipSync(zipBytes); } ... }
```

**描述**：中央目录严格解析失败时**静默降级**到 fflate `unzipSync`。降级路径跳过了
严格解析器的全部拒绝逻辑（ZIP64 marker、加密位、压缩方法白名单、STORE 长度校验）。
`validateVfsZipEntries` 的体积 / 条数 / 路径闸门仍会跑，所以不是裸奔，但对「结构异常」
的 ZIP 反而放得更松——与严格解析器的意图相反。

**建议**：降级路径至少保留方法白名单与体积闸，或把降级限制在明确的「fflate 已知边缘格式」白名单内。

**置信**：suspected

### F-core-vfs-17 | P3 | `packages/core/src/domain/vfs/logic/normalize-for-match.ts:50-56`

```ts
let result = "";
for (const ch of Array.from(input)) { result += QUOTE_MAP.get(ch) ?? ch; }
```

**描述**：逐码点字符串拼接，每次 `replace` / `replace` 路径都对**全文**跑一遍
（`compute-replace-result.ts:46-47` 两次调用）。虽然 v1 映射全是 1:1 单码点、
长度守恒（doc 已论证正确），但 `Array.from` + `+=` 在 Hermes 上是 O(n) 次 rope 拼接。
大文件 replace 的常态路径上白付这份成本。

**建议**：改成一次性 `input.replace(/[...'"]/g, (c) => QUOTE_MAP.get(c) ?? c)`，
或建一张 `RegExp` 字符类做单遍扫描。

**置信**：confirmed

### F-core-vfs-18 | P3 | `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts:369-375`

```sql
UPDATE vfs_revision SET ref_count = ref_count + #{delta} WHERE entry_id = ? AND version = ?
```

**描述**：`delta < 0` 时不校验 `ref_count` 是否已为 0。DDL 有
`CHECK (ref_count >= 0)`（`bootstrap/vfs/vfs-revision-schema.ts:23`），
重复 −1 会撞约束 → 抛 `SQLITE_CONSTRAINT` 裸 `TdbcError` 而非 `VfsError`。
`decrementLiveRefsUnderScope` / `hardDelete` 的递归分支都是「逐 head −1」
（`revision-aware-vfs.service.ts:234`），补偿路径重入时存在重复扣的可能。

**建议**：−1 时加 `AND ref_count > 0`，或捕获约束错误转成 `VfsError`。

**置信**：suspected（未构造出实际重复扣场景）

### F-core-vfs-19 | P3 | `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts:430`

```ts
const deltaLiteral = delta > 0 ? `+ ${delta}` : `${delta}`;
```

**描述**：把 `delta` 字面量拼进 SQL 字符串（其余参数都走绑定）。`delta` 类型是 `number`
且调用方传的都是正整数（`seed 场景一次性加 msgCount`），当前无注入面，
但这是全仓少见的字符串插值 SQL，且非整数 / `NaN` 会直接产生语法错误。

**建议**：SQL 用 `ref_count = ref_count + ?` 配合符号由调用方给绝对值。

**置信**：confirmed

### F-core-vfs-20 | P3 | `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:636-646`

```sql
SELECT count(*) AS entry_count, group_concat(s, char(31)) AS sig FROM (SELECT ... ORDER BY path)
```

**描述**：签名 = 全 scope 行的 `path:head_version:mtime_ms` 拼接，无长度上限。
大 scope 下单次调用要构造几百 KB ~ 几 MB 的字符串（`workplace.service.ts:316` 每次装配都调）。
另外 `group_concat` 的顺序依赖子查询 `ORDER BY`，SQLite 不保证聚合函数尊重子查询排序
（实测当前 better-sqlite3 版本稳定有序，但换 SQLite 版本 / op-sqlite 打包版本不保证）——
顺序不稳只会造成缓存假失效，不会误判相等，可接受。

**建议**：签名换成 `count(*) + sum(length) + max(mtime) + group_concat(head_version)`
之类的定长摘要，或对 group_concat 结果做 hash。

**置信**：suspected

### F-core-vfs-21 | P3 | `packages/core/src/domain/vfs/logic/strip-known-physical-prefixes.ts:11`

```ts
const GLOBAL_META_PREFIX = /\/meta(?=\/|$)/g;
```

**描述**：entry_id 化后 `vfsEntry.path` 已是逻辑路径，而 global-meta / project-meta 域的
逻辑路径**本身就以 `/meta` 开头**（`vfs-path-mapper.ts:110-120` 注释明确）。
剥前缀会把技能路径 `/meta/skills/foo` 显示成 `/skills/foo`。
当前只在 `formatVfsErrorForLlm` 的 default 分支与 `extractInvalidPathReason` 兜底里用
（已知 code 走 `vfsError.path` 不受影响），影响面小但语义已过期。

**建议**：随 entry_id 化的收尾清理掉这组「物理前缀」正则（`/template`、`/projects/...` 同样过期）。

**置信**：confirmed

### F-core-vfs-22 | P3 | `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:754-760,780-786`

```ts
entryId: r.entry_id,   // 未 Number() 归一
```

**描述**：`scanFileEntriesWithMeta` 的两个分支都直接透传 `r.entry_id` / `r.head_version` /
`r.mtimeMs`，而同文件其它所有方法（`:678-682`、`:678`、`Number(row.head_version)` 等）
一律 `Number(...)` 归一。当前 better-sqlite3 与 op-sqlite 的 row-mapper 都返回 number，
所以不出错，但契约不一致——任一驱动改成字符串返回就会静默把字符串塞进 `revisionPairKey`。

**建议**：统一 `Number()` 归一。

**置信**：confirmed

### F-core-vfs-23 | P3 | `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts:445`

**描述**：`repairRefCountFloor`（单条版）全仓无生产消费方——生产走
`batchRepairRefCountFloor`（`revision-ref-count.ts:136`），单条版只在
`integrity-repair.ts:24` 的注释与三个 rollback 测试的 stub 里出现。port 仍导出。

**建议**：与 `deleteExceptReachable` 一并列入 W3 退役清单。

**置信**：confirmed

### F-core-vfs-24 | P3 | `packages/core/src/domain/vfs/logic/seed-live-head-revisions.ts:45`

```ts
const needsSeed = heads.filter((h) => !existingKeys.has(`${h.entryId}:${h.headVersion}`));
```

**描述**：手写 `` `${entryId}:${version}` `` 键模板，而仓里已有单源
`revisionPairKey()`（`logic/revision-pair-key.ts:8`）。同文件 `:41` 的
`findExistingEntryVersionKeys` 返回的正是该函数生成的键。当前格式一致，
但这是「单源已存在却仍各写各的」典型漂移点。同类问题见 `revision-ref-count.ts:109,134`。

**建议**：改用 `revisionPairKey(h.entryId, h.headVersion)`。

**置信**：confirmed

## 争议与存疑

1. **F-3 的严重度取决于调用方是否已有文件尺寸闸门**。`edit` 工具读文件走
   `vfs.read` → `findByPath` → 全量解压，`vfs-tools.ts` 只对**输出**限流
   （`TOOL_OUTPUT_MAX_BYTES = 50KB`），对输入正文无闸。所以 300KB 文件 + 300 字符
   oldString 未命中这条路径在当前代码下**确实可达**。但我没有在真机上跑出实际崩溃，
   P1 是按「机制已实测复现 + 路径可达」定的，主代理若要降级请以真机复现为准。

2. **F-4 的实际触发频率未量化**。目标 scope 非空时（模板 push、project.service 的模板覆盖）
   才会走逐条 `findByPath` 解压。`session.service.ts:366` / `message.service.ts:334`
   的 fork/copy 目标是全新空 scope，走的是批量快路径，不触发。所以我给 P2 而非 P1。

3. **F-7「死路径」判定依赖调用方顺序**。我确认了两个调用方都先
   `releaseAndDeleteVfsPrefix`。若 W2 其它机位发现第三条 `insertFileSeedingRevision`
   调用姿势（不带前置删除），F-7 会立刻从 P2 升为 P1（`UNIQUE constraint failed` 直接中断导入事务）。

4. **`vfs_entry.content` 遗留明文列的去留**。DDL 保留（`vfs-schema.ts:7` 注释「§A：暂不删」），
   新写路径恒置 NULL，`resolve-stored-content.ts:54` 保留兜底分支。
   这是**有意保留的迁移期双形态**（对齐 RULE「消息正文压缩列」的明文行永远合法口径），
   **不计为缺陷**。但 `scanContents` 的 `resolveScanRows`（`:886-890`）对
   `content_hash IS NULL` 的行直接抛「正文损坏」，而 `rowToEntry` 走的是
   「content_hash → 遗留明文 → 抛错」三段式（`resolve-stored-content.ts:47-61`）。
   **两条读路径对同一形态的存量行判定不一致**：真有迁移期遗留行时，
   `read` 能读出来、`scanContents`（grep / ZIP 导出 / tree-copy 回退）会炸。
   我把它归到 F-5 一并观察，没单独立条——需要 W3 的「vfs 内容三形态」机位确认
   存量库是否真有 `content IS NOT NULL AND content_hash IS NULL` 的行才能定性。

5. **`isStorageRootParent`（`parent-dir.ts:27-39`）在 entry_id 化后是否已失效**。
   它匹配的是物理形态（`/template`、`/projects/{pid}/sessions/{sid}`），
   而 `vfs.service.ts:52,75` 与 `ensure-parent-dirs.ts:24` 传进来的是**逻辑路径**。
   逻辑路径永远不会等于这三个物理根 → 三个分支恒 false。
   看起来是死代码，但它同时被 `ensure-parent-dirs.ts` 用作「跳过补行的父链节点」，
   恒 false 意味着**每个父目录都会被尝试补行**——这恰好是 entry_id 化后想要的行为
   （逻辑路径下不存在虚拟 storage root）。所以结论是「旧语义残留、当前行为正确」，
   我按 intentional 处理、只在此处记录，不计发现。**请主代理在 L3 标注为待清理项。**

## intentional（依据 RULE / 代码注释，非缺陷，登记备查）

| 项 | 出处 |
|---|---|
| write/edit 无锁 last-write-wins、replace「读→改→写」非原子 | RULE「VFS write/edit/skill 工具的并发语义」（用户 2026-09-06 拍板，`60af90b` 拆乐观锁）；`compute-replace-result.ts:42` 注释 |
| pathTail 同路径串行化不覆盖 `a.md` vs `/a.md`、跨 runner 实例不生效 | RULE 同条（拍板接受的两处盲区） |
| `vfs_revision.ref_count`（应用层）与 `vfs_content_blob.ref_count`（触发器）双计数器并存 | `service/integrity-repair.ts:17-27`（T-SC5 裁决）；`bootstrap/vfs/vfs-revision-schema.ts:33-68` |
| `content_hash → 遗留明文 → 抛错` 三段式读路径 | `resolve-stored-content.ts:47-61`（对齐「明文行永远合法」口径） |
| `scanContents` 缺 blob 必抛，但 decoded-content 池热态可静默成功 | `decoded-content-cache.ts:26-29` 明确写了这是生产接受的取舍 |
| `vfs_entry.content` 列保留不删 | `bootstrap/vfs/vfs-schema.ts:6-7`（§A） |
| `computeEntrySignature` 不过滤 `entry_kind`（mkdir 空目录也须改签名） | `vfs-entry.port.ts:213-215` doc |
| `deleteRecursiveIfAny` 的「探测 → 删除」非原子 | `sqlite-vfs-entry.repository.ts:530-532` 注释已说明取舍 |
| `stripKnownPhysicalPrefixes` 保留（虽已过期，见 F-21） | 兜底脱敏用途，见 F-21 争议 |
| ZIP 构建用 STORE（level 0）不压缩 | `vfs-zip-build.ts:25`（移动端 deflate 阻塞 JS 的实测结论） |
