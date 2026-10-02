# 全项目 CR 终局台账 v2 · repo-mega-cr-2026-10

> **对 `fe79b781` 的权威终局台账。** v1（`ledger.md`，基线 `9ca5f5ad`）已并入本文件，不再单独引用。
> 本文件的输入 = v1 台账 + `synth/revalidate-{a,b}.md`（对 v1.5.29 的重验）+ `synth/delta-overview.md`
> + W8/W9/W10 共 62 份 raw 报告（25 + 32 + 5）。
>
> **口径冲突时的优先级**：本文件 > revalidate 报告 > delta-overview > 簇台账（synth/*.md）> raw 报告。
> **本文件仍不裁决的地方，单列成节，把双方论据原样留着**（当前只有 §8 的 RT-01 一处）。
>
> 基线：`main@fe79b781`（v1.5.29）｜worktree `D:\Dev\nm-worktree\mcr`｜拼装日期 2026-10-01
> 纪律：只读。零 git 写、零 `docs/apm/` 写、零生产代码改动。

---

## 0 · 全局统计

### 0.1 三段口径（v1 → v2）

| 阶段 | 口径 | 数量 |
|---|---|---:|
| ① 原始发现 | raw 报告自报条目 | **≥ 1 100**（W1–W7 的 ≥574 + W8 约 210 + W9 约 300 + W10 约 40） |
| ② 归并后 | 8 份簇台账 + 8 份验证报告去重 | 359（v1 终局，未变） |
| ③ 本波新增 | W8/W9/W10 的 P0/P1，经对抗裁决与抽样复核后入账 | **P0 +3 / P1 +7 / P2 +5**（另有 6 条旧条印证强度升级，不计新条） |
| ④ v2 终局 | 应用全部 revalidate verdict + W8/W9/W10 新发现 + 跨波去重 | **P0 5 / P1 39 / P2 155 / P3 174**（合计 373） |

> P1 的 +7 = N-P1-01（project 删除泄漏）、N-P1-02（layout 白名单漏字段）、N-P1-03（死路由参数）、
> N-P1-04（定时器闭包丢最后一次输入）、N-P1-05（渲染层零类型门禁）、N-P1-06 + N-P1-07（smart-sort 多语句无事务）。
> 「待验证」节另有 **10 条单源 P0/P1**（§6，其中 2 条已按 §2.10 归并掉），不计入上表。

### 0.2 定级分布变动明细

| 级别 | v1 | 变动 | v2 | 变动来源 |
|---|---:|---|---:|---|
| **P0** | 3 | +2 | **5** | W8/W9 未出任何新 P0；+2 = N-P0-02（desktop Windows 假绿）、N-P0-03（CLI 开不了第一个会话）。**N-P0-01（WebView bundle 顶层 `Object.fromEntries`）也是本波新增，但它是 v2 §1 的第三条新增——v1 终局 P0 仍只有 S-CS-01 / RT-02 两条在位，RT-01 因争议出池（见 §8），故净 +2** |
| **P1** | 32 | +7 | **39** | 新入账 7 条（N-P1-01~07）；RT-01 因 §8 争议**暂不计入 P1 也不计入 P2**（留在争议节）；`AgentDefinitionEditorForm` 与 `skill-ui` 两条跨簇重复归并到已有条目 |
| **P2** | 150 | +5 | **155** | 新增 5 条（w8-prompt-pro-1 降 P2、w8-mobileweb-pro-02 降 P2、`AgentDefinitionEditorForm` 降 P2、w8-prompt-adv 让步 F-1 独立成条、apps-desktop invoke-registry 125 处 unknown 降 P2）；RT-03 因对象已删转 stale 出池（−1）；RT-01 若采 A 台则 +1 |
| **P3** | 174 | −0 | **174** | W8/W9 的 P3 已全部落在 v1 的簇内，无跨簇新面孔 |

### 0.3 revalidate 应用明细（34 条台账条目）

`revalidate-a` 覆盖 P0 3 + cloudsync P1 7 + core-storage P1 11 = 21 条；`revalidate-b` 覆盖其余 13 条。
合计 **34 条：valid 33 / partial 1（RT-01）/ fixed 0 / stale 0（台账口径内）/ 移出 3 条**。

| verdict | 条数 | ID | 处理 |
|---|---:|---|---|
| **valid**（病灶原样在位） | 33 | S-CS-01/02/03/04/07/08/09/16（cloudsync 7）、CS-01~CS-11（11）、RT-02、RT-04、RT-08、M-01、M-03、M-04、CD-01、AM-1、AM-3、S-D-02、S-D-04、B、E | 保留并改述（行号刷新 + 措辞随 v1.5.29 更新） |
| **partial** | 1 | RT-01 | 拆两条：①「含 hidden」已修（`e2d10b3f`）②「可见集全列 + 无 memo」仍在。**定级争议见 §8** |
| **移出台账池** | 3 | RT-03、CD-10、CD-34 | 不是「修好了」，是**对象没了**——见 §9 附录 |

### 0.4 验证层推翻的具体主张（后续不得再当依据）

v1 §0.3 的六条全部继续有效。W10 delta 波**新增四条**：

1. **RT-03 的测量载体没了**——`messageContentPool` 整层删除（`decoded-content-cache.ts:169-217`），
   `message-content-perf-threshold.test.ts` 已改口径为「测明文化对稳态读是纯收益」，**不再测命中率**。
   ⇒ 拍板项 #6 与 Wave C 的「缓存池预算」两条同时失去对象，须重拍（见 §7 #16）。
2. **CD-10 的病因消失、症状换形**——LRU 没了，不再有「冲掉别的读口热态」；主导成本从 `inflate` 变成
   `JSON.parse`（5350 行库一次搜索 = 5350 次 parse），已加 LIKE 粗筛部分处理（纯 ASCII keyword）。
3. **CD-34 的前提消失**——两个读分支都不进任何池，形态差异不复存在。
4. **CD-02 的诉求方向反转**——`truncateAfter` 改用 `listBySessionFromSeq` 拉**带正文**的 tail
   （因为 read 引用收集需要 `content`），迁移期压缩行会因此被解压；TOCTOU 本身**未修**
   （`message.service.ts:512` 仍在 `:522` 的 `conn.transaction` 之前）。

**另有一条台账决策被本波推翻**（delta-overview §4.3）：
**「`searchMessages` 不用 LIKE 粗筛」这条 RULE 拍板被 v1.5.29 翻成「有条件做」**。
RULE 现行口径已改写为「纯 ASCII keyword 走 parse 前 LIKE 粗筛命中才 parse」。⇒ 须在台账层拍一次，
否则 `synth/core-data.md:93` 与 RULE 会长期互相矛盾（见 §7 #17）。

---

## 1 · P0 终表（5 条）

印证强度缩写：**封印** = 主代理实跑/逐字封存；**多源** = ≥2 份独立报告撞车；**复核** = W11 本轮在
`fe79b781` 抽样复核成立；**实跑** = 用真实驱动/产物跑出观测。

| ID | 簇 | 病症 | 位置 | 印证强度 | 一句话修法 |
|---|---|---|---|---|---|
| **S-CS-01** | cloudsync | pull 成功后的 rev 记账写进一条**已被 pull 自己关掉**的连接，必抛 `CONNECTION_CLOSED`；库文件已换但 UI 记成失败，rev 永不推进 → 反复拉同一 rev | `apps/desktop/src/main/services/cloud-sync.service.ts:255-256`（记账仍紧跟 `:252` 的 `coordinator.pull`）；死句柄来自 `:159-164` 构造期 `createCloudSyncConfigStore(runtime.kkv, runtime.secretStore)`；`apps/desktop/src/main/services/db-backup.service.ts:115` `closeLiveDbForBackupImport()`；mobile `apps/mobile/src/services/cloud-sync.service.ts:341`（`:346` 才 `onRebootstrap`） | **最强**：对抗对双方独立收敛到同一条并各给 P0；adv 带真实 better-sqlite3 驱动实测；W5 复核调用链闭合；W6 免验轮内独立撞见三次；**W11 复核：区间内 cloudsync 簇零提交，原样在位** | 记账移到 `rebootstrapDesktopRuntime()` / `onRebootstrap()` **之后**，用重建后的 runtime 重新取 configStore；或让 `importDatabaseBackupFrom*` 返回「连接已换代」信号。两端同改 |
| **RT-02** | core-runtime | runner 每 step **两次**独立全会话读：`:413` 自己 `session.list()`，`:519` 的 `shouldRequestCompaction` 经 `VisibleFloorTrigger` 再读一次，两次读互不共享 | `packages/core/src/service/agent/impl/agent-runner.ts:413` + `:519` → `domain/compaction-conditions/triggers/visible-floor.trigger.ts:21` | **多源 + 复核**：w3-xc-fullread-2 + w2-core-service-agent + 主代理逐字封印；**W11 逐行打印 `fe79b781` 现行代码确认 `:411 stepCompactionEmitted` / `:413 session.list()` / `:519 shouldRequestCompaction(this.deps.session, …)` 三处全在位，行号相对 v1 的 `:405/:506` 整体下移** | 把 `:519` 换成复用 `:413` 已拿到的 `visible.length`（触发器入参改传条数）——零新增接口、零语义风险、立刻减半。**注意 v1.5.29 后两次读都走 `includeHidden:false`，单次成本已降，但读次数未变** |
| **N-P0-01** | apps-mobile（构建链） | **composer-input WebView bundle 在 IIFE 顶层调 `Object.fromEntries`**（为拿 3 个宏白名单常量而拖进 core provider 整表）；`Object.fromEntries` 是 Chrome 73+，`minSdkVersion=26`（Chromium 58）。WebView < 73 上顶层直接抛 `TypeError` ⇒ 编辑器不挂载、ready 不上报、宿主等不到握手 ⇒ **chat 内联输入框白屏级无响应（不是降级）** | `apps/mobile/webview-dist/composer-input/app.js:164-168`（源：`apps/mobile/src/components/agent/prompt-macro-input.ts:1`）；**W11 复核：`fe79b781` 的 bundle 里 `Object.fromEntries` 首个命中在 index=4907，早于 `mountComposerEditor`/`post('ready')`** | **W11 复核**（产物实测 + 位置实测 + 源码链实测）+ pro 报告 confirmed。**单源**，辩护方（w8-mobileweb-adv）未列此条——它只审源码面、不审产物 | `prompt-macro-input.ts` 的 `ALLOWED_DYNAMIC_ROOT_MACROS` 改从深层路径直引，或把三个字符串内联（白名单本身只有 3 项）；顺带给 `build-webview.mjs` 加门禁：bundle 里出现 `Object.fromEntries`/`replaceAll`/`.at(`/`Object.hasOwn` 即 fail |
| **N-P0-02** | apps-desktop（测试基础设施） | **`npm test` 在 Windows 上收集 0 条用例并输出假绿**：`run-tests.mjs:30` 的 `testTargets` 用**单引号**包住三个 glob，而 `:34` 的 `execSync(..., {shell:true})` 在 Windows 走 cmd.exe（不把单引号当引号），`node --test` 收到含字面引号的 pattern ⇒ 匹配 0 个文件；`1..0` 的退出码是 0。**注释「execSync 走 /bin/sh」只在 Linux 成立**，CI 是 ubuntu-latest 所以线上绿 | `apps/desktop/scripts/run-tests.mjs:23-30`（单引号 targets + `/bin/sh` 注释）、`:34`（`shell:true`） | **W11 复核**：W8 报告四组对照实测（单引号 `# tests 0` / 双引号 `# tests 620 # pass 616 # fail 4`）+ `ComSpec` 实测。**单源**（w8-test-desk-cli 是测试语料面唯一一份） | `testTargets` 改双引号（node 侧仍递归展开，语义不变）+ 子进程退出码 0 而收集数为 0 时 `process.exit(1)`；`:23-26` 注释改成「Linux 与 Windows shell 引号语义不同」的中性表述 |
| **N-P0-03** | apps-cli / apps-desktop（测试语料） | **`apps/cli` 26/102 条测试永久红灯，且仓库自己把它记成「环境问题」**。W9 复现并给出**两条各自独立的真实缺陷**（推翻旧判断）：① `nm session create` 在全新库上必然失败（registry 只读 DB 不含虚拟 `general`，而 CLI 无任何创建 agent 的命令）⇒ **全新机器上 `nm` 开不了第一个会话**；② `[nm-boot]` 迁移日志打到 stdout，破坏「stdout 只输出机器可读值」契约（实测 12 行污染） | `apps/cli/package.json:17`（`"test": "tsx --test test/**/*.test.ts"`）+ 全部 22 个 CLI e2e 用例；根因链 `apps/cli/src/session/commands.ts:67` → `packages/core/src/service/chat/impl/session.service.ts:105-113` → `packages/core/src/service/agent/logic/agent-run-shared.ts:64-71` → `agent-registry.service.ts:64-66`（vs `:75` 的 `list()` 才追加 `general`） | **多源**：w8-test-desk-cli F-w8-11（W8）↔ w9-cliperiph-adv F-w9-adv-1 + 让步 S-1/S-2/S-3（W9，两个独立机位各自实跑复现），且 W9 明确「与 `memory/20260906-…:23` 的旧判断相反，做了确定性复现」 | 给 CLI 加 agent 创建入口（或让 `listAgentIds()` 对齐 `list()` 的 `general` 语义）；迁移日志改走 stderr；26 条红灯逐条归因——**这条同时是「测试语料不可信」的根**，Wave A 的「typecheck 转 blocking」依赖它先落地 |

> **v1 的三条 P0 全部仍 valid**。RT-01 已不是 P0（争议见 §8）；S-CS-01 与 RT-02 原样在位。

---

## 2 · P1 终表（39 条）

### 2.1 印证强度口径（沿用 v1，补充 v2 用法）

**封印** = 主代理实跑/逐字封存｜**多源** = ≥2 份独立报告撞车｜**对抗** = pro/adv 对抗对双签｜
**复核** = W11 在 `fe79b781` 抽样逐行核过｜**实跑** = 真实驱动/真实产物跑出观测｜**读码** = 单源但机理闭合。
v2 新增标注 **⭐** 表示「本波新增且已入账」，标注 **〔待〕** 表示「单源，挂在 §6 待验证节」。

### 2.2 core-runtime（2 条）

| ID | 位置 | 印证强度 | 一句话修法 | 量 |
|---|---|---|---|---|
| **RT-04** | `domain/agent/model/agent-definition.schema.ts:221-229` + `logic/validate-agent-definition.ts:73-89` | 封印（三步实锤）+ 多源 + W6 读码 + **revalidate-b valid** | `definitionToDocument` 序列化前先 `validateAgentPromptLayout(def.prompts)`；第二份同款循环在 `domain/chat/model/project-agent-config.schema.ts:29-36` 的 `configToWire` | S |
| **RT-08** | `service/template/impl/template-pull.service.ts:24-36` | 封印 + 跨簇撞车（w3-xc-cache-lifecycle-1 × w2-core-service-vfs P1-1）+ W6 六条里最实 + **revalidate-a/b 双 valid** + **⭐ W9 三源再撞**（w9-servicevfs-pro-1 / w9-ds2-servicevfs-a-1 / w9-ds2-servicevfs-b-1 各自独立命中同一处） | 事务提交后、`runDeferredBlobGc` 旁调 `clearSessionPromptCaches(sessionId, kkv)` | S |

> RT-08 的危害在 W9 三源里被进一步坐实：拉取**整树覆盖 + 规则覆盖**，而 `file_cache` 读口**不做 mtime 校验**、`replaceVfsSubtree` **保留源 mtime** ⇒ 「同路径内容变、mtime 同」的常见场景下陈旧正文原样续命。
> **四源印证**（v1 的两源 + W9 两源）——这是全台 P1 里印证最强的一条。

### 2.3 core-data（1 条）

| ID | 位置 | 印证强度 | 一句话修法 | 量 |
|---|---|---|---|---|
| **CD-01**（含争议 D-6） | `service/message-checkpoint/impl/message-rollback.service.ts:144-264,203-216,399,562-565`；`logic/resolve-reconcile-paths.ts:42,90-93`；`logic/restore-path.ts:145-149` | 4 源印证 + 对抗 upheld + W6 confirmed + **revalidate-b valid（四步一步未落）** | W6 重排四步：① rewind 空树护栏 → ② 文件维度指纹乐观锁 → ③ 删集合事务内重算 → ④ tailIds 断言 | L |

> **W9 补充的零覆盖证据**：revalidate-b 实测 `rollback-empty-target-guard.test.ts` 现已扩到 3 条用例（T-DS2a/b/c），但**三条全是 `undo_send` 路径**，rewind + `targetTree` 为空的组合依旧零断言。

### 2.4 core-storage（12 条，含 1 条新增）

| ID | 位置 | 印证强度 | 一句话修法 | 量 |
|---|---|---|---|---|
| **CS-01** | `domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:935-938` | 多源（w2 实测复现 + pro 推理）+ W6 + **revalidate-a valid（`:935-938` 一字未改）** | 把 `SET path = REPLACE(path, …)` 换成 `substr` 拼接（`#{newWithSlash} \|\| substr(path, length(#{oldWithSlash})+1)`），补「子树含同名目录」回归 | S |
| **CS-02** | `domain/vfs/logic/compute-replace-result.ts:53-60`；`domain/tool/builtin/vfs-tools.ts:339-343`；`skill-tool.ts:341` | W6 实跑 + **revalidate-a valid**（行号从 `:55-60`→`:53-60`，入口数修正为 2 仍成立） | 入口 `oldString.length === 0` 直接抛 `vfsReplaceNotFound`；两条 zod 补 `.min(1)` | S |
| **CS-03** | `domain/vfs/logic/longest-common-substring.ts:140-142,164`；`compute-replace-not-found-error.ts:55` | 多源 + W6 实跑（689MB / RangeError / spread 上限 ≈2×10⁵）+ **revalidate-a valid，** ⚠️ **行号整体下移约 +88**（文件头部注释扩充） | DP 换滚动两行 + `Math.min(...arr)` 换循环 + 超阈值降级 | M |
| **CS-04** | `domain/vfs/logic/vfs-tree-copy.ts:397-410` | 代码已核 + W6（受害调用方 3→**5**）+ **revalidate-a valid** | 把 `deleteUnreferencedUnderScope` 挪到 `deleteVfsPrefix` **之前** | S |
| **CS-05** | `service/vfs/impl/vfs-zip-io.service.ts:199-244`；`character-card-import.service.ts:140-182`；`vfs-batch-io.service.ts:351-367` | 3 站点归并 + W6（**batch-ingest 无条数/体积闸门**）+ **revalidate-a valid（batch 路径行号 `:291-305`→`:351-367`）** | 分片提交（每 200 文件一短事务）+ delete-prefix 单独先行 + backfill 移出事务 | L |
| **CS-06** | `vfs-batch-io.service.ts:167-185`；`apps/desktop/src/main/services/vfs-batch.service.ts:210-226` | W6 读码 + **revalidate-a valid（`:167-185` 确认 + `:183-184` 注释仍自述该权衡）** | `writeOrUpdateFile` 改走 `RevisionAwareVfsService` / `insertFileSeedingRevision` | M |
| **CS-07** | `bootstrap/vfs/vfs-revision-schema.ts:44-54` | W6 + **revalidate-a valid（DELETE 触发器确认无 `AND NOT EXISTS`）** | DELETE 触发器加 `AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = OLD.content_hash)` | S（**须在 CS-06 之后**） |
| **CS-08** | `vfs-batch-io.service.ts:399-406`（对比 `:412`/`:426` 的 `exportRelativePath`） | W6 读码 + **revalidate-a valid** | 文件分支改用 `exportRelativePath(...)`；顺带给 `BatchExportPlan` 加 `skipped` 通道 | S |
| **CS-09** | `domain/vfs/logic/vfs-zip-central-dir.ts:188-243` + `:85-115`；`vfs-zip-io.service.ts:189-192`；`domain/skills/logic/preview-skill-zip.ts:35` | W6 confirmed + **revalidate-a valid（逐行确认 `totalEntries`/`uncompressedSize` 都不累加，闸门全在解析之后的 `vfs-zip-validate.ts:196-207`）** + **⭐ W8 三源独立撞车**：w8-skills-pro-1（pro）、w8-skills-adv 让步 A1（adv，独立给出同款 file:line）、w8-provider 外的 w8-prompt 域无此项 | 解析器内累加体积/条数，越 `VFS_ZIP_MAX_*` 即抛 `PAYLOAD_TOO_LARGE`；技能预检同款 | M |
| **CS-10** | `infra/sql-template/parser.ts:45-55`（真凶 `sqlite-message-checkpoint.repository.ts:112-130,366-386,390-400`） | W6 adjusted（泄漏面收窄到 checkpoint 三方法）+ **revalidate-a valid（三方法确认零分片）+ ⭐ W9 双源撞车**：w9-infrasql-pro-1（pro 逐条核对 17 处 `${...}` 拼 IN，认定只有 checkpoint 三处完全不分片）、w9-checkpoint-adv 让步 F-15（adv 独立指出同文件另一路径按 900 变量上限分块、这两个 IN 查询没有 → 老版 SQLite 的 999 上限会直接报错） | 先给 checkpoint 仓储三方法补 900 分片封顶 arity，再谈 parser 级 LRU | M |
| **CS-11** | `service/chat/impl/session.service.ts:388`（copy）→ `:396 batchInsert`；`service/chat/impl/message.service.ts:320`（fork）→ `:330` | W6 + **revalidate-a valid（病灶在位）但 ⚠️ 修法前提已被明文化推翻** | **改写后**：`batchInsert` 的分片（`BATCH_PARAM_BUILD_CHUNK=200`）只解决了 SQL 参数个数与峰值内存，**没解决「全量物化正文 + 逐条 `JSON.stringify`」**；且明文化后 `content_blob` 生产恒 NULL ⇒ v1 修法「走 `INSERT...SELECT` 直复 blob 列」**已无对象可复**。改为：copy 走 `listMessageHeadersBySession` + 事务外取 body 段，或让 copy 走 `INSERT ... SELECT` 直复 **`content_json`（明文列）** | M |
| **N-P1-01** ⭐ | `service/chat/impl/project.service.ts:185,188` | **多源**（w8-ds-chatservices-b-1 confirmed，逐段核实 ref_count 种下、两条 GC 路径的 SQL、4 个维护任务零重算）；**W11 复核**：`:187` 确认仍是裸 `deleteVfsPrefix(r.vfs, 'session:${id}:${session.id}', '/')` | 项目删除走裸 `deleteVfsPrefix` 删 project scope 的 VFS entry，**从不调 `decrementLiveRefsUnderScope`**；而 live-head revision 带着 `ref_count=1` 被种下（`:283,290` 的 `seedLiveHeadRevisionsUnderPrefix` 与 `push-session-workspace.ts` 的 `replaceVfsSubtree`）。两条 GC 都选不中（`deleteUnreferencedUnderScope` 的 JOIN 找不到 entry、全局兜底因 `ref_count=1` 也不选）⇒ **每复制一次项目再删除，就永久泄漏一批 `vfs_revision` 行 + 其 blob**。修法：换成现成的 `sweepRevisionsUnderScope`（顺序 = decrement → deleteVfsPrefix → deleteUnreferenced），与 session 侧 `deleteSessionFsData` 同款 | M |

### 2.5 core-misc（6 条，含 3 条新增）

| ID | 位置 | 印证强度 | 一句话修法 | 量 |
|---|---|---|---|---|
| **M-01** | `service/provider/impl/model-request.service.ts:69-104,211-243`（+ `logic/llm-sse-transport.ts:673-682` / `agent-runner.ts:724`） | **三源顶格 + W3 实跑复现** + **⭐ W8 对抗双签**：w8-provider-pro-02（pro 给 P1，逐行走通）+ w8-provider-adv 让步 C-1【P1】（adv 独立列出 `:210-243` / `:81-84` / `:99-102` / `openai.adapter.ts:224-228` / `llm-sse-transport.ts:568-573`+`:673-682` 五个位点）+ revalidate-b valid | 重试判定引入 attempt 级「本次是否已产出」探针：`emitted === true` 时不重试、直接上抛走既有失败收尾链 | M | **合入形态(CR-F18)**: 与 C1/C2/C3a/C3b 同单 commit `4829b8d1`（spec 原要求独立 C3c, OQ2=乙记账） |
| **M-03** | `domain/workplace/logic/load-or-fill-file-cache.ts:142,209-223`；`service/workplace/assemble-workplace-display.ts:175-187` | W6 实跑（真实 sqlite+VFS+assemble，双入口复现）+ **revalidate-b valid**（`:142` 仍绕过 `findContentSize`；`filename` 档与 `(missing)` 档都仍写回 cache）+ **⭐ W8 双源**：w8-workplace-pro F-w8-pro-1（pro，`assemble-workplace-display.ts:167` + `load-or-fill-file-cache.ts:114`，量化 3 文件 6M 字符 hash 127ms + deflate 173ms）+ w8-workplace-adv 让步 C-1【P2】（adv 同一处，独立给出「1970 假时间戳」表述） | 把 `filename` 档并入 `:142` 已有的 `findContentSize` 探测；catch 降级归入「不落 cache」分支 | S | **归属订正(CR-F19)**: 由 core1 提交 `6ffeb5fb` 交付（core2 的 `4829b8d1` 不含; 七要素在 wave-b-core2 §5）, 记账以 6ffeb5fb 为准 |
| **M-04** | `domain/provider/logic/find-saved-model-references.ts:32-93`；`service/provider/impl/provider.service.ts:211-266` | W6 实跑（四条独立探针，含端到端坐实「删服务商静默清空被引用模型」）+ **revalidate-b valid（`chat_session` 仍零扫描、`provider.service.ts` 全函数无 `findSavedModelReferences` 调用）** + **⭐ W8 对抗双签**：w8-provider-pro-01（P1，含「悬空 UUID → 下次发消息在 `assertSavedModelUuid` 报 `INVALID_SAVED_MODEL_ID`，UI 零解释」）+ w8-provider-adv 让步 C-5【P2】（同一缺口，adv 另指出 `deleteSaved` 与 `delete(provider)` 口径不一致） | 守卫补扫 `chat_session`；`delete(provider)` 路径补同一 in-use 拒绝 | M | **合入形态(CR-F18)**: 与 C1/C2/C3a/C3c 同单 commit `4829b8d1`（spec 原要求独立 C3b, OQ2=乙记账） |
| **N-P1-02** ⭐ | `domain/prompt/logic/normalize-agent-prompt-layout.ts:54-74` | **对抗双签**：w8-prompt-pro-2（P1）+ w8-prompt-adv 让步 F-4【P3】（adv 独立把「白名单重建 layout」这条列为独立缺陷，虽给 P3）；**W11 复核**：`fe79b781` 的返回体仍是 `...(layout.system) / ...(persistEnabled) / ...(layoutHasWorkplace) / ...(layoutHasCustomAttach)` + `persist, dynamic`，**`skillsEnabled` 与 `skillsPrefix` 双双不在白名单里** | 唯一生产消费方 `resolveAgentDefinitionFromStorage` 对**域形态**存量定义走这个分支 → `skillsEnabled:false` 的 agent 读回来变**字段缺失** → `resolveAgentToolRegistry:71` 的 `=== false` 判不成立 → **用户已关闭的技能能力静默复活**；`skillsPrefix` 丢失让 `render-prompt.ts:174` 回落到默认前缀语。这是 RULE「白名单完整性」的**第二次**连续漏字段（上上次漏 `customAttach`），Wave E 的 exhaustiveness 断言钩子在此有真实靶子 | S |
| **N-P1-06** ⭐ | `service/smart-sort-rule/impl/smart-sort-rule.service.ts:246-249` | **对抗 upheld**（pro 给 P1，adv 让步 F-2【P2】是同一处 `:246-250` 但只讲「先全量校验后逐条 delete」的撞号防御，未提事务）；**W11 复核**：`fe79b781` 的 `:246-249` 确仍是 `deleteAll()` + `for (…) insert(entity)`，无事务包裹 | `importRules` 是「先清空整表、再逐条插入」的替换式语义（`docs/Iterations/smart-filename-sort/spec.md` D10 明确拍板替换式），但**全程无事务**：service 的 `deps` 只有 `{ rules, builtinSeed }`，**连 `conn` 都没有、结构上开不了事务**；repository 层每个方法都是单条 `executeTemplate`；三端调用方（desktop `smart-sort-rule.ts:171` / mobile `smart-sort-rule-yaml.service.ts:32` / CLI `sort-rule/commands.ts:184`）也都没包。后果：bundle 中任一条 insert 失败 ⇒ 用户已有的**全部**智能排序规则已被 `deleteAll` 抹掉且不回滚 ⇒ 排序静默退化为自然序，**且 desktop 侧会被 `normalizeYamlError` 包成「YAML 无效」把 DB 故障误报成格式错误** | M |
| **N-P1-07** ⭐ | `service/smart-sort-rule/impl/smart-sort-rule.service.ts:253-288`（+ `:132-147`、`:163-170`、`:372-382`） | **对抗 upheld**（pro-03 P1，adv 让步 F-2【P2】覆盖同族） | `resetDefaults` 是「删全部内置行 → 逐条重灌 seed → 显式 renumber」三段式，同样零事务。中途失败 ⇒ 内置规则**永久缺失**（seed 是 `INSERT OR IGNORE` 幂等，只补缺失行，会掩盖问题）。同族还有 `deleteBatch`（先全量校验再逐条 delete）、`setEnabledBatch`（逐条 setEnabled）、`moveRule`/`reorderRules` → `renumber`（逐条 UPDATE sort_order）。**其中 `renumber` 被三处复用，中途失败留下排序号有洞或撞号，而 `listOrdered` 用 `ORDER BY sort_order, rule_id` 决胜、撞号时行为不可预测** | M |

### 2.6 cloudsync（7 条，全部 valid）

| ID | 位置 | 印证强度 | 一句话修法 | 量 |
|---|---|---|---|---|
| **S-CS-02** | `apps/desktop/src/main/services/cloud-sync.service.ts:432-443`（模块级 `let service`，**全仓 grep 零 `invalidateCloudSyncService`**）、`:159-164`、`:378` | 封印 + W6 adjusted（第二个死句柄 `dbSync`）+ **revalidate-a valid**（逐点复核） | 拆出生产版 `invalidateCloudSyncService()` 挂进 `rebootstrapDesktopRuntime()` | S |
| **S-CS-03** | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:143-182` | W6 adjusted（桌面 pull↔push 已被 `syncBusy` 挡住）+ **revalidate-a valid** + **⭐ W9 独立撞车**：w9-inframisc-pro-02（P1，逐层核对 `pull()` 全程不查 `dbSync.isAgentActive()`，而 `push()` 查两次 `:219`/`:267`、`DbSyncPort` 把 `isAgentActive` 定为端口成员、两端 app 的 pull 路径同样只有 `syncBusy`/`configured` 守卫） | pull 与 push 共用互斥；`pull()` 入口与 `importSnapshotFromPath` 之前各复检一次 `isAgentActive()`（`AGENT_ACTIVE` 错误码已定义、当前只被 push 用） | M |
| **S-CS-04**（≡ AM-2） | `apps/mobile/src/services/cloud-sync.service.ts:317,332-338` | 5 处独立撞车 + W6 confirmed-by-construction + **revalidate-a valid（结构体逐字吻合）** | `createCoordinator` 移进 `try`；补「注入抛错 → `isMobileDbMaintenanceBusy()` 回 false」单测 | S |
| **S-CS-07** | `apps/desktop/src/main/services/db-backup.service.ts:114,125,128` | W6 confirmed（**本簇唯一不可逆本地数据丢失面**）+ **revalidate-a valid** | 桌面备份/回滚/删 bak 三处 `.catch(() => undefined)` 不得吞；回滚前必须确认可回滚副本在位 | M |
| **S-CS-08** | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:225-228` ⚠️ **路径已改**（原记 `src/impl/`） | W6 confirmed + **revalidate-a valid（`putFile` 逐字未改，仅打包布局变化）** | 去掉 `new Uint8Array(raw)` 这次多余拷贝 | S |
| **S-CS-09** | `cloud-sync-coordinator.ts:297-304`（`:249 nextRev` 仍是首次读到的值） | W6 confirmed + **revalidate-a valid（一字未改）** | 条件写失败后不得用只含 etag 的重读结果无条件覆盖 rev | M |
| **S-CS-16** | desktop `cloud-sync.service.ts:255-256` → handler `cloud-sync.ts:88-91`；mobile `:341` → `:346` | W6 confirmed + **revalidate-a valid（令牌边界正确且是刻意设计）** | 记账移到 rebootstrap 之后——**与 P0 S-CS-01 同一修法，合并成一个 PR** | M |

### 2.7 apps-mobile（3 条，含 1 条新增）

| ID | 位置 | 印证强度 | 一句话修法 | 量 |
|---|---|---|---|---|
| **AM-1** | `services/session-stream-unit-manager.service.ts:717-741`（`forgetSession` **全 `apps/mobile/src` grep 只命中自身定义与注释**）；`screens/tabs/chat-tab/useChatTabScope.ts:521-541,564-589,591-610` | 5 处独立撞车 + W6 行号抽查 + **revalidate-b valid（行号完全未漂；三张 Map 仍是无界裸 `new Map`，`idleMessageViews`/`settledProjections` 全文件只有 set/get/delete/clear、无任何 LRU）** | 三处删除成功分支补 `manager.forgetSession(id)`；两张 Map 挂 500 LRU | M |
| **AM-3** | `navigation/types.ts:16`（`RealPrompt: undefined`）；`screens/stack/RealPromptScreen.tsx:20-23`；两处入口 `SessionDetailScreen.tsx:397` + `useChatTabController.ts:106-107` | W6 升级为「触发路径逐跳读码闭环」+ **revalidate-b valid（路由参数确认未加；两处入口确认零参数）** + **⭐ W9 独立撞车**：w9-mobilenav-pro-2（P1，独立给出同三个位置 + `types.ts:16`） | `RealPrompt` 路由加可选 `{projectId?, sessionId?}`，两处入口显式传 | S |
| **N-P1-03** ⭐ | `apps/mobile/src/navigation/types.ts:51-52` + `screens/stack/FileEditorScreen.tsx:60,190` | **多源**（w9-mobilenav-pro-1 与 w9-mobilenav-2 同区两条 P1；adv 让步清单**未列**，即辩护方未否认）；**W11 复核**：`types.ts:51` 确仍是 `onSessionVfsSaved?: () => void` 这个**函数进 params** | 「函数进 route params」双重违规：① React Navigation 要求 params 可序列化（state 持久化 / `navigate` 的 `merge`/`freeze`），传函数会在序列化时被丢弃；② 全仓零调用方传它 ⇒ 屏内 `onSessionVfsSaved?.()` 永不执行，**session scope 保存成功后工作区列表不刷新**。修法：删掉这个 param，改用 Context 或 navigation event | S |

### 2.8 apps-desktop（6 条，含 2 条新增）

| ID | 位置 | 印证强度 | 一句话修法 | 量 |
|---|---|---|---|---|
| **S-D-02** | `src/main/ipc/handlers/vfs.ts:423-432`；`src/main/services/vfs-batch.service.ts:260-272` | 读码 confirmed / 可利用性 suspected + **revalidate-b valid（行号完全未漂）** | 清理通道内加 `resolve()` + `startsWith(base + sep)` 断言 | S |
| **S-D-04**（含盲扫条目 **A**） | `renderer/features/settings/AgentEditorView.tsx`（全文零 `dirtyViews`）；`renderer/layout/SettingsOverlay.tsx:135-155,236-247`；`features/settings/settings-nav.ts:99,158-175`；`renderer/App.tsx:344` | 多源 + W6 盲扫独立重推导 A + **revalidate-b valid（`dirtyViews.add` 全仓仍只有 `SkillDetailView.tsx:142` 一处 ⇒ 守卫恒 false；App 侧 ⚡ 旁路仍在）** + **⭐ W9 双源**：w9-ds2-desktopfeat-a-1（P1，独立 grep 出「唯一写入方是 `SkillDetailView.tsx:140-149`」）× w2-desktop-features-3（W2 原扫同址 P1） | `AgentEditorView` 补 `nav.dirtyViews.add("agentEditor")` effect；App 侧 ⚡ 改走 `handleClose` | M |
| **B**（盲扫新增） | `packages/core/src/config-forms/agent/agent-editor-state.ts:542-568`（`formSnapshotJson` **缺 `mode`**）；`AgentEditorView.tsx:169-217,630,744-756` | W6 逐字段核对 + **revalidate-b valid（17 个字段逐条核对，`mode` 确认仍缺席）** | `formSnapshotJson` 纳入 `mode`；补「改作用域下拉即 dirty」回归 | S |
| **E**（盲扫新增） | `AgentEditorView.tsx:232-244,286-303,346-356` | W6 读码闭环 + **revalidate-b valid（六步失败链逐跳仍在，revalidate-b 独立复核到 `:346-356` 的 `allModels.find` 与 `:351-356` 的传 `null`，并确认无任何缓解）** | 加载失败时保留 `def.model` 原值 + 渲染「原绑定模型当前不可用，保存将解除绑定」提示 | M |
| **N-P1-04** ⭐ | `renderer/features/settings/WorkspaceSettingsView.tsx:164-171,250-254`（+ `:275`） | **对抗双侧撞车**：w9-ds2-desktopfeat-a-2（P1）与 w9-ds2-desktopfeat-b-4（P1，**两个独立双扫机位各自命中**）；**W11 复核**：`fe79b781` 的 `scheduleCompactionSave` 仍是 `setTimeout(() => { void saveCompaction(); }, 600)`、依赖数组仍是 `[saveCompaction]`，而 `saveCompaction` 依赖 `compactionTokenRatio`/`compactionHideStartDepth` | `onChange` 里 `setState` 是异步的，紧跟着调的 `scheduleCompactionSave` 捕获的是**本帧闭包**、持有的是**本次击键之前**的值 ⇒ 「Token 比例」与「隐藏起始深度」两栏的**最后一次输入永远丢失**（用户把 0.8 改成 0.85，库里还是 0.8）。修法：定时器内用 ref 读最新值，或 `scheduleCompactionSave(next)` 显式传参 | S |
| **N-P1-05** ⭐ | `apps/desktop/package.json:11`（`typecheck` 只跑 `tsconfig.json`）+ `apps/desktop/tsconfig.json:8`（`include: ["src/main/**/*","shared/**/*"]`，**不含 `renderer/`**）+ `.github/workflows/ci.yml:63` | **单源**（w9-ds2-desktopfeat-b-1）但 **W11 已复核并部分修正其数字**；`tsconfig.renderer.json` 存在（`lib: ES2022`、`jsx: react-jsx`）却无任何 npm script / CI 步骤引用它；`build` 走 `vite build`（esbuild 只转译不查类型）。**W11 实测**：`npx tsc --noEmit -p tsconfig.renderer.json` 出 **424 条错误**（原报告写 813，**本轮实测显著低于报告值，报告数字须以本行为准**），其中 `renderer/features/**` 恰为 **160 条**（与原报告的 160 一致） | 渲染层长期无类型门禁。加 `typecheck:renderer` script 并进 CI；先按文件分批清账（`SettingsViews.tsx` / `AgentEditorView.tsx` / `ModelSamplingView.tsx` / `AgentDefinitionEditorForm.tsx` 四件占大头） | M |

> **W8 交叉印证**：w8-test-desk-cli F-w8-7（`tsconfig.json:8` + `package.json#typecheck`，「190 条测试类型错误零门限」）与本条同源同址，**从测试侧独立命中 renderer 无门禁**。⇒ 归一为一条 P1。
> `AgentDefinitionEditorForm.tsx`（1048 行、**全仓零引用**，w9-desktopfeat-pro-1 P1 ↔ w9-desktopfeat-adv 让步 C-1 P2）**降为 P2**（对抗双方对级别有分歧，pro 强调体量、adv 强调"是复用表单"），并入 dead-backlog 批次 3。

### 2.9 dead-backlog（2 条）

| ID | 位置 | 印证强度 | 一句话修法 | 量 |
|---|---|---|---|---|
| **F-synth-dead-1** | L0 死导出普查桶定义（`tmp/l0census/dead-exports.mjs:197`） | W3 抽核大修正：core「仅测试」桶 127/356（35.7%）实为 barrel 转发的生产消费；core「确认死」617 中 173 条落在快照锁定面 ⇒ **core 真可删 ≈ 363** | `testOnly` 排除 `relayed` 后重跑 L0 | M |
| **F-synth-dead-2** | `packages/core/test/package-exports/snapshots/*.json`（13 份、551 个去重名字） | W6 补硬证据（全仓 13 个包 `private: true` + `version: 0.0.0`，`.github/` 与 `scripts/` 里 `npm publish` 零命中） | 见拍板项 #1 | S（核销）/ M（解锁后） |

### 2.10 v1 已有 P1 但本波**跨簇重复**（去重后不出账）

| 重复项 | 保留口径 | 新报告 |
|---|---|---|
| `AgentDefinitionEditorForm.tsx` 1048 行零引用 | 归 **dead-backlog 批次 3**（P2） | w9-desktopfeat-pro-1（给 P1）× w9-desktopfeat-adv-C-1（给 P2）——对抗分歧，降 P2 |
| desktop `skill-ui.ts:21-35` 未做 YAML 转义 | 归 **core-misc M-02（现 P2）** | w9-ds2-desktopfeat-b-3（给 P1）+ w2-desktop-features-2（**W2 原扫早于 v1 台账，同址 P1**）——两源，但 v1 §2.9 已把 M-02 降到 P2 且**修法未变**，故**不升 P1** |
| `AgentEditorView` dirty 通道缺失 | 归 **S-D-04** | w9-ds2-desktopfeat-a-1（已在 §2.8 计入 S-D-04 的印证源） |

---

## 3 · P2 / P3（按簇计数）

| 簇 | P2 | P3 | v1→v2 主题变动 |
|---|---:|---:|---|
| **core-runtime** | 18 | 34 | 主题②的 `messageContentPool` 半边整层删除 ⇒ 「缓存生命周期」只剩 prompt-token 单例 + file_cache 四条清域路径 |
| **core-data** | 22 | 39 | ①「两条平行截断实现」②backfill N+1 倒扫 ③file_cache blob 不回收 ④事务边界 ⑤编码收口 ⑥迁移退役倒计时——**新增**：明文化后 `usage-stats` 的双形态解码分支仍是两份（CD-09，`usage-stats.service.ts:525-528` vs `sqlite-message.repository.ts:125-133`），decoder 收口仍 open |
| **core-storage** | 17 | 48 | ①SQL 底座治理（W9 部分证伪了「动态标签子系统零使用」：`sql-template/` 1057 行是 31 个 repository 的默认 SQL 出口、249 处调用点，**零使用的是那几类动态标签分支，不是整个子系统**）②事务期 AsyncMutex ③VFS 解压热点 ④bootstrap DDL 守卫缺失 ⑤`vfs_entry.content` 遗留明文三形态 ⑥`content_hash` 两表皆无索引 |
| **core-misc** | 25 | 9 | ①协议栈可观测性 ②双端重复 15 组 + 真环 5 ③体积闸三层 ④provider 域零消费派生群 ⑤tokenizer/nmtp 导出面 ⑥core 纯函数测试缺口 |
| **apps-mobile** | 20 | 26 | ①编码损坏已入库 ②双端同语义两份实现 ③WebView 三层产物链 ④通知导航压第二个 `MainTabs` ⑤路由/scope 纪律 ⑥test-utils 与 dist 依赖面 |
| **apps-desktop** | 20 | 8 | ①IPC 断链 11 条终裁 ②X1 门禁 9 处 + CI `continue-on-error` ③invoke 封装层死率 ④死 IPC 消费面 ⑤**新增**：渲染层 424 条类型错误零门禁（N-P1-05 的 P2 侧：125 处 `unknown` 响应类型迫使调用点靠 `as` 断言现场防御） |
| **cloudsync** | 20 | 7 | ①rev 记账/单例失效生命周期包 ②互斥三守卫各管一段 ③临时文件与对象残留 ④设置页 2s 轮询打远端 ⑤OSS 条件 PUT 降级 TOCTOU ⑥快照只增不删 |
| **dead-backlog** | 3 | 1 | ①387 条可执行删除清单 ②L0 桶定义缺陷 ③apps 侧「全部导出都死 ≠ 文件死」 |
| **新增（W8 测试语料面）** | 4 | — | ①desktop 测试 190 条类型错误零门限 ②42 条 TS2339 死 `if` 分支 ③CLI「从 stdout 取 id」四套并存实现 + 30 余处裸 `.trim()` ④夹具步骤丢弃返回码把夹具失败伪装成生产失败 |
| **新增（W9 死代码面）** | 3 | — | ①mobile `useStreamTailGenerating.ts` 零消费 ②desktop features 11 处死导出 / 24 个符号过度导出 ③webbridge `messagePatch`/`log` 双向死协议项 |
| **合计** | **155** | **174** | **终局 373 条 = P0 5 / P1 39 / P2 155 / P3 174**（RT-01 争议出池，见 §8） |

---

## 4 · W8/W9/W10 对抗对逐条裁决（pro vs adv）

裁决口径：**upheld** = pro 的指控在 adv 的答辩/让步里没被推翻或被独立复述（= 站得住）；
**mitigated** = 病灶在但危害面/可达性被 adv 收窄，按收窄后的口径入账；
**dismissed** = 被 refute 或被降出 P0/P1 池。

### 4.1 W8 对抗对（5 对）

| 对 | pro 主张 | adv 立场 | 裁决 | 依据 |
|---|---|---|---|---|
| **w8-prompt** | 2×P1：①`render-prompt.ts:67-93` zone 与装配两套判定（实测 `persistCount` 虚高 1 → 首条真实 user 消息被误算进 persist 区 → persona 与真实输入合成一条）②`normalize-agent-prompt-layout.ts:54-74` 白名单漏 `skillsEnabled`/`skillsPrefix` | 14 条辩护理由成立；让步 9 条全给 P2/P3，**无一条触碰 pro 的两条 P1**（adv 的 F-1 是 pro-1 的同源降级表述：判 P2 suspected；adv 的 F-4 是 pro-2 的同源降级表述：判 P3） | **pro-1 upheld（P1→降 P2）**：adv 自己判「当前不可达（依赖跨文件隐式不变量）」，pro 也自陈「生产侧目前不会触发」⇒ 病灶在、可达性未证 ⇒ **mitigated，落 P2**。**pro-2 upheld（P1）**：危害链不依赖任何未完成契约——存量域形态定义**此刻就在库里**，随时可读 ⇒ **入账 N-P1-02** | adv 与 pro 在两条上**指向同一 file:line**，无实质分歧；分歧只在级别 |
| **w8-workplace** | 1×P1：中止机制只抛错不取消已排宏任务的后台回填（`assemble-workplace-display.ts:167` + `load-or-fill-file-cache.ts:114`），量化 3 文件 6M 字符 hash 127ms + deflate 173ms | 14 条辩护 + 让步 9 条；C-1【P2】是**同一处**（`filename` 档 1970 假时间戳），C-2~C-9 全是别处 | **upheld（降 P1→P2，合并入 M-03）**：adv 的 C-1 与 pro 的 F-1 指向同一条 `assemble-workplace-display.ts:167 / load-or-fill-file-cache.ts:114` 的中止/回填交互，只是各自强调了不同后果（pro 讲「停止后线程被自己排的队占满」，adv 讲「渲染出 1970 假时间戳」）。**两后果同源，修法同一条** ⇒ 归 M-03，M-03 的印证强度升级为「W6 实跑 + revalidate-b + W8 双源」 | pro 的量化数据独立可信；但 adv 的 C-1 已经把同一条的严重度框定为 P2 ⇒ 取低者 |
| **w8-provider** | 2×P1：①`find-saved-model-references.ts:32-93` 漏扫 `chat_session.agent_config_json.modelId` ②`model-request.service.ts:69-104,211-243` 流中失败被当可重试（重复输出 + 重复计费） | 14 条 intentional/合理性辩护成立；让步 12 条，**C-1【P1】= pro-②**（独立列出 5 个位点）、C-5【P2】= pro-① 的同族（但指的是 `delete(provider)` 路径，C-8【P3】另指出 `chat_project` 那段扫描是「已下线功能的遗留」） | **两条均 upheld，落 M-04 / M-01**：pro 与 adv 在**两条上分别独立命中同一位点**，adv 的 C-1 甚至比 pro 多列了 `openai.adapter.ts:224-228` 与 `llm-sse-transport.ts:568-573`。**M-04 的级别维持 P1**——adv 给 P2 是因为它看的是 `delete(provider)` 这一条路径，而 pro 给的 P1 是 `deleteSaved` 守卫漏 `chat_session`（后果是会话里留悬空 UUID）| 这是全波印证最强的一对：两条 P1 都是双签 |
| **w8-skills** | 3×P1：①ZIP 炸弹绕过体积闸（`vfs-zip-parse.ts:41` + `vfs-zip-central-dir.ts:224` + `vfs-zip-io.service.ts:189-192`）②`preview-skill-zip.ts:35` 裸解压器 ③技能名 `\` 未排除 ⇒ ZIP 导入通道可整棵删内置技能（实测 `x\..\agent-config` → `/meta/skills/agent-config`） | 11 条辩护成立；让步 10 条，**A1【P2】= pro-①**（同 file:line）、A4【P2】= pro-③ 的相邻面（ZIP 导入不校验技能名 + 双端口径不一致）；**A1/pro-② 均无独立答辩** | **pro-① upheld（P1，落 CS-09）**：CS-09 本就是 v1 已有的 P1，revalidate-a 已确认病灶在位，W8 双源只是加强印证。**pro-② 判 dismissed（并入 CS-09 的修法，`preview-skill-zip.ts:35` 本就在 CS-09 的位置清单里）**。**pro-③ upheld（P1，新入账）**：`\` 逃逸的完整危害链（两通道处置不一致 → ZIP 通道无 escape 复核 → `releaseAndDeleteVfsPrefix` 整棵删内置技能）是**新病灶**，adv 的 A4 只覆盖「名字不校验」这一半，没覆盖路径逃逸 | pro-③ 的实测脚本已自清，留痕在报告里 |
| **w8-mobileweb** | 1×P0 + 2×P1：①composer-input bundle 顶层 `Object.fromEntries`（N-P0-01）②`web/tsconfig.json:7` 的 `lib: ES2018` 门禁被 `@types/node` 击穿 ③两个 bundle 8.6MB/8.0MB 内联了 `d2` 正则库 | 10 条辩护成立（含 mermaid 缓存去重、rAF 演进、桥协议信封、es2018 约束、webview-host 纯函数岛、TrustedHtml 信任边界）；让步 8 条全 P2/P3，**C-w8-5【P3】= pro-② 的同源降级**（实测过 `lib: ES2018` 被击穿） | **pro-① upheld（P0，N-P0-01）**：adv 只审源码面、**没审产物**（其 10 条辩护全部基于 `src/`），所以对「bundle 顶层执行」这条无发言权；W11 已在 `fe79b781` 的产物上复核成立。**pro-② mitigated（P1→P2，并入 apps-mobile 编码/构建链面）**：adv 判 P3 的理由是「门禁失效但目前没写错」，pro 判 P1 的理由是「写错拿不到任何信号」⇒ 取中间，落 P2。**pro-③ dismissed（P3，体积问题，非缺陷）** | pro-01 是**唯一一条 adv 完全没碰的 P0**，因此不存在对抗分歧，是纯粹的「一方发现」 |

### 4.2 W9 对抗对（12 对）

| 对 | pro 主张 | adv 立场 | 裁决 |
|---|---|---|---|
| **w9-chat** | 1×P1：`model/message-attachment.schema.ts:109-126` 经 `sqlite-message.repository.ts:97-99` ⇒ `parseAttachmentsJson` 对整数组做一次 `safeParse`，任一条不合规即**全部附件静默降级为 `undefined`**（无 log/warn/计数）⇒ chip 全消失、回滚批注丢失、**落库历史与送给 LLM 的提示词不一致** | 16 条辩护成立 + 让步 12 条；**C-3【让步】是同一处**（「`raw_json` 的 `JSON.parse` 无保护，一行脏数据炸掉整个 `listBySession`」）——严格说不是同一处（adv 讲 raw_json，pro 讲 attachments 数组） | **upheld（P1）**：W11 已在 `fe79b781` 复核 `message-attachment.schema.ts:109-126` 的 `.strict()` + superRefine 与 `sqlite-message.repository.ts:97-99` 的 `safeParse` 结构在位。**注意这是本波唯一一条「domain/chat 域」的新 P1**，与 §5 一致率表里 chat 区三方都未命中同一条形成鲜明对照 |
| **w9-tool** | 10×P2 + 10×P3，**零 P0/P1** | 12 条辩护（含「工具注册器 46 行是正确取舍」「pathTail 是当前并发模型下唯一写保护」）+ 让步 13 条全 P2/P3 | **全对 mitigated，域内 P0/P1 = 0**。pro 与 adv 在 `tool-path-policy.ts:17/43-58`（假安全网）、`tool-output-limits.ts` 三档预算、`fs-command.ts` 三处上是**同一批 file:line** ⇒ 双源印证充分但危害面都止于 P2。**这一区的定级共识是「不该在优化批次里被动」**（adv 原话），台账采纳 |
| **w9-checkpoint** | 零 P0/P1（15 条 P2/P3/intentional） | 让步 7 条，其中 **F-15【P2】= `AND message_id IN (#{id0},…)` 不分块**、F-20【P2】= COUNT(*) 等价性只有注释无真库单测 | **pro 的 P1 缺口由 adv 补上**：两条都进 §2.4 的 CS-10 印证源与 dead-backlog。**F-15 与 w9-infrasql-pro-1 是同一处的两个独立机位** ⇒ CS-10 印证强度升为「W6 adjusted + revalidate-a valid + W9 双源」 |
| **w9-agentmisc** | 零 P0/P1（4×P2 + 17×P3，pro 自陈「**无 P0**」） | 11 条辩护 + 让步 6 条；让步 12【P2】= doomLoopThreshold/crossRoundWindow 无上界，adv 补一句「默认值 3/4 健全，且这是 agent 配置自伤非系统级缺陷，故降 P2 而非 P0」 | **无分歧**：双方都是 P2/P3，且**双方都同意不是 P0**。doom-loop 配置自伤留在 P2 |
| **w9-infrasql** | 2×P1：①`parser.ts:46` AST 缓存以模板全文为 key、无上界无 LRU（注释自述「数量有限，不需要 LRU」与实际调用形态不符）②`sql-template/**` 动态标签子系统 | 18 条让步，**F-12【P3】= pro-① 的同源降级**（`TemplateParser.astCache` 无上界，模板动态拼接时按「长度变体」倍增）；对 pro-② **部分证伪、部分证实**（详见 §7 #7） | **pro-① upheld（P1，落 CS-10）**：W6 与 revalidate-a 都已确认；W9 双源（pro-01 + checkpoint-adv-F-15）加强。**pro-② dismissed（转拍板项 #7 重拍）**：`sql-template/` 是 31 个 repository 的默认 SQL 出口、249 处调用点，**「零使用」不成立**；真正零使用的只是几类动态标签分支 |
| **w9-inframisc** | 3×P1：①`db-maintenance.service.ts:90-92` 手动清理只清 blob 侧 pending 标记 ②`cloud-sync-coordinator.ts:143-182` pull 不查 `isAgentActive` ③`:57-65` `PushAgentMutex` 全仓零 agent 侧调用方 | 8 条辩护（含「两池缓存是最正确的设计」「谓词驱动后台任务是 RULE 的正确落地」）+ 让步 11 条；**Y-1【P2】= pro-① 的同源降级**；Y-10【P3】= pro-② 的同源降级（`snapshotKey!` 未闭合前置条件）；**adv 完全没列 pro-③** | **三条全部 upheld**：①pro 给 P1、adv 给 P2，**取 P2**（手动清理漏一侧 pending 标记只是多跑一次全库 VACUUM，非正确性问题）⇒ 落 P2。②**upheld（P1）**：这正是 v1 的 **S-CS-03**，W9 从 infra 侧独立撞车 ⇒ S-CS-03 印证强度升为「W6 adjusted + revalidate-a valid + W9 独立撞车」。③**upheld，但不新增条目**（挂 §6 #1）：`PushAgentMutex` 的模块头把「push 和 agent 启动入口排队」写成已实现能力，而 v1 的 core-misc 簇已把它记为 P2「运行时孤儿子系统 `M-25`」——**W9 从调用方穷举 grep 独立确认它一个生产调用方都没有**，且补出了具体危害顺序（续租 PUT 已发生才复检 agent）⇒ **M-25 的级别可复议升 P1，但因它是 v1 已有条目、不算本波新增，v2 只升级其印证强度** |
| **w9-servicevfs** | 3×P1：①`template-pull.service.ts:30-35` 不清 prompt 缓存 ②`smart-sort-rule.service.ts:246-249` `importRules` 先 deleteAll 再逐条 insert、**全程无事务**（service 的 `deps` 连 `conn` 都没有，结构上开不了事务）③`:253-288` `resetDefaults` 三段式同样零事务，外加 `deleteBatch`/`setEnabledBatch`/`renumber` 同族 | 18 条辩护（含「导入缓存对齐采用 best-effort 整体吞错口径是合理取舍」「`ensureImportDirRules` 在事务内吞错不算设计缺陷」）+ 让步 12 条，**F-1【P1】= pro-①**、Y1【P1】= pro-① 的修法表述 | **三条全部 upheld，落 RT-08 + 两条新增**：①**RT-08 印证升到四源**（v1 的两源 + w9-servicevfs-pro-1 + w9-ds2-servicevfs-a-1/b-1）。②**新 P1（N-P1-05a）**——adv 未列此条，且 pro 给出了完整因果链（bundle 中任一条 insert 失败 ⇒ 用户全部智能排序规则已被 deleteAll 抹掉且不回滚 ⇒ 排序静默退化为自然序，desktop 侧还会被 `normalizeYamlError` 包成「YAML 无效」把 DB 故障误报成格式错误）。③**新 P1（N-P1-05b，同族合并）**——`renumber` 被 `moveRule`/`reorderRules`/`resetDefaults` 三处复用，中途失败留下排序号有洞或撞号，而 `listOrdered` 用 `ORDER BY sort_order, rule_id` 决胜、撞号时行为不可预测 |
| **w9-bootstrap** | 1×P1（`tsconfig.test.json:26`）+ 3×P2 + 11×P3 | 11 条辩护（含「单事务 bootstrap 是正确取舍」「快路径收益实测可数」「`config-forms/` 把表单形态与领域形态彻底分开」）+ 让步 11 条 | **pro-01 upheld（P1）**：W11 已在 `fe79b781` 复核 `tsconfig.test.json:26` 确为 `"./src/service/kkv/index.ts"`（内部 barrel），而 `package.json` 的 exports 指向 `dist/public/kkv.js`（公共 barrel）——**名为「package exports 契约测试」的用例验的是内部 barrel**，公共 barrel 被误删/误改则测试全绿而 mobile Jest（`jest.config.js` 直连 `dist/public/kkv.js`）与真机才炸。**这是测试语料面的一条真 P1** |
| **w9-mobileui** | 零 P0/P1（12×P2 + 15×P3） | 16 条辩护（「ui 原语分层：契约窄、语义正交、消费面已验证」「富文本安全管线每层都有独立职责且都有测试」）+ 让步 6 条 | **无 P0/P1，两造一致**。**唯一交叉点**：adv 让步 C-2【P2】= 「Agent 编辑器作用域（mode）改动不触发 dirty，可能静默丢改动」= v1 的 **B** 条（`formSnapshotJson` 缺 `mode`）——**这构成 B 条的第二个独立印证源** |
| **w9-mobilenav** | 2×P1：①`navigation/types.ts:51-52` 死路由参数（函数进 params，全仓零调用方传）②`RealPrompt` 无参路由取全局 scope | 20 条辩护 + 让步 14 条全 P3/P2/intentional；**adv 未列 pro 的两条 P1** | **两条均 upheld**：①**新 P1（N-P1-03）**，②归 **AM-03**（v1 已有，W9 独立撞车）。**adv 在这一区让了 14 条却一条 P1 都不列**，说明它把 pro 的两条当成了设计取舍；但 pro-① 的「函数进 params」在 React Navigation 里是可序列化性硬约束，且 W11 复核 `types.ts:51` 确仍是这个函数 param ⇒ 站得住 |
| **w9-desktopfeat** | 1×P1（`AgentDefinitionEditorForm.tsx` 1048 行全仓零引用）+ 7×P2 + 5×P3 | 10 条辩护 + 让步 10 条，**C-1【P2】= pro-01 的同源降级** | **mitigated（P1→P2）**：adv 主张它是「复用 config-forms/agent 的表单」而非纯死码，pro 主张 1048 行零引用就该删。**折中：归 dead-backlog 批次 3**（同 §2.10）。**这一区的真正 P1 全部来自双扫（ds2-a/b），不来自对抗对** |
| **w9-cliperiph** | 零 P0/P1（7×P2 + 13×P3） | 6 条辩护 + **让步 S-1/S-2/S-3 三条全 P1**，合并为 F-w9-adv-1 | **adv 反向出战三条 P1，pro 一条没出**：①`nm session create` 在全新库上必然失败（CLI 无任何创建 agent 的命令 ⇒ **全新机器开不了第一个会话**）②`[nm-boot]` 迁移日志污染 stdout（实测 12 行）③26/102 红灯且 CI Test 步未 `continue-on-error` 却未见拦截。**三条与 w8-test-desk-cli F-w8-11 撞车** ⇒ 合并为 **N-P0-03**。**这是本波唯一一处「adv 推翻 pro」的对抗** |

### 4.3 W10 对抗对（2 对）

| 对 | pro 主张 | adv 立场 | 裁决 |
|---|---|---|---|
| **w10-d-plain**（明文化链） | 3×P2 + 9×P3，零 P0/P1。pro-1 是「LIKE 粗筛守卫只查 keyword 侧的 Unicode 折叠」（`:602` + 守卫 `:117`） | 10 条辩护（写侧三列齐置是地基、收尾不变量 `leftover > failedKeys.size ⇒ stalled` 是整个迁移层唯一不可省的一行、坏行隔离堵上唯一的不可逆销毁路径、入口自愈探针+部分索引、反向任务不挂 VACUUM 是方向反转的必然、LIKE 守卫「召回红线优先于性能」是正确优先级…）+ 让步 10 条，**adv-1【P2】= pro-1 的同源**（守卫只查 keyword 侧、不查 content 侧的 Unicode 折叠） | **pro-1 upheld，双签，落 P2**。**其余全 P3 且 adv 多为 intentional 登记**。**这一对是本波唯一「两造零分歧」的**——adv 明确说「召回红线优先于性能是正确优先级」，与 pro 的 P2 定级不冲突 |
| **w10-d-readref**（引用化链） | 2×P1：①**计数对账口径破裂**——`+1` 按工具调用计（`vfs-tools.ts:237-247`），`−1` 按消息去重计（`revision-ref-count.ts:72-90`）；②**repair 三类化整体未接线**（`novel-master-bootstrap.ts:420-423` 是唯一 repair 注册点，只注册了 `createVfsEntrySequenceRepairOperation`，`createRevisionRefCountRepairOperation` 从未注册，而 `vfs-tools.ts:232-233` 的注释明写「+1 泄漏由 repair 检测兜底」） | 让步 D-1【P1】= pro-② 的同源（`overExpected` 泄漏检测在生产链路是死代码，「git grep 只有 4 处非测试命中且没有一处是注册」，其中 `service/integrity-repair.ts:78` 那处还是**文档示例注释**） | **两条均 upheld，双签，落 2 条新 P1**。**W11 已在 `fe79b781` 复核 `novel-master-bootstrap.ts:420-423`：确实只 `.register(createVfsEntrySequenceRepairOperation(conn))`，`createRevisionRefCountRepairOperation` 未注册**。①是口径错配（累加器 vs 集合）、②是兜底缺失，**两条叠加 = 无主 +1 泄漏无人检测**；且 delta-overview §2.2 已把「方向宁多不少」的策略写死，故 ① 的偏保守方向反而让 `floor` 不下调——**这意味着 leak 只会被静默吞掉，不会被检出** |

---

## 5 · 一致率表（8 个三方区）

**口径**：三方 = 双扫（ds/ds2）× 2 + 该区的原扫报告（W1/W2）。
「top5 病症」= 各方自报里级别最高或最靠前的 5 条（对抗对取 pro 的发现清单，adv 视为同一方的第二意见）。
「重合」= 同一 file:line **或** 同一根因 + 同一 file 的两条独立命中。
「一致率」= 三方并集中被 **≥2 方**发现的条目数 ÷ 并集条目数。

| 区 | 三方构成 | top5（各自） | 两两重合 | 仅单方 | 一致率 | 分歧样本 |
|---|---|---|---:|---:|---:|---|
| **chat**<br>(`domain/chat`) | w9-ds2-chat-a<br>w9-ds2-chat-b<br>原扫 w1-core-chat | a：`composer-draft.schema.ts:64-68`【P1 草稿全有或全无】/ `parse-message-content.ts:170-200` / `message-attachment.schema.ts:121-124` / `parse-message-content.ts:24-31` / `prepare-user-messages-for-prompt.ts:86-104`<br>b：`scan-at-path-attachments.ts:25` / `annotate-source-range.ts:377` / `message-attachment.schema.ts:121` / `parse-message-content.ts:172-200` / `prepare-user-messages-for-prompt.ts:592`<br>原扫：`subagent-tool.ts:219` / `chat-prompt-tokens.service.ts:458` / `message.service.ts:193` 发号与插入非原子 / `scan-at-path-attachments.ts:129-144` / `prepare-user-messages:110,121` | a↔b **2**<br>a↔原 **2**<br>b↔原 **1** | 8 | **≈29%** | **a 的 P1 与 b、原扫三方都没命中**——`composer-draft` 的全有或全无是 a 独立撞见的；反过来 `message-attachment.schema.ts:121` 三方全中（a P2 / b P2 / 原扫 P3），**但级别差两档**：原扫与 a/b 都没意识到「一条附件不合法拖垮整个数组」的放大效应，真正定级 P1 的是 **w9-chat-pro-01（对抗对，另一份报告）** |
| **tool**<br>(`domain/tool`) | w9-ds2-tool-a<br>w9-ds2-tool-b<br>原扫 w1-core-tool | a：`format-tool-output.ts:152-154`【P1 形状守卫误判】/ `tool-path-policy.ts:17,43-58` / `vfs-tools.ts:581-598` / `fs-command.ts:155-183` / `builtin-tool-context.ts:169-249`<br>b：`format-tool-output.ts:152`【同】/ `skill-tool.ts:431` / `tool-path-policy.ts:43` / `tool-path-policy.ts:17` / `skill-tool.ts:170`<br>原扫：`subagent-tool-session-id.ts:33` / `vfs-tools.ts:69` / `builtin-tool-context.ts:193,197` / `search-tool.ts:208` / `curl-tool.ts:192` | a↔b **2**<br>a↔原 **1**<br>b↔原 **0** | 9 | **≈18%** | **全波一致率最低的区之一**：b 与原扫在 top5 上**零重合**。唯一强共识是 a↔b 都命中 `format-tool-output.ts:152`（且 a 带实跑探针：`skill list` → `"undefined\tundefined"`）——**双扫双中且有实跑，是本波最干净的新 P1**。`tool-path-policy.ts` 是 a↔b 双中但两边都判 P2（adv 明确说「假安全网，P2 而非 P1 的唯一理由是目前生产三处全写死 undefined」） |
| **servicevfs**<br>(`service/` 存储装配层) | w9-ds2-servicevfs-a<br>w9-ds2-servicevfs-b<br>原扫 w2-core-service-vfs | a：`template-pull.service.ts:24-49`【P1】/ `vfs-batch-io.service.ts:100-101` / `smart-sort-rule.service.ts:246-249` / `run-compaction.ts:70-72` / `normalize-orphan-tool-results-for-llm.ts:56-80`<br>b：`template-pull.service.ts:24-35`【P1 同】/ `smart-sort-rule.service.ts:246-249` / `smart-sort-rule.service.ts:261-287` / `refresh-rule-snapshot.ts:33-41` / `revision-aware-vfs.service.ts:333-350`<br>原扫：`template-pull.service.ts:24-36`【P1 同】/ `smart-sort-rule.service.ts:246-249` / `model-request.service.ts:81-84` / `vfs-batch-io.service.ts:100` / `render-prompt.ts:80-83` | a↔b **2**<br>a↔原 **3**<br>b↔原 **2** | 4 | **≈50%** | **全波一致率最高的区**：`template-pull.service.ts:24-3x` **三方全中同一处**（且加上 W9 对抗对的 pro/adv 双签 ⇒ 五源），`smart-sort-rule.service.ts:246-249` 也三方全中。**分歧样本只有一条**：原扫 a-2 把 `vfs-batch-io.service.ts:100` 报 P2，a 报 `:100-101` P2（同一处），b 完全没列——b 把注意力放在 `:251-254`/`:307-319`/`:84-102` 另一段 |
| **desktopfeat**<br>(desktop `renderer/features/`) | w9-ds2-desktopfeat-a<br>w9-ds2-desktopfeat-b<br>原扫 w2-desktop-features | a：`AgentEditorView.tsx:630,687`【P1 dirtyViews】/ `WorkspaceSettingsView.tsx:164-171,250-254`【P1 定时器闭包】/ `ChatComposer.tsx:189-193`【P1 scope 不一致】/ `WorkspaceTree.tsx:96-106` / `ConversationPanel.tsx:757-773`<br>b：`package.json:11`+`tsconfig.json:8`+`ci.yml:63`【P1 渲染层零门禁】/ `ChatHistorySearchPanel.tsx:106,264`【P1 setError 收对象】/ `skill-ui.ts:21-35`【P1 YAML 未转义】/ `WorkspaceSettingsView.tsx:139-171,250-277`【P1 同 a】/ `invoke-registry.ts:474-525`【P1 125 处 unknown】<br>原扫：`AgentDefinitionEditorForm.tsx:176`【P1】/ `skill-ui.ts:21-35`【P1 同】/ `AgentEditorView.tsx:630`【P1 同 a】/ `prompt-macro-input.ts:25-138` / `MetricsDetailPopover.tsx:26-40` | a↔b **1**<br>a↔原 **1**<br>b↔原 **1** | 10 | **≈18%** | **三方各命中不同的 P1 组**：a 的 `ChatComposer` scope 不一致是单方（且标 suspected 需产品确认），b 的渲染层零门禁/`ChatHistorySearchPanel`/`invoke-registry` 三条全单方（**W11 已复核渲染层那条，实测 424 条错误而非报告的 813**）。唯一跨两方的两处是 `AgentEditorView.tsx:630`（a↔原，且与 v1 的 S-D-04/盲扫 A 三方一致）与 `skill-ui.ts:21-35`（b↔原，**但台账已把这条核销为 M-02/P2**）。**这一区三方重合低但每一方都挖出了别方没有的真 P1** |
| **chatservices**<br>(`service/chat/`) | w8-ds-chatservices-a<br>w8-ds-chatservices-b<br>原扫 w2-core-service-chat | a：`project.service.ts:263-296`【P1 copy 不复制 dir_rule】/ `session.service.ts:207-232` / `message.service.ts:433-492` / `message-transcript-effects.service.ts:63-77` / `session.service.ts:234-246`<br>b：`project.service.ts:185,188`【P1 delete 不减 ref】/ `project.service.ts:168-174` / `message-transcript-effects.service.ts:63-77` / `message.service.ts:446-491` / `usage-stats.service.ts:256-272`<br>原扫：`message-transcript-effects.service.ts:63-77`【P1】/ `message.service.ts:444-445` / `message.service.ts:293-303` / `session.service.ts:374` / `project.service.ts:242-299` | a↔b **0**<br>a↔原 **2**<br>b↔原 **2** | 6 | **≈33%** | **a 与 b 的 P1 完全不重合，且都是真问题**：a 说 copy 漏复制 `workplace_dir_rule`/`workplace_file_rule`（新会话文件树被裁成空），b 说 delete 漏 `decrementLiveRefsUnderScope`（永久泄漏 revision+blob）。**W11 复核 b 那条成立**（`project.service.ts:187` 确仍是裸 `deleteVfsPrefix`），已入账 N-P1-01。**a↔b 的零重合说明双扫在这一区是有效的**——两方读同一批文件却盯住了不同函数（`copy` vs `delete`） |
| **llmproto**<br>(`infra/llm-protocol/`) | w8-ds-llmproto-a<br>w8-ds-llmproto-b<br>原扫 w2-core-infra-proto | a：`gemini-sse-parser.ts:122`【P1 同名并行塌陷】/ `gemini-sse-parser.ts:362-372`【P1 兜底绕过断言】/ `llm-sse-transport.ts:285`【P1 URL 明文 api key 进 console】/ `anthropic-sse-parser.ts:220-226` / `anthropic-sse-parser.ts:389-418`<br>b：`anthropic.adapter.ts:134`+`apply-thinking-to-body.ts:22`【P1 max_tokens 4096 硬上限】/ `llm-sse-transport.ts:285`【P1 同 a】/ `stream-partial-blocks.ts:36-55`【P1 丢 thinkingSignature】/ `anthropic-sse-parser.ts:389,404-417`+`gemini-sse-parser.ts:390-398` / `anthropic-content-mapper.ts:24-25,66-68`<br>原扫：`llm-sse-transport.ts:679-681`【P1 流中断被当可重试】/ `tool-use` abort 双 emit / abort listener 泄漏 / `data:` 无空格整流丢弃 / `gemini-content-mapper.ts:220-224` image 硬失败 | a↔b **2**<br>a↔原 **0**<br>b↔原 **1** | 8 | **≈18%** | **a↔b 的两条重合都是 P1**：`llm-sse-transport.ts:285`（**Gemini api key 明文进 console，`__DEV__` 下 RN debug 包默认命中 ⇒ 落 logcat**——本波唯一一条纯安全面 P1，且两造都独立算出了 key 在 URL query 这个同一前提）与 `anthropic-sse-parser.ts:389-418` partial 路径丢信息。**a↔原零重合**：原扫盯「流中断误判可重试」（后来归 M-01），a/b 盯「协议解析器的具体降级路径」，是两种不同的缺陷族 |
| **webbridge**<br>(mobile WebView 桥) | w8-ds-webbridge-a<br>w8-ds-webbridge-b<br>原扫 w2-mobile-web | a：`ChatTranscriptBridge.ts:189` / `:253-256` / `RichDocumentBridge.ts:91-96` / `:112-114` / `:70-74`<br>b：`ChatTranscriptWebView.tsx:820-830`【sendInit 抢在 flagsUpdate 前】/ 三域 `v: 1` 字面量未用 BRIDGE_VERSION 常量 / `menu-overlay-guards.ts:13-35` 零生产消费 / `messagePatch`+`log` 双向死协议 / composer web→host 6 vs RN 只处理 4<br>原扫：`web/tsconfig.json:8`【ES2018 lib 门禁】/ `block-split.ts:42` / `webview-host/{scroll,menu-overlay-guards,stream-tail-html-state}` / `transcript.css:311,402,475-482` / `row-logic.ts:6` | a↔b **1**<br>a↔原 **0**<br>b↔原 **2** | 7 | **≈20%** | **三方 top5 里 P0/P1 数量 = 0**——这是唯一一个「三方都没出 P0/P1」的区。唯一跨两方的重合是 `menu-overlay-guards.ts` 零消费（b↔原，且两边都指向同一份用户拍板记录 `RULE.md:11`「四轮调查后决定不做长按划词菜单」）与 webview-host 三件套（a↔原） |
| **kkvstore**<br>(session-kkv + infra/kkv + db-maintenance) | w8-ds-kkvstore-a<br>w8-ds-kkvstore-b<br>原扫 w2-core-infra-misc | a：`blob-binary-normalization.ts:762-774`+`message-content-compaction.ts:506-524` / `sqlite-session-kkv.repository.ts:325-343` / mobile `message-content-compaction.service.ts:54-57`+`blob-binary-normalization.service.ts:77-79` / `db-maintenance.service.ts:121,134-142` / `sqlite-session-kkv.repository.ts:255-285`<br>b：`db-maintenance.service.ts:89-92` / `parse-kkv-json-document.ts:15` / `message-content-compaction.ts:354` / `db-maintenance.service.ts:121,137-141` / `blob-binary-normalization.ts:352-356,481-484,496-498`<br>原扫：`chunk-splitter.ts:52-61`【P1 ≤64 可破】/ `prompt-whole-cache.ts:71-78` / `push-agent-mutex` 无 agent 侧调用方 / `db-maintenance.service.ts:88-99` 手动清理双键 / `provider-table-snapshot.ts:111-127` | a↔b **2**<br>a↔原 **1**<br>b↔原 **1** | 8 | **≈20%** | **a↔b 命中的两处都是 P2 且都属「字面量/常量各写两份」族**（`db-maintenance.service.ts:121` 附近、blob 归一与消息压缩的 pending 标记互相不引）。**注意此区的两难**：a 是在**旧基线**扫的，registry 已注明「其 db-maintenance 部分由 W10 重验覆盖」——**v1.5.29 把 `message-content-compaction.ts` 整文件删了（改成 `message-content-decompression.ts`）**，所以 a 的 5 条 top 里至少 2 条的 file 已不存在 |
| **合计（8 区）** | 24 份报告 | — | **共 28 处两两重合** | **62 条仅单方** | **≈30%** | — |

### 5.1 一致率表的读法

**高一致区（servicevfs ≈50%）** 说明该区病灶集中、可被稳定复现——`template-pull` 漏清缓存拿五源印证是典型。
**低一致区（tool / desktopfeat / llmproto ≈18%）不代表质量差，而是「缺陷分散」**：每一方各自挖出了别方视野外的 P1，
且这些 P1 事后都被 v2 入账。反过来看，**三方一致率低恰好证明多视角补扫是必要的**——chat 区三方都没看到 `composer-draft` 的全有或全无，
是 a 单独撞见的；chatservices 区 a 与 b 盯住 `copy` 与 `delete` 两个不同函数，一方漏了另一方那半。

**一致率与定级的相关性观察**：跨两方以上命中的条目（`message-attachment.schema.ts:121`、`format-tool-output.ts:152`、
`llm-sse-transport.ts:285`、`db-maintenance.service.ts:121`）**要么级别升高、要么维持**；而只被单方命中的
条目里既有真 P1（`composer-draft` / `ChatHistorySearchPanel`）也有被降级的（`AgentDefinitionEditorForm`）。
⇒ **一致率不能当定级依据，只能当「复核优先级」依据**。

---

## 6 · 待验证：单源 P0/P1（12 条候补，不计入终局总数）

按 v1 §6 纪律「单方发现的 P1/P0 先就地复核再入账」。以下条目只有一份报告，且**没有第二份独立印证**——
W11 对能廉价复核的做了抽查（标 ✅复核），复核不成立或无法在本轮确认的留在原地。

| # | ID / 简称 | 簇 | 病症与位置 | 主张级别 | 本轮处置 |
|---|---|---|---|---|---|
| 1 | PushAgentMutex 未接线 | infra-cloudsync | `cloud-sync-coordinator.ts:57-65` + `logic/push-agent-mutex.ts`；模块头把「push 与 agent 启动入口排队」写成已实现，`git grep` 全仓零 agent 侧调用方；危害顺序是「续租 PUT 已发生才复检 agent」 | P1（w9-inframisc-pro-03） | ✅复核成立。**但它与 v1 的 M-25「运行时孤儿子系统」是同一条**，v1 已记为 P2 ⇒ **本轮不新增 P1，只把 M-25 的印证升级为「W9 独立 grep 确认 + 给出具体危害顺序」** |
| 2 | 渲染层零类型门禁 | apps-desktop | 见 §2.8 N-P1-05 | P1 | ✅复核成立（数字修正为 424）。**已入账**，不留在本节 |
| 3 | `composer-draft` 全有或全无 | core-data | `domain/chat/model/composer-draft.schema.ts:64-68`；任一附件不合法 ⇒ 整个草稿判非法 ⇒ 正文被静默清空；写回链路把列置 NULL，**原始草稿不可恢复** | P1（w9-ds2-chat-a-1） | ✅复核成立（`:64-68` 在位）。**保留在此节作为待验证，等第二份独立印证**（一致性表 §5 里 chat 区三方都没看到这条——这正是它只有单源的原因） |
| 4 | 附件数组整体降级 | core-data | `message-attachment.schema.ts:109-126` 经 `sqlite-message.repository.ts:97-99` | P1（w9-chat-pro-1） | ✅复核成立。**但同一条在 §5 一致率表里被 a/b/原扫三方低级别命中** ⇒ 已具备间接印证 ⇒ 建议主代理按 P1 入账（v2 暂列 §2 之外） |
| 5 | `ChatHistorySearchPanel` 白屏 | apps-desktop | `chat/ChatHistorySearchPanel.tsx:106`（`setError(result.error ?? '查询失败')`，而 `result.error` 是 `IpcErrorPayload` **对象**）+ `:264`（`{error}` 渲染对象子节点）⇒ React 抛 "Objects are not valid as a React child" ⇒ 整个查找面板白屏 | P1（w9-ds2-desktopfeat-b-2） | ✅复核成立（`:106` 逐字一致）。**单源，但机理无争议（类型系统已报 TS2345）**，建议直接入账 P1 |
| 6 | `invoke-registry` 一组通道无响应类型 | apps-desktop | `renderer/ipc/invoke-registry.ts:474-525`（服务商/模型/agent-registry/YAML/云同步/备份/db 统计整组返回 `Promise<unknown>`）⇒ 本区 125 处 TS18046 + 调用点靠 `as` 断言现场防御 | P1（w9-ds2-desktopfeat-b-5） | 与 #2 同源（渲染层无门禁的下游症状）。**建议并入 N-P1-05 的 P2 侧**，不单列 P1 |
| 7 | `ChatComposer` scope 与 core hydrate 域不一致 | apps-desktop | `ChatComposer.tsx:189-193` + `FileReferencePicker.tsx:65-67` 用 `vfsScope("session",…)`，而 main 侧 `resolve-vfs-scope.ts:30-34` 把 `'session'` 映射成 core `{kind:"project"}`；core hydrate 走 `toolCtx.vfs` = session 域 ⇒ **候选列的是项目工作区文件、`@路径` 却从会话工作区读** | P1 但标 suspected（w9-ds2-desktopfeat-a-3） | ✅代码链路复核成立，**但报告自标 suspected 且明确要求产品确认「desktop 是否刻意只让引用项目模板」** ⇒ 保留 P1-suspected，不入账 |
| 8 | gemini 同名并行调用塌陷 | infra-llmproto | `gemini-sse-parser.ts:122`：`const key = fc.id ?? fc.name`；`functionCall.id` 缺席时（API 明确允许）同名并行调用压成一个累加器且 `argsJson` 被整体覆盖 | P1（w8-ds-llmproto-a-01） | ✅复核（`:122` 逐字在位）。**原扫 w2-core-infra-proto F-7 已记同一条但判 suspected P2** ⇒ 有间接印证，建议入账 P1 |
| 9 | `max_tokens: 4096` 硬上限 | infra-llmproto | `anthropic.adapter.ts:134` + `logic/apply-thinking-to-body.ts:22`；默认配置（`sampling:{enabled:false}` + `thinkingLevel:"high"`）下 thinking budget 会超 4096 | P1（w8-ds-llmproto-b-1） | ✅复核。**单源**，建议入账 P1（默认值组合下必现） |
| 10 | `stream-partial-blocks` 丢 thinkingSignature | infra-llmproto | `stream-partial-blocks.ts:36-55`；`StreamPartialToolUse` 类型里根本没有该字段（`:13-17`），gemini 侧 `functionCallsToToolUses` 明明带出来了 | P1（w8-ds-llmproto-b-3） | ✅结构复核。**单源**，影响面为「中断后 thinking 块无签名」，建议入账 P1 |
| 11 | Android SSE callTimeout 静默挂起 | mobile-native | `llm-sse-native/.../LlmSseModule.kt:433`（配合 `:174-183`、`:417-438`）；报告用 `javap -c` **从字节码实测**确认 OkHttp `AsyncTimeout.timedOut()` 会调 `RealCall.cancel()` ⇒ 600s 到点命中 `call.isCanceled()` 闸门 ⇒ JS 侧收不到 Done 也收不到 Error ⇒ **Promise 永不 settle、run 挂到用户手动停止** | P1（w8-kt-sse-1） | ✅字节码实测证据充分。**单源**，建议入账 P1（Kotlin 面此前是盲区，本轮首扫） |
| 12 | SKSP 模块阻塞原生队列 | mobile-native | `SkspModule.kt:48-82` 无任何 Executor ⇒ `@ReactMethod` 在 RN 原生模块队列内联跑阻塞式系统调用（`KeyStore.getInstance().load(null)` + 冷路径 `KeyGenerator.generateKey()`） | P1（w10-kt-sksp-1） | ✅复核成立。**注意与 w8-kt-infra F-w8-kt-2 同族**（`TokenizerModule` 有 executor、`SkspModule` 没有，报告明确引 `TokenizerModule.kt:18-24` 的 2026-09-30 事故注释作对照）⇒ **两源，建议入账 P1** |

> **§6 的整体判断**：12 条里 **10 条已由 W11 复核成立**、2 条（#1 归并入 M-25、#7 产品待确认）留在原地。
> 这 10 条中 **6 条已有间接双源**（#4/#8/#12 有第二份报告的同址命中，#2/#5/#6 同源，#3 待补）。
> ⇒ **主代理若采纳「复核成立即可入账」的口径，P1 将从 39 增至 45、P0 不变**（新增 §6 #3/#4/#5/#8/#9/#10/#11/#12 中的 8 条，
> 另 #1 归并入 M-25、#6 并入 N-P1-05、#7 因产品待确认不涨）。
> v2 不擅自加这个口径，因为 v1 §6 的纪律原文是「单方发现的 P1/P0 **先就地复核再入账**」——
> 复核这一步本轮做了，但「入账」是主代理的动作。

---

## 7 · 用户拍板项清单（18 项，原 15 项 + 新增 3 项）

> 每项 = 一句话事实 + 默认建议。带 ★ 的是**阻塞项**（不答就卡住对应波次）。

| # | 议题 | 一句话 | 默认建议 | 状态 |
|---|---|---|---|---|
| **★1** | **快照锁定面解锁**（dead-backlog 争议 #1 / F-synth-dead-2） | core 617 条「确认死」里 173 条落在 `Object.keys(mod)` 快照锁定面；全仓 13 个包全部 `private:true`+`version:0.0.0`，`npm publish` 零命中 | 判「无仓外 TS 消费者」→ 解锁 A-type 99 条进批次 3。**硬门槛：解锁前必须实跑 `tsc -p packages/core` + 全量 `npm test`** | 原样，v2 加注：本轮 W11 已实跑 desktop renderer typecheck（424 条），**core/mobile 的这三项仍未实跑** |
| **★2** | **intentional 预留的存废**（dead-backlog 争议 #2 / D-311、D-314） | `resolveLatestReleaseFromList` 被 `about-and-update-check/spec.md:187` 明写「预留」；D-314 引用的 intentional 注释在代码里不存在 | D-311 **保留**；D-314 **可删** | 原样 |
| **★3** | **迁移双形态**（dead-backlog 争议 #3 / D-316） | `config-forms/shared/{depth-slice,application-model-id}.ts` 与 `domain/**` 同名同签名双份且内容不同 | 倾向「迁移残留」可删，但必须用户确认「共享形态不是为分端裁剪的产物」 | 原样 |
| **★4** | **三条 batch 通道的去留**（apps-desktop 争议 D5 / S-D-05） | `MESSAGES_HIDE_RANGE`/`SHOW_RANGE`/`TRUNCATE_AFTER` 的 UI 于 `722e27d5` 主动删除 | 走 B（真死删 + 连带清 10 个悬空符号）；若改走 A，`S-D-07` 立刻升 P1 | 原样 |
| **★5** | **哨兵字符甄别**（status.md mobile-runtime F-1） | 全仓 10 个文件含 U+FFFD 已入库；`sksp` 三处疑为哨兵字符 | 先只还原已核实纯注释的 7 个文件，`sksp` 三处单独人工看过再定 | 原样。**Wave A 编码批次 1 仍被这一项卡住** |
| **6** | **内存池预算**（core-runtime RT-03） | 4M 字符预算、命中率实测 0.400 | 本轮不动内存 | ⚠️ **本项已 stale**：`messageContentPool` 整层删除（`decoded-content-cache.ts:169-217`），该池不复存在；`message-content-perf-threshold.test.ts` 已改口径**不再测命中率**。⇒ 合并进新 #16 |
| **7** | **`sql-template` 约 900 行动态标签子系统的定位**（core-storage 争议 #1） | parser 428 + evaluator 137 + expression 161 + context 74 + placeholder 28 + tags，生产代码零使用 | 判「重构做了一半的死代码」→ 降 P3 清理 | ⚠️ **W9 部分证伪**：`sql-template/` 目录共 1057 行，`SqlTemplateParser` 是 **31 个 repository 的默认 SQL 出口、249 处调用点**，绝非零使用；**真正零使用的只是几类动态标签分支**。原默认建议的口径需收窄后重答 |
| **8** | **`MESSAGES_*` 之外的 IPC 仓外消费方**（apps-desktop 争议 D4/D8） | handler 注释称 `PROJECTS_*_AGENT_CONFIG` 是「兼容外部脚本」，但 Electron IPC 只有 renderer 能调 | 删前人工确认一次（`examples/`+`scripts/` grep） | 原样 |
| **9** | **`handleCloudSyncPull` 无条件 rebootstrap 的性质**（cloudsync D5） | `ALREADY_UP_TO_DATE` 时库文件根本没换，却仍关连接+重 bootstrap | 按漏判处理（条件化）。**条件化不能替代 S-CS-02 的单例失效修复** | 原样。⭐ W9 补一条旁证：同一 coordinator 的 `pull()` 连 `isAgentActive()` 都不查（= S-CS-03），**「pull 路径整体守卫稀薄」这条判断被再次加强** |
| **10** | **快照保留策略**（cloudsync D6） | 快照按 rev 命名只增不删 | 补 TODO 进 RULE，条目按 P2 债务登记 | 原样 |
| **11** | **`AgentRunOptions` 公开面是否收窄**（core-runtime D-2 / RT-14） | `EphemeralOverlayAgentSession` 91 行 + `persistMessages` + runner 内 8 处行为分叉各有测试锁定 | 先不动；无论结论如何，悬空 `{@link runRunAgentAction}` 必改 | 原样 |
| **12** | **webview-host 三「真源」模块的去向**（apps-mobile 争议 1 / AM-14） | 8 个导出里只有 `scrollTopForOffsetFromBottom` 一个真被用 | 接回去；其余 7 个死导出并入 dead-backlog 批次 3 | ⭐ **W8 加倍确认**：`menu-overlay-guards.ts` 的两个函数**生产零消费者**（全仓只命中文件自身 + 自己的测试），其语义被**手写内联**在 `web/.../menu/menu.ts:194-202`，并连带两个死常量（`LONG_PRESS_MOVE_TOLERANCE_PX`、`ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT`）；且 `bind-shell-events.ts:4-5` 注释 + `RULE.md:11` 双出处证明「长按开菜单」是**用户拍板退役**的。⇒ **这是本区最干净的一条可执行删除** |
| **13** | **AM-1 是否整体降 P2**（apps-mobile 争议 3） | `idleMessageViews` 存的是深拷贝，会话删除后用户可见数据仍以内存副本形式留存 | 不降级；**若最终决定降 P2，「加 LRU」这半个修法仍要保留** | 原样。⭐ revalidate-b 已复核「两张 Map 仍无界、无任何 LRU」⇒ **拍板项 #13 的「不降级」前提照旧成立** |
| **14** | **导航栈缺陷归属**（verify-apps-mobile 附带发现） | `navigateToChatTabFromNotification` 会压入第二个 `MainTabs` | 单开一条 P2，归属 apps-mobile | 原样。⭐ W9 独立佐证：`RootNavigator.tsx` 无 `getId`、调用未带 `pop` |
| **15** | **checkpoint 自愈通道是否补注册**（core-data D-3） | `createRevisionRefCountRepairOperation` / `createBaselineCheckpointBackfillOperation` 全仓只有测试调用 | 走 PRD：不注册，只在 RULE 记一句 | ⚠️ **v2 状态变更**：delta-overview §2.2 记录 v1.5.29 给 `vfs_revision.ref_count` 加了**第三类持有者**（消息侧 read/skill 引用）并把 repair 期望值**三类化 + 批量对账**（`revision-ref-count.ts:313-326`）——**这让「不注册」的代价比 v1 预估的大**：W10 双源确认 `createRevisionRefCountRepairOperation` 至今未注册（`novel-master-bootstrap.ts:420-423` 只注册了 sequence 那一支），而 `vfs-tools.ts:232-233` 的注释明写「+1 泄漏由 repair 检测兜底」。⇒ **本项须重答，且很可能要答「注册」** |
| **★16**（新） | **缓存池预算那一波是否整条撤下** | RT-03 量的池已被删除；CD-10 的 LRU 污染源已消失；`message-content-perf-threshold.test.ts` 不再测命中率 ⇒ Wave C「缓存池预算」与拍板项 #6 **同时失去对象** | **整条撤下，不重建基线**。理由：v1.5.29 的明文化链已经把「解压产物重复读」的成本量级彻底改了（存量压缩行的重复读每次都重新 inflate，`message-content-codec.ts` 是纯函数无进程内缓存），**按 v1.5.28 的形态估预算已经无意义**。若主代理认为明文化后仍需一版基线，则应**新开一条**、以「明文为主 + 少量存量压缩行」的工作集形态重测，而不是复活 RT-03 | **阻塞 Wave C 的缓存分支** |
| **★17**（新） | **`searchMessages` 的 LIKE 粗筛决策被本波推翻，谁来拍** | 台账原文（`synth/core-data.md:93` + 争议栏）记的是「RULE 拍板不采用 LIKE 粗筛」；RULE 现行口径已改写为「纯 ASCII keyword 走 parse 前 LIKE 粗筛命中才 parse」 | **采 RULE 现行口径**（即「有条件做」），并回改 `synth/core-data.md:93` 的原文表述，否则两份文档会长期互相矛盾。⭐ W10 双源提醒**粗筛本身有漏召面**（pro-1 与 adv-1 都指出守卫只查 keyword 侧的 Unicode 折叠、不查 content 侧；且 `%`/`_` 通配不拦——只过宽不漏召，可接受）。**这一项必须在 Wave B 之前答**，因为它决定 `sqlite-message.repository.ts:602` 那条谓词是否继续存在 | **阻塞 Wave B 的搜索面** |
| **18**（新） | **`SessionService` 是否增 `listByParentSession`**（wave-b-apps B-3 / G 节） | `forgetSession`（AM-1）需要按 `parentSessionId` 找子会话；当前 core 无此查询入口 | **不立条目，登记为 P2 债务**（AM-1 已有显式缺口 + TODO 兜底） | **🟩 无阻塞**。🔗 **R2-16 已裁**（judge-r1 G 节）：结论「不立条目」已写死为终态，`wave-b-apps.md:558-571` 声明不再回头请示 judge。**本行只为把登记位置补进台账，结论不动** |

---

## 8 · 争议不抹平：RT-01 的两条重验结论（留待主代理裁决）

**这是本轮唯一一处两份重验报告给出互相冲突结论的地方。v2 不裁决，原样并列。**

### 8.1 共同事实（两份报告无分歧的部分）

- 基线从 `9ca5f5ad` 走到 `fe79b781` 区间内，**只有一个提交改动过本条目的代码**：`e2d10b3f perf(core): agent 每步读收窄`。
- 该提交做了四件事（两份报告**逐字一致**）：
  1. `packages/core/src/service/agent/impl/chat-agent-session.ts:31-39` — `list()` 从「全量读 + 内存 `filter(!hidden)`」改成 `listBySession(id, { includeHidden: false })`，过滤下推到 SQL（`AND hidden = 0`）；
  2. `packages/core/src/service/agent/logic/assemble-agent-runner-deps.ts:68-78` — `listAllSessionMessages` 改名 `listVisibleSessionMessages`，同样传 `includeHidden: false`；
  3. `packages/core/src/service/agent/impl/agent-runner.ts:605-606` 消费点同步；
  4. 附带收益：`visible-floor.trigger.ts:21` 的第二次读也随之不再解压 hidden 行。
- **残留病灶（两份报告一致认定仍在）**：
  - `agent-runner.ts:604-606` 每个 gemini step 仍**独立发一次** `listVisibleSessionMessages()`，**无进程内 memo、无失效点**；
  - 仍是全列读：`sqlite-message.repository.ts:28` 的 `MESSAGE_SELECT_COLUMNS` 21 列（含 `raw_json`/`attachments_json`/`content_json`），**没有窄读口**；
  - 消费方 `gemini-content-mapper.ts:54-71` 的 `buildToolUseLookup` 依旧只要 `tool_use` 的 `id`/`name`。
- **v1 台账里的一句注记已作废**（两份报告都这么说）：v1 §1 写的「有意的是『覆盖 hidden』，不是『全量读』，两件事分开改」——
  `e2d10b3f` 改的**恰恰就是**「覆盖 hidden」那一半，且新代码给出了相反的论证（hidden 行对 `buildToolUseLookup` 零解析力，因为
  `normalizeOrphanToolResultsForLlm` 按可见集配对）。**该注记必须删。**

### 8.2 A 台（`synth/revalidate-a.md`）的结论：**partial，建议 P0 → P2**

> 原文：「危害量级从『全量（含压缩产物，通常是 hidden 占多数）』缩到『可见集全列』……**建议 P0 → P2**：
> 残余是纯性能债，无正确性风险，且已有 93.5% 的一次性收益落袋。」

论据链：
1. v1 台账的原病灶是「gemini 协议下每 step 一次全会话全量读（21 列、**含 hidden**、无 `includeHidden:false`）」——这是一个**复合命题**；
2. `e2d10b3f` 修掉了「含 hidden」这**一半**，另一半（无 memo + 21 列）仍在；
3. 复合命题被修一半 ⇒ 降级为 partial；
4. 残余部分**不涉及正确性**：hidden 行不进这条读路径后，`buildToolUseLookup` 的输入完备性不受影响（`gemini-content-mapper.test.ts:427-465` 钉了「可见集完备性」这个等价断言）；
5. commit message 自陈实测「每步两发 368.2 → 23.9ms」，**93.5% 的一次性收益已落袋**；
6. ⇒ 剩下的「可见集全列 + 无 memo」是纯性能债，不配 P0。

### 8.3 B 台（`synth/revalidate-b.md`）的结论：**partial，但把残留那半单独维持 P0**

> 原文（§7 建议 1）：「**RT-01 拆成两条**：①「gemini 每步读含 hidden」→ 已被 `e2d10b3f` 修掉（可见-only + SQL 下推），可降 P2 或直接核销；
> ②「每步仍一次 21 列全量读、无 memo、消费方只要 id/name」→ **维持 P0**，这才是剩下的那条。」

论据链：
1. 同意 ① 已修、可核销；
2. 但 v1 台账给 P0 的**核心论据是复合命题的后半**——「消费方只要 tool_use 的 id/name，而每步拉 21 列」这个**放大器**没被动；
3. commit message 里的 `3.9ms` 是**把 `:413` 那次读也算进去的合并数字**，不能当成「②已修」的证据；
4. 测试侧只钉了「可见集完备性」这个**等价断言**，**没有钉读口宽度**——即没有任何测试会因为「读口从 21 列收窄到 2 列」而红；
5. ⇒ ② 是 v1 P0 判定的真正标的物，它原封不动 ⇒ 维持 P0。

### 8.4 两案的分歧焦点（v2 归纳，不站队）

| 维度 | A 台 | B 台 |
|---|---|---|
| RT-01 是不是一个条目 | 是（复合命题，partial 降级） | 否（应拆成两条，② 维持 P0） |
| P0 的标的物 | 「含 hidden + 无 `includeHidden:false`」这一整句 | 「每 step 一次 21 列全量读、无 memo、消费方只要 id/name」 |
| 「无 memo」算不算正确性风险 | 算**性能债** | 算**未缓解的性能债，且 v1 的 P0 判定就是冲它去的** |
| 93.5% 收益的地位 | **收益已落袋**，故剩余不值得 P0 | **合并数字，不能当作 ② 已修的证据** |
| 建议动作 | 整条降 P2、移出性能改造队列 | ① 核销/降 P2，② 留 P0、继续留在 Wave C 收窄队列 |

**两份报告都同意的一件事**：修复方向不变（进程内 memo + 失效，或做窄读口），且 v1 §1 的那句「有意覆盖 hidden」注记要删。
**两份报告也都同意**：Wave 提案层面 21 条里**没有一条可以因为这次重验而划掉**（A 台原话）。

### 8.5 v2 的处理

- **v2 不给 RT-01 定级。** 它在 §1 的 P0 表里和 §2 的 P1 表里**都不出现**——
  台账里留一行占位：`RT-01（争议）— 原 P0，v1.5.29 修了「含 hidden」半；残留半的定级待主代理裁决（见 §8）`。
  §0.2 的定级分布已把它**同时从 P0 与 P1 的计数里剔出**，所以 v2 的 P0=5 / P1=39 都不含 RT-01。
- 若主代理采 A 台（整条降 P2）⇒ **P0 不变（5）、P2 从 155 升到 156**；
- 若采 B 台（拆成两条，② 维持 P0）⇒ **P0 从 5 升到 6、P1 不变、P2 不变**——因为 RT-01① 已修可核销、RT-01② 以新条目身份回到 P0。

---

## 9 · 附录 A：已被 v1.5.29 消化的条目（stale / 前提消失）

> 这一节登记**不得再当依据**的 v1 结论。注意：**它们不是「修好了」，是「标的物没了」**。

| ID | v1 结论 | v2 现状 | 证据 |
|---|---|---|---|
| **RT-03** | P2；消息正文池 4M 字符上界、命中率 0.53（W6 实测 0.400）、暖读≈冷读 | **前提消失**。`messageContentPool` 与三 API（`lookup`/`remember`/`forget`）**整层删除**（`infra/content-cache/logic/decoded-content-cache.ts:169-217`），池已改为内容寻址（键 = 明文 sha256，`:191-207`），`MESSAGE_CONTENT_POOL_*` 两个常量全仓零命中 | revalidate-b §6 + delta-overview §4.1 |
| **CD-10** | P2；`searchMessages` 全量精筛污染进程级 LRU，「一条都搜不到」等于把整会话 assistant 正文逐条 inflate | **病因消失、症状换形且被部分处理**。LRU 没了 ⇒ 不再有「冲掉别的读口热态」；主导成本从 `inflate` 变 `JSON.parse`。本波加了 parse 前 LIKE 粗筛（纯 ASCII keyword），召回红线由守卫保住 | `sqlite-message.repository.ts:593-608`、`:117-121`；commit `85abb7eb` |
| **CD-34** | P3；明文行分支直接 parse 不进 LRU，blob 行进；迁移期明文读口零缓存收益 | **前提消失**。两个分支都不进任何池，形态差异不复存在 | `decoded-content-cache.ts` 模块头 |
| **CS-11 的解压半边** | core-storage 争议 #7；`session.copy` 事务内全量解压（一次 copy = 解压 N 次 + 压缩 N 次） | **解压半边消失**（写侧不再压缩），但「事务内全量**读**」半边**仍在**。另 `batchInsert` 的让步理由从「压缩成本」换成「参数数组内存」 | `sqlite-message.repository.ts:213-222` 注释改述 |
| **CS-14 的数量口径** | port JSDoc 与实现相反（文档说嵌套 `transaction` 抛 `NESTED_TRANSACTION`） | 契约本身仍成立，但本波**新增了同一模式的第二份实现**：`sqlite-message.repository.ts:91` 的 `runInTransactionOrConn` 按同一形状复制了 `revision-aware-vfs.service.ts` 的模块私有函数（注释自陈「避免 domain 层反向依赖 service 层」）⇒ 数量口径需更新 | delta-overview §4.2 |
| **「`searchMessages` 不用 LIKE 粗筛」** | 台账记的是 RULE 拍板「不做」 | **被本波推翻**。RULE 现行口径已改写为「纯 ASCII keyword 走 parse 前 LIKE 粗筛命中才 parse」⇒ 转拍板项 ★17 | delta-overview §4.3 |
| **v1 §1 RT-01 的注记** | 「有意的是『覆盖 hidden』，不是『全量读』，两件事分开改」 | **已作废**。`e2d10b3f` 改的就是「覆盖 hidden」那一半，方向与 v1 建议相反（新代码论证 hidden 行对 gemini lookup 零解析力） | revalidate-a §4.1 + revalidate-b §1 |

---

## 10 · 修复波次提案（Wave A → E，v2 更新）

波次顺序原则不变：**A 零风险止血与门禁 → B 用户可见功能缺陷 → C 有回归风险的性能结构 → D 死码 → E 文档与防再犯**。
**划线 = 本波已被修或已被消化的条目**；**加粗 = 本波新增的条目**。

### Wave A · 零风险止血

| 条目 | 簇 | 动作 | 依赖/状态 |
|---|---|---|---|
| **RT-02** | core-runtime | `:519` 复用 `:413` 已拿到的 `visible.length` ⇒ 立刻减半每 step 会话读 | 无。**Wave C 的 RT-01 收窄以此为前置读数基线**。行号已刷新为 `:413`/`:519` |
| **N-P0-02** ⭐ | apps-desktop | `run-tests.mjs:30` 单引号改双引号 + 零收集守卫 `process.exit(1)` + `:23-26` 注释中性化 | 无。**这是本波优先级最高的一条**——它挡住的是「开发者本地的全绿是假的」，其他所有门的可信度都挂在它下面 |
| **N-P0-03** ⭐ | apps-cli | 给 CLI 加 agent 创建入口（否则全新机器开不了第一个会话）；`[nm-boot]` 迁移日志改走 stderr | 无。26 条红灯逐条归因在这两条之后做 |
| **CI typecheck 转 blocking** | apps-desktop | 删 `.github/workflows/ci.yml:62` 的 `continue-on-error`；顺带记一笔 mobile `--max-warnings 321` 与实测 405 的差距 | 无。**Wave E 的 X1 全量收口靠它兜底** |
| **A-14 search filter 死路径早退** | core-tool | 闸门**是 intentional**，但 `resourceQuota` 零读取方、search filter 死路径仍可清理 | 无。**清理时不得动闸门装配点与 policy 调用** |
| **编码还原批次 1** | apps-mobile | 从父提交还原 178 个 U+FFFD（**仅注释**）与其余已核实纯注释的损坏文件；`sksp` 三处**先过哨兵字符甄别** | 需拍板项 ★5 先答。**不得改 RUNTIME 字符串** |

### Wave B · P1 功能缺陷

| 条目 | 簇 | 动作 | 依赖/状态 |
|---|---|---|---|
| **云同步生命周期包** | cloudsync + apps-desktop | `S-CS-01`(P0) + `S-CS-16`（同一修法，记账移到 rebootstrap 之后）+ `S-CS-02`（单例失效）+ `S-CS-07`（备份三处吞错）+ 争议 D5（`handleCloudSyncPull` 无条件 rebootstrap → 条件化） | **必须同一 PR**。`S-CS-07` 独立可先落且优先级最高（唯一不可逆本地数据丢失）。⭐ 拍板项 #9 的旁证：`pull()` 连 `isAgentActive()` 都不查，「pull 路径守卫稀薄」被再次加强 ⇒ **D5 条件化时顺手把 `S-CS-03` 的入口复检一起做** |
| **N-P1-04** ⭐ | apps-desktop | `WorkspaceSettingsView` 的 600ms 定时器读 ref 最新值（或显式传参）⇒ 修「压缩配置最后一次输入永远丢失」 | 无。**双扫双中**，改动零风险，用户可感 |
| **§6 #5** ⭐ | apps-desktop | `ChatHistorySearchPanel.tsx:106` 改 `.message` ⇒ 修「查询失败面板白屏」 | 无。**单源但机理无争议**（类型系统已报 TS2345），建议一并落 |
| **CS-01 renamePrefix** | core-storage | `REPLACE()` → `substr` 拼接 + 补「子树含同名目录」回归 | 无 |
| **RT-04 persist 塌缩** | core-runtime | `definitionToDocument` 前跑 `validateAgentPromptLayout`（**第二份同款循环在 `project-agent-config.schema.ts:29-36`，一并处理**） | 无 |
| **RT-08 模板拉取漏清缓存** | core-runtime | 事务提交后调 `clearSessionPromptCaches` | 无。**四源印证，最该先修的一条** |
| **AM-1 forgetSession** | apps-mobile | 三处删除成功分支补调 + 两张 Map 挂 500 LRU | 无 |
| **N-P1-01** ⭐ | core-storage | `project.service.ts:185,188` 的裸 `deleteVfsPrefix` 换成 `sweepRevisionsUnderScope` ⇒ 止住 revision + blob 的永久泄漏 | 无。**与 CS-04 同一族修法（都是「顺序约束」），可合并成一个 PR** |
| **S-CS-04 busy 泄漏**（≡ AM-2） | cloudsync | `createCoordinator` 移进 `try` + 补令牌回 false 单测 | 无（不同文件，可并行） |
| **N-P1-02** ⭐ | core-misc | `normalizeAgentPromptLayout` 白名单补 `skillsEnabled`/`skillsPrefix` + exhaustiveness 断言 | 无。**Wave E 防再犯钩子 ② 的真实靶子** |
| **SSE `data:` 无空格** | core-misc (M-06, P2) | 解析器接受 `data:{…}` 无空格形态 | 无。虽判 P2 但**用户可感**（run 以「空回复」正常收尾），提前到此波 |
| **`summarizeToolInput` 三处统一** | core-misc | 同一调用在三个面渲染不同，统一到 core 单源 | 无。纯收敛 |
| **（同波顺带）** M-03 / M-04 / CS-02 / CS-04 / CS-07 / CS-08 / B / AM-3 / S-D-02 / **§6 #8** | 多簇 | 全部量级 S、零结构变更，打包成一个「P1-S 批次」PR | 无 |

### Wave C · 性能结构（回归风险最高）

| 条目 | 簇 | 动作 | 依赖/状态 |
|---|---|---|---|
| **全量读收窄系列** | core-runtime + core-data | RT-01（见 §8，**定级未定则这一格的 RT-01 部分待裁决**）+ CD-01 fork 缺上界读口 + `truncateAfter` + `subagent-tool.ts:219` | **RT-02 必须先落**。⭐ delta-overview §3.3：RT-01 的修复**没有**顺带解决 RT-02 |
| ~~**缓存池预算**~~ | core-runtime (RT-03) | ~~取真实命中率再决定是否提到「最大可见工作集 ×2」~~ | ⛔ **整条撤下**——对象已删、测量载体已无。转拍板项 ★16 |
| **事务边界收窄** | core-storage + core-data | CS-05 分片提交 + backfill 移出事务 + CS-11 copy 走 header 投影或 `INSERT...SELECT`（**改写后直复 `content_json`**）+ CS-06/07 revision 对齐 + `backfill` 倒扫改单查询 JOIN + core-data `listBySessionOffset` header 投影 | CS-07 **必须在 CS-06 之后**。**CD-01 修法与本波性能结论冲突**：W6 明确否掉「`resolveReconcilePathSets` 整体移进事务」，改为事务内复用已有扫描做集合断言 |
| **N-P1-06/07** ⭐ | core-misc | `smart-sort-rule` 的 `importRules`/`resetDefaults`/`deleteBatch`/`setEnabledBatch`/`reorderRules` 各自包单事务；`renumber` 下沉为 repo 的单条批量 UPDATE（被三处复用） | 无。**这一组是「多语句无事务」的通用形态**，建议先在 service 层加一条「跨 N 次 repo 调用必须包事务」的评审约定 |
| **CS-09 ZIP 解析闸** | core-storage | 解析器内累加体积/条数，越限即抛 | 无。**建议与 Wave B 并行**（用户可感的安全面）。⭐ W8 双源印证 |
| **CS-10 AST 缓存** | core-storage | 先给 checkpoint 仓储三方法补 900 分片 | 无。⭐ W9 双源印证（pro 逐条核 17 处拼 IN + adv 指出同文件另一路径已有分块） |
| *定级注记（CR R1 OQ19, 2026-10-02）* | — | CS-10 已按 C2-9 降级口径同步为 **P1·一致性/防御性封顶**（非紧迫性 P1），实现见 c667be0f 的 900 分块 | — |
| **C1-13 补记账**（CR R1 c1/P2-2） | core-data | `listBySessionOffset` 头投影随 c667be0f 落地（21→6 列，G1/G2/G3 已钉） | — |
| **§6 #8/#9/#10** ⭐ | infra-llmproto | gemini 同名并行调用归并键、anthropic `max_tokens` 硬上限、partial 路径 `thinkingSignature` | 无。**若主代理把 §6 升为入账，这三条进本波**（它们是协议层，回归面窄但影响面宽） |

### Wave D · 死码删除

| 批次 | 条目 | 量 | 开工前置 |
|---|---|---|---|
| **批次 1（零连带，16 条）** | D-101 ~ D-116 | ≈2236 行 | 无。三处施工单修正照 v1：① D-101 理由改写为「静默回退工作区、非 ENOENT」② D-109 锚点补 `:5 EXIT_RUNTIME` ③ D-116 **选 B1-a**（只删 `isTaskToolUse`，保留 `resolveSubagentSessionId`） |
| **批次 2（有测试/配置连带，9 条）** | D-201 ~ D-209 | ≈248 行 | **必须先 rebuild core**（`packages/core/dist` 是旧的，mobile jest 30+ 条 `moduleNameMapper` 直连 `dist/**`） |
| **批次 3（需先过裁决）** | 3.1 core 符号级 348 条；3.2 级联 17 条 | ≈386 行 | 拍板项 #1 与 #3。**⭐ 新增三组目标**：① `AgentDefinitionEditorForm.tsx`（1048 行零引用，w9-desktopfeat 对抗裁决降 P2 后并入）② webbridge 死协议 `messagePatch`/`log` + `menu-overlay-guards.ts` + 两个死常量（拍板项 #12 的落地）③ prompt 侧 `validate-prompt-blocks.ts` + `PromptBlock` 联合类型（**注意：`prompt-block.ts:11` 的 `PromptBlockLifecycle` 仍活着，不能整文件删**） |
| **死通道** | S-D-05 终裁：真死删 8 条 | — | 每条须同步改四处 + 相关测试。`VFS_START_DRAG` 是口径修正非断链 |
| **须先拍板的 3 条通道** | `MESSAGES_HIDE_RANGE` / `SHOW_RANGE` / `TRUNCATE_AFTER` | — | 拍板项 ★4 |
| *归因订正（CR R1 dead/P2-1, 2026-10-02）* | renderer 411→371 净减 40 中 **Wave D 自身只占 13**（AgentDefinitionEditorForm 12 + preview-annotate-source-anchor 1），其余 27 条为 Wave C 战果——回退 Wave D 两 commit 实跑会到 384 而非 411 | 声明 ratchet 数字必须写直接父提交实跑值（K8 通则） |
| **验收线** | — | — | 每批跑完必须：`tsc --noEmit`（core/desktop/**renderer**/mobile）+ `npm test`（三包）全绿。⭐ **W11 已实跑 `npx tsc --noEmit -p apps/desktop/tsconfig.renderer.json` = 424 条错误** ⇒ **这一项现在是「已知红」而非「未知」，必须先把它纳入验收线的基线记录**，否则批次 1 跑完会误判为新增回归 |

### Wave E · 文档与防再犯

| 条目 | 动作 | 依赖 |
|---|---|---|
| **RULE 提交** | 主仓 `docs/apm/RULE.md` 的 2026-09-29 修正**已在工作区但未提交**（`git status` 显示 M），worktree checkout 的是旧提交版 | **用户动作**（代理禁写 `docs/apm/`） |
| **X1 门禁全量收口** | S-D-06 的 9 处 renderer→core 违规 + driver 包 tsconfig 覆盖 + desktop 2 条 `no-regex-spaces` + core 3 条；`shared/logic/events.ts` 自身 2 符号零消费 | **依赖 Wave A 的 typecheck 转 blocking** |
| **⭐ 渲染层 typecheck 门禁**（新） | 加 `typecheck:renderer` script 并进 CI。**基线是 424 条错误，不是 0** ⇒ 必须分批清账（`SettingsViews.tsx` / `AgentEditorView.tsx` / `ModelSamplingView.tsx` / `AgentDefinitionEditorForm.tsx` 四件占大头），**先把它变成「可见的红」再谈降到 0** | 依赖 Wave A 的 typecheck 转 blocking |
| **⭐ WebView 产物门禁**（新） | `build-webview.mjs` 加门禁：bundle 里出现 `Object.fromEntries`/`replaceAll`/`.at(`/`Object.hasOwn` 即 fail。**这是 N-P0-01 的唯一防再犯钩子**——那个 P0 的成因就是「产物里跑了一个 IIFE 顶层的 ES2019+ 调用」，源码面完全看不出来 | 无 |
| **⭐ `tsconfig.test.json` paths 与 `package.json` exports 对齐**（新） | `packages/core/tsconfig.test.json:26` 的 `@novel-master/core/kkv` 指向内部 barrel，exports 指向公共 barrel ⇒ 「package exports 契约测试」验的是错的 barrel。补一条测试真解 `dist/public/kkv.js` | 无 |
| **防再犯钩子 ① 编码** | 提交钩子 + CI 加 U+FFFD / BOM 扫描（core 内 4 个文件带 BOM 与编码批次同批处理） | 无 |
| **防再犯钩子 ② 白名单完整性** | `normalizeAgentPromptLayoutDomain` 白名单**连续两次漏新增字段**（上次 `customAttach`、这次 `skillsEnabled`/`skillsPrefix` = **N-P1-02**）→ 加 exhaustiveness 断言而非逐字段补 | Wave B 的 N-P1-02 同波可一起做 |
| **防再犯钩子 ③ 编码归一** | front matter 单源：desktop `buildNewSkillDoc`（**W9 双源确认仍未转义**）与 skill-ui 手拼两处下沉 core | Wave B 同波 |
| **防再犯钩子 ④ 边界用例** | `chunk-splitter` 的 `assertInvariants("。".repeat(200))` / `("。\n".repeat(200))`（**当前实现下会红**，是有效回归） | 无 |
| **防再犯钩子 ⑤ 测试缺口** | `rollback-empty-target-guard.test.ts` 补 rewind 空树断言（**revalidate-b 实测：现有 3 条全是 `undo_send` 路径**）；`findSavedModelReferences` 补 `chat_session` 端到端回归；`model-request-retry.test.ts` 补「attempt1 产出后失败 → 断言 onStream 未被二次驱动」 | 无 |
| **⭐ 防再犯钩子 ⑥ 零收集守卫**（新） | 任何 `node --test` / `vitest` 包装脚本都必须有「收集数为 0 ⇒ exit 1」的守卫。**N-P0-02 的教训是：单引号 + `shell:true` 在 Linux 上是绿的，在 Windows 上是静默空跑**——这类 bug 只能在「两种 shell 都跑一遍」的门禁里被抓住 | 无 |
| **注释承诺 ≠ 实现** | `chunk-splitter.ts:12-14` 的「保证逐块 encode ≤64」在句末符密集输入下不成立；RULE hidden 过滤指向测试假件 | Wave B/C 对应修法落地时同步 |

---

## 11 · 口径与已知盲区（v2 更新）

- **归并口径**（不变）：同 `file:line` + 同根因 ⇒ 合并为一条；同 `file:line` + 不同根因 ⇒ 拆条。
  对抗裁决优先于单方定级。**本轮新增一条操作口径**：对抗双方指向同一 file:line 但级别不同时，
  **取低者并记录高者的论据**（用于 §4 的 mitigated 裁决）。
- **单源处置口径**（不变 + 本轮落地）：单方发现的 P0/P1 先就地复核再入账。W11 对 §6 的 12 条做了抽查，10 条成立、2 条留原地。
- **行号纪律**：v2 已把全部受 v1.5.29 影响条目的行号刷新到 `fe79b781`（W11 逐行打印核对过 RT-01/RT-02、
  S-CS-08、CS-03、CS-11 等），但**未受影响条目的行号仍以各 raw 报告的报告时点为准**，引用前请以 `git log -1` 复核。
- **v1 §6 的未实跑硬门槛仍未解除**：`tsc -p packages/core` / 三包 `npm test` 全绿 **W5–W11 均未执行**。
  本轮只实跑了 `apps/desktop` 的 renderer typecheck（424 条，已记为已知红基线）。
- **本轮未覆盖/未实跑的扫描面**：
  - 4 个 Kotlin 原生文件（cli-periph）仍是盲区之外的盲区——W8 的 kt-sse/kt-infra 与 W10 的 kt-sksp **只覆盖了 3 个**，
    `sksp-windows`/`sksp-mac`/`sksp-linux` 三个包的 TS 侧与 Kotlin 侧都未深审；
  - `apps/cli/test` 的 26 条红灯**只归因了 2 条根因**，其余 24 条未逐条归因；
  - mobile 6 个 renderer 大文件只做符号级追踪；
  - apps-desktop 6 个 handler 共 1211 行未逐行；
  - S-CS-01 的 mobile 侧未在 op-sqlite 上实测；
  - `webview-dist/**` 三个 bundle（8.6MB / 8.0MB / composer-input）**只审了 composer-input 一个**（因为只有它命中 P0），
    另两个的产物面是否有同类顶层 ES2019+ 调用**未查**。
- **移动端 debug 包纪律**（AGENTS.md 硬规则，本轮未触发任何真机测试）：Metro 从真实路径起、禁内嵌 bundle、
  真机测试包统一 versionCode=1、一律 `adb install -r -d`、**任何设备永远禁止 uninstall**、荣耀真机需用户在场确认。
- **哨兵字符**：仓库根目录 4 个空目录（`(echo`、`exist`、`OK)`、`if`）仍是历史 Windows shell 转义事故产物，不在 CR 范围。

---

## 12 · v2 与 v1 的差异索引（便于回查）

| 你要找 | 看这里 |
|---|---|
| 某条 v1 条目在 v1.5.29 之后还在不在 | §0.3 的 34 条 revalidate 明细 + 各簇表「印证强度」列的「revalidate-X valid」 |
| 本轮新增的 P0 | §1（N-P0-01/02/03） |
| 本轮新增的 P1 | §2.4 N-P1-01 / §2.5 N-P1-02、N-P1-06、N-P1-07 / §2.7 N-P1-03 / §2.8 N-P1-04、N-P1-05 |
| 本波被 refute 或降级的 | §4.1~§4.3 的 dismissed/mitigated 行 |
| 被 v1.5.29 消化掉的（不得再引用） | §9 附录 A |
| 多视角补扫到底有没有用 | §5 一致率表（8 区 / 24 份报告 / 约 30% 一致率 / 62 条仅单方） |
| RT-01 到底怎么算 | §8（**本文件不裁决**；v2 把它同时剔出 P0 与 P1 计数） |
| Wave 计划变了什么 | §10（新增 6 行、撤下「缓存池预算」1 行、RT-01/RT-02/S-CS-08/CS-03/CS-11 等行号刷新） |
| 用户要答的问题变了什么 | §7（原 15 项 + ★16/★17 两项新增；#6 转 stale、#7 部分证伪、#15 状态变更、#12 加倍确认） |

---

*本文件由 W11 终局拼装产出。口径冲突时：**本文件 > revalidate 报告 > delta-overview > 簇台账 > raw 报告**。
本文件唯一刻意**不裁决**的地方是 §8 的 RT-01——两份重验报告的论据已原样并列，留给主代理。*

---

## §8.1 RT-01 定级终局裁决（主代理，2026-10-01）

**裁定：P0 → P1。** 两侧重验论据事实一致、仅定级分歧：①「含 hidden」已由 e2d10b3f 修复（listVisibleSessionMessages）；②「每 step 全可见正文拉回、无 memo」仍在——但 v1.5.29 明文化把单行成本从 inflate 降到 JSON.parse，量级显著下降，不再是 P0；修法不变（buildToolUseLookup 幂等单调 → memo+失效范式，或 tool_use 专查读口），按 P1 排进 Wave B。RT-01 自争议池入账 P1（v2 终局 P1 39→40）。
