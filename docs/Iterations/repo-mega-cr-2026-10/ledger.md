# 全项目 CR 终局台账 · repo-mega-cr-2026-10

> **唯一权威清单。** 本文件是 W1–W7 全流程（49 份 raw 报告 → 8 份簇台账 → 8 份 W6 验证报告）的
> 唯一收敛出口。簇台账保留证据原文，验证报告保留复核过程，**定级与去重的最终口径只以本文件为准**。
>
> 基线：`main@9ca5f5ad`（worktree `D:\Dev\nm-worktree\mcr`）｜合成日期 2026-10-01
> 输入：`synth/` 下 8 份簇台账 + 8 份验证报告 + 上级 `status.md`（主代理裁决记录，含 D-1/D-6 裁决与 W1 各封印）

---

## 0 · 全局统计

### 0.1 三段口径

| 阶段 | 口径 | 数量 | 来源 |
|---|---|---|---|
| **① 原始发现** | raw 报告自报条目（含 intentional/负例不计入） | **≥ 574**（声明口径）+ 死表桶 2 077 | core-data 137 / core-storage 116 / core-misc 134 / apps-mobile 108 / apps-desktop 79；core-runtime 与 cloudsync 两簇 front matter 未声明 raw 数，死表侧另计 617+2+356（core）+700+224+178（apps） |
| **② 归并后** | 8 份簇台账去重合并 | **358** | 各簇 front matter 逐份相加 |
| **③ 验证后终局** | 应用全部 W6 verdict + 跨簇去重 | **359** | 本文件 |

### 0.2 终局定级分布

| 级别 | 归并(②) | 终局(③) | 变动来源 |
|---|---:|---:|---|
| **P0** | 3 | **3** | 无变动，全部经主代理封印或 W6 免验再撞见 |
| **P1** | 39 | **32** | −6（验证层核销出池）−3（跨簇重复）＋2（verify-apps-desktop 盲扫新增） |
| **P2** | 144 | **150** | +5（P1 降级）＋1（verify-apps-desktop 条目 D 已定为 P2） |
| **P3** | 172 | **174** | +1（P1 降级）＋1（verify-apps-desktop 附带观察 R6） |
| 合计 | 358 | **359** | |

### 0.3 验证层核销明细

W6 共处理 P1 **35 条**（另有 2 条主代理封印免验：RT-01 / RT-02）：

| verdict | 条数 | ID |
|---|---:|---|
| **confirmed** | 21 | RT-04、RT-08、CD-01、CS-02/03/04/05/06/07/08/09/11、M-03、M-04、S-CS-04/07/08/09/16、AM-1/AM-3 |
| **refuted（整条）** | 1 | M-05 的危害链（机制仍 confirmed，降 P2） |
| **adjusted → 出 P1 池** | 5 | RT-03↓P2、RT-05↓P2、RT-06↓P2、RT-07↓P3、M-02↓P2 |
| **adjusted → 维持 P1 但改写** | 3 | CS-10（泄漏面收窄+实测数字）、S-CS-02（发现第二个死句柄）、S-CS-03（暴露面收窄） |
| **免验（主代理封印）** | 2 | RT-01、RT-02 |

**纯驳回、未入台账的疑似项 6 条**：apps-desktop 盲扫的 R1–R5（正则 flag 有状态 / `general` sentinel 撞 id / `loadAgent` 竞态 / persist index 不同源 / `applyDefinition` 展开覆盖）——全部经 grep 与读码 refute；另 D-101 的「跑一次即 ENOENT 崩」子命题被 refute，且风险**上调**（脚本不会崩，会静默把 `AgentEditorView.tsx` 回退到 2026-06 版本）。

**验证层推翻的具体主张（后续不得再当依据）**：① RT-03「poolHitRatio 0.53」实测 0.400，且「修 RT-01/02 缓解大半」证伪（只省约 17%）；② RT-05「用户零反馈 + chip 不收敛」——两端都有一次性错误 toast，`resolveUnpairedToolStatus` 在 run 结束后收敛到 error；③ RT-06「desktop 整棵工作区树 reload」——只对子会话成立；④ RT-07「子会话页永久卡运行中」——mobile 子会话单元在 `onRunStarted` 懒创建，STARTED 未发则单元根本不存在；⑤ M-02「含冒号即失效」——全角冒号在 YAML plain scalar 里合法，实跑两端皆 valid；⑥ M-05「块长护栏被绕过 → O(len²) 回归」——护栏在 `incremental-token-counter` 自己的 64 字符硬切，实测 16000 字符病态输入 786ms 反而快于同规模 CJK 对照。

---

## 1 · P0 终表（3 条）

| ID | 簇 | 病症 | 位置 | 印证强度 | 一句话修法 |
|---|---|---|---|---|---|
| **S-CS-01** | cloudsync | pull 成功后的 rev 记账写进一条**已被 pull 自己关掉**的连接，必抛 `CONNECTION_CLOSED`；库文件已换但 UI 记成失败，rev 永不推进 → 反复拉同一 rev | `apps/desktop/src/main/services/cloud-sync.service.ts:255-256`；`apps/mobile/src/services/cloud-sync.service.ts:341-345`（链路：`:255` → `configStore`（构造期绑定 `runtime.kkv`）→ `importSnapshotFromPath` → `importDatabaseBackupFromPath:115` → `closeLiveDbForBackupImport()`） | **最强**：对抗对双方独立收敛到同一条并各给 P0；adv 带真实 better-sqlite3 驱动实测；W5 复核源码调用链闭合；**W6 免验轮内独立撞见三次**（desktop 构造绑定 / 两段式 close / 两处 import 的 `.catch` 吞错） | 记账必须发生在 `rebootstrapDesktopRuntime()` / `onRebootstrap()` **之后**，用重建后的 runtime 重新取 configStore；或让 `importDatabaseBackupFrom*` 返回「连接已换代」信号由调用方在重建后写。两端同改 |
| **RT-01** | core-runtime | gemini 协议下**每 step** 一次全会话全量读（21 列、含 hidden、无 `includeHidden:false`），而消费方 `buildToolUseLookup` 只要 tool_use 的 `id`/`name` | `packages/core/src/service/agent/impl/agent-runner.ts:587-588`（装配见 `logic/assemble-agent-runner-deps.ts:67-68`，消费方 `infra/llm-protocol/logic/gemini-content-mapper.ts:339`） | **多源**：w3-xc-fullread-1 + w2-core-service-agent 数据访问表（独立登记同一行号）；**主代理逐字封印**；W6 旁证确认在 `for (let step...)`（`:398`）体内、协议条件正确 | 优先做进程内 **memo + 失效**（`buildToolUseLookup` 幂等单调增长，失效点照抄 `invalidateSessionApiPromptTokenEntry` 范式），退一步做窄读口。**注意：有意的是「覆盖 hidden」，不是「全量读」，两件事分开改** |
| **RT-02** | core-runtime | runner 每 step **两次**独立全会话读：`:405` 自己 `session.list()`，`:506` 的 `shouldRequestCompaction` 经 `VisibleFloorTrigger` 再读一次，两次读互不共享 | `agent-runner.ts:405` + `:506`（→ `domain/compaction-conditions/triggers/visible-floor.trigger.ts:21`） | **多源**：w3-xc-fullread-2 + w2-core-service-agent；**主代理逐字封印**；W6 旁证确认 `:403` 声明 `stepCompactionEmitted`、`:504-522` 传 `this.deps.session`、两次读无共享 | 把 `:506` 换成复用 `:405` 已拿到的 `visible.length`（触发器入参改传条数）——**零新增接口、零语义风险、立刻减半** |

---

## 2 · P1 终表（32 条）

印证强度缩写：**封印** = 主代理实跑/逐字封存；**多源** = ≥2 份独立报告撞车；**实跑** = W6 用生产代码/真实驱动跑出观测；**读码** = 单源但机理与可达路径已重推导闭合。

### 2.1 core-runtime（2 条）

| ID | 位置 | 印证强度 | 一句话修法 | 量 |
|---|---|---|---|---|
| **RT-04** | `domain/agent/model/agent-definition.schema.ts:222-229` + `logic/validate-agent-definition.ts:73-89` | 封印（三步实锤）+ 多源 + W6 读码 | `definitionToDocument` 序列化前先 `validateAgentPromptLayout(def.prompts)`，一次性消掉同款序列化循环的第二副本 | S |
| **RT-08** | `service/template/impl/template-pull.service.ts:24-36` | 封印 + 跨簇独立撞车（w3-xc-cache-lifecycle-1 × w2-core-service-vfs P1-1）+ W6 判「六条里最实、无任何现存缓解」 | 事务提交后、`runDeferredBlobGc` 旁调 `clearSessionPromptCaches(sessionId, kkv)` | S |

> RT-04 范围已由 W6 收窄：不是「域模型」层问题，是 **LLM `agent` 工具写路径**的问题（UI 编辑器路径有 `validateAgentPromptLayout` 守卫）。但后果是静默丢提示词块 + 无错误回传，维持 P1。
> RT-08 的实际危害比原判更宽：连带 `rule_snapshot` 一起陈旧 ⇒ 目录规则求值结果也停在 pull 之前，**UI 文件树显示新内容、模型看到旧内容**。

### 2.2 core-data（1 条）

| ID | 位置 | 印证强度 | 一句话修法 | 量 |
|---|---|---|---|---|
| **CD-01**（含争议 D-6） | `service/message-checkpoint/impl/message-rollback.service.ts:144-264,203-216,399,562-565`；`logic/resolve-reconcile-paths.ts:42,90-93`；`logic/restore-path.ts:145-149` | 4 源印证 + 对抗裁决 upheld + **D-6 争议 W6 confirmed**（4 个断点逐环节实读在位） | 按 W6 重排的优先级四步：① rewind 空树护栏（S-13 放宽为「任何模式下 targetTree 为空即降级弹窗」）→ ② 文件维度指纹乐观锁（复用已有 `listSessionFileHeads` 扫描做集合摘要）→ ③ 删集合事务内重算 → ④ tailIds 断言（近乎冗余，可留作加固） | L |

> W6 修正三点：① 「三个独立机制」降为**两条独立 + 一条派生**（`pathsNeedDelete` 计划外那条已被 `COUNT(*)` 检查完全门控）；② 后果应改述为「回滚对个别文件静默不生效」，**真正删文件的是 D-6 的 rewind 空树**——无声删光整会话工作区，无确认无降级无日志；③ 触发面需补：desktop/mobile 有 `running` 入口守卫，残余触发面是**确认弹窗窗口（两端都不复查）+ CLI（无守卫）**。`rollback-empty-target-guard.test.ts` 只有 `undo_send` 一条断言，rewind 空树路径零覆盖。

### 2.3 core-storage（11 条）

| ID | 位置 | 印证强度 | 一句话修法 | 量 |
|---|---|---|---|---|
| **CS-01** | `domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:936` | 多源（w2 实测复现 + pro 推理）+ W6 免验轮核过 SQL 全文 | 改 `SET path = #{newWithSlash} \|\| substr(path, length(#{oldWithSlash})+1)`，补「子树含同名目录」回归用例 | S |
| **CS-02** | `domain/vfs/logic/compute-replace-result.ts:55-60`；`domain/tool/builtin/vfs-tools.ts:297`；`skill-tool.ts:278` | W6 **实跑**（探针 `LOOPED FOREVER` / newString 被拼到全文头部），入口数由 1 修正为 2 | 入口 `oldString.length === 0` 直接抛 `vfsReplaceNotFound`；两条 zod 各补 `.min(1)` 对齐 `path` | S |
| **CS-03** | `domain/vfs/logic/longest-common-substring.ts:52-54,76`；`compute-replace-not-found-error.ts:55` | 多源 + W6 **实跑**（堆涨 689MB / `RangeError` 栈溢出 / spread 上限 ≈2×10⁵） | DP 换滚动两行（O(min) 空间）+ `Math.min(...arr)` 换循环 + 超阈值降级为「不做 LCS 只回基础诊断」 | M |
| **CS-04** | `domain/vfs/logic/vfs-tree-copy.ts:397-410`；`sqlite-vfs-revision.repository.ts:604-614` | 代码已核 + W6 把受害调用方由 3 **修正为 5** | 把 `deleteUnreferencedUnderScope` 挪到 `deleteVfsPrefix` **之前**（对齐同仓 hardDelete 注释承认的顺序约束） | S |
| **CS-05** | `service/vfs/impl/vfs-zip-io.service.ts:199-244`；`character-card-import.service.ts:140-182`；`vfs-batch-io.service.ts:291-305` | 3 站点归并 + W6（单文件语句数 5→6；补 batch-ingest **无条数/体积闸门**） | 分片提交（每 200 文件一个短事务）+ delete-prefix 单独先行 + `backfillBaselineCheckpoints` 挪到导入事务**之后** | L |
| **CS-06** | `vfs-batch-io.service.ts:94,100-101`；`apps/desktop/src/main/services/vfs-batch.service.ts:210-226` | W6 读码 confirmed（并确认它**直接生产 CS-07 的前置态**） | `writeOrUpdateFile` 改走 `RevisionAwareVfsService` / `insertFileSeedingRevision`，保证 head 与 revision 同步 | M |
| **CS-07** | `bootstrap/vfs/vfs-revision-schema.ts:45-54` | W6 confirmed（触发前提已改写：entry-only 引用者先于 revision 引用者存在） | DELETE 触发器加 `AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = OLD.content_hash)` | S（**须在 CS-06 之后**） |
| **CS-08** | `vfs-batch-io.service.ts:399-406`（对比同文件 `:164-178` / `:412` / `:426`） | W6 读码 confirmed（结构体逐字吻合） | 文件分支改用 `exportRelativePath(...)`，与目录分支统一；顺带给 `BatchExportPlan` 加 `skipped` 通道 | S |
| **CS-09** | `domain/vfs/logic/vfs-zip-central-dir.ts:88-108`；`vfs-zip-io.service.ts:189-192`；`domain/skills/logic/preview-skill-zip.ts:35` | W6 confirmed（补「炸弹路径只在 DEFLATE 分支」这一限定） | 解析器内累加 `uncompressedSize` / `totalEntries`，越 `VFS_ZIP_MAX_*` 立即抛 `PAYLOAD_TOO_LARGE`；技能预检同款 | M |
| **CS-10** | `infra/sql-template/parser.ts:45-55`（真凶收窄至 `sqlite-message-checkpoint.repository.ts:112/366/390`） | W6 **adjusted**（VFS/session-kkv 的 arity 被分片封顶；真正无界的是 checkpoint 仓储三方法；数字换成本机实测 3200 arity → 812MB） | 先给 checkpoint 仓储三方法补分片封顶 arity（优先级高于全局 LRU），再谈 parser 级 LRU | M |
| **CS-11** | `service/chat/impl/session.service.ts:338,374` | W6 confirmed（对照：fork 已治，copy 是漏网的那个） | 换 `listMessageHeadersBySession` + 事务外取 body 段，或让 `batchInsert` 走 `INSERT...SELECT` 直复 blob 列 | M |

### 2.4 core-misc（3 条）

| ID | 位置 | 印证强度 | 一句话修法 | 量 |
|---|---|---|---|---|
| **M-01** | `service/provider/impl/model-request.service.ts:81,226`（+ `llm-sse-transport.ts:673-682` / `agent-runner.ts:724,1061-1068`） | **三源印证顶格 + W3 实跑复现**，主代理指定免验 | 重试判定引入 attempt 级「本次是否已产出」探针：`emitted === true` 时不重试、直接上抛走既有失败收尾链（语义与 `LlmStreamTimeoutError.idle` 对齐，天然消除重复计费） | M |
| **M-03** | `domain/workplace/logic/load-or-fill-file-cache.ts:214-222`；`service/workplace/assemble-workplace-display.ts:188-195`；`workplace-display.ts:78-84` | W6 **实跑**（真实 sqlite + 真实 VFS + 真实 assemble，双入口都复现） | 把 `filename` 档并入 `:142` 已有的 `findContentSize` 探测（成本近零）；catch 降级归入「不落 cache」分支 | S |
| **M-04** | `domain/provider/logic/find-saved-model-references.ts`；`provider.service.ts:240-250` | W6 **实跑**（四条独立探针，含「删服务商静默清空被引用模型」端到端坐实） | 守卫补扫 `chat_session`；`delete(provider)` 路径补同一 in-use 拒绝；补一条端到端回归 | M |

> W6 建议的 backlog 排序（写进执行单）：**M-01 > M-04 > M-03**。M-04 若产品口径认为「删服务商导致用户会话突然不可用」等同数据丢失，值得复议 P0。

### 2.5 cloudsync（7 条）

| ID | 位置 | 印证强度 | 一句话修法 | 量 |
|---|---|---|---|---|
| **S-CS-02** | `apps/desktop/src/main/services/cloud-sync.service.ts:432-449,159-165,378,391-396` | 封印（四点核验）+ W6 **adjusted**（同一 service 上还有第二个死句柄 `dbSync`，不只是 `configStore`） | 拆出生产版 `invalidateCloudSyncService()` 挂进 `rebootstrapDesktopRuntime()`；或让 service 每次 `await getDesktopRuntime()` 而非持句柄 | S |
| **S-CS-03** | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:143-182` | W6 **adjusted**（桌面 pull↔push 已被 `syncBusy` 原子挡住，原 t0/t1/t2 交错链**在桌面上不成立**；暴露面收窄为 mobile pull↔push + 两端 pull↔agent） | pull 与 push 共用互斥；`pull()` 入口与 `importSnapshotFromPath` 之前各复检一次 `isAgentActive()` | M |
| **S-CS-04** | `apps/mobile/src/services/cloud-sync.service.ts:317,332,338,367`；`db-maintenance-busy.ts:15` | **5 处独立撞车** + W6 confirmed-by-construction（SKSP `has`/`get` 判据结构性不等价，无需真机注入） | `createCoordinator` 移进 `try`（临时路径改 `let` 声明、finally 判空 unlink）；补「注入抛错 → `isMobileDbMaintenanceBusy()` 回 false」单测 | S |
| **S-CS-07** | `apps/desktop/src/main/services/db-backup.service.ts:104,114,125,128` | W6 confirmed（**本簇唯一会造成不可逆本地数据丢失的 P1**） | 桌面备份/回滚/删 bak 三处 `.catch(() => undefined)` 不得吞；回滚前必须确认可回滚副本在位 | M |
| **S-CS-08** | `packages/cloud-sync-driver-s3/.../create-s3-object-storage.ts:225-235` | W6 confirmed（`new Uint8Array(Buffer)` 逐元素复制；pull 侧同走此路径） | 去掉多余一次拷贝；multipart 兑现另立 P2 债务（需引新依赖，非零成本） | S |
| **S-CS-09** | `cloud-sync-coordinator.ts:297-304` | W6 confirmed（`nextRev` 在 `:249` 已按首次读到的 `remote.rev + 1` 算定） | 条件写失败后不得用只含 etag 的重读结果无条件覆盖 rev | M |
| **S-CS-16** | desktop `cloud-sync.service.ts:255-256` → handler `cloud-sync.ts:91`；mobile `:341` → `:346 onRebootstrap` | W6 confirmed（令牌边界正确且是刻意设计）；**派生** mobile 侧 `patchCloudSyncLocalStatus` 未兜错会覆盖原始错误（建议 P2） | 记账移到 rebootstrap 之后——**与 P0 S-CS-01 同一修法，合并成一个 PR** | M |

### 2.6 apps-mobile（2 条）

| ID | 位置 | 印证强度 | 一句话修法 | 量 |
|---|---|---|---|---|
| **AM-1** | `services/session-stream-unit-manager.service.ts:717`；`screens/tabs/chat-tab/useChatTabScope.ts:521-541,564-589,591-610` | 5 处独立撞车 + W6 行号抽查全在位 | 三处删除成功分支补 `manager.forgetSession(id)`；`idleMessageViews` / `settledProjections` 挂 500 LRU 兜底（与 `chat-session-view-cache` 同口径） | M |
| **AM-3** | `navigation/types.ts:16`；`screens/stack/RealPromptScreen.tsx:23`；`SessionDetailScreen.tsx:397` | W6 把置信从「前置条件靠推断」**升级为「触发路径逐跳读码闭环」**（通知点按 → 树外写面改 scope → 导航推迟 → 栈顶仍是 A） | `RealPrompt` 路由加可选参数 `{projectId?, sessionId?}`，两处入口显式传、缺省回落 scope | S |

> AM-1 的删除链路零 `forgetSession` 属实；W6 唯一订正是 `ChatSessionListPanel.tsx` 的目录前缀（`screens/tabs/chat-tab/`，非 `components/chat/`），行号 115-118 正确。
> 「加 LRU」这半个修法与是否降级无关——正常浏览即涨，不依赖删除路径。

### 2.7 apps-desktop（4 条，其中 2 条为 W6 盲扫新增）

| ID | 位置 | 印证强度 | 一句话修法 | 量 |
|---|---|---|---|---|
| **S-D-02** | `src/main/ipc/handlers/vfs.ts:423-432`；`src/main/services/vfs-batch.service.ts:260-272` | 读码 confirmed（代码无校验）/ 可利用性 suspected（未实测） | 清理通道内加 `resolve()` + `startsWith(base + sep)` 断言，非法路径 warn 后 return | S |
| **S-D-04**（含盲扫条目 **A**） | `renderer/features/settings/AgentEditorView.tsx`（全文无 `dirtyViews`）；`renderer/layout/SettingsOverlay.tsx:135-155,236-247,268-272,291-300`；`features/settings/settings-nav.ts:99,158-175` | 多源 + W6 盲扫**独立重推导 A**：`dirtyViews.add` 全仓只出现在 `SkillDetailView.tsx:142` 一处，守卫恒 false | `AgentEditorView` 补 `nav.dirtyViews.add("agentEditor")` effect；App 侧 ⚡ 改走 `handleClose` 统一入口（保持守卫单点在 Overlay 内） | M |
| **B**（W6 盲扫新增） | `packages/core/src/config-forms/agent/agent-editor-state.ts:542-569`（`formSnapshotJson`）；`AgentEditorView.tsx:169-217,630,744-756` | W6 逐字段核对快照清单，`mode` 缺失确认（`customAttach` / `description` 各有一条「纳入 dirty 比对」回归测试，唯独 `mode` 没有 ⇒ 遗漏而非有意排除） | `formSnapshotJson` 纳入 `mode`；补一条「改作用域下拉即 dirty」回归 | S |
| **E**（W6 盲扫新增） | `AgentEditorView.tsx:221-251,308-360,488-537` | W6 读码闭环（`loadAllSavedModels` 吞错 → `allModels.find` 得 undefined → `applyDefinition(def, null)` 折叠成 `modelEnabled=false` → 基线同源故 `dirty=false` → 下次 `save()` 走 `delete definition.model`）；**无任何缓解**（无错误横幅、无「原绑定模型不可用」提示、无二次确认） | 加载失败时保留 `def.model` 原值 + 渲染一条「原绑定模型当前不可用，保存将解除绑定」的提示 | M |

### 2.8 dead-backlog（2 条 P1）

| ID | 位置 | 印证强度 | 一句话修法 | 量 |
|---|---|---|---|---|
| **F-synth-dead-1** | L0 死导出普查桶定义（`tmp/l0census/dead-exports.mjs:197`） | W3 抽核大修正：core「仅测试」桶 127/356（35.7%）实为 barrel 转发的生产消费；core「确认死」617 中 173 条落在快照锁定面 ⇒ **core 真可删 ≈ 363** | `testOnly` 排除 `relayed` 后重跑 L0，再更新 `L0/dead-exports.md` 与 `L0/coverage-matrix.md` | M |
| **F-synth-dead-2** | `packages/core/test/package-exports/snapshots/*.json`（13 份、551 个去重名字） | W6 补硬证据：全仓 13 个包全部 `private: true` + `version: 0.0.0`，`.github/` 与 `scripts/` 里 `npm publish` **零命中** | 见拍板项 #1：先实跑 `tsc -p packages/core` + 全量 `npm test`，再决定是否解锁 A-type 99 条 | S（核销）/ M（解锁后施工） |

### 2.9 已核销附录（refuted / adjusted · 6 条出 P1 池 + 6 条纯驳回）

| ID | 原判 | 终判 | 核销理由 |
|---|---|---|---|
| RT-03 | P1 | **P2** | 机制 confirmed，但「poolHitRatio 0.53」实测 **0.400**、悬崖精确在 4M 字符总正文（与 `MAX_ENTRIES` 无关）；「修 RT-01/02 缓解大半」证伪——只省约 17%。本轮不动内存，池预算另拍板 |
| RT-05 | P1 | **P2** | 「无持久失败消息」confirmed；但两条升 P1 支撑均被推翻——两端都有一次性错误 toast，且 `resolveUnpairedToolStatus` 在 run 结束后收敛到 `error`（不卡 pending） |
| RT-06 | P1 | **P2** | `vfsMutated` 只看名单 confirmed；但「desktop 整棵工作区树 reload」只对子会话成立，自己会话走 `ConversationPanel`。真实代价是一次多余 checkpoint + 一个空回滚点 |
| RT-07 | P1 | **P3** | 代码形状 confirmed；**争议 D-1 判 refute**——mobile 子会话单元只在 `onRunStarted` 懒创建，前奏抛错 ⇒ STARTED 未发 ⇒ 单元根本不存在。残留后果仅「子会话已建 + task prompt 已 append，但一条终态事件都没有」 |
| M-02（≡ apps-desktop S-D-03） | P1 | **P2** | 两端实现分叉 confirmed；但**原报告的核心论据被自己的例子反驳**（全角冒号在 YAML plain scalar 里合法，实跑两端皆 valid）。真实触发面只有半角 `": "` 与含换行两种，且有 `invalidReason` 非静默。修法（core 下沉 + `yamlScalar`）不变，改动量比原述更小 |
| M-05 | P1 | **P2** | 机制 confirmed（连续句末符可破 ≤64 不变量），**危害链 refuted**——护栏是 `incremental-token-counter` 自己的 64 字符硬切，与切分器独立；实测 16000 字符病态输入 786ms，比同规模 CJK 对照（973ms）**还快**。真实危害是 L2 内容寻址块缓存复用率归零（1 块 vs 140 块） |

**纯驳回（从未入台账，登记防重复报）**：apps-desktop 盲扫 R1–R5 全部 refute；D-101 的「ENOENT 崩」子命题 refute 且风险**上调**为「静默把工作区回退到 2026-06」；M-05 的「唯一护栏 / O(len²) 回归」危害链 refuted。

**维持 P1 但描述被改写（3 条）**：CS-10（泄漏面收窄到 checkpoint 仓储三方法）、S-CS-02（发现第二个死句柄）、S-CS-03（桌面侧已被 `syncBusy` 挡住）。

**跨簇去重（3 条，台账只计一次）**：

| 重复项 | 保留口径 | 另一份登记 |
|---|---|---|
| apps-desktop **S-D-01** | 归 **cloudsync S-CS-02** | apps-desktop 原文「归属移交 synth/cloudsync，本簇仅登记不重复出账」 |
| apps-desktop **S-D-03** | 归 **core-misc M-02**（现 P2） | 两簇独立登记同一病灶（desktop `buildNewSkillDoc` 裸插值） |
| apps-mobile **AM-2** | 归 **cloudsync S-CS-04** | cloudsync 归并方法①已把 w4-pro F-1 与 w2-mobile-runtime F-3 合并为一条 |

另两条同族但**不重复计**：core-storage **CS-11**（owner 建议 core-data，core-data 台账未另立）、core-runtime **RT-08**（core-service-vfs P1-1 为同一次发现，争议 D-7 已请求只记一条）。

---

## 3 · P2 / P3（不逐条展开 · 按簇给计数与主题）

| 簇 | P2 | P3 | 主题归纳（详见对应 synth 文件） |
|---|---:|---:|---|
| **core-runtime** | 18 | 34 | ① **抽象建了没接线**（`IntegrityRepairRegistry` 5 个 operation 只接 1；`AgentStreamRegistry` 四张表只写不读；overlay 91 行零调用；`listSessionMessages` 零消费者死契约）② **缓存生命周期**（rebootstrap 只清解压双池、进程级 prompt-token 单例 `clearAll()` 零调用、file_cache 四条清域路径不调度 blob GC、后台回填 `setTimeout(0)` 竞态）③ **可观测性欠账**（10 处 abort 分支标签全丢进 `_branch` 黑洞、`onRunFailed.stage` 恒为 `"runner.run"`）④ **配置型自伤**（`doomLoopThreshold=1` 首次工具调用即 doom loop）⑤ 命名/契约/格式小面（`stepCompactionEmitted` 恒真、283 行缩进掉级）｜[synth/core-runtime.md](synth/core-runtime.md) |
| **core-data** | 22 | 39 | ① **两条平行截断实现**（失效/清扫/游标集合分叉，id 列表事务外取 TOCTOU）② **backfill 每轮发送 N+1 倒扫**（「回退全量是常态」已定性 intentional，但代价从未量化；同仓已有单查询 JOIN 替代）③ file_cache 置位/导入清引用行不回收 blob ④ 事务边界纪律（tx 面才可查、事务内不得 VACUUM）⑤ 编码收口唯一性 ⑥ 存储迁移退役倒计时｜[synth/core-data.md](synth/core-data.md) |
| **core-storage** | 17 | 48 | ① **SQL 底座治理**（约 900 行动态标签子系统生产零使用、AST 缓存桶定义、25 个子路径只有 12 个有 allowlist 快照）② 事务期 AsyncMutex 独占派生族 ③ **VFS 全量解压热点**（`scanContents` / `nextUpdateVersion` / `expandAnchorHunk`）④ bootstrap DDL **守卫缺失**（加列忘 bump 无任何测试能拦）⑤ `vfs_entry.content` 遗留明文三形态读 ⑥ 索引缺失（`content_hash` 两表皆无索引）｜[synth/core-storage.md](synth/core-storage.md) |
| **core-misc** | 25 | 9 | ① **协议栈可观测性**（abort 监听器三处泄漏、tool_use 双 emit 违反 port 契约、partial 路径丢 thinkingSignature/块序、错误分类缺口）② **双端重复实现 15 组 + 真环 5 个**（core 3 + mobile 2，修正 L0 的 7）③ 体积闸门三层口径不一致 ④ provider 域零消费派生群 9 份中 6 份死 ⑤ tokenizer/nmtp 导出面漂移 ⑥ 核心纯函数 core 侧测试缺口（`skill-paths` 等 7 个文件）｜[synth/core-misc.md](synth/core-misc.md) |
| **apps-mobile** | 20 | 26 | ① **编码损坏已入库**（10 文件含 U+FFFD，提交钩子与 CI 均无检查）② **双端同语义两份实现 10 处**（已发生行为漂移 3）③ WebView 三层产物链三大易漏点 ④ 通知导航会压入第二个 `MainTabs` ⑤ 路由/scope 纪律 ⑥ test-utils 与 dist 依赖面｜[synth/apps-mobile.md](synth/apps-mobile.md) |
| **apps-desktop** | 19 | 8 | ① **IPC 断链 11 条终裁**（真死删 8 / 口径修正 1 / 待拍板 3）② **X1 门禁 9 处违规** + CI `continue-on-error` 放行 + 为绕行建的 `shared/logic/events.ts` 自身 2 符号零消费 ③ invoke 封装层死率 ④ 死 IPC 消费面 ⑤ 6 个大文件只定点读（本簇盲区）｜[synth/apps-desktop.md](synth/apps-desktop.md) |
| **cloudsync** | 20 | 7 | ① rev 记账/单例失效的**生命周期包** ② **互斥三守卫各管一段**（`syncBusy` / `maintenanceBusy` / `PushAgentMutex` 互不检查对方）③ 临时文件与对象残留（`Date.now()` 命名、finally 删从未创建的路径）④ 桌面设置页 2s 轮询打远端（60 请求/分钟计费）⑤ OSS 条件 PUT 降级 TOCTOU ⑥ 快照只增不删的保留策略欠账｜[synth/cloudsync.md](synth/cloudsync.md) |
| **dead-backlog** | 3 | 1 | ① **387 条可执行删除清单**（批次 1/2/3，≈2886 行）② L0 桶定义缺陷与快照锁定面 ③ apps 侧「全部导出都死 ≠ 文件死」（194→20）④ `namespace import` 盲区 ⑤ 动作分档互斥性口径修正｜[synth/dead-backlog.md](synth/dead-backlog.md) |
| **合计** | **150** | **174** | 终局 359 条 = P0 3 / P1 32 / P2 150 / P3 174 |

---

## 4 · 修复波次提案（Wave A → E）

波次顺序原则：**A 先落地零风险的止血与门禁 → B 处理用户可见功能缺陷 → C 做有回归风险的性能结构改造 → D 清死码 → E 补文档与防再犯钩子**。A/B 之间无硬依赖；D 的批次 1 可与 A 并行（互不触达）；C 全部依赖 A/B 的对应修法先落。

### Wave A · 零风险止血（建议 1 个 PR，半天到一天）

| 条目 | 簇 | 动作 | 依赖 |
|---|---|---|---|
| **RT-02** | core-runtime | `:506` 复用 `:405` 已拿到的 `visible.length`（触发器入参改传条数），**立刻减半每 step 会话读** | 无。**Wave C 的 RT-01 收窄以此为前置读数基线** |
| **A-14 search filter 死路径早退** | core-tool | 闸门本身**是 intentional**（`run-agent-turn.ts:924` 与 `tool-runner.ts:98` 注释明写「分阶段占位」，W1 裁决 1 已改判），但 `resourceQuota` 零读取方、search filter 死路径**仍可清理** | 无。清理时**不得动闸门装配点与 policy 调用** |
| **CI typecheck 转 blocking** | apps-desktop | 删 `.github/workflows/ci.yml:62` 的 `continue-on-error`（W3 实测 16 workspace typecheck 全绿，「既存类型错误」是假债务）；顺带记一笔 mobile `--max-warnings 321` 与实测 405 warnings 的差距——**该上限当前本身失效** | 无。**Wave E 的 X1 全量收口靠它兜底** |
| **编码还原批次 1** | apps-mobile | 从父提交还原 `session-prompt-input.service.ts` 的 178 个 U+FFFD（**仅注释，行为无损**）与其余已核实纯注释的损坏文件；`sksp` 三处**先过哨兵字符甄别**（见拍板项 #5）再动 | 需拍板项 #5 先答。**不得改 RUNTIME 字符串** |

### Wave B · P1 功能缺陷（建议按 4 个 PR 切分）

| 条目 | 簇 | 动作 | 依赖 |
|---|---|---|---|
| **云同步生命周期包** | cloudsync + apps-desktop | `S-CS-01`(P0) + `S-CS-16`（同一修法，记账移到 rebootstrap 之后）＋ `S-CS-02`（单例失效）＋ `S-CS-07`（备份三处吞错）＋ **争议 D5**（`handleCloudSyncPull` 无条件 rebootstrap → 条件化） | **必须同一 PR**：`S-CS-02` 不能靠 D5 收敛掉（本地备份导入路径不受 D5 影响）。S-CS-07 独立可先落且优先级最高（唯一不可逆本地数据丢失） |
| **CS-01 renamePrefix** | core-storage | `REPLACE()` → `substr` 拼接 + 补「子树含同名目录」回归 | 无 |
| **RT-04 persist 塌缩** | core-runtime | `definitionToDocument` 前跑 `validateAgentPromptLayout` | 无 |
| **RT-08 模板拉取漏清缓存** | core-runtime | 事务提交后调 `clearSessionPromptCaches`（口径照两条既有导入路径） | 无 |
| **AM-1 forgetSession** | apps-mobile | 三处删除成功分支补调 + 两张 Map 挂 500 LRU | 无 |
| **S-CS-04 busy 泄漏**（≡ AM-2） | cloudsync | `createCoordinator` 移进 `try` + 补令牌回 false 单测 | 无（与云同步生命周期包**不同文件**，可并行） |
| **SSE `data:` 无空格** | core-misc (M-06, P2) | 解析器接受 `data:{…}` 无空格形态。当前部分网关发的正是这种形态，**整流静默丢弃、零解析不报错、run 以「空回复」正常收尾** | 无。虽判 P2 但**用户可感**，按「零风险 + 用户可感」提前到此波 |
| **`summarizeToolInput` 三处统一** | core-misc (xc-dup-ends) | 同一调用在三个面渲染不同，统一到 core 单源 | 无。纯收敛，零行为意图变更 |
| （同波顺带）**M-03 / M-04 / CS-02 / CS-04 / CS-07 / CS-08 / B / AM-3 / S-D-02** | 多簇 | 全部量级 S、零结构变更，可打包成一个「P1-S 批次」PR | 无 |

### Wave C · 性能结构（回归风险最高，须 A/B 先落）

| 条目 | 簇 | 动作 | 依赖 |
|---|---|---|---|
| **全量读收窄系列** | core-runtime + core-data | RT-01（gemini 专查或 memo+失效）＋ CD-01 fork 缺 `listBySessionUpToSeq` 上界读口 ＋ `truncateAfter` 空锚用 `listIdsAfterSeq` 免解压 ＋ `subagent-tool.ts:219` 加 `listBySessionTailOfRole(limit 5~10)` | **RT-02 必须先落**（否则收窄收益测不准）。**按热/冷路径分类**——`run-agent-turn.ts:852/:1201` 经 core-service-agent 反查为**非热路径**（一次性流程），不要一刀切；`message.service.ts:293`（fork，已治）、`session.service.ts:374`（copy，未治）是热路径 |
| **缓存池预算** | core-runtime (RT-03, 现 P2) | 先用 `packages/core/test/chat/message-content-perf-threshold.test.ts` 取**真实命中率**（W6 实测复刻件 0.400，真实分布未测），再决定是否把 4M 字符预算提到「最大可见工作集 ×2」 | **需产品拍板内存预算**（拍板项 #6）。**不要在本轮动内存** |
| **事务边界收窄** | core-storage + core-data | CS-05 分片提交 + backfill 移出导入事务 ＋ CS-11 copy 走 header 投影或 `INSERT...SELECT` ＋ CS-06/07 revision 层对齐 ＋ `backfill` 倒扫改单查询 JOIN ＋ core-data D-2 的 `listBySessionOffset` header 投影 | CS-07 **必须在 CS-06 之后**（CS-06 造出 CS-07 的触发前提，先修触发侧）。**CD-01 的修法与本波性能结论有冲突**：W6 明确否掉了「`resolveReconcilePathSets` 整体移进事务」这条台账原修法（会把全量扫描搬进持写锁区），改为事务内**复用已有扫描做集合断言** |
| **CS-09 ZIP 解析闸** | core-storage | 解析器内累加体积/条数，越限即抛 | 无。**建议与 Wave B 并行**（用户可感的安全面） |
| **CS-10 AST 缓存** | core-storage | 先给 `sqlite-message-checkpoint.repository.ts:112/366/390` 三方法补分片 | 无 |

### Wave D · 死码删除（批次 1 → 3 + 死通道）

| 批次 | 条目 | 量 | 开工前置 |
|---|---|---|---|
| **批次 1（零连带，16 条）** | D-101 ~ D-116 | ≈2236 行（W6 从 2252 修正） | 无。**但须先按 W6 修正三处施工单**：① D-101 理由改写为「静默回退工作区、非 ENOENT」（风险更高），建议在 CHANGELOG 记一笔；② D-109 锚点补 `:5 EXIT_RUNTIME`（4 个导出 `:4 :5 :7 :20`）；③ D-116 **选 B1-a**——只删 `isTaskToolUse`，保留 `resolveSubagentSessionId`（有 1 处真实测试引用，否则批次 1「零测试」总纲不成立） |
| **批次 2（有测试/配置连带，9 条）** | D-201 ~ D-209 | ≈248 行 | **必须先 rebuild core**（`packages/core/dist` 存在但是旧的，mobile jest 30+ 条 `moduleNameMapper` 直连 `dist/**`——rebuild 前的任何 mobile 测试失败都不可归因）。D-201 的 6 处 `jest.mock` W6 已核为 6/6 全对 |
| **批次 3（需先过裁决）** | 3.1 core 符号级 348 条（255 摘 export + 53 转发行 + 40 整段）；3.2 级联 17 条 | ≈386 行 | 拍板项 #1（快照锁定面）与 #3（迁移双形态）。**D-302/D-304 现在就已经零 renderer 调用，与 D-106/D-107 无因果关系**（W6 更正了原表的挂错因） |
| **死通道** | S-D-05 终裁：真死删 8 条（`PROJECTS_GET/UPDATE_AGENT_CONFIG`、`SESSIONS_GET_AGENT_BINDING`、`VFS_LIST`、`WORKPLACE_CAPTURE_SESSION_BLOCK`、`SMART_SORT_RULE_IMPORT/EXPORT_RULES`、`SKILLS_EDIT`） | — | **每条须同步改四处**（`ipc-types` / `handler-registry` / `invoke-registry` / `client`）＋ 相关测试。`VFS_START_DRAG` 是**口径修正非断链**，不改代码（L0 断链 12→11） |
| **须先拍板的 3 条通道** | `MESSAGES_HIDE_RANGE` / `MESSAGES_SHOW_RANGE` / `MESSAGES_TRUNCATE_AFTER` | — | 拍板项 #4。**若走「补 UI」路线，`S-D-07`（truncate 漏双缓存失效）立刻从 P2 升 P1** |
| **验收线** | — | — | 每批跑完必须：`tsc --noEmit`（core/desktop/mobile 三包）+ `npm test`（三包）全绿。**W6 与 W5 均未实跑这些命令，这是开工时的义务，不是已完成的验证** |

### Wave E · 文档与防再犯（与 A/D 并行收尾）

| 条目 | 动作 | 依赖 |
|---|---|---|
| **RULE 提交** | 主仓 `docs/apm/RULE.md` 的 2026-09-29 修正**已在工作区但未提交**（`git status` 显示 M），worktree checkout 的是旧提交版所以读到了旧文。**代码正确、修正存在、只待用户提交**（代理禁写 `docs/apm/`，勿在 worktree 里改）。涉及：压缩口径漂移、seed-builtin-skills 覆盖口径（core-storage 争议 #3）、`AgentSession.hideRange` 指针错误 | **用户动作** |
| **X1 门禁全量收口** | S-D-06 的 9 处 renderer→core 违规（8 文件 12 行 import + 3 个 `shared/logic` 转发文件共 16 个符号，零逻辑改动）＋ driver 包 tsconfig 覆盖 ＋ desktop 2 条 `no-regex-spaces` ＋ core 3 条；**「专为绕行建的 `shared/logic/events.ts` 自身 2 符号零消费」——修法是零新增再导出，全改走 `@shared/logic/*`**。另加 `shared/**` 的 lint 规则（只允许 `export {} from`、禁 `export *`、禁工厂函数）＝ apps-desktop 争议 D7 | **依赖 Wave A 的 typecheck 转 blocking** |
| **防再犯钩子 ① 编码** | 提交钩子 + CI 加 U+FFFD / BOM 扫描（RULE「PS 管道毁编码」已两次实锤且已污染 main；core 内 4 个文件带 BOM 与编码批次同批处理） | 无 |
| **防再犯钩子 ② 白名单完整性** | `normalizeAgentPromptLayoutDomain` 白名单**连续两次漏新增字段**（上次 `customAttach`、这次 `skillsEnabled`/`skillsPrefix`）→ 加 exhaustiveness 断言而非逐字段补 | 无 |
| **防再犯钩子 ③ 编码归一** | front matter 单源：desktop `buildNewSkillDoc` 与 skill-ui 手拼两处下沉 core（mobile 的 `yamlScalar` 口径为准），core 测试里锁死 `#` 截断与前导空格两形态 | Wave B 的 summarizeToolInput 同波可一起做 |
| **防再犯钩子 ④ 边界用例** | `chunk-splitter` 的 `assertInvariants("。".repeat(200))` / `("。\n".repeat(200))`（**当前实现下会红**，是有效回归）；加封顶后需同步 golden 快照（`"。。。！！！"` 从 1 块变 2 块） | 无 |
| **防再犯钩线 ⑤ 测试缺口** | `rollback-empty-target-guard.test.ts` 补 rewind 空树路径断言；`findSavedModelReferences` 补 `chat_session` 端到端回归；`model-request-retry.test.ts` 补「attempt1 产出后失败 → 断言 onStream 未被二次驱动」（现有 6 条全只覆盖无输出失败） | 无 |
| **注释承诺 ≠ 实现** | `chunk-splitter.ts:12-14` 的「保证逐块 encode ≤64」在句末符密集输入下不成立（真保证在 `incremental-token-counter.ts:104-112`）；RULE hidden 过滤指向测试假件 | Wave B/C 对应修法落地时同步 |

---

## 5 · 用户拍板项清单

> 每项 = 一句话事实 + 默认建议。带 ★ 的是**阻塞项**（不答就卡住对应波次）。

| # | 议题 | 一句话 | 默认建议 |
|---|---|---|---|
| **★1** | **快照锁定面解锁**（dead-backlog 争议 #1 / F-synth-dead-2） | core 617 条「确认死」里 173 条落在 `Object.keys(mod)` 快照锁定面；W6 补到硬证据——全仓 13 个包全部 `private: true` + `version: 0.0.0`，`.github/` 与 `scripts/` 里 `npm publish` **零命中**，发布只走 GitHub Release | **判「无仓外 TS 消费者」→ 解锁 A-type 99 条进批次 3（≈+400 行）**。理由：仓外要消费只能 `git clone` + workspace link，那属 fork 内部协作、不构成契约面。**硬门槛：解锁前必须实跑 `tsc -p packages/core` + 全量 `npm test`**（W6 只读未跑） |
| **★2** | **intentional 预留的存废**（dead-backlog 争议 #2 / D-311、D-314） | `resolveLatestReleaseFromList` 被 `about-and-update-check/spec.md:187` **明写「预留」**；而 D-314 引用的 `ephemeral-overlay-agent-session.ts:50-52` 那句 intentional 注释**在代码里不存在**（`git grep "overlay compaction"` 零命中） | **拆开处理**：D-311 **保留**（spec 明写预留，删它违背文档，按 PLAN §3 标 intentional）；D-314 **可删**（无任何 intentional 依据，唯一消费者是 1 个测试的 1 个用例） |
| **★3** | **迁移双形态**（dead-backlog 争议 #3 / D-316） | `config-forms/shared/{depth-slice,application-model-id}.ts` 与 `domain/**` 同名同签名双份实现，内容**不相同**（1409 B vs 1773 B）；`duplicate-export-consistency.test.ts` 是刻意加的同源守卫 | **倾向「迁移残留」可删**。但 `config-forms/shared` 是 `package.json:105` 的**正式对外子路径**，动它等于动子路径清单 ⇒ **必须由用户确认「共享形态不是为分端裁剪的产物」**。施工形态：删 2 文件 + `index.ts:2-6` 五行 + 改该测试 + rebuild core + 跑 mobile 测试 |
| **★4** | **三条 batch 通道的去留**（apps-desktop 争议 D5 / S-D-05 第 10、11 行） | `MESSAGES_HIDE_RANGE` / `SHOW_RANGE` / `TRUNCATE_AFTER` 的 UI 于 commit `722e27d5` 主动删除，双端 batch 纯函数整片悬空 | **走 B（真死删 + 连带清 10 个悬空符号）**——这些是用户可见的批量隐藏/截断 UI，近期重做的概率低于维护成本。**若改走 A（补 UI），S-D-07 立刻升 P1** |
| **★5** | **哨兵字符甄别**（status.md mobile-runtime F-1） | 全仓 10 个文件含 U+FFFD 已入库；其中 `sksp` 三处**疑为哨兵字符而非损坏**，直接还原会误删 | **先只还原已核实纯注释的 7 个文件，`sksp` 三处单独人工看过再定**。Wave A 的编码批次 1 被这一项卡住 |
| **6** | **内存池预算**（core-runtime RT-03 / verify 建议） | 4M 字符预算在 10M 工作集下命中率实测 0.400，暖读≈冷读；真实会话正文分布未测 | **本轮不动内存**。先跑现成基建 `message-content-perf-threshold.test.ts` 取真实命中率，再在 Wave C 决定是否提到「最大可见工作集 ×2」 |
| **7** | **`sql-template` 约 900 行动态标签子系统的定位**（core-storage 争议 #1） | parser 428 + evaluator 137 + expression 161 + context 74 + placeholder 28 + tags，生产代码**零使用**（动态性全靠 TS 侧字符串拼接）；infra-sql 找不到任何文档说明其定位 | **判「重构做了一半的死代码」→ 降 P3 清理**。若判「待启用能力」则反之，CS-15 升 P1、这批成上线前必修项 |
| **8** | **`MESSAGES_*` 之外的 IPC 仓外消费方**（apps-desktop 争议 D4/D8） | handler 注释称 `PROJECTS_*_AGENT_CONFIG` 是「兼容外部脚本」，但 Electron IPC 只有 renderer 能调；`VFS_LIST` 的 `examples/`、`scripts/` 面 W3 未逐一核 | **删前人工确认一次**：Electron 侧仓外调用只能经 `webContents.executeJavaScript`，仓内无此写法；`examples/`+`scripts/` 跑一次低成本 grep 即可 |
| **9** | **`handleCloudSyncPull` 无条件 rebootstrap 的性质**（cloudsync D5） | `ALREADY_UP_TO_DATE` 时库文件根本没换，却仍关连接 + 重 bootstrap + 重建整条 service graph；对照 `handleBackupImport` 是 `if (result === "imported")` 才 rebootstrap | **按漏判处理**（条件化为「仅在真正发生库文件替换时 rebootstrap」）。W6 三条证据：git log 只有最初的通道提交、spec 伪码没提 rebootstrap、同仓同类实现给相反口径。**但注意：条件化不能替代 S-CS-02 的单例失效修复** |
| **10** | **快照保留策略**（cloudsync D6） | 快照按 rev 命名只增不删，仓内找不到任何「保留策略后续做」的 TODO/issue | 补一条 TODO 进 RULE，条目按 P2 债务登记（一年 365 份全量库是确定成本） |
| **11** | **`AgentRunOptions` 公开面是否收窄**（core-runtime D-2 / RT-14） | `EphemeralOverlayAgentSession` 91 行 + `persistMessages` 字段 + runner 内 8 处行为分叉各有测试锁定；检察官判全死、辩护人判「契约宽度算不算债」 | **先不动**。无论结论如何，悬空 `{@link runRunAgentAction}` 必改（`@see` 指向全仓不存在的符号） |
| **12** | **webview-host 三「真源」模块的去向**（apps-mobile 争议 1 / AM-14） | 8 个导出里只有 `scrollTopForOffsetFromBottom` 一个真被用；`scroll.ts` 里几个是 DOM 形的 webview 版，签名不同 | **接回去**——`scrollTopForOffsetFromBottom` 已证明这条路走得通（`snapshot.ts:10` 就在用），其余 7 个死导出并入 dead-backlog 批次 3 一并摘 |
| **13** | **AM-1 是否整体降 P2**（apps-mobile 争议 3） | xc-cache-apps 主张降（徽标最多多挂到 LRU 淘汰）；mobile-runtime 反向主张 P1 | **不降级**：`idleMessageViews` 存的是 `[...cached.messages]` 深拷贝，**会话删除后用户可见数据仍以内存副本形式留存**（隐私面），且这一项的无上限不依赖删除路径。**若最终决定降 P2，「加 LRU」这半个修法仍要保留** |
| **14** | **导航栈缺陷归属**（verify-apps-mobile 附带发现） | `navigateToChatTabFromNotification` 的 `navigate('MainTabs', {screen:'Chat'})` 在栈顶非 `MainTabs` 时会**压入第二个 MainTabs**（`RootNavigator.tsx:213` 无 `getId`、调用未带 `pop`） | **单开一条 P2**，归属 `apps-mobile`（`verify-apps-mobile` 只登记事实、不改 AM-3 计数）。影响是返回键要多按一次、栈里出现两个 tab 宿主 |
| **15** | **checkpoint 自愈通道是否补注册**（core-data D-3） | `createRevisionRefCountRepairOperation` / `createBaselineCheckpointBackfillOperation` 全仓只有测试调用，从未注册进 bootstrap registry；但 `message-rollback-execution-redesign/prd.md:88` 验收栏明写「留待后续迭代，不阻塞合并」 | **走 PRD**：不注册，只在 RULE 记一句。理由是 repair 算子对「误删」无效、只对「计数偏低」有效，而 `revision-gc.ts:37-40` 注释自述孤儿是常态——两句口径不一致本身就是债 |

---

## 6 · 口径与已知盲区

- **归并口径**：同 `file:line` + 同根因 ⇒ 合并为一条；同 `file:line` + 不同根因 ⇒ 拆条。对抗裁决优先于单方定级。单方发现的 P1/P0 先就地复核再入账，复核不成立的直接降级或剔入移交表。
- **验证纪律**：W6 全部为**只读**（零 git 写、零 `docs/apm/` 写、零生产代码改动）。实跑型结论来自 `packages/core/dist` 真构件、真实 better-sqlite3、真实 js-tiktoken cl100k、真实 sqlite + VFS + assemble 端到端；复刻型结论不作为 confirmed 依据。
- **未实跑的硬门槛（开工义务，非已完成验证）**：`tsc -p packages/core` / `tsc --noEmit` 三包 / 三包 `npm test` 全绿 —— W5 与 W6 均未执行。`packages/core/dist` 存在但是旧的（2026-10-01 02:34），rebuild 前 mobile 测试的失败信号**不可归因**。
- **移动端 debug 包纪律**（AGENTS.md 硬规则，本轮未触发任何真机测试）：Metro 从真实路径起、禁内嵌 bundle、真机测试包统一 versionCode=1、一律 `adb install -r -d`、**任何设备永远禁止 uninstall**、荣耀真机需用户在场确认。
- **本轮未覆盖的扫描面**：4 个 Kotlin 原生文件（cli-periph 盲区）；mobile 6 个 renderer 大文件只做符号级追踪；apps-desktop 6 个 handler 共 1211 行未逐行；S-CS-01 的 mobile 侧未在 op-sqlite 上实测。
- **哨兵字符**：仓库根目录存在 4 个空目录（`(echo`、`exist`、`OK)`、`if`），是历史 Windows shell 转义事故产物（空目录不入库，`git status` 不显示，但会干扰 `dir /b` 与后续脚本）。不在本次 CR 范围，建议单独清理。

---

*本文件由 W7 终局拼装产出。口径冲突时：**定级以本文件为准 > 验证报告 > 簇台账 > raw 报告**。*
