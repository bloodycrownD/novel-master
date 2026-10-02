---
zone: core-workplace
agent: domain-survey
files_scanned: 19
---

## 摘要

工作区（workplace）域的**纯逻辑层**：把「VFS 文件树 + 目录规则行 + 文件纳入规则」求值成一棵有序的规则视图
（`evaluateWorkplaceRuleView`），并负责目录规则的默认值、目录/文件排序（含中文数字智能排序）、
ASCII 文件树渲染、`<file>` 块渲染、Markdown front matter 抽取，以及 session KKV
`rule_snapshot` / `file_cache` 两个域的编解码与「读缓存→回填」链路。本域不含 IO 编排
（除 `sqlite-workplace.repository.ts` 与 KKV 回填），不含 agent run 集成。

## 职责与边界

**在边界内（本域自有决策）**
- 规则求值：`resolveRuleState`（无规则行 / `ruleEnabled=false` → `rule_off`；根目录恒 `rule_on`）、
  `evaluateFileDisplay`（hide/show 短路 → 父目录 rule_on 门 → head/tail 优先集 → fillPolicy 兜底）。
- 排序：`sortFilesForDir` / `sortDirPaths` / `compareSmartBasenames`（中文数字 + 自然序全序）。
- 展示装配：`renderFileBlock` / `renderWorkplaceFileTreeForMacro` / `parseMarkdownFrontMatter`。
- KKV 编解码与回填策略：`rule-snapshot-codec.ts` / `load-or-fill-file-cache.ts`。
- 规则表持久化：`SqliteWorkplaceRepository`（`workplace_dir_rule` / `workplace_file_rule`）。

**在边界外（消费方决策，本域只被喂数据）**
- 「新建目录要显式插行」的补行链路在 `domain/tool/builtin/vfs-tools.ts::ensureDirRulesForNewPath`
  与 `service/vfs/logic/ensure-import-dir-rules.ts`，本域只提供 `DEFAULT_WORKPLACE_DIR_RULE`。
- 「置位/压缩/导入清 `rule_snapshot` + `file_cache`」在 `service/chat/impl/message-transcript-effects.service.ts`、
  `service/vfs/logic/clear-session-prompt-caches.ts`、`service/workplace/refresh-rule-snapshot.ts`。
- 「前缀回合内冻结」（`loadOrFillFileCache` 命中无条件返回、无 mtime 校验）是 RULE 明写口径，非缺陷。
- 「`workplace` 工厂每次 new 新实例、循环内反复获取会让 `liveViewInFlight` 并发去重跨 step 失效」
  是 RULE 明写已知坑，agent-runner 已提升到循环外。

## 对外接口

经 `packages/core/src/public/workplace.ts` 导出（`public/*` 是双端唯一合法入口）：

| 符号 | 出处 | 说明 |
|---|---|---|
| `evaluateWorkplaceRuleView` | `logic/workplace-rule-engine.ts:51` | 规则视图唯一入口 |
| `evaluateFileDisplay` / `computeHeadTailIndices` / `sortDirPaths` / `sortFilesForDir` | `logic/workplace-eval.ts:46,99,142,194` | 纯函数 |
| `DEFAULT_WORKPLACE_DIR_RULE` | `logic/default-dir-rule.ts:16` | 无行时的字段默认 |
| `renderFileBlock` / `renderFileBlockBody` / `joinFileBlocks` / `formatLocalMtime` | `logic/workplace-display.ts:56,67,89,21` | `<file>` 块 |
| `renderWorkplaceFileTree` / `workplaceFileTreeRootLabel` | `logic/workplace-file-tree.ts:126,58` | 树渲染 |
| `parseMarkdownFrontMatter` / `splitMarkdownFrontMatter` | `logic/front-matter.ts:59,25` | front matter |
| `ruleStateLabel` / `inclusionModeLabel` / `displayStateLabel` / `filetreeMacroLoadStateLabel` | `logic/workplace-labels.ts:13,17,28,42` | 双端共用中文标签 |
| `ruleViewToSnapshotEntries` / `parseRuleSnapshotJson` / `serializeRuleSnapshot` | `logic/rule-snapshot-codec.ts:21,50,41` | `rule_snapshot` 编解码 |
| `diffWorkplacePaths` / `isWorkplacePathLoadedInCache` | `logic/diff-workplace-paths.ts:45,30` | chip 差集 |
| `mapProjectWorkplacePathToSession` / `mapSessionWorkplacePathToProject` | `logic/workplace-path-map.ts:12,19` | 恒等映射 |
| 类型：`WorkplaceScope` / `RuleState` / `InclusionMode` / `DisplayState` / `SortField` / `SortOrder` / `FillPolicy` / `WorkplaceRuleRow` / `WorkplaceDirRule` / `WorkplaceRuleContext` / `WorkplaceRuleView` / `SetDirRuleInput` / `SetFileRuleInput` | `model/*.ts` | |

**内部但跨域引用的关键符号**（不在 public 面，走 `@/` 深路径 import）：
- `extractSortKey` / `compareSmartBasenames` / `parseChineseNum` / `CompiledSmartSortRule` /
  `FIXED_MIN_SORT_TUPLE` / `formatSortTupleForDisplay`（`logic/smart-sort.ts`）——被
  `domain/smart-sort-rule/`、`service/smart-sort-rule/`、`public/smart-sort-rule.ts` 消费。
- `workplaceScopeKey` / `isWorkplaceRootPath`（`logic/workplace-scope.ts`）——被
  `service/vfs/logic/ensure-import-dir-rules.ts`、`service/template/logic/*` 消费。
- `loadOrFillFileCache` / `settlePendingFileCacheBackfills`（`logic/load-or-fill-file-cache.ts`）——
  被 `service/workplace/assemble-workplace-display.ts:17` 与
  `domain/chat/logic/prepare-user-messages-for-prompt.ts:22` 消费。
- `buildWorkplaceDirSet`（`logic/workplace-tree.ts:40`）——被 `service/workplace/impl/workplace.service.ts:16` 消费。

## 数据访问

本域**不建表、不改 schema**，但读写以下存储（file:line 证据）：

| 存储 | 触点 | 读/写 |
|---|---|---|
| `workplace_dir_rule` | `repositories/impl/sqlite-workplace.repository.ts:67,120,167,182,208,272,300` | INSERT…ON CONFLICT DO UPDATE / DELETE / SELECT |
| `workplace_file_rule` | `sqlite-workplace.repository.ts:99,151,173,194,227,280,308` | 同上 |
| 表名常量来源 | `sqlite-workplace.repository.ts:15-18` → `bootstrap/workplace/workplace-schema.ts:11,13` | import（非本域定义） |
| session KKV `file_cache` | `logic/load-or-fill-file-cache.ts:46,154` | `sessionKkv.get` / `set`，键 `{status}:{path}` |
| session KKV `rule_snapshot` | 经 `rule-snapshot-codec.ts` 编解码；写点在 `service/workplace/refresh-rule-snapshot.ts:36`、`service/workplace/assemble-workplace-display.ts:232` | 本域只提供编解码 |
| `vfs_entry`（`content` / `content_hash` / `mtime_ms` / `entry_kind`） | `load-or-fill-file-cache.ts:182`（`vfs.findContentSize`，间接打 `vfs_entry` + `vfs_content_blob.byte_len`）、`workplace-materialize-engine.ts:36`（`vfs.findByPath`） | 只读 |
| `vfs_content_blob.byte_len` | 经 `findContentSizeByPath` 间接读（`domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:243`） | 只读，用于超限探测 |
| 文件路径 | 全部逻辑路径，无物理前缀（`workplace-materialize-engine.ts:35` 注释：entry_id 化后 path 列直接存纯逻辑路径） | — |

无 KTV 无 IPC。**不写 `docs/apm/`、不做 git 写。**

## 依赖关系

**import 了谁**
- `@/domain/vfs/repositories/impl/normalize-path.js`（`workplace-tree.ts:7`、`sqlite-workplace.repository.ts:14`、`workplace-path-map.ts:7`）
- `@/domain/vfs/logic/vfs-path-mapper.js`（`model/workplace-types.ts:7` 取 `VfsScope`；`workplace-materialize-engine.ts:7` 取 `scopeKey`）
- `@/domain/session-kkv/model/session-kkv-domains.js`（`load-or-fill-file-cache.ts:16`、`rule-snapshot-codec.ts:8`、`diff-workplace-paths.ts:10`）
- `@/domain/character-card/logic/character-card-limits.js`（`load-or-fill-file-cache.ts:23`）← **跨域，见 F-6**
- `@/domain/smart-sort-rule/model/smart-sort-rule.js`（`smart-sort.ts:22` 取 `SmartSortCaptureKind`）
- `@/bootstrap/workplace/workplace-schema.js`（`sqlite-workplace.repository.ts:15`）
- `@/infra/tdbc/ports/connection.port.js`、`@/infra/tdbc/logic/template-helper.js`、`@/infra/sql-template/index.js`（repo）
- `@/infra/date-format.js`（`workplace-display.ts:7`）
- `@/service/session-kkv/session-kkv.port.js`（`load-or-fill-file-cache.ts:22`，类型 import）

**被谁消费**（`git grep -l 'domain/workplace'` 的生产侧）
- `public/workplace.ts`（双端唯一入口）
- `service/workplace/`：`impl/workplace.service.ts`、`impl/workplace-view-cache.ts`、
  `assemble-workplace-display.ts`、`refresh-rule-snapshot.ts`、`create-workplace-service.ts`
- `service/template/logic/initialize-session-workspace.ts:12`、`push-session-workspace.ts`（`mapProjectWorkplacePathToSession` + `copyScope`）
- `service/vfs/logic/ensure-import-dir-rules.ts:10`、`service/vfs/impl/character-card-import.service.ts`、`vfs-zip-io.service.ts`
- `domain/chat/logic/prepare-user-messages-for-prompt.ts:22`（`loadOrFillFileCache`）
- `domain/tool/builtin/vfs-tools.ts:32`（`DEFAULT_WORKPLACE_DIR_RULE` 经 `ensureDirRulesForNewPath`）
- `domain/skills/logic/parse-skill-front-matter.ts:10`（`splitMarkdownFrontMatter`）
- `domain/smart-sort-rule/logic/compile-smart-sort-rule.ts`、`match-smart-sort-pattern.ts`
- `domain/chat/logic/seed-fork-copy-parity.ts:109`（`workplace.copyScope`）
- 双端 UI：`apps/mobile/src/components/sheet/DirectoryRuleSheet.tsx`、`apps/desktop/renderer/features/workspace/DirectoryRuleModal.tsx`、`workspace-actions.ts`、
  `apps/mobile/src/services/workplace-operations.service.ts`、`apps/mobile/src/components/vfs/VfsFileManager.tsx`

**依赖方向异常**（值得 reduce 阶段裁决）
`domain/smart-sort-rule/` → `domain/workplace/logic/smart-sort.ts` → `domain/smart-sort-rule/model/`。
smart-sort 的**模型**定义在 smart-sort-rule 域、**算法**在 workplace 域，形成双向依赖。
`domain/workplace` → `domain/character-card` 也是反向（通用装配层依赖业务域）。

---

## 发现清单

### F-core-workplace-1 | P1 | `packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts:214`

```ts
async function readWorkplaceFileBody(path, status, vfs): Promise<FileCachePayload> {
  if (status === "filename") {
    return { body: "", mtimeMs: 0 };
  }
```

**描述**：`filename` 档位直接返回 `mtimeMs: 0`，该载荷被写入 `file_cache`
（`load-or-fill-file-cache.ts:152-164`），并由 `service/workplace/assemble-workplace-display.ts:188-195`
原样喂给 `renderFileBlock` → `formatLocalMtime(0)`（`workplace-display.ts:21`）→ `createdAt="1970-01-01 08:00:00"`。
即**每一个 `filename` 档位的文件，在常驻 `<workplace>` 前缀里都带 1970 假时间戳送给模型**。
`fillPolicy: "filename"` 是双端 UI 的正式选项（`DirectoryRuleSheet.tsx:54`、`DirectoryRuleModal.tsx:32`），
不是边缘路径。

**关键点**：同文件 `:8-9` 与 `:145-148` 的注释明确把「占位块渲染出 1970 假时间戳随提示词送给模型」
列为要防的问题，超限占位符因此专门带回了探测到的真实 `mtimeMs`；`filename` 档位这条同款路径漏掉了同款处理。
`test/workplace/assemble-workplace-display.test.ts:459-466` 也只断言了超限占位符不出现 1970，
`filename` 档位无覆盖（`workplace-display.test.ts` 的 filename 用例传 `mtimeMs: 0` 但只断言块数）。

**建议**：`filename` 档位在回填前做一次轻量 `vfs.findContentSize`（拿 `mtimeMs`，不读正文，成本同超限探测），
或在 assemble 侧用 `ctx.mtimeByPath` 覆盖 `renderFileBlock` 的 `mtimeMs`。
同时补一条「filename 档位 `createdAt` 不得以 `1970` 开头」的断言。

**置信**：confirmed

---

### F-core-workplace-2 | P1 | `packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts:220`

```ts
  } catch {
    return { body: "(missing)", mtimeMs: 0 };
  }
```

**描述**：读失败（**任何**异常，不只 `NOT_FOUND`）一律降级为 `{ body: "(missing)", mtimeMs: 0 }`，
且该载荷在 `:152-164` 被**写入 `file_cache`**。两个后果：
1. **1970 假时间戳**——与 F-1 同款，`<file createdAt="1970-01-01 …">` 进提示词。
2. **瞬时失败被永久固化**——`file_cache` 按 RULE 是「前缀回合内冻结、命中无条件返回（无 mtime 校验）」，
   改写它的只有改规则 / 压缩 / 置位 / 会话删除。一次偶发 SQL 失败就会让该 path 在本会话余下所有轮次
   都渲染成 `(missing)`。

与超限占位符的处理**自相矛盾**：`:145-148` 的注释写「不写 file_cache（避免把占位符粘进缓存）」，
超限路径确实不写；`(missing)` 路径没套用同一决策。

**建议**：把 `(missing)` 降级也归入「不落 cache」分支（每次重新探测，成本只是一次 `vfs.read` 失败），
或在 catch 内区分 `NOT_FOUND`（可落库）与其它异常（不落库）。补真实 `mtimeMs` 同 F-1。

**置信**：confirmed

---

### F-core-workplace-3 | P2 | `packages/core/src/domain/workplace/logic/workplace-eval.ts:165`

```ts
  const priority = computeHeadTailIndices(params.autoFileCount, head, tail);
```

**描述**：`computeHeadTailIndices` 每次调用都新建一个 `Set` 并插入 `min(head,total) + min(tail,total)` 个元素。
它被 `evaluateFileDisplay` 在**每个文件**上调用一次（`workplace-rule-engine.ts:176`，由 `buildDisplayByPath:135` 遍历），
即单次评估的实际复杂度是 `O(N × (head + tail))`，默认 `tailCount = 1000`
（`default-dir-rule.ts:20`）→ 556 文件的工作区一次评估光这一项就 ~55 万次 Set 插入。

这与 `workplace-rule-engine.ts:4-7` 的模块头契约直接冲突：

> 「单次评估 O(N·logN)，行为与旧实现完全一致」

排序确实被优化到 O(N·logN)（`buildDirSortPlans` 缓存了名次与计数），但 head/tail 优先集没有跟着缓存，
把 O(N·(head+tail)) 又请了回来。旧实现是 O(N²·logN)，所以这不是「回到旧坑」，但契约声明与实际不符。

**建议**：把优先集并入已有的 `DirSortPlan`（`workplace-rule-engine.ts:39-46`）按目录缓存一次，
`computeDisplay` 从 plan 取；或给 `evaluateFileDisplay` 加一个可选的预传入 `priority: ReadonlySet<number>`。
补一条计数式断言（`computeHeadTailIndices` 每目录调用次数 = 目录数，不是文件数）。

**置信**：confirmed

---

### F-core-workplace-4 | P2 | `packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts:191`

```ts
  if (size.kind === "inlineChars") {
    if (size.size > CHARACTER_CARD_MAX_SINGLE_FILE_BYTES) {
```

**描述**：`size.size` 是 SQLite `length(content)`，对 TEXT 返回**字符数**；而
`CHARACTER_CARD_MAX_SINGLE_FILE_BYTES` 是**字节**常量（`character-card-limits.ts:22` = 8 MiB）。
两者直接比较，注释 `:171` 声称「字符数 ≥ 字节数场景已足够」——**这个论断对中文是反的**：
CJK 一字 3 字节 UTF-8，字符数 < 字节数。所以 8M 字符的中文文件 = 24 MB 实际字节，
能通过这道「8 MB」闸门并被整读进提示词。

本项目是中文小说写作工具，CJK 是主要正文语言，这不是理论边界而是常态路径。
对照 blob 分支（`:199`）走的是压缩侧 `byte_len` 对 `CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES`，
那条是真字节口径，本分支是唯一口径不一致的。

**建议**：内联分支改用 `utf8ByteLength`（`character-card-limits.ts:50` 已导出，惰性 TextEncoder +
Hermes 兜底），或把内联闸门下调一个已知的 CJK 折算系数并在注释里写明依据。

**置信**：confirmed

---

### F-core-workplace-5 | P2 | `packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts:114`

```ts
function scheduleBackfill(write: () => Promise<void>): void {
  const settled = new Promise<void>((resolve) => {
    setTimeout(() => { void write().then(...) }, 0);
  });
```

**描述**：`deferBackfillWrite: true` 时（`assemble-workplace-display.ts:186` 走这条）回填被推到
下一个宏任务。窗口内若 `refreshRuleSnapshot`（`service/workplace/refresh-rule-snapshot.ts:41`）
或压缩/置位执行了 `clearDomain(file_cache)`，回填的 `set` 会在**清空之后成功落地**，
把一份按旧规则快照读到的 body 写回 freshly-cleared 的域。

这不是 `:112-113` 注释里已经接受的「写失败」（写失败是正确降级），而是**写成功但写的是过期内容**——
`clearDomain` 的失效语义（让下次组装按新规则重评估）被这次晚到的写破坏。
同 key 场景下（status 未变、文件未改）内容恰好相同，但 status 变了的场景会留下孤儿 key
（`diffWorkplacePaths` 的「任一 status 命中即已加载」口径会把它算成已加载，见 `diff-workplace-paths.ts:21-25`）。

模块注释里已有很好的可观测把手（`pendingBackfills` / `settlePendingFileCacheBackfills`），
可以在 `scheduleBackfill` 里登记一个「本域已被清空」的 epoch，回填前比对。

**置信**：suspected（时序竞态，未实测复现；生产路径是用户改规则，落在同一个宏任务窗口内的概率低）

---

### F-core-workplace-6 | P2 | `packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts:23`

```ts
import {
  CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES,
  CHARACTER_CARD_MAX_SINGLE_FILE_BYTES,
} from "@/domain/character-card/logic/character-card-limits.js";
```

**描述**：workplace 域的**通用**读取路径直接复用角色卡导入域的体积闸门，且对**所有** workplace 文件
无差别生效（`:142` 只按 `status !== "filename"` 过滤，不看文件来源）。后果：一个 3 MB 压缩比高的
项目参考文档（正文 12 MB）会被静默替换成 `（文件过大，已跳过，约 12288000 字符）` 送进提示词，
用户与模型都看不出这是被裁掉的，只看到一句占位文案。

RULE 与迭代文档只把这两道闸门定位在「巨大角色卡」场景（`character-card-limits.ts:4-12` 的模块头
逐条绑定角色卡），没有记录「对普通项目文件也生效」是拍板结果。至少应在 workplace 侧补一条注释
说明这是有意的全域口径，或把闸门改成「仅对疑似角色卡导入路径生效」。

同时这是**依赖方向倒置**：通用装配层（`domain/workplace`）依赖业务域（`domain/character-card`）。

**建议**：确认口径。若是有意的，在 `load-or-fill-file-cache.ts` 头部写明并引用拍板出处；
若不是，把闸门下沉到 `service/vfs/` 的角色卡导入链，workplace 侧只对「已知毒数据路径」启用。

**置信**：suspected（口径未在任何 RULE / 迭代文档中查到「对全部 workplace 文件生效」的拍板记录）

---

### F-core-workplace-7 | P2 | `packages/core/src/domain/workplace/repositories/impl/sqlite-workplace.repository.ts:244`

```ts
  async copyScope(fromScopeKey, toScopeKey, mapLogicalPath): Promise<void> {
    await this.deleteScope(toScopeKey);
    const dirs = await this.listDirRules(fromScopeKey);
    ...
    await this.batchUpsertDirRules(mappedDirs);
    await this.batchUpsertFileRules(mappedFiles);
  }
```

**描述**：`copyScope` 是 4 步非原子操作（清空目标 → 读源 ×2 → 写目标 ×2），`deleteScope`（`:163-176`）
自身也是两条独立 `executeTemplate`（dir 表、file 表）之间无事务。任一步失败，目标 scope 会停在
「空」或「只有 dir 规则」的半拷贝状态，而 `copyScope` 的 port 契约（`workplace.port.ts:54-58`）
只说「Replaces all rules」，**没有声明必须在事务内调用**。

现状是安全的——三个生产调用方（`initialize-session-workspace.ts:36`、`push-session-workspace.ts:31`、
`seed-fork-copy-parity.ts:46`）都用 `new SqliteWorkplaceRepository(tx)` 构造，落在外层事务里。
但 `createWorkplace-service.ts:33` 构造的是**非事务** `conn`，任何未来新增的非事务调用方都会静默失去原子性。

**建议**：要么在 `workplace.port.ts:54-58` 的 JSDoc 上写死「必须在事务连接内调用」，
要么让 `copyScope` / `deleteScope` 自行开事务并在检测到已是事务连接时复用（`renameRulesUnderLogicalPrefix:318`
已经示范了「复用外层 tx」的注释写法，但那里同样只是注释约束）。

**置信**：confirmed（缺陷是契约缺失；当前生产调用方恰好安全）

---

### F-core-workplace-8 | P3 | `packages/core/src/domain/workplace/logic/workplace-file-tree.ts:126`

```ts
export function renderWorkplaceFileTree(params: RenderWorkplaceFileTreeParams): string {
  ...
  const lines: string[] = [headerLine];
  appendDirLines(lines, rootPath, "", params);
```

**描述**：`renderWorkplaceFileTree`（`:126-135`）与 `renderWorkplaceFileTreeForMacro`（`:140-149`）
除 `appendDirLines` 最后一位参数（`displayByPath` vs 不传）外**逐字重复**，
连 `headerLine` 的三行计算都相同。而 `renderWorkplaceFileTree` 在生产侧**没有任何调用方**
（`git grep` 只命中自身定义、`public/workplace.ts:46` 的 re-export、
`public-workplace-allowlist.json:25` 的导出面快照，以及 `test/workplace/workplace-file-tree.test.ts`），
`workplace.service.ts:294` 用的是 `...ForMacro` 版。

**建议**：删掉 `renderWorkplaceFileTree` 与 `workplaceFileTreeRootLabel` 的 public 导出
（`renderWorkplaceFileTreeForMacro` 也需要一并进 public 面，或让 `renderFileTree()` 走 service），
同步更新 `public-workplace-allowlist.json`。若因导出面快照暂不能删，至少让前者转调后者。

**置信**：confirmed

---

### F-core-workplace-9 | P3 | `packages/core/src/domain/workplace/logic/workplace-tree.ts:92`

```ts
    if (!f.startsWith(prefix) && !(normalized === "/" && f.startsWith("/"))) {
      continue;
    }
```

**描述**：第二个条件是恒等的冗余——`normalized === "/"` 时 `prefix` 已被赋值为 `"/"`（`:89`），
所以 `f.startsWith(prefix)` 与 `f.startsWith("/")` 是同一个判断，整项退化为 `!f.startsWith(prefix)`。
无害但会误导后续维护者以为这里有两种路径。另注：本函数假定 `filePaths` 的元素已归一化且以 `/` 开头
（未对 `f` 调 `normalizePath`），依赖调用方（`workplace.service.ts:354` 的 `fileSet` 构造）保证——
`directChildDirs`（`:70`）反而对 `dir` 做了 normalize，两边不对称。

**建议**：删掉冗余条件；给 `f` 也加 normalize 或在 JSDoc 写明「元素须已归一化」。

**置信**：confirmed

---

### F-core-workplace-10 | P3 | `packages/core/src/domain/workplace/logic/workplace-eval.ts:116`

```ts
  const sorted = [...files];
  sorted.sort((a, b) => {
    switch (sortField) {
      case "name": ...
      case "created":
      case "updated": ...
      case "smart": ...
    }
  });
```

**描述**：switch 穷尽了 `SortField` 联合的 4 个成员但**没有 `default`**，TS 因此把回调返回类型收窄为
`number`；运行时若 `sortField` 落在联合外（DB 里 `CHECK (sort_field IN (...))` 约束是唯一防线，
`workplace-schema.ts:26`），回调返回 `undefined`，`Array.prototype.sort` 视作 0 → 排序静默失效、
不报错。对照 `sortDirPaths:228` 同一文件里是有 `default:` 的——两个姊妹函数对同一风险的处理不一致。

**建议**：加 `default: return compareStrings(basename(a.logicalPath), basename(b.logicalPath), sortOrder);`
与 `sortDirPaths` 对齐。

**置信**：confirmed

---

### F-core-workplace-11 | P3 | `packages/core/src/domain/workplace/logic/workplace-scope.ts:30`

```ts
export function workplaceRootLogicalPath(_scope: WorkplaceScope): string {
  return "/";
}
```

**描述**：根路径对所有 scope 恒为 `"/"`（函数签名里 `_scope` 明确未用）。这让下游一整片分支成为死代码：
- `workplace-file-tree.ts:62-65` 的 `base.length > 0 ? base : "/"`；
- `workplace-file-tree.ts:131` 与 `:145` 的 `rootLabel === "/" ? "/" : \`${rootLabel}/\``；
- `workplace-file-tree.ts:130-131` / `:144-145` 的 `rootPath` 与 `rootLabel` 双轨计算。

同时 `domain/chat/logic/render-dir-attach-tree.ts:31-38` 的注释写「根标签走 `workplaceFileTreeRootLabel`
口径一致」，但它**另起了一份实现** `attachDirTreeRootLabel`，没 import 共享函数——注释承诺的「一致」
靠人工维护。

**建议**：既然是恒等，把 `workplaceFileTreeRootLabel` 简化为返回 `"/"` 并删掉调用点的死分支；
`render-dir-attach-tree` 改为 import 共享实现（该文件的 root 是用户传入的 `rootDir` 而非 scope 根，
需先确认两者是否真该共用——见「争议与存疑」）。

**置信**：intentional（统一根是拍板设计，`:28` 注释「unified `/` for all domains」明写）——
但**死分支未随之清理**是 confirmed

---

### F-core-workplace-12 | P3 | `packages/core/src/domain/workplace/logic/workplace-rule-engine.ts:4`

```ts
 * 性能约定（huge-card-import-crash 修复）：每个目录的文件只排序**一次**，
```

**描述**：模块头声明「每个目录只排序一次」，但 `buildDirSortPlans` 对每个目录实际调用
`sortFilesForDir` **两次**（`:105` auto 名单、`:113` 全量名单），且智能排序下
`decorateSmartCache` 也重建两遍（`workplace-eval.ts:110`）。函数级注释（`:70-71`）写的是准确的
「每个目录只排序两次」，两处口径打架。

**建议**：把模块头改成「每个目录排序两次（auto 名单 / 全量名单），而非每文件一次」。

**置信**：confirmed

---

### F-core-workplace-13 | P3 | `packages/core/src/domain/workplace/logic/workplace-rule-engine.ts:97`

```ts
    let autoCount = 0;
    // auto 名单单独排序：...
    autoCount = sortedAuto.length;
```

**描述**：`autoCount` 先初始化为 0，两行后被无条件覆盖，初始值是死代码。同理
`const autoMetas: WorkplaceFileSortMeta[]` 与循环体可以合并为一次 `filter`。
纯可读性，无行为影响。

**建议**：`const autoCount = sortedAuto.length;`。

**置信**：confirmed

---

### F-core-workplace-14 | P3 | `packages/core/src/domain/workplace/logic/workplace-display.ts:83`

```ts
    `updatedBy="user"`,
```

**描述**：`renderFileBlock` 无条件写死 `updatedBy="user"`，但同一段里
`createdAt` 与 `updatedAt` 都取同一个 `mtimeMs`（`:78-82`，`mtimeMs` 只有一个来源），
文件也确实可能是 agent 自己写的（`vfs-tools.ts:263` 的 `upsertFileCacheAfterWrite` 会在 write 后
把该文件写进同一个 `file_cache`）。即常驻前缀里 agent 写过的文件也被标成 `updatedBy="user"`。
`git grep updatedBy` 全仓只有本行与一个 legacy 测试，说明这条属性**没有消费方**——
它对模型是无依据的事实声明。

**建议**：若模型侧不读这个属性，直接删掉（`<file>` 只保留 `path` + 时间）；
若要保留，需在 `FileCachePayload` 里带上写入来源（`user` / `agent` / `import`），
`upsertFileCacheAfterWrite` 处一并标记。

**置信**：confirmed

---

### F-core-workplace-15 | P3 | `packages/core/src/domain/workplace/repositories/impl/sqlite-workplace.repository.ts:303`

```ts
        ELSE #{newBase} || substr(logical_path, length(#{oldBase}) + 1)
```

**描述**：`length()`/`substr()` 在 SQLite 里按**字符**计（不是字节），这一点是对的。
但当 `oldPrefix` 归一化后为 `"/"` 时，`length("/") = 1`、`substr(path, 2)` 会吃掉开头的斜杠，
`"/a"` 得到 `"a"`，拼成 `newBase + "a"` = `"/ca"`（缺分隔符）。当前不可达——
`apps/desktop/src/main/ipc/handlers/vfs.ts:281` 先跑 `renameVfsDirectory(vfs, "/", ...)` 会先失败，
mobile 侧 `workplace-operations.service.ts:157` 的 `oldDir` 也来自真实目录。属于潜在陷阱。

**建议**：在 `renameRulesUnderLogicalPrefix` 开头加一条 `if (oldBase === "/") throw`（根目录本来也不可重命名），
或把 `substr` 改成 `substr(logical_path, length(#{oldBase}) + 1)` 且对根单独走 `newBase || '/' || substr(path, 2)`。

**置信**：confirmed（代码缺陷）/ unreachable（当前生产路径）

---

### F-core-workplace-16 | P3 | `packages/core/src/domain/workplace/logic/smart-sort.ts:292`

```ts
    rule.regex.lastIndex = 0;
    const match = rule.regex.exec(basename);
```

**描述**：`CompiledSmartSortRule.regex` 是被 `smartSortRuleService.listCompiledRules()` 缓存复用的
共享 `RegExp` 实例，每次匹配前写 `lastIndex` 是防御性归零（注释已说明 `g` 标记会残留 lastIndex）。
单线程同步执行下不会交错，安全；但这是对共享对象的**可变写**，若将来 `extractSortKeyDetail`
被搬进 worker / 并发场景就会变成真竞态。

**建议**：改用 `new RegExp(rule.regex.source, rule.regex.flags)` 或在 compile 阶段强制去掉 `g` 标记
（`compile-smart-sort-rule.ts` 侧），让规则对象真正不可变。

**置信**：confirmed（当前无行为影响）

---

### F-core-workplace-17 | P3 | `packages/core/src/domain/workplace/logic/default-dir-rule.ts:16`

```ts
export const DEFAULT_WORKPLACE_DIR_RULE = {
  sortField: "name" as const satisfies SortField,
  ...
  tailCount: 1000,
  fillPolicy: "header" as const satisfies FillPolicy,
} as const;
```

**描述**：同一组默认值在两处独立声明——本文件（TS 侧）与
`bootstrap/workplace/workplace-schema.ts:27-28` 的 DDL `DEFAULT 'name'` / `DEFAULT 1000`。
无任何断言或测试锁定两者一致。将来改 TS 侧忘了改 DDL（或反之）会让「无行时按 TS 默认求值」与
「无行时由 DB 填 DDL 默认」产生分叉——后者只在绕过 service 直插 SQL 时发生（e2e fixture / 迁移），
正好是最难复现的一类。

**建议**：加一条单测断言 `DEFAULT_WORKPLACE_DIR_RULE` 的每个字段与
`WORKPLACE_SCHEMA_STATEMENTS` 里解析出的 DDL 默认值一致。

**置信**：confirmed

---

### F-core-workplace-18 | P3 | `packages/core/src/domain/workplace/logic/front-matter.ts:16`

```ts
  /** `closed` is kept for signature compatibility but is always `true` after the
   * unclosed-as-no-front-matter change ... New code should not branch on this field. */
  closed: boolean;
```

**描述**：`closed` 恒为 `true`（`:30,48,51` 三处 return 全写死 `true`），是「未闭合 `---` 视作无 front matter」
那次改动的签名兼容残留。`git grep` 显示唯一生产消费方
`domain/skills/logic/parse-skill-front-matter.ts:38` 只用 `frontMatterLines` / `body`，
`apps/mobile/src/components/vfs/FileMarkdownPreview.tsx:279` 同理——无人读 `closed`。
`test/workplace/workplace-display.test.ts:24,31,34,43,50` 却仍在断言它恒 `true`，
属于「恒真断言」（RULE「验收断言的牙齿」第一条点名过的形态）。

**建议**：删字段 + 删对应断言；或按注释的指引给 `@deprecated` 标注并在下一轮清掉。

**置信**：intentional（注释明确写了「kept for signature compatibility / New code should not branch」）

---

### F-core-workplace-19 | P3 | `packages/core/src/domain/workplace/logic/workplace-path-map.ts:12`

```ts
export function mapProjectWorkplacePathToSession(logical: string): string {
  return normalizePath(logical);
}
```

**描述**：两个方向的映射都是纯 `normalizePath`，恒等。保留的理由写在 JSDoc「identity after unified root」——
统一根之后确实不再需要跨域重写路径。留着无害（调用点
`initialize-session-workspace.ts:12`、`push-session-workspace.ts` 语义清晰），
但**两个函数是纯冗余**，且 `mapSessionWorkplacePathToProject` 在生产侧无调用方。

**建议**：保留（作为「将来若恢复多根映射」的语义锚点合理），但把
`mapSessionWorkplacePathToProject` 标注 `@deprecated` 或从导出面移除。

**置信**：intentional（JSDoc 明写 identity after unified root）

---

### F-core-workplace-20 | P3 | `packages/core/src/domain/workplace/logic/workplace-rule-engine.ts:141`

```ts
  const sortedAuto = sortFilesForDir(autoMetas, dirRule, {
    smartRules: ctx.smartRules,
  });
```

**描述**：`ctx.smartRules` 缺省时（`workplace-rule-view.ts:23` 标注「缺省时 smart 退化为自然排序」）
`sortFilesForDir` 收到 `[]`，`extractSortKey` 对每个 basename 都白跑一遍
`for (const rule of rules)`（空循环，开销小）——这一条本身没问题。真正值得注意的是
**懒加载口径的不对称**：`service/workplace/impl/workplace.service.ts:391-395` 只在
`dirRuleMap` 里存在 `sortField === "smart"` 时才编译规则，且**不看 `ruleEnabled`**
（注释解释为「disabled 目录规则的排序配置仍生效」）。这意味着一个被用户显式关掉规则的目录，
只要 `sortField` 还停在 `smart`，就会让整个 scope 走 smart 编译路径——用户在 UI 关规则时
（`DirectoryRuleSheet.tsx` 只编辑规则内容、启停由文件管理菜单负责，RULE 有记）若没同时改排序字段，
就会留下这个「僵尸 smart 依赖」。行为上不算错（排序仍生效但结果不影响展示，因为 rule_off 后文件全 hidden），
只是多付一次规则编译。

**建议**：无需改行为。若要省这次编译，把懒加载条件改成
`[...dirRuleMap.values()].some((r) => r.sortField === "smart" && r.ruleEnabled)`，
并在注释里说明为何原来不看 `ruleEnabled`（与 created/updated 的 disabled-仍生效基线对齐）。

**置信**：intentional（`workplace.service.ts:388-390` 注释明确解释了取舍）

---

## 争议与存疑

**Q1：`filename` 档位与 `(missing)` 降级是否真的会把 1970 时间戳送进提示词？**
F-1 / F-2 的调用链我逐段读过（`load-or-fill-file-cache.ts:214/220` → `:152-164` 落库 →
`assemble-workplace-display.ts:188-195` → `renderFileBlock` → `formatLocalMtime(0)`），
但**没有实跑**一次组装去看实际字符串。RULE 明确要求「数字结论必须实测」，而这里不是数字结论、
是控制流结论，所以按静态证据定为 confirmed。若 reduce 阶段要升级为 P0，需要一次实跑取证。

**Q2：`render-dir-attach-tree.ts` 的 root 与 `workplaceFileTreeRootLabel` 是否本该共用一个实现？**
`render-dir-attach-tree.ts:31-38` 的注释说「根标签走 `workplaceFileTreeRootLabel` 口径一致」，
但代码另起了一份 `attachDirTreeRootLabel`，且该函数的 root 是**调用方传入的 `rootDir`**
（用户 `@` 某个子目录），而 `workplaceFileTreeRootLabel` 的 root 是 **scope 根恒 `/`**。
两者在「`rootDir` 恰为 `/`」时结果相同（都是 `/`），在子目录时 `attachDirTreeRootLabel` 返回
`basename/` 而 `workplaceFileTreeRootLabel` 恒返回 `/`。所以注释里的「一致」只在根路径成立。
我倾向认为这是**两份不同语义的实现 + 一条过度声称的注释**，但这属于 `domain/chat/` 的地盘，
建议由 chat 域机位裁决，本域只提供 F-11 的死分支清理建议。

**Q3：`workplace_dir_rule` 的 DDL CHECK 约束是否覆盖所有存量库？**
DDL 是 `CREATE TABLE IF NOT EXISTS`（`workplace-schema.ts:20`），若某个存量库里的表是在
CHECK 约束加入之前建的，`IF NOT EXISTS` 不会补约束。此时 F-10 的「非法 sortField 静默失效排序」
就从「理论边界」变成「可触发」。我没有去翻 schema migration 历史确认 CHECK 是何时加入的
（RULE 提到过 DDL + align + bump 三件套的纪律，但那是针对加列）。留给 reduce / bootstrap 域机位核实。

**Q4：`workplace` → `character-card` 的依赖方向（F-6）是否值得单独拆一轮？**
这不是单文件问题而是分层问题：`domain/workplace` 是通用装配层，`domain/character-card` 是业务域。
拆开需要先决定闸门归属（core 通用读侧 vs character-card 导入链），属于产品口径问题，
不宜在 CR 阶段自行拍板。我在 F-6 里给了两个方向，但没替主代理选。

**Q5：F-3 的实际性能影响有多大？**
我按「556 文件 × 默认 tail=1000」估算 55 万次 Set 插入，但**没有实测**（RULE「性能护栏取数量级回归线」
提醒过不要拿实测值卡线，这里我连量级都没跑）。真实影响取决于典型工作区的 `headCount + tailCount`
配置——如果用户在 UI 里都调成了 0（`DirectoryRuleModal.tsx:132` 的 `clampCount` 允许 0），
这一项就接近零成本。所以我给 P2 而不是 P1，并且**建议先测再改**。

---

*本报告由 domain-survey 机位产出，遵守只读纪律：无 git 写、无 `docs/apm/` 写、无全仓 grep
（定位一律 `git grep -l` / `git grep -n` 列文件后定点读，大文件分段读）。*
