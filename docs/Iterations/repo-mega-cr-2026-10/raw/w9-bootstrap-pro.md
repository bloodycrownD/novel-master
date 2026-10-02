---
zone: w9-bootstrap-pro
agent: 检察官（对抗机位）
files_scanned: 88
---

## 摘要

`packages/core/src/` 的骨架层：bootstrap（SQLite 建表/列对齐/migration 注册表/内置种子数据，31 文件 2169 行）、`public/`（17 个子路径 barrel）、`common/`（跨端纯函数 7 文件）、`config-forms/`（双端配置表单共享逻辑 15 文件）、`errors/`（16 个类型化错误族）、`types/`（1 个 ambient d.ts）、`index.ts`（主入口 271 行）。合计 **87 文件 6207 行 + index.ts 271 行 ≈ 6478 行**。本区无 UI、无领域规则逻辑，职责是「把库结构与对外符号面钉死」。

## 职责与边界

- **bootstrap/**：单事务内跑幂等 DDL（`CREATE TABLE IF NOT EXISTS`）→ 已登记 schema migration → 声明式 legacy 列对齐 → 内置 provider / smart_sort_rule 种子；事务外补内置技能种入与 vfs 发号器完整性修复。`SCHEMA_BOOT_VERSION` 快路径（`user_version >= 17`）跳过 DDL 与列对齐。
- **public/**：每个 exports 子路径一个 barrel 文件，职责单一（只做 `export ... from`），不写逻辑。
- **common/**：`@novel-master/core/common` 子路径，三端共享的纯函数（版本比较、更新说明摘录、token 计数格式化、YAML 错误归一、统计页格式化）。
- **config-forms/**：双端 agent/provider 配置表单的状态机与文案共享层，被 desktop `shared/logic/*` 薄再导出消费。
- **errors/**：16 个按域划分的类型化 Error 类 + 工厂函数，无状态。
- **types/**：唯一文件 `agnai-tokenizers.d.ts`，为 `@agnai/*` 第三方包提供 ambient 声明。

## 对外接口

`packages/core/package.json:8-113` 声明 **26 个 exports 子路径**。逐条核对结果：

| 子路径 | 源文件 | 消费方（实测） |
|---|---|---|
| `.` | `index.ts` | 三端 + `packages/core/test/package-exports-t0.test.ts` |
| `./common` | `common/index.ts` | desktop main/renderer、mobile |
| `./agent` `./chat` `./compaction` `./events` `./feature-flags` `./format` `./message-checkpoint` `./prompt` `./provider` `./session-fs` `./session-run-state` `./skills` `./smart-sort-rule` `./vfs` `./workplace` `./kkv` `./session-kkv` | `public/*.ts` | 三端均有消费 |
| `./tdbc` `./sksp` `./nmtp` | `infra/*/index.ts` | 双端 |
| `./config-forms/agent` `./config-forms/shared` `./config-forms/stored-config-validity` | `config-forms/*/index.ts` | desktop `shared/logic/*` 薄再导出 + mobile 直引 |
| **`./config-forms`** | `config-forms/index.ts` | **零消费**（见 F-1） |

## 数据访问

本区自身不读写业务数据，触碰的**表 / KKV 域 / 文件路径**：

- 表（DDL 定义方）：`vfs_entry` `vfs_revision` `vfs_content_blob` `message_checkpoint(_file)` `kkv_entry` `session_kkv_entry` `session_file_cache_blob` `session_file_cache_entry` `session_run_state` `chat_project` `chat_session` `chat_message` `session_fs_*` `workplace_dir_rule` `workplace_file_rule` `smart_sort_rule` `skill_*` `sksp_secrets` `llm_provider` `llm_saved_model` `agent_registry` `schema_migrations`
  - 证据：`novel-master-bootstrap.ts:120-141`（聚合 16 个 schema 文件）、`bootstrap/*/**-schema.ts`
- KKV 域：`file_cache`（`schema-migrations/dedup-file-cache-storage-v1.ts:27` 硬编码字面量 `FILE_CACHE_DOMAIN = "file_cache"`）、`nm-preferences`（`retire-pref-session-fs-version-check-v1.ts:36` 经 `PREFERENCES_MODULE` 常量）、`nm-agent-config`（`seed-builtin-skills.ts:162`）
- 表名硬编码 vs 常量：`workplace-schema.ts:8-14` 与 `smart-sort-rule-schema.ts:8-10` 导出了 `*_TABLE` 常量供 migration 复用，但 `session-kkv-schema.ts` / `kkv-schema.ts` / `message-checkpoint-schema.ts` **未导出表名常量**，导致三条 migration 各自硬编码表名字面量（见 F-8）
- 文件：`PRAGMA user_version`（`novel-master-bootstrap.ts:144,153`）、`docs/apm/RULE.md`（migration 退役节奏）、`apps/mobile/jest.config.js`（见 F-2/F-3）

## 依赖关系

**import 了谁**：core 内部 `@/infra/tdbc`、`@/domain/*`、`@/service/*`（bootstrap 装配大量 service）；对外仅类型声明零运行时依赖（`types/` 为 ambient）。

**被谁消费**：
- `bootstrapNovelMaster` / `SCHEMA_BOOT_VERSION` / `NOVEL_MASTER_SCHEMA_STATEMENTS` ← `index.ts:55-59` ← desktop main、mobile、cli
- `BASELINE_MIGRATION_IDS` / `BASELINE_TOO_OLD_MESSAGE` ← `assertMinimumBaseline` 内部 + `test/bootstrap/baseline-check.test.ts`、`test/bootstrap/schema-align-columns.test.ts`
- `public/*` ← 26 个 exports 子路径 → 三端
- `config-forms/*` ← desktop `apps/desktop/shared/logic/config-forms-{agent,shared,stored-config-validity}.ts`、mobile 直引

## 发现清单

### F-w9-01 | P2 | `packages/core/package.json:97-100` + `packages/core/src/config-forms/index.ts`

```json
"./config-forms": {
  "types": "./dist/config-forms/index.d.ts",
  "import": "./dist/config-forms/index.js"
}
```

**描述**：`./config-forms` 根子路径是**零消费的死导出面**。实测全仓 `rg -F '@novel-master/core/config-forms"'`（排除 node_modules/dist/md）只命中 `packages/core/tsconfig.test.json:30` 一处路径映射自身，无任何生产或测试代码 import 它。同时它还被登记在三处配置里：`tsconfig.test.json:30`、`apps/mobile/jest.config.js:218-221`、本 `package.json`。而 `config-forms/index.ts` 只有两行 `export *`，内容完全被 `./config-forms/agent` + `./config-forms/shared` 两个子路径覆盖——三处配置都在为一个零用户的 barrel 付维护成本，且新增符号时会让人误以为改这里就够（实际双端都不读它）。

**建议**：删除 `package.json:97-100` 的 `./config-forms` 条目、`tsconfig.test.json:30` 路径、`jest.config.js:218-221` 映射，以及 `config-forms/index.ts` 文件本身。若要保留聚合面，须先有真实消费方。成本近零、风险为零。

**置信**：confirmed

---

### F-w9-02 | P2 | `apps/mobile/jest.config.js:69-72`

```js
'^@novel-master/core/regex$': path.join(
  repoRoot,
  'packages/core/dist/public/regex.js',
),
```

**描述**：`@novel-master/core/regex` 是**指向已删模块的僵尸映射**。正则系统已于 SCHEMA_BOOT_VERSION v11 整体移除（证据：`novel-master-bootstrap.ts:70-74`「v11：移除正则系统——statements 删去 regex_group/regex_rule 建表并加入 DROP TABLE IF EXISTS 幂等清理两表」），`packages/core/src/public/regex.ts` 与 `packages/core/dist/public/regex.js` 实测均**不存在**，`package.json` exports 也无 `./regex` 条目。全仓唯一命中这行映射的就是它自己，无任何 import 方。这条映射目前无害（Jest 只在真被 import 时才解析），但它是「正则系统仍在」的误导性残留，也是下一次有人想恢复 regex 子路径时的假信号源。

**建议**：删除 `apps/mobile/jest.config.js:69-72` 四行。

**置信**：confirmed

---

### F-w9-03 | P2 | `apps/mobile/jest.config.js:194-197` + `packages/core/tsconfig.test.json:32`

```js
'^@novel-master/core/config-forms/events$': path.join(
  repoRoot,
  'packages/core/dist/config-forms/events/index.js',
),
```

**描述**：`@novel-master/core/config-forms/events` 子路径**全域指向不存在的产物**。实测：`packages/core/src/config-forms/` 下只有 `agent/`、`shared/`、`stored-config-validity/` 三个目录，**无 `events/`**；`dist/config-forms/events/index.js` 不存在；`package.json` exports 也无 `./config-forms/events` 条目。唯一「消费方」是 `apps/desktop/scripts/fix-settings-utf8.mjs:87`，而该脚本本身已是**整条死路径**：它 `readFileSync(root + "renderer/features/settings/EventsConfigView.tsx")`（实测文件不存在），生成代码 import `EventActionNode/EventActionType/EventsConfig/EVENT_ADD_OPTIONS/configToEventBlocks/newEventBlockId` 等 13 个符号（全仓仅此文件出现），并 import `./services/regex-test.service`（实测不存在）。即：一次性 UTF-8 修复脚本，目标文件与其依赖的整个 events 配置表单子系统都已随 regex/events 下线而消失，但脚本、它引用的幽灵子路径、以及为它存在的两处构建配置全部留存。

**建议**：① 删除 `apps/desktop/scripts/fix-settings-utf8.mjs`（540 行纯死代码）；② 连带删除 `jest.config.js:194-197` 与 `tsconfig.test.json:32` 两行映射。

**置信**：confirmed

---

### F-w9-04 | P1 | `packages/core/tsconfig.test.json:26`

```json
"@novel-master/core/kkv": ["./src/service/kkv/index.ts"],
```

**描述**：`tsconfig.test.json` 的 paths 与 `package.json` 的 exports 对同一子路径**指向不同文件**——paths 指内部 barrel `src/service/kkv/index.ts`，exports 指公共 barrel `dist/public/kkv.js`（`package.json:81-84`）。两者内容当前等价（`public/kkv.ts:11-14` 与 `service/kkv/index.ts:10-13` 转出同一组 `createKkvService/KkvService/KkvError/isKkvError/KkvErrorCode`），所以今天没有症状；但这正是 RULE「实现禁令与坑」里点名过的 dist/src 双份代码陷阱的变体：**core 自己的测试从不对 `src/public/kkv.ts` 做任何解析验证**。实测 `packages/core/test/package-exports-t0.test.ts:4` 的 `import { createKkvService, KkvError } from "@novel-master/core/kkv"` 在 tsx 下吃的是 `src/service/kkv/index.ts`——即那个名为「package exports 契约测试」的用例，验的是内部 barrel 而不是公共 barrel。后果：`public/kkv.ts` 若被误删/误改导出，测试全绿而 mobile Jest（`jest.config.js:116-119` 直连 `dist/public/kkv.js`）与真机运行才炸。

**建议**：把 `tsconfig.test.json:26` 改为 `["./src/public/kkv.ts"]`，与 `package.json` 对齐；改完跑一次 `packages/core/test/package-exports-t0.test.ts` 确认仍绿。同时考虑让 `service/kkv/index.ts` 与 `public/kkv.ts` 二者留一（当前是同内容的双 barrel，见 F-5）。

**置信**：confirmed

---

### F-w9-05 | P3 | `packages/core/src/service/kkv/index.ts` + `packages/core/src/public/kkv.ts`

**描述**：`kkv` 子路径有**两份内容等价的 barrel**。`public/kkv.ts:11-14` 与 `service/kkv/index.ts:10-13` 逐行对应（仅注释与相对路径深度不同）。`service/kkv/index.ts:2` 的注释还自称「not part of the main `@novel-master/core` public API」，但它经 `tsconfig.test.json:26` 事实上就是 core 测试进程里该子路径的解析结果（见 F-4）。两份 barrel 各改一处就会漂移，且没有一致性测试——现有唯一的一致性测试 `test/package-exports/duplicate-export-consistency.test.ts` 只覆盖 `compaction` vs `config-forms/shared` 的 depth-slice 两符号。

**建议**：与 F-4 合并处理——让 `public/kkv.ts` 成为唯一公共 barrel，`service/kkv/index.ts` 删除（内部消费方改直引 `create-kkv-service.js`），或在 `duplicate-export-consistency.test.ts` 里加一条断言锁住两者等价。

**置信**：confirmed

---

### F-w9-06 | P3 | `packages/core/src/common/memoize.ts`

**描述**：**122 行零消费死模块**。实测全仓 `rg "memoize"` 于 `*.ts/*.tsx/*.mjs`（排除 node_modules/dist）只命中本文件自身；`common/index.ts:8-27` 的 barrel **未导出** `memoize`，即 `@novel-master/core/common` 子路径也拿不到它。同类工具 `memoize-one` 已在 `package-lock.json:24259` 作为依赖存在（某个包传递引入）。文件头注释详述设计（`:2-8`），但没有任何调用方——是为某个已取消的需求预留的。

**建议**：物理删除 `packages/core/src/common/memoize.ts`。若确有未来需求，重写成本远低于维护一份无调用方的缓存语义（含 `memoizeSingle`/`memoizeMulti` 的 `fn.length` 分流这个易错点）。

**置信**：confirmed

---

### F-w9-07 | P3 | `packages/core/src/types/agnai-tokenizers.d.ts`

**描述**：**重复且无效的 ambient 声明**。本文件为 `@agnai/sentencepiece-js` 与 `@agnai/web-tokenizers` 声明类型，但 `packages/core/package.json:127-134` 的 dependencies 里**没有** `@agnai/*`，core 源码与测试中也无任何 `@agnai` 引用（实测 `rg "@agnai" packages/core/src packages/core/test` 只命中本文件第 1、11 行）。真正需要这份声明的是 `packages/tokenizer-driver-node/src/types/agnai-tokenizers.d.ts`（同内容副本），该包 `:23-24` 确实声明了这两个依赖并有真实 import（`impl/web-tokenizer-counter.ts:7`、`impl/sentencepiece-token-counter.ts:7`）。core 这份是历史搬迁残副本。

**建议**：删除 `packages/core/src/types/agnai-tokenizers.d.ts`，整个 `types/` 目录随之清空。注意 RULE「Hermes 无 WebAssembly，RN 侧只能用纯 JS」——该声明在 core 里对移动端构建毫无作用，删除不影响任何打包路径。

**置信**：confirmed

---

### F-w9-08 | P3 | `packages/core/src/bootstrap/schema-migrations/dedup-file-cache-storage-v1.ts:27,34`

```ts
/** file_cache 域名（与 SESSION_KKV_DOMAIN_FILE_CACHE 同源字面量）。 */
const FILE_CACHE_DOMAIN = "file_cache";
...
`DELETE FROM session_kkv_entry WHERE domain = '${FILE_CACHE_DOMAIN}'`
```

**描述**：**表名与域名字面量漂移风险**。同目录另两条 migration 的做法相反：`workplace-dir-rule-smart-field-v1.ts:26-29` 从 `../workplace/workplace-schema.js` import `WORKPLACE_DIR_RULE_TABLE` 常量，`add-smart-sort-capture-kind-v1.ts:19` import `SMART_SORT_RULE_TABLE`，`retire-pref-session-fs-version-check-v1.ts:22,36` 用 `PREFERENCES_MODULE` 常量防漂移。而本条把 `session_kkv_entry` 表名与 `file_cache` 域名字面量双重硬编码，注释还自认「与 SESSION_KKV_DOMAIN_FILE_CACHE 同源」却没引用它。根因是 `session-kkv-schema.ts:8-17` 没有导出表名常量（对比 `workplace-schema.ts:8-14` 导出了 4 个常量）。同理 `add-mcp-file-path-snapshot-v1.ts:26` 硬编码 `MESSAGE_CHECKPOINT_FILE_TABLE`，而 `message-checkpoint-schema.ts:29` 明明导出了 `MESSAGE_CHECKPOINT_FILE_TABLE_DDL`。

注意：migration 内联历史快照是 RULE 认可的形态（`workplace-dir-rule-smart-field-v1.ts:37`「迁移是历史快照，此处硬编码 v11 形态、不随 canonical 后续演进漂移」）。但**表名**不是会演进的形态，它跨 boot 必须与当前 canonical DDL 一致——`dedup-file-cache-storage-v1` 至今仍在 `SCHEMA_MIGRATIONS` 注册表里（`index.ts:42`），每次 bootstrap 都会执行，真表名若变更则 DELETE 静默删 0 行并被 `markSchemaMigrationApplied` 永久标记为已应用。故这条不算「历史快照正当性」，算真实的静默失效风险。

**建议**：① 在 `session-kkv-schema.ts` 与 `kkv-schema.ts` 导出 `SESSION_KKV_ENTRY_TABLE` / `KKV_ENTRY_TABLE` 常量（DDL 模板与 migration 共用）；② 三条 migration 的表名改引常量。域名字面量可保持内联（域常量在 `domain/session-kkv/` 下，与 bootstrap 反向依赖，不宜）。

**置信**：confirmed

---

### F-w9-09 | P3 | `packages/core/src/errors/agent-runtime-errors.ts:13,38-43`

```ts
| "UNSUPPORTED_PROVIDER"
...
export function agentUnsupportedProvider(protocol: string): AgentError {
```

**描述**：`agentUnsupportedProvider` 工厂与 `UNSUPPORTED_PROVIDER` 错误码**全仓零消费**。实测 `rg "agentUnsupportedProvider"` 只命中定义处本身；`rg '"UNSUPPORTED_PROVIDER"'` 只命中类型声明（`:13`）与工厂体（`:40`）。同文件的 `agentDoomLoop` 有真实消费方（`domain/agent/logic/doom-loop.ts:11,35`，被 `test/agent/doom-loop.test.ts` 覆盖）。`AgentError` 类本身活跃（`public/agent.ts:21` 转出、mobile `format-error.ts:59` instanceof 判定、cli `cli-errors.ts:36,63`），所以这是单个工厂 + 单个码的悬空，不是整个错误族死掉。

**建议**：删除 `agentUnsupportedProvider`（`:37-43`）并从 `AgentErrorCode` 移除 `"UNSUPPORTED_PROVIDER"`（`:13`）。若判断「协议不支持 tools」这条业务将来会回来，git 历史留痕足够。

**置信**：confirmed

---

### F-w9-10 | P3 | `packages/core/src/config-forms/agent/agent-editor-state.ts:99-114, 199-204`

```ts
/** @deprecated Use {@link buildToolsPolicyFromSelection}. */
export function buildToolsPolicy(...)

/** @deprecated Use {@link toolsSelectionFromDefinition}. */
export function toolsFromDefinition(...)

export function joinPersistBlocksForLayout(...)
```

**描述**：三处冗余导出面。① `buildToolsPolicy`（`:100-105`）与 `toolsFromDefinition`（`:108-114`）均标 `@deprecated` 且**全仓零调用**（实测 `rg` 只命中定义与 JSDoc 引用），两个 `@deprecated` 标记是纯装饰。② `joinPersistBlocksForLayout`（`:200-204`）实测零调用。③ `parseToolsList`（`:92`）与 `hasEffectivePromptSource`（`:329`）虽**有内部调用**（`:104`、`:584`），但不该 `export`——它们被 `export * from "./agent-editor-state.js"`（`config-forms/agent/index.ts:1`）一路透到双端公共面。

**建议**：删 `buildToolsPolicy` / `toolsFromDefinition` / `joinPersistBlocksForLayout` 三个函数体；把 `parseToolsList` / `hasEffectivePromptSource` 的 `export` 去掉（保留内部函数）。同步把 `config-forms/agent/index.ts` 的 `export *` 收敛为具名导出（这也是 RULE 中 X1 门禁对 `apps/desktop/shared/**` 立的规矩——「只允许 `export {} from`、禁 `export *`」，core 侧 barrel 反而没守）。

**置信**：confirmed

---

### F-w9-11 | P3 | `packages/core/src/config-forms/stored-config-validity/types.ts:25,28`

```ts
export const CURRENT_EVENTS_SCHEMA_VERSION = 2 as const;
export const CURRENT_AGENT_SCHEMA_VERSION = 1 as const;
```

**描述**：两个 schema 版本常量中，`CURRENT_EVENTS_SCHEMA_VERSION` **零消费**（随 events 子系统下线成为孤儿）。`CURRENT_AGENT_SCHEMA_VERSION` 同样只在定义处出现一次——两者都经 `stored-config-validity/index.ts:7` 的 `export * from "./types.js"` 暴露到 `@novel-master/core/config-forms/stored-config-validity`，而 desktop 的薄再导出（`apps/desktop/shared/logic/config-forms-stored-config-validity.ts:9,16`）与 mobile 直引都只取 `StoredConfigHealth` / `STORED_CONFIG_LABELS` 等具体符号。

**建议**：删除 `CURRENT_EVENTS_SCHEMA_VERSION`；`CURRENT_AGENT_SCHEMA_VERSION` 若确认无未来 bump 用途（agent definition schema 已定型）一并删除，否则保留但从 barrel 移出、只供 core 内部使用。证据强度：`CURRENT_AGENT_SCHEMA_VERSION` 一条我标 confirmed（实测零外部引用），但「未来是否会用」属产品判断，故与 F-10 的删除建议分开表述。

**置信**：confirmed（零消费事实）/ intentional（是否保留由 owner 决）

---

### F-w9-12 | P3 | `packages/core/src/index.ts:196-204`

```ts
MUTATING_VFS_TOOL_NAMES,
isMutatingVfsToolName,
...
registerVfsTools,
```

**描述**：主入口三个导出零消费。`MUTATING_VFS_TOOL_NAMES` 与 `isMutatingVfsToolName` 在 `domain/tool/builtin/vfs-tools.ts:58,66` 就是 `MUTATING_FILE_TOOL_NAMES` / `isMutatingFileToolName` 的**同值别名**（`const X = Y` / `const f = g`），而这两个真身在 `index.ts:195,197` 已经导出——即主入口同一组语义导了两遍。`registerVfsTools`（`register-builtin-tools.ts:47`）零消费，实测唯一命中是 `validate-agent-definition.ts:16` 注释里的文字提及。另 `EncodableSchema`（`:268`）只有 `encode.ts:11,19` 自身使用，外部零引用。

**建议**：从 `index.ts` 删 `MUTATING_VFS_TOOL_NAMES`、`isMutatingVfsToolName`、`registerVfsTools`；`vfs-tools.ts:58,66` 两个别名若无内部消费方也一并删（保留下来的话至少从主入口摘掉）；`EncodableSchema` 若只为 `encode` 的签名服务，可保留但不导出（`encode` 的类型已内联暴露）。

**置信**：confirmed

---

### F-w9-13 | P3 | `packages/core/src/errors/chat-errors.ts:8`

```ts
export type ChatErrorCode = "NOT_FOUND" | "CONFLICT" | "INVALID_ARGUMENT";
```

**描述**：`"CONFLICT"` 码**无任何构造方**。实测 `rg '"CONFLICT"'` 于 `errors/chat-errors.ts`、`domain/chat/`、`service/chat/` 全无命中；`chat-errors.ts` 只提供两个工厂 `chatNotFound`（造 `NOT_FOUND`）与 `chatInvalidArgument`（造 `INVALID_ARGUMENT`），`ChatError` 类虽导出但全仓无第三处 `new ChatError(...)` 直接构造。码值是判别式联合的成员，外部消费方（`apps/desktop/src/main/ipc/handlers/` 等）按码分支时 `CONFLICT` 分支永远走不到。

**建议**：从 `ChatErrorCode` 移除 `"CONFLICT"`。低风险——移除联合成员对现有 switch 只会让 `CONFLICT` 分支变成 TS 编译期不可达报错，正好暴露是否有隐藏消费方（跑一次 typecheck 即知）。

**置信**：confirmed

---

### F-w9-14 | P2 | `packages/core/src/common/usage-stats-format.ts:1-8`

**描述**：**跨端双份实现，靠注释互指维持同步**。core 版 `usage-stats-format.ts` 与 `apps/desktop/shared/logic/usage-stats-format.ts` 逐函数等价复制（`formatRequestTime` / `formatDurationMs` / `pageWindowItems`），文件头注释双向声明「修改任一份时同步另一份」。实测消费：mobile `RequestsTab.tsx:4-9` 直引 `@novel-master/core/common`；desktop `TokenUsageStatsView.tsx:33-36` 引 `@shared/logic/usage-stats-format`（本仓副本）。

**标 intentional**：desktop renderer 受 **X1 门禁**（`apps/desktop/eslint.config.mjs` 禁 renderer 直 import `@novel-master/core*`，见 `docs/Iterations/release-1.5.6/cr-fix-spec.md:83` 与 `docs/Iterations/token-usage-stats/spec.md:105` 的拍板记录）禁止直连 core，故副本是门禁的设计后果而非疏忽。**不作为缺陷上报**，记录在此仅为让后续机位/台账知道这是已知双源、且副本与源文件的同步目前纯靠人工注释、无机制保障。

**置信**：intentional

---

### F-w9-15 | P2 | `packages/core/src/bootstrap/schema-migrations/index.ts:36-43` + `novel-master-bootstrap.ts:171-184`

**描述**：**migration 注册表与退役节奏的当前存量**（风险台账，非缺陷）。注册表 `SCHEMA_MIGRATIONS` 现有 **6 条**：`retire-pref-session-fs-version-check-v1`、`workplace-dir-rule-smart-field-v1`、`rename-smart-sort-rule-example-v1`、`add-smart-sort-capture-kind-v1`、`add-mcp-file-path-snapshot-v1`、`dedup-file-cache-storage-v1`。`BASELINE_MIGRATION_IDS` 现有 **12 条**已退役 id（`novel-master-bootstrap.ts:171-184`，其中 4 条属第四轮退役，最低支持版本抬到 v1.5.5）。

对照 RULE「schema migration 清理有约定节奏」条目（`docs/apm/RULE.md:77`）：第四轮退役锚定 v1.5.5（2026-09-12），**「10 个版本后再清下一轮」**。实测当前版本 `apps/desktop/package.json` = `1.5.28`、最新 tag = `v1.5.28`——距第四轮锚点已 **23 个版本**，第五轮清理的「10 个版本」门槛早已越过且超出 13 个版本。注册表里最老的 `workplace-dir-rule-smart-field-v1`（`git log` 溯到 2026-09-13 前的 smart-sort 迭代）与 `add-smart-sort-capture-kind-v1`（`2252ee10` 2026-09-13）均已远超一轮清理窗口。

同时注意 RULE 同一条目末尾的 2026-09-28 拍板：「**同轮退役的还有后台迁移类任务**——消息压缩搬运（message-content-compression）与 blob 二进制归一（binary-blob-and-vfs-pack Part A）均约定约 10 个 tag 后删除迁移任务与旧形态读兼容分支」，且指定「届时与 migration 清理同一轮做」。这两条后台任务的生命周期节点也已到期。

**建议**：开第五轮退役。候选与三件套（RULE:77）逐条对应：① `retire-pref-session-fs-version-check-v1`——纯 DELETE 死键，无 schema 形态，逻辑已无处（读写三件套早已删），可整条从 `SCHEMA_MIGRATIONS` 摘除并**物理删除源文件与专属测试**；② `add-smart-sort-capture-kind-v1` / `add-mcp-file-path-snapshot-v1`——纯 ADD COLUMN，逻辑已固化进 canonical DDL（实测两列均在 DDL 中：`smart-sort-rule-schema.ts` 有 `capture_kind`、`message-checkpoint-schema.ts:34` 有 `path`），按三件套摘除 + 抬 `BASELINE_MIGRATION_IDS`；③ `workplace-dir-rule-smart-field-v1` / `rename-smart-sort-rule-example-v1` 属 **CHECK 变更 / RENAME**，「数据迁移无法固化进 DDL，只能靠中间版本保底」（RULE:77 原话），按先例退役进 `BASELINE_MIGRATION_IDS`、**不加 legacy 探针**；④ `dedup-file-cache-storage-v1` 是清空型 DELETE，随 ⑤ message-content 压缩搬运 / blob 二进制归一并入同轮。同步要改 `test/bootstrap/bootstrap-no-migrate.test.ts:33-36` 的 `BASELINE_BACKUP_MODULES`（当前是空 Set，注释说 9 个已物理删除）。

**标 intentional**：节奏本身是 RULE 拍板的（10 个版本一轮），本条**不报「清理太慢」为缺陷**，而是指出**第五轮的到期事实与候选清单**，供主代理排 backlog。另 `SCHEMA_BOOT_VERSION = 17`（`novel-master-bootstrap.ts:117`）与 v18 撤回的注释链（`:111-115`）一致无漂移，无需处理。

**置信**：intentional（节奏）/ confirmed（存量与到期事实，实测 6 条注册、12 条 baseline、当前 v1.5.28）

---

## 争议与存疑

1. **F-11 的 `CURRENT_AGENT_SCHEMA_VERSION` 该不该删**：零消费是 confirmed，但它是「agent definition schema 版本」的语义锚点。若 W3/W5 有人正在做 schema 演进规划，删了会丢语义。**建议由 owner 决，我不坚持删**。

2. **F-04 vs F-05 的修法分叉**：`tsconfig.test.json` 改指 `public/kkv.ts` 后，`service/kkv/index.ts` 就完全没有测试解析方了（内部 barrel 只被 `service/kkv/impl/kkv.service.ts` 通过相对路径 import，不走子路径）。此时「删 service barrel」与「改 paths」可以只做其一。我倾向两者同做（消除双 barrel），但如果 owner 认为 `service/kkv/index.ts` 有独立存在价值（例如未来要区分 internal/public 导出面），只改 paths 也够。**这是取舍不是事实分歧。**

3. **F-03 的删除范围**：`fix-settings-utf8.mjs` 是不是「有意保留的历史修复脚本」我无法从代码判定——它有完整的 run 指引（`:3` `Run: node apps/desktop/scripts/fix-settings-utf8.mjs`），形态像一次性修复工具而非常驻脚本，且目标文件已不存在。**若 owner 认为该脚本对应某次 mojibake 事故的复现能力需要保留，则只删两处构建配置映射（F-03 的②）、保留脚本。** 我倾向全删但保留异议。

4. **F-08 的定性边界**：我把 `dedup-file-cache-storage-v1` 的表名硬编码记为**真实风险**而非「历史快照正当性」，理由是它**仍在注册表里、每次 bootstrap 都执行**、而表名必须与当前 DDL 一致。但这是一个**推理**（真表名变更的概率低），不是实测到的 bug。若有信息表明 `session_kkv_entry` 表名已冻结不再变更，本条可降为 P3/纯整洁性。

5. **未覆盖的邻接风险**（本区之外，仅记录不主张）：`packages/core/src/index.ts:270` 注释说 `./compaction` 子路径「已被上下文裁剪域占用」故 db-maintenance 不新增 exports 子路径——这个「上下文裁剪域」的自述含义我没有查证（可能在 host 侧有对应约束），不影响本区结论。

6. **独立性声明**：本报告未读取 `raw/` 下任何其他机位报告与 `synth/` 下任何综合文档。RULE 决策感知仅读 `docs/apm/RULE.md` 与 `docs/Iterations/` 下非 raw/synth 的历史迭代文档（`release-1.5.6/cr-fix-spec.md`、`token-usage-stats/spec.md`）。
