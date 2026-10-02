---
zone: w8-workplace-pro
agent: 检察官（对抗机位 · 猎杀冗余/死路径/竞态/不一致）
files_scanned: 25
---

# W8 · workplace 域检察官报告

## 摘要

常驻工作区（workplace）是「按会话级规则快照 + 文件缓存拼装、每轮注入提示词前缀的文件树正文」。
本区两半：`domain/workplace/` 是纯逻辑（规则引擎 DFS 评估、目录规则求值、ASCII 树渲染、
front-matter 抽取、smart 排序原语、SQLite 仓储）；`service/workplace/` 是应用层（按 scope 的
配置服务 + 读时校验的 L1 视图缓存 + 常驻前缀组装 + 规则刷新）。共 25 个源文件、~110KB。

## 职责与边界

- **规则评估**：`evaluateWorkplaceRuleView(scope, ctx) → { rows, displayByPath }`，纯函数，不读正文。
- **配置读写**：`workplace_dir_rule` / `workplace_file_rule` 两表的 upsert / 列举 / 前缀删 / 前缀改名 / scope 复制。
- **展示物**：`$filetree` 宏树、`<file>` 持久块、行号正文、front-matter 头。
- **边界外**（本区只消费不拥有）：VFS 条目仓储（`vfs_entry` 签名/meta）、session KKV
  （`rule_snapshot` / `file_cache`）、`vfs-tools` 的目录规则补行、agent-runner 的组装调用点。
  **本区不负责**：`$filetree` 宏的展开时机（prompt 域）、短提示 seen 集（chat 域）、
  置位/压缩的清域副作用（chat/vfs 域）。

## 对外接口

`packages/core/src/public/workplace.ts` 是唯一出口（25 个文件里对外暴露面最宽的一个）：

| 符号 | 定义处 | 生产消费方 |
|---|---|---|
| `createWorkplaceService` | `create-workplace-service.ts:22` | 三端 runtime 工厂（每次调用 new 实例） |
| `assembleWorkplaceDisplay` / `WorkplaceAssemblyAbortedError` | `assemble-workplace-display.ts:130` / `:84` | agent-runner（run 侧）、mobile/desktop chip 侧 |
| `refreshRuleSnapshot` | `refresh-rule-snapshot.ts:29` | `apps/desktop/src/main/ipc/handlers/workplace.ts:74`、`apps/mobile/.../workplace-rule-delta-draft.service.ts:17` |
| `evaluateWorkplaceRuleView` / `evaluateFileDisplay` / `sortDirPaths` / `sortFilesForDir` | 规则引擎 / workplace-eval | 内部 + public |
| `mapProjectWorkplacePathToSession` / `…ToProject` | `workplace-path-map.ts:12`/`:19` | `service/template/logic/initialize-session-workspace.ts:52`、`push-session-workspace.ts:46` |
| `ruleViewToSnapshotEntries` / `parseRuleSnapshotJson` / `serializeRuleSnapshot` | `rule-snapshot-codec.ts` | assemble + refresh |
| `renderWorkplaceFileTree`（非宏变体） | `workplace-file-tree.ts:126` | **无生产消费方**（见 F-11） |
| `diffWorkplacePaths` / `isWorkplacePathLoadedInCache` | `diff-workplace-paths.ts:45`/`:30` | **无生产消费方**（见 F-10） |

`service/workplace/workplace.port.ts:56` 的 `WorkplaceService` 接口有 12 个方法，其中
`materialize()`（`:86`，已 `@deprecated`）、`renderDisplay()`（`:109`）、`renderFileTree()`（`:112`）
只有 CLI（`apps/cli/src/project/workplace.ts`、`vfs/workplace.ts`、`session/workplace.ts`）在用。

## 数据访问

| 资源 | 访问点 | 证据 |
|---|---|---|
| `workplace_dir_rule` | 全量列举 ×3 次/评估（1 采样 + 1 上下文） | `workplace.service.ts:317`、`workplace.service.ts:350`、`sqlite-workplace.repository.ts:178` |
| `workplace_file_rule` | 全量列举 ×2 次/评估 | `workplace.service.ts:318`、`workplace.service.ts:351`、`sqlite-workplace.repository.ts:190` |
| `vfs_entry`（文件 meta） | 每次上下文加载一条 `path, mtime_ms` 全 scope 查询 | `workplace.service.ts:343` → `sqlite-vfs-entry.repository.ts:610` |
| `vfs_entry`（目录路径） | 同上 | `workplace.service.ts:346` → `sqlite-vfs-entry.repository.ts:548` |
| `vfs_entry`（目录 meta） | 同上 | `workplace.service.ts:380` → `sqlite-vfs-entry.repository.ts:567` |
| `vfs_entry`（聚合签名） | 每次读时校验一条 `group_concat` 全 scope 扫描 | `workplace.service.ts:316` → `sqlite-vfs-entry.repository.ts:632-647` |
| `vfs_entry`（正文） | 每条非 hidden/full/header 文件一次 `findByPath` | `workplace-materialize-engine.ts:36` |
| KKV `rule_snapshot`/`canon` | 每次组装读一次；miss 时写一次 | `assemble-workplace-display.ts:217`、`:232` |
| KKV `file_cache` | 每次组装一次 `getMany`（按 `{status}:{path}` 批量） | `assemble-workplace-display.ts:154` → `sqlite-session-kkv.repository.ts:87` |
| KKV `file_cache` | 单键读（hydrate 路径，不走批量） | `load-or-fill-file-cache.ts:46` ← `prepare-user-messages-for-prompt.ts:199` |
| KKV `file_cache` | 写（后台 fire-and-forget） | `load-or-fill-file-cache.ts:153-164` |
| KKV `file_cache` | 整域清 | `refresh-rule-snapshot.ts:41` |
| `smart_sort_rule` | 签名采样时无条件全量 `listOrdered()` | `workplace.service.ts:328`、`create-workplace-service.ts:40` |

## 依赖关系

**import（谁）**：`domain/vfs`（normalizePath / scopeKey / assertLogicalPathAllowed / VfsEntryRepository）、
`domain/session-kkv`（域常量 + `fileCacheKey`）、`domain/character-card`（大小闸门常量）、
`domain/prompt`（`AgentPromptLayout`）、`domain/chat/logic/prompt-path-seen`（S0 规范化）、
`service/session-kkv`（port）、`infra/tdbc` + `infra/sql-template`（仓储）、`bootstrap/workplace/workplace-schema`（表名常量）。

**被消费**：`service/agent`（agent-runner 每轮组装）、`service/chat`（prepare hydrate）、
`service/template`（会话工作区初始化/回推）、`domain/tool/builtin/vfs-tools`（补目录规则）、
三端 runtime（`rt.workplace(scope)`）+ desktop/mobile workplace IPC + CLI。

**无反向依赖**：本区不 import 任何 service（除 port 类型），无循环依赖。

---

## 发现清单

### F-w8-pro-1 | P1 | `service/workplace/assemble-workplace-display.ts:167` + `domain/workplace/logic/load-or-fill-file-cache.ts:114`

```
    if (options?.shouldStop?.() === true) {
      throw new WorkplaceAssemblyAbortedError();
    }
```
```
  const settled = new Promise<void>((resolve) => {
    setTimeout(() => {
      void write().then(...)
```

**描述**：中止机制（2026-09-30「停止要等 14 秒」的治本点）只抛错，不取消已排入宏任务的
后台回填。`assemble-workplace-display.ts:175-187` 对每个 cache-miss 文件以
`deferBackfillWrite: true` 调 `fillFileCacheFromVfs`，后者在
`load-or-fill-file-cache.ts:114-127` 用 `setTimeout(0)` 排一个后台写。写体 =
`serializeFileCachePayload`（`JSON.stringify` 整个正文）+ `sessionKkv.set`（sha256 + `zlibSync`），
全是**同步 CPU**——这一点本文件的注释自己就写明了（`:103-109`「`fflate` 的 `zlibSync` 是同步 CPU
工作，它照样占着同一条 JS 线程」），并给了量化：3 文件 6M 字符下 hash 127ms + deflate 173ms。

于是：组装在第 k 个文件被 `shouldStop` 打断时，已经排好的 k−1 个回填会在用户按下停止之后
**背靠背连跑**，把 JS 线程重新占满几百毫秒。这正好抵消了本次中止改造想解决的症状——
「停止必须从受理即可停」在这条路径上被自己排的队破掉。

**建议**：`assembleWorkplaceDisplay` 捕获 `WorkplaceAssemblyAbortedError` 后调用一个
`cancelPendingFileCacheBackfills()`（把 `pendingBackfills` 里的 `setTimeout` 句柄清掉）再重抛；
或给 `scheduleBackfill` 的回调加一个 `cancelled` 标志位，在写前检查。
最小改法：`FillFileCacheOptions` 加 `skipBackfillOnStop?: () => boolean`。

**置信**：suspected（逻辑链完整且各段都有注释自证；但「用户在停止后仍感到卡顿」这一步需真机实测，
我没有做该测量。测试 `test/workplace/assemble-abort-fingerprint.test.ts:112` 只断言「第二个文件不再读」，
对已排队回填无任何断言。）

---

### F-w8-pro-2 | P2 | `domain/workplace/logic/workplace-file-tree.ts:100` + `domain/workplace/logic/workplace-tree.ts:66`

```
  for (let i = 0; i < children.length; i++) {
```
```
export function directChildDirs(dir: string, allDirs: ReadonlySet<string>): string[] {
  const normalized = normalizePath(dir);
  for (const d of allDirs) { ... if (parentDirOf(d) === normalized) ... }
```
`directChildFiles`（`:84-102`）同样是全量扫 `fileSet`。

**描述**：`appendDirLines` 对**每个目录**调一次 `sortedChildren`（`:100`），而
`sortedChildren`（`:68-91`）每次都把 `allDirs` 和 `fileSet` 各扫一遍（且 `directChildDirs` 对
每个元素调 `parentDirOf` → 再调 `normalizePath`）。整体 **O(D × (|allDirs| + |fileSet|))**，
外加每目录重跑一次 `sortDirPaths` + `sortFilesForDir`。

**更要紧的是第二层**：`computeFullViewValue`（`workplace.service.ts:291-305`）先调
`evaluateWorkplaceRuleView`，其 `buildDirSortPlans`（`workplace-rule-engine.ts:73-119`）已经按
父目录分组算好了每个目录的 `sortedFiles`，`walkDir`（`:202-206`）也已经算好了每个目录的
`sortDirPaths` 结果；紧接着 `renderWorkplaceFileTreeForMacro`（`:294`）把**同一批集合用同一组
参数再排一遍**，算完就丢（`planByDir` 没传进去，只有 `displayByPath` 传了）。
即：`workplace-rule-engine.ts:1-7` 的文件头把「O(N²·logN) → O(N·logN)」当成本模块的招牌优化，
而紧邻的下一步就把同样的活重做了一遍，并且重做的那遍还额外带 O(D×N) 的全量扫描。

**建议**：(a) 把 `planByDir` 透传给 `RenderWorkplaceFileTreeForMacroParams`，让
`sortedChildren` 直接消费 `sortedFiles`（消除重复排序）；(b) 把 `directChildDirs` /
`directChildFiles` 换成一次预建的 `parent → children[]` 索引（`buildDirSortPlans` 已经在建
`filesByDir` 了，目录侧同样建一次即可），顺带消掉每元素一次 `normalizePath`。

**置信**：confirmed（结构可直接从引文数出；未做 N=556 的实机计时，量级按 RULE 里
「556 文件真机一次评估分钟级」的历史记录推断）。

---

### F-w8-pro-3 | P2 | `service/workplace/impl/workplace.service.ts:317` vs `:350`

```
    const dirRules = await this.deps.workplace.listDirRules(scopeKey);
    const fileRules = await this.deps.workplace.listFileRules(scopeKey);
```
```
    const dirRules = await this.deps.workplace.listDirRules(scopeKey);
    const fileRules = await this.deps.workplace.listFileRules(scopeKey);
```

**描述**：`sampleSignatures()` 为签名采样把两张规则表全量读一遍，`loadContextMetadata()`
紧接着为构造上下文**再读一遍完全相同的两张表**。缓存未命中时同一次评估付 4 条全表查询而不是 2 条。

更值得记的是命中路径的成本结构：L1 缓存省掉的是 CPU（DFS + 排序 + 树渲染），
**没省 IO**——每次读（`materializeLiveView` / `evaluateRuleView` / `buildListRows`，
mobile `VfsFileManager` 会反复调）都要付：1 条全 scope `group_concat` 签名查询
（`sqlite-vfs-entry.repository.ts:632`，对整个 scope 的每行做字符串拼接）+ 2 条规则表全量查询
+ 1 条 `smart_sort_rule` 全量查询（`workplace.service.ts:327-330` 无条件执行，哪怕没有任何
目录规则用 `sortField: 'smart'`，与 `loadContextMetadata:391-395` 的懒加载口径相反）。
即缓存命中仍是 O(全库) IO。这是「读时校验」设计的固有代价，注释也认了「过度失效可接受」。

**建议**：把 `sampleSignatures` 已读到的 `dirRules`/`fileRules` 直接传给 `computeFullViewValue`
→ `loadContextMetadata`（未命中时省 2 条查询）；`smartRuleRows` 加上与 `smartRules` 同样的
`some(r => r.sortField === 'smart')` 前置判断（但要先确认「改智能规则但没有 smart 目录规则时
不刷新树」是否可接受——大概率可接受，因为没有 smart 目录规则时树里不会有 smart 排序的结果）。

**置信**：confirmed（重复读取）/ suspected（smartRuleRows 提前门闩会改变失效语义，需拍板）。

---

### F-w8-pro-4 | P2 | `service/workplace/impl/workplace.service.ts:85` + `:96`

```
  const files = [...input.fileSet];
```
```
        files.some((f) => f.startsWith(prefix));
```

**描述**：`filterGhostConfiguredPaths` 每次评估把整个 `fileSet` 拷成数组，然后对**每个**
configured path 做一次线性 `some` 扫描 → O(|configuredPaths| × |fileSet|)，外加一次全量数组拷贝。
同样的 `startsWith(prefix)` 判定在 `workplace-tree.ts:92` 又做了一遍（那里也是全量扫）。

**建议**：预建一个前缀树或按父目录分组的索引（`filesByDir` 在 `buildDirSortPlans` 里已经有了，
提到更上层复用即可），把「P 前缀下是否还有 live 文件」降到 O(1)/O(depth)。

**置信**：confirmed（结构）/ 实际影响量级未实测，标 P2 而非 P1。

---

### F-w8-pro-5 | P2 | `domain/vfs/repositories/../../domain/tool/builtin/vfs-tools.ts:563`（区外写入方）vs `domain/workplace/logic/load-or-fill-file-cache.ts:152`（区内契约）

```
    serializeFileCachePayload({ body: content, mtimeMs: Date.now() })
```
```
  const filled = await readWorkplaceFileBody(deps.path, deps.status, deps.vfs);
  // ... mtimeMs: result.mtimeMs （load-or-fill-file-cache.ts:219）
```

**描述**：`file_cache` 的 `FileCachePayload.mtimeMs` 有**两个生产方，语义不同**：
- `fillFileCacheFromVfs`（区内）写 VFS 权威 mtime（`vfs.read().mtimeMs`）；
- `upsertFileCacheAfterWrite`（区外，`vfs-tools.ts:563`）写 `Date.now()`（工具完成时的挂钟）。

这个 mtime 有两个区内消费方，都是**对模型可见 / 对下游可见**的：
1. `renderFileBlock` 把它渲染成 `createdAt` / `updatedAt` 两个属性
   （`workplace-display.ts:78-84`，两个属性填的是同一个值）；
2. `assemble-workplaceDisplay` 把它拼进 `fingerprint`
   （`assemble-workplace-display.ts:200`：`${entry.path}|${entry.status}|${payload.mtimeMs}|${payload.body.length}`）。

后果：同一个文件，agent 刚写过 → 走 `Date.now()`；冷启动回填 → 走 VFS mtime。
两者不同则 `<file updatedAt>` 不同、`fingerprint` 不同，下游 chip 估读的记忆缓存会被迫判为
「内容变了」而重算（fingerprint 的整个设计意图就是「同样这批文件必然逐字节相同」）。
VFS 提交 mtime 与工具完成时刻之间隔着一次事务提交 + 序列化，差值通常在毫秒级但**不为零**。

**建议**：`upsertFileCacheAfterWrite` 改为从 write 结果里取 VFS 实际 mtime（write 工具已持有
`expectedVersion`/返回值），拿不到就不写 file_cache（它是纯加速层，miss 无害），
别用挂钟近似。

**置信**：confirmed（两条生产路径与两个消费点都在代码里）/ 影响量级未实测。

---

### F-w8-pro-6 | P2 | `domain/workplace/repositories/impl/sqlite-workplace.repository.ts:244`

```
    await this.deleteScope(toScopeKey);
    const dirs = await this.listDirRules(fromScopeKey);
    ...
    await this.batchUpsertDirRules(mappedDirs);
    await this.batchUpsertFileRules(mappedFiles);
```

**描述**：`copyScope` 的「清空目标 scope → 批量写目录规则 → 批量写文件规则」三步**不在事务里**。
任一步抛错（磁盘满、驱动批量上限、序列化）都会把目标 scope 留在「规则全空」或「只有目录规则」
的半截状态。同文件里的 `renameRulesUnderLogicalPrefix`（`:315-331`）恰恰是包在
`this.conn.transaction(...)` 里的，注释还专门解释了为什么要事务（「避免 dir_rule 成功而
file_rule 失败时留下半套状态」）——同一个文件里两套相反的持久化纪律。

**建议**：`copyScope` 整体包进一个 `conn.transaction`，与 `renameRulesUnderLogicalPrefix`
对齐；注意同一条事务不可嵌套的约束（见 F-7）。

**置信**：confirmed（引文即全部三个 await，无事务包裹）。

---

### F-w8-pro-7 | P2 | `domain/workplace/repositories/impl/sqlite-workplace.repository.ts:315-318` + `service/workplace/impl/workplace.service.ts:198`

```
    // 注意：TDBC 事务不可嵌套——目前唯一调用方（createWorkplaceService 的默认连接）
    // 在此处是非事务连接，安全；若未来有调用方把本方法放进外层事务，需改成"复用外层 tx"。
    await this.conn.transaction(async (tx) => { ... });
```
```
    await this.deps.workplace.renameRulesUnderLogicalPrefix(
      workplaceScopeKey(this.scope), oldNormalized, newNormalized);
```

**描述**：仓储自己开事务，service 层**不感知事务上下文**——`WorkplaceService` 接口的
`renameRulesUnderLogicalPrefix` 签名里没有 `tx` 参数（`workplace.port.ts:76-79`）。
按 RULE「实现禁令与坑」那条：事务回调里误用外层 conn 调服务会撞驱动层 AsyncMutex 不可重入
（死锁而非报错）。所以任何将来想把「rename 文件 + 改规则」放进同一事务的调用方，
拿不到 tx，只能二选一：要么死锁，要么先提交 rename 再单独调本方法（失去原子性）。
注释把这条写成了「未来需改」的口头承诺，但接口层面没有留缝——将来改动面是
`WorkplaceRepository` + `WorkplaceService` 两个 port 加所有实现方。

**建议**：现在就把 `tx?: TdbcTransaction` 作为可选末位参数加到
`WorkplaceRepository.renameRulesUnderLogicalPrefix`（有 tx 则复用、无则自开），
`WorkplaceService` 同理。改动是纯增量的，不影响现有调用方。

**置信**：confirmed（接口无 tx 参数）/ 死锁路径本身是 RULE 已记载的既有事实，未复现。

---

### F-w8-pro-8 | P2 | `service/workplace/impl/workplace.service.ts:274-276`（并 `:260-264` 注释）

```
    if (entry.inFlight != null) {
      return entry.inFlight;
    }
```

**描述**：`evaluateCachedView` 先查缓存（`:270`）再挂 inFlight（`:274`）。命中判定用的是
**本次刚采样的** `sigs`，而 `entry.inFlight` 里挂着的 promise 是在**更早的 sigs** 下起算的。
于是：读者 A 起算（sig S1，冷态可能几百 ms~数秒）→ 期间发生写入（状态变 S2）→ 读者 B 采到 S2、
缓存比对 miss、看到 A 的 inFlight 非空 → B 拿到的是 S1 口径的数据，即**比自己采样的签名更旧**。

代码注释（`:262-263`）把这写成「脏结果最多存活一次读取」。按批计数确实成立（A 完成后
`publishWorkplaceView` 写入 S1，下一个读者比对 S2≠S1 即重算），但**按读者计数不成立**：
与 A 重叠的任意多个并发读者都会各自拿到一份 S1 数据，N 个读者 = 脏数据存活 N 次。
本区的 `materializeLiveView` / `materializePersistBlock` / `buildListRows` / `renderDisplay` /
`renderFileTree` / `evaluateRuleView` 六个入口全部共享这一个 inFlight，而 mobile 的
`VfsFileManager` 是切换式全量 reload、desktop 的 `ShellNavProvider` 旁路订阅——
写入与读取重叠是常态而非边界。

**建议**（若要更严）：inFlight 命中时把该 promise 的 sigs 一并返回，调用方比对，
不匹配则不复用而是重算（需要 entry 上存一份 `inFlightSigs`）；或在
`publishWorkplaceView` 里对「计算期间 sigs 已变」的情况不发布（当前是照发，靠下个读者自愈）。

**置信**：intentional（注释明示的设计取舍，发布/读取都以「计算前采样的 sigs」为准是刻意为之）。
**记为 P2 是因为「最多存活一次」这句话在并发读者下的实际语义与字面不符，建议改注释而不是改行为。**

---

### F-w8-pro-9 | P3 | `service/workplace/impl/workplace.service.ts:354` vs `:369`

```
    const fileSet = new Set(fileMeta.map((row) => normalizePath(row.path)));
    ...
    for (const row of fileMeta) {
      mtimeByPath.set(row.path, row.mtimeMs);
    }
```

**描述**：同一个 `fileMeta` 数组，**路径集合规范化了、mtime 映射没规范化**。
`dirMtimeByPath`（`:380-385`）有同样的不对称（`dirPathSet` 规范化、`dirMtimeByPath` 用原始
`row.path`）。消费端全部按规范化后的 key 查：
`workplace-rule-engine.ts:90`（`ctx.mtimeByPath.get(p)`，`p` 来自 `ctx.fileSet`）、
`workplace-materialize-engine.ts:42`、`workplace-file-tree.ts:83`。

一旦库里存在非规范形态的 `vfs_entry.path`（`normalizePath` 会把 `\` 转 `/`、折叠 `//`、
消解 `.`/`..`，见 `normalize-path.ts:19-45`；历史行或非 VFS 写入方都可能留下这类值），
查表静默 miss → mtime 取 `?? 0` → `created`/`updated` 排序退化成「全 0 相对」，
`<file createdAt/updatedAt>` 渲染成 1970。**无报错、无告警**。

**建议**：`mtimeByPath.set(normalizePath(row.path), row.mtimeMs)`，与 `fileSet`/`dirPathSet`
口径统一（一次 normalize 换一次字符串分配，可忽略）。

**置信**：suspected（依赖「库中是否存在非规范 path」这一前提，未查真库；但不对称本身 confirmed）。

---

### F-w8-pro-10 | P3 | `domain/workplace/logic/diff-workplace-paths.ts:45`

**描述**：整个文件（`diffWorkplacePaths` + `isWorkplacePathLoadedInCache` + `WorkplaceLivePath`）
在生产代码里**零消费方**。全仓（`packages/core/src`、`packages/cli/src`、`apps/mobile/src`、
`apps/desktop/src|renderer`）只有两处命中：`public/workplace.ts:82-85` 的 re-export，和
`packages/core/test/workplace/diff-workplace-paths.test.ts` 的测试。

**建议**：删文件 + 删 `public/workplace.ts:81-85` 的导出块（测试一并删）。若判断是「chip 侧
重构后忘了接回来」，则反过来先接回消费方——但从 `apps/*/src` 全无 `listKeys(file_cache)` 调用看，
chip 侧已经改走 composer status 通知链了，这条路大概率不会再接。

**置信**：confirmed（逐目录 grep 实测，见「依赖关系」节）。

---

### F-w8-pro-11 | P3 | `domain/workplace/logic/workplace-file-tree.ts:126`

**描述**：`renderWorkplaceFileTree`（无 display 后缀的变体）与生产使用的
`renderWorkplaceFileTreeForMacro`（`:140`）参数完全相同、只差一个可选 `displayByPath`，
内部 `appendDirLines` 也共用。生产侧只有 Macro 变体一个调用方
（`workplace.service.ts:294`）。`renderWorkplaceFileTree` 只出现在
`public/workplace.ts:46` 的导出和 `test/workplace/workplace-file-tree.test.ts`。

**建议**：删掉或降级为模块内私有（若确有外部需求则保留导出，但至少别在 public 面占位）。

**置信**：confirmed。

---

### F-w8-pro-12 | P3 | `service/workplace/impl/workplace-view-cache.ts:131-136`

```
/** 测试专用：清空全部连接的缓存（不进 public 导出面）。 */
export function clearAllWorkplaceViewCache(): void {
```

**描述**：注释说「测试专用」，但全仓 grep（`packages/core/src`、`packages/core/test`、
三端 app）里**除了它自己的定义行（`:132`）之外零命中**——连测试都没调用。
`test/workplace/workplace-view-cache.test.ts` 用的是 `ensureWorkplaceViewEntry` /
`publishWorkplaceView` / `getCachedWorkplaceView` 三个函数。

**建议**：删函数；若确有「测试需要全局冷缓存」的诉求，应在测试里通过换 conn（WeakMap 以 conn
为 key，换 conn 天然冷）达成，而不是留一个没人用的模块级 API。

**置信**：confirmed。

---

### F-w8-pro-13 | P3 | `domain/workplace/logic/workplace-tree.ts:92`

```
    if (!f.startsWith(prefix) && !(normalized === "/" && f.startsWith("/"))) {
```
**描述**：`normalized === "/"` 时 `prefix` 已被赋值为 `"/"`（`:89`），所以
`normalized === "/" && f.startsWith("/")` 与 `f.startsWith(prefix)` **恒等价**，
第二个合取项在任何输入下都不改变结果。纯死条件。

**建议**：删掉后半段，改成 `if (!f.startsWith(prefix)) continue;`。

**置信**：confirmed（`prefix` 的两个分支在 `:89` 已覆盖）。

---

### F-w8-pro-14 | P3 | `domain/session-kkv/model/session-kkv-domains.ts:103-112`（区外注释，描述区内语义）

```
 * 无叉状态条相关、回滚可按域清空的 kkv 域。
 * - `file_cache` → workplace chip（相对已加载差集）
```
**描述**：这条注释把 `file_cache` 描述成「workplace chip 的已加载差集」，
并据此把它放进 `SESSION_KKV_COMPOSER_STATUS_DOMAINS`（回滚时清）。但 `file_cache` 现在的
实际用途是**常驻前缀的正文缓存**（`assemble-workplace-display.ts:154`、
`load-or-fill-file-cache.ts:48`）——chip 差集那条链路的计算函数
（`diffWorkplacePaths`，见 F-10）已经没有生产消费方了。

后果是一条无谓的失效：回滚（`truncate-tail-in-transaction.ts:94`）会连带清空整个
`file_cache` 域，把常驻前缀缓存也丢掉（本该只在改规则/压缩/置位时清）。
同时 `refreshRuleSnapshot`（`refresh-rule-snapshot.ts:41`）的 `clearDomain(file_cache)`
是整域清，也会把 chip 侧的「已加载」状态一起抹掉——两者本该有各自的失效策略。

**建议**：把 `file_cache` 从 `SESSION_KKV_COMPOSER_STATUS_DOMAINS` 移出（回滚不该清前缀缓存），
并把上面那段注释改成「file_cache → 常驻前缀正文缓存，失效点 = 改规则/压缩/置位/会话删除」
——后者才是 RULE「常驻工作区」条目已经写对的版本。

**置信**：confirmed（注释与代码用途不符）/ suspected（chip 侧是否真已无消费，需 UI 机位交叉确认）。

---

### F-w8-pro-15 | P3 | `domain/workplace/logic/front-matter.ts:16-19`

```
  /** `closed` is kept for signature compatibility but is always `true` after the
   * unclosed-as-no-front-matter change ... New code should not branch on this field. */
  closed: boolean;
```

**描述**：`splitMarkdownFrontMatter` 的三个返回分支（`:30`、`:48`、`:51`）**全部**返回
`closed: true`，`closed` 是个恒真字段。`body` 字段在本文件内也无人读
（`parseMarkdownFrontMatter:61` 只取 `frontMatterLines`），跨文件消费方
`domain/skills/logic/parse-skill-front-matter.ts:38` 需要确认是否读 `body`。

**建议**：按 RULE「退役件」约定，跨文件消费方确认为零后连同 `closed` 一起删，
`MarkdownFrontMatterSplit` 缩成 `{ frontMatterLines, body }`。

**置信**：intentional（注释明确说是为签名兼容保留）/ 建议先核 `parse-skill-front-matter.ts`。

---

### F-w8-pro-16 | P3 | `service/workplace/impl/workplace.service.ts:128-132`

```
    // Any save without explicit --rule off enables rules (do not preserve prior rule_off).
    ruleEnabled: input.ruleEnabled === false ? false : true,
```

**描述**：`setDirRule` 的 `ruleEnabled` 三态语义是「`undefined` = 打开」。按 RULE
「目录规则」条目，规则表单（`DirectoryRuleSheet` / `DirectoryRuleModal`）**只编辑规则内容，
启停由文件管理菜单的快捷开关负责**——那么表单提交若不携带 `ruleEnabled`（或带 `true`），
每存一次内容就会把用户此前显式关掉的目录**静默翻回 rule_on**，且 `listDirRules` 之后的
树上该目录的裁剪行为全变（`headCount`/`tailCount`/`fillPolicy` 立刻生效）。

**建议**：确认双端表单提交时 `ruleEnabled` 的实际取值；若为 `undefined`/`true`，
把表单路径改为「先 `getDirRule` 取现状再原样回传」，或让 `setDirRule` 区分
「未提供」与「显式 true」。

**置信**：suspected（服务侧三态语义 confirmed；是否构成线上缺陷取决于双端表单实际传参，
未读 `DirectoryRuleSheet.tsx` / `DirectoryRuleModal.tsx`）。

---

### F-w8-pro-17 | P3 | `domain/workplace/repositories/impl/sqlite-workplace.repository.ts:267-268`

```
    const base = normalizePath(logicalPrefix);
    const childPattern = `${escaped}/%`;
```

**描述**：`base === "/"` 时 `childPattern` 变成 `"//%"`，而子路径形如 `/a`（单斜杠），
`LIKE '//%'` 匹配不到。于是「删除根前缀下的全部规则」实际只删掉 `logical_path = '/'` 那一行。
`renameRulesUnderLogicalPrefix` 同理：`oldBase = "/"` 时
`substr(logical_path, length('/') + 1)` = `substr(path, 2)`，只剥掉**一个**斜杠，
拼出来是 `newBase || 'a/b'`（缺斜杠）。

**建议**：要么在 service 层显式拒绝 `"/"` 作为前缀（`deleteRulesUnderLogicalPrefix` /
`renameRulesUnderLogicalPrefix` 传根时应当走 `deleteScope` / 无意义），
要么在仓储里对 `base === "/"` 特判（子模式用 `"/%"`、rename 直接无意义报错）。

**置信**：suspected（未查到有调用方以 `"/"` 调用这两处；结构性缺陷 confirmed）。

---

### F-w8-pro-18 | P3 | `domain/workplace/logic/smart-sort.ts:290-292`

```
    // A `g`-flagged regex keeps lastIndex across execs; always match from 0.
    rule.regex.lastIndex = 0;
    const match = rule.regex.exec(basename);
```

**描述**：`CompiledSmartSortRule.regex` 是**共享可变对象**——L1 视图缓存把
`ctx.smartRules` 连同这批 RegExp 实例缓存下来（`workplace-view-cache.ts:96-98`），
`sortFilesForDir` / `sortDirPaths` 每次比较都通过 `compareSmartBasenames` → `cache.get` 复用
（已提取的 key，不会重跑 `extractSortKey`），但每次**缓存 miss** 的 basename 都会走
`extractSortKeyDetail` 并写 `regex.lastIndex`。目前全同步、无 await 点交错，所以不出竞态；
但这是一个「跨调用共享的 RegExp 实例被就地改写」的隐性约束，将来若把提取阶段改成异步
（或把 smart 规则缓存提到 worker/多路复用），就会变成真竞态。

**建议**：要么在编译期禁掉 `g` flag（`/g` 在这里没有语义价值——每次都从 0 重置），
要么 `new RegExp` 每处新实例。加一条注释说明「编译期必须剥离 g/y flag」。

**置信**：confirmed（无 flag 校验的代码路径可见）/ 影响为潜在，非当前缺陷。

---

### F-w8-pro-19 | P3 | `service/workplace/assemble-workplace-display.ts:153` + `:171`

```
  const cacheKeys = entries.map((entry) => fileCacheKey(entry.status, entry.path));
```
```
    const raw = prefetched.get(fileCacheKey(entry.status, entry.path));
```

**描述**：`fileCacheKey` 对每个 entry 算两次（两次模板字符串拼接 + 一次对象分配）。
`entries` 几十~几百条时是可忽略的量，但与下面 F-20 属同类：这条链路的单文件处理逻辑
在 `prepare-user-messages-for-prompt.ts:199`（单键 `loadOrFillFileCache`）与
`assemble-workplaceDisplay`（批量 `getMany`）之间**分叉成两份平行实现**——批量侧自己写了
「解析缓存 → miss 则 `fillFileCacheFromVfs`」的循环，而 `fillFileCacheFromVfs` 本身是
两者的公共半段（注释 `:130` 自称「loadOrFill 与 assemble 批量预取共用」），实际只有**后一半**共用，
前半段（查缓存）被复制了一遍。复制的那份还多做了 `parseFileCachePayload` 失败的处理，
与 `loadOrFillFileCache:51-56` 语义一致但代码不同源。

**建议**：`getMany` 版本改成 `cacheKeys` 与 `entries` 同序后用索引配对（`prefetched` 的 key
就是 `fileCacheKey`，Map 查询本身 O(1)，真正省的是重复计算 key）；
更大的整理是把「批量版 loadOrFill」抽成 `loadOrFillFileCacheMany` 放到
`load-or-fill-file-cache.ts` 内，让两条路径共用同一份解析/降级/回填逻辑。

**置信**：confirmed（重复实现可从两处引文直接对读）。

---

### F-w8-pro-20 | P3 | `domain/workplace/logic/workplace-path-map.ts:12-21`

```
export function mapProjectWorkplacePathToSession(logical: string): string {
  return normalizePath(logical);
}
```

**描述**：根路径统一后，这两个「project ↔ session 路径映射」退化成 `normalizePath` 的别名，
两处调用方（`service/template/logic/initialize-session-workspace.ts:52`、
`push-session-workspace.ts:46`）传给 `copyScope` 的 `mapLogicalPath` 也是这个身份函数。
`copyScope` 的映射回调形参（`workplace.port.ts:57`）目前没有任何非身份实现。

**建议**：保留（语义占位、未来若恢复多根会重新需要），但 `copyScope` 的
`mapLogicalPath` 参数可以标 `@deprecated` 或加注释说明「当前恒等，保留是为 scope 路径映射
复原预留」——现在这个签名会让人以为存在真实的跨 scope 路径变换。

**置信**：intentional（文件头注释已写 "identity after unified root"）。

---

### F-w8-pro-21 | P3 | `domain/workplace/logic/workplace-display.ts:78-84`

```
  const attrs = [
    `path="${escapeXmlAttr(params.logicalPath)}"`,
    `createdAt="${escapeXmlAttr(mtimeLocal)}"`,
    `updatedAt="${escapeXmlAttr(mtimeLocal)}"`,
```
**描述**：`createdAt` 与 `updatedAt` 填的是同一个值（`mtimeMs` 的本地化），`createdAt` 名不副实。
这是 `VfsEntryRepository` 只暴露 `mtimeMs` 的必然结果（`sqlite-vfs-entry.repository.ts:626-629`
只 SELECT `path, mtime_ms`），不是本区能单独修的。

**建议**：要么把 `createdAt` 属性从输出里去掉（减少一个骗模型的字段），
要么在 `vfs_entry` 侧补 `created_ms` 并透传。建议先确认模型是否在用 `createdAt`——
若无人读，删字段比补数据便宜。

**置信**：confirmed（代码）/ suspected（是否有下游读 `createdAt`，未查）。

---

### F-w8-pro-22 | P3 | `domain/workplace/logic/load-or-fill-file-cache.ts:190-205`

```
  if (size.kind === "inlineChars") {
    if (size.size > CHARACTER_CARD_MAX_SINGLE_FILE_BYTES) { ... }
```
```
  if (size.size > CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES) {
    return { body: `（文件过大，已跳过，约 ${size.size * 4} 字符）`, ... };
```

**描述**：两处单位口径不齐——`CHARACTER_CARD_MAX_SINGLE_FILE_BYTES` 是**字节**上限，
却拿**字符数**去比（注释自称「近似闸门，字符数 ≥ 字节数场景已足够」；实际上字符数 ≤ 字节数
对 ASCII 成立、对中文 UTF-8 成立但反向——1 个汉字 3 字节，所以中文文件按字符数比会**放行**
约 3 倍于阈值的字节量）；压缩侧用 `× 4` 折算明文长度，而 RULE「实现禁令与坑」明确记载
`vfs_content_blob.byte_len` 存量写法三态混杂（base64 文本长度 / 二进制长度 / 二进制长度−2），
`× 4` 的基数不可靠。

这两个闸门是 huge-card-import-crash 崩溃循环的止血阀，方向是保守（宁可多占位），
所以不是缺陷；但「约 N 字符」这个数字会随存储形态漂移，可能给模型一个明显偏小的规模估计。

**建议**：把折算基数从 `findContentSize` 的 `kind` 显式派生（`inlineChars` 用 ×1、
`contentBytes` 用真实 encoding 换算），或干脆把占位文案改成不含具体数字
（「（文件过大，已跳过）」），避免向模型播报一个自己都算不准的量。

**置信**：suspected（`findContentSize` 的返回契约在 vfs 域，未读其实现）。

---

## 争议与存疑

1. **F-1（中止后回填队列继续跑）我给的是 suspected 而非 confirmed。** 逻辑链每一段都有代码和注释
   自证，但我没有在真机上测「用户按停止后仍卡 N 百毫秒」。反驳我的一方可以主张：
   `deferBackfillWrite` 的收益（把压缩移出关键路径）远大于中止后这一小段尾巴，且
   压缩本来就迟早要跑。**这条需要 UI/性能机位或真机实测裁决**，不要按我的定级直接立项。

2. **F-2 里「重复排序」我判 confirmed、「O(D×N) 的实际代价」判 suspected。** 重复部分是纯静态
   可证的；但 RULE 记载的历史事故（556 文件分钟级）发生在旧实现上，我**没有**实测
   新渲染器的绝对耗时。若实测量级可接受，F-2 应降为 P3 纯整洁性项。

3. **F-3 提的 `smartRuleRows` 提前门闩会改变失效语义**——若「没有任何目录规则用 smart 排序时，
   改智能规则不刷新树」这个行为变化不可接受，F-3 就只剩前半段（重复读表）。
   这是产品判断不是技术判断，交主代理裁决。

4. **F-14 需要 UI 机位交叉确认。** 我的证据是「`diffWorkplacePaths` 全仓无生产消费方」，
   但如果 chip 的「已加载差集」是在别的仓/别的形态下算的（比如直接读消息表），那这条只剩
   「注释过时 + 回滚无谓清缓存」两分，不构成一致性缺陷。

5. **`workplace-scope.ts:30` 的 `workplaceRootLogicalPath(_scope)` 与
   `workplace-file-tree.ts:58-66` 的 `workplaceFileTreeRootLabel` 是同一段死代码的两次投影**：
   根恒为 `"/"`，所以 `workplaceFileTreeRootLabel` 的 `base.length > 0 ? base : "/"` 分支
   永远走不到非 `"/"` 的路径，`renderWorkplaceFileTree` / `…ForMacro` 里的
   `rootLabel === "/" ? "/" : …` 三元（`:131`、`:145`）同理恒取第一支。
   我没单独立条（无行为影响），但它是「多根时代」退役后的残留簇，
   与 F-20 同源，建议同一轮一起清。

6. **未覆盖**：`apps/desktop/src/main/ipc/handlers/workplace.ts:143-155` 的
   `handleWorkplaceCaptureSessionBlock` 注释自称「已退役…UI 入口将在 Step 9 删除」，
   但 `invoke-registry.ts:251` 仍注册着它。这属 desktop 域，我只标记不判。
