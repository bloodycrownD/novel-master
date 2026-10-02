---
zone: w8-workplace-adv
agent: 辩护人（对抗机位 · advocate）
files_scanned: 25
---

# W8 对抗机位报告 —— workplace 域（辩护方）

扫描范围：`packages/core/src/domain/workplace/**`（18 文件）+ `packages/core/src/service/workplace/**`（6 文件）。
交叉取证区（只读，未纳入本区结论）：`domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts`、
`service/vfs/logic/clear-session-prompt-caches.ts`、`service/chat/impl/message-transcript-effects.service.ts`、
`service/agent/impl/agent-runner.ts`、`apps/desktop/src/main/ipc/handlers/workplace.ts`、`docs/apm/RULE.md`。

立场声明：本机位为**辩护方**，任务是论证本区设计的合理性；确实站不住的部分不粉饰，全部进「让步清单」。
本报告未读取 `raw/` 与 `synth/` 下任何其他机位文件。

## 摘要

workplace 是「常驻工作区」域：按会话级规则（目录规则 + 文件纳入规则 + 智能排序规则）把 VFS 文件树裁剪成
一份展示视图，再以「规则快照（哪几个文件、什么档位）+ 文件缓存（正文）」两段 KKV 落库，供提示词前缀
`<workplace>` 组装与 `{{$filetree}}` 宏复用。本区是全仓唯一一处「读时校验缓存 + 回合内冻结」语义并存的地方，
设计张力大但绝大多数取舍在 RULE 与迭代记忆里有明确拍板出处。

## 职责与边界

- **规则求值**：`domain/workplace/logic/workplace-rule-engine.ts` —— 单次 metadata 遍历 + DFS，产出
  `WorkplaceRuleRow[]` 与 `displayByPath`。`workplace-eval.ts` 是纯函数档位判定与排序；`smart-sort.ts` 是
  legado 语义的中文数字/自然序全序比较器。
- **规则持久化**：`repositories/impl/sqlite-workplace.repository.ts` —— `workplace_dir_rule` /
  `workplace_file_rule` 两表的 upsert / 批量 upsert / 前缀删 / 前缀改名 / scope 拷贝。
- **评估链缓存**：`service/workplace/impl/workplace-view-cache.ts` —— conn 级 `WeakMap` L1 memo，读时校验。
- **前缀装配**：`service/workplace/assemble-workplace-display.ts` —— 按快照 + 缓存拼 `<workplace>` 块，
  产出 S0（`prefixPaths`）与内容指纹（`fingerprint`）。
- **文件缓存读写**：`logic/load-or-fill-file-cache.ts` + `logic/rule-snapshot-codec.ts`。
- **失效编排**：`service/workplace/refresh-rule-snapshot.ts`（改规则后 evaluate → 写 canon → 清 file_cache）。
- **不在本区**：session-kkv 存储实现（另一域）、VFS 读写、agent-runner 调度、双端 UI。

## 对外接口

`packages/core/src/public/workplace.ts` 导出面（受 `test/package-exports/snapshots/public-workplace-allowlist.json`
快照测试锁定）：

- 类型：`WorkplaceScope` / `WorkplaceDirRule` / `WorkplaceRuleView` / `WorkplaceRuleContext` / `WorkplaceListRow` 等。
- 函数：`createWorkplaceService`、`assembleWorkplaceDisplay`、`refreshRuleSnapshot`、`evaluateWorkplaceRuleView`、
  `sortFilesForDir`、`sortDirPaths`、`evaluateFileDisplay`、`renderFileBlock(Body)`、`joinFileBlocks`、
  `renderWorkplaceFileTree`、`ruleViewToSnapshotEntries` / `parseRuleSnapshotJson` / `serializeRuleSnapshot`、
  `parseMarkdownFrontMatter` / `splitMarkdownFrontMatter`、`DEFAULT_WORKPLACE_DIR_RULE`、`workplaceFingerprint` 无关。
- 类：`WorkplaceAssemblyAbortedError`（组装中止哨兵，双端各自转 bail 哨兵）。
- `layoutHasWorkplace`（re-export 自 prompt 域）。

Service port：`WorkplaceService`（`setDirRule` / `getDirRule` / `listDirRules` / `setFileRule` /
`deleteRulesUnderLogicalPrefix` / `renameRulesUnderLogicalPrefix` / `materializeLiveView` /
`materializePersistBlock` / `evaluateRuleView` / `buildListRows` / `renderDisplay` / `renderFileTree`，
外加已标 `@deprecated` 的 `materialize`）。

## 数据访问

| 存储 | 触点 | 证据 |
|---|---|---|
| `workplace_dir_rule` | upsert / batchUpsert / listAll / find / 前缀 DELETE / 前缀 UPDATE / deleteScope | `sqlite-workplace.repository.ts:62,111,178,201,262,287,163` |
| `workplace_file_rule` | upsert / batchUpsert / listAll / find / 前缀 DELETE / 前缀 UPDATE / deleteScope | 同上 `:94,144,190,220,279,307,170` |
| `vfs_entry`（只读） | `listFileMetaUnderPrefix` / `listDirectoryPathsUnderPrefix` / `listDirectoryMetaUnderPrefix` / `computeEntrySignature` | `workplace.service.ts:343,346,380,316` |
| `vfs_entry`（读正文） | `findByPath`（persist 链）、`vfs.read`（缓存回填） | `workplace-materialize-engine.ts:36`、`load-or-fill-file-cache.ts:218` |
| `smart_sort_rule`（只读） | `listOrdered`（签名采样）、`listCompiledRules`（懒编译） | `create-workplace-service.ts:37,40` |
| KKV `rule_snapshot` / `canon` | 读 / 写 | `assemble-workplace-display.ts:217,232`；`refresh-rule-snapshot.ts:35` |
| KKV `file_cache` | `getMany` 批量读 / `set` 回填（可后台） | `assemble-workplace-display.ts:154`；`load-or-fill-file-cache.ts:154` |
| 进程内 | conn 级 `WeakMap<conn, Map<scopeKey, entry>>` | `workplace-view-cache.ts:55` |

无文件路径直读、无网络、无 IPC。分区键统一 `workplaceScopeKey(scope)`（`workplace-scope.ts:12`，global /
`project:<id>` / `session:<id>` / `global:meta` / `project:<id>:meta`）。

## 依赖关系

**import 谁**：`domain/vfs/logic/vfs-path-mapper`、`domain/vfs/repositories/impl/normalize-path`、
`domain/session-kkv/model/session-kkv-domains`、`domain/character-card/logic/character-card-limits`、
`domain/smart-sort-rule/*`、`infra/tdbc/ports/connection.port`、`infra/date-format`、`infra/sql-template`、
`bootstrap/workplace/workplace-schema`。

**被谁消费**（生产侧）：

- `service/agent/impl/agent-runner.ts:393,422` —— 取一次 `wt`（提到 step 循环外），`assembleWorkplaceDisplay`
  带 `kkvSessionId = session.kkvScopeSessionId`、`shouldStop = signal.aborted`。
- `service/agent/logic/run-agent-turn.ts` —— `$filetree` 宏（`workplace.renderFileTree()`）。
- `service/chat/impl/*`（置位/压缩）、`service/vfs/logic/clear-session-prompt-caches.ts`（导入对齐）——
  经 KKV 域常量反向依赖本区的 `SESSION_KKV_DOMAIN_*`。
- `domain/chat/logic/prepare-user-messages-for-prompt.ts:22,199` —— 复用 `loadOrFillFileCache` +
  `parseRuleSnapshotJson` 做 hydrate。
- `apps/desktop/src/main/ipc/handlers/workplace.ts`、`apps/desktop/src/main/services/session-prompt-input.service.ts`、
  `apps/mobile/src/services/session-prompt-input.service.ts`、`apps/mobile/src/services/workplace-rule-delta-draft.service.ts`、
  `apps/cli/src/workplace/run-workplace.ts`、`apps/cli/src/prompt/commands.ts`。
- `domain/tool/builtin/vfs-tools.ts:617` `ensureDirRulesForNewPath` → `setDirRule({logicalPath})`（补默认启用行）。

---

# 辩护理由清单

> 每条格式：`D-<n> | 议题 | 辩护结论 | 证据`。

## D-1 规则快照为什么只存 `{path, status}` 两字段，不存 mtime / 正文

**辩护**：形态切分是对的，而且是有意切分，不是省事的偷懒。快照回答的是「**哪些文件以什么档位进本次前缀**」，
文件缓存回答的是「**这些文件的正文是什么**」。两段的变更节奏不同：改规则只动档位（快照要重算、正文可整体作废），
正文变化只动 body（快照不动、缓存要回填）。合成一份就得在任一侧变化时整份作废。

具体收益在代码里可见：`refresh-rule-snapshot.ts:33-41` 的顺序正是「先写 canon、再 `clearDomain(file_cache)`」——
两段独立失效靠的就是两段物理分离；而 `assemble-workplace-display.ts:153` 的批量预取只按 `fileCacheKey(status, path)`
构造 key，key 里**天然**不含 mtime，说明快照形态从设计上就没打算承载 mtime。

**证据**：`rule-snapshot-codec.ts:11-14`（`RuleSnapshotEntry = { path, status }`）；
`refresh-rule-snapshot.ts:29-42`；`assemble-workplace-display.ts:150-158`。

## D-2 「空数组视为未就绪」不是 bug，是防空快照粘死

**辩护**：`assemble-workplace-display.ts:222-228` 对 `parsed.length === 0` 走重新评估，而不是直接返回空前缀。
首轮组装时 VFS 可能还没导入完（角色卡导入中途、ZIP 解压中），此刻算出的空快照若被接受并落库，工作区会**永久消失**
（除非用户手动改规则或置位/压缩）。选择「宁可多评估一次」是正确方向。

代价我也认：真正空的工作区（一个文件都没有）每次 assemble 都会重算 + 重写 canon。这属于 P3，见让步 C-6。

**证据**：`assemble-workplace-display.ts:222-228`（含原注释「避免首次空快照粘住后工作区永久消失」）。

## D-3 缓存命中即返回、不做 mtime 校验 —— intentional，有 RULE 与拍板记忆双出处

**辩护**：这是本区最容易被检察官当成 bug 打的一条，但它有两处权威出处，且机制上服务于一个硬需求
（provider 前缀缓存命中）。

RULE.md「常驻工作区（workplace）」词条原文：「前缀回合内天然冻结：`loadOrFillFileCache` 命中无条件返回（无 mtime 校验），
agent 回合中写盘不会改变前缀；改写缓存的只有用户改规则（`refreshRuleSnapshot`）、压缩/置位、会话删除」。

拍板记忆原文（`docs/apm/memory/20260921-storage-cache-dedup-vacuum.md` 摘要）：「mtime 校验曾被 import-cache-align
拍板『另立项不做』（回合内前缀冻结是有意设计）」。

技术上说得通：回合内每一步请求都是上一步的纯追加，前缀一变，provider 侧的前缀缓存就整块失效，成本是
数量级的。加 mtime 校验等于把「用户中途改了文件」这件低频事件，变成「每一步都可能全量重组前缀」的高频代价。

**证据**：`load-or-fill-file-cache.ts:51-57`（命中即 `return parsed`，无 mtime 比较）；
`RULE.md:27`；`docs/apm/memory/20260921-storage-cache-dedup-vacuum.md` abstract 段。

## D-4 失效点收敛到四处，是刻意收敛不是漏网

**辩护**：`file_cache` 的写入方不止组装一处，但**语义上**只有四类事件该让它作废：用户改规则、置位、压缩、会话删除。
代码里逐一对得上：

- 改规则 → `refreshRuleSnapshot` → `clearDomain(file_cache)`（`refresh-rule-snapshot.ts:41`）
- 置位 / 压缩 → `message-transcript-effects.service.ts:162,174`
- 导入对齐 → `clear-session-prompt-caches.ts:34-35`
- 会话删除 → `message.service.ts:249,451,483`

其余写入方都是「往里补内容」而非「让它失效」，不构成矛盾。特别注意 `vfs-tools.ts:549` 的
`upsertFileCacheAfterWrite` —— agent 写完文件顺手把新正文塞进缓存，这是**加速层的正确用法**（写入方主动喂缓存），
不需要触发失效。

**证据**：上列五处 file:line。

## D-5 后台延迟回填（`deferBackfillWrite`）的时序推理是对的

**辩护**：把「序列化 + 哈希 + deflate + 落库」整段挪出组装关键路径，理由不是「fire-and-forget 就异步了」——
代码明确指出 `fflate.zlibSync` 是**同步 CPU** 工作，不 await 它照样占同一条 JS 线程，所以推迟到宏任务
（`setTimeout(0)`）让本轮读链先跑完。这是把「同步 CPU 抢线程」和「await 排队」两件事分开处理，推理完整。

写失败静默也站得住：注释里给了理由「file_cache 是纯加速层，失败后果就是下次重新回填」，这与 D-3 的定位一致。
量化依据写在注释里（3 文件 6M 字符 / Node 22：466ms → 128ms）。

**证据**：`load-or-fill-file-cache.ts:66-78`（选项与量化依据）、`:100-127`（`scheduleBackfill` 宏任务与
`fflate.zlibSync` 同步 CPU 论证）、`:160-164`（分支）。

## D-6 批量读分片：方向正确，且分片常量的由来清楚

**辩护**：`assemble-workplace-display.ts:150-158` 用一次 `getMany` 批量预取替代「每文件两跳串行 SQL」，
注释给的判断是对的——**单连接串行执行下，并发查询救不了，只能减查询数**。

分片常量 `GET_MANY_CHUNK_SIZE = 400` 定义在存储层（`sqlite-session-kkv.repository.ts:34`，注释「双驱动绑参上限的
保守值」），不在本区。这个归属是对的：绑参上限是**驱动/存储**的知识，service 层不该知道 400 这个数。
本区只负责「用 `getMany` 而不是循环 `get`」，抽象边界干净。

**证据**：`assemble-workplace-display.ts:150-158`；`sqlite-session-kkv.repository.ts:34,79-86`（串行执行论述）。

## D-7 conn 级 WeakMap L1 memo + 读时校验：三个约束同时被满足

**辩护**：选 `WeakMap<TdbcConnection, Map<scopeKey, entry>>` 而不是模块级 `Map<scopeKey,…>` 或实例级 memo，
是被三个真实约束逼出来的唯一解，注释（`workplace-view-cache.ts:4-13`）把三条都列了：

1. **工厂每次调用 new 新实例** → 实例级 memo 命中率极低（RULE.md 记载 agent-runner L328 曾因此踩坑，现已提升到
   循环外 `agent-runner.ts:393`）；
2. **core 多库同进程测试 + mobile/desktop rebootstrap** → 裸模块级 Map 会串库；
3. **conn 关闭/GC 自动回收** → WeakMap 天然满足，rebootstrap 新 conn 即冷缓存无残留。

「读时校验、不挂写路径钩子」也是刻意的：写路径有 5+ 个挂点（改规则 / 置位 / 压缩 / 导入 / write 工具），
挂错一个就是陈旧数据；读时校验只有**一个**真相来源。代价是「脏结果最多存活一次读取」，这一条在
`workplace.service.ts:260-264` 与 `workplace-view-cache.ts:84-86` 都明写了，是自觉取舍不是疏漏。

**证据**：`workplace-view-cache.ts:1-15`（背景三约束）、`:55-66`、`:84-99`、`:105-129`；
`workplace.service.ts:265-288`；`RULE.md:27` 末段；`agent-runner.ts:390-393` 注释。

## D-8 规则表签名用确定性 JSON 序列化，不用聚合指纹 —— 是对的

**辩护**：`sampleSignatures` 的注释直接给了理由：「规则表无版本列且存在同数改写，不做聚合指纹」。
如果用 `count + sum(hash)` 这类聚合，同一行数的内容改写可能得到同一个签名 —— 规则改了但视图不刷新，
这是静默错误。要可靠就得对全量行做确定性序列化。规则表小、管理页改规则低频，代价可忽略。

配套细节也到位：`dirRules.sort(byLogicalPath)` 显式排序（`:319-324`），保证 SQL 返回序不影响签名；
`smart_sort_rule` 侧靠 `listOrdered` 的 `ORDER BY sort_order ASC, rule_id ASC` 保证顺序，并在注释里说明
「行对象由 repo 字面量构造，序列化确定」。

**证据**：`workplace.service.ts:307-336`；`sqlite-smart-sort-rule.repository.ts:49-59`。

## D-9 智能规则的「懒编译 + 无条件采样」是刻意的非对称

**辩护**：这两件事看起来矛盾（一个懒、一个不懒），其实是两层不同的成本：

- `smartRules`（编译后规则）只在**存在 `sortField === 'smart'` 的目录规则**时才编译 —— 编译要跑 regex，最贵，懒得住；
- `smartRuleRows`（原始行）**无条件**采样 —— 只查表不编译，最便宜，但必须在签名里，否则改了智能规则排序不刷新。

RULE 与提交口径一致（core/B-3：「改规则后排序即时刷新」）。加载侧不看 `ruleEnabled`、只看 `sortField`，
也在注释里说明是「与排序消费端共用同一基线口径」，避免出现第三种行为形态（core/B-1 修的就是这个）。

**证据**：`workplace.service.ts:386-395`（懒加载与口径说明）、`:325-330`（无条件采样与理由）。

## D-10 幽灵规则路径过滤是非破坏性的

**辩护**：`filterGhostConfiguredPaths` 的注释写得很清楚 —— 命中的规则行**不删**，只是不作为 `buildWorkplaceDirSet`
的输入。理由是 rename/删除后残留的规则路径若继续喂进树构建，会把已消失的目录整链渲染进文件树与 `$filetree` 宏，
用户对着幽灵目录操作会报 NOT_FOUND。

保留口径（根路径永远保留 / 目录行仍在或前缀下有 live 文件 / 文件本身仍在）也写得明白。这是**视图层兜底**，
不是数据一致性方案 —— 真正的清理交给 `deleteRulesUnderLogicalPrefix`。把它当数据 bug 报是归因错误。

**证据**：`workplace.service.ts:66-103`（含保留口径四条）。

## D-11 规则引擎 O(N·logN) 重构是行为等价的优化，不是语义变更

**辩护**：`workplace-rule-engine.ts:4-8` 的注释明确说「行为与旧实现完全一致」，并且代码里能验证这个说法：
旧实现对每个文件 `findIndex` 于排序后的 auto 名单，新实现预先把名次落进 `autoIndexByFile`（`:105-111`），
`computeDisplay` 用 `rawIndex < 0 ? 0 : rawIndex` 兜住「非 auto 文件不在表里 → 旧实现 findIndex<0 → 0」的等价语义
（`:174-175` 注释直说了这句）。556 文件的会话从分钟级降到可接受，这个改动是必需的。

**证据**：`workplace-rule-engine.ts:1-8,105-116,163-184`。

## D-12 组装按文件粒度可中止，是对「16 秒停止黑洞」的治本

**辩护**：`assemble-workplace-display.ts:68-83` 的背景写得很实：组装段曾是无观察点的原子块，用户连点 17 次停止、
abort 全部真派发却要等组装跑完。`shouldStop` 检查点放在「快照加载后 + 每个文件的缓存解析/回填之前」
（`:146-148, 167-169`），把粒度从「整个组装 16s」细化到「单文件」。

粒度选在**文件边界**而不是字节/行边界是对的：单文件读取本身是原子单元，再细切需要侵入 VFS 读链，
收益递减。注释里也明说了这个取舍。

**证据**：`assemble-workplace-display.ts:68-83,112-118,146-148,167-169`。

## D-13 廉价指纹的覆盖边界与已知缺口都写在注释里

**辩护**：`fingerprint` 只覆盖 `path|status|mtimeMs|bodyLength`，不哈希正文。注释明说了取舍原因（树复制保留源
mtime、写侧毫秒精度 → 「mtime 同、正文异」确实存在，`bodyLength` 段就是为此补的，引用了 r4-core-4），
也明说了剩余缺口（「长度与 mtime 双双相同的同长改写仍在覆盖外，下一次 mtime 前进或消息事件自愈」）。

这是一个**自觉的、量化过的近似**，且有下游自愈路径。指它「不精确」没有增量动作可提。

**证据**：`assemble-workplace-display.ts:52-65`（指纹设计 + 已知缺口）、`:196-201`（bodyLength 段）。

## D-14 `filterGhostConfiguredPaths` 的复杂度问题存在但影响面小

**辩护**（部分让步，见 C-3）：实现确实是 O(配置数 × 文件数)，但它的输入是**规则行数**而不是文件数。
典型会话规则行是几十量级（目录规则），文件数可以上千 —— 乘积在几千到几万次 `startsWith`，相对同一次评估里
`buildDirSortPlans` 的排序与 DFS 遍历，不是瓶颈。真正值得改的理由是可读性/可扩展性，不是性能。

---

# 让步清单

> 站不住或证据不足的部分，如实列出。每条给出置信度。

## C-1 | P2 | `filename` 档与 `(missing)` 档渲染出 1970 假时间戳，且写进缓存后粘住

**位置**：`load-or-fill-file-cache.ts:214-216`（filename → `{ body: "", mtimeMs: 0 }`）、`:220-222`
（读失败 → `{ body: "(missing)", mtimeMs: 0 }`）；消费点 `assemble-workplace-display.ts:188-195`
（`renderFileBlock({ mtimeMs: payload.mtimeMs, ... })`）。

**实测**（`renderFileBlock` 直接调用）：

```
full            -> <file path="/a.md" createdAt="2025-06-15 23:06:40" updatedAt="2025-06-15 23:06:40" ...>
filename(mtime=0) -> <file path="/a.md" createdAt="1970-01-01 08:00:00" updatedAt="1970-01-01 08:00:00" ...>
header(missing,mtime=0) -> <file path="/a.md" createdAt="1970-01-01 08:00:00" updatedAt="1970-01-01 08:00:00" ...>
```

**为什么不能用「已有修复」挡掉**：提交 `645b18b5 fix(core): 超大文件占位块携带真实 mtime，消除 1970 假时间戳`
修的是**超限占位符**那条路（`probeOversizePlaceholder` 返回 `mtimeMs: size.mtimeMs`，`:192,203`），
`filename` / `(missing)` 两条路没被覆盖。测试也只锁了占位符那条
（`assemble-workplace-display.test.ts:459-466`、`load-or-fill-file-cache.test.ts:74`）。

**可达性**：`filename` 档由 `evaluateFileDisplay` 在 `fillPolicy === "filename"` 时产生（`workplace-eval.ts:175-177`），
是用户可选的填充策略；`DISPLAY_STATUSES` 含 `"filename"`（`rule-snapshot-codec.ts:16`），所以它会进快照、会走
`fillFileCacheFromVfs`。一旦首次回填把 `mtimeMs: 0` 写进 `file_cache`，后续命中缓存拿到的还是 0 —— **粘住**，
直到 `clearDomain` 才自愈。

**建议**：`readWorkplaceFileBody` 的这两条分支带真实 mtime。`filename` 档当前跳过超限探针
（`load-or-fill-file-cache.ts:142`）是因为不读正文，但 mtime 可以单独取 —— `vfs.findContentSize` 已经能零成本带回
mtime（`sqlite-vfs-entry.repository.ts:225-228` 的 `mtime_ms` 随行带回，注释明说是「供占位块渲染真实时间」），
给它加一个只要 mtime 的轻量分支即可。`(missing)` 分支需要捕获 NOT_FOUND 后再取一次 mtime，或在 miss 时就不落缓存。

**置信**：confirmed（渲染输出实测 + 代码路径可达性已验证）。

## C-2 | P3 | `materializeBlockFromView` 逐文件串行 `findByPath`，与装配路径的收敛方向不一致

**位置**：`workplace-materialize-engine.ts:25-47`，`for (const row of view.rows)` 内 `await vfs.findByPath(...)`
—— N 个可见文件 = N 次串行查询。

装配路径（`assemble`）已经因为同样问题收敛到 `getMany`（`assemble-workplace-display.ts:150-158` 的注释就是
「每文件两跳串行 SQL 曾是主要成本」）。persist 链没跟上。

**减轻因素（辩护）**：这条路径只服务 CLI 的 `vfs|project workplace display` 与少量 live 调用
（`workplace.port.ts:104-107` 明说聊天常驻前缀不许用它），不在 16 秒热路径上。

**建议**：要么加 `findManyByPaths` 走一条 IN 查询，要么在 port 注释里明写「非热路径，勿照抄进 assemble」。

**置信**：confirmed（代码事实），影响面为 suspected。

## C-3 | P3 | `filterGhostConfiguredPaths` 是 O(配置数 × 文件数) 的线性扫描嵌套

**位置**：`workplace.service.ts:86-101` —— `for (const raw of input.configuredPaths)` 内
`files.some((f) => f.startsWith(prefix))`，每次都全量扫 `fileSet`。

**建议**：把 `fileSet` 排序后按 `n + "/"` 前缀二分，或直接建「所有目录前缀」Set 一次成型（`buildWorkplaceDirSet`
本来就要建父链，可复用其结果）。属可读性/扩展性改进，非当前性能缺陷（见 D-14）。

**置信**：confirmed（结构事实），性能影响 suspected。

## C-4 | P3 | `copyScope` 不在同一事务内，与同文件的 `renameRulesUnderLogicalPrefix` 标准不一致

**位置**：`sqlite-workplace.repository.ts:238-260` —— `deleteScope(toScopeKey)` 后接两次 `batchUpsert*`，
三步各自独立提交；中途失败会留下「目标 scope 已清空但只搬了一半规则」的状态。

对比同文件 `:315-331` 的 `renameRulesUnderLogicalPrefix`，那里明确把两条 UPDATE 放进同一事务并写了理由
（「避免 dir_rule 成功而 file_rule 失败时留下半套状态」）。同一个文件里两套标准，说不上是刻意。

**建议**：三步包进一个 `conn.transaction`，与 rename 对齐。注意 TDBC 事务不可嵌套，需确认调用方
（`push-session-workspace.ts` / `initialize-session-workspace.ts` / `seed-fork-copy-parity.ts`）当前都在非事务连接上。

**置信**：confirmed（代码事实）；调用方是否已在事务中 = suspected（未逐个核实）。

## C-5 | P3 | `setDirRule` 的「不带 `ruleEnabled` 即视为开启」是易踩的隐式行为

**位置**：`workplace.service.ts:128-132`，注释 `// Any save without explicit --rule off enables rules
(do not preserve prior rule_off)`，实现为 `input.ruleEnabled === false ? false : true`。

含义：任何只想改排序字段的调用，都会把已 `rule_off` 的目录**静默翻回** `rule_on`。

**辩护部分**：当前调用方都安全 —— 双端 UI 表单都原样回传加载到的既有状态
（`DirectoryRuleModal.tsx:128`、`DirectoryRuleSheet.tsx:121`，注释「ruleEnabled 沿用加载到的既有状态原样保存」），
工具侧 `ensureDirRulesForNewPath` 只对**无行**层级调用（`vfs-tools.ts:605-608`）。所以这不是活跃 bug。

**让步**：这是个靠「所有调用方都记得传」维持的不变量，而 port 层对此**零文档、零断言**
（`workplace.port.ts:59` 只有一行 `setDirRule(input: SetDirRuleInput)`）。契约写在实现注释里而不是接口上，
下一个调用方很容易踩。

**建议**：要么把口径写进 `SetDirRuleInput.ruleEnabled` 的 JSDoc，要么拆一个显式的
`updateDirRuleContent` / `setDirRuleEnabled` 双入口，让意图不必靠字段缺失来表达。

**置信**：confirmed（代码事实），实际触发 = 未发现（当前调用方全安全）。

## C-6 | P3 | 真正空的工作区每次 assemble 都重算并重写 canon

**位置**：`assemble-workplace-display.ts:222-228`。`parsed.length === 0` 视为未就绪 → 重评估 → 重写。
对于「工作区确实一个可见文件都没有」的用户，这是每次发送消息都多一次完整规则评估 + 一次 KKV 写。

**辩护部分**：这是 D-2 那个正确取舍的伴生代价，不是独立缺陷 —— 宁可多算一次，也不能让空快照粘死。

**建议**：若要区分「首次真空」与「稳定真空」，可在快照条目里加一个显式的 ready 标记（而不是靠长度判断），
代价是快照格式变更（要兼容旧格式）。P3，可不做。

**置信**：confirmed（代码事实），实际发生频率取决于是否有空工作区用户 = suspected。

## C-7 | P3 | 一批只被测试或 public barrel 引用的符号（生产侧近乎死代码）

**实测**（`rg` 排除 `dist` / `test` / `__tests__` 后的生产侧引用）：

| 符号 | 定义 | 生产侧引用 |
|---|---|---|
| `materialize()` / `WorkplaceMaterialized` | `workplace.port.ts:49,86`、`workplace.service.ts:206` | **零**（无任何 `.materialize()` 调用） |
| `renderWorkplaceFileTree`（非 ForMacro 版） | `workplace-file-tree.ts:126` | 仅 `public/workplace.ts:46` re-export |
| `diffWorkplacePaths` / `isWorkplacePathLoadedInCache` | `diff-workplace-paths.ts:30,45` | 仅 `public/workplace.ts:82` re-export |
| `WorkplaceRepository.findFileRule` | `workplace.port.ts:46`、`sqlite-workplace.repository.ts:220` | 零 |
| `mapProjectWorkplacePathToSession` / `mapSessionWorkplacePathToProject` | `workplace-path-map.ts:12,19` | `initialize-session-workspace.ts` / `push-session-workspace.ts` 各一处，但**函数体是 `normalizePath` 恒等**（统一根之后的遗留） |

**辩护部分**：`public/workplace.ts` 的导出面有 allowlist 快照测试兜着
（`test/package-exports/snapshots/public-workplace-allowlist.json`），删任一导出都要连带改快照，属有意的
「外部可见 API 面」，不能按内部死代码处理。`map*WorkplacePath` 两个恒等函数虽只剩 normalize，但删掉要改
template 初始化/推送两条链的 import，收益低于风险。

**让步**：至少 `materialize()` + `WorkplaceMaterialized` 这一组是可以标 `@deprecated` 后择机删的
（`@deprecated` 标签**已经**在 `workplace.port.ts:47,84` 和 `workplace.service.ts:205` 上了，说明作者本人
也认为它不该被用）。这组是最干净的下一步。

**置信**：confirmed（引用扫描为实测）。

## C-8 | P3 | `renameRulesUnderLogicalPrefix` 把「必须是非事务连接」写在注释里而非断言

**位置**：`sqlite-workplace.repository.ts:315-317`：「TDBC 事务不可嵌套——目前唯一调用方…在此处是非事务连接，
安全；若未来有调用方把本方法放进外层事务，需改成『复用外层 tx』」。

**辩护部分**：注释写得非常清楚，风险点已被识别并留了修复方向，符合本仓「已知盲区显式记录」的惯例。

**让步**：约束靠注释维持而非代码强制。RULE.md 里已经有对应纪律（事务回调里误用外层 conn 会撞 AsyncMutex
不可重入，**死锁而非报错**）—— 这是最难排查的一类故障。建议加一条运行期断言（TDBC 无事务探测 API 时，
至少在方法内 `try/catch` 并把错误信息写明「疑似嵌套事务」）。

**置信**：confirmed（注释内容），实际踩坑 = 未发生。

## C-9 | P3 | `escapeXmlAttr` 不转义 `>`

**位置**：`workplace-display.ts:11-16`，转义 `&` / `"` / `<`，不转义 `>`。

**辩护**：XML 规范里属性值中的 `>` 是合法字符（只有 `]]>` 序列在某些上下文需注意），不转义**不是缺陷**。

**让步**：若下游有 XML/HTML 解析器对此更严格，属可选加固，收益接近零。建议不改，仅记录以免反复被当 bug 报。

**置信**：intentional / 非缺陷。

---

# 争议与存疑

按对抗纪律，我不预读检察官报告，以下是我**预期**会被攻击的点及我方立场，供主代理裁决时对照：

1. **「缓存命中不校验 mtime = 数据陈旧」** —— 我方立场：intentional，RULE.md:27 + 20260921 记忆双出处，
   服务于 provider 前缀缓存。**唯一需要补的缺口**是 C-1：`filename` / `(missing)` 两档连「冻结的真实值」
   都没有，是 0 而非旧值。

2. **「快照形态太薄，改规则要重算」** —— 我方立场：这是 D-1 的刻意分离，不是能力缺失。改规则是低频事件，
   代价是一次 evaluate + 一次 clearDomain。

3. **「sampleSignatures 无条件全量读规则表 + JSON.stringify，每次评估都做」** —— 我方立场：这是 D-7 读时校验
   的固有成本，也是它换来「零写路径挂点」的代价。规则表小，可接受。若未来规则表变大，第一个该优化的是
   D-8 的序列化形式（比如给规则表加 `updated_at` 版本列做版本号签名），不是回退到写路径钩子。

4. **「`materializePersistBlock` 复用缓存 ctx 的 `mtimeByPath` 做读-改-写」** —— 我方立场：注释已论证
   「mtime 变化必然改变 vfs 签名触发整条重算」（`workplace.service.ts:226-227`），逻辑闭合。

5. **我不确定的一点**：`evaluateCachedView` 的 in-flight 去重（`:274-276`）返回的是 `entry.inFlight`，
   而该 in-flight 是**用另一组 sigs** 采样起算的。也就是说，并发的第二个读者可能拿到一份「对自己而言签名不匹配」
   的结果。这与文件头注释「脏结果最多存活一次读取」一致（下一个读者会重算），但严格说**第二个读者这一次读**
   拿到的是可能陈旧的值。我判定这是自觉取舍，但它的边界比注释描述的略宽一点 —— 值得主代理确认这是否与
   原始意图一致。

6. **跨区观察（不计入本区结论）**：`session_file_cache_blob` 的解压产物进程内缓存
   （`decoded-content-cache`）与 KKV 层的 WeakMap 是两层不同生命周期的缓存叠加。本区只负责产出
   `file_cache` key，存储层怎么落、怎么解压不归我。但 W8 若有存储侧机位，两者需要合看，否则会重复计数收益或漏掉双层失效。

---

# 给 reduce 代理的速览

- **本区设计经得起质疑的核心**：D-1（快照两段分离）、D-3（命中即返回，intentional）、D-6（批量读分片，抽象边界正确）、
  D-7（conn 级 WeakMap + 读时校验，三约束唯一解）、D-8（确定性序列化而非聚合指纹）。
- **真问题只有一条值得动**：**C-1**（P2，1970 假时间戳，实测复现，且粘住）。
- **其余让步均为 P3**：C-2 ~ C-8。
- **标注 intentional 不当问题报**：C-9、以及争议点 1/3/5 所涉的冻结语义与读时校验成本。
- **本区无 P0/P1**。