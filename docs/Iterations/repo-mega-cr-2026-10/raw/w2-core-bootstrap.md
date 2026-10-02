---
zone: core-bootstrap
agent: domain-survey
files_scanned: 88
files_scanned_detail:
  bootstrap: 31
  public: 17
  common: 7
  config-forms: 15
  errors: 16
  types: 1
  src/index.ts: 1
read_discipline: 只读；未做任何 git 写；未创建/修改 docs/apm/ 下任何文件
tools_run:
  - "npx tsc --noEmit -p tsconfig.json（packages/core）→ 0 错"
  - "npx tsx --test test/package-exports/{public-subpath-allowlist,main-entry-allowlist,public-no-config-forms,duplicate-export-consistency}.test.ts → 16/16 pass"
  - "npx tsx --test test/bootstrap/bootstrap-no-migrate.test.ts → 4/4 pass"
  - "npx tsx --test test/bootstrap/*.test.ts → 未能执行（本 worktree 未 build @novel-master/tdbc-driver-better-sqlite3 的 dist，ERR_MODULE_NOT_FOUND，环境限制非代码问题）"
---

# W2 · core-bootstrap 按域测绘

## 摘要

`packages/core/src/` 的「地基层」：SQLite 建表与版本迁移（bootstrap）、公开导出面（index.ts + public/* + config-forms/*）、
跨端纯工具（common）、类型化错误（errors）、少量环境声明（types）。这一层不做业务决策，
它的职责是保证「任意一端拿到库句柄后一定得到正确 schema」与「双端只能从约定子路径消费 core」。
本轮结论：schema 三件套纪律执行到位、allowlist 快照全绿；问题集中在**导出面覆盖缺口**、
**bootstrap↔service 的依赖倒置/循环**、以及**若干注释与实际行为已经分叉的文档债**。

## 职责与边界

| 子目录 | 职责 | 不该做 |
|--------|------|--------|
| `bootstrap/` | canonical DDL（16 个 `*-schema.ts`）、声明式 legacy 列对齐、schema migration 注册表与 runner、内置 provider / 智能排序规则 / 内置技能三类种子、`assertMinimumBaseline` 基线 fail-fast、发号器完整性修复 | 不做业务读写；不搬存量数据（数据搬运走 `infra/db-maintenance/`） |
| `index.ts` | 主入口：bootstrap / TDBC / Tool / 持久化 / 云同步 / 备份 / db-maintenance / 序列化 | 不 re-export public 子入口的工厂（t0 测试 denylist） |
| `public/*`（17 个 barrel） | 每个 barrel = 一个 `package.json#exports` 子路径，只做 re-export | 不 import `config-forms`（有守卫测试）；不新增子路径而不登记 |
| `common/` | 跨端纯函数（版本比较、release notes 摘录、token/统计格式化、yaml 错误归一） | 不做 IO |
| `config-forms/` | UI 表单层的纯逻辑（agent 编辑器状态机、model id 解析、存储配置有效性判定与文案） | 不 import 领域服务实现（只 import 类型与 domain 纯逻辑） |
| `errors/` | 每域一个类型化 Error + 判别码 + 构造函数工厂 + 跨实例类型守卫 | 不含领域逻辑 |
| `types/` | 两个第三方分词器的 ambient 声明 | — |

## 对外接口

`package.json#exports` 实测 25 个子路径（`.` + 24 个），全部有对应源文件（无悬空条目）：

```
.  ./common  ./agent  ./chat  ./compaction  ./events  ./feature-flags  ./prompt
./provider  ./smart-sort-rule  ./message-checkpoint  ./session-fs  ./vfs
./workplace  ./format  ./tdbc  ./sksp  ./nmtp  ./kkv  ./session-kkv
./session-run-state  ./skills  ./config-forms  ./config-forms/agent
./config-forms/shared  ./config-forms/stored-config-validity
```

主入口（`src/index.ts`）关键符号：`bootstrapNovelMaster` / `NOVEL_MASTER_SCHEMA_STATEMENTS` /
`SCHEMA_BOOT_VERSION` / `open` / `registerDriver` / `ToolRegistry` / `ToolRunner` /
`registerBuiltinTools` / `createPersistentState` / `createPersistentPreferences` /
`CloudSyncCoordinator` / `dumpProviderTableSnapshot` / `runStartupMaintenanceOnce` /
`runMessageContentCompaction` / `SqlTemplateParser` / `parseText` / `encode` / `decode`。

`SCHEMA_BOOT_VERSION = 17`（`bootstrap/novel-master-bootstrap.ts:117`）；
`SCHEMA_MIGRATIONS` 6 条（`bootstrap/schema-migrations/index.ts:36-43`）；
`BASELINE_MIGRATION_IDS` 12 条（`novel-master-bootstrap.ts:171-184`）；
`SCHEMA_COLUMN_ALIGNMENTS` 21 条（`bootstrap/schema-align/schema-column-alignments.ts:19-171`）。

## 数据访问

本层只写 DDL / DML 元数据，不读业务表。实测触碰对象：

- 建表（`NOVEL_MASTER_SCHEMA_STATEMENTS` 汇总 16 个模块）：
  `vfs_entry` / `vfs_revision`(WITHOUT ROWID + 3 个 blob 引用计数触发器) / `vfs_content_blob` /
  `message_checkpoint` / `message_checkpoint_file` / `kkv_entry` / `session_kkv_entry` /
  `session_file_cache_blob` / `session_file_cache_entry` / `session_run_state` /
  `chat_project` / `chat_session` / `chat_message` / `sksp_secrets` / `llm_provider` /
  `llm_saved_model` / `agent_definition` / `workplace_dir_rule` / `workplace_file_rule` /
  `skill_disabled_rule` / `smart_sort_rule`（`novel-master-bootstrap.ts:120-141`）
- 迁移登记表：`schema_migrations`（`schema-migrations-table.ts:14-27`，**不在** DDL 数组内，由
  `ensureSchemaMigrationsTable` 单独幂等建）
- 种子写入：`llm_provider`（`seed-builtin-providers.ts:24-29`，`WHERE NOT EXISTS(builtin_key)` 幂等）、
  `smart_sort_rule`（`builtin-smart-sort-rules.ts:122-125`，`INSERT OR IGNORE` 幂等）、
  `kkv_entry`（`nm-seeds/agent-config` 台账，`seed-builtin-skills.ts:161-163`）
- 迁移内数据动作：`DELETE session_kkv_entry WHERE domain='file_cache'`
  （`dedup-file-cache-storage-v1.ts:33-35`）、`DELETE kkv_entry WHERE module=? AND key=?`
  （`retire-pref-session-fs-version-check-v1.ts:34-37`）、
  `ALTER TABLE ... RENAME COLUMN` / `ADD COLUMN` + `UPDATE` 回填（smart-sort / mcp / workplace-dir-rule 三条）
- `PRAGMA user_version` 读写（`novel-master-bootstrap.ts:143-154`）
- **孤儿表核对（实测）**：把 `packages/core/src` 全部 `FROM x` 目标聚成集合后与 DDL 建表清单比对，
  20 张表全部有建表语句，无「repository 读得到但 bootstrap 不建」的表。

## 依赖关系

**出向（import）**：`infra/tdbc`（TdbcConnection 端口）、`infra/sql-template`（SqlTemplateParser）、
`domain/**`（schema 常量、SmartSortCaptureKind、builtin-providers）、
`service/skills/create-skills-service`（内置技能 seed 走服务层）、
`service/integrity-repair`、`domain/vfs/logic/entry-sequence-repair`、
`infra/content-cache/logic/decoded-content-cache`、`errors/**`、`service/persistent-preferences/impl/preference-keys`。

**入向（被谁消费）**：`apps/desktop/src/main/runtime/connection.ts`、`apps/mobile/src/db/connection.ts`、
`apps/cli/src/runtime.ts`（三端都调 `bootstrapNovelMaster`）；
`packages/core/src/index.ts` 与 17 个 `public/*` barrel 消费 `bootstrap/` 的导出面。

**循环**：`bootstrap/skills/seed-builtin-skills.ts` ⇄ `service/skills/impl/skills.service.ts`
（经 `create-skills-service.ts` 构成三文件环）——见 F-core-bootstrap-1。

## 发现清单

### F-core-bootstrap-1 | P2 | `packages/core/src/service/skills/impl/skills.service.ts:33` ⇄ `packages/core/src/bootstrap/skills/seed-builtin-skills.ts:24` ⇄ `packages/core/src/service/skills/create-skills-service.ts:9`

引文：

```ts
// skills.service.ts:33
import { BUILTIN_SKILL_NAMES } from "@/bootstrap/skills/seed-builtin-skills.js";
// seed-builtin-skills.ts:24
import { createSkillsService } from "@/service/skills/create-skills-service.js";
// create-skills-service.ts:9
import { SkillsService } from "./impl/skills.service.js";
```

描述：`BUILTIN_SKILL_NAMES` 这一个常量把 **service 层反向依赖到 bootstrap 层**，并在
`skills.service → seed-builtin-skills → create-skills-service → skills.service` 之间形成一个真实的三文件
import 环。同一常量还被 `public/skills.ts:37` 再导出，意味着**任何** import
`@novel-master/core/skills` 的消费方（含 mobile）都会把 seed 模块（连带 90 行的
`AGENT_CONFIG_SKILL_MD` 模板串与整个 service 装配图）拉进模块图。
今天不炸的唯一原因是环上两侧的绑定都只在**函数体内**使用（BUILTIN_SKILL_NAMES 只在
`writeSkillFile` 内读），没有 top-level 求值依赖。
建议：把 `BUILTIN_SKILL_NAMES` 下沉到 `domain/skills/model/builtin-skill-names.ts`，
`seed-builtin-skills.ts` 与 `skills.service.ts` 都从 domain 引入；`public/skills.ts` 同理改从 domain 再导出。
这同时消掉环、断开 public→bootstrap 的层依赖、并让 skills barrel 不再捎带 seed 文案。
置信：confirmed（环与三条 import 均为实测；「今天不炸」为读码推断，未构造 top-level 消费者验证）

### F-core-bootstrap-2 | P2 | `packages/core/src/bootstrap/skills/seed-builtin-skills.ts:192-201`（与 `docs/apm/RULE.md:29` 冲突）

引文：

```ts
// 版本落后：无条件重种当前文案（存在性只决定是否需要 seed 特权豁免
// D2② 的新建拦截——首种时目录必不存在；重种走整文件覆盖）。
await service.writeSkillFile("global", "agent-config", undefined, AGENT_CONFIG_SKILL_MD, undefined, exists ? undefined : { builtinSeed: true });
```

RULE.md 的「技能域与内置技能」条目写的是：*「由 bootstrap 事务后幂等种入 global 域（**用户改过正文则跳过不覆盖**）」*。
实现是**无条件覆盖**：台账版本落后就重写，用户在管理页对内置 agent-config 技能做的正文编辑
（`SkillError(BUILTIN_SKILL_NAME_RESERVED)` 明确放行编辑内置本体）会在下一次
`AGENT_CONFIG_SEED_VERSION` +1 时被静默丢弃。
代码注释本身给出了相反的论证（「内置保留名技能是官方资产而非用户数据」），
所以**代码是有意为之**、漂的是 RULE 文本——但 RULE 是后续 agent 的决策感知依据，
留着这条会让下一个做 seed 文案改动的人按错误前提设计。
建议：改 RULE 措辞为「版本落后即无条件重种（官方文案即权威，用户编辑在版本 bump 时会被覆盖）」，
或若产品口径本就该保护用户编辑，则改代码 + 改 `AGENT_CONFIG_SEED_VERSION` 语义。
置信：confirmed（两侧原文均已逐字核对）

### F-core-bootstrap-3 | P2 | `packages/core/test/package-exports/public-subpath-allowlist.test.ts:5-18`

引文：

```ts
const SUBPATHS = [
  "agent", "chat", "compaction", "events", "feature-flags",
  "message-checkpoint", "prompt", "provider", "session-fs",
  "smart-sort-rule", "vfs", "workplace",
] as const;
```

描述：allowlist 快照只覆盖 12 个子路径 + 主入口。`package.json#exports` 里另外 13 个子路径
**没有任何快照**：`./common`、`./format`、`./kkv`、`./session-kkv`、`./session-run-state`、`./skills`、
`./config-forms`、`./config-forms/agent`、`./config-forms/shared`、`./config-forms/stored-config-validity`、
`./tdbc`、`./sksp`、`./nmtp`。
也就是说本次扫描实测为死的 3 个 `@deprecated` config-forms 导出（F-7）、
2 个 `CURRENT_*_SCHEMA_VERSION`（F-5）都在**无快照覆盖的子路径**里——治理缺口与死代码分布高度重合。
实测：受控的 13 条（12 子路径 + workplace 专项）全部 pass，快照本身不是坏的，缺的是覆盖面。
建议：把 SUBPATHS 补成从 `package.json#exports` 动态派生（`Object.keys` 过滤 `.`），
让新增子路径默认进快照；`tdbc`/`sksp`/`nmtp` 若有意排除，在测试里显式列 DENY 名单并注明原因。
置信：confirmed

### F-core-bootstrap-4 | P2 | `packages/core/src/bootstrap/schema-align/schema-column-alignments.ts:19`（缺机械化守卫）

引文：

```ts
/** 当前版本运行必需的 legacy 列清单（顺序无关，逐项幂等）。 */
export const SCHEMA_COLUMN_ALIGNMENTS: readonly SchemaColumnAlignment[] = [ ... 21 条 ... ];
```

描述：RULE 的硬规则是「给 SCHEMA_COLUMN_ALIGNMENTS 加列必须 bump SCHEMA_BOOT_VERSION（三件套）」，
且历史上已因此出过两次真机事故（v9 `first_token_ms`、v10 `provider_id`，均 `no such column`）。
本轮逐条核对：21 条 ALIGN 与 `novel-master-bootstrap.ts:54-115` 的版本注释链**一一对得上**
（v8 cache/model、v9 耗时、v10 provider_id、v12 body_params、v16 run-state token、v17 正文两列），
当前状态是合规的。
问题在于**没有任何测试在机械地守这条规则**：现有的锚点断言是按迭代手写的
（`schema-align-columns.test.ts` 的 A12/A13/A14 + `message-content-compression-schema.test.ts:33` 的
`COMPRESSION_COLUMNS_BOOT_VERSION = 17`），它们能挡住「把 SCHEMA_BOOT_VERSION 回退」，
但挡不住「加了第 22 条 ALIGN 却忘了 bump」——那种情况下 BOOT 仍是 17 ≥ 17，全绿，
而存量库永久缺新列，正是 RULE 记的那次事故形态。
建议：给 `SchemaColumnAlignment` 加一个 `sinceBootVersion: number` 字段，
再写一条数据驱动测试断言 `SCHEMA_BOOT_VERSION >= max(entries.map(e => e.sinceBootVersion))`；
`SCHEMA_COLUMN_ALIGNMENTS` 本身的测试是 `@novel-master/core` 里的（无 DB 依赖），
`SCHEMA_BOOT_VERSION` 已从主入口导出，接线零成本。
置信：confirmed（当前 21 条全部对得上，是「未来会漏」而非「现在已漏」）

### F-core-bootstrap-5 | P3 | `packages/core/src/config-forms/stored-config-validity/types.ts:9,21,25,28`

引文：

```ts
export type StoredConfigInvalidCode = "outdated_version" | "broken_wire" | "removed_feature";
...
      readonly storedSchemaVersion?: number;
...
export const CURRENT_EVENTS_SCHEMA_VERSION = 2 as const;
export const CURRENT_AGENT_SCHEMA_VERSION = 1 as const;
```

描述：`config-forms/events` 子模块已随 event-config-merge 迭代整体删除
（`src/config-forms/` 下已无 `events/` 目录），但这份「存储配置有效性」类型还留着 events 时代的骨架：
唯一的生产者 `assessAgentDefinitionWire`（`assess-agent-definition-wire.ts:65-67`）只可能返回
`removed_feature` / `broken_wire`，**从不产出 `outdated_version`，也从不填 `storedSchemaVersion`**。
而 desktop 侧仍在透传这条死字段：`apps/desktop/shared/ipc-types.ts:1272-1274` 声明了两种 code、
`apps/desktop/src/main/ipc/handlers/stored-config-health-dto.ts:17-19` 与
`handlers/agent-registry.ts:88-90` 逐层搬运 `storedSchemaVersion`（实际恒 undefined）。
两个 `CURRENT_*_SCHEMA_VERSION` 常量全仓零消费（`git grep` 仅命中自身声明）。
建议：删 `outdated_version` 分支 + `storedSchemaVersion` 字段 + 两个常量，并同步收窄 desktop 的 IPC DTO；
若要保留 schemaVersion 判据，则应让 `assessAgentDefinitionWire` 真的去读 wire 文档里的版本字段。
置信：confirmed

### F-core-bootstrap-6 | P3 | `packages/core/src/common/memoize.ts:1-123`

引文：

```ts
 * 适用场景：AgentRunner 主循环里那些「同样输入必然同样输出」的纯函数——
 * 例如 SQL 模板解析、表达式编译、路径规范化，它们在单个 turn 内会被反复
 * 调用，每次都重算纯属浪费。
```

描述：全仓 123 行的通用 memoize 实现，`git grep -nw memoize` 在 `packages/core/src`、`packages/core/test`、
`apps/**` 里只命中文件自身——**零消费方**，连测试都没有。文件头描述的接入场景从未发生。
它也不在 `common/index.ts` barrel 里（barrel 未导出），所以从 `@novel-master/core/common` 也取不到，
纯属游离文件。建议：删除；或若确有性能诉求，按 RULE「性能护栏」的写法补一个真实调用点 + 计数式断言。
置信：confirmed

### F-core-bootstrap-7 | P3 | `packages/core/src/config-forms/agent/agent-editor-state.ts:92,100,108,200`

引文：

```ts
/** Parses comma/newline tool lists — retained for YAML import compatibility only. */
export function parseToolsList(text: string): string[] { ... }
/** @deprecated Use {@link buildToolsPolicyFromSelection}. */
export function buildToolsPolicy(mode: ToolsMode, listText: string) { ... }
/** @deprecated Use {@link toolsSelectionFromDefinition}. */
export function toolsFromDefinition(def: AgentDefinition) { ... }
```

描述：三个标记「仅保留兼容 / @deprecated」的导出，经 `config-forms/agent/index.ts` 的
`export *` 暴露在公开子路径上，但全仓零消费方——**连被 `@deprecated` 指向的 YAML 导入路径都不存在**
（`config-forms/agent-tool-catalog.ts` 已全面改为 selection 数组模型）。
同文件 `joinPersistBlocksForLayout`（:200）同样零消费。
这四个符号所在的子路径恰好没有 allowlist 快照（F-3），所以没有守卫会因删除而红。
建议：一次性删掉这四个导出（`parseToolsList` / `buildToolsPolicy` / `toolsFromDefinition` /
`joinPersistBlocksForLayout`），并在补快照后由快照兜住。
置信：confirmed

### F-core-bootstrap-8 | P3 | `packages/core/src/bootstrap/message-checkpoint/message-checkpoint-schema.ts:41-47`、`bootstrap/vfs/vfs-revision-schema.ts:29-31`、`bootstrap/vfs/vfs-schema.ts:26-28`

引文：

```ts
/**
 * Session-scoped checkpoint lookup.
 *
 * 冗余索引，已退役：……常量保留供老库路径 DROP 清理时引用。
 */
export const MESSAGE_CHECKPOINT_SESSION_INDEX_DDL = `CREATE INDEX IF NOT EXISTS idx_message_checkpoint_session
  ON message_checkpoint(session_id)`.trim();
```

描述：三个「索引 DDL 常量」既不在任何 `*_SCHEMA_STATEMENTS` 数组里，也没有任何消费者
（`git grep` 在 `packages/` + `apps/` + `packages/core/test` 全域只命中自身声明）。
其中 `MESSAGE_CHECKPOINT_SESSION_INDEX_DDL` 的注释明确写「常量保留供老库路径 DROP 清理时引用」——
但代码里根本不存在这条 DROP 路径，注释在描述一个不存在的东西。
`VFS_ENTRY_SCOPE_PATH_INDEX_DDL` / `VFS_REVISION_ENTRY_INDEX_DDL` 同类：
`vfs-schema.ts:33-36` 的注释解释了「具名索引刻意不建」，那这两个常量就是纯粹的残留。
建议：删三个常量（`VFS_ENTRY_TABLE_DDL` / `VFS_REVISION_TABLE_DDL` / `VFS_CONTENT_BLOB_TABLE_DDL` /
`MESSAGE_CHECKPOINT_TABLE_DDL` 等被数组引用的要保留），或把注释改成「已退役、保留仅为记录形态」。
置信：confirmed

### F-core-bootstrap-9 | P3 | `packages/core/tsconfig.test.json:32` + `apps/mobile/jest.config.js:194-197` + `apps/desktop/scripts/fix-settings-utf8.mjs:87`

引文：

```json
"@novel-master/core/config-forms/events": ["./src/config-forms/events/index.ts"]
```

描述：`config-forms/events` 子路径已在 event-config-merge 迭代中整体删除
（`src/config-forms/` 下只有 `agent/` `shared/` `stored-config-validity/`），但三处残留仍指向它：
① 本包的测试 paths 映射（`tsconfig.test.json:32`）；② mobile 的 jest `moduleNameMapper`
（映射到 `packages/core/dist/config-forms/events/index.js`，永不存在的产物）；
③ desktop 一次性修字脚本里内嵌的生成代码模板（`fix-settings-utf8.mjs:87`，写在 template literal 内、
非可执行 import，所以不会炸但会误导）。
RULE「给 core 新增 exports 子路径必须同步 tsconfig.test.json 的 paths」讲的是加子路径时的同步义务；
这里是**反向残留**（paths 有、exports 无），同样会让后来人以为该子路径存在。
实测这条 paths 映射当前零副作用：`tsc -p tsconfig.test.json` 的 430 条报错全部是既有 TS6059（rootDir 与
`include: test/**/*` 冲突，该配置本就不是 typecheck 门限），没有任何一条来自该映射。
建议：删掉三处残留；`apps/mobile/jest.config.js` 的 moduleNameMapper 建议改成从
`packages/core/package.json#exports` 生成，避免同类漂移。
置信：confirmed

### F-core-bootstrap-10 | P3 | `packages/core/docs/public-api.md:35-51`

引文：

```md
## 3. Public 子入口（12 个）
| `./regex` | Regex 配置服务 |
```

描述：导出面文档与实际 exports 已经分叉。① §3 表里列了 `./regex`——该子路径随 v11 正则系统下线
从 `package.json#exports` 与 `src/public/` 双双删除（`novel-master-bootstrap.ts:70-74` 有退役记录）；
② 同表漏了 `./smart-sort-rule`（真实存在、且在 allowlist 快照里）；③ `./format` / `./session-kkv` /
`./session-run-state` / `./skills` 四个 `src/public/*` barrel 同样既不在 §3 也不在 §4 辅助路径表里。
文中「12 个」的总数恰好与真实 public 子路径数（17 个 barrel，但 §3 只承诺 12 个）错位，
容易让人以为 `public/` 只有 12 个文件。`novel-master-bootstrap.ts:139-140` 的两条
`DROP TABLE IF EXISTS regex_*` 也说明该文档的读者会被误导。
建议：重写 §3 表格（从 `package.json#exports` 派生），并在 §6「变更流程」加一条
「增删 exports 子路径必须同步本表 + tsconfig.test.json paths + allowlist 快照」三处。
置信：confirmed

### F-core-bootstrap-11 | P3 | `packages/core/src/errors/agent-runtime-errors.ts:12,37-44`

引文：

```ts
  | "UNSUPPORTED_PROVIDER"
...
export function agentUnsupportedProvider(protocol: string): AgentError {
  return new AgentError("UNSUPPORTED_PROVIDER", `Provider protocol "${protocol}" does not support tools`);
}
```

描述：`AgentErrorCode` 经 `public/agent.ts:22` 公开，`UNSUPPORTED_PROVIDER` 是其成员之一，
但全仓既没有 `new AgentError("UNSUPPORTED_PROVIDER", ...)`，也没有对
`agentUnsupportedProvider` 的任何调用（`git grep -nw` 三个符号各自只命中本文件）。
即：一个消费方按 code 分支处理「provider 不支持工具」永远不会命中。
与 `DOOM_LOOP`（`agentDoomLoop` 有真实调用方，`assertNoDoomLoopInBlocks` 走它）形成对照。
建议：确认该能力是否已下线（若是则从 code 联合类型里摘掉；若只是暂时没接，则补注释标注未接线）。
置信：confirmed

### F-core-bootstrap-12 | P3 | `packages/core/src/errors/session-fs-errors.ts:487-512`（与 `errors/vfs-errors.ts:1072-1083` 语义不一致）

引文：

```ts
function unwrapCause(error: unknown): unknown { ... }   // 递归剥到最深层
export function isSessionFsError(error: unknown, code?: SessionFsErrorCode): error is SessionFsError {
  const candidate = unwrapCause(error);
  ...
}
```

描述：`isSessionFsError` **无条件**把 error 剥到 cause 链最深处再匹配；同仓的 `isVfsError`
（`vfs-errors.ts:1076-1082`）则是「先匹配自身，匹配不上再退一层 cause」——正确做法。
前者的后果是：若一个外层错误（如 `ToolError(FAILED, cause=SessionFsError(BACKFILL_REQUIRED))`）传进来，
守卫返回 true，但 TS 断言的 `error is SessionFsError` 指向的是**外层那个不带 `missingLogicalPaths` 的对象**。
`readRollbackRevisionBackfillMissingPaths`（:616-623）正好踩这个形状：它先调
`isRollbackRevisionBackfillRequiredError(error)`，成立后再读 `error.missingLogicalPaths`，
被包裹时会读到 undefined、退化成「· （未知文件）」的空列表——用户看到「快照丢失」提示但没有文件清单。
建议：改成 `isVfsError` 那种「自身优先、cause 次之」的两段式；或让
`readRollbackRevisionBackfillMissingPaths` 读 `unwrapCause(error)` 的结果而非入参。
置信：suspected（守卫的语义缺陷可确证；实际是否被上层包过一层，本次未找到确定的构造点）

### F-core-bootstrap-13 | P3 | `packages/core/test/bootstrap/baseline-check.test.ts:44,58,72,86,100`（测试文案）

引文：

```ts
"legacy 形态 + 缺 baseline 登记，应抛出 v1.4.27 升级提示"
```

描述：五条断言消息与两处用例注释仍写 `v1.4.27`，而实际最低支持版本已是 **v1.5.5**
（`BASELINE_TOO_OLD_MESSAGE` = `novel-master-bootstrap.ts:187-188`、
`BASELINE_MIGRATION_IDS` 第四轮注释 :166-169）。断言本身仍绿（比的是常量），
但失败时的输出会指向错误的版本号，误导排障。
建议：把 `v1.4.27` 字面量换成从 `BASELINE_TOO_OLD_MESSAGE` 或新增的
`MINIMUM_BASELINE_VERSION` 常量派生。
置信：confirmed

### F-core-bootstrap-14 | P3 | `packages/core/src/common/compare-app-versions.ts:6-20`

引文：

```ts
/**
 * App 版本号比较（只认 major.minor.patch 三段纯数字）。
 */
...
    const n = Number.parseInt(p, 10);
```

描述：docstring 承诺「三段纯数字」，实现是 `split(".")` + `parseInt`，
只拒「段数 ≠ 3」「NaN」「负数」。于是 `1.5.28-beta` 被解析成 `[1,5,28]`、
`1.5.28` 与 `1.5.28-beta` 比出**相等**、`1.5.9-rc` 排在 `1.5.8` 之后。
当前发版纪律（RULE「只允许 +0.0.1」）下不会产生预发布版本号，所以是潜在而非现实缺陷；
但这是「更新提示」链路上的纯函数，任何未来引入 RC/beta 号的改动都会让它静默给错结论。
建议：把校验改成 `/^\d+$/` 逐段全匹配，不合法即抛（与现有「无效的版本号」抛错口径一致）。
置信：confirmed（行为）；实际影响 suspected（无预发布版本号来源）

### F-core-bootstrap-15 | P3 | `packages/core/src/bootstrap/session-fs/session-fs-schema.ts:8` + `packages/core/src/bootstrap/novel-master-bootstrap.ts:27,130`

引文：

```ts
/** No session-fs tables — checkpoints live in `message-checkpoint-schema`. */
export const SESSION_FS_SCHEMA_STATEMENTS: readonly string[] = [];
```

描述：一个永久空数组被 import 进 bootstrap 并 spread 进 `NOVEL_MASTER_SCHEMA_STATEMENTS`。
它不是 RULE「空占位禁令」所指的 migration（后者针对 `schema_migrations` 登记），
所以不违规，但形态上是「为了保持 16 个模块对齐而保留的空壳」——未来若有人新增 schema 模块，
这份空壳会让人以为 session-fs 仍是一张表的归属地。
置信：confirmed（事实）；判定为低危形态债

### F-core-bootstrap-16 | P3 | `packages/core/src/bootstrap/skills/seed-builtin-skills.ts:194-201`

引文：

```ts
await service.writeSkillFile(
  "global", "agent-config", undefined, AGENT_CONFIG_SKILL_MD, undefined,
  exists ? undefined : { builtinSeed: true }
);
```

描述：`writeSkillFile` 是 6 位位置参数签名
（`service/skills/skills.port.ts:104-111`：domain / name / path / content / projectId / options），
seed 传了两个 `undefined` 占位才够到第 6 位。加一个中间参数就会静默错位（类型系统能挡住大部分，
但 `undefined` 占位是这类调用最容易出错的形态）。同文件 :200 的 `createSkillsService(conn)`
在 `catch` 里逐层判 `isSkillError(error, "NOT_FOUND")` 来决定 `exists`，也没走返回值。
建议：不动行为的前提下，把这段改成先 `exists` 判断再分两条明确参数的调用，
或给 port 加一个 `writeBuiltinSkillFile` 的窄接口。
置信：confirmed（可读性债，非缺陷）

## 争议与存疑

1. **「数据动作注册为 schema migration」是否违规**。RULE 的硬规则是
   「`schema_migrations` 只登记不搬运，数据搬运一律走谓词驱动后台任务」。
   但注册表里两条现存 migration 明确做数据动作：
   `dedup-file-cache-storage-v1`（DELETE 整个 file_cache 域，文件头自述「PRD 风险节已拍板…单条引擎内 DELETE
   一次性清空」）与 `retire-pref-session-fs-version-check-v1`（DELETE 一条死偏好键）。
   我的判断：**标 intentional**——两者都是「一次性、可幂等重放、无需进度游标」的清空型动作，
   与「跨 boot 续跑的搬运」不同类，且各自文件头写明了拍板依据。但规则文本的字面表述覆盖不到它们，
   建议 RULE 补一句例外说明，否则 reduce 阶段很可能再被当成问题翻出来。

2. **`add-mcp-file-path-snapshot-v1` 在 migration 内做数据回填**。
   同样撞上「空占位禁令」的字面表述，但该文件 :13-15 明确写了
   「数据回填必须与加列同一首次登记内完成——空占位迁移先登记会被视为已执行，老库将永远错过回填」。
   这是对禁令的正确规避（不是空占位），**标 intentional**，不建议报问题。

3. **`assertMinimumBaseline` 的 legacy 探针只覆盖 6 / 12 条 baseline id**
   （`novel-master-bootstrap.ts:288-305`）。无探针的 6 条里，
   `usage-cache-model-backfill-v1` / `orphan-revision-gc-v1` 按 RULE 明文「数据迁移退役不加 legacy 探针」处理，
   合理；但 `vfs-content-blob-zlib-v1`（`vfs_content_blob.encoding`）与
   `vfs-revision-ref-count-v1`（`vfs_revision.ref_count`）**是有 schema 形态可探的**。
   我没有把它列为发现：极旧库几乎必然同时缺 `vfs_entry.entry_id` 主键（已被 `hasLegacyVfsEntryShape` 覆盖），
   单独命中另两个探针而不命中现有六个的现实路径我没有构造出来。
   留作存疑，不建议现在改。

4. **`SCHEMA_COLUMN_ALIGNMENTS` 里保留了 `chat_session.agent_config_json` 与
   `chat_project.agent_config_json` 两条补列项**，而它们的缺失正是
   `assertMinimumBaseline` 硬 fail-fast 的判据（`hasLegacyChatSessionShape` /
   `hasLegacyChatProjectShape`）。即：这两条 ALIGN 在受支持的库上永远走不到。
   不算错（align 先于/后于 baseline 检查的顺序上，legacy 库会在 baseline 就被拦下），
   但属于「留着当兜底还是该删」的口味问题，我倾向保留（若哪天放宽 baseline，是现成的救生索）。标 suspected。

5. **工作区卫生（非本机位产出，需主代理留意）**：`git status` 显示
   `packages/core/src/infra/serialization/index-probe-shim.ts` 是一个未跟踪的**生产目录源文件**，
   非本次 W2 扫描创建（我只创建并已删除 `tmp/dead-export-scan.mjs` 与 `tmp/_from_list.txt`）。
   疑似并行机位/前序会话的探针残留。`tmp/` 已清空；`package-lock.json` 的改动同样非本次产生。
   未跟踪的 `src/**` 文件会被 `npm run lint` / `tsc` 扫到，提交前建议核实来源。

6. **`compareAppVersions` / `formatTokenCount` 的 desktop 镜像双份维护**
   （`common/format-token-count.ts:14-16`、`common/usage-stats-format.ts:4-6`）
   标 **intentional**：注释写明是「desktop renderer 因 X1 门禁不能 import core」的等价镜像、
   两份注释互指。按 RULE 第 3 条（文档写明的故意设计不当问题报）处理，仅在此备案。

## 附：本机位实测过的「不是问题」清单（供 reduce 阶段免去重复核查）

- `SCHEMA_BOOT_VERSION = 17` 与 21 条 ALIGN、16 个 DDL 模块、v8→v17 版本注释链**逐条对账无缺**
  （含 v18 已撤回的记录）。
- 6 条注册 migration 的文件全部在 `schema-migrations/` 目录内、id 唯一、
  无未登记的 `migrate-*` 残留（`bootstrap-no-migrate.test.ts` 4/4 pass）。
- 20 张被 repository 层 `FROM` 到的表全部有 canonical 建表语句，无孤儿表。
- 12 个受控子路径 + 主入口的 allowlist 快照**全部 pass**（13/13 + 3 条专项），
  快照内容与运行时导出一致（`public-*` 12/12、`main-entry` 1/1、`duplicate-export` 1/1、
  `public-no-config-forms` 1/1）。
- `config-forms/index.ts` 的两条 `export *`（`agent/` + `shared/`）虽然都再导出
  `formatApplicationModelId` / `parseApplicationModelId`，但两者指向**同一个 binding**
  （`config-forms/shared/application-model-id.ts`），不构成 ESM 歧星导出冲突。
- `depth-slice` 工具在 `public/compaction` 与 `config-forms/shared` 的重复导出有
  `duplicate-export-consistency.test.ts` 同源断言兜底。
- 位置参数绑定（`?` + 数组）在 `TdbcConnection.execute/query` 上是契约内的
  （`infra/tdbc/ports/connection.port.ts:17,22`），migration 里的 `?` 用法无误。
