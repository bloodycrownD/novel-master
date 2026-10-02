---
zone: w9-bootstrap-adv
agent: 辩护人（advocate / defense）
files_scanned: 96
scope: packages/core/src/{bootstrap,index.ts,public,common,config-forms,errors,types}
independence: 未读 raw/ 任何其他报告、未读 synth/ 任何文件
---

# W9 · bootstrap 引导层与公开面 —— 辩护报告

## 摘要

本区是 core 的「库结构收口 + 对外契约面」。`bootstrap/` 用**单次事务**跑完 36 条幂等 DDL、
6 条登记在册的 schema migration、24 项声明式 legacy 列对齐、2 组内置种子，最后写
`PRAGMA user_version`；稳态冷启动按 `user_version` 短路掉 DDL/ALIGN 只跑 migration 与种子。
`public/` + `index.ts` 是三端唯一的 core 出口，由 export allowlist 快照测试锁面。
`errors/` 是纯类型化错误层，`config-forms/` 是双端共享的表单纯逻辑，`common/` 是跨端纯工具。

## 职责与边界

| 目录 | 职责 | 明确不做 |
|---|---|---|
| `bootstrap/` | 建表/对齐/迁移/种子/基线 fail-fast/发号器兜底 | 不做 DROP 列（除 v11 正则退役两条）、不做 KKV 搬迁、不做 wire 迁移、不做存量数据搬运（空占位 migration 禁令） |
| `index.ts` + `public/` | 对外 barrel 与子入口面 | 无实现逻辑，纯 re-export；不含 config-forms（架构守卫测试强制） |
| `errors/` | 类型化错误类 + 工厂函数 + 跨实例 type guard | 不含业务判定逻辑 |
| `config-forms/` | agent 编辑器表单 ↔ `AgentDefinition` 的双向映射与文案 | 不碰 IO |
| `common/` | 跨端纯函数（token 格式化、版本比较、更新说明摘要） | 无状态、无 IO |
| `types/` | `@agnai/*` 两个可选 tokenizer 包的环境声明 | — |

## 对外接口

- 主入口 `index.ts`：`bootstrapNovelMaster` / `NOVEL_MASTER_SCHEMA_STATEMENTS` / `SCHEMA_BOOT_VERSION`
  + 91 个其他具名导出（allowlist 快照锁定，`test/package-exports/snapshots/main-entry-allowlist.json`）。
- 17 个 `public/*` 子入口，其中 12 个有 allowlist 快照（见 F-13）。
- 4 个 `config-forms/*` 子入口（package.json:97-111），desktop 侧经 `apps/desktop/shared/logic/config-forms-*.ts`
  三个薄再导出落地（X1 门禁要求 renderer 不得直连 core）。

## 数据访问

| 资源 | 触点 | 证据 |
|---|---|---|
| `PRAGMA user_version` | 读写两处，整数 pragma 不能参数绑定故拼串 | `bootstrap/novel-master-bootstrap.ts:144`、`:153` |
| `sqlite_master` | 6 处 legacy 形态探测 + 2 处 migration 幂等探测 | `novel-master-bootstrap.ts:193,208,220,238,255,279`；`schema-migrations/workplace-dir-rule-smart-field-v1.ts:60` |
| `pragma_table_info` | `alignSchemaColumns` 每项一次（24 次）+ 3 条 migration 幂等探测 | `schema-align/align-schema-columns.ts:25`；`schema-migrations/index.ts:66`（rename）、`add-smart-sort-capture-kind-v1.ts:30`、`add-mcp-file-path-snapshot-v1.ts:33` |
| `schema_migrations` | `(id, applied_at_ms)` 两列登记表 | `schema-migrations/schema-migrations-table.ts:14-26` |
| `llm_provider` | 内置 provider 种子（5 行固定 UUID） | `provider/seed-builtin-providers.ts:20-39` + `domain/provider/logic/builtin-providers.ts:39-76` |
| `smart_sort_rule` | 内置规则种子（7 行 `builtin-` 前缀） | `smart-sort-rule/builtin-smart-sort-rules.ts:120-138` |
| `kkv_entry` | 技能种子台账 `nm-seeds/agent-config` | `skills/seed-builtin-skills.ts:142-163` |
| `vfs_entry` / `vfs_revision` / `sqlite_sequence` | 发号器兜底 3 条聚合查询，事务后无条件跑 | `novel-master-bootstrap.ts:391-393` → `domain/vfs/logic/entry-sequence-repair.ts:41,44,47` |

## 依赖关系

**import 了谁**：`@/infra/tdbc`（连接协议 + template helper）、`@/domain/{provider,skills,smart-sort-rule}`（种子常量）、
`@/service/{skills,vfs}`（技能种子走 SkillsService 而非裸写 VFS）、`@/infra/content-cache`、`@/service/integrity-repair`。

**被谁消费**：`bootstrapNovelMaster` 全仓 4 个生产入口 —
`apps/desktop/src/main/runtime/connection.ts:41`、`apps/mobile/src/db/connection.ts:80`、
`apps/cli/src/runtime.ts:183`，加 `packages/core/test/helpers/novel-master.ts:66`。

**已知静态环（3 文件）**：`bootstrap/skills/seed-builtin-skills.ts:24` → `service/skills/create-skills-service.ts:9`
→ `service/skills/impl/skills.service.ts:33` → 回到 `seed-builtin-skills.ts`。
环上绑定（`BUILTIN_SKILL_NAMES`、`createSkillsService`）全在函数体内使用，运行时安全；
`public/skills.ts:37` 又把 `BUILTIN_SKILL_NAMES` 从 bootstrap 转出，使 public 层反向依赖 bootstrap 层。

---

# 一、辩护理由清单

## B-1 单事务 bootstrap 是正确取舍，不是「图省事」

DDL、migration、对齐、种子、`user_version` 写全部落在**同一个** `conn.transaction` 内
（`novel-master-bootstrap.ts:346-371`）。SQLite 的 DDL 是事务性的，任一步失败整笔回滚，
不留「表建了一半、版本号已升」的半升级态。这条性质是后面所有纪律（见 B-3、B-4）能成立的前提：
`user_version` 与它描述的表结构永远同生共死，不会出现「版本号说已升级、结构其实没建」的分裂。

紧跟着事务的两个动作**刻意**放在事务外，各有硬理由且都写进了代码注释：

1. `seedBuiltinSkills`（`:373-383`）——`createSkillsService` 内部经 `createScopedVfsService`
   另起连接级装配，放事务内会与外层 `conn` 嵌套冲突（`seed-builtin-skills.ts:169-174`）。
   它种的是可选内容，失败只 `console.warn` 不阻断启动，下次启动幂等重试——**失败方向选对了**。
2. `IntegrityRepairRegistry` 发号器兜底（`:385-409`）——`await` 保证先于任何业务写入，
   同样只记日志不阻断。注释里写明这是导入旧备份库的实测事故兜底。

## B-2 快路径的收益是实测可数的，不是拍脑袋

我数了一遍语句条数（按各 `*_SCHEMA_STATEMENTS` 数组逐条核）：

- 慢路径语句数 = DDL 34 条 + DROP 2 条 + ALIGN 的 24 次 `pragma_table_info` 探测 = **60 条**起步，
  还没算 6 条 migration 的探测与 12 条种子写。
- 快路径 = `readSchemaBootVersion`(1) + `assertMinimumBaseline`(2) + `runPendingSchemaMigrations`(2) + 种子(12) ≈ **17 条**。

对 RN 桥接来说这是 60 → 17，量级差异真实存在，不是微调。`SCHEMA_BOOT_VERSION` 的注释链
（`:53-115`）把 v7 号段冲突、v9/v10 真机 `no such column` 事故、v18 撤回都逐条留痕，
说明这条快路径是被事故驱动出来的、有完整决策史的设计，不是事后补的优化。

## B-3 「加列必须 bump」被测试锁成负面教材，不是靠注释喊

`SCHEMA_BOOT_VERSION` 的注释（`:48-52`）写明纪律，但注释约束力为零。真正的守卫在
`test/bootstrap/message-content-compression-schema.test.ts:259-299`：那条用例**故意**
把两列 DROP 掉、把 `user_version` 顶到当前值，然后断言「快路径不补列」——把事故形态
固化成回归资产。同型守卫还有 `schema-align-columns.test.ts:376`（A12 v8 库）、
`:412`（A13 v11 库）、`:468`（A14 v15 库），每条都断言「补列后 `user_version` 必须等于
`SCHEMA_BOOT_VERSION`」。将来谁把 `SCHEMA_BOOT_VERSION` 静默回退，这 4 条同时红。

`add-mcp-file-path-snapshot-v1.ts:12-15` 还把「pending migration 不受快路径短路」
写成了显式设计声明，并区分了两条通道的适用面——这个区分是理解整套机制的关键。

## B-4 「空占位 migration 禁令」+ 三层分工，各司其职

代码把 schema 变更严格分成三层，边界清晰且每层都有对应机制：

| 层 | 机制 | 载体 | 幂等手段 |
|---|---|---|---|
| 建表 | `CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS` | 34 条 DDL | 语句自身 |
| 补列 | 声明式 `SCHEMA_COLUMN_ALIGNMENTS`（24 项） | `align-schema-columns.ts` | `pragma_table_info` 逐项探测 |
| 改约束 / 改列名 / 数据回填 | `SchemaMigration`（6 条） | `schema-migrations/index.ts` | 形态探测 + `schema_migrations` applied 双保险 |

`alignSchemaColumns` 只 ADD COLUMN、不 DROP、不搬迁（`align-schema-columns.ts:4`），
`afterAdd` 只在该次 ADD 之后触发（`:33` 注释 + `:47` 实现），避免每次 bootstrap 重复全表写——
`vfs_entry.head_version` 那条 `UPDATE ... SET head_version = version` 是全表写，
只在真缺列的库上跑一次。表不存在则整项跳过（`:40-42`），新库由 DDL 建列，零重复。

`schema-migrations/index.ts:56-61` 在 runner 里做**运行时 id 重复检查**（重复即抛），
加上 `bootstrap-no-migrate.test.ts:74-102` 的编译期三断言（id 唯一 + 目录内模块必须注册 +
目录外不得有 `migrate-*.ts`），「登记了但没进数组」和「有文件但没登记」双向堵死。

## B-5 「保守方向 = false」的选择在三处都做了显式论证

`detectLegacyShape` 的每个探针在「查不到 / 结果异常」时都返回 `false`（不拦），
只在**确证是 legacy 形态**时才拦（`novel-master-bootstrap.ts:191-305`）。
`workplace-dir-rule-smart-field-v1.ts:62-70` 更进一步：探测无结果时打 `console.warn`
说明「按未迁移处理」，并引用了「真机 disk I/O error 中间态事故的方向性教训」。

这是把误拦新装用户（灾难性、用户无法自救）与误放老库（可事后补列）对比后选的 lesser evil，
而且方向在代码里是被记录在案的决策，不是疏漏。`assertMinimumBaseline` 本身
（`:314-326`）也只做**存在性**判断：登记表里有一条 baseline id 就放行，
一条都没有**且**探测到 legacy 形态才拦——两个条件是「与」不是「或」，新装空库天然不触发
（`baseline-check.test.ts:121-127` 有专门用例）。

## B-6 内置数据源的「权威归属」被想清楚了，且与服务层门闩共用同一份名单

三组内置数据的权威策略各不相同，且各自匹配数据形态：

| 数据 | 权威方 | 幂等键 | 依据 |
|---|---|---|---|
| 内置 provider | **用户可改**，seed 只补缺 | `builtin_key` | `seed-builtin-providers.ts:13` 「不覆盖用户改动」；服务层 `provider.service.ts:211-219` 禁删 |
| 内置排序规则 | **官方权威**，用户可禁用不可删 | `rule_id`（`builtin-` 前缀） | `builtin-smart-sort-rules.ts:4-8` 「禁用后重启保持禁用」；`delete` 对前缀拒绝 |
| 内置技能正文 | **官方权威**，版本落后即无条件重种 | kkv 台账版本号 | `seed-builtin-skills.ts:8-17`，与 `schema_migrations` applied 记录同构 |

技能那条尤其值得肯定：它没有为「正文存 VFS」重新发明一套幂等，而是**复用 migration 的
「版本落后就执行」语义**，并明确解释了为什么官方文案可覆盖用户改动（内置保留名技能是官方资产，
想定制的用户可复制成新名字，路径不受影响）。`BUILTIN_SKILL_NAMES` 同时供 seed 与
`skills.service.ts:364,422,496,617` 的两道门使用，单一来源无漂移。

provider 种子用 `INSERT ... SELECT ... WHERE NOT EXISTS` 而非 `INSERT OR IGNORE`（`:24-29`），
这个选择是对的：`OR IGNORE` 会连主键冲突一起吞掉，把「id 被占」这类真问题静默掉；
`WHERE NOT EXISTS` 只在业务键缺失时插入，撞 id 会真抛。

## B-7 发号器兜底放在事务后、且无条件跑，方向正确

`vfs_entry` 用 `AUTOINCREMENT`，但导入旧备份库可能让 `sqlite_sequence` 与实际 MAX 脱节，
新建文件会撞 `vfs_revision(entry_id, version)` 唯一键。兜底是 3 条聚合查询
（`MAX(entry_id)` × 2 + `sqlite_sequence` 读），成本可忽略，因此**无条件**跑而不加版本门
（`novel-master-bootstrap.ts:385-389`）。放在事务后是必须的——它要写的正是刚刚建好的索引/序列。

## B-8 export allowlist 快照是一套能真正挡住漂移的机制

`main-entry-allowlist.test.ts` 与 `public-subpath-allowlist.test.ts` 用「运行时实际具名导出
排序后与 JSON 快照深比较」，新增/删除任一导出即红。`public-no-config-forms.test.ts`
用源码正则强制 `public/*` 不得 import config-forms（`KNOWN_LEAKS` 当前为空集，
即零豁免）。`duplicate-export-consistency.test.ts` 断言 depth-slice 工具在
`core/compaction` 与 `core/config-forms/shared` 是**同一个函数引用**（`===`），
防止两处各写一份漂移。

这三条守卫合起来锁住了「谁能看到什么」和「层与层之间能不能连」，是本区最值钱的资产。
`public/session-fs.ts:1-5` 导出的 `isRollbackVfsDegradableError` / `isRollbackConflictError`
这类「带 cause 链解包」的判定函数（`errors/session-fs-errors.ts:65-70,258-264`）也是同一思路的延伸：
错误跨包传输后 `cause` 链会被包一层，判定若不解包就会漏。

## B-9 `errors/` 的跨实例 type guard 是被真实痛点驱动的

`isKkvError` / `isVfsError` / `isSkillError` 三者的注释都写着
「works across duplicate module instances (e.g. src vs dist in tests)」（`kkv-errors.ts:31`、
`vfs-errors.ts:59`、`skill-errors.ts:40`）。这不是洁癖：`packages/core` 的测试同时加载
`src/` 与 `dist/`，`instanceof` 在这种双实例下必然失效。`isVfsError` 甚至额外解一层
`cause`（`vfs-errors.ts:62-68`），`isSessionFsError` 解完整 cause 链
（`session-fs-errors.ts:65-70,81-83`）——深度按各错误实际的包装层数定，不是一刀切。

## B-10 `config-forms/` 把「表单形态」与「领域形态」彻底分开，并显式处理 worktree 过渡态

`definitionToForm` / `layoutFromFormInput` / `buildAgentDefinitionFromForm` 三段构成
「领域 → 表单 → 领域」的闭环（`agent-editor-state.ts:449,494,571`），且：

- persist 块的 worktree 过渡形态在**读入时被剥成文本、写出时必须 omit**——
  `splitPersistBlocksForEditor`（`:189`）读侧过滤、`layoutFromFormInput`（`:515`）写侧只取 textBlocks，
  两处同源过滤，不会漏。
- `formSnapshotJson`（`:542`）刻意在「专属模型关」时省略 `providerId/savedModelId`，
  避免切模型开关本身把表单标脏——这是有产品含义的取舍，不是省字节。
- 「常驻工作区开态但文案空」被显式阻断（`:577-583`），且注释说明了为什么不复用
  `hasAnyPromptRegionEnabled`（那个函数按设计不含 workplace）。
- `buildDefaultAgentDefinitionPreservingName` 复用 `createDefaultAgentEditorPrompts` +
  `layoutFromFormInput`（`build-default-agent-definition.ts:22`），
  「恢复默认」与「新建空白」走同一条默认路径，不会两套默认值漂移。

## B-11 `common/` 的「双端镜像」是显式登记的债务，不是疏忽

`format-token-count.ts:14-16` 与 `usage-stats-format.ts:4-6` 都写明：desktop renderer 因 X1
门禁不能 import core，那边维护等价镜像，**改动本文件时须同步那份，两份注释互指**。
这比默默复制两份强得多——至少债务是可见的、可 grep 的。`formatTokenSourceBadge` 把实现
放在 `common/`（而非 `infra/tokenizer/`）的理由也写清了：mobile 的 jest 套件整体 mock
`core/provider`，实现放这里才能让 `core/common` 直取真实现（`:9-12`）。

`excerptReleaseNotes` 的降级链（CHANGELOG 段 → 平台下载段 → 硬编码 FALLBACK）
与 `compareAppVersions` 拒绝非三段纯数字版本（`compare-app-versions.ts:9-18`，
调用侧 `parseReleaseTag` 已用 `/^v?(\d+\.\d+\.\d+)(?:[-+].*)?$/` 规范化），
两头对得上，非法输入宁可抛也不猜。

---

# 二、让步清单

> 以下是我作为辩护方**不主张维持**的点。按严重度排序，每条给出证据与建议。

### F-w9-adv-1 | P2 | `bootstrap/provider/seed-builtin-providers.ts:24-29` + `provider-schema.ts:9-10`

内置 provider 种子用固定 UUID 作主键（`builtin-providers.ts:22-37`，`c0ffeeee-…-0001..0005`），
存在性判定只看 `builtin_key`：

```sql
INSERT INTO llm_provider (id, builtin_key, ...)
SELECT #{id}, #{builtinKey}, ... 
WHERE NOT EXISTS (SELECT 1 FROM llm_provider WHERE builtin_key = #{builtinKey})
```

**问题**：若库里已存在一行 `id = 'c0ffeeee-…-0001'` 但 `builtin_key IS NULL`
（这正是 `domain/provider/logic/provider-identity-repair.ts` 要检测的「migration 裂了」形态），
`WHERE NOT EXISTS` 判定为真 → 插入同 PK 行 → `UNIQUE constraint failed: llm_provider.id` →
整笔 bootstrap 事务回滚 → 应用起不来，且错误是裸 SQL 错误、无用户可读文案。

**加重情节**：原本会兜住这个形态的修复操作
`createProviderIdentityRepairOperation`（`provider-identity-repair.ts:42`，其 `repair` 阶段
在检测到不一致时抛 `ProviderError` 告警，见 `:39-41`）**当前零生产消费方**——
`rg createProviderIdentityRepairOperation` 只命中其定义文件与
`test/provider/provider-identity-repair.test.ts`。bootstrap 的 `IntegrityRepairRegistry`
只注册了 `createVfsEntrySequenceRepairOperation`（`novel-master-bootstrap.ts:391-392`）。

**我不主张维持的**：seed 用「固定 PK + 仅业务键判存在」这个组合，在 PK 被脏数据占据时
把一个可恢复的形态放大成启动失败。**建议**：改 `WHERE NOT EXISTS` 为同时判 `id`
（`WHERE NOT EXISTS (SELECT 1 FROM llm_provider WHERE builtin_key = #{builtinKey} OR id = #{id})`），
或把 provider identity repair operation 重新挂回 bootstrap 的 `IntegrityRepairRegistry`
（它本来就不动数据、只告警，挂上零风险）。**置信 confirmed**（机制）/ **suspected**（该脏形态在真实库中的可达性）。

### F-w9-adv-2 | P2 | `packages/core/src/index.ts:55-59` + `test/package-exports/public-subpath-allowlist.test.ts:5-18`

export allowlist 快照只覆盖 **12 个**子路径
（`agent / chat / compaction / events / feature-flags / message-checkpoint / prompt /
provider / session-fs / smart-sort-rule / vfs / workplace`），
而 `src/public/` 下实有 **17 个** barrel。未被快照守卫的 5 个是：

- `public/format.ts`
- `public/kkv.ts`
- `public/session-kkv.ts`
- `public/session-run-state.ts`
- `public/skills.ts`

其中 `public/session-kkv.ts:13-25` 一次性转出 13 个符号（含 4 个 KKV 域常量与
`fileCacheKey`），`public/skills.ts:19-44` 转出 20 个——**恰好是新增导出最容易发生的两个面**。
守卫机制的意图（锁公开面、防意外漂移）在 5/17 上是空的。

**建议**：把这 5 个补进 `SUBPATHS` 常量并生成快照，一次性成本极低。
**置信 confirmed**。

### F-w9-adv-3 | P3 | `bootstrap/schema-align/schema-column-alignments.ts:120-127`

```ts
{
  table: "vfs_entry", column: "head_version",
  addColumnSql: "ALTER TABLE vfs_entry ADD COLUMN head_version INTEGER NOT NULL DEFAULT 1",
  afterAdd: async (tx) => { await tx.execute("UPDATE vfs_entry SET head_version = version"); },
}
```

`vfs-schema.ts:6-7` 明确写了 `version` 列**已退役**（「旧 schema 的 `version`（与 head_version
永远同步）…三列退役」），canonical DDL 里没有这一列。本条对齐仅在「有 `version`、无
`head_version`」的老库上触发，此时 UPDATE 成立；但若出现**两者皆无**的库形态
（例如某次只建了 `entry_id` 主键却未带 `version` 的中间态备份），
`ADD COLUMN` 会成功、随后的 UPDATE 抛 `no such column: version`，
整笔 bootstrap 事务回滚 → 同样起不来。

**我不主张维持的**：在一个已把 `version` 列为退役字段的模块里，留一条依赖 `version`
的一次性回填，且没有「列不存在则跳过」的守卫。**建议**：`afterAdd` 内先探 `version`
列存在性再决定是否 UPDATE。**置信 suspected**（该中间态库是否真实可达我未穷举证伪；
`baseline-check.test.ts` 的 fail-fast 覆盖了大部分 legacy 形态，可能已足够）。

### F-w9-adv-4 | P3 | `bootstrap/novel-master-bootstrap.ts:357-360`

模块头注释（`:10-12`）说 `assertMinimumBaseline` 是「在 migration runner 之前做 fail-fast」。
属实，但慢路径里它排在**全部 36 条 DDL 之后**（`:357-359` 先跑 DDL，`:360` 才断言）。
一个注定要被拦下的过旧库，会先执行 36 条 DDL 再抛错——虽然事务回滚不留痕，
但真机上白跑一遍 DDL 的代价是真实的（用户看到的是「卡了一下才报错」）。

**建议**：把 `assertMinimumBaseline(tx)` 提到 DDL 循环之前（快路径已经是这个顺序，
慢路径跟着对齐即可）。**置信 confirmed**（顺序事实）/ **P3**（成本有限，回滚保证正确性）。

### F-w9-adv-5 | P3 | 死代码与死常量（承认，但请并入既有 dead-backlog，不重复计条）

| 位置 | 事实 |
|---|---|
| `common/memoize.ts` | 123 行，唯一导出 `memoize`；`common/index.ts` **未**转发，`rg -w memoize` 在 `packages`/`apps` 只命中本文件自身 |
| `config-forms/agent/agent-editor-state.ts:92,100,108` | `parseToolsList` / `buildToolsPolicy` / `toolsFromDefinition` 三个 `@deprecated` 导出零消费方（连被指向的 YAML 导入路径都不存在） |
| `config-forms/agent/agent-editor-state.ts:200,376` | `joinPersistBlocksForLayout` / `countMinimumPromptSources` 仅测试消费 |
| `config-forms/stored-config-validity/types.ts:25,28` | `CURRENT_EVENTS_SCHEMA_VERSION` / `CURRENT_AGENT_SCHEMA_VERSION` 零消费方 |
| `bootstrap/message-checkpoint/message-checkpoint-schema.ts:46-48` | `MESSAGE_CHECKPOINT_SESSION_INDEX_DDL` 注释称「常量保留供老库路径 DROP 清理时引用」，但**代码里根本不存在这条 DROP 路径** |
| `bootstrap/vfs/vfs-schema.ts:27-29`、`vfs-revision-schema.ts:29-31` | `VFS_ENTRY_SCOPE_PATH_INDEX_DDL` / `VFS_REVISION_ENTRY_INDEX_DDL` 导出但不在语句数组内、零消费 |
| `bootstrap/session-fs/session-fs-schema.ts:8` | `SESSION_FS_SCHEMA_STATEMENTS` 是空数组，仍被 `novel-master-bootstrap.ts:130` 展开 |

**建议**：整批走既有 dead-backlog 流程删除；`MESSAGE_CHECKPOINT_SESSION_INDEX_DDL`
的注释是**事实性错误**（声称的引用点不存在），删除时一并消除误导。
**置信 confirmed**（除最后一项的「误导」判断外，均为 grep 实证）。

### F-w9-adv-6 | P3 | `errors/` 的跨实例 guard 覆盖不完整（`instanceof` 与 guard 混用）

只有 5 个错误类提供了跨模块实例安全的 guard：`isKkvError`（`kkv-errors.ts:32`）、
`isVfsError`（`vfs-errors.ts:60`）、`isSkillError`（`skill-errors.ts:41`）、
`isSessionFsError`（`session-fs-errors.ts:77`）、`isCompactionConditionsError`
（`compaction-conditions-errors.ts:32`）。其余 10 个错误类
（`AgentError` / `ChatError` / `ProviderError` / `ToolError` / `PromptError` /
`AgentConfigError` / `SmartSortRuleError` / `VfsZipError` / `CharacterCardError` /
`ConfigDecodeError` / `PreferencesError`）**没有 guard**，
而三处消费方全部用 `instanceof`：`apps/cli/src/cli-errors.ts:36-53`（13 处）、
`apps/mobile/src/errors/format-error.ts:49-73`（9 处）、
`apps/desktop/src/main/ipc/format-ipc-error.ts`。

仓库自己已经把这个坑写进了注释（「works across duplicate module instances
(e.g. src vs dist in tests)」），却只给 5 个类补了 guard。生产 bundle 里 core 只有一份实例，
`instanceof` 成立，所以**当前无实际故障**；风险窗口是 core 测试同时加载 src+dist 的场景
（而 `package-exports` 系列测试恰好就在这么干）。

**建议**：要么给全 15 个错误类补齐同款 name+code 鸭子类型 guard，要么在 `errors/README`
或某处写明「这 10 个类只保证单实例场景可用」。当前状态是「一半有护栏」，
读代码的人无法判断哪些可以放心用。**置信 confirmed**（不一致事实）。

### F-w9-adv-7 | P3 | `config-forms/stored-config-validity/assess-agent-definition-wire.ts:14-28`

`isRemovedFeatureError` 用**错误消息子串匹配**判定「已下线特性」：

```ts
const REMOVED_FEATURE_KEYWORDS = ["prompts.blocks", "preferredModelId", "prompts.regions", "prompts.chat", "legacy nested model"];
return REMOVED_FEATURE_KEYWORDS.some((keyword) => message.includes(keyword));
```

这条链依赖 zod 生成的 message 文本稳定性。zod 升级或 schema 措辞调整都可能让某个
已下线字段落到 `broken_wire` 桶，用户看到的文案从「配置含已移除的字段或动作」变成
「配置格式损坏，无法解析」——引导动作完全不同（前者是「恢复默认」，后者更像「数据坏了」）。

**我不主张维持的**：把用户可见的分类判定挂在第三方库的错误文本上，且无测试锁定这些子串
（`rg REMOVED_FEATURE_KEYWORDS` 只命中定义处）。**建议**：改为对 wire 文档做
**结构性**探测（按已知退役 key 逐个 `in` 判定），与消息文本解耦。
**置信 suspected**（当前 zod 版本下工作，但脆弱性是确定的）。

### F-w9-adv-8 | P3 | `bootstrap/skills/seed-builtin-skills.ts:194-202`

技能种子的「写正文」与「写版本台账」不在同一事务（台账写在 `:202` 的 `writeSeedLedger`，
用的是 `INSERT OR REPLACE` 独立语句）。崩在两者之间 → 正文已更新、台账仍是旧版本号
→ 下次启动重种一次（幂等覆盖，无害）。方向是安全的，但代价是**崩溃窗口内会重复写一次 VFS**，
而 VFS 写会分配新 revision。

**辩护意见**：这个方向选择是对的（宁可多重写一次，不可漏种），我不主张改事务边界。
记录在此仅为完整性——若未来 VFS 写引入非幂等副作用（如计数、通知），此窗口需要重新评估。
**置信 intentional（方向正确）/ P3（窗口存在）**。

### F-w9-adv-9 | P2 | `public/skills.ts:37` 让 public 层反向依赖 bootstrap 层

```ts
export { BUILTIN_SKILL_NAMES } from "../bootstrap/skills/seed-builtin-skills.js";
```

这行是三文件静态环的第三条边：`public → bootstrap → service/skills → bootstrap`。
当前不炸（环上绑定都在函数体内使用），但它把「启动引导」变成了「公开契约的一部分」——
bootstrap 目录的任何重构都会牵动 apps 侧的编译。

**建议**（与 W2 `core-bootstrap` 已给出的修法一致，此处作为辩护方的**让步**确认）：
`BUILTIN_SKILL_NAMES` 是纯领域常量（一个 `Set(["agent-config"])`），
下沉到 `domain/skills/model/` 即可同时断开环与层依赖，`seed-builtin-skills.ts`
改为从 domain 引用。**置信 confirmed**。

### F-w9-adv-10 | P3 | `bootstrap/smart-sort-rule/builtin-smart-sort-rules.ts:119-138` 与 `provider/seed-builtin-providers.ts:18-38` 参数绑定风格不一致

同一目录下的两个 seed，一个用 `SqlTemplateParser` + `executeTemplate` 的 `#{name}` 模板，
一个用 `conn.execute(sql, [params])` 的位置参数。两者都正确，但风格分裂会让读代码的人
怀疑「哪个是本目录规范」。

**辩护意见**：不主张统一（各改各的收益低于 churn 成本）。记录为风格债。
**置信 confirmed（事实）/ intentional（不修）**。

### F-w9-adv-11 | P3（信息类） | `docs/apm/RULE.md:29` 与 `seed-builtin-skills.ts:8-17` 口径需核对

RULE 第 29 条写「内置技能…由 bootstrap 事务后幂等种入 global 域（**用户改过正文则跳过不覆盖**）」，
而 `seed-builtin-skills.ts:12-16` 的设计是「**版本落后即无条件重种**——内置保留名技能是官方资产
而非用户数据，官方文案即权威」。两者对「用户改动是否被保护」的表述相反。

代码侧的理由（官方资产、想定制可复制成新名字）在文件里写得很清楚，我倾向代码是对的、
RULE 旧了。但**这是主仓记忆文件、worktree 检出的是旧提交版**，且 `status.md` 已记载
主仓存在未提交的 RULE 修正。**我不主张单方面下结论**，提请主代理以主仓 `docs/apm/RULE.md`
当前工作区版本为准核对；若主仓已修，本条自动消解。**置信 suspected**。

---

## 三、争议与存疑（不抹平）

1. **F-w9-adv-1 的严重度**。我给 P2 而非 P1，因为触发前提是「`builtin_key` 被清空」的脏形态，
   而该形态按 `provider-identity-repair.ts:39-41` 的自述意味着「migration 裂了」——
   正常升级路径不该产生它。但反方可以说：一旦产生就是**用户完全无法自救的启动失败**
   （裸 SQL 错误、无引导文案），且兜底代码已经写好却没挂上。这属于「概率低 × 后果不可恢复」
   的权衡，请主代理裁决定级。

2. **F-w9-adv-2 与既有 W3 死导出普查的关系**。`public/skills.ts` / `public/session-kkv.ts`
   的未覆盖面，与 `L0/dead-exports.md` 里「173 条落在 allowlist 快照锁定的公开面」的结论
   方向一致但成因不同：那边说的是「被锁住所以删不掉」，我这条说的是「有 5 个面根本没锁」。
   两者应分开计数，不要合并。

3. **`SESSION_FS_SCHEMA_STATEMENTS` 空数组**。我倾向**保留**（它标记了「session-fs 域的表
   已全部迁到 message-checkpoint」这一已发生的架构变更，是有语义的占位），
   而 L0 死代码普查大概会把它列为可删。这是一条真实的分歧，我按辩护立场保留，但不强阻。

4. **单事务 vs 事务粒度**。B-1 我为单事务辩护，但它与 `dedup-file-cache-storage-v1`
   在同一事务内做单条 `DELETE FROM session_kkv_entry WHERE domain = 'file_cache'`
   （用户实测库 21198 行 / 415MB，见该文件 `:7-9` 注释）叠加时，
   意味着一次冷启动可能在事务里做一次大 DELETE。这是 migration 层的已知取舍
   （该文件 `:5-12` 明确论证过为什么不分批），不在 bootstrap 目录内，但**发生在这个事务里**。
   我不主张改（PRD 已拍板），但请主代理在评估 bootstrap 事务时长时把它计入。

---

## 四、我未能覆盖的盲区（诚实交代）

- `common/memoize.ts` 我确认了「零消费」，但**没有**去核实 `docs/Iterations/cr-fix-spec/`
  里那份 spec 承诺的接线（sql-template AST 缓存等）是否已落地或已被撤销——
  若已撤销则本文件是纯残留，若未撤销则它是「待接线资产」而非死代码，两种定级不同。
- `errors/` 我只审了「guard 覆盖一致性」，没有逐个核对 15 个错误类的 `code` 枚举
  与实际抛出点是否一一对应（那属于各业务域机位的范围）。
- `types/agnai-tokenizers.d.ts` 仅为环境声明，未核对两个可选包在 desktop/mobile/cli
  三端的实际安装与解析情况。
- `config-forms/stored-config-validity/assess-agent-definition-wire.ts:78-91`
  `resolveAgentDefinitionFromStorage` 的生产可达性我**没有**独立核实
  （`status.md` 记 core-prompt 机位判其为「潜伏于公开 API 面」），
  因此 F-w9-adv-7 的影响面按「已可达」保守估计。
