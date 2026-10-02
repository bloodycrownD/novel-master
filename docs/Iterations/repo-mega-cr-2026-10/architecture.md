# novel-master 全局架构图 v2（面向新工程师 / 新 agent 的导航）

> **版本注记：基线 `main@fe79b781`（tag `v1.5.29`）。** 上一版基于 `main@9ca5f5ad`（v1.5.28）。
> v1.5.28 → v1.5.29 共 **31 个提交、118 文件、+10 774 / −3 219**，其中包含两条架构级变更链：
> **明文化链**（`chat_message` 正文从「压缩为正形态」回退成「明文为正形态」+ 反向解压搬运任务 +
> 消息正文缓存池整层删除）与**引用化链**（`read` / `skill read` / `skill load` 的 `tool_result`
> 从「存全文」改成「存引用 + view-time 重放」+ `vfs_revision.ref_count` 持有者从两类扩为三类）。
>
> 装配自：`synth/` 下 8 份 W5 归并报告 + 8 份 W6 验证报告 + `synth/delta-overview.md`
> （v1.5.29 对架构的改变总览）+ `L0/` 机读普查产物 + `docs/apm/RULE.md` 术语定义 +
> `docs/Iterations/repo-mega-cr-2026-10/ledger-v2.md`（对 `fe79b781` 的终局台账）。
> 每条信息带来源指针：**括号里的 `synth/xxx.md` 是该结论的出处章节；`delta` 指 `synth/delta-overview.md`；
> `L2` 指 `ledger-v2.md`；`RULE` 指 `docs/apm/RULE.md` 对应术语条目；`L0/xxx.md` 是机读普查产物。**
> 凡是从报告推衍、口径未在原文拍死的，统一标 `[待核对]`。
>
> **v2 相对 v1 的改动**，逐条对应 `delta` §3 的改写清单：A1/A2/A3（明文化正形态翻转）、A4（I2 改述）、
> A5（ref_count 持有者）、A6（RT-01 已修）、A7（内容池已删）、B1/B2/B3/B5/B7（新增事实补入）、
> 外加 §⑤ 债务地图按 `L2` 的 v2 定级重算。**§③ 流 3 新增一条隐含顺序约束**（回滚删尾的 read 引用 −1 必须先于 sweep）。
>
> 本文件是**导航图**，不是规范。行为契约以 RULE + 对应 synth 台账为准；本文件只回答「东西在哪、谁调谁、数据归谁」。

---

## ① 分层总图

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  宿主端（三端，各自持连接、装配 core service 图）                                    │
│                                                                                  │
│  apps/desktop (Electron)          apps/mobile (RN)                apps/cli        │
│  ┌ main      装配/边界执行者      ┌ runtime/ db/ storage/ 宿主装配 ┐  直调 core   │
│  │  148 invoke + 7 push          ├ services/ 宿主服务(82 文件)   │  无 IPC 层    │
│  ├ preload   5 成员跨进程桥       ├ components/ screens/ nav/ hooks│             │
│  ├ renderer  零数据访问           └ src/web/**  4 个 WebView 页面  │             │
│  └ shared    ipc-types 155 通道                                    └             │
└──────────────┬───────────────────────────────────────────────┬──────────────────┘
               │ desktop: main handler → runtime service        │ mobile: runtime 工厂
               │ mobile : 直接 import core 子路径（无 IPC）        │ (createMobileNovelMasterRuntime)
               ▼                                               ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  packages/core  （全部业务与领域逻辑，三端共享唯一真源）                              │
│                                                                                  │
│  ┌ service/**  应用服务层 ── 事务边界 · 缓存失效口径 · 业务编排                      │
│  │   agent/ chat/ vfs/ workplace/ skills/ provider/ checkpoint/ template/ compaction │
│  │                                                                            │
│  ├ domain/**   领域层 ── 模型与契约 / port / 纯函数（无 IO）                          │
│  │   chat(+message-checkpoint, depth, compaction-conditions, session-kkv)          │
│  │   vfs  agent  tool  prompt  skills  character-card  provider  workplace         │
│  │   smart-sort-rule  event  feature-flags  format  depth                          │
│  │                                                                            │
│  ├ infra/**    基础设施 ── 平台与技术协议                                            │
│  │   tdbc(连接协议) sql-template  llm-protocol  tokenizer  sksp                    │
│  │   content-cache  cloud-sync  db-backup  db-maintenance  nmtp                    │
│  │                                                                            │
│  ├ bootstrap/**  DDL 与迁移：SCHEMA_BOOT_VERSION=17 · 16 DDL 模块                     │
│  │                 · 21 列对齐 · 6 条 migration · integrity-repair registry         │
│  │                                                                            │
│  └ public/*.ts   25 个 exports 子路径（12 个有 allowlist 快照）[待核对 CS-27 口径]   │
└──────────────┬────────────────────────────────────────────────┬──────────────────┘
               │ repository / sql-template / tdbc                │ ObjectStoragePort
               ▼                                                ▼
┌──────────────────────────────────────────────┐  ┌────────────────────────────────┐
│  存储层                                        │  │  外部                          │
│  ┌ TDBC 驱动（连接协议抽象）                     │  │  ┌ LLM API                    │
│  │  desktop/cli: better-sqlite3                │  │  │  openai / anthropic / gemini │
│  │  mobile     : op-sqlite（+ rn 旧驱动回滚线）  │  │  │  经 infra/llm-protocol 适配    │
│  ├ KKV（按 sessionId 路由）                     │  │  │  出站合并在协议层 · 不落库      │
│  │  域 rule_snapshot / file_cache / user_vfs_pending(历史)                          │
│  │  module nm-*（L0/kkv-domains.md）           │  │  ┌ S3（用户自备桶）             │
│  ├ VFS（scope: global / project / session）      │  │  │  ObjectStoragePort + 条件 PUT │
│  │  vfs_entry → vfs_revision → vfs_content_blob │  │  ├ WebView（mobile）           │
│  └ SQLite 业务表（L0/sql-table-usage.md）        │  │  │  4 页打进 APK · postMessage 桥│
│     chat_message / chat_session / chat_project   │  │  └ SKSP 凭证（平台密钥仓）      │
│     message_checkpoint(+_file) / agent_definition │  └────────────────────────────────┘
│     llm_provider / llm_saved_model / sksp_secrets │
│     session_run_state / smart_sort_rule /         │
│     skill_disabled_rule / workplace_dir_rule /   │
│     session_file_cache_entry(+_blob) /            │
│     schema_migrations / kkv_entry                 │
└──────────────────────────────────────────────┘
```

**v1.5.29 的三处结构变化**（`delta` §2，均已在本图体现）：

1. **`chat_message` 的两列语义翻转**——`content_json` 从「明文保留列」变成**正形态**，而
   `content_encoding` + `content_blob` 从「正形态」变成**迁移期存量形态**（新写入恒 NULL）。
   列**不删**（schema CHECK 原样保留）。
2. **`vfs_revision` 的引用计数语义扩容**——持有者从两类（checkpoint 文件指针 + live head）
   扩为**三类**（+ 消息侧 read/skill 引用）。
3. **`db-maintenance` 的任务方向反转**——正向 `message-content-compaction.ts` **整文件删除**，
   换成反向 `message-content-decompression.ts`；两者的收尾语义**相反**（见 §③ 流 2 补注）。

**一句话读法**（synth/core-data.md 架构小结 L34-41 的分层法在 core 内部完全成立）：
core 是「L1 模型/契约 → L2 存储 port → L3 纯函数 → L4 应用服务」四层，越往下越依赖 IO。
唯一运行期真耦合环是 `service → domain/tool → service`，靠 type-only import 断开（synth/core-data.md L48）。

**两处已知的方向裂缝**（synth/core-misc.md 架构小结 L1093-1097）：`domain/prompt/logic/expand-dynamic-macros.ts` 引
`service/workplace` 的 port（唯一一处理想倒置，目前无环）；`infra/nmtp/ports/tokenizer-driver.port.ts` 反向引
`infra/tokenizer` 的实现（port 引实现）。另有 `domain/workplace/logic/load-or-fill-file-cache.ts` 引
`domain/character-card` 的体积闸门、`domain/provider/model/*` 三处引 `infra/tokenizer/logic/*`。

> ⚠️ **v1.5.29 新增的一处「同模式第二份实现」**：`domain/chat/repositories/impl/sqlite-message.repository.ts:91`
> 的 `runInTransactionOrConn` 按 `revision-aware-vfs.service.ts` 的模块私有函数**同一形状**复制了一份
> （注释自陈「避免 domain 层反向依赖 service 层」）。契约本身仍成立（嵌套 `transaction` 必抛
> `NESTED_TRANSACTION`，三驱动一致），但**同一模式现在有两份拷贝**（`delta` §4.2 / `L2` §9 附录）。

**跨层铁律**（synth/core-data.md L51-52）：驱动事务持锁期间**只有 tx 面能查**，走外层 `conn` 会重入
AsyncMutex 死锁（不是报错）；事务内不得 VACUUM。

---

## ② 模块导航

### M1 · 消息数据面（core-data 簇）

- **职责**：消息/附件/会话/项目的类型与 wire、blocks 解析、提示词拼装、区间计算、回滚锚点解析、checkpoint 捕获与回放、usage 聚合、**read/skill 引用的 view-time hydrate**。
- **关键位置**：`packages/core/src/domain/chat/{model,content,logic,repositories}`、`domain/message-checkpoint/{model,repositories,logic}`、`domain/depth`、`domain/compaction-conditions`、`service/chat/*`、`service/message-checkpoint/*`（synth/core-data.md L36-41）。
- **新增关键位置**（v2）：`domain/chat/logic/hydrate-tool-results-for-prompt.ts`（引用块 view-time 重放）、
  `domain/tool/logic/skill-read-truncation.ts`（skill 两个 action 的截断推导单源）。
- **对外接口**：`MessageService` / `MessageRepository`（18+ 方法）、`MessageCheckpointService`、`SessionService`（create/fork/copy/push）、`UsageStatsService`。
- **数据归属**：`chat_message`（23 文件引用）、`chat_session`（6）、`chat_project`（5）、`message_checkpoint`（2）+ `message_checkpoint_file`（4）；每消息 token 列（prompt/completion/cache_read/cache_creation/provider/model_name）。

  > ⚠️ **v2 改写（原 A1）**：正文走 **`content_json`（明文为正形态）**，而
  > `content_encoding` + `content_blob` 是**迁移期存量形态**（新写入恒 NULL，`updateContent` **三列齐置**）。
  > 与之并存的是 `ToolResultBlock.contentRef`（`:59`，加法式可选字段）——
  > 存在时该块的 `content` 是**占位空串**，正文改由 `contentRef` 指向 VFS revision。
  >
  > `ReadResultRef`（`content-block.ts:100`）的判别口径是 **`kind?: "read"` 缺省即 read**
  > （存量行无该键，零迁移兼容），且 **parse 侧有意不回构 `kind`**（回构会让落库 JSON 凭空多一个键、
  > round-trip 不再逐键稳定）；`SkillResultRef`（`:145`）则是 **`kind: "skill"` 必带**的判别字段。
  > 全链窄化统一按 `kind === "skill"` 分派，其余一律按 read 走。
- **被谁消费**：desktop `handlers/chat.ts` / mobile `session-stream-unit-manager` / `useChatTabMessages` / CLI `src/cli-errors.ts`；usage 侧是双端 Token 统计页。

### M2 · VFS 与存储底座（core-storage 簇）

- **职责**：逻辑路径树 + 版本链 + 内容寻址 blob；SQL 动态模板；连接协议抽象；DDL 与迁移；事务边界。
- **五层数据流**（synth/core-storage.md L36-45，逐字照抄）：
  ```
  ① domain/vfs/logic（纯函数）→ ② domain/vfs/repositories/impl（SQL 拼装，全经 sql-template）
  → sqlite-vfs-entry / -revision / -content-store
  → ③ bootstrap/vfs（DDL + 3 个 blob ref_count 触发器）
  → ④ service/vfs/impl（事务边界）→ ⑤ service/chat|template|skills（业务编排）
  ```
- **对外接口**（v2 扩写，原 B-补）：`VfsService` / `RevisionAwareVfsService`（读）、`VfsBatchIoService`、`TdbcConnection`（`transaction` 整体跑在 AsyncMutex 内、不可重入），
  **外加 v1.5.29 新增的 `SqliteVfsRevisionRepository`（实现类）+ `VfsRevisionRepository`（port）**。
  > ⚠️ `public/vfs.ts` 此前**零 sqlite 实现类出口**（消费者拿到的都是 service 层），
  > v1.5.29 **第一次**从这里暴露 repository 实现类，理由是三端 runtime 都要
  > `new SqliteVfsRevisionRepository(conn)` 装配 read 计数通道与 hydrate 主链。
  > 随之确立的装配纪律：**同 conn 单实例**。新 port 方法 `listKeysWithRefCountUnderScope` 只被 hydrate 用。
- **数据归属**：`vfs_entry`（33 文件引用，最大）、`vfs_revision`（26）、`vfs_content_blob`（23）；scope 三层 global/project/session（RULE VFS）。vfs 表索引只有 `idx_vfs_entry_scope_path` 与 `idx_vfs_revision_entry`，两表 `content_hash` 均无索引。
- **被谁消费**：`domain/tool/builtin/vfs-tools.ts` 的 read/write/edit/fs/glob/grep、desktop `handlers/vfs.ts` + `vfs-batch.service.ts`、mobile 四个 VFS 工厂、云同步整库搬运。

### M3 · 工作区与提示词缓存（core 域，跨 core-misc / core-runtime）

- **职责**：按「规则快照 + 文件缓存」拼装每轮固定注入的 `<workplace>` 前缀；短提示去重判定；目录规则引擎。
- **关键位置**：`packages/core/src/service/workplace/`（装配 `assemble-workplace-display.ts`，服务 `impl/workplace.service.ts`）、`domain/workplace/logic/{workplace-rule-engine,load-or-fill-file-cache}`、`domain/chat/logic/prepare-user-messages-for-prompt.ts`、分流 `domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts`（RULE 常驻工作区）。
- **数据归属**：KKV 域 `rule_snapshot` + `file_cache`（正文已去重化：`session_file_cache_entry` 存引用、`session_file_cache_blob` 全库一份 sha256）；表 `workplace_dir_rule`（2 文件引用）。归属键有两个且**刻意不等**：`workplaceScopeSessionId`（子会话指父，共享工作区）vs `kkvScopeSessionId`（恒等自身）。
- **被谁消费**：`service/agent/impl/agent-runner.ts` 每 step 组装；双端设置页的目录规则表单（`DirectoryRuleSheet.tsx` / `DirectoryRuleModal.tsx`）。
- ⚠️ **v2 补注（原 B4）**：「派生缓存与库同寿命」这条纪律原本由「消息正文池 + content-body 池」两条支撑，
  v1.5.29 删掉前者后**只剩 `contentBodyPool` 一条**，`RULE:138` 的论证链需相应收窄。

### M4 · 智能体运行时（core-runtime 簇）

- **职责**：一次发送 = `runAgentTurn` 前奏（清洗 → backfill checkpoint → 解析 agent/model → append 用户消息 + capture baseline → 装配 toolCtx）→ `DefaultAgentRunner` 多步主循环（列消息 → 组装工作区 → prepare → 压缩评估 → LLM → 并行工具 → checkpoint → 落 tool_results → doom-loop → usage 回锚）；旁挂 abort/stream/agent 定义三张进程内表 + `runChildAgent` 递归（synth/core-runtime.md L44）。
- **关键位置**：`domain/agent/`（含 `session/` 端口）、`service/agent/{logic,impl}`（`run-agent-turn.ts`、`agent-runner.ts`、`default-subagent-definition.ts`）、`domain/tool/builtin/`。
- **新增关键位置**（v2）：`service/agent/logic/run-agent-turn.ts:201` 的 `resolveReadRefCountChannel`（read 引用 +1 通道的单点收口）。
- **对外接口**：`AgentSession` port、`AgentRun`、`AgentStreamRegistry`、`BuiltinToolContext`。
- **数据归属**：agent registry（`agent_definition` 表，6 文件引用）、`session_run_state`（3）、KKV `nm-agent-keepalive` / `nm-agent-finished-*`。
- **被谁消费**：desktop `handlers/agent.ts` + `useAgentStream`；mobile `session-stream-unit-manager` 的 `startRun/stopRun`；`task` 工具派生 `general` 子代理。
- **注意**：端口声明在 `domain/agent/session/`，两个生产实现却在 `service/agent/impl/`，域层因此看不见真实契约（synth/core-runtime.md L46）。
- **v2 补注（read 引用的装配纪律）**：
  ```
  resolveReadRefCountChannel（run-agent-turn.ts:201）
    runtime.adjustRevisionRefCount（显式，测试探针口）  ← 优先
      ↓ 否则
    runtime.revisionRepo.batchAdjustRefCountWithDelta   ← 生产推导
      ↓ 两者都缺
    undefined → read 回落 legacy 全文形态（不 +1、不带 entryId、不产引用块）
  ```
  `revisionRepo` 单点收口、双职责：① 推导 read +1 通道（主/子两个 toolCtx 装配点共用）；
  ② 经 `assembleAgentRunnerDeps` 透传给 runner 的 prepare（hydrate 主链）。
  **「能力未注入时回落 legacy 全文」是刻意设计**——三端 runtime 随 hydrate 就绪才打开，
  避免「产引用块但 wire 还原未接线」的中间态。
  但**已装配之后是 fail-fast 而非降级**：消息含 `contentRef` 而 `revisionRepo` 未装配 ⇒
  抛 `ReadResultHydrateError(READ_REF_REPO_MISSING)` 中断装配，理由是引用块的 `content` 就是空串，
  静默放行等于给 LLM 发空 tool_result。

### M5 · 提示词与技能（core-misc 簇内）

- **职责**：prompt 三区（dynamic/S0 常驻/对话）布局；宏展开；技能域（SKILL.md + 附属文件）与内置技能种入；角色卡体积闸门。
- **对外接口**：`expand-dynamic-macros.ts`、`seed-builtin-skills.ts`、`SkillsService`（`assertSkillNameNotReservedForCreate`、`writeSkillFile(expectedVersion)`）。
- **数据归属**：技能在 VFS 独立 meta 域（global-meta/project-meta）；`skill_disabled_rule`（4 文件引用）；KKV `nm-seeds`；角色卡/技能名常量三处口径不一 [待核对 M-12]。
- **被谁消费**：agent-runner 每 step；双端技能面板；导入链路 `character-card-import.service.ts` / `vfs-zip-io.service.ts`。
- **v2 补注**：`normalizeAgentPromptLayoutDomain` 的白名单**连续两次漏新增字段**
  （`L2` 的 N-P1-02：漏 `skillsEnabled` / `skillsPrefix`，而 `customAttach` 是上一次）⇒
  加 exhaustiveness 断言而非逐字段补，是 Wave E 的既有钩子。

### M6 · 服务商与协议适配（core-misc 簇内）

- **职责**：provider 实体与仓储、模型建议/重试策略、LLM 出站协议映射。本簇质量最高的模块：零持久化、零三方依赖、不 import 原生包、transport 鸭子类型注入（synth/core-misc.md L1104）。
- **关键位置**：`domain/provider/**`、`service/provider/impl/model-request.service.ts`、`infra/llm-protocol/logic/{anthropic,gemini,openai}-content-mapper.ts`、`infra/tokenizer`。
- **数据归属**：`llm_provider`（10 文件引用）、`llm_saved_model`（6）、`sksp_secrets`（6）；KKV `nm-model-suggestions` / `nm-model-retry` / `nm-preferences`。
- **被谁消费**：agent-runner（`inferLlmProtocolFromSavedModelId`）；用量统计页的模型筛选；删除守卫（漏扫会话级 modelId，`L2` 的 M-04 维持 P1）。
- ⚠️ **v2 新增安全面（`L2` 的 §6 #8-#10 待验证节）**：`gemini-sse-parser.ts:122` 用 `fc.id ?? fc.name` 作累加器键
  （`functionCall.id` 缺席时同名并行调用塌成一个）、`anthropic.adapter.ts:134` 的 `max_tokens: 4096` 硬上限、
  `stream-partial-blocks.ts` 中断快照丢 `thinkingSignature`（类型里根本没这字段）——三条在 `L2` 挂单源待验证，
  此处登记为导航项而非既成结论。

### M7 · 云同步与备份（cloudsync 簇）

- **职责**：把「本机整库」当唯一同步单元；导出走 checkpoint + 文件级拷贝 + 剥掉服务商三表（密钥不出设备）；拉取走下载整库快照 + SHA-256 校验 + dump 三表 + 关连接 + 覆盖库文件 + 写回三表 + 重建 runtime（synth/cloudsync.md L14-17）。
- **关键位置**：`packages/core/src/infra/cloud-sync/`（`impl/cloud-sync-coordinator.ts`、`ports/{ObjectStoragePort,DbSyncPort}`、`logic/{lock,paths}`）、`infra/db-backup/provider-table-snapshot.ts`、`packages/cloud-sync-driver-s3/`、两端 `db-backup.service.ts` + `cloud-sync.service.ts`。
  > ⚠️ **v2 路径订正**：`cloud-sync-driver-s3` 的实现从 `src/impl/` 移到 `src/`（打包布局变化），
  > 即 `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts`（不再是 `src/impl/…`）。
- **对外接口**：`CloudSyncCoordinator.pull/push`、`export/importDatabaseBackupFrom*`、`isDesktopCloudSyncBusy` / `isMobileDbMaintenanceBusy`。
- **数据归属**：远端 `status.json`（`schemaVersion/rev/snapshotKey/snapshotSha256/lock`）+ `snapshots/rev-{6位}.nmbackup`（只增不删）；KKV module `nm-cloud-sync`（desktop 14 键 / mobile 13 键）+ SKSP ref `cloud-sync/s3-secret-key`；本地回滚副本 `<dbPath>.nmbackup.bak`。
- **被谁消费**：desktop `handlers/cloud-sync.ts`（IPC 五路）+ `handlers/backup.ts`；mobile `CloudSyncProgressScreen.tsx`；两个后台维护循环读 `isXxxDbMaintenanceBusy` 让路。

### M8 · apps/desktop 四层

职责/边界见 synth/apps-desktop.md L397-427 的架构图与 §职责与边界 L20-33。要点：main 不写业务 SQL（唯一例外 `connection.ts:58` 的 `PRAGMA wal_checkpoint`）；renderer 零数据访问但**违反 9 处**（S-D-06）；加一条 IPC 通道要同步四处（`ipc-types` / `handler-registry` / `invoke-registry` / `client`）；`ShellNavProvider` 是 46 个 context 成员的单点状态源。

> ⚠️ **v2 补记（原 B5，v1.5.29 的 DTO 变化）**：IPC **通道数不变**（148 invoke + 7 push），
> **不是新通道，是既有 DTO 扩字段**：`ipc-types.ts` 新增 `ContentBlockDto.contentRef`（两形态 union 手工镜像）
> 与 `MessageDecompressStatusDto`（原 `MessageCompactionStatusDto` 改名）、`DbStatsResult.messageDecompress`
> （原 `messageCompaction` 改名）。renderer / mobile 组件**零改动**——
> `git grep contentRef -- apps/desktop/renderer apps/mobile/src` 在 core 侧无命中（UI 卡片靠既有 `summary` 渲染，
> 占位投影只在 `ipc/handlers/messages.ts:82-106` 的 `bodyText` 一处）。

> ⚠️ **v2 新增的结构性事实（`L2` 的 N-P1-05）**：**渲染层长期无类型门禁**——
> `package.json` 的 `typecheck` 只跑 `tsconfig.json`（`include: ["src/main/**/*","shared/**/*"]`，**不含 `renderer/`**），
> `tsconfig.renderer.json` 存在却无任何 npm script / CI 步骤引用它，`build` 走 `vite build`（esbuild 只转译不查类型）。
> W11 实测基线：**424 条错误**（其中 `renderer/features/**` 160 条）。
> 这是「分层纪律」的破口而非分层变更，但凡引用本仓 renderer 代码的 file:line，都要意识到**它可能类型不成立**。

### M9 · apps/mobile 四段

四段分工见 synth/apps-mobile.md §职责与边界 L27-32。要点：`SessionStreamUnitManager`（1977 行）刻意不进 runtime 工厂，由 `novel-master-context.tsx:176-186` `Object.assign` 事后挂上——**它是消息面与 run 面的唯一真源**；`idleMessageViews` 无上限（对照 view cache 是 500 LRU）；WebView 是三层产物链，改 `src/web/**` 必须 `npm run build:webview` + `build:webview:native` 才进 APK，Metro reload 碰不到（RULE:73）。

> ⚠️ **v2 补记（`L2` 的 N-P0-01）**：产物链的**第三层**（`webview-dist/**` → APK assets）里有一条源码面看不出来的约束——
> `composer-input/app.js` 为了拿 3 个宏白名单常量，从 `@novel-master/core/prompt` 桶文件 import，
> 把 core 的 provider 表整块拖进 bundle，且 `Object.fromEntries`（Chrome 73+）出现在 **IIFE 模块顶层**
> ⇒ WebView < 73 上整个脚本抛 `TypeError`、编辑器不挂载、ready 不上报、宿主等不到握手。
> **产物面必须单独设门禁**（bundle 里出现 `Object.fromEntries`/`replaceAll`/`.at(`/`Object.hasOwn` 即 fail），
> 源码面的 lint 与 tsconfig 都拦不住这条。

### M10 · 死码 / 死导出（dead-backlog 簇）

职责：把 core 363 条 C 类 + apps/periph 24 条并成一张可执行删除清单。可信可删 **387 条 ≈ 2 886 行**，切 3 批（synth/dead-backlog.md L15-21）。注意 L0 死表**不能直接当删除清单**——桶定义有缺陷（`testOnly` 未排除 `relayed`，35.7% 的行实际有生产消费方）。

---

## ③ 六条核心数据流

### 流 1 · 发消息 → 提示词 → LLM → 工具循环 → 落库

```
用户发送
 └ runAgentTurn 前奏：清洗输入 → backfill checkpoint → resolveAgentForProject（永远走 session 分支）
                     → append 用户消息（nextSeq=MAX(seq)+1 → toMessageParams）
                     → capture baseline（工作区整树指针快照）→ 装配 BuiltinToolContext
 └ DefaultAgentRunner 每 step：
    ① session.list()（可见全会话；明文行为正形态，迁移期压缩行才需 inflate）
       ⚠️ 本簇头号 P0 已变成 RT-02（每 step 两次独立读），RT-01（gemini 读口过宽）已修
    ② 组装常驻 workplace 前缀（loadOrFillFileCache，命中无条件返回、无 mtime 校验 ⇒ 前缀回合内冻结）
    ③ prepare-user-messages-for-prompt：hydrate 引用块（最后一步）→ attach hydrate / 短提示 alreadyReferenced 判定
    ④ shouldRequestCompaction（token-ratio OR visible-floor）→ runCompaction
    ⑤ 出站：infra/llm-protocol（anthropic/gemini 发送时合并相邻 user turn，不落库）
    ⑥ 并行工具（toolRunner.runParallel 按 pathTail 同路径串行化）→ VFS 写入 + checkpoint capture
    ⑦ vfsMutated 判定 → checkpoint → 落 tool_results → doom-loop → usage 回锚
 └ 写盘：append → nextSeq → toMessageParams（明文直写 + 两压缩列显式 NULL）→ assertMessageContent
```
来源：synth/core-runtime.md 架构小结 L44/L48；synth/core-data.md 架构小结 L58-59；RULE「回合快照」「出站合并」；`delta` §2.1/§2.2/§3。

> **v2 改写（原 A2/A3 + B1）**：前奏与写盘两处的 `encodeMessageContent` **已终删**（正向压缩任务整文件删除后一并清掉），
> 换成 `toMessageParams`——**写侧直写 `content_json` + `content_encoding`/`content_blob` 显式绑 NULL**。
> `updateContent` 是**三列齐置**（`SET content_json=…, content_encoding=NULL, content_blob=NULL`），
> 这是 P0 级约束：只写 `content_json` 时读路径的「blob 非空优先」分支会解出**旧正文**，不崩溃、只静默返回错内容。
>
> `① session.list()` 那行的两处口径改写：①「逐行 inflate」只对**迁移期压缩行**成立，明文行不 inflate；
> ② 「每 step 全量读是本簇头号 P0」已不成立——**RT-01 在 `e2d10b3f` 修掉了「含 hidden」那一半**
> （`listAllSessionMessages` → `listVisibleSessionMessages`，`includeHidden: false` + 懒求值，
> 实测每步两发 368.2 → 23.9ms，−93.5%）。**但 RT-02（两次独立读）没被顺带解决**，
> 且残留的「可见集全列 + 无 memo」是纯性能债、无正确性风险（`L2` §8 记着它的定级争议）。

### 流 1b · read / skill 引用的「存引用 → view-time 重放」（v1.5.29 新增）

```
read / skill read / skill load 执行
  → 拿 head 定位三件套（entryId / contentHash / totalBytes）且 adjustRevisionRefCount 已注入
    ⇒ 先于工具返回 +1（堵「返回→落库」的 sweep 窗口），并把三件套放进输出
       「输出带 entryId ⟺ +1 已发生」是自洽闭环，buildToolResultBlock 据此产 contentRef
  → contentRef = resolveReadResultRefFromOutcome(toolName, output)
              ?? resolveSkillResultRefFromOutcome(toolName, output)
       （content 为占位空串、summary 照旧、派生参数自包含可重放）
  → 落库 content_json（含 contentRef，parse 侧不回构 kind）

下一轮发送前
  prepare-user-messages-for-prompt.ts
    → hydrateToolResultsForPrompt(out, runtime.revisionRepo)   ← return 前最后一步
       ① findMetaByEntryAndVersion 只取 status / content_hash 两列、零解码
       ② 四种 fail-fast：REPO_MISSING / REVISION_MISSING / CONTENT_DELETED / HASH_MISMATCH
       ③ 调内去重（HydrateMemo）：plainByRefKey 键含期望 hash、wireByReplayKey 键必含 kind:action
       ④ 截断管线与执行时逐字节同参重放 ⇒ wire 逐字节等值
  → 必须在 normalizeOrphanToolResultsForLlm 之前（孤儿拍平吃 messageBodyText，
    未 hydrate 的空 content 会被拍成占位文本、wire 全文丢失）
  → hydrate 是纯内存态：填回 content，contentRef 原样保留，不写回 content_json
```

> **两条纪律值得记住**：
> ① **不做跨调用持久缓存**——dangling / 已删除的 fail-fast 是保活链断裂的**安全网**，
> 持久缓存会把已消失的 revision 明文继续发出去、把安全网盖住。缓存范围严格限定在「一次 prepare 装配内」。
> ② **主链（LLM 装配）与 parity 链（token 计数 / 压缩评估）共用本函数**，字符串口径必须一致。
>
> **wire 不变式（承重约束，改动需版本化）**：

| 引用类型 | 截断管线 | 冻结 formatter | 单源函数 |
|---|---|---|---|
| read | `sliceLinesFromOffset` + `capUtf8BytesFill`（50KB 预算） | `formatReadOutput` | 内联于 hydrate |
| skill read | `truncateLine`（2000 字符）+ `capUtf8Bytes`（整行丢弃） | `formatReadOutput` | `deriveSkillReadTruncation` |
| skill load | 同上但全量 | `formatSkillLoadOutput` | `deriveSkillLoadTruncation` |

> skill 的两个推导函数抽在独立文件，理由是**分层**：执行侧在 `domain/tool/builtin`、重放侧在 `domain/chat/logic`，
> chat 侧不得反向依赖 builtin。**这是「单源注释比单源实现多」那条结构性热点的正解案例**——
> 本波选择「开内部出口」而非「复制两份管线」。

### 流 2 · 压缩 / 置位

```
压缩：shouldRequestCompaction → runCompaction → hideStartDepth（默认 6，仅启发式）
      → 从最新边界向更旧找第一条真用户输入 → 只隐藏严格更旧的消息 → updateHiddenRange
      → 压缩后可见历史必以 user 开头，保留条数 ≥ startDepth+1（绝不拦腰切断轮次）
置位：用户选一条 user 消息当地板 → 隐藏它之前的全部前缀（锚点必须是 user 消息）
两者共同副作用：清 rule_snapshot + file_cache
```
**读路径必须分清**（RULE「短提示规则」）：日常多轮，file_cache 不清、可见历史首次引用还在，判定以**可见历史里的首次引用**为准；置位/压缩时可见窗口与 cache 一起清掉，判定以 **cache** 为准，且 `file_cache` 已被清空，读盘时重新写回。
`core-runtime.md` L60 另有一条口径登记为 intentional：**压缩不清 `rule_snapshot`/`file_cache`（2026-09-29 拍板）**——与 RULE 术语条目存在版本差 [待核对主代理拍板]。

> **v2 补注：v1.5.29 后「压缩」这一段的方向反了。** 正向压缩任务 `message-content-compaction.ts`
> **整文件删除**，换成反向 `message-content-decompression.ts`（`runMessageContentDecompress`），
> 三端调度器全部换向（desktop / mobile 重命名 service、CLI 内联）。
> **两者的收尾语义相反、不可照抄**：
> 正向任务压缩释放页 ⇒ 挂 VACUUM 有实打实收益；反向任务是**增容**，库里没有可归还的 freelist 页，
> VACUUM 只会全库重写、白烧一次同步阻塞 ⇒ **`message-content-decompression.ts:540` 刻意不挂收尾维护链路**。
>
> 反向任务的三条硬纪律（都写在实现里，改动时勿动）：
> ① **入口自愈探针**：完成标记 `nm-message-decompress` 随整库快照 travels，
> pull 回灌旧快照会把「已解完」标记带到仍是压缩态的库上 ⇒ 入口先跑一次 `SELECT 1 … LIMIT 1` 探针，命中即清标记续搬；
> ② **坏行隔离**：decode 失败**原样保留压缩字节、不强行转换**、fail-fast 带消息 id；
> ③ **收尾不变量**：`leftover > failedKeys.size ⇒ stalled = true`、**不置完成标记**。
> 没有这道校验，任务会谎报完成并把残留永久封在库里。

### 流 3 · 回滚

```
用户从某条消息发起回滚
 └ resolveRollbackAnchorMessage（对隐藏消息同样可用，无 !hidden 前置；不改变任何可见性）
 └ resolveRollbackTargetTree：undo_send 走 prior-only / rewind 走 anchor 自身
 └ resolveReconcilePathSets → pathsNeedWrite / pathsNeedDelete
 └ 事务内 reconcileVfsPaths：重扫 live heads + resetHeadToVersion + 删尾 + checkpoint ref_count 递减
 └ 提交后失效 prompt_tokens / toolUseCount → deferred 全局孤儿 GC
```
`message_checkpoint` 域只读 `vfs_entry`，唯一跨域写入是 `backfill-missing-revision.ts` 往 `vfs_revision` 插占位行（synth/core-data.md L46）。回滚是**物理删尾**（`DELETE WHERE seq > ?`），删后新消息复用旧 seq（RULE「seq」）。

> ⚠️ **v2 新增的隐含顺序约束（`delta` §3.3）**：回滚删尾现在**多了 read 引用的 −1 挂点**，
> 且它**必须先于 `sweepSessionRevisions`**（`domain/message-checkpoint/logic/truncate-tail-in-transaction.ts:81`）——
> 否则被引用的 revision 会被 GC，而**内容不可再生**。
> 机制描述（物理删尾、seq 复用）不变，但这条顺序约束是新加的，改回滚链时必须一起看。

### 流 4 · 云同步 pull（时间线四段）

```
T0 pre-pull   pull() 入口只查 syncBusy（desktop）；不查 maintenanceBusy、不抢 pushMutex、不查 isAgentActive
T1 pull 中    下载整库快照 → SHA-256 校验 → dump 本机三表 → 关连接（closeLiveDbForBackupImport）
              → 覆盖 dbPath → 写回三表
T2 rebootstrap rebootstrapDesktopRuntime / onRebootstrap：close → 重建服务图
T3 后续       记账 setLastSyncedRev + recordPull → 放 busy 令牌 → push / UI
```
**本簇核心判断**（synth/cloudsync.md L19-23）：pull 会在 `importSnapshotFromPath` 内部关掉本进程唯一那条数据库连接，而收尾记账与桌面 service 单例都持着这条已关连接上的句柄——全簇真实缺陷几乎都挂在这一个断点上。修复骨架分四组 M1（修 invalidation）/ M2（修时序）/ M3（修互斥）/ M4（修数据与资源安全），**M1 是 M2 的前置**（L811）。

> ⚠️ **v1.5.29 给了这条流一个新负担**：库文件里现在可能带着**未解完的压缩消息**。
> `runMessageContentDecompress` 的完成标记随快照 travels 这件事，让 pull 的回灌路径多了一种「标记闩锁」形态——
> 反向任务的入口自愈探针就是为它准备的，但**云同步侧不感知这个状态**：
> `isMobileDbMaintenanceBusy()` / `isDesktopCloudSyncBusy()` 的语义里没有「正在搬正文」这一项（`L2` 未立案，见 §⑤）。

### 流 5 · WebView 渲染（mobile）

```
src/web/<pkg>/**                        ← 改这里 Metro reload 无效
  │ build-webview.mjs（esbuild bundle/iife/es2018/packages:'bundle'）
  ▼ webview-dist/<pkg>/{index.html,app.js,app.css}
  │ --copy-native → replaceCopyDir 整目录替换
  ▼ android/app/src/main/assets/webview/<pkg>/  +  ios/…/WebViewDist/<pkg>/
  ▼ RN <WebView> 加载 file:///android_asset/webview/<pkg>/index.html
    ↕ postMessage 桥（host-message-channel.ts 做 v+type 校验）
```
信任边界分层：RN 侧 `sanitizeRichHtml` / `prepareTranscriptRichHtml` 消毒后传入，web 侧只做 `TrustedHtml` 渲染、`mermaid-core.ts` 显式 `securityLevel:'strict'`——`applyStreamBlockCommit` 的裸 `insertAdjacentHTML` 依赖的正是「RN 侧已消毒」这个前提（synth/apps-mobile.md L107-110）。mermaid 只能在 WebView 侧生成（sanitize 白名单不含 SVG，RN 层不产 SVG，RULE「mermaid 双管线」）。

> **v2 补记：这是六条流里唯一「产物面会出事」的**（`L2` 的 N-P0-01）。
> 信任边界分层管的是**数据**（消毒），管不住**代码**——bundle 里跑什么语法，源码面的三层（lint / tsconfig / 类型检查）全拦不住。
> 唯一的防线是**在 `build-webview.mjs` 里对产物做静态门禁**。

---

## ④ 架构不变量清单

> 前四条是 RULE 的产品拍板，后七条是 synth 台账在核验中确认成立的结构纪律。

| # | 不变量 | 出处 | v2 状态 |
|---|---|---|---|
| I1 | **前缀回合内天然冻结**：`loadOrFillFileCache` 命中无条件返回、无 mtime 校验，agent 回合中写盘不改变前缀。改写缓存的只有用户改规则、压缩/置位、会话删除四种 | RULE 常驻工作区 | 成立 |
| I2 | **双形态读保留至 V1'**（**v2 改述**）：消息正文写侧是**明文正形态**（`content_json`），压缩两列是**迁移期存量**；读路径双形态保留，两种行都永远合法（跨版本快照混布 / 迁移中断 / 坏行全靠它）。**新代码严禁假设单一形态**；V1' 之后才收为单形态 | RULE 消息正文压缩列；`delta` §2.1（+ 退役清单） | **方向已翻转**（原写「legacy 明文」，现在是「压缩为存量」） |
| I3 | **前置回合宏值取 run 开始的一次快照**（`$time`/`$week_cn`/`$filetree` 与 customAttach），回合内所有 step 复用同一份文本，目的是提升 provider 前缀缓存命中 | RULE 回合快照 | 成立 |
| I4 | **出站合并不落库**：anthropic/gemini 在发送时合并相邻 user turn，只影响 wire format；openai 输出天然合法零改动 | RULE 出站合并 | 成立 |
| I5 | **驱动事务持锁期间只有 tx 面能查**，走外层 `conn` 会重入 AsyncMutex 死锁（不是报错）；事务内不得 VACUUM；维护链路（GC → wal_checkpoint → VACUUM）收敛在 `infra/db-maintenance/` 且事务外直调 | synth/core-data.md L51-52；RULE:72 | 成立。⭐ **v2 补一条**：`VACUUM` 的这条只适用于**释放页**的维护任务——明文化链的反向搬运是**增容**，刻意不挂 VACUUM（见流 2 补注） |
| I6 | **`schema_migrations` 只登记不搬运**；数据搬运一律走谓词驱动后台任务（批 ≤100、单行短事务、谓词进 WHERE 保幂等、KKV 完成标记）；空占位 migration 严禁登记 | RULE:109 | 成立 |
| I7 | **加列三件套**：DDL 建列 + `SCHEMA_COLUMN_ALIGNMENTS` 条目 + bump `SCHEMA_BOOT_VERSION`（现为 **17**），缺一存量库永远补不上 | RULE:78 | 成立 |
| **I7'** ⭐ | **第三条 DDL 纪律：纯 DDL 幂等建索引**（不 bump 版本、不注册 migration、落 bootstrap **事务外**的无条件段、**失败 fail loud** 不包 try/catch）——唯一代表是 `idx_chat_message_pending_blob` | `delta` §3.2 B3；`novel-master-bootstrap.ts:378-401`（**W11 已核对现行注释与落点**） | **v2 新增**。它与 I7（加列要 bump）、I6（空占位禁登记）都不同：失败语义也刻意与同层 `seedBuiltinSkills` 的「失败仅记日志」相反 |
| I8 | **`listBySession` 恒含 hidden**，`includeHidden:false` 必须显式传；`listBySessionOffset` 的 offset 是**行偏移不是 seq 值** | synth/core-data.md L55 | 成立。⭐ **v2 补记**：`agent-runner` 的两个读口已显式传 `includeHidden:false`（`e2d10b3f`）——**但只有这两处**，其余调用方仍恒含 hidden |
| I9 | **`ref_count` 三类计数器并存**：① `vfs_revision.ref_count`（应用层）② `vfs_content_blob.ref_count`（SQLite 触发器，**只数 revision 行、看不见 `vfs_entry.content_hash`**）③ `message_checkpoint_file` 的 ref。T-SC5 裁决「三者并存不矛盾，绝不强行合一」 | synth/core-storage.md L49-52 / L94；synth/core-data.md L60 | **v2 补写（原 A5）**：①这一层**内部**从两类持有者（checkpoint 指针 + live head）扩为**三类**（+ **消息侧 read/skill 引用**，全局键跨会话指向源 revision）。`batchRepairRefCountFloor` **只改 `ref_count` 不改 `content_hash`**，所以 blob 触发器不 fire。方向**宁多不少**：无主 +1（read 后 append 前崩溃）由 repair 的 `overExpected` 检测，**只报告不自动修** |
| I10 | **VFS write/edit/skill 无锁 last-write-wins**（乐观锁已按 2026-09-06 拍板全拆），唯一保护层是 `pathTail` 同路径串行化，覆盖 write/edit/fs/skill 四个工具名；两处盲区已拍板接受 | RULE「VFS write/edit/skill 工具的并发语义」 | 成立 |
| I11 | **workplace 的两个归属键刻意不等**：`workplaceScopeSessionId` 子会话指父（共享工作区），`kkvScopeSessionId` 恒等自身（快照隔离） | RULE 常驻工作区 | 成立 |
| **I12** ⭐ | **引用块的 `content` 是占位空串，hydrate 失败一律 fail-fast 而非降级**——静默放行等于给 LLM 发空 `tool_result`，这正是引用化要杜绝的形态 | `hydrate-tool-results-for-prompt.ts:40-94`（**W11 已核对四码定义与类注释**） | **v2 新增**。与 I10 的「已知取舍」不同，这条是**硬约束** |

---

## ⑤ 已知债务热点地图

> 只标归属与量级，不展开细节。**定级以 `docs/Iterations/repo-mega-cr-2026-10/ledger-v2.md` 为准**，
> 本表只给归属与一句话标签。v2 终局：**P0 5 条 / P1 39 条 / P2 155 条 / P3 174 条**（合计 373）。
> 另有 §10 条单源 P0/P1 挂在台账的「待验证」节等主代理裁决，以及 RT-01 的定级争议。

### P0（5 条）

| ID | 位置 | 一句话 | 归属 | v1→v2 |
|---|---|---|---|---|
| **S-CS-01** | desktop `cloud-sync.service.ts:255-256` / mobile `:341` | pull 成功后的 rev 记账写进被 pull 自己关掉的连接，必抛 `CONNECTION_CLOSED`；rev 永不推进 | cloudsync | 沿用，位置未变 |
| **RT-02** | `agent-runner.ts:413` + `:519` | runner 每 step **两次**独立全会话读，两次读互不共享 | core-runtime | 沿用，**行号 `:405/:506` → `:413/:519`** |
| **N-P0-01** | `webview-dist/composer-input/app.js`（源 `prompt-macro-input.ts:1`） | bundle IIFE 顶层 `Object.fromEntries` ⇒ WebView < 73 白屏级无响应 | apps-mobile 构建链 | **v2 新增** |
| **N-P0-02** | `apps/desktop/scripts/run-tests.mjs:30` | 单引号 glob + `shell:true` ⇒ Windows 上 `npm test` 收集 0 条并输出假绿 | apps-desktop 测试基础设施 | **v2 新增** |
| **N-P0-03** | `apps/cli` 22 个 e2e 用例 | 26/102 永久红灯，根因是「全新库开不了第一个会话」+「迁移日志污染 stdout」 | apps-cli | **v2 新增** |
| ~~RT-01~~ | — | **定级争议中**，v2 同时剔出 P0 与 P1 计数，见 `ledger-v2.md` §8 | core-runtime | 争议未决 |

### P1 分布（按簇，只给标签）

| 簇 | P1 数 | 热点标签 |
|---|---|---|
| **core-storage** | 12（CS-01~CS-11 + N-P1-01） | 静默路径损坏（rename `REPLACE`）/ `replaceAll` 空串死循环 / LCS 爆堆 / scoped revision GC 恒删 0 行 / 大事务 / batch-io 绕过 revision 层 / blob 触发器误删共享 blob / 批量导出静默丢文件 / ZIP 无解压闸 / AST 缓存无上界 / session.copy 事务内全量物化 / **project 删除裸 `deleteVfsPrefix` 不减 ref_count ⇒ 永久泄漏 revision+blob** |
| **cloudsync** | 7（S-CS-02/03/04/07/08/09/16） | 单例持已关连接 / pull 无互斥与 agent 守卫 / 移动端 busy 令牌泄漏 / 整包读入 + 三处吞错 / S3 driver 读写放大 / final status 重读不重判租约 / 记账顺序 |
| **core-runtime** | 2（RT-04/RT-08） | `prompts.persist` 非单射折叠 / template-pull 不清 prompt 缓存（**四源印证**） |
| **core-misc** | 6（M-01/M-03/M-04 + N-P1-02/06/07） | 流中断当可重试（重复正文+重复计费）/ `1970-01-01` 假时间戳进提示词 / 删模型守卫漏扫会话 pin / **layout 白名单漏 `skillsEnabled`/`skillsPrefix` ⇒ 技能能力静默复活** / **smart-sort 多语句无事务 ⇒ 规则被抹掉不回滚** |
| **apps-mobile** | 3（AM-1/AM-3 + N-P1-03） | `forgetSession` 零调用（删除后消息尾永久驻留内存）/ `RealPrompt` 路由无参数 / **函数进 route params（可序列化性硬违规）** |
| **apps-desktop** | 6（S-D-02/S-D-04/B/E + N-P1-04/05） | 渲染层可传任意绝对路径触发 `rm -rf` / 设置导航未保存守卫漏网 / 快照漏 `mode` 字段 / 模型 pin 静默丢失 / **600ms 定时器闭包 ⇒ 压缩配置最后一次输入永远丢失** / **渲染层 424 条类型错误零门禁** |
| **core-data** | 1（CD-01） | 回滚 plan 与事务内状态不同源 → 静默丢文件 / 无主残留 |
| **dead-backlog** | 2（F-synth-dead-1/2） | L0 `testOnly` 桶定义缺陷（35.7% 误判）/ 快照锁定面 173 条直删会红测试 |

### 结构性热点（跨簇，不在 P0/P1 计数里）

- **「抽象建了、接线没做」**：synth/core-runtime.md L50 列了四族孤儿——`IntegrityRepairRegistry` 5 个 operation 只接 1 个、`AgentStreamRegistry` 四张表只写不读、`EphemeralOverlayAgentSession` 91 行零生产调用、`BuiltinToolContext.listSessionMessages` 三处装配零消费者。
  ⭐ **v1.5.29 让这族热点多了一个新成员**：`createRevisionRefCountRepairOperation` 已实现且期望值已三类化，
  但**至今没有生产注册点**（`novel-master-bootstrap.ts:420-423` 只注册了 sequence 那一支），
  而 `vfs-tools.ts:232-233` 的注释明写「+1 泄漏由 repair 检测兜底」（`ledger-v2.md` §4.3 双源印证）。
  正确处置仍是「把取舍上交」而非删——但这次的取舍**成本比其它四族高**，因为它兜的是**内容不可再生**的引用。
- **「单源注释比单源实现多」**：synth/core-misc.md L1098-1102 列了 7 处。模式统一：**抽出单源时没开 public 出口，调用方拿不到就复制**。
  ⭐ **v1.5.29 的正解与遗留**：`deriveSkillReadTruncation` / `deriveSkillLoadTruncation` 选了「开内部出口」（正确）；
  但同一波 `public/chat.ts` **漏了导 `SkillResultRef`**——`ToolResultBlock.contentRef` 的类型是
  `ReadResultRef | SkillResultRef`，**消费方拿到 `ToolResultBlock` 却拿不到 union 的另一半类型**，
  要判 `kind === "skill"` 就得自己声明形状（desktop 侧靠 `ipc-types.ts` 手工镜像 DTO 绕过，能编译但两侧形状靠人工同步）。
  ⇒ **建议补导**，这是本波唯一一条「出口缺口」。
- **协议层缺「错误分类表」**：synth/core-misc.md L1107 —— 五处缺陷都指向同一个缺口。
  ⭐ v1.5.29 后缺口更明显了：移动端原生 SSE 的 `callTimeout` 到点会命中 `isCanceled` 闸门 ⇒
  JS 侧收不到 Done 也收不到 Error ⇒ Promise **永不 settle**（`ledger-v2.md` §6 #11，字节码实测）。
- **`tool_use` 事件链**：今天零功能消费方，但契约已破（双 emit、abort 信息丢失、并行调用塌陷）。任何一端接上工具调用卡片渲染就会同时中三枪——**排在「实时工具卡片」排期之前修**。
- **运行时孤儿子系统**：`M-25` push/agent 互斥锁已实现但全仓无 agent 侧调用方且未从 index 导出。
  ⭐ **W9 独立 grep 确认「一个生产调用方都没有」，并补出了危害顺序**（续租 PUT 已发生才复检 agent）⇒ 级别可复议升 P1。
- **跨簇移交未闭合**：`M-26`（webview tsconfig 未设 `types:[]`）→ apps-mobile；`S-D-24`（含 1048 行孤儿表单）→ dead-backlog；`M-30` 附 Q3（DDL CHECK 是否覆盖存量库）→ core-storage。
  ⭐ **`M-26` 在 v1.5.29 后多了一条同族证据**：`web/tsconfig.json` 的 `lib: ES2018` 门禁已被
  `@types/node` → d3 → mermaid → type-fest 的 `/// <reference lib="esnext"/>` 击穿（W8 双源实测 `tsc --noEmit` 零报错通过）。
- **⭐ 「产物面无门禁」是 v1.5.29 之后新立的一族**：WebView bundle 的语法兼容（N-P0-01）与
  renderer 的类型正确性（N-P1-05，424 条）**都发生在源码面的检查覆盖不到的地方**。
  两者的共同形态是：**问题只在「构建产物的形态」或「未被 CI 引用的 tsconfig」里显形**，
  现有的 lint / tsconfig / typecheck 三道门都不覆盖它们。

### 上游裁决冲突（引用前必看）

- `M-14` 的「真环 5 个（core 3 + mobile 2）」是对 L0 `circular-alias.md` 汇总行「7 个」的**修正**；M-14 遵守只读纪律未代改 L0 文件，须主代理裁决是否采纳，并补记「JSDoc `{@link import(...)}` 会被误判为 import 语句」这条假阳性成因。
- `M-13` 的处置建议表依赖 W1 裁决 2（双端副本**同死**→应成对删除而非下沉 core）是否成立。
- **⭐ 「`searchMessages` 用不用 LIKE 粗筛」的台账决策已被本波推翻**（`delta` §4.3）：
  台账原文（`synth/core-data.md:93` + 争议栏）记的是「RULE 拍板不采用 LIKE 粗筛」，
  而 RULE 现行口径已改写为「**纯 ASCII keyword 走 parse 前 LIKE 粗筛命中才 parse**，keyword 含转义/非 ASCII 字符退回全量」。
  裁决归属是全局台账，**已登记为 `ledger-v2.md` 的拍板项 ★17**，未答之前
  本文件凡涉及搜索路径的描述一律采用**新口径**（`sqlite-message.repository.ts:602` 的谓词 + `:117` 的守卫 `LIKE_PREFILTER_UNSAFE_RE`）。
  ⚠️ 粗筛本身仍有漏召面待收敛：守卫只查 keyword 侧的 Unicode 折叠、不查 content 侧（`ledger-v2.md` §4.3 双源）。
- **⭐ 「约 900 行动态标签子系统零使用」被部分证伪**（`ledger-v2.md` §4.2）：
  `sql-template/` 目录共 1057 行，`SqlTemplateParser` 是 **31 个 repository 的默认 SQL 出口、249 处调用点**；
  真正零使用的只是**几类动态标签分支**，不是整个子系统。引用「900 行零使用」这句话前先看这条。

---

## 附：本文档的口径与已知盲区

- 本文件**不含 P2/P3 明细**，按任务约定只在热点地图标 P0/P1 归属。需要逐条看的是 `ledger-v2.md` 与各 synth 台账原文。
- **定级口径**：`docs/Iterations/repo-mega-cr-2026-10/ledger-v2.md` > `synth/revalidate-{a,b}.md` > `synth/delta-overview.md` > 各 synth 台账 > raw 报告。
  本文件 §⑤ 的所有 P0/P1 标签都从 v2 台账抄来，**不自行定级**。
- **v1.5.29 已作废的 v1 结论**（**不得再当依据**）：`messageContentPool` 相关的一切（池已整层删除）、
  `searchMessages` 的「不用 LIKE 粗筛」决策、`RT-01` 的「有意覆盖 hidden」注记。
  完整清单见 `ledger-v2.md` §9 附录 A。
- **未实跑的硬门槛**（开工义务，非已完成验证）：`tsc -p packages/core` / 三包 `npm test` 全绿
  —— W5 至 W11 均未执行。**v2 唯一实跑过的类型检查**是 `npx tsc --noEmit -p apps/desktop/tsconfig.renderer.json`
  = 424 条错误（已作为已知红基线记录）。`packages/core/dist` 存在但是旧的，rebuild 前 mobile 测试的失败信号**不可归因**。
- **本文件 v2 未覆盖的扫描面**（与 v1 §附 同，v1.5.29 未改变覆盖面）：
  4 个 Kotlin 原生文件（cli-periph 盲区，W8/W10 的 kt 机位只覆盖了 3 个，`sksp-windows`/`mac`/`linux` 三包未深审）；
  mobile 6 个 renderer 大文件只做符号级追踪；apps-desktop 6 个 handler 共 1211 行未逐行；
  S-CS-01 的 mobile 侧未在 op-sqlite 上实测；
  ⭐ **`webview-dist/**` 三个 bundle 只审了 `composer-input` 一个**（因为只有它命中 P0），
  另两个（`chat-transcript` 8.6MB / `rich-document` 8.0MB）的产物面**是否有同类顶层 ES2019+ 调用未查**。
- 各 synth 的盲区声明里，cloudsync 明写 S-CS-06/S-CS-19 为 suspected（未真机复现）、S-CS-26 的 Android 缓存清理行为存疑。
- 行号引用会随修复漂移；引用前请以 `git log -1` 为准重新核对（RULE:107「条数/行号/计数类结论一律实测复核」）。
  **v2 已把受 v1.5.29 影响条目的行号刷新到 `fe79b781`（逐行打印核对过 RT-01/RT-02、S-CS-08、CS-03、CS-11 等），
  但未受影响条目的行号仍以各 raw 报告的报告时点为准。**