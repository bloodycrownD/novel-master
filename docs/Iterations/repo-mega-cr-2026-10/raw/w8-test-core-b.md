---
zone: w8-test-core-b
agent: test-corpus-health（测试语料健康度）
files_scanned: 429（packages/core/test 全部 `*.test.ts` 实测枚举）；本 zone 认领 127 文件 / 851 用例
---

# W8 · test-core-b：packages/core/test 后半区测试语料健康度

## 摘要

`packages/core/test/` 是 core 包 429 个测试文件、3031 条用例的 node:test 语料。本 zone 按派单认领「目录后半」：`service/**`（25）、`bootstrap/**`（19）、根级 2 个、`package-exports/**`（4），以及 workplace / skills / session-* / kkv / sksp / smart-sort* / persistent* / config-forms / character-card / depth / cloud-sync / compaction-conditions / db-backup / domain 共 50 个，合计 127 文件 851 用例。任务口径是拿 RULE「验收断言的『牙齿』三条判据」找**无牙断言 / 死测试 / 续命测试 / fixture 腐烂**四类语料缺陷。核心结论：整个语料**零 skip / 零 todo / 零 only**（实测），绝大多数用例有牙；缺陷高度集中在「登记表断言」「源码文本 grep」「自播种后自证」「手维护清单已漂移」四个可复制的家族上。

## 职责与边界

- **职责**：断言是否有牙齿（把实现改错会不会红）、用例是否因进程/顺序/事务约束恒红、同一夹具是否服务互斥期望、夹具与生产是否已漂移。
- **边界**：不评生产代码质量（那由 w2/w9 各域机位负责）；不评覆盖率充分性（由 cov-hotmap 机位负责）；本报告只对**测试文件本身**与**测试↔生产之间的漂移**发言。
- **zone 划分口径**：与 `w8-test-core-a` 的分界未在 PLAN.md 里写死，我按派单文字（"service/、bootstrap/、根级及其余"）取后半目录并全部做完；`agent/` `chat/` `infra/**` `message-checkpoint/` `prompt/` `provider/` `tool/` `vfs/**` 归 a 区。所有启发式扫描是**全 429 文件**跑的，所以下面有几条发现落在 a 区文件上，已单独标注 `[跨区]` 供 reduce 去重时对照。

## 对外接口

测试语料本身不导出生产接口，但它**钉死**的公开面清单如下（这是本 zone 最重要的"对外接口"）：

| 守卫物 | 位置 | 钉住什么 |
|---|---|---|
| `SCHEMA_MIGRATIONS` 阵尾/相对序 | `bootstrap/*-v1.test.ts` ×6 | schema 迁移登记顺序 |
| `main-entry-allowlist.json` + `public-<name>-allowlist.json` ×12 | `test/package-exports/` | 12 个子入口的具名导出快照 |
| `BUILTIN_TOOL_CATALOG.length === 11` / `registry.list().length === 11` | `config-forms/agent-tool-catalog.test.ts:15`、`tool/tool-schema-descriptions.test.ts:26` | 内置工具总数 |
| `REQUIRED_DIST_FILES` ×2 | `test/dist-artifacts.test.ts:10-13` | 构建产物落地 |
| `BASELINE_MIGRATION_IDS` / `BASELINE_TOO_OLD_MESSAGE` | `bootstrap/baseline-check.test.ts` | 最低支持版本 fail-fast |

## 数据访问

测试语料不碰生产数据，但**每个集成文件开一个共享内存库**，这是本 zone 最大的隐性夹具面：

- `test/helpers/novel-master-fixture.ts:14` 模块级 `sharedCtx`，`:18` `before` 开库、`:21` `after` 关库 → **一个文件内所有 `it` 共用同一个 `:memory:` 库**。
- `test/helpers/novel-master.ts:66` `bootstrapNovelMaster(conn)` 全量 bootstrap；`:71-82` 每次都 seed 一个 `test-default-agent` 并 `setCurrentAgentId` → 每个集成文件的全局状态里**恒定多一个 agent**。
- `test/helpers/novel-master.ts:40` 提供 `testIsolationSuffix()` 但**有 5 个文件 import 了却从不调用**（见 F-13）。
- `tsconfig.test.json` 的 `paths`（28 条）是 `package.json` `exports`（25 子入口）的**第二份手维护副本**，两者无任何测试比对（见 F-4）。

## 依赖关系

- **import 了谁**：`test/helpers/*`（7 个共享夹具）；`../../src/**` 深路径 90/127 个文件走源码；`@novel-master/core*` 公开入口 75/127 个文件走 `tsconfig.test.json` 的 paths 映射（**注意：tsx `--tsconfig tsconfig.test.json` 把 `@novel-master/core` 映到 `./src/index.ts`，不是 `dist`**，所以测试跑的是源码，不受陈旧 dist 影响——这一点我实测确认过，避免误报）。
- **被谁消费**：`packages/core/package.json:121` 的 `npm test`（`bash -O extglob -O globstar -c 'tsx ... --test test/**/!(performance).test.ts'`）。globstar 已修（RULE 记载），根级文件与嵌套目录均被收进。
- **CI 依赖**：`.github/workflows/ci.yml:51` 先 build 再 `:66` test，blocking。

## 发现清单

### F-w8-test-core-b-1 | P2 | 续命测试 | `packages/core/test/bootstrap/dedup-file-cache-storage-v1.test.ts:101-106` | 置信 confirmed

```ts
it("登记于 SCHEMA_MIGRATIONS 阵尾", () => {
  assert.equal(SCHEMA_MIGRATIONS.at(-1)?.id, DEDUP_FILE_CACHE_STORAGE_V1_ID);
});
```

**证明**：这是判据②的教科书地雷——断言的是「本迁移是最后一条」。实测 `src/bootstrap/schema-migrations/index.ts:36-43` 里 `dedupFileCacheStorageV1Migration` 当前恰在阵尾，所以现在是绿的；**加第 7 条 migration 就会红，而行为毫无变化**。更关键的是这个坑已经炸过至少 3 次，痕迹就写在同 zone 另外 5 个文件的用例名里：

- `add-mcp-file-path-snapshot-v1.test.ts:104`「（dedup-file-cache-storage-v1 入列后不再居尾）」
- `add-smart-sort-capture-kind-v1.test.ts:91`「（add-mcp-file-path-snapshot-v1 入列后不再居尾）」
- `retire-pref-session-fs-version-check.test.ts:81`「（队尾由 workplace-dir-rule-smart-field-v1 接任）」
- `rename-smart-sort-rule-example-v1.test.ts:101`「（后续迁移排其之后，**阵尾断言归各自迁移测试**）」——最后这句是投降声明：这条断言已经被改到什么都不断言了。

一个「防止别人踩」的守卫，最后自己变成了需要每次迁移都去改的 chore，这是续命测试的定义形态。

**建议**：删掉阵尾断言（`bootstrap-no-migrate.test.ts:79-102` 的「schema-migrations 目录内 migration 模块均已注册」已经覆盖了真正的风险——漏登记）；确需顺序保证就改成对**具体前驱 id** 的相对序断言，别用位置。

### F-w8-test-core-b-2 | P2 | 续命测试（守卫面冻结在 12/25） | `packages/core/test/package-exports/public-subpath-allowlist.test.ts:5-18` | 置信 confirmed

```ts
const SUBPATHS = ["agent","chat","compaction","events","feature-flags",
  "message-checkpoint","prompt","provider","session-fs","smart-sort-rule","vfs","workplace"] as const;
```

**证明**：实测 `packages/core/package.json:8-112` 的 `exports` 有 **25 个子入口**（含 `.`），而这个守卫只覆盖 12 个；`test/package-exports/snapshots/` 目录下也确实只有 12 个 `public-*-allowlist.json`（+1 个 main）。**未被守卫的 13 个**是：`common`、`format`、`tdbc`、`sksp`、`nmtp`、`kkv`、`session-kkv`、`session-run-state`、`skills`、`config-forms`、`config-forms/agent`、`config-forms/shared`、`config-forms/stored-config-validity`——这 13 个子入口可以在公开面任意增删导出、删掉整份 re-export、引入内部实现，**全仓没有任何一条测试会红**。守卫面在子入口从 12 长到 25 的过程中没跟上，等于对三分之二的公开 API 放弃了回归保护。

**建议**：`SUBPATHS` 从 `package.json` 的 `exports` 自动生成（去重去 `.`），缺失的子入口用 `UPDATE_SNAPSHOT` 方式补齐 13 份快照；否则把守卫明确降级并在文件头写明「仅覆盖这 12 个」，别让它冒充全量守卫。

### F-w8-test-core-b-3 | P2 | 无牙断言（守着一个已消失的命名约定） | `packages/core/test/bootstrap/bootstrap-no-migrate.test.ts:39-72` | 置信 confirmed

```ts
const migrateFiles = files.filter((file) => {
  const normalized = file.replace(/\\/g, "/");
  if (!normalized.includes("/migrate-")) return false;
  return !normalized.includes("/bootstrap/schema-migrations/");
});
```

**证明**：判据①无牙。实测 `packages/core/src` 全树 `migrate-` 出现 **0 次**（`Get-ChildItem -Recurse -Filter '*migrate*'` 返回空；`Select-String -Pattern 'migrate-'` 在全部 `.ts` 上 0 命中）。当前 6 条在册迁移的文件名是 `retire-pref-session-fs-version-check-v1.ts` / `workplace-dir-rule-smart-field-v1.ts` / `rename-smart-sort-rule-example-v1.ts` / `add-smart-sort-capture-kind-v1.ts` / `add-mcp-file-path-snapshot-v1.ts` / `dedup-file-cache-storage-v1.ts`，**全都不带 `migrate-` 前缀**。所以真出现「写了迁移但忘了登记」这个它要防的缺陷时，这两条照样绿。同时它们每次跑都要 `collectTsFiles(CORE_SRC)` + 逐个 `readFile` 扫全树，是纯 IO 成本换零信号。

**建议**：删掉这两条；真要守「不该有游离迁移模块」，检测对象应该改成 `schema-migrations/` 目录**之外**的 `*-v1.ts` 文件。

### F-w8-test-core-b-4 | P2 | fixture 腐烂（手维护清单已实际漂移） | `packages/core/tsconfig.test.json:32` | 置信 confirmed

```json
"@novel-master/core/config-forms/events": ["./src/config-forms/events/index.ts"],
```

**证明**：实测 `packages/core/src/config-forms/events/` **不存在**（`if exist` → `CF_EVENTS_MISSING`）。这条路径映射指向一个不存在的模块。它今天不炸，只是因为没人 import 它——但它证明了 `tsconfig.test.json` 的 `paths` 与 `package.json` 的 `exports` 是**两份互不校验的手维护清单**，而且**已经开始漂移**（多出一条 package.json 没有的子入口）。风险是双向的：只改 package.json → core 测试解析不到新子入口；只改 tsconfig.test.json → core 测试全绿，但发布的包里根本没有这个子入口，desktop/mobile（按 package.json 解析）直接 404。

**建议**：加一条测试断言两份清单的子入口集合相等；`config-forms/events` 这条要么补目录要么删映射。

### F-w8-test-core-b-5 | P2 | 无牙断言（测试自播种后自证） | `packages/core/test/compaction-conditions/run-compaction.test.ts:151-156`、`packages/core/test/vfs/clear-session-prompt-caches.test.ts:39-43` | 置信 confirmed

```ts
sessionApiPromptTokenCache.set(sessionId, { promptTokens: 1234, updatedAt: Date.now() });
await seedPromptTokenRow(sessionId);
assert.ok(sessionApiPromptTokenCache.get(sessionId) != null);   // ← 中间没有任何生产调用
```

**证明**：判据①无牙的经典形态。这两处都是测试自己 `.set()` 之后**隔 0-5 行、其间不碰任何生产代码**就断言「非空」。断言的是「我的夹具写进去了」，不是任何生产行为——**把 `runCompaction()` / `clearSessionPromptCaches()` 整个删掉，这两行照样绿**。真正有牙的是同用例里隔了几十行、在生产调用之后的 `assert.equal(cache.get(sessionId), undefined)`（run-compaction.test.ts:181 / clear-session-prompt-caches.test.ts:59）。

同一段代码在别的文件里是**写对的**——`vfs/vfs-zip-io.test.ts:755` 先 set、中间 :761 走 `zipSvc.import`、:776 才断言非空；`character-card/character-card-import.test.ts:666` set、:673 走 `svc.import`、:688 断言非空。说明这两处是复制粘贴时丢了中段，而不是有意的设计。

**建议**：删掉这两行自证（它们是调试期留下的 sanity check 被固化进了用例名里的「预置…验证…」叙事）。

### F-w8-test-core-b-6 | P2 | 无牙断言（源码文本 grep，双向失效） | `packages/core/test/workplace/workplace-block-capture-allowlist.test.ts:74-88` | 置信 confirmed

```ts
it("T-MAU-RC2：agent-runner 须调用 assembleWorkplaceDisplay", async () => {
  const source = await readFile(path.join(CORE_SRC, rel), "utf8");
  assert.match(source, /assembleWorkplaceDisplay\s*\(/, ...);
```

**证明**：判据①两个方向都失效。**恒红方向**：把调用挪进 helper 文件、把 import 改别名、或换行导致 `assembleWorkplaceDisplay(` 不再连续出现（正则 `\s*\(` 已经放宽了括号前空白，但对 `assembleWorkplaceDisplay\n  (` 之外的形态仍敏感）——行为完全没变，测试就红。**恒绿方向**：只要那个调用还留在文件里，哪怕它在死分支里、被 `if (false)` 包着、结果被丢弃，测试照样绿。`MUST_ASSEMBLE` 数组（:34-36）目前只有一项，是纯文本存在性检查。

同文件 :53-72 的 `T-MAU-RC1`（扫全树禁已退役 API）方向是对的（它禁的是标识符，重命名成本高、逃生成本也高），只有 :74 这条是"须存在"式的，后者天然无牙。

**建议**：改成可注入缝计数——参照同仓已做对的 `service/chat/message-search-service-limit.test.ts:48-64`（假仓储 + 计数），给 agent-runner 的 workplace 装配点注入一个计数器，断言「本次 run 调用了 N 次」。

### F-w8-test-core-b-7 | P2 | 断言缺口（声明的目的没被覆盖） | `packages/core/test/config-forms/agent-tool-catalog.test.ts:14-15`、`packages/core/test/tool/tool-schema-descriptions.test.ts:23-26` `[跨区：tool/]` | 置信 confirmed

```ts
/** …防止后续增删内置工具时 catalog 与 registerBuiltinTools 注册表失同步。 */
assert.equal(BUILTIN_TOOL_CATALOG.length, 11);
// 另一文件
it("registers 11 builtin tools without chat_grep", () => {
  assert.equal(registry.list().length, 11);
```

**证明**：两条用例的注释都把「防 catalog 与 registerBuiltinTools 失同步」写成了目的，但实现只是**各数一次长度**。构造反例：加一个内置工具 `web`、同时删掉另一个 `curl`——`BUILTIN_TOOL_CATALOG.length` 仍是 11、`registry.list().length` 仍是 11，两条测试**全绿**，而 catalog 里已经有 `web` 没有 `curl`、registry 恰好相反。**计数锁恰恰放过了它声称要防的那个 bug**，同时在真出问题时给出误导性的红。另外 `11` 这个魔数在两个不同目录的文件里各写了一遍，加一个工具要改两处。

**建议**：换成集合相等断言——`assert.deepEqual(new Set(BUILTIN_TOOL_CATALOG.map(e => e.name)), new Set(registry.list()))`，删掉两条魔数；「不含 chat_grep」单独保留一条即可。

### F-w8-test-core-b-8 | P3 | 无牙断言（恒真 + 注释说谎） | `packages/core/test/package-exports-t0.test.ts:99-110` | 置信 confirmed

```ts
it("从 @novel-master/core/agent 导出 resolveAgentForProject（sessionId 必填签名）", () => {
  assert.equal(typeof resolveAgentForProject, "function");
  assert.equal(resolveAgentForProject.length, 3);
  // 类型仅作 import 契约存在，锁定 ResolvedAgentForProject 两个 source 分支可达。
  const _typeCheck: ResolvedAgentForProject = { source: "session", ... };
  void _typeCheck;
});
```

**证明**：三处问题叠在一块。① `typeof X === "function"` 是接口存在性断言——RULE 牙齿判据①点名的同型（w2-core-agent 已就 `truncateAfterMessage` 抓到过一条同款）。② 注释说「锁定**两个** source 分支可达」，但字面量只写了 `source: "session"`，另一个分支一个字都没碰。③ 整个对象 `void` 掉，运行期不参与任何断言——它是纯类型体操，对**运行期**零贡献，注释的「锁定」只对 tsc 成立，而 tsc 锁的是那个字面量自己。④ `resolveAgentForProject.length === 3` 断言的是 JS 函数元数：加第 4 个必填参数就红（行为无关），把某个参数改成带默认值的写法元数就变（也可能行为无关）——是判据②的脆弱断言。

同文件 :92-96 自认「类型仅作 import 契约存在，**运行期断言仅占位**」，`void _typeCheck; void _cfg;` 两行是明写的死代码。

**建议**：`.length === 3` 换成真调用一次并断言 sessionId 缺失时抛错（用例名说的是"必填签名"，那就验必填）；`ResolvedAgentForProject` 要锁分支就两个 source 各构造一个实例跑一遍解析。

### F-w8-test-core-b-9 | P3 | 无牙断言（编译期类型当运行期断言） | `packages/core/test/config-forms/agent-tool-catalog.test.ts:45,47`、`packages/core/test/tool/tool-schema-descriptions.test.ts:17-19` `[跨区：tool/]`、`packages/core/test/vfs/vfs-zip-io.test.ts:784-785` `[跨区：vfs/]` | 置信 confirmed

```ts
assert.equal(typeof entry.name, "string");          // agent-tool-catalog.test.ts:45
assert.equal(typeof schema.properties?.path?.description, "string");  // tool-schema-descriptions.test.ts:17
```

**证明**：`BUILTIN_TOOL_CATALOG` 是 src 里 `as const` 定型的常量字面量数组，`entry.name` 的类型编译期就是 `string`；这条断言对任何**行为**变化零反应，删掉整条 `registerBuiltinTools` 也不影响它。`tool-schema-descriptions.test.ts:18`（`typeof oldString.description === "string"`）还被同用例 :20 的 `assert.match(schema.properties!.oldString!.description!, /唯一/)` 完全覆盖——有更严的断言在前，这条是纯装饰。`vfs-zip-io.test.ts:784-785`（`typeof zipSvc.import === "function"`）同理，它所在用例名叫「T-IC5：两个工厂单参可构造且 sessionKkv 已内部装配（**对外签名回归钉死**）」，但"钉死签名"实际靠的是 `createVfsZipIoService(ctx.conn)` 单参调用不抛 + 后半段的真实导入行为，那两行 typeof 是配饰。

**建议**：批量清理这一形态——把 `typeof` 断言换成对**值**的断言（`assert.equal(schema.properties!.oldString!.description, "...")` 或至少 `assert.ok(...?.description)`），否则整条删掉。

### F-w8-test-core-b-10 | P3 | fixture 腐烂（断言消息版本号漂移） | `packages/core/test/bootstrap/baseline-check.test.ts:44,58,72,86,100,137` | 置信 confirmed

```ts
assert.rejects(assertMinimumBaseline(conn),
  (err) => err instanceof Error && err.message === BASELINE_TOO_OLD_MESSAGE,
  "legacy 形态 + 缺 baseline 登记，应抛出 v1.4.27 升级提示");
```

**证明**：断言**写法是对的**（引常量不引字面量，符合 RULE「测试断言引用 SCHEMA_BOOT_VERSION 常量而非字面量」的精神）。腐烂在消息文案上：实测 `src/bootstrap/novel-master-bootstrap.ts:187-188` 的 `BASELINE_TOO_OLD_MESSAGE` 已经是 `"…最低支持版本（v1.5.5）…请先升级到 v1.5.5…"`，而 6 条用例的失败消息仍写死 **v1.4.27**。测试一旦真的失败，排查的人会被指向一个早就不存在的版本。同文件 :3 的 `T-BL1 / T-BL2` 用例名也停在旧代号。

**建议**：消息里去掉版本号（或改成从常量派生），6 处一起清。

### F-w8-test-core-b-11 | P3 | 死夹具（恒真的逃生舱） | `packages/core/test/bootstrap/bootstrap-no-migrate.test.ts:33-36` | 置信 confirmed

```ts
const BASELINE_BACKUP_MODULES = new Set<string>([
  // 第二轮退役（最低支持 v1.4.27）后，9 个退役迁移源文件均已物理删除，
  // 目录里只剩已注册模块与基建文件，本清单为空。
]);
```

**证明**：注释自己承认「本清单为空」，所以 :89 的 `!BASELINE_BACKUP_MODULES.has(e.name)` 是恒真项——`Set` 的 `has` 永远返回 false，取反永远为 true。这个夹具的唯一作用是让 :79 那条用例的代码**看起来**有豁免机制，实际上一旦真出现需要豁免的备份模块，作者得先往这个空数组里补一行才知道自己有洞。**更麻烦的是 `docs/apm/RULE.md:77` 仍把这份清单当活的面板写着**「同步改 `bootstrap-no-migrate.test.ts` 硬编码的备份模块名清单」——文档与现实不一致，会让后续 agent 白花时间找一份不存在的清单。

**建议**：连同 `SCHEMA_MIGRATION_INFRA`（:26-30，那份还在用，保留）一起，把空的这个删掉；顺手把 RULE.md:77 那半句改掉。

### F-w8-test-core-b-12 | P3 | 死测试（零断言用例） | `packages/core/test/service/coordinated-write.test.ts:151-153` | 置信 confirmed

```ts
it("空 run 直接成功", async () => {
  await new CoordinatedWrite().run();
});
```

**证明**：全函数体一行调用，**零断言、零 spy、零计数器**。不抛就算过。`run()` 的返回值、是否误进过 execute/rollback 循环、空 registry 时是否吞了错——全部不可观测。把 `CoordinatedWrite.run` 改成 `async run() { throw new Error("x") }` 它会红（这条还凑合），但把它改成永远返回 `undefined` 而不执行任何步骤（把整段 run 体删空）它照样绿。**对照同文件其余 8 条用例**（全部用 `order[]` 轨迹 + `injector.executeCount/rollbackCount` 计数做观测面，:42-44、:78-83、:142-148），这一条是唯一一条脱离了那套观测面的。

**建议**：`assert.equal(await new CoordinatedWrite().run(), undefined)` 之类至少钉一下返回值；更好的是挂个计数器断言「未触发任何 execute/rollback」。

### F-w8-test-core-b-13 | P3 | 死代码 + 夹具未接线 | 9 个文件（见下表） | 置信 confirmed

| 文件:行 | 未使用符号 |
|---|---|
| `bootstrap/seed-builtin-skills.test.ts:13,14` | `readFileSync`, `fileURLToPath` |
| `character-card/validate-md-tree-limits.test.ts` | `CHARACTER_CARD_MAX_TOTAL_CONTENT_BYTES` |
| `kkv/kkv.service.test.ts:5` | `testIsolationSuffix` |
| `persistent/multi-consumer-contract.test.ts:8` | `testIsolationSuffix` |
| `persistent-preferences/persistent-preferences.test.ts` | `testIsolationSuffix` |
| `sksp/schema.test.ts:3` | `testIsolationSuffix` |
| `workplace/workplace-get-dir-rule.test.ts` | `testIsolationSuffix` |
| `workplace/workplace-list-order.test.ts` | `testIsolationSuffix` |
| `service/prompt/build-prompt-llm-input-tool-pairing.test.ts` | `textBlocks` |

**证明**：`testIsolationSuffix` 这一组不是普通的未用 import。`test/helpers/novel-master-fixture.ts:40` 提供它正是为了在**一个文件共享一个内存库**（`:14` 模块级 `sharedCtx`、`:18` before 开库）的前提下隔开用例；这 5 个文件都用了 `novelMasterTestFixture()`，却一个都没调用它——等于默认接受「同文件内用例顺序耦合」，而且这 5 处残留还带着 import 后面连续两三个空行（`kkv.service.test.ts:6-8`、`persistent/multi-consumer-contract.test.ts:9-11`、`sksp/schema.test.ts:4-5`），是机械改动的痕迹。`kkv.service.test.ts:37-38` 用 `kkv.set("M","a")` 这种无隔离的裸模块名 + `:40 assert.deepEqual(keys, ["a","b"])` 就是这个后果的具体形态。

**建议**：5 个文件要么真的用上 suffix，要么把 import 删掉并在文件头注明「本文件用例互不写同一 module，无需隔离」。

### F-w8-test-core-b-14 | P3 | 续命测试（冗余魔数锁） | `packages/core/test/bootstrap/smart-sort-rule-seed.test.ts:58` | 置信 confirmed

```ts
assert.equal(rows.length, 7);
assert.deepEqual(rows.map((r) => r.rule_id), ["builtin-zh-prologue", ..., "builtin-numeric"]);
```

**证明**：`:59-70` 的 `deepEqual` 已经把长度钉死为 7（字面量数组长度就是 7），`:58` 是纯冗余，删掉不损失任何信号。而它和用例名「bootstrap 后**七条**内置规则」一起，构成"加一条内置规则就得改测试"的维护面——但真正需要改的是 :59-70 那个列表（那是真·回归锁），:58 只是让改动点从 1 处变成 2 处。

**建议**：删 :58。

### F-w8-test-core-b-15 | P3 | 断言脆弱（精确调用计数） | `packages/core/test/workplace/workplace-materialize-engine.test.ts:129` | 置信 suspected

```ts
assert.equal(vfs.findByPathCalls.length, 2);
assert.ok(vfs.findByPathCalls.includes("/show/a.md"));
```

**证明**：意图是 N+1 守卫（同 zone 还有 `vfs/vfs-n-plus-1-fixes.test.ts` 同族），**有牙**——多查一次就红。但它同时是判据②的脆弱面：任何一次合法的额外 `findByPath`（比如加一层缓存探测、加一个 null 检查）都会误红。而 :135 的 `assert.doesNotMatch(block, /c\.md/)` 已经覆盖了"隐藏路径不被读"这个真正的意图。

**建议**：`assert.ok(vfs.findByPathCalls.length <= 2)`，或直接删 :129 保留 :130-131。

### F-w8-test-core-b-16 | P3 | 注释与现实相反 | `packages/core/test/dist-artifacts.test.ts:9-13` | 置信 confirmed

```ts
/** Paths re-exported from dist/index.js for event-bus iteration (Metro / CLI). */
const REQUIRED_DIST_FILES = [
  "domain/compaction-conditions/model/compaction-conditions.schema.js",
  "infra/events/simple-event-bus.js",
] as const;
```

**证明**：注释说这两个文件是"从 `dist/index.js` re-export 的"。实测 `src/index.ts`（270 行）全文 **0 次**出现 `event`/`Event`；`SimpleEventBus` 只由 `src/public/events.ts:1` 导出。而**同 zone 的另一条测试 `package-exports-t0.test.ts:41-46` 恰恰断言主入口 `SimpleEventBus === undefined`**——同一件事，两条测试给出相反口径。测试本身仍绿（tsc 会把整棵树 emit 到 dist），但注释会把后来人引向"事件总线走主入口"的错误结论。

**建议**：注释改成「这两条路径是 `@novel-master/core/events` 子入口的依赖，build 必须产出」，并把 `REQUIRED_DIST_FILES` 扩到当前 `exports` 里真正需要产物的路径。

### F-w8-test-core-b-17 | P3 | 夹具与生产同源（弱断言） | `packages/core/test/bootstrap/seed-builtin-skills.test.ts:50,103` | 置信 suspected

```ts
assert.equal(read.content, AGENT_CONFIG_SKILL_MD);
```

**证明**：期望值直接取自被测的生产常量，改常量时测试跟着改，形不成回归锁。它真正测到的是"seed 路径确实把这份常量写进了库"，而这一点 :46-47（`list.find(name==="agent-config")` 非空 + `valid === true`）已经覆盖了一部分。降为 suspected 的理由：RULE 明确认可"观测面选与实现同源"的缝（这是它给的修法之一），所以同源未必是错的——但这里同源之后**什么都不剩**了。

**建议**：换成对文案关键片段的 `assert.match`（例如 `/name:\s*agent-config/`）+ 对 revision/entry 行的结构断言，让常量改动能真的红一次。

### F-w8-test-core-b-18 | P3 | 死夹具（恒真的白名单） | `packages/core/test/package-exports/public-no-config-forms.test.ts:6-7` | 置信 confirmed

```ts
/** 已知 config-forms 泄漏；收敛后从此清单移除。 */
const KNOWN_LEAKS = new Set<string>();
```

**证明**：`:18` 的 `importsConfigForms && !KNOWN_LEAKS.has(file)` 里，后半项恒真（空 Set 的 `has` 永远 false）。测试当前**有牙**（任何 public/* 引 config-forms 都会红），但逃生舱是死的——真出现泄漏时，作者得先改代码才知道自己需要一条豁免。这跟 F-11 是同一个形态：用一个空的豁免清单假装有治理机制。

**建议**：空清单要么删掉（改用 `.filter()` 一次性报错），要么在注释里写明「当前为空，出现泄漏请直接修而不是加豁免」。

## 争议与存疑

1. **zone 分界未落纸**。`PLAN.md` 没有 test-core-a/b 的划分规则，我按派单文字取后半目录并全做完。启发式扫描跑了全 429 文件，所以有 4 条发现落在 a 区文件上（`tool/tool-schema-descriptions.test.ts`、`vfs/vfs-zip-io.test.ts`、`agent/agent-runner-abort-rollback.test.ts:599` 的 `typeof` 同型），已在条目上标 `[跨区]`。**reduce 阶段请以本报告的 a 区条目为对照，避免与 w8-test-core-a 双记**。

2. **F-3（`migrate-` 守卫）到底是"死守卫"还是"约定守卫"？** 我判它是死守卫，理由是当前 6 条迁移全部不带该前缀、真缺陷形态（写了迁移忘登记）用的是无前缀命名，守卫抓不到。但反方观点成立：它守的是"不要把仓库改回 `migrate-*.ts` 旧命名"，重命名成本高、确实能拦。**我保留 confirmed 但把建议写成"删除或改检测对象"而不是"必须删"**——若主代理认为约定守卫有价值，标 `intentional` 亦可，只是不该让它冒充 T-B2/T-SM10 的验收口径。

3. **F-15（精确调用计数）我标 suspected 而非 intentional**。`workplace-materialize-engine.test.ts:129` 明显是 N+1 守卫（同仓有 `vfs-n-plus-1-fixes.test.ts` 同族先例），是有意为之；我仍列为发现是因为它落在判据②的脆弱面上。**若主代理认为 N+1 精确计数是本仓既定风格，可整条标 intentional 关闭**。

4. **共享内存库一文件一连接的顺序耦合，我只报了 F-13 那 5 个文件**。`test/helpers/novel-master-fixture.ts:14-25` 的「一个文件所有 `it` 共用一个库」是全仓 127 个集成文件的共同底座，理论上每条写库用例都有顺序耦合风险。我没有逐条证明哪条**当前**已经耦合（127 文件逐条验证超出本机位预算），所以**没有把它当发现报**——只作为「数据访问」节的背景事实列出。**建议 W9 派一个专门机位做「共享库顺序耦合」的实证扫描**，用 `--test-name-pattern` 乱序跑法（node:test 支持）来反证。

5. **`.skip`/`.todo`/`.only` 全仓为 0 是本次最值得报告的正向结论**，但它依赖我的扫描口径（对 429 个 `.test.ts` 正则 `.\s*(skip|todo|only)\s*\(`）。如果有用例通过 `it(name, { skip: cond })` 的 options 形式跳过，我这条正则抓不到；我没做二次确认。

6. **用例总数口径**：我数到 3031 条 `it(`/`test(` 出现处，RULE.md:104 记载的 core 全量是 2748 条。差异来源是循环生成的用例（如 `package-exports/public-subpath-allowlist.test.ts:21` 一次生成 12 条、`dist-artifacts.test.ts:16` 生成 2 条）我按**生成点**计 1、实际运行按**展开后**计 N。**2748 是运行口径，3031 是源码出现口径，两者不矛盾，不要在台账里当冲突处理。**
