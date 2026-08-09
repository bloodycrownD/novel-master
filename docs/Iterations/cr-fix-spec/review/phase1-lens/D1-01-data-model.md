# D1-01：数据模型 & 持久化（L1 角度横扫）

## 元信息

- 角度/模块：L1 数据模型 & 持久化（横扫 `packages/core` 全部带持久化的 context）
- 范围：
  - `packages/core/src/bootstrap/`（13 个 schema 文件 + 8 个迁移脚本 + schema-align）
  - `packages/core/src/bootstrap/novel-master-bootstrap.ts`（聚合引导）
  - `packages/core/src/domain/{vfs,chat,provider,workplace,message-checkpoint,agent,regex,session-kkv,kkv,sksp}/`（model + repositories/impl）
- 参考文档：
  - `docs/review/guides/lens-L1-data-model.md`
  - `docs/review/phase0/D0-1-code-map.md` §5 持久化分布
  - `docs/review/phase0/D0-2-docs-index.md` §4 L1 角度 × 迭代映射
  - `docs/Iterations/message-visibility/features/hidden-column-in-ddl/{prd,spec}.md`
- 轮次：第 1 轮（无回派）
- 产出日期：2026-08-05

## 结论（叙述式）

诶～这一份扫下来比想象中干净不少，但坑也确实有，主要集中在 vfs 那一坨和迁移窗口的边角。先把整体判断说在前面，再展开具体发现。

整体来看，这套持久化的**底盘是稳的**——所有 13 张表的 canonical DDL 全部用 `CREATE TABLE IF NOT EXISTS` 写成幂等形态，8 条 schema migration 也都带了显式的 `PRAGMA table_info` 探测守卫，重跑不会炸。时间戳字段全局统一用 `_ms` 后缀（毫秒 INTEGER），没出现「一处秒一处毫秒」那种典型归一化翻车。FK 用得很克制，只有 `llm_saved_model → llm_provider` 和 `regex_rule → regex_group` 两处带 `ON DELETE CASCADE`，其余跨表关系（比如 `message_checkpoint_file.entry_id → vfs_entry.entry_id`）刻意不挂 FK，靠应用层 + `ref_count` 维护——这是一种有意识的设计选择，不是疏漏。

但是 schema 的**历史包袱非常重**，几乎全集中在 vfs 这一个 context 里。`vfs_entry.content` 列在 canonical DDL 里仍保留为 `TEXT NULL`，但新代码路径已经永远不写它了，只作为 `vfs-content-blob-zlib-v1` 迁移窗口期的「遗留明文回退」兜底用——换句话说，稳态库里这列永远是 NULL，却还要被每次 `SELECT * FROM vfs_entry` 类查询拉进结果集（实际 repo 都显式列了字段，所以成本可控，但 schema 噪音是实实在在的）。更关键的是 vfs 同时挂着**两个语义不同的引用计数器**：`vfs_content_blob.ref_count`（由 3 个 SQL 触发器在 revision INSERT/DELETE/UPDATE 时维护，归零自动删 blob 行）和 `vfs_revision.ref_count`（由应用层在 checkpoint 增减时维护，用于 revision 可达性 GC）。两套计数器靠 spec 注释声明「并存不矛盾」，但这是典型的复杂度陷阱：任何后续动 revision 或 blob 表结构的迁移，都得同时想清楚这两套计数器在新形态下怎么对齐——`vfs-entry-id-redesign-v1` 已经在这上面打了大量补丁（双路径 rebuild + ensureBlobRefCountColumn 双保险），下一轮大改大概率还得再踩一次。

另一个值得拿出来单说的是 **session-fs 这个 context 的空壳化**。Phase 0 把 session-fs 列进「重叠嫌疑」里和 session-kkv / kkv 一起查，但实际打开 `bootstrap/session-fs/session-fs-schema.ts` 会发现里面就一句注释——「legacy tables removed in message-checkpoint v2」，`SESSION_FS_SCHEMA_STATEMENTS` 是个空数组。也就是说 session-fs 这个 context 已经被清理成纯历史名目了，它的持久化职责被 message-checkpoint 接过去了。这不算问题，反而是一次干净的退役，但 phase0 的「重叠嫌疑」可以就此澄清：真正的 KV 体系只有两层（全局 `kkv_entry` + 会话级 `session_kkv_entry`），主键设计也是规整的 `(module, key)` vs `(session_id, domain, key)`，职责分得开。剩下的 kkv 与 session-kkv 之间没有 schema 层面的冲突，只是测试都极稀疏（D0-1 已记录），数据正确性保障不足——那是 L7 的事。

最后是**热路径上的一个 N+1**：`SqliteMessageCheckpointRepository.insertCheckpoint` 在写 `message_checkpoint_file` 时是 `for (const file of input.files)` 逐条 `INSERT`，每条都过一次 TDBC 模板渲染 + 桥接往返。这条路径是「带 mutating tools 的 agent 消息落 checkpoint」——典型场景下一次能捕获几十个文件，意味着几十次串行往返。同 repo 里别的批量操作（比如 `listFilePointersForMessages` 的 IN clause、revision repo 的 `findMetasByEntryVersions` 分块 OR）都老老实实做了 batching，唯独这个 insert 漏了，对比之下比较显眼。归到 A 级，因为它确实在用户可感知的关键路径上。

## 角度 × 模块 矩阵

下面按持久化 context 各给一段独立结论，不写总账。

### vfs（3 表：`vfs_entry` / `vfs_revision` / `vfs_content_blob`）

最复杂、债务也最集中的 context。三表设计本身是合理的分层：`vfs_entry` 是「当前文件系统状态」、`vfs_revision` 是「append-only 历史版本」、`vfs_content_blob` 是「内容寻址存储 + zlib 压缩」。但 schema 里塞了三处迁移期的「脚手架列」没拆——`vfs_entry.content` 永远不再写、`vfs_revision.ref_count` 和 `vfs_content_blob.ref_count` 是两套并存计数器（语义不同，但都需要后续 migration 持续维护）。迁移脚本是全仓库最长的（`vfs-entry-id-redesign-v1` 一条就 365 行），双路径 rebuild（旧库 rebuild + 新库 ensure）的复杂度全部外溢到了 schema 层。`SqliteVfsEntryRepository.delete` 在 recursive 分支走的是 `LIKE #{pattern} ESCAPE '\\'` 前缀扫描后一把 DELETE，索引 `idx_vfs_entry_scope_path ON (scope_key, path)` 能用上，OK。N+1 风险点在 `resolveEntryPlainContent` / `resolveRevisionPlainContent`：每次 row 转 domain 对象都会单独去 `vfs_content_blob` 取一次正文，如果上层一次性拉多条 revision 再逐个 rowToRevision，就是隐性的 N+1——好在 revision repo 的批量方法（`findMetasByEntryVersions` 等）都只返回 meta 不解正文，避开了一个大坑。整体健康度：**B**（schema 没坏，但每次大改都要付迁移税）。

### chat（4 表：`chat_project` / `chat_session` / `chat_message` + index）

设计最规整的 context。三张实体表 + 一个 `idx_chat_session_project` 索引，主键全 TEXT，时间戳全 `_ms`。`chat_message` 用 `UNIQUE(session_id, seq)` 复合唯一约束天然带来前缀索引，session 内分页查询（`listBySessionPage`、`listBySessionTail`）都能命中。`hidden INTEGER` 列和 `DELETE FROM chat_message` 并存——表面看像「软删 vs 硬删混用」，但实际语义是分开的：`hidden` 控制 LLM prompt 渲染时的可见性（消息仍在历史里），`DELETE` 才是真删（rollback / 重发场景）。`message-visibility` 迭代的 spec 里把这个 distinction 写得很清楚，不算设计混乱。`agent_config_json` 列同时挂在 `chat_session` 和 `chat_project` 上，但 model 类型（`ChatSession` / `ChatProject`）故意不带这个字段——走 separate `getSessionAgentConfig` / `setSessionAgentConfig` 方法存取，这是 chat context 一以贯之的「JSON blob 列单独走方法」模式，type 与 schema 不直接对应但有意为之。整体健康度：**A-**（稳）。

### provider（3 表：`llm_provider` / `llm_saved_model` + index）

带 `protocol CHECK (protocol IN ('openai','anthropic','gemini'))` 约束——这是全仓库唯一一处用 CHECK 的地方，把协议枚举钉死在 schema 层，新增协议必须改 DDL。`llm_provider` 同时有 `id PRIMARY KEY` 和 `builtin_key UNIQUE` 两套身份键，这是给内置 provider 用的：用户可以改自己的 provider id 但内置匹配靠 `builtin_key` 稳定不变。`SqliteProviderRepository.update` 故意不写 `builtin_key`（不可变身份），insert 写 update 不写——这是设计，但 schema 和写入路径的字段集不一致，第一次读代码会有点懵。`llm_saved_model.provider_id` 是全仓库唯一带 `ON DELETE CASCADE` 的 FK 之一，配 `idx_llm_saved_model_provider` 索引，删 provider 时 cascade 不全表扫。整体健康度：**A-**。

### workplace（2 表：`workplace_dir_rule` / `workplace_file_rule` + 2 index）

最简单的 context 之一。复合主键 `(scope_key, logical_path)`，两表结构对称（file_rule 字段是 dir_rule 的子集），都有 `scope_key` 上的索引。表名是 `rename-worktree-tables-to-workplace-v1` 这条 migration 整体改名的产物，schema 已经是稳态。没有 FK、没有触发器、没有 JSON blob 列，纯配置表。整体健康度：**A**。

### message-checkpoint（2 表 + 1 index：`message_checkpoint` / `message_checkpoint_file`）

设计干净但实现有一个 A 级 N+1（见上文结论）。两表通过 `(session_id, message_id)` 复合定位，`message_checkpoint_file` 在 entry_id 化后改用 `(session_id, message_id, entry_id)` 复合主键指向 `vfs_entry.entry_id`——这意味着文件 rename 后历史 checkpoint 仍能命中同一 entry，是个聪明的解耦。`loadFileTree` 通过 `JOIN vfs_entry ON e.entry_id = mcf.entry_id` 拿当前 path，所以 rename 后 tree 自动跟着当前路径走，与 revision 指针语义一致。`insertCheckpoint` 里走「先 decrement 旧 ref → 删旧行 → 插新行 → increment 新 ref」的序列，跨 `message-checkpoint` 与 `vfs_revision` 两个 context 改 ref_count，**没有显式事务包装在 repo 层**（事务由上层 service 控制，这是 port/impl 分层的常态，但 L4 角度需要确认 service 真的把这一串包在事务里了）。整体健康度：**B+**（N+1 拖后腿）。

### agent（1 表：`agent_definition`）

极简单表，主键 `agent_id`，正文全塞在 `prompts_json TEXT NOT NULL` 里。`upsert` 用 `ON CONFLICT(agent_id) DO UPDATE SET prompts_json = excluded.prompts_json, updated_at_ms = excluded.updated_at_ms`——注意这里 update 分支**不写 `created_at_ms`**，所以 conflict 时创建时间会保留，insert 时 created_at_ms 和 updated_at_ms 都设成 now。这个细节是对的，但容易被后续改 upsert 的人踩坏。整体健康度：**A**。

### regex（2 表 + 1 index：`regex_group` / `regex_rule`）

`regex_rule` 字段最多（15 列），但布尔列（`enabled` / `scope_user` / `scope_assistant`）全部用 `INTEGER NOT NULL DEFAULT {0,1}`，repo 在 rowToRule 和 insert/update 两侧都做了 `!== 0` / `? 1 : 0` 的双向转换，type（`boolean`）和 schema（`INTEGER`）一致。`start_depth` / `end_depth` 是 `INTEGER NULL`（对应 model 的 `number | null`），可空语义对齐。`regex-rule.schema.ts` 的 zod 还显式拒绝了 `minDepth` / `maxDepth`（已废弃字段），spec 与 schema 与 model 三方对齐。`regex-system` 迭代是高复杂度区，但数据模型层做得稳。整体健康度：**A-**。

### session-kkv（1 表 + 1 index：`session_kkv_entry`）

`(session_id, domain, key)` 三列复合主键，`set` 用 `ON CONFLICT(...) DO UPDATE SET value = excluded.value` 做 upsert。`clearDomain` / `clearSession` 都是直接 `DELETE WHERE`，没有软删。索引 `idx_session_kkv_session ON (session_id)` 服务于 `clearSession` 这种全 session 清场。整体健康度：**A**。注意点不在 schema 而在测试覆盖（D0-1 已记 1 测试 / 298 行，极稀）。

### kkv（1 表：`kkv_entry`）

`(module, key)` 复合主键的全局 KV，`session-kkv` 的「无 session 版本」。upsert 模式与 session-kkv 完全对称。无索引（靠主键）、无触发器、无 FK。整体健康度：**A**。

### sksp（1 表：`sksp_secrets`）

唯一带加密语义的表：`ciphertext BLOB NOT NULL` + `iv BLOB`（可空，因为 algo 可能是对称无 IV）+ `algo TEXT NOT NULL` + `version INTEGER NOT NULL DEFAULT 1`。主键 `ref` 是密钥引用，整个表只存元数据 + 密文，明文从不在库内出现。这套 schema 本身没数据模型层的问题，但 `iv` 可空 + `algo` 自由文本，意味着不同 algo 的 IV 语义不一致，是 L8（安全）角度的重点核查对象，L1 视角下 schema 与 model 对齐没问题（不展开 model，因为 sksp model 在 `infra/sksp` 而非 `domain/sksp`——这本身是个小的归属问题，但不算 schema 层错误）。整体健康度：**A-**。

## 发现清单

### A `SqliteMessageCheckpointRepository.insertCheckpoint` 逐文件 INSERT 是热路径 N+1

- 位置：`packages/core/src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts:116-130`
- 问题：`for (const file of input.files)` 循环里每条文件都单独 `executeTemplate` 跑一次 `INSERT INTO message_checkpoint_file`。这条路径是「带 mutating tools 的 agent 消息落 checkpoint」，典型场景一次捕获数十个文件，意味着数十次串行 TDBC 桥接往返。
- 依据：同 repo 的 `listFilePointersForMessages` 已经会拼 `message_id IN (...)` 批量取，`vfs-revision` repo 的 `batchAppendWithRefCount` / `findMetasByEntryVersions` 也都做了分块 batching——唯独这个 insert 漏了，对比明显。`vfs-entry` repo 还有 `batchInsertFileEntriesWithHash` / `batchInsertDirectoryEntries` 直接走 `this.conn.batch(sql, paramsList)`。
- 建议：把循环改成构造 `paramsList` 后走 `this.conn.batch(sql, paramsList)`（与 `SqliteVfsEntryRepository.batchInsertFileEntriesWithHash` 同模式），或者拼 multi-row VALUES。增量 ref_count 的 `incrementRefsForCheckpointFiles` 在批量 insert 之后再调，顺序不变。
- 涉及角度：L1（数据模型 / 持久化）为主；L5（并发）次要关注批量写是否仍在事务内。

### A vfs 双引用计数器并存，迁移窗口期易踩

- 位置：
  - `packages/core/src/bootstrap/vfs/vfs-content-blob-schema.ts:1-24`（`vfs_content_blob.ref_count`，触发器维护）
  - `packages/core/src/bootstrap/vfs/vfs-revision-schema.ts:13-22`（`vfs_revision.ref_count`，应用层维护）
  - `packages/core/src/bootstrap/schema-migrations/vfs-entry-id-redesign-v1.ts:67-85`（双保险补列 + 初始化）
- 问题：同一个 vfs 体系里挂着两个 `ref_count` 列，语义完全不同。blob 的计数器由 3 个 SQL 触发器自动维护（revision INSERT/DELETE/UPDATE），归零自动删 blob；revision 的计数器由应用层（`incrementRefsForCheckpointFiles` / `decrementRefsForCheckpointFiles` / `repairRefCountFloor`）在 checkpoint 增删时维护，用于 revision 可达性 GC。两套计数器靠注释声明「并存不矛盾」，但任何后续动 revision 或 blob 表结构的 migration，都必须同时想清楚两套计数器在新表形态下怎么对齐——`vfs-entry-id-redesign-v1` 已经为了这点写了大量双路径守卫代码（PRAGMA 探测 + ensureBlobRefCountColumn + Step 6 全表回填），复杂度外溢严重。
- 依据：`vfs-content-blob-schema.ts` 顶部注释自己写明「与 `vfs_revision.ref_count` 是不同层级的计数器，并存不矛盾」——这种需要靠注释维护的心智模型，正是 schema 债务的典型信号。phase0 也把 vfs 标为「复杂度黑洞」。
- 建议：L1 角度只标记，不改代码。中长期可考虑：把 blob 的 ref_count 从触发器维护改成应用层统一维护（消除触发器这一隐式副作用），或者反过来把 revision 的可达性计数也下沉到 SQL 触发器——任一方向都能消除「两套机制并存」的认知负担。但这是个需要专门迭代的设计变更，不是 review 内能定的。
- 涉及角度：L1 主；L4（错误处理 / 事务）强相关——触发器在事务回滚时的行为、应用层 ref_count 在多步写失败时的对账，都是 L4 必查点。

### A bootstrap 事务外跑 `repairRefCounts` 并 `.catch(() => {})` 吞错

- 位置：`packages/core/src/bootstrap/novel-master-bootstrap.ts:106-113`
- 问题：`vfs-entry-id-redesign-v1` 刚 apply 完时，bootstrap 会异步触发 `repairRefCounts(revisionRepo, entryRepo, checkpoints, "global", "/", "")` 作为 ref_count 安全网，但这段跑在 bootstrap 事务**之外**，且 `.catch(() => {})` 直接吞掉 rejection。如果 repair 失败（比如运行时异常、SQL 错误），ref_count 会停留在迁移初始化的值，且没有任何错误信号——而 ref_count 错误会导致后续 GC 误删 revision 或孤儿堆积，是数据正确性问题。
- 依据：注释自承「不阻塞启动，丢 rejection 也不崩」。不崩是对的，但完全不记录就是问题。
- 建议：L1 视角只指出 schema/数据正确性影响面。整改方向是：repair 失败时至少 `console.error` 记录详细上下文（哪个 scope、什么错），或者把 repair 改成幂等可重入的「下次启动重试」机制（写一条 KKV 标记 needs-repair，下次 bootstrap 检查并重跑）。具体的错误处理策略交给 L4。
- 涉及角度：L1（数据正确性影响）+ L4（错误处理，主责）。

### B `vfs_entry.content` 列在 canonical DDL 中保留但新路径永不写入

- 位置：`packages/core/src/bootstrap/vfs/vfs-schema.ts:13-24`（`content TEXT NULL`）；`packages/core/src/domain/vfs/content-store/logic/resolve-stored-content.ts:47-61`（`fields.content` 仅在 content_hash 为空时回退读取）
- 问题：canonical DDL 仍保留 `content TEXT NULL`，但 entry_id 化后的所有新 INSERT 路径（`insertWithContentHash` / `insertAtVersion` 等）只写 `content_hash`，不写 `content`。这列只服务于 `vfs-content-blob-zlib-v1` 迁移窗口期的「未迁明文回退」逻辑，稳态库里永远是 NULL。`vfs-schema.ts` 顶部注释自己写了「§A：暂不删该列，数据模型终态图保留它」——是有意识的保留，但属于 schema 噪音。
- 依据：`vfs-content-blob-zlib-v1.ts` 的 `migratePlaintextToBlobs` 把 `content` 置 NULL 后写 `content_hash`，迁移完成后 `content` 永远是 NULL。
- 建议：下一次 vfs 大改迭代时，考虑在 rebuild migration 里顺手 DROP 这列（SQLite 不支持 DROP COLUMN，得走 _new rebuild，正好 vfs 已经有这套基建）。当前不动。
- 涉及角度：L1。

### B `SqliteVfsRevisionRepository.rowToRevision` 每行单独解正文，隐性 N+1 风险

- 位置：`packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts:391-407`
- 问题：`rowToRevision` 内部 `await resolveRevisionPlainContent(this.contentStore, ...)`，每次都去 `vfs_content_blob` 单独取一次正文。任何「先批量取 revision 行，再循环 rowToRevision」的调用方都会形成 N+1。当前 repo 暴露的批量方法（`findMetasByEntryVersions` / `findExistingEntryVersionKeys` 等）都只返回 meta 不解正文，避开了这个坑；`findByEntryAndVersion` / `listKeysUnderScope` 也都不走 rowToRevision。所以现状没踩雷，但 rowToRevision 这个 private 方法一旦被未来的批量方法误用，N+1 立刻浮现。
- 依据：对比 `SqliteMessageRepository.rowToMessage`——message 的 content 是直接从 `content_json` 列 parse 出来的（同行），不需要二次查询；revision 因为正文存在独立的 content-blob 表，才会有这个二次查询需求。
- 建议：L1 角度只标记隐患。如果未来真要加批量取 revision-with-content 的方法，应该走「先批量取 hash → `WHERE content_hash IN (...)` 一次性取所有 blob → 内存 join」，而不是循环 rowToRevision。
- 涉及角度：L1。

### B `vfs-entry-id-redesign-v1` 与 `vfs-content-blob-zlib-v1` 迁移在循环里逐行 INSERT/UPDATE

- 位置：
  - `packages/core/src/bootstrap/schema-migrations/vfs-entry-id-redesign-v1.ts:161-210`（`backfillVfsEntry`：每条 entry 一次 INSERT + 一次 `SELECT last_insert_rowid()`）
  - `packages/core/src/bootstrap/schema-migrations/vfs-content-blob-zlib-v1.ts:145-244`（`migratePlaintextToBlobs`：按批 SELECT 后逐行 UPDATE）
  - `packages/core/src/bootstrap/schema-migrations/vfs-revision-ref-count-v1.ts:85-94`（per (path, version) UPDATE）
- 问题：三条 migration 都有循环内逐行写入。但这些都是**冷路径、一次性运行**（migration runner 用 `applied` Set 保证每条只跑一次），而且 `vfs-content-blob-zlib-v1` 注释明确说分批是为了「避免一次 SELECT 把整库正文拉进内存导致移动端 OOM 闪退」——是刻意的工程权衡，不是为了 N+1 找借口。
- 依据：migration runner（`runPendingSchemaMigrations`）通过 `schema_migrations` 表的 id-based 幂等保证每条只 apply 一次。
- 建议：L1 角度记录，不改。如果未来某次大库迁移确实慢到用户可感知，可以再考虑批量化（比如 `backfillVfsEntry` 用 `INSERT ... SELECT` + `RETURNING` 替代 last_insert_rowid 循环，但 SQLite 版本 / RN quick-sqlite 的 RETURNING 支持是另一坑）。
- 涉及角度：L1（次要）。

### B `llm_provider` 双身份键（`id` PK + `builtin_key` UNIQUE），insert 与 update 字段集不一致

- 位置：
  - DDL：`packages/core/src/bootstrap/provider/provider-schema.ts:8-19`
  - insert 写 `builtin_key`：`sqlite-provider.repository.ts:97-103`
  - update 不写 `builtin_key`：`sqlite-provider.repository.ts:119-141`
- 问题：`id` 是 PK，`builtin_key` 是 UNIQUE 但可空。insert 时写 `builtin_key`，update 时故意不写（内置 provider 的稳定身份不可变）。这是给内置 provider 匹配用的设计，但 schema 和写入路径的字段集不一致，首次读代码容易困惑「为什么 update 漏了这列」。
- 依据：`provider-identity-v1` migration（`schema-migrations/provider-identity-v1.ts`）就是这套身份重构的产物，phase0 已标注。
- 建议：在 `sqlite-provider.repository.ts` 的 update 方法上加一行注释，说明 `builtin_key` 是不可变身份、update 故意不写。schema 本身不动。
- 涉及角度：L1（次要，主要是可读性）+ L8（身份认证语义）。

### C `chat_message` 同时存在 `hidden` 软隐藏列与 `DELETE` 硬删除

- 位置：`packages/core/src/bootstrap/chat/chat-schema.ts:27-39`（`hidden INTEGER NOT NULL DEFAULT 0`）；`sqlite-message.repository.ts:173-199`（多个 `DELETE FROM chat_message`）
- 问题：表面看是「软删 vs 硬删混用」，但实际语义是分离的——`hidden` 控制 LLM prompt 渲染时的可见性（消息仍在历史里、仍可被搜索/恢复），`DELETE` 是真删（rollback / 重发场景）。
- 依据：`docs/Iterations/message-visibility/` 系列 spec 把这个 distinction 写得很清楚；`message-visibility/features/hidden-column-in-ddl` 还专门把 `hidden` 从 migration 补列升级到了 canonical DDL。
- 建议：不算问题，仅记录。如果团队觉得概念易混淆，可在 `chat-schema.ts` 的 hidden 列上加注释点明「visibility flag, not deletion marker」。
- 涉及角度：L1（记录）。

### C `agent_definition.upsert` 的 `created_at_ms` 在 conflict 时保留，需注释保护

- 位置：`packages/core/src/domain/agent/repositories/impl/sqlite-agent-definition.repository.ts:78-96`
- 问题：upsert 的 `ON CONFLICT(agent_id) DO UPDATE SET` 只更新 `prompts_json` 和 `updated_at_ms`，不动 `created_at_ms`——这是对的（保留首次创建时间）。但 conflict 子句没显式列出 `created_at_ms`，完全靠「不在 SET 里」来保证不变，后续维护者改 upsert 时容易顺手把 `created_at_ms = excluded.created_at_ms` 加进去。
- 建议：加一行注释点明「update 分支故意不写 created_at_ms」。schema 不动。
- 涉及角度：L1（次要）。

### C `vfs_revision.status` 软删除（tombstone）与 `vfs_entry` 硬删除并存

- 位置：`vfs-revision-schema.ts:13-22`（`status TEXT NOT NULL`，取值 `active` / `deleted`）；`sqlite-vfs-entry.repository.ts:409-455`（`DELETE FROM vfs_entry`）
- 问题：与 `chat_message` 类似，revision 用 tombstone（append-only 历史不能真删），entry 用真删（current state）——语义不同，不算混乱。
- 依据：`vfs-revision-storage-optimize` 迭代 spec 应有说明（未深读，按代码注释推断）。
- 建议：仅记录。
- 涉及角度：L1。

## 覆盖声明

查了的：
- 全部 13 个 canonical schema 文件（含 `session-fs`，已确认是空壳）
- 全部 8 个 schema migration（重点读了最长的 `vfs-entry-id-redesign-v1`，其余扫了幂等守卫）
- `schema-align/` 的声明式列对齐清单 + `alignSchemaColumns` 实现
- `novel-master-bootstrap.ts` 的引导主流程（DDL → migration → align → seed → repair）
- 全部 10 个带持久化 context 的 model + repositories/impl（vfs/chat/provider/workplace/message-checkpoint/agent/regex/session-kkv/kkv，sksp 只看了 schema）
- vfs 的 content-store port + impl + resolve-stored-content logic
- 几条关键 zod schema（`session-agent-config.schema` / `regex-rule.schema` / `user-vfs-pending.schema`）

没查的（为什么）：
- sksp 的 model 与 infra 实现——归属在 infra/sksp 不在 domain，L1 视角只确认 schema 与 model 对齐，深入是 L8（安全）的活
- vfs 的 service / logic 层（如 `vfs-path-mapper` / `revision-ref-count` 等）——这些是 L2/L3/L4 的范畴，L1 只看 schema ↔ model ↔ repo 三层对齐
- mobile/desktop/cli 三端消费 core 时的 schema 假设——L6 跨端一致性
- 各 Iteration 的 prd/spec 全文（仅按指导文档「高优先」清单做了扫读式参照，重点对照了 `message-visibility` 的 hidden-column-in-ddl 子 feature）
- cloud-sync 相关——D0-1 标注 cloud-sync 测试极稀疏，但 cloud-sync 是同步层，schema 在 core 侧已覆盖，sync 冲突解决是 L5

## 待交叉的线索

- **与 L4（错误处理 & 事务）强相关**：`SqliteMessageCheckpointRepository.insertCheckpoint` 的「先 decrement 旧 ref → 删旧行 → 插新行 → increment 新 ref」序列跨 message-checkpoint 和 vfs 两个 context 改 ref_count，repo 层没有自带事务——L4 必须确认上层 service 真的把这串包在事务里了，否则 ref_count 会泄漏。同理 bootstrap 事务外的 `repairRefCounts` + `.catch(() => {})` 也是 L4 的核心靶点。vfs 的 3 个 blob ref_count 触发器在事务回滚时的行为也需要 L4 确认（SQLite 触发器与事务的交互在 quick-sqlite / better-sqlite3 上是否一致）。
- **与 L5（并发 & 异步）潜在冲突**：`repairRefCounts` 跑在 bootstrap 事务之外、异步触发，如果此时已有别的 service 在写 revision / checkpoint，ref_count 会被双向改。我（L1）的立场是：ref_count 这个 schema 设计本身是合理的（应用层 + 触发器双层维护），并发竞态是 L5 的判定范畴；如果 L5 判定异步 repair 与正常写入确有竞态，我的发现「双计数器并存」要升级处理优先级。
- **与 L3（架构 & 依赖）潜在冲突**：`session-fs` 这个 context 已经是空壳，但还在 `bootstrap/` 下保留目录 + 一个空 schema 文件。L3 可能会说「这个 context 就不该再存在，应该整体删掉」。如果 L3 说对了，我的「session-fs 已干净退役」结论不变，但建议加上「目录 + 空文件应一并清理」。
- **与 L8（API 稳定性 & 安全）相关**：`sksp_secrets` 的 `iv BLOB` 可空 + `algo TEXT` 自由文本，L1 只看到 schema 与 model 对齐没问题，但 algo 的实际枚举集合、IV 语义随 algo 变化的一致性，是 L8 必查。`llm_provider` 的双身份键设计也需要 L8 从「身份认证稳定性」角度背书。
- **不会与 L2/L6/L7 直接冲突**：数据模型本身不涉及算法复杂度（L2）、跨端 parity（L6）、测试覆盖（L7，但 session-kkv / kkv / bootstrap 测试稀疏是 L7 的事）。
