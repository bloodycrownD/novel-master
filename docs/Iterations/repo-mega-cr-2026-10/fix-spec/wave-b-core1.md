# Wave B · core1 分片 fix-spec（存储/运行时四条 + RT-01 + §6 两条复核）

> 分片：`wave-b-core1`｜撰写机位：`s-core-b1`｜基线：`fe79b781`（worktree `D:\Dev\nm-worktree\mcr`）
> 上游：`../ledger-v2.md` §2.2（core-runtime P1）/§2.4（core-storage P1）/§6 第 3、4 行/§8 + §8.1 终裁/§10 Wave B
> 纪律声明：本分片所有证据均**重新打开 `fe79b781` 工作树逐行核对**（台账行号有漂移处已在各条「行号修正」栏注明），未照抄台账。
> 只读承诺：本文件是本机位**唯一**被允许写入的文件；未做任何 git 写、未碰 `docs/apm/`、未改任何生产/测试代码。

---

## 目录与条目索引

| # | 条目 | 级别 | 簇 | 修法一句话 | PR 归组 |
|---|---|---|---|---|---|
| B1-1 | CS-01 `renamePrefixInScope` 子树同名目录被二次替换 | P1 | core-storage | `REPLACE()` → `substr` 定点拼接 + 补回归 | 独立 |
| B1-2 | N-P1-01 项目删除 revision 永久泄漏 | P1 | core-storage | 两处裸 `deleteVfsPrefix` → `sweepRevisionsUnderScope` | **与 B1-3 同 PR** |
| B1-3 | CS-04 `sweepRevisionsUnderScope` 的 GC 步是死语句 | P1 | core-storage | GC 挪到删 entry 之前 | **与 B1-2 同 PR** |
| B1-4 | RT-04 `definitionToDocument` persist 块同名塌缩 | P1 | core-runtime | 序列化前跑 `validateAgentPromptLayout` | 独立 |
| B1-5 | RT-08 模板拉取漏清 prompt 缓存 | P1 | core-runtime | 事务提交后调 `clearSessionPromptCaches` | 独立（**最该先落**） |
| B1-6 | RT-01 gemini 每 step 全可见正文拉回、无复用 | P1（§8.1 终裁） | core-runtime | 无压缩时复用本 step `visible`、压缩时重读一次 | 独立（**依赖 Wave A 的 RT-02**） |
| B1-7 | §6 #3 `composer-draft` 全有或全无 | **P2**（第三源复核推翻 P1 立论） | core-data | 逐条降级替代整对象判废 | 独立 |
| B1-8 | §6 #4 附件数组整体降级 | P1（**第二源复核成立**） | core-data | 逐条过滤替代整数组 `safeParse` | 独立 |

> 台账 §2.4 的 CS-04 与 §2.4 的 N-P1-01 合并为 B1-2 / B1-3 两条写在本分片（`SPEC.md` §2 已注明「CS-04 条目本体在此写全，与 N-P1-01 同 PR」）。
> §6 #3 / #4 由本机位做**第二源独立复核**（对照代码重推导，非读台账结论）。§6 #4 复核成立 → 按 P1 写全七要素，**不再挂待验证节**；§6 #3 复核后经**第三源复核**（`raw/sr1-core1-c.md`）推翻 P1 立论 → **降 P2**（vestigial 字段硬化），病症段已按可达性重写。

---

## B1-1 · CS-01 `renamePrefixInScope`：子树内含同名目录时路径被二次替换

**严重度 / 簇**：P1 / core-storage（VFS 路径原语）

### 病症

`renamePrefixInScope` 用 `REPLACE(path, oldWithSlash, newWithSlash)` 做子树前缀改写。`REPLACE` 替换的是**整串中出现的所有匹配**，而不是「仅前缀那一处」。于是当被改名的目录其子树内部**又出现一次同名目录**时，深层路径里的那一段也会被替换，产出磁盘上并不存在的路径——文件被静默搬到一个谁也没创建过的目录名下，正文仍在、内容不丢，但用户再也点不到它。

典型形态：把 `/a` 改名为 `/a_新`，而 `a` 子树里有 `a/sub/a/notes.md`，改完得到 `a_新/sub/a_新/notes.md`（期望是 `a_新/sub/a/notes.md`）。同理 `vfs-move.ts` 的移动、`skills.service.ts:561` 的技能改名都走这条原语，全量受影响。

### 证据

`packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:932-945`（`SqliteVfsEntryRepository.renamePrefixInScope`）：

```ts
932	    const result = await executeTemplate(
935	      `UPDATE vfs_entry
936	       SET path = REPLACE(path, #{oldWithSlash}, #{newWithSlash})
937	       WHERE scope_key = #{scopeKey}
938	         AND path LIKE #{pattern} ESCAPE '\\'`,
```

`WHERE` 子句把范围正确限制在 `oldBase/%` 子树内（这一半没问题），但 `SET` 表达式对**整串**做替换——`:936` 是唯一的病灶行。同一函数 `:947-953` 的根行 UPDATE 用的是 `path = #{newBase}` 定点赋值，**不受影响**，所以「根行对、子项错」正是本条的表现形态。

两种症状形态（由 `vfs_entry` 的 `UNIQUE(scope_key, path)`（`packages/core/src/bootstrap/vfs/vfs-schema.ts:23`）决定）：深层同名段被替换后撞上已存在的路径 ⇒ UNIQUE 冲突抛错；不撞 ⇒ 静默落到一个谁也没创建过的路径。本条用例取的是**第二种（静默错位）**，因为它更难被察觉。

`vfs_entry` 上没有任何 DELETE / UPDATE 触发器（全仓三条触发器都只挂 `vfs_revision`，见 `packages/core/src/bootstrap/vfs/vfs-revision-schema.ts:35/45/58`），所以 `:936` 这一条 UPDATE 除了路径本身不会产生别的副作用。

受害调用方（全仓 `renamePrefixInScope` 调用点，均经 `vfs-rename-primitive.ts:45` → `revision-aware-vfs.service.ts:278` → `scoped-vfs.service.ts:164`）：
- `packages/core/src/domain/vfs/logic/vfs-move.ts:156`（目录/文件移动）
- `packages/core/src/service/skills/impl/skills.service.ts:561`（技能改名）

既有回归 `packages/core/test/vfs/vfs-rename-primitive.test.ts:159`（`T-V5`）只覆盖 `%`/`_` 通配转义，**子树内没有同名目录**，因此这条一直测不出来。

### 修法（文件 · 函数级）

1. **改** `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts` 的 `renamePrefixInScope`，把 `:935-938` 的 SET 表达式换成「剥掉定长前缀、拼上新前缀」的定点写法：
   - `SET path = #{newWithSlash} || substr(path, length(#{oldWithSlash}) + 1)`
   - 绑定值不变（`oldWithSlash` / `newWithSlash` / `pattern` 三个已存在），只多一个 `oldWithSlash` 的重复引用，无需新增绑定。
   - 语义：`substr(path, length('旧前缀/') + 1)` 取出前缀之后的剩余部分（`x.md`、绝对路径根行的空串等），前面拼上新前缀。只动第一处匹配，与「前缀改写」的意图一致。
   - **不要**改成多次 `REPLACE` 或加 `replace(path, old, new, 1)` 之类的方言：`substr` 是三驱动都有的 SQLite 核心函数，而 4 参数 `REPLACE` 的可用性从未在本仓验证过。
   - **同款定点拼接在本仓已被跑过（不必再做可用性论证）**：`packages/core/src/domain/workplace/repositories/impl/sqlite-workplace.repository.ts:303` 与 `:311` 就是
     ```sql
     ELSE #{newBase} || substr(logical_path, length(#{oldBase}) + 1)
     ```
     同一 `SqlTemplateParser`、同一 better-sqlite3 驱动，且 workplace 仓储在 desktop/CLI 主链上。另 `packages/core/src/infra/sql-template/placeholder.ts:16-28` 显示每次 `#{x}` 出现都会 push 一个参数，故 `oldWithSlash` 在同一条 SQL 里被引用两次**无需新增绑定、也不会重复绑定**。
   - **边界已核对**：`oldBase = "/a"` ⇒ `substr(path, 4)` 取到 `sub/a/notes.md`，拼 `/a_新/` ⇒ `/a_新/sub/a/notes.md`，符合预期；`/a → /a/b` 与 `/a/b → /a` 两个方向换序前后等价。
2. **不要动** `:947-953` 的根行 UPDATE（已是定点赋值），也不要动 `WHERE ... LIKE #{pattern} ESCAPE '\\'`（`escapeLike` + `ESCAPE` 是 `T-V5` 锁定的既有正确行为）。
3. 在该函数上方补一行注释，说明为什么不能用 `REPLACE`（子树内同名目录会被二次替换），把这条的成因留在代码里。

### 验收

- **断言（新增用例，见下）**：建 `/a/sub/a/notes.md`，`renamePrefix('/a', '/a_新')` 后逐条断言——`findByPath(scope, '/a_新/sub/a/notes.md')` **非空**；`findByPath(scope, '/a_新/sub/a_新/notes.md')` 为 `null`（二次替换产生的错位路径）；`findByPath(scope, '/a/sub/a/notes.md')` 为 `null`（旧深层路径无残留）；`findByPath(scope, '/a')` 为 `null`（旧根已迁走）；且 `svfs.read('/a_新/sub/a/notes.md').content` 等于原文。
- **命令**：`cd packages/core && npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test test/vfs/vfs-rename-primitive.test.ts`
  → 期望 `# pass` = 现有条数 + 1，无 `# fail`。
- **反向自检（验收断言的「牙齿」）**：把 `:936` 临时改回 `REPLACE(...)` 重跑，新用例必须红——若仍绿则该用例是废断言，不予通过（RULE「验收断言的『牙齿』三条判据」第 ① 条）。
- **类型**：`cd packages/core && npm run typecheck` → 0 error。

### 测试策略

- 文件：`packages/core/test/vfs/vfs-rename-primitive.test.ts`（**改动既有文件**，不新建）。
- 新增用例名：`T-V6: 子树内含同名目录时 renamePrefix 只改前缀（深层同名段不被二次替换）`。
- 夹具沿用该文件既有的 `getNovelMasterTestContext()` + `testIsolationSuffix()` + `ctx.sessionVfs(project.id, session.id)` 形态；**路径可用固定字面量（`/a/sub/a/notes.md`），隔离靠每条用例新建的 project/session 产生的唯一 `scope_key`**（`scope_key` 已按 project/session 唯一，`T-V5` 同样是固定路径先例）——不必、也不应再要求路径带 `${suffix}`。
- 同步在 `T-V5` 的注释里补一句「本例不含子树同名目录，那条由 T-V6 钉」，避免后来者误以为 T-V5 已覆盖。

### 回归线（必须保持绿的既有测试）

- `packages/core/test/vfs/vfs-rename-primitive.test.ts` 全部既有用例（`T-V4` 空目录 rename、`T-V5` `%`/`_` 转义）。
- `packages/core/test/vfs/entry-name-validation.test.ts:90`（`renamePrefix 目录新名纯空白被拒`）。
- `packages/core/test/chat/skill-result-ref.test.ts:736`（技能改名后旧 ref 仍按 `(entryId, version)` hydrate）——技能改名走同一条原语。
- `packages/core/test/skills/skills.service.test.ts:573` 附近（renamePrefix 不重置 version）。
- `packages/core/test/message-checkpoint/rollback-reach-hash-batch.test.ts:119`、`rollback-version-short-circuit.test.ts:132,213`（这两处把 `renamePrefixInScope` 打桩成 no-op，签名不变即绿）。

### 依赖

无前置。可与本分片任意条目并行开工。

### 风险与回滚

- **风险**：极低。单条 SQL 表达式替换，作用域条件不变。唯一的行为变化是「深层同名段不再被替换」——而那本来就是错的。
- **回滚**：单文件单表达式，回退成本一条 hunk。若 `substr` 在某个驱动上有语义差异（不会，`substr(X,Y)` 是标准两参形式且 SQLite 三驱动均支持），退回 `REPLACE` 并改为「先 `UPDATE ... SET path = substr(path, 1, length(#{oldWithSlash})) || #{newWithSlash} || substr(...)`」的等价拆法亦可。
- **不做**：不引入命名参数复用/新绑定，不改 `escapeLike`，不动 `normalizePrefix`。

---

## B1-2 · N-P1-01 项目删除泄漏一批 `vfs_revision` 行及其 blob（与 B1-3 同 PR）

**严重度 / 簇**：P1 / core-storage（+ core-data 的 read-ref 族）

### 病症

`ProjectService.delete` 走 BFS 逐会话清理会话侧数据后，对**项目自身的两个 VFS scope** 只调了裸 `deleteVfsPrefix`——它只删 `vfs_entry` 行，**从不释放 live-head 引用、也从不 GC revision**。而这两个 scope 下每个文件在复制/写入时都被 `seedLiveHeadRevisionsUnderPrefix` 种下了一条 `ref_count = 1` 的 live-head revision。

**触发面有两条，不止「复制项目」一条**：
1. `ProjectService.copy`（`project.service.ts:297` / `:304`）——种下侧在复制时。
2. **模板推送**：`push-session-workspace.ts:32` → `vfs-tree-copy.ts:372` 的 `seedLiveHeadRevisionsUnderPrefix` 同样会在 `project:{pid}` scope 种下 `ref_count = 1` 的 live-head revision，此后删除该项目**同样泄漏**。（`seedLiveHeadRevisionsUnderPrefix` 的生产调用点全仓只有两处：`vfs-tree-copy.ts:372` 与 `project.service.ts:297/304`。）

修法天然覆盖两条触发面，但病症栏必须都列出来，否则读者会低估受害面。

后果：这条 revision 的 `ref_count` 永远停在 1，entry 却已经没了。两条 GC 路径都选不中它——

- `deleteUnreferencedUnderScope` 靠 `JOIN vfs_entry e ON e.entry_id = r.entry_id` 圈定范围，entry 已删 ⇒ JOIN 命中 0 行；
- 全局孤儿兜底 `deleteGlobalOrphans` 只清 `ref_count <= 0` 的 JOIN 孤儿，这条是 1 ⇒ 不选。

⇒ **每「种下一次 live-head revision 再删除该项目」一轮（复制项目、或模板推送进项目 scope），就永久泄漏一批 `vfs_revision` 行 + 其 `vfs_content_blob`**。无自愈路径（`createRevisionRefCountRepairOperation` 从未注册，见台账 §4.3 W10 双源），除了全库 VACUUM 之外的任何清理都不会碰它。会话删除路径不受影响——`deleteSessionFsData` 已经做了 `decrementLiveRefsUnderScope`（`create-session-fs-service.ts:72`），所以泄漏面**只在 project / project:meta 两个 scope**。

### 证据

`packages/core/src/service/chat/impl/project.service.ts`，`delete(id)` 内：

```ts
184	        await deleteSessionFsData(tx, session.id, id);      // 会话 scope：已含 decrement + sweep
...
187	        await deleteVfsPrefix(r.vfs, `session:${id}:${session.id}`, "/");
...
199	      await deleteVfsPrefix(r.vfs, `project:${id}`, "/");
...
202	      await deleteVfsPrefix(r.vfs, `project:${id}:meta`, "/");
```

种下 ref_count=1 的一侧在同一文件的 `copy(id)`：

```ts
297	      await seedLiveHeadRevisionsUnderPrefix(
298	        r.vfs, r.revisions, `project:${copy.id}`, "/", contentStore);
304	      await seedLiveHeadRevisionsUnderPrefix(
305	        r.vfs, r.revisions, `project:${copy.id}:meta`, "/", contentStore);
```

GC 选不中的机制见 `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts:617-622`（JOIN `vfs_entry`）与 `:629-641` 的 DELETE 子查询（同 JOIN）。

**行号修正**：台账 §2.4 记的是 `:185,188`；`fe79b781` 现行代码里会话 scope 那行是 `:187`，项目两个 scope 在 `:199` / `:202`。以本行为准。

### 修法（文件 · 函数级）

1. **改** `packages/core/src/service/chat/impl/project.service.ts`：
   - `:23-26` 的 import 增加 `sweepRevisionsUnderScope`（`@/domain/vfs/logic/vfs-tree-copy.js`），`deleteVfsPrefix` 保留（`:187` 仍要用，见下）。
   - `:199` 与 `:202` 两处，分别替换为
     `await sweepRevisionsUnderScope(r.vfs, r.revisions, \`project:${id}\`, "/")`
     与 `await sweepRevisionsUnderScope(r.vfs, r.revisions, \`project:${id}:meta\`, "/")`。
     顺序语义 = decrement → GC → 删 entry（B1-3 修好之后），与 session 侧 `deleteSessionFsData` 同款。
   - **`:187` 必须保持裸 `deleteVfsPrefix`，不得换成 sweep**。理由：`:184` 的 `deleteSessionFsData` 已经对同一 scope 做过 `decrementLiveRefsUnderScope`（`create-session-fs-service.ts:72`）；`:187` 时 entry 仍在，再跑一次 decrement 会对同一批 live head **二次 −1**，而 `batchAdjustRefCountWithDelta` 的 `delta < 0` 分支（`sqlite-vfs-revision.repository.ts:463-472`）**不做存在性校验、UPDATE 也不带 `AND ref_count > 0` 守卫** ⇒ 二次 decrement 会撞 `vfs_revision` 的 `CHECK (ref_count >= 0)`（`vfs-revision-schema.ts:23`）抛 `SQLITE_CONSTRAINT_CHECK` → **整个 `delete` 事务回滚 → 用户看到「删除项目失败」**（注意：不是静默负计数，DDL 挡在前面）。这是本条最容易踩的坑，实现时务必在 `:187` 上方留一行注释说明「会话 scope 的 live ref 已由 deleteSessionFsData 释放，此处只删 entry，勿换 sweep」。
   - `r.revisions` 已在 `reposFor(tx)`（`:49-57`）里备好，**无需新增仓储装配**。
2. **不要**新增 `deleteGlobalOrphans` 调用：B1-3 修好后，GC 在 entry 还在时执行，不产生 JOIN 孤儿。全表 DELETE 也不该塞进这个事务。
3. 若 `runDeferredFileCacheGc`（`:210`）之后仍见到孤儿，那是 B1-3 未落地的症状，不是本条要补的洞——**不要在这里加第二条兜底**。

### 验收

- **断言（新增用例）**：`copy` 一个带模板文件的项目 → 记下复制体 `project:{copyId}` 下某文件的 `(entryId, version)` → `ctx.projects.delete(copyId)` → 断言 `SELECT COUNT(*) FROM vfs_revision WHERE entry_id = ? AND version = ?` 为 **0**；同 scope 下 `SELECT COUNT(*) FROM vfs_entry WHERE scope_key = 'project:{copyId}'` 为 0；**该 `content_hash` 的 `vfs_content_blob.ref_count` 相对删除前恰好 −1**。
  （blob 这条**不能**用「`SELECT COUNT(*) FROM vfs_content_blob WHERE content_hash = ?` 为 0」作主口径：`copyVfsTree` 复制的是 `content_hash`（`vfs-tree-copy.ts:200/241` 的 `batchInsertFileEntriesWithHash`），blob 按内容寻址与**源项目共享**，删完复制体后那行 blob 必然仍在（源项目还引用着），主口径会**必然失败**。可选变体：若另外构造一个不共享 blob 的独立项目（内容不同或无源持有者），才可以用 `COUNT = 0`。）
- **命令**：`cd packages/core && npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test test/vfs/project-delete-revision-gc.test.ts`
  → 期望 `# pass` = 4（新增文件 4 条），`# fail 0`。
- **回归对照**：同一条夹具先在修复前跑，必须红（`vfs_revision` 计数为 1）；若修复前就绿，说明断言没咬到东西。
- **类型**：`cd packages/core && npm run typecheck` → 0 error。

### 测试策略

- 文件：**新建** `packages/core/test/vfs/project-delete-revision-gc.test.ts`（新建而非改动，因为 `read-ref-count.test.ts` 的既有两条项目删除用例断言的是 **read 引用**口径，与本条的 **live-head 口径**互相干扰；RULE「同一份夹具只服务一套期望吗」纪律要求拆开）。
- 用例名（4 条）：
  1. `P-D1: 项目删除后 project scope 无残留 vfs_entry`
  2. `P-D2: 项目删除释放 project scope 的 live-head revision（ref_count=1 → 行回收）`
  3. `P-D3: 项目删除释放 project:meta scope 的 live-head revision（技能域同款）`
  4. `P-D4: 项目删除不做二次 decrement（delete 不抛错 + 会话 scope revision 计数零变化）`——断言两条：① `ctx.projects.delete(copyId)` **不抛错**（若 `:187` 被误改成 sweep，此处会撞 `CHECK (ref_count >= 0)` 抛 `SQLITE_CONSTRAINT_CHECK` 而红）；② 删除前后 `revisionRefCounts(ctx, entryId)` 深比对**完全相等**——会话 scope 的 live-head revision 计数不得被 `:199/:202` 的 sweep 波及。
     （原写法「`ref_countOf(entryId, version) >= 0` 或等价『计数不为负』」是**恒真断言**：`vfs-revision-schema.ts:23` 的 DDL 带了 `CHECK (ref_count >= 0)`，无论实现怎么错它都成立、咬不到东西，已按 RULE「验收断言的『牙齿』」第 ① 条换掉。`refCountOf` 探针的照抄来源见下一条。）
- 夹具复用 `getNovelMasterTestContext()` + `testIsolationSuffix()`；`refCountOf` / `revisionRefCounts` 两个探针都照抄 `packages/core/test/vfs/read-ref-count.test.ts`（`:98` 已有 `refCountOf`）里的写法（同一测试上下文内自建小工具函数，不跨文件 import 测试私有函数）。

### 回归线（必须保持绿的既有测试）

- `packages/core/test/vfs/read-ref-count.test.ts:217`（`项目删除（BFS 独立挂点）：全部会话的消息 refs 聚合 −1，revision 全回收`）——**最关键的一条**：本条改的正是同一个 `delete` 方法。
- `packages/core/test/skills/skill-relocate.test.ts:205`（`T-SR3`：`ProjectService.delete()` 后 `project:{pid}:meta` / `project:{pid}` 的孤儿行清理）。
- `packages/core/test/skills/project-copy-skills.test.ts:147`（复制携带技能文件 + 删除）。
- `packages/core/test/chat/chat.services.test.ts:377`、`packages/core/test/chat/project.service.agent-config.test.ts:97`、`packages/core/test/service/chat/session.subsession.test.ts:177`、`packages/core/test/session-run-state/session-run-state.service.test.ts:224`（四处都调 `ctx.projects.delete`，全部必须绿）。

### 依赖

- **同 PR 依赖 B1-3**（CS-04）。B1-3 不落地，本条的 `sweepRevisionsUnderScope` 里的 GC 步仍是死语句，泄漏照旧——**两条必须同一个 PR 一起落、一起验收**。
- **但本条的「无自愈路径」结论不因 B1-3 修复而改变**：B1-3 收缴的是 `ref_count = 0` 的行（全局兜底下次就会清），本条泄漏的是 `ref_count = 1` 的行（`deleteGlobalOrphans` 的 `ref_count <= 0` 谓词永远选不中）——**两者泄漏的是不同 `ref_count` 区间的行**，不要拿「B1-3 落地了」来推断本条的泄漏也会被顺带清掉。
- 不依赖任何 Wave A 条目。

### 风险与回滚

- **风险（主要）**：**误删仍被持有的 revision**。`deleteUnreferencedUnderScope` 的谓词是 `r.ref_count <= 0`，与 checkpoint / read 两类持有者共用同一计数（`revision-ref-count.ts:266-311` 的三类期望值口径）。本条新增的两处 decrement 只作用于 `project:{id}` / `project:{id}:meta` 两个 scope 的 live head，而这些 scope 按设计不承载 checkpoint 与 read 引用（两者都锚在 session scope，RULE「read 引用」条），所以误删面为空。
- **风险（次要）**：`:187` 被误改成 sweep 导致二次 decrement。已用「保持裸调用 + 加注释」+ 用例 `P-D4` 双重拦住；**真实表现是 `CHECK (ref_count >= 0)` 抛 `SQLITE_CONSTRAINT_CHECK` → 事务回滚 → 删除失败**（不是静默负计数，机制见修法第 1 条），所以症状是「删除项目直接报错」，不是「数据悄悄坏掉」——这反而更容易被察觉，误判为「已修好」的可能性低。
- **回滚**：本条与 B1-3 一起回滚（同一个 PR）。回滚后行为回到今天（继续泄漏），无数据损坏、无不可逆状态。

---

## B1-3 · CS-04 `sweepRevisionsUnderScope` 的第 3 步是永远命中 0 行的死语句

**严重度 / 簇**：P1 / core-storage（VFS revision GC 底座）

### 病症

`sweepRevisionsUnderScope` 的三步顺序是「decrement live ref → **删 entry** → GC 无引用 revision」。但第三步的实现是**靠 `JOIN vfs_entry` 圈定范围**的——entry 在第二步已经被整棵删掉，JOIN 命中 0 行，第三步恒等于 `return 0`。

也就是说：这个被 5 个调用点当作「释放引用 + 删条目 + 回收 revision」三件套用的函数，**从来没回收过任何一行 revision**。凡只走这个函数、不走 `sweepSessionRevisions`（那条路径的 GC 排在删 entry 之前，见 `revision-gc.ts:70` vs `project.service.ts:187` 的先后）的清理链，revision 全留。

**但这批残留不是不可回收的永久泄漏，必须与 B1-2 的那批区分开**：

- 残留行的 `ref_count` 已被第 1 步 `decrementLiveRefsUnderScope` 减到 **0**，属于全局兜底 `deleteGlobalOrphans`（`sqlite-vfs-revision.repository.ts:55-58`，谓词 `ref_count <= 0 AND entry_id NOT IN (SELECT entry_id FROM vfs_entry)`）的收缴对象——它会在**下一次任意会话/项目删除**（`revision-gc.ts:81`，`sweepSessionRevisions` 默认 `includeGlobalOrphans !== false`，经 `create-session-fs-service.ts:73` 触发）或**回滚提交后**（`deferred-revision-orphan-gc.ts:55` 的 `scheduleDeferredRevisionOrphanGc`）被顺带清掉。
- ⇒ 本条的病症是「**回收时机押注在一次不相关的后续删除/回滚上**，只读型使用（反复 `replaceVfsSubtree` 而从不做删除/回滚）下 revision 与 blob 持续堆积」，而不是永久泄漏。修法的价值在于**把回收变成同事务内确定发生**，而不是从「不可回收」变成「可回收」。
- **与 B1-2 的对照**：B1-2 泄漏的是 `ref_count = 1` 的行，`deleteGlobalOrphans` 的 `ref_count <= 0` 谓词永远选不中 ⇒ **那批才是真永久泄漏**。本条（`ref_count = 0`）的「无自愈」结论不成立，严重度定级与耦合叙述不要混用。

受害调用点（全仓 `sweepRevisionsUnderScope` 的传递闭合，共 5 处业务调用）：
1. `vfs-tree-copy.ts:348` ← `replaceVfsSubtree` ← `initialize-session-workspace.ts:37`（**模板拉取**）
2. `vfs-tree-copy.ts:348` ← `replaceVfsSubtree` ← `push-session-workspace.ts:32`（模板推送）
3. `skills.service.ts:450`（技能整目录删除）
4. `releaseAndDeleteVfsPrefix`（`:418`）← `character-card-import.service.ts:144`（角色卡导入）
5. `releaseAndDeleteVfsPrefix`（`:418`）← `vfs-zip-io.service.ts:203`（ZIP 导入）

### 证据

`packages/core/src/domain/vfs/logic/vfs-tree-copy.ts:390-411`：

```ts
397	  await decrementLiveRefsUnderScope(          // 第 1 步：释放 live head 引用 ✅
404	  await deleteVfsPrefix(repo, scopeKey, pathPrefix, excludePrefixes);   // 第 2 步：删 entry
405	  await deleteUnreferencedUnderScope(         // 第 3 步：GC —— 此时 entry 已不存在
```

第三步为何必然落空，见 `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts:617-622`：

```sql
617	      `SELECT COUNT(*) AS n
618	       FROM vfs_revision r
619	       JOIN vfs_entry e ON e.entry_id = r.entry_id
620	       WHERE e.scope_key = #{scopeKey}
621	         AND (e.path = #{path} OR e.path LIKE #{pattern} ESCAPE '\')
622	         AND r.ref_count <= 0`
```

`e.path` 的两个条件都作用在**已被第 2 步删除的 entry 行**上。对照组：session 侧 `deleteSessionFsData`（`create-session-fs-service.ts:71-80`）的顺序是「删 checkpoint → decrement → `sweepSessionRevisions`（内含 `:70` 的 scoped GC）→ **之后**才由 `project.service.ts:187` / `session.service.ts` 删 entry」，GC 排在删 entry 之前——**两条链的顺序是反的，本条就是这个反差本身**。

`revision-gc.ts:36-40` 的模块注释已经把机理写明（「靠 JOIN vfs_entry 圈定当前 session scope」「path-scoped 扫描 JOIN 不到 entry 已删的 revision 孤儿，靠 `deleteGlobalOrphans` 兜底」），只是 `sweepRevisionsUnderScope` 没有沿用这个顺序。

### 修法（文件 · 函数级）

1. **改** `packages/core/src/domain/vfs/logic/vfs-tree-copy.ts` 的 `sweepRevisionsUnderScope`（`:390-411`），把三步重排为
   `decrementLiveRefsUnderScope` → `deleteUnreferencedUnderScope` → `deleteVfsPrefix`。
   参数（`repo, revisionRepo, scopeKey, pathPrefix, excludePrefixes`）与返回值签名**一律不变**，调用方零改动。
2. 同步改该函数上方的 JSDoc（`:383-389`）：现在的描述「释放 scope+前缀下 live head 引用 → 删 entry → GC 无引用 revision」**就是这个错误顺序的自述**，必须改成正确顺序，并写明为什么（scoped GC 靠 `JOIN vfs_entry` 圈范围，必须在 entry 还在时跑；这与 `revision-gc.ts` 的 session 侧顺序同源）。
3. `releaseAndDeleteVfsPrefix`（`:418-425`）只是转发，**不改**；修好 sweep 后它自动受益。
4. **不要**在 sweep 里补 `deleteGlobalOrphans()`：那是全表 DELETE，塞进「删一个前缀」的函数里会把作用域放大到全库（且违反 `revision-gc.ts:42-48` 已定的「回滚事务内不得跑全表 DELETE」约定）。

### 验收

- **断言（新增用例）**：在 `project:{pid}` scope 下写 1 个文件 → 记 `(entryId, version)` → 调 `sweepRevisionsUnderScope(repo, revRepo, scopeKey, "/")` → 断言 `vfs_revision` 中该 pair 行数为 **0**、`vfs_entry` 中该 scope 行数为 **0**。
- **断言（excludePrefixes 不误伤）**：同上但传 `excludePrefixes = ["/meta/skills"]` → 断言 `meta/skills` 下的 entry **仍在**、其 live-head revision **仍在**、`meta/skills` 之外的 revision 被回收。
- **命令**：`cd packages/core && npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test test/vfs/sweep-revisions-order.test.ts test/vfs/vfs-tree-copy-batch.test.ts test/vfs/vfs-gc-trigger.test.ts test/workplace/template-pull.test.ts`
  → 期望 `# fail 0`；且两份既有文件的既有断言（T-G2/sweep、T-BATCH-3 等）必须**保持绿**（它们此前是在 GC 恒不生效的前提下写成的，若某条既有断言意外依赖「GC 不删」，会在这里红——那就是本条真实改变了行为，按下方风险栏处置，不要改断言迁就）。
  （命令必须带上 `sweep-revisions-order.test.ts`（**新建**，承载 `S-O1/S-O2/S-O3`）与 `template-pull.test.ts`（**改动**，承载跨切面用例）；只跑两个既有文件的话，「命令通过」与「新用例红」互不相干，等于没验。）
- **反向自检**：把 `:404` 与 `:405` 两段换回原顺序重跑，新用例必须红。

### 测试策略

- 文件：**新建** `packages/core/test/vfs/sweep-revisions-order.test.ts`（新建理由：`vfs-tree-copy-batch.test.ts` 与 `vfs-gc-trigger.test.ts` 是既有的快慢路径/触发器语料，往里塞顺序断言会与它们各自的夹具耦合；RULE「同一份夹具只服务一套期望吗」）。
- 用例名（3 条）：
  1. `S-O1: sweep 后 live-head revision 被回收（GC 步在删 entry 之前执行）`
  2. `S-O2: sweep 的 excludePrefixes 豁免同时覆盖 entry 与 revision 两侧`
  3. `S-O3: releaseAndDeleteVfsPrefix 转发路径与 sweepRevisionsUnderScope 直调行为等价`——**同一夹具建两套等价数据**，一套走 `releaseAndDeleteVfsPrefix` 转发、一套直调 `sweepRevisionsUnderScope`，断言两侧 `SELECT COUNT(*) FROM vfs_entry WHERE scope_key = ?` 与 `SELECT COUNT(*) FROM vfs_revision WHERE entry_id IN (…)` **逐项相等**。
     （原写法「sweep 的返回值/签名不变，调用方零改动」是**恒空断言**：签名不是运行时可观测量，`sweepRevisionsUnderScope` 本身返回 `Promise<void>`，node:test 零 mock 基座下没有可注入的 spy 缝，这条用例根本没有可写的断言体，已按 RULE「验收断言的『牙齿』」第 ① 条换掉。签名不变这一事实仍由「两入口行为等价」间接锁住。）
- 追加一条**跨切面**用例到 `packages/core/test/workplace/template-pull.test.ts`（**改动既有文件**）：`模板拉取后 session scope 无 ref_count=0 的残留 revision`——把本条落到 B1-5 的同一业务面上，锁住「模板拉取真的在回收」。

### 回归线（必须保持绿的既有测试）

- `packages/core/test/vfs/vfs-tree-copy-batch.test.ts`（T-BATCH-1/3 与 4 条 excludePrefixes 用例）——**最关键**，它们直接断言 `replaceVfsSubtree` 后的 revision 计数。
- `packages/core/test/vfs/vfs-gc-trigger.test.ts:157`（`T-G2/sweep：replaceVfsSubtree 后无 orphan blob，前缀外文件 blob ref_count 不变`）。
- `packages/core/test/message-checkpoint/revision-gc.test.ts`、`deferred-revision-orphan-gc.test.ts`、`rollback-ref-count.test.ts`（session 侧 GC 链不受影响，但共用 `deleteUnreferencedUnderScope`）。
- `packages/core/test/vfs/orphan-revision-gc.test.ts`、`vfs-repair-ref-count-batch.test.ts`。
- `packages/core/test/skills/project-copy-skills.test.ts`（**项目复制 + `ProjectService.delete`**，走 `:199/:202` 两条 sweep）+ `packages/core/test/skills/skills.service.test.ts`（`deleteSkill` 覆盖 `skills.service.ts:450` 这条 sweep 链，`:296/321/342/353/377/383/398/410/618/759`）+ `packages/core/test/skills/skill-relocate.test.ts:126,142`。
  （**归因更正**：`project-copy-skills.test.ts` 测的是项目复制 + 项目删除（其 `:147` 是 `ctx.projects.delete`），**不是**「技能整目录删除」；走 `skills.service.ts:450` 那条 sweep 链的是 `skills.service.test.ts` 与 `skill-relocate.test.ts`。三个文件都保留，但理由要分开看，别按错误理由评估风险。）
- `packages/core/test/chat/skill-result-ref.test.ts`（`T-SR7`：技能改名后旧 ref hydrate）。

### 依赖

- **与 B1-2 同 PR**（便于两条一起验收；**本条不依赖 B1-2，可独立落地**——单独落地时它的价值是「回收时机确定化」，而不是「止住泄漏」）。
- **与 B1-5 同域**：模板拉取走 `replaceVfsSubtree` → 本条修好后，模板拉取会**真的开始删 revision**。B1-5（清 prompt 缓存）与本条叠加在同一条业务链上，建议同波落地、分开验收（各自有独立用例）。
- 不依赖任何 Wave A 条目。

### 风险与回滚

- **风险（高，须重点盯）**：本条让一条**从未生效**的删除语句首次生效，行为变化面比看上去大。最坏情形是「某条 revision 被误删」——但谓词 `ref_count <= 0` 加 JOIN 圈定，误删需要「ref_count 已归零且仍被当作 live head 使用」这一不变量被破坏。
  **已核对的不变量**：`decrementLiveRefsUnderScope` 减的正是 `listFileHeadsUnderPrefix` 返回的 `(entryId, headVersion)`，减完即 0，而该 entry 马上会被 `deleteVfsPrefix` 删掉——**没有任何读者会在 GC 之后再来读这个 head**。excludePrefixes 的 entry 与 revision 两侧都被豁免（`sqlite-vfs-revision.repository.ts:591-612` 的 NOT 子句与 `revision-ref-count.ts:431` 的同款过滤）。
- **风险（次要）**：T-BATCH-3 之类的既有断言可能写着「replaceVfsSubtree 后 target 每文件恰好 1 条 revision」——那说的是 **seed 之后**的计数（`:371-380` 的 `seedLiveHeadRevisionsUnderPrefix` 在 sweep 之后执行），不受本条影响。若某条既有断言真的红了，**先读红的是哪一条、断言的是 sweep 前还是 sweep 后的计数**，再决定是修实现还是修断言；**禁止为了让测试变绿而回退顺序**。
- **风险（须核的隐含约束）**：换序后 GC 在 **entry 仍存在**时删 revision，删除触发器 `trg_revision_delete_dec_blob_ref`（`packages/core/src/bootstrap/vfs/vfs-revision-schema.ts:45-54`）可能把 `vfs_content_blob` 的 `ref_count` 减到 0 并**删掉 blob 行**，而对应的 entry 要到紧随其后的 `deleteVfsPrefix` 才被删——**这个中间窗口必须留在同一个事务内**。已核实：4 条直连调用链全部以 **tx** 构造 `SqliteVfsRevisionRepository`（`skills.service.ts:449`、`character-card-import.service.ts:142`、`vfs-zip-io.service.ts` 同形、`replaceVfsSubtree` 的 options 由上游传 tx 构造），且 `deleteUnreferencedUnderScope` 用的是构造期的 `this.conn` ⇒ 三步同事务原子。**这条约束必须写进函数上方的 JSDoc**：若日后有人把 sweep 拆出事务，会出现「entry 还指向已被回收的 blob」的窗口。
  **反向核对（正向结论）**：`replaceVfsSubtree` 换序后紧接的 `copyVfsTree`（`vfs-tree-copy.ts:139`）只从**源 scope** 取数据——`:149` 目录元数据、`:185` 文件元数据、`:218` `findExistingBlobHashes`、`:229` `findExistingPaths`——**从不读目标 scope 的 entry 正文**；目标 entry 在同一事务内随即被 `deleteVfsPrefix` 删掉。5 条调用链里也没有 `from == to` 的同 scope 替换（project→session / session→project / global→project）。⇒ 换序不会让 `copyVfsTree` 读到已被触发器回收的 blob。
- **回滚**：单函数三步换序，回退成本一条 hunk。回滚后行为回到今天（继续不回收），无数据损坏。
- **建议**：本条落地后在真机/桌面库上跑一次 `SELECT COUNT(*) FROM vfs_revision` 与 `vfs_content_blob` 的前后对比，确认回收量级符合预期（应显著下降），再进主干。

---

## B1-4 · RT-04 `definitionToDocument` 把同名 persist/dynamic 块静默塌缩成一块

**严重度 / 簇**：P1 / core-runtime（agent 定义写入门禁）

### 病症

`AgentDefinition` 的域形态里 `prompts.persist` / `prompts.dynamic` 是**块数组**（允许重名）；wire 形态是「块名 → 块」的**对象映射**（同名必然塌缩）。`definitionToDocument` 直接 `persist[block.name] = persistBlockToWire(block)` 循环写入，**没有先校验块名唯一**。

而读侧 `documentToDefinition` → `validateAgentPromptLayoutFromMaps` 是有唯一性语义的（映射形态天然唯一），`validateAgentPromptLayout` 也显式 `assertUniqueBlockNames` 抛错。**只有写侧这一段是裸的**。

⇒ 一份含两个同名 persist 块的 definition 能通过 `assertWritableAgentDefinitionShape` 的 zod 往返校验（因为往返恰好把它压成一份合法的 document）、被写进注册表；再读回来时只剩一块，**另一块的正文永久丢失，且全程零报错、零日志**。

第二份同款塌缩在 `ProjectAgentConfig` 的 `configToWire`——它转调同一个 `agentDefinitionSchema.toWire`。

### 证据

`packages/core/src/domain/agent/model/agent-definition.schema.ts:221-229`（`definitionToDocument`）：

```ts
221	function definitionToDocument(def: AgentDefinition): AgentDefinitionDocument {
222	  const persist: AgentDefinitionDocument["prompts"]["persist"] = {};
223	  for (const block of def.prompts.persist) {
224	    persist[block.name] = persistBlockToWire(block);      // ← 同名块：后写覆盖先写，无告警
225	  }
226	  const dynamic: AgentDefinitionDocument["prompts"]["dynamic"] = {};
227	  for (const block of def.prompts.dynamic) {
228	    dynamic[block.name] = dynamicBlockToWire(block);
229	  }
```

已有的唯一性校验在 `packages/core/src/domain/prompt/logic/validate-agent-prompt-layout.ts:320-334`：

```ts
320	function assertUniqueBlockNames(
324	  const seen = new Set<string>();
326	    if (seen.has(block.name)) {
327	      throw new PromptError("INVALID_BLOCK",
329	        `prompts.${region}：重复的块名「${block.name}」`);
```

`validateAgentPromptLayout`（`:339-343`）第一件事就是调它——**但 `definitionToDocument` 从未调用过 `validateAgentPromptLayout`**。

第二处同款循环：`packages/core/src/domain/chat/model/project-agent-config.schema.ts:29-36`：

```ts
29	function configToWire(config: ProjectAgentConfig): Record<string, unknown> {
32	    ...(config.definition != null
33	      ? { definition: agentDefinitionSchema.toWire(config.definition) }
```

现有的写入门禁 `packages/core/src/domain/agent/logic/validate-agent-definition.ts:52-100`（`assertWritableAgentDefinitionShape`）在 `:73-84` 只检查「`prompts` 是含 persist/dynamic 数组的对象」，`:88-89` 的终极防线 `decode(agentDefinitionSchema.toWire(def), agentDefinitionSchema)` 因为上面那次塌缩，**恰恰把重名结构洗成了合法文档**，所以这道防线对本条完全无效。

三个调用点全部经同一个收敛点：`validate-agent-definition.ts:89`、`project-agent-config.schema.ts:33`（再被 `project.service.ts:84` 与 `:237` 使用）。

### 修法（文件 · 函数级）

1. **改** `packages/core/src/domain/agent/model/agent-definition.schema.ts` 的 `definitionToDocument`，在构造 `persist` / `dynamic` 两个映射**之前**先校验：
   - `import { validateAgentPromptLayout } from "@/domain/prompt/logic/validate-agent-prompt-layout.js"`（该模块已被本文件 `:13` 引入过同族的 `validateAgentPromptLayoutFromMaps`，加进同一 import 即可）；
   - 函数体开头 `validateAgentPromptLayout(def.prompts);`（只用它的校验副作用，返回值忽略——`AgentDefinition.prompts` 就是 `AgentPromptLayout`）。
   - 落点选这里而不是 `configToWire`：`definitionToDocument` 是三个调用点**唯一**的收敛点，一处改动同时覆盖 `validateAgentDefinition`、`ProjectAgentConfig.updateAgentConfig`、注册表持久化。**在 `configToWire` 里再插一次是重复插桩，不做**（同一条规则插两遍 = 将来改一处忘一处）。
2. **不要**改成「重名时自动改名/合并」——那是静默改语义；正确口径是**拒绝写入**并把已有的 `INVALID_BLOCK` 错误文案透给调用方。
3. **不要**动 `assertWritableAgentDefinitionShape`（`validate-agent-definition.ts`）的 `:88-89` 那道 zod 往返——它是终极防线，本条修好后它自然也会拒绝，但保留它作为「未来新增字段形状错误」的兜底。
4. **必须补的第二处断言**：由于修法收敛在 `definitionToDocument`，`project-agent-config.schema.ts` 侧不需要改代码，但**必须有独立用例**覆盖 `configToWire` 这条链（它有自己的失败模式：`mode === "custom"` 时 definition 的重名块如果哪天有人绕过 `validateAgentDefinition` 直接走 `projectAgentConfigSchema.toWire`，收敛点仍能兜住——这条要钉住）。

### 验收

- **断言 A（塌缩被拒）**：`agentDefinitionSchema.toWire({ ...def, prompts: { ...def.prompts, persist: [块A, 块A同名副本] } })` **抛错**，且错误消息含 `重复的块名`；dynamic 同款一条。
- **断言 B（无副作用污染）**：上一个用例抛出后，原 `def` 对象未被就地修改（`toWire` 不得改写入方传入的对象）。
- **断言 C（configToWire 链）**：`projectAgentConfigSchema.toWire({ mode: "custom", definition: 含重名块的 def })` 抛错。
- **断言 D（合法定义不受影响）**：现有的合法 definition（含重名之外的正常多块）`toWire` 往返等值。
- **命令**：
  - `cd packages/core && npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test test/agent/agent-definition.test.ts test/chat/project-agent-config.schema.test.ts`
  - `cd packages/core && npm run typecheck` → 0 error。
- **反向自检**：把 `definitionToDocument` 开头的 `validateAgentPromptLayout` 调用注释掉重跑，断言 A/B/C 必须红。

### 测试策略

- 文件（**均改动既有文件**）：
  - `packages/core/test/agent/agent-definition.test.ts` → 新增 `toWire 对重名 persist 块抛 INVALID_BLOCK（不静默塌缩）`、`toWire 对重名 dynamic 块抛 INVALID_BLOCK`、`toWire 抛错后不改写入方对象`。
  - `packages/core/test/chat/project-agent-config.schema.test.ts` → 新增 `configToWire 对重名块 definition 抛错（第二份同款循环已被收敛点覆盖）`。
- 夹具复用两个文件既有的最小合法 definition 构造，不新建大夹具。

### 回归线（必须保持绿的既有测试）

- `packages/core/test/agent/agent-definition.test.ts`、`agent-definition-io.test.ts`、`agent-definition-validate.test.ts`、`merge-agent-definition-patch.test.ts`、`sqlite-agent-definition.repository.test.ts`（agent 定义域全部语料）。
- `packages/core/test/chat/project-agent-config.schema.test.ts`、`packages/core/test/chat/project.service.agent-config.test.ts`。
- `packages/core/test/config-forms/**`（`agent-editor-state.ts:590` 是 `validateAgentPromptLayout` 的另一处调用方，表单保存链必须不受影响）。
- `packages/core/test/package-exports/snapshots/*.json`（agent schema 的导出面快照；本条不改导出面，但 `toWire` 是挂在 `agentDefinitionSchema` 上的成员，快照若枚举成员需一并核对）。

### 依赖

无前置。可与 B1-1 并行。

### 风险与回滚

- **风险**：**历史存量里可能已经存在被塌缩过的 agent 定义**。本条只拦新写入，读侧已塌缩的数据无法恢复（那是数据损失，不是本条能修的）。
  **处置**：实施时在写入门禁的错误文案里带上可定位信息（`validateAgentPromptLayout` 现有的 `prompts.persist：重复的块名「X」` 已足够），让用户/上游 LLM 知道是哪一块撞了；**不要**在本条里加「自动改名并落库」的迁移脚本（那是产品决策，须单独拍板）。
- **风险（次要）**：`validateAgentPromptLayout` 除了唯一性还校验 `system` 非空、`persistEnabled` 时末块须 assistant、`dynamicEnabled` 时首末块角色等（`:226-300`）。这些校验此前**不在 `toWire` 路径上**，加进去之后，历史上「persistEnabled=true 但末块是 user」这类定义会开始被拒写。
  **核对结论**：这些定义在**读侧**（`documentToDefinition` → `validateAgentPromptLayoutFromMaps`）本来就会被拒，也就是说它们**根本读不出来**——所以拒绝写入不新增任何「能读不能写」的面。且 `assertWritableAgentDefinitionShape:88-89` 的 zod 往返已经在 decode 侧拦了同一批（decode 走 `documentToDefinition`，会跑完整 layout 校验）。⇒ 无新增拒绝面。
- **回滚**：单函数一行调用，回退成本一条 hunk。回滚后行为回到今天（继续静默塌缩）。

<!-- ✅ judge-r1 B4 已裁定：**作废，本 spec 不改。**
     背景（原文照录，供留痕）：报告 sr1-core1-b 在 verdict 表给本条标了「Go（含 1 条 must-fix 澄清）」，
     §4 结论也写「只剩三处文档级 must-fix（MF-4/MF-5 与 B1-4 的一条措辞澄清）」——
     但 §3 的 must-fix 清单表只列了 MF-1…MF-5 五条、全部归属 B1-6 / B1-5，
     **报告从未给出 B1-4 这条澄清的原文、也未指出要改哪一句措辞**。

     **裁定结论**：judge 回读 `raw/sr1-core1-b.md` 全文后发现，该报告**自相矛盾且无任何原文可依**——
     §1.3 的 B1-4 复核要点 7 条**全部是正面结论**（「三调用点唯一收敛成立且已实测」
     「spec 的收敛判断正确、完备」「不新增拒绝面——spec 结论正确」），
     §2 重点① 的结论是「**写全了，且收敛点判断正确**」，§3 must-fix 表 MF-1…MF-5 无一条归属 B1-4。
     ⇒ verdict 表那句「含 1 条 must-fix 澄清」属**报告自身笔误**，judge 已裁定作废。
     **本条七要素原文有效、逐字不动**；后续任何轮次都不得再拿这条幽灵 must-fix 追问本条。
     配套勘误已写进 `raw/sr1-core1-b.md` 末尾（judge-r1 B 节 / R2-15）。 -->

---

## B1-5 · RT-08 模板拉取整树覆盖后漏清 prompt 缓存（**四源印证，最该先修**）

**严重度 / 簇**：P1 / core-runtime（service/template + KKV 缓存生命周期）

### 病症

`sessionTemplatePull` 把会话工作区整棵替换成项目模板的最新快照（**文件内容、路径树、规则快照全变**），事务提交后只调了 `runDeferredBlobGc`，**没有清该 session 的 `rule_snapshot` / `file_cache` 两域、没失效 prompt token cache、没失效工具调用数缓存**。

而 `file_cache` 的读口 `loadOrFillFileCache` **命中即无条件返回、完全不做 mtime 校验**（批量路径 `assemble-workplace-display.ts:171-187` 同样 `cached ?? fill`，也不比对；RULE「常驻工作区」条明写这条不变量）。**这是比「同 mtime 内容变」更强的一条**：`replaceVfsSubtree` 复制条目时沿用源项目的 mtime（`vfs-tree-copy.ts:238` 的 `mtimeMs: f.mtimeMs`）只是让「mtime 也相同」变得很常见，**并不是问题的必要条件**——哪怕 mtime 真的变了，读口也照样命中陈旧缓存。

⇒ **任何**「同路径、正文被改掉」的变更（项目模板里改了文件正文、或经由不更新 mtime 的通道写入）都会让会话侧的 `file_cache` 命中旧值并原样续命，agent 的 `<workplace>` 前缀继续注入**已被替换掉的旧正文**。用户改了模板、拉了模板，agent 看到的还是老内容，且没有任何报错。

危害面被两条事实放大：拉取是**整树覆盖 + 规则覆盖**（`worktree.copyScope` 一并复制），因此 `rule_snapshot` 同样陈旧。

### 证据

`packages/core/src/service/template/impl/template-pull.service.ts:24-36`（`DefaultTemplatePullService.sessionTemplatePull`）：

```ts
30	    await this.conn.transaction(async (tx) => {
31	      await initializeSessionWorkspace(tx, session.projectId, sessionId, {
32	        clearCheckpoints: true,
33	      });
34	    });
35	    await runDeferredBlobGc(this.conn);      // ← 只清 blob，prompt 缓存四件套一个没调
```

应调而未调的 helper 在 `packages/core/src/service/vfs/logic/clear-session-prompt-caches.ts:29-54`——它一次做齐四件事（`:34` 清 `rule_snapshot`、`:35` 清 `file_cache`、`:38` 失效 API prompt token 双删、`:42-47` 写 `usage_stats.toolUseCount` 哨兵空串）。

同款 helper 的**既有两处接入点**（说明这是既定口径，模板拉取是漏挂的第三处）：
- `packages/core/src/service/vfs/impl/character-card-import.service.ts:196-197`
- `packages/core/src/service/vfs/impl/vfs-zip-io.service.ts:258-259`

mtime 沿用的一侧：`packages/core/src/domain/vfs/logic/vfs-tree-copy.ts:238`（`mtimeMs: f.mtimeMs`，file 载体行），`:208` 同款（目录载体行）。

**行号修正**：台账 §2.2 记的是 `template-pull.service.ts:24-36`，与 `fe79b781` 现行代码**一致**（本条无漂移）。

RULE 依据：「导入缓存对齐（session 导入三件套）」条（`docs/apm/RULE.md:17`）明确「事务提交后清空该 session 的 `rule_snapshot` + `file_cache` 两域并失效 prompt token cache」，并写明「置位/压缩裸 await，导入走 helper 整体 try/catch 吞错 + `console.warn`（best-effort）」。模板拉取本质就是 session scope 的整树覆盖，属该条的同族；**本条是把既有口径补齐到第三处接入点，不是在新立规则**。

### 修法（文件 · 函数级）

1. **改** `packages/core/src/service/template/impl/template-pull.service.ts`：
   - 新增两个 import：`clearSessionPromptCaches`（`@/service/vfs/logic/clear-session-prompt-caches.js`）与 `createSessionKkvService`（`@/service/session-kkv/create-session-kkv-service.js`）。两者都在 service 层，与本文件同层，无跨层依赖问题。
   - `sessionTemplatePull` 的 `:35` 处，`await runDeferredBlobGc(this.conn);` **之前或之后**（两者无顺序依赖，建议放其后，与 RULE 的「事务提交后」一致）加：
     `await clearSessionPromptCaches(sessionId, createSessionKkvService(this.conn));`
   - **只在 `sessionTemplatePull` 里加**，`sessionTemplatePush`（`:38-49`）**不加**：push 是「会话 → 项目」方向，会话侧文件树不变、会话自己的 `file_cache` 依然有效；清了反而会让下一 step 的 workplace 前缀无谓重算。
2. **不要**改 `clearSessionPromptCaches` 的错误口径。它是 best-effort 整体吞错 + `console.warn`（`:48-53`），与 RULE 拍板一致；模板拉取的失败语义同样是「文件已落库，缓存对齐失败只影响下一次提示词重评估」，裸 await 上抛会让一次成功的拉取被报成失败。
3. **不要**改 `DefaultTemplatePullService` 的构造函数签名。它目前只接 `conn`（三个调用点：`session.service.ts:250`、`session.service.ts:257`、`create-template-pull-service.ts:17`），在方法内现造 `sessionKkv` 即可，**签名不变 ⇒ 调用方零改动、公开导出面零变化**。
4. 在 `:35` 上方补一行注释，写明「模板拉取是 session scope 的整树覆盖，与角色卡/ZIP 导入同族，必须对齐 prompt 缓存；push 方向不需要」。

### 验收

- **断言 A（两域被清）**：模板拉取前在 session 的 `rule_snapshot` 与 `file_cache` 两域各写一行 → `ctx.sessions.pullTemplate(sessionId)` → 断言两域行数均为 **0**。
- **断言 B（usage 哨兵）**：拉取前在 `usage_stats.toolUseCount` 写一个非空值 → 拉取后断言该值为 **空串**（哨兵而非 delete，`:42-47` 的既有协议）。
- **断言 C（陈旧正文不再续命）**：建会话 → 拉取模板（此时 session 的 `file_cache` 缓存了文件 A 的 "v1"）→ **在项目模板侧把 A 的正文改成 "v2"** → 再次 `pullTemplate` → 组装一次 workplace display → 断言 `<workplace>` 正文含 **"v2"** 而非 "v1"。**这条是本条的核心断言，没有它 A/B 只是清缓存的表层验证。**
  （**取自然形态，不要构造「同 mtime」**：实测 `load-or-fill-file-cache.ts:42-58` 命中即 `return parsed`、全程不比对 mtime，所以「同路径内容一改就命中陈旧缓存」本来就是**最强形态**、也是真实发生的形态。测试侧若硬造「显式指定同一 mtime」只会把用例做窄，并不能覆盖更强的自然形态。）
- **命令**：`cd packages/core && npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test test/workplace/template-pull.test.ts`
  → 期望 `# pass` = 4（现有）+ 3（新增），`# fail 0`。
- **类型**：`cd packages/core && npm run typecheck` → 0 error。

### 测试策略

- 文件：`packages/core/test/workplace/template-pull.test.ts`（**改动既有文件**，该文件已经是模板拉取的专属语料，4 条既有用例全部保留）。
- 新增用例名（3 条）：
  1. `T-P1: 模板拉取后 rule_snapshot / file_cache 两域被清空`
  2. `T-P2: 模板拉取后 usage_stats.toolUseCount 被写哨兵空串`
  3. `T-P3: 同路径内容变更后拉取，workplace 前缀不再命中陈旧 file_cache`（核心断言）——**按自然形态构造**（建会话 → 拉取建立 `file_cache` → 项目侧改 A 的正文 → 再拉取 → 组装断言前缀含新正文），**不要**在用例里显式固定 mtime、也**不要**在注释里写什么「弱化版」的免责说明：`file_cache` 读口本就不比对 mtime，「同 mtime」不是需要额外构造的场景，自然形态就是最强形态。

### 回归线（必须保持绿的既有测试）

- `packages/core/test/workplace/template-pull.test.ts` 全部 4 条既有用例（create 复制 / pull 清 checkpoint 保留消息 / create 仅复制 template 文件 / pull replace 移除孤儿文件）。
- `packages/core/test/vfs/clear-session-prompt-caches.test.ts`（helper 本体 3 组断言，含 `:104` 的「KQV 抛错时不 reject」）。
- `packages/core/test/infra/tokenizer/prompt-token-invalidation.test.ts:313`（`导入对齐（clearSessionPromptCaches）后 KKV 行被清，pending 域保留`）。
- `packages/core/test/vfs/vfs-gc-trigger.test.ts`、`packages/core/test/vfs/vfs-tree-copy-batch.test.ts`（模板拉取底座的 sweep/copy 语义；与 B1-3 同 PR 时这两份是 B1-3 的回归线）。
- `packages/core/test/workplace/workplace-view-cache.test.ts`、`packages/core/test/workplace/workplace-view-cache-smart-sig.test.ts`（两者都把 `renamePrefixInScope` 透传到 baseRepo，见 `:66` / `:73`；本条不改 rename 语义，但拉取后多一次缓存清空可能影响其缓存断言——若红，先看是不是断言依赖了「拉取后缓存仍在」这个本条正要改掉的前提）。
  （**路径更正**：原写法 `packages/core/test/vfs/workplace-view-cache.test.ts` / `...-smart-sig.test.ts` **不存在**，这两份实际在 `packages/core/test/workplace/` 下。）

### 依赖

- **无前置**，可在 Wave B 最先落。
- 与 B1-3 同域（模板拉取底座）：建议同波落地、**分开 PR 分开验收**（B1-3 改的是 `replaceVfsSubtree` 的 GC 顺序，B1-5 改的是 template-pull service 的收尾，回归线不同）。

### 风险与回滚

- **风险（低）**：新增一次两域清空 + 一次 token 失效，代价是拉取后的第一次 workplace 组装要重算（一次 file_cache 回填）。用户可感的是「拉取模板后首句稍慢一瞬」，换来的是「不再注入陈旧正文」，方向明确正确。
- **风险（须核）**：`clearSessionPromptCaches` 会写 `usage_stats.toolUseCount` 哨兵。若某个既有测试在「拉取模板 → 断言工具调用数」的链路上依赖拉取前的缓存值，会红。处置：把该断言改为显式重算（读口本就支持 miss 时现算），**不得**因此去掉哨兵写入。
- **回滚**：service 单文件加一行调用 + 两个 import，回退成本两条 hunk。回滚后行为回到今天（继续用陈旧缓存）。

---

## B1-6 · RT-01 gemini 协议下每 step 全可见正文拉回、无 memo（§8.1 终裁 P1）

**严重度 / 簇**：P1 / core-runtime（原 P0，§8.1 主代理终裁降为 P1，2026-10-01）

### 病症

agent runner 在 gemini 协议下，**每个 step 独立发一次「全部可见消息」的全列读**（`MESSAGE_SELECT_COLUMNS` 21 列，含 `content_json` / `raw_json` / `attachments_json`），**无进程内 memo、无失效点**。

消费方 `buildToolUseLookup` 只要 `tool_use` 块的 `id` 与 `name` 两个字段——**21 列正文里 20 列是白拉的**。多步 run 里这条读发 N 次，且每次都把全量可见正文物化一遍（`JSON.parse` 每行一次）。

已由 `e2d10b3f` 修掉的那一半（「含 hidden」）不再计入本条：`listVisibleSessionMessages` 已下推 `includeHidden: false` 到 SQL。明文化链（`v1.5.29`）又把单行成本从 `inflate` 降到 `JSON.parse`，量级显著下降——这是 §8.1 把它从 P0 降到 P1 的依据。**残留的这一半（无 memo + 21 列）原封不动，是本条的全部标的物。**

### 证据

`packages/core/src/service/agent/impl/agent-runner.ts:604-606`（step 循环内）：

```ts
604	        let toolUseLookupMessages: readonly ChatMessage[] | undefined;
605	        if (protocol === "gemini" && this.deps.listVisibleSessionMessages != null) {
606	          toolUseLookupMessages = await this.deps.listVisibleSessionMessages();
```

无 memo、无失效点，每 step 一发。依赖的装配在 `packages/core/src/service/agent/logic/assemble-agent-runner-deps.ts:73-76`：

```ts
73	    listVisibleSessionMessages: () =>
74	      input.runtime.messages.listBySession(input.toolCtx.sessionId, {
75	        includeHidden: false,
76	      }),
```

读口宽度在 `packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:28`：`MESSAGE_SELECT_COLUMNS` 共 21 列。消费方在 `packages/core/src/infra/llm-protocol\logic\gemini-content-mapper.ts:54-71`（`buildToolUseLookup`，只读 `block.id` / `block.name`）与 `:334-341`（`lookupSource` 的选择与 `ctx` 构造）。

**行号修正**：台账 §8.1 记的是 `agent-runner.ts:604-606`（`fe79b781` 现行）——**与本分片核对一致，无漂移**。`gemini-content-mapper.test.ts` 里那条「可见集完备性」等价断言台账记在 `:427-465`，现行是 **`:386`**（用例名 `W2 收窄等价：可见-only 查找源与全量源对已归一化历史输出逐字段全等`）。

### 修法（文件 · 函数级）

**选定方案：按「本 step 有没有触发压缩」二选一——没触发就复用 `:413` 已拿到的 `visible`，触发了才保留今天那一次读**（终裁给的两个方向之一；选它的理由与被否掉的写法见下方「方案取舍」）。

1. **改** `packages/core/src/service/agent/impl/agent-runner.ts` 的 `run` 方法：
   - 在 `:413` 拿到 `visible` 的地方**另存一份 prepare 之前的数组引用**（例如 `const visibleBeforePrepare = visible;`）。必须另存而不能直接复用同名变量，是因为 `:449` 一带的 prepare 过程会把 `visible` 这个名字**覆写成处理后的数组**。
   - `:604-606` 改为：`stepCompactionEmitted === false` ⇒ `toolUseLookupMessages = visibleBeforePrepare`（**零额外读**）；`stepCompactionEmitted === true` ⇒ 保持今天的一次 `await this.deps.listVisibleSessionMessages()` 重读。
2. **为什么这样就够了**：`:413` 的 `visible`（`session.list()`）与 `:606` 的读**是同一张表、同一个 sessionId、同一个 filter、同一个 `ORDER BY seq` 的全量可见集**——第二次读存在的唯一理由，就是纳入 `:553` `runCompaction` 的压缩产物（`:603` 那句注释「懒求值放在这里是为了纳入本 step 的压缩产物」正是这个意思）。既然如此，判定所需的全部信息就是现成的那个布尔量 `stepCompactionEmitted`，**不需要 memo，也不需要「后缀扩展」判据**。
   - **被否掉的写法（务必不要走）**：「复用上一 step 的读快照 + 判据『当前可见集是该快照的纯后缀扩展』」。它有三重错：① 快照的时间基准在**上一步压缩之后**，而 `visible` 的时间基准在本 step 压缩**之前**，两者不在同一时间基准上；② 上一步执行期间追加的 `assistant(tool_use)` 与 `tool_result` 消息**根本不在那份快照里**，按该判据复用会让第 2 步起的 `toolUseLookupMessages` **丢掉本轮追加的 tool_use id**，`resolveFunctionNameOrNull` 返回 null、tool_result 走孤儿纯文本兜底，**出站 wire 与今天不同**（少了 `functionResponse` / `functionCall` 配对）；③ 后果当场有既有回归作证——`read-ref-production-smoke.test.ts:288-294` 断言 `lookups[1]` 必须含第 1 轮的 tool_use id，按该写法直接打红。
3. **失效作用域的论证（防止实施者反向加多余钩子）**：本条的复用锚在 `run()` 方法体内 ⇒ RULE 列的六类失效里，「置位 / 导入 / 切模型」三类都只在**跨 run** 时才可能发生，**天然被 run 作用域排除，不需要为本条补任何失效钩子**。run 内真正可能发生的只有两类：**纯追加**（`:708` 的 assistant 追加、工具结果追加）与**压缩隐藏**（`:553` `runCompaction`）；前者下一次 `visible` 天然带上了、后者由 `stepCompactionEmitted` 覆盖。回滚 / 改写（`message.service.ts` 那一族）都伴随截尾或发生在两次 run 之间，不在本条的复用路径上。
   - 口径与 RULE「消息纯追加不失效」显式对齐：纯追加在本条同样**不需要任何额外动作**。
4. **消费侧零改动**：`toolUseLookupMessages` 的类型与 `:651` 的传参保持不变，`gemini-content-mapper.ts` 一行都不动。
5. **不要**在 `assemble-agent-runner-deps.ts:73` 那层做进程内缓存：那层是单例装配、跨 run 共享，缓存必须锚在 run 生命周期上，否则会跨 run 续命（这正是 RULE「派生缓存与库同寿命」条警告的形态）。
6. 在 `:604` 上方补注释：写明「本 step 未触发压缩 ⇒ 直接复用 `:413` 的可见集；只有 `runCompaction` 触发过才重读，因为只有压缩会把新的可见集产物带进来」。
7. **与 RT-02 的表述必须统一**（落地前先对齐，别让实施者读成两次读）：RT-02（wave-a A1）在 `:413` 一带改的是 `shouldRequestCompaction` 复用 `visible.length`，本条取的是**同一个数组本身**。两条落地后 `:413` 这一带仍然只有**一次**会话读——统一表述为「`:413` 取一次数，RT-02 取其 `length`、RT-01 取其数组引用」。若两条同 PR 落地，须在两份 spec 里写同一句话。

**方案取舍**：终裁留了两个方向（memo + 失效范式 / tool_use 专查窄读口）。本条取前者的**简化形态**（按 `stepCompactionEmitted` 复用 `visible`）——它比 memo 更简单，且天然没有「快照时点错位」这一类缺陷；memo 中间态与「后缀扩展」判据**已在本条证伪并删除**。备选方向（给 `MessageRepository` 加 tool_use 专查窄读口）**保留为退路**：仅当实施时判定复用 `visible` 仍有风险（例如担心某条尚未掌握的路径会在 step 内改写可见集），才改走窄读口；该读口的**新增归 wave-c1 的「全量读收窄系列」领地**，本分片只写选定方案，备选方案在注记里点名，不在本文件展开。

### 验收

- **断言 A（无压缩 run 零额外读）**：跑一个 3 step 的纯追加 gemini run，在装配层给 `listVisibleSessionMessages` 包一个计数器（`packages/core/test/service/agent/read-ref-production-smoke.test.ts:154` 已有同款收集面 `lookups.push(options?.toolUseLookupMessages ?? [])`，可直接复用该形态）→ 断言计数器在**纯追加**的 3 step run 里为 **0**。
  （期望值的推导：`:606` 那次读现在只在 `stepCompactionEmitted === true` 时发生，纯追加 run 里 `:553` 从不触发 ⇒ 0 次；而 `:413` 的可见集是 `ChatAgentSession.list()` 自己那份，不经这个计数器。旧的「= 1」是 memo 写法的期望值，已随 MF-1 改为 0。）
- **断言 B（压缩后必须重读且含压缩产物）**：同一 run 中触发一次 compaction（隐藏若干行）→ 断言计数器 **≥ 1**，且该 step 的 `toolUseLookupMessages` 内容与「压缩后全量重读」逐条等值（拿复用分支的产物与非复用基线跑一遍 `chatMessagesToGeminiContents`，比对 wire 输出逐字段全等）。
- **断言 C（每一步的查找源都含本轮及此前各轮追加的 tool_use id）**——**这条是本条的核心断言**：把 `read-ref-production-smoke.test.ts:288-294` 的形态镜像进新用例——多 step run 里**逐步**断言 `lookups[i]` 必须含第 1…i 轮各自 tool_use 的 id（例如 `lookups[1]` 含第 1 轮的 id）。**只要实现退化成「复用一份不含本轮新增的快照」或「把查找源截断成数组首条」，这条必红。**
  （旧断言 C 跑的是 `gemini-content-mapper.test.ts:386` 的 `W2 收窄等价`——那是纯函数的静态等价语料、**不经过 runner**，对本条缺陷零覆盖，已换成本条；`W2 收窄等价` 降级为回归线里一条必须保持绿的既有断言。）
- **断言 D（非 gemini 协议零读）**：`protocol !== "gemini"` 时 `listVisibleSessionMessages` 调用次数恒为 0（现有行为 `:605` 的条件分支，复用分支不得越界触发）。
- **命令**：
  - `cd packages/core && npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test test/service/agent/read-ref-production-smoke.test.ts test/infra/llm-protocol/gemini-content-mapper.test.ts`
  - `cd packages/core && npm run typecheck` → 0 error。
- **反向自检（两条都要做）**：① 把 `toolUseLookupMessages` 换成 `visibleBeforePrepare[0]`（只取首条）重跑，**断言 C 必须红**；② 把 `stepCompactionEmitted` 分支去掉（恒复用）重跑，**断言 B 必须红**。

### 测试策略

- 文件（**均改动既有文件**）：
  - `packages/core/test/service/agent/read-ref-production-smoke.test.ts` → 新增 `RT-1A: gemini 纯追加多 step run 不产生额外可见集读（计数为 0）`、`RT-1B: 压缩触发后按新可见集重读且 wire 逐字段全等`、`RT-1C: 每一步的 toolUseLookupMessages 均含本轮及此前各轮追加的 tool_use id`、`RT-1D: 非 gemini 协议零读`。
  - `packages/core/test/infra/llm-protocol/gemini-content-mapper.test.ts` → 新增 `RT-1E: 复用分支与全量重读对 contents[] 输出逐字段全等`（拿两条路径的产物互相比，而不是只断言「没抛错」）。
- 断言形态遵循 RULE「性能护栏取数量级回归线」：**断言读次数（整数计数），不断言耗时**——耗时类断言在并行负载下是假信号源。
- 观测面纪律（RULE「给读路径挂进程内缓存后，既有『读必抛』型断言必须换观测面」同族）：断言打在**依赖注入点的调用计数**上，不打在 `listBySession` 的 SQL 探针上——复用分支落地后 `listBySession` 的调用形态会变，SQL 探针会静默失效。

### 回归线（必须保持绿的既有测试）

- `packages/core/test/service/agent/read-ref-production-smoke.test.ts`（既有 read 引用生产面冒烟，`:154` 的收集面不得被本条改坏；其中 `:288-294` 的 `lookups[1]` 断言**就是本条的牙齿**，必须原样保持绿）。
- `packages/core/test/infra/llm-protocol/gemini-content-mapper.test.ts` 全部 14 条（含 `:386` 收窄等价、`:127` hidden tool_use 经 lookup messages 解析、`:171` 合成 model turn、`:212` orphan 归一）。
- `packages/core/test/service/agent/run-agent-turn.test.ts`、`run-agent-turn-subagent-stream.test.ts`、`agent-runner-captured-block.test.ts`、`cli-run-agent-turn-parity.test.ts`（主/子/CLI 三条装配路径）。
- `packages/core/test/service/agent/agent-abort-registry.test.ts`、`run-agent-turn-abort-registry.test.ts`（复用分支不得让「停止生成」变慢——RULE「两阶段读数第二相必须有投递通道」同族的时序纪律）。
- `packages/core/test/message-checkpoint/backfill-cursor.test.ts` 的 `spyFullSessionReads` 四条用例（`:330/:357/:446/:489`）——复用只发生在 runner 内，backfill 链不受影响，但这两处读口共用 `listBySession`，必须确认观测面没被本条改动波及。

### 依赖

- **硬依赖：Wave A 的 RT-02 必须先落地**（`agent-runner.ts:519` 的 `shouldRequestCompaction` 复用 `:413` 已拿到的 `visible.length`，把每 step 的**两次**独立全会话读减为**一次**）。
  - 为什么是硬依赖：RT-02 是本条的**读数基线**，而且两条**同在 `:413` 一带取数**。RT-02 落地后 `:519` 不再自己读会话，本条再把 `:606` 的那次读在「无压缩」时整条消掉 ⇒ step 内会话读归零。**先落 RT-01 再落 RT-02，测量口径说不清**（两条都改同一处循环体）。
  - 顺序固定：`RT-02（Wave A）→ RT-01（本条）`；两条同 PR 落地时按修法第 7 条统一表述为「`:413` 一次取数，两条各取其所需视图」。
- **读数基线的采集口径**：RT-02 落地后、RT-01 开工前，先在真实会话上记录一次「单 step 会话读的条数 / 耗时」作为对照（台账 §2.2 记 commit message 自陈「每步两发 368.2 → 23.9ms」，本条实施时应以 RT-02 落地后的**本机实测**为准，不照抄该数——RULE「条数/行号/计数类结论一律实测复核」）。
- 与 B1-5 无耦合（B1-5 清的是 KKV 缓存，B1-6 动的是消息读口）。

### 风险与回滚

- **风险（主要）：复用了错的那一份数组 ⇒ gemini wire 输出变化**。这是本条唯一的正确性面，两个必须钉死的实现点：① `:413` 处另存的是 **prepare 之前**的那份可见集（误用 `:449` 之后被覆写的同名变量，会让查找源与今天不同）；② 判定量必须是 `:411` 的 `stepCompactionEmitted`，**不能**换成「可见集长度是否变化」之类的启发式——压缩若隐藏的行数恰好被同 step 的追加抵消，长度判据会漏判。断言 B / C 分别覆盖这两面。
- **风险（次要）**：memory 驻留。本条复用的是 `:413` 已有的数组引用，**不新增任何驻留副本**（比 memo 方案还少一份上一 step 快照），量级与今天相同，随 run 结束而释放。
- **回滚**：runner 内一处条件 + 一处别名，回退成本两条 hunk。回滚后行为回到今天（每 step 一次全列读），无数据损坏。
- **不做**：不引入跨 run 的进程级缓存；不改 `gemini-content-mapper.ts`；不改 `MessageRepository` 的读口（那是 wave-c1 的窄读口系列）；**不引入 memo 中间态、不引入「后缀扩展」判据**（已证伪，见修法第 2 条）。

---

## B1-7 · §6 #3 `composer-draft` 全有或全无：**第三源复核推翻 P1 立论，降 P2（vestigial 字段硬化）**

> （2026-10-01 主代理裁决：第三源复核推翻 P1 立论，降 P2；详见 `raw/sr1-core1-c.md` R-1/R-2）

**严重度 / 簇**：**P2** / core-data（domain/chat 持久化解析）｜**复核结论：代码形态成立，但生产不可达**（原台账 §6 待验证节以 P1 入账，经第二源立论、第三源复核后降 P2）

### 病症

`parseComposerDraftJson` 对整份草稿对象做**一次** `safeParse`。草稿的 `attachments` 是数组，任一条附件不合规（缺字段、名字与路径算出来的不一致、被 `superRefine` 拒）⇒ 整个 `safeParse` 失败 ⇒ **函数返回空草稿**，`text` 一并被清空。这个代码形态本身属实。

**但它在当前代码下不可触发**。`composer_draft_json` 的 `attachments` **没有任何写入方能填成非空**：`ConversationPanel.tsx:355-358` 恒传 `attachments: []`、`chat-composer-draft.ts:67-70` 恒传 `attachments: []`、`:88-95/:115-123` 在空态直接写 `null`；core 侧 `SessionService.setComposerDraftJson:267-273` 是**裸字符串透传**，不构造内容。⇒ 草稿列里恒为 `[]` 或缺省，`z.array(...)` 恒通过，`:64-68` 恒不触发。

所以「用户写了一半的正文凭空消失」是**不可达叙事**——本条原先的 P1 立论正是被它自己引用的写侧证据（`ConversationPanel.tsx:347-360` 那段实参就是 `attachments: []`）推翻的。

**残留的真实风险只有一条**：历史存量行里可能存在今天不合法的附件形态。机制上可信（`message-attachment.schema.ts:43-45` 的 `DISPLAY_TAG_NAME_RE` 注释自陈「旧版本确实把 `action:path` 展示 tag 写进过 `name`」，而带 action 的展示 tag 今天会被 `:80-85` 的 `superRefine` 拒），但**有多少行会被判废至今零实测**。

进一步压低危害面：两端水合时本来就把草稿附件整个丢弃——desktop `:335-337` 用 `unionComposerStatusWithAnnotate(status, …)`、mobile `:170` 只保留 `statusOnly` 并注「历史 draft attach chip 丢弃」。所以即便真有一条带附件的草稿，**附件侧也无损失**，净危害只剩正文丢失一条。

⇒ 结论：这条是**残留字段（vestigial field）的潜伏风险**，不是今天正在发生的数据丢失。修它的价值在于「硬化一个语义已经不成立的字段契约」，不在于止血。

### 可达性前置探针（实施前必跑，结果决定定级）

对夹具库与（可得的）真库跑一次统计：**`composer_draft_json` 行的 `attachments` 非空且逐条判废的条数**。

- 探针结果 **> 0** ⇒ 按本条的 P2 修法硬化，正文丢失有真实存量受害面，应在 CHANGELOG 单独点一句。
- 探针结果 **= 0** ⇒ 按 **P3** 处理，并按 dead-backlog 方向考虑直接删掉草稿 schema 的 `attachments` 字段（见「拍板注记」），本条随之缩小或撤下。

探针是纯读统计（`SELECT composer_draft_json FROM chat_session WHERE composer_draft_json IS NOT NULL` 逐条 `JSON.parse` 后数长度），**不得**在探针阶段做任何写回。

### 证据

`packages/core/src/domain/chat/model/composer-draft.schema.ts:64-68`（`parseComposerDraftJson`）——**行号与台账 §6 第 3 行完全一致，本分片逐字核对无误**：

```ts
64	  const result = composerDraftSchema.safeParse(parsed);
65	  if (!result.success) {
66	    return { ...EMPTY_COMPOSER_DRAFT, attachments: [] };   // ← text 一并丢
67	  }
68	  return result.data;
```

数组元素任一不合规即整体失败的机制在 `:30-36`：`attachments: z.array(messageAttachmentSchema).transform(...)`，`messageAttachmentSchema` 内含 `.strict()` 与 `superRefine`（`message-attachment.schema.ts:60-98`，其中 `:87-97` 校验「有 action 时 name 须等于 `attachmentStorageName(path)`」）。

**写侧穷举证据（第三源复核补上的一段，也是 P1 立论崩塌之处）**——`composer_draft_json` 的全部写入方，无一能产出非空 `attachments`：

| 写入方 | 写进去的 `attachments` |
|---|---|
| `apps/desktop/renderer/features/chat/ConversationPanel.tsx:355-358`（唯一 desktop 写点） | 恒 `[]` |
| `apps/mobile/src/storage/chat-composer-draft.ts:67-70`（`persistAttachTextDraft`） | 恒 `[]` |
| `apps/mobile/src/storage/chat-composer-draft.ts:88-95` / `:115-123` | 空态写 `null` |
| `packages/core/src/service/chat/impl/session.service.ts:267-273`（`setComposerDraftJson`） | 裸字符串透传，不构造内容 |

**水合侧本就丢草稿附件（进一步压低危害面）**：
- desktop `ConversationPanel.tsx:328-338` 水合拿到 `text` 并置 `composerDraftHydratedRef.current = true`，但 chip 侧走 `unionComposerStatusWithAnnotate(status, …)`（`:335-337`），草稿附件不并入；随后的持久化 effect（`:347-360`）恒以 `{ text: composerText, attachments: [] }` 序列化。
- mobile `chat-composer-draft.ts:161` `parseComposerDraftJson(raw)` → `:170` 只保留 `statusOnly`，注释自陈「历史 draft attach chip 丢弃」；`:172-176` 在空态 `bySession.delete(sessionId)`，下一次 `writeChatComposerDraftState`（`:115-123`）把 NULL 写回。

### 修法（文件 · 函数级）

1. **改** `packages/core/src/domain/chat/model/composer-draft.schema.ts` 的 `parseComposerDraftJson`（`:52-69`），把「整对象一次判废」换成「**逐条降级**」。第 1 步必须带守卫伪码（原 spec 未规定，照字面实现在 `parsed` 为 number/string/array/null、或 `attachments` 缺失/非数组时会抛 `TypeError`）：

   ```ts
   const obj = isRecord(parsed) ? parsed : null;
   const text = typeof obj?.text === "string" ? obj.text : "";
   const items = Array.isArray(obj?.attachments) ? obj.attachments : [];
   const kept = items.flatMap((item) => {
     const r = messageAttachmentSchema.safeParse(item);
     return r.success ? [r.data] : [];
   });
   const result = composerDraftSchema.safeParse({ text, attachments: kept });
   ```

   - 守卫的理由：`text` 单独取，让「正文永不因附件而丢」成为**结构性保证**，而不是靠运气。
   - **`kept` 过滤之后必须把 `{ text, attachments: kept }` 喂回 `composerDraftSchema.safeParse`**（而不是直接返回 `kept`）。这一举三得：复用 `:32-36` 既有的「非 attach 源剥掉」transform 完成来源分档、保住顶层 `.strict()` 对未知键的拒绝、**并且不把 `composerDraftSchema` 变成零生产消费的公共导出**。
   - 顶层层级判废仍保留：`obj === null`（`parsed` 不是对象）时 `composerDraftSchema.safeParse({text:"", attachments:[]})` 依然通过，所以必须显式 `if (obj === null) return { ...EMPTY_COMPOSER_DRAFT, attachments: [] };`，让断言 D 的既有行为不回归。
   - `isRecord` 若仓内没有现成 helper，就在本文件内定义一个最小的（`typeof v === "object" && v !== null && !Array.isArray(v)`），**不要**为此引新依赖。
2. **不改** `serializeComposerDraftJson`（`:75-95`）：写侧保持「只存合法项」，解析侧的宽容不回灌到写侧。
3. **不改** `composerDraftSchema` 本身（`:27-38`）。此前 spec 声称它「被别的消费方共用」**不成立**——改完之后它的生产消费方只有上面那处 `safeParse`（公共导出在 `packages/core/src/public/chat.ts:49`，既有引用只有 `composer-draft.schema.test.ts:15/:33`）。选上面那条「过滤后再喂回」的路子，正好让这条导出保持**有生产消费**，不必把它登记为死码。
4. 在 `parseComposerDraftJson` 的 JSDoc（`:48-51`）里写明新口径：「非法附件逐条丢弃、**正文永不因附件而丢**；只有顶层不是 `{text, attachments}` 形状时才整体降级为空草稿」，并显式记一笔「与 `parseAttachmentsJson` 的逐条口径对齐」（见 B1-8）。

### 拍板注记：是否直接删掉草稿 schema 的 `attachments` 字段

**这是一个产品决策，本分片不替用户拍，留给用户。** 两边的账摆在这里：

- **删的理由**：按 RULE 的 attach 术语条，attach 被定义为「随消息落库、逐消息的消息级」语义，**草稿附件从来不在该契约内**——两端水合都丢弃它、写侧恒写 `[]`，这个字段已经是纯 vestigial。删掉可让 `:64-68` 的整对象判废与残留风险**一次性归零**，比逐条降级更彻底。
- **不删的理由**：`composerDraftSchema` 与 `messageAttachmentSchema` 的形状耦合会一起松动，改动面比逐条降级大；且历史库里可能仍有带非空 `attachments` 的行（见前置探针），删字段后它们的解析路径要一并处理。
- **与定级的关系**：若前置探针结果为 0 且用户拍板删字段，本条降 P3 并可整体撤下修法段；若探针 > 0，则无论删否，逐条降级那套都要落。

### 验收

- **断言 A（正文不因附件而丢）**：构造 `{ text: "我写了一半", attachments: [<一条非法附件>] }` 的 JSON 串 → `parseComposerDraftJson` → 断言 `result.text === "我写了一半"` 且 `result.attachments.length === 0`。
- **断言 B（部分丢弃）**：`attachments: [合法, 非法, 合法]` → 断言 `length === 2` 且两条都等于输入里的合法项（**顺序保持**）。
- **断言 C（非 attach 源仍剥掉，既有行为不变）**：`attachments: [source:"workplace", source:"attach"]` → 只剩 attach 那条。
- **断言 D（整体非法的输入仍降级为空草稿）**：`JSON.parse` 失败 / `"not-json"` / `null` → 空草稿（既有行为，不得回归）。
- **断言 E（端到端不丢正文）**：在 `packages/core/test/chat/sqlite-session.repository.test.ts` 侧补一条——写入含非法附件的草稿 JSON → `repo.getComposerDraftJson` 读回 → 再走一次 `serializeComposerDraftJson` 往返 → 断言 `text` 仍在。（这条钉的是「读-改-写不把正文吃掉」的整体行为。）
- **命令**：
  - `cd packages/core && npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test test/chat/composer-draft.schema.test.ts test/chat/sqlite-session.repository.test.ts`
  - `cd packages/core && npm run typecheck` → 0 error。
- **反向自检**：把逐条循环改回整对象 `safeParse`，断言 A/B 必须红。

### 测试策略

- 文件（**均改动既有文件**）：
  - `packages/core/test/chat/composer-draft.schema.test.ts` → 新增 `CD-1: 非法附件不牵连正文（text 保留）`、`CD-2: 部分非法附件逐条丢弃且保序`、`CD-3: 顶层非草稿形状仍整体降级为空草稿（既有行为回归锁）`。
  - `packages/core/test/chat/sqlite-session.repository.test.ts` → 新增 `CD-4: 含非法附件的草稿经读-改-写往返后正文不丢`。
  - `apps/mobile/__tests__/chat-composer-draft.test.ts`（**已确认存在**，第三源复核纠掉了原 spec「若移动端有 jest 语料则…」的假设）→ 新增 `CD-5: hydrateChatComposerDraftFromDb 遇非法附件不清空正文`；命令 `cd apps/mobile && npx jest __tests__/chat-composer-draft.test.ts`。
- 断言纪律（RULE「验收断言的『牙齿』」第 ① 条）：断言 A 必须写成「`text` 等于**具体那个非空字符串**」，不能写成「`text` 非空」——后者在返回空串时恒红、返回 `undefined` 时恒绿，两种退化都测不出来。

### 回归线（必须保持绿的既有测试）

- `packages/core/test/chat/composer-draft.schema.test.ts` 全部既有用例（round-trip、`{text:"",attachments:[]}` → null、`null` → 空草稿、`"not-json"` → 空草稿、非 attach 源剥除）。
- `packages/core/test/chat/sqlite-session.repository.test.ts`（`:82/:93/:117/:138` 四处草稿存取断言）。
- `packages/core/test/chat/composer-chip-attachment.test.ts`（composer chip 与草稿附件的联动）。
- `apps/mobile/__tests__/chat-composer-draft.test.ts` 全量保持绿（该文件已确认存在，不再是「若有」）。

### 依赖

无前置。可与 B1-8 合并成一个 PR（两条都在 `domain/chat` 的 JSON 解析层、共用「逐条降级」这一条设计原则，合在一起更容易看清口径统一的价值），但**用例与验收分开写**。

### 风险与回滚

- **风险（低）**：放宽后，历史上因「一条坏附件」而被整体丢弃的草稿，现在会以「正文 + 部分附件」的形式回来。这是**恢复**而非引入错误。唯一的观感差异是：用户可能看到「附件少了几条」而正文在——这正是期望行为（宁可少附件，不可丢正文）。
- **风险（须记，与 B1-8 做分级对照）**：草稿列是**易失的 UI 缓冲**，不是 RULE「原始数据不删」条款的保护对象；净化掉坏附件的风险显著低于消息附件（B1-8 那边动的是 append-only 的历史消息）。同时要讲清楚：「解析宽容 + 写回严格」意味着**一个永久带着坏附件的草稿会在每次读-改-写时被净化一次**——方向是收敛的，但它**属对原始列的静默改写**（写回时原始 JSON 里的坏附件被真正移除），**须在 CHANGELOG 的 `Changed` 段点一句**，不能默默做。
- **回滚**：单函数改写，回退成本一条 hunk。回滚后行为回到今天（继续整体丢弃）。
- **不做**：不迁移存量数据、不加告警日志（解析层打日志在列表读口上会产生噪声；真要观测，用断言语料钉住行为即可）。

---

## B1-8 · §6 #4 附件数组整体降级：**第二源复核成立，按 P1 入账**

**严重度 / 簇**：P1 / core-data（domain/chat 持久化解析 + 消息读口）｜**复核结论：成立，从台账 §6 待验证节入账**

### 病症

`parseAttachmentsJson` 对整条 `attachments_json` 做**一次** `safeParse`。数组里**任意一条**附件不合规 ⇒ 整个函数返回 `undefined` ⇒ `rowToMessage` 组出的 `ChatMessage` **完全没有 `attachments` 字段**。

这不是「少显示一个 chip」，而是**落库历史与送给 LLM 的提示词不一致**，且波及四条独立消费链：

1. **提示词丢正文级信息**：`prepare-user-messages-for-prompt.ts:488-500` 拿 `message.attachments ?? []` 决定是否 hydrate `<action name="userAttach">` 块。附件整体消失 ⇒ **agent 永远看不到用户当时附上的文件内容**（文件树还在、`<workplace>` 还在，但那条 attach 的正文/批注意见彻底不进提示词）。
2. **回滚批注丢失**：`message-content-helpers.ts:35-39` 的 `hasAnnotateAttachment` 恒 false ⇒ `isPlainUserText` 语义偏移 ⇒ `apps/mobile/src/screens/tabs/chat-tab/useChatTabMessageActions.ts:222` 的 `mode === 'undo_send' ? target.attachments ?? [] : null` 拿不到批注 ⇒ **回滚后批注意见恢复不回来**。
3. **短提示 seen 集缺项**：`agent-runner.ts:486-496` 遍历 `m.attachments` 收集 `skillAttach` 技能名填 `skills.referencedNames`；附件缺失 ⇒ 技能短提示的 seen 集缺项。
4. **导出合并口径**：`normalize-for-llm-export.ts:59-61` 的 `hasNonEmptyAttachments` 恒 false ⇒ **带非空 attachments 的 user 消息会被误判为可与相邻 plain chat 合并**，导致导出 transcript 的分段与原文不一致。（该函数唯一调用点是 `canMergeAdjacent`，不是导出口径本身——第三源复核纠掉了原 spec 写的函数名 `hasAttachments` 与危害描述。）

零 log、零 warn、零计数——降级完全静默。

### 证据

`packages/core/src/domain/chat/model/message-attachment.schema.ts:109-126`（`parseAttachmentsJson`）——**行号与台账 §6 第 4 行完全一致，逐字核对无误**：

```ts
109	export function parseAttachmentsJson(
112	  if (raw == null || raw === "") { return undefined; }
116	  try { parsed = JSON.parse(raw); } catch { return undefined; }
121	  const result = messageAttachmentsSchema.safeParse(parsed);
122	  if (!result.success) {
123	    return undefined;          // ← 整数组判废
124	  }
125	  return result.data;
```

消费点 `packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts:140-143`（`rowToMessage`）：

```ts
141	  const attachments = parseAttachmentsJson(
142	    row.attachments_json == null ? null : String(row.attachments_json)
143	  );
...
161	    ...(attachments != null ? { attachments } : {}),   // undefined ⇒ 字段整体缺席
```

**行号修正**：台账 §6 第 4 行与 §4.2 记的消费点是 `sqlite-message.repository.ts:97-99`；`fe79b781` 现行代码里该调用在 **`:141-143`**（`:91-103` 现在是 `runInTransactionOrConn`，与附件无关）。**以 `:141-143` 为准。**

元素级严格性的来源：同文件 `:60-98` 的 `messageAttachmentSchema` 含 `.strict()`（未知键拒绝）与两条 `superRefine`（路径/动作一致性、`:87-97` 的 name 必须等于 `attachmentStorageName(path)`）。附件形态跨版本演进过，所以「历史行里存在今天不再接受的形态」是**现实会发生的**，不是理论风险。

### 修法（文件 · 函数级）

1. **改** `packages/core/src/domain/chat/model/message-attachment.schema.ts` 的 `parseAttachmentsJson`（`:109-126`），改为逐条降级：
   - `JSON.parse` 失败 ⇒ 仍返回 `undefined`（整段不是 JSON，没有可 salv 的粒度；此行为不变）。
   - 解析成功后：若不是数组 ⇒ 返回 `undefined`（形状不对，同样无粒度可 salv）。
   - 是数组 ⇒ **逐条** `messageAttachmentSchema.safeParse(item)`，只保留成功的；**全部失败时返回 `[]`**（而不是 `undefined`）——`[]` 与 `undefined` 在消费侧等价（`?? []` / `?.length ?? 0`），但返回 `[]` 让「本来就没附件」与「全被丢弃」在下游表现一致，且 `serializeAttachmentsJson([])` → NULL 的往返不引入差异。
   - **保持与 B1-7 完全同构的口径**（逐条 `safeParse` + 丢弃非法项），两条一起 review 时能一眼看出是同一条设计原则的两个落点。
2. **不改** `serializeAttachmentsJson`（`:131-138`）与 `messageAttachmentsSchema`（`:101`）。
3. **不改** `rowToMessage`（`sqlite-message.repository.ts:140-163`）：`:161` 的 `...(attachments != null ? …)` 在新口径下要么拿到数组、要么拿到 `undefined`（仅 JSON.parse 失败），语义正确、无需动。
4. 在 `parseAttachmentsJson` 的 JSDoc（`:106-108`）里写明新口径与理由：「一条不合规不牵连其余；只在整段不是合法 JSON 数组时整体降级。**理由**：消息是 append-only 的历史数据，附件形态跨版本演进，宁可少附件也不可让整条消息的附件静默蒸发——那会造成落库历史与送给 LLM 的提示词不一致。」

### 验收

- **断言 A（一条不牵连其余）**：构造 `[{合法A}, {含未知键的非法项}, {合法B}]` 的 JSON → `parseAttachmentsJson` → 断言 `length === 2` 且 `[0]`、`[1]` 分别等于合法A、合法B（**保序**）。
- **断言 B（全非法 ⇒ 空数组）**：全是非法项 ⇒ 返回 `[]`（不是 `undefined`、不是 `null`）。
- **断言 C（非 JSON ⇒ 仍 undefined）**：`"not-json"`、`null`、`""` ⇒ `undefined`（既有行为回归锁）。
- **断言 D-1（非数组 ⇒ `undefined`）**：`"{\"a\":1}"`（JSON 对象）、`"null"`、`123` ⇒ 返回 `undefined`。
- **断言 D-2（标量元素数组 ⇒ `[]`）**：`"[1,2]"`、`"[null]"`（元素不是对象）⇒ 逐条全丢 ⇒ 返回 `[]`。
  （原 spec 把 `"[1,2]"` 同时列进这两栏，自相矛盾，此处拆成两条。）
- **断言 E（端到端：消息仍带合法附件）**：`packages/core/test/chat/message-attachments.round-trip.test.ts` 侧补一条——落库一条含「一条合法 + 一条非法」的消息 → `listBySession` 读回 → 断言 `msg.attachments.length === 1` 且等于那条合法附件。**这条是核心断言**（它才是「用户仍看得到 chip、agent 仍看得到 attach 正文」的真正观测面）。
- **断言 F（历史行判废探针 · 非阻断）**：对夹具库统计「`attachments_json` 非空行数」与「逐条判废后存活行数」，**把差值写进用例注释**（不写成硬断言，因为差值取决于夹具数据、不是行为契约）。真机上以 `SELECT COUNT(*) FROM chat_message WHERE attachments_json IS NOT NULL` 起步。
  RULE「条数/行号/计数类结论一律实测复核」要求这个数**不许照抄任何既有报告或台账里的数**，必须本机跑出来填。
- **命令**：
  - `cd packages/core && npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test test/chat/message-attachment.schema.test.ts test/chat/message-attachments.round-trip.test.ts`
  - `cd packages/core && npm run typecheck` → 0 error。
- **反向自检**：把逐条循环改回整数组 `safeParse`，断言 A/E 必须红。

### 测试策略

- 文件（**均改动既有文件**）：
  - `packages/core/test/chat/message-attachment.schema.test.ts` → 新增 `MA-1: 单条非法附件不牵连其余（保序）`、`MA-2: 全部非法 ⇒ 空数组`、`MA-3: 非 JSON / 非数组 ⇒ 仍返回 undefined（既有行为回归锁）`。
  - `packages/core/test/chat/message-attachments.round-trip.test.ts` → 新增 `MA-4: 含单条非法附件的消息读回后仍带合法附件`。
  - `packages/core/test/chat/message-content-helpers.test.ts`（**已确认存在**，第三源复核纠掉了原 spec「若存在；不存在则不加」的保守话术）→ 新增一条消费链 #2 的观测面：整数组判废时 `hasAnnotateAttachment` 对**部分非法**的附件数组恒 false，修复后应只认存活的那条。
- 与 B1-7 的 `CD-1/CD-2` 形成对照语料（同一设计原则的两个落点），reviewer 可横向比对。

### 回归线（必须保持绿的既有测试）

- `packages/core/test/chat/message-attachment.schema.test.ts` 全部既有用例。
- `packages/core/test/chat/message-attachments.round-trip.test.ts`（往返语料，本条改的就是这条链的读侧）。
- `packages/core/test/chat/composer-chip-attachment.test.ts`、`parse-annotate-drafts-from-attachments.test.ts`、`scan-at-path-attachments.test.ts`、`scan-skill-attachments.test.ts`（附件消费面四族）。
- `packages/core/test/service/agent/read-ref-production-smoke.test.ts`（`agent-runner.ts:486-496` 的 skillAttach seen 收集依赖附件不丢）。
  **行号修正**：原 spec 写的 `packages/core/test/agent/read-ref-production-smoke.test.ts` 路径**不存在**——该文件实际在 `test/service/agent/` 下（与 B1-6 回归线同一份）。
- `packages/core/test/chat/message-content-helpers.test.ts`（**列入**，理由：它是消费链 #2 的回滚批注观测面，`hasAnnotateAttachment` / `isPlainUserText` 的语义偏移由它兜底）。
- `apps/mobile/__tests__/use-chat-tab-message-actions-rollback.test.ts`（**已确认存在**，第三源复核补入）——它正是消费链 #2（`useChatTabMessageActions.ts:222` 的 `mode === 'undo_send'`）的移动端观测面。
- `packages/core/test/chat/composer-draft.schema.test.ts`（与 B1-7 共用 `messageAttachmentSchema`，两条同 PR 时它是共同回归线）。

### 依赖

- 建议与 B1-7 同 PR（设计原则同源、共用回归线），用例与验收分开。
- 不依赖任何 Wave A/B 条目。

### 风险与回滚

- **风险（低）**：逐条降级后，原本「整条消息无附件」的历史行会变成「带部分附件」。下游全部消费方都是宽容读法（`?? []`、`?.length ?? 0`、`.filter(...)`），不会因此报错。
- **风险（须记）**：**这会让历史消息的附件「复活」**——包括那些当初因不合法而被静默丢弃的。用户可能看到很老的附件重新出现。这正是修复的目的（数据本来就在库里），但属可感知变化，应在 CHANGELOG 里点一句。
- **风险（已排除）**：逐条 `safeParse` 会把「一条消息几十条附件」的解析成本从 1 次 array 校验变成 N 次单项校验。附件数量级是个位数，净成本可忽略；且省掉了后续消费方对 `undefined` 的分支判断。
- **回滚**：单函数改写，回退成本一条 hunk。回滚后行为回到今天（继续整数组判废）。

---

## 分片级注记

### 与 wave-c1 的边界

1. **全量读收窄系列不归本分片**。台账 §10 Wave C 的「全量读收窄系列」（CD-01 fork 缺上界读口、`truncateAfter`、`subagent-tool.ts:219`、RULE 记录的 5 处名单，以及 §0.4 第 4 条提到的 `listBySessionOffset` 头投影等）**全部属 wave-c1**。本分片只写 **RT-01 的读取范围复用本体**（B1-6）。
2. **RT-01 的备选方案（tool_use 专查窄读口）也不在本分片展开**。若实施 B1-6 时判定「复用 `:413` 的 `visible`」这条路风险过高而改走窄读口，**新增的 `MessageRepository` 读口必须移交 wave-c1 统一收口**，本分片只负责提出移交，不落该读口的实现步骤。理由：读口新增会改变 `listBySession` 家族的观测面，而 wave-c1 正在做同一族的读口替换，两边各自加读口会造成第二次「换了实现、断言静默失效」（RULE 明载的前车之鉴）。
3. **事务边界收窄系列不归本分片**。CS-05 分片提交、backfill 移出事务、CS-11 copy header 投影、CS-06→CS-07 revision 对齐、CS-09 ZIP 闸、CS-10 AST 分片 —— 全部属 wave-c2。本分片的 B1-3 虽然动了 `replaceVfsSubtree` 的调用序，但**不是事务边界问题**，两者不重叠。
4. **CS-07 的归一纪律**：台账 §2.4 把 CS-07 列在 Wave B 的「P1-S 批次」与 Wave C 的 revision 对齐两处。本分片**不写 CS-07**（归 wave-b-core2 按 §2.4 原文写全）。B1-2/B1-3 与 CS-07 无耦合：它们动的是「删除链少释放/不释放引用」，CS-07 动的是「DELETE 触发器少判一个 NOT EXISTS」，不在同一处。
5. **N-P1-02（`normalizeAgentPromptLayout` 白名单漏字段）不归本分片**（归 wave-b-core2）。它与 B1-4 是**两个不同的塌缩方向**：N-P1-02 是「域形态 → wire 白名单重建时漏字段」，B1-4 是「域形态 → wire 映射时同名块塌缩」。两者都在 `agent-definition.schema.ts` 附近但代码路径不同，**不得合并成一条**。

### 本分片未覆盖但需下游知晓的三处

- **§6 #6 / #7 / #1** 由其他分片复核（#1 归 M-25、#6 并入 N-P1-05 的 P2 侧、#7 产品待确认），本分片不重复复核。
- **§6 #8 gemini 同名并行调用塌陷**（`gemini-sse-parser.ts`）归 wave-c1。**注意它与 B1-6 的 `buildToolUseLookup` 是两处不同的 map 归并**（一个在协议解析层的 SSE 累加器、一个在出站映射层的 tool_use lookup），不要在实现 B1-6 时顺手"统一"它们——协议层那条的修法是归并键，与本条的读取范围无关。
- **`createRevisionRefCountRepairOperation` 未注册**（台账 §7 ★15）会放大 B1-2/B1-3 的意义（本条修完后本该有的回收路径才第一次真正生效），但**修注册是独立拍板项，不在本分片**。本分片只保证「主路径的引用释放 + GC 顺序正确」，不依赖 repair 兜底。

### 拍板项对本分片的影响

- 本分片 **8 条全部不 `blocked-by-decision`**：不涉及 ★1/★3/★4/★5/★16/★17 中的任何一项（B1-6 依赖的是 Wave A 的 RT-02，**不是**拍板项；B1-8/B1-7 涉及的 `searchMessages` 与 LIKE 粗筛口径（★17）**不在本分片的改动面内**，两条都只碰 JSON 解析函数，不碰 SQL 谓词）。
- 唯一需要下游知晓的语义决策：**B1-7 / B1-8 都把「整体判废」放宽成「逐条降级」**。这会让历史数据里此前被静默丢弃的附件/草稿内容复活。属可感知变化，建议进 CHANGELOG 的 `Changed` 段各一句；若用户不接受「复活」，备选案是「逐条降级 + 对被丢弃项打一次性 warn」（成本是解析层日志噪声，且列表读口会反复打），默认案取前者。

---

*本分片由 `s-core-b1` 撰写。全部 file:line 与引文均在 `fe79b781` 工作树（`D:\Dev\nm-worktree\mcr`）逐行核对；台账行号有漂移处已在对应条目的「行号修正」栏显式标注。*
