---
date: 2026-09-23
---

# 消息正文压缩存储 技术规格（SPEC）

需求来源：`docs/Iterations/message-content-compression/prd.md`（2026-09-22 立项骨架，dependency: []）。

## 设计目标

`chat_message.content_json`（明文 JSON，用户实测库 73.1MB / 5309 条，占该表 94%）改为 zlib 压缩存储，三端（desktop/mobile/cli）消息读写语义零变化；存量数据**真搬运**（不清空重填、不丢一条）；迁移可跨启动重入、不无限期阻塞启动（升级首启有界同步预算 ≤60s，超预算转后台）；同规模库全库体积从约 105MB 收敛到 50MB 量级（含 VACUUM 归还）。

## 总体方案

三个支柱，全部复用仓库既有先例，**不突破 schema migration 单事务框架**：

### 1. 行内双列 + 双形态读（schema 层）

`chat_message` 加两列（对齐 `vfs_content_blob` 的 encoding 形态与 `zlib-codec` 的三形态自愈）：

- `content_encoding TEXT NULL`（值域 `'zlib' | 'zlib-b64'`，NULL = 未压缩的 legacy 明文行）
- `content_blob BLOB NULL`（`zlib` = 二进制 BLOB（写侧恒一形态）；`zlib-b64` = base64 文本存储类，**仅存量读兼容，写侧已不再产出**）

原 `content_json TEXT NOT NULL` 列保留不动：legacy 行继续放明文；新写入与迁移后的行置空串 `''`（NOT NULL 约束自然满足，content blocks JSON 恒非空串，`''` 无歧义）。读路径判定顺序：`content_blob` 非空 → 按 `content_encoding` 走 `decodeCompressedBytes` 解压；否则 parse `content_json` 明文。**明文行永远合法**——这是迁移可中断、可回滚、e2e fixture 直插明文仍可用的地基。

**写侧编码口径（集成分支 A2 定稿）**：三端恒落 `zlib` 二进制 BLOB，**无平台分支**（初版设计的「Node 落 zlib、RN 落 zlib-b64（+33% 膨胀、压缩比 2.5~3:1）」已随 op-sqlite 二进制 BLOB 真机验证通过而废弃，`forceZlibB64` 注入参数与 `isReactNativeRuntime` 判定一并删除）；`zlib-b64` 只剩读侧存量兼容（与 vfs blob 三形态自愈同口径）。压缩级别沿用 fflate 默认 level 6（全仓先例一致，perf 用例锁定阈值）；单测按非 RN 口径构造存量 `zlib-b64` 行验证读兼容。

### 2. codec 收口 repository 层（读写层）

`sqlite-message.repository.ts` 是 SQL 层唯一消费者（探索实证：三端零直接 SQL 读该列），codec 封在这里三端零感知：

- 写：`toMessageParams`（insert/batchInsert）编码压缩；`updateContent` 签名从 `contentJson: string` 改为 `content: MessageContent`（**把 `JSON.stringify` 从 `DefaultMessageService.updateContent` 下沉到 repository**，消除现存「service 层序列化」的不一致编码点；三端调用方本就传对象）。
- 读：`rowToMessage` 双形态判定后统一走既有 `parseMessageContent`。解压失败与今日的明文 parse 失败同语义：fail-fast 抛类型化错误（消息是用户数据本体，不做 file_cache 式静默 miss 自愈）。
- `searchMessages` 的 SQL `content_json LIKE` 粗筛被压缩破坏（唯一受影响的读路径）——改为**全量拉取 + 内存精筛**：service 层本就在 `messageMatchesKeyword` 做精确匹配，LIKE 只是超集预筛；改为 repository 全量 `listBySession` + 同一内存匹配，召回语义严格不小于现状（现状 LIKE 会漏非 text 块关键词场景，新实现只会更准）。`message-search.test.ts` 的召回断言零修改通过是显式验证点。

### 3. 后台谓词驱动压缩搬运（迁移层）——绕开跨 boot 框架缺口的拍板

不注册 schema migration 搬数据（框架无进度语义、两次历史评审拒绝突破、空占位禁令封死「先登记后搬」），改用**后台幂等压缩任务**（先例：`runDeferredFileCacheGc` 的「事务提交后调度」模式 + `vfs-content-blob-zlib-v1` 的谓词驱动分批骨架——该 migration 已退役（源文件已在 f104af1c 史前迁移清理中删除），分批骨架见 git 历史 63a35139）：

- 谓词：`content_json != ''`（未压缩行）。每批 ≤100 行：SELECT id/content_json（不碰 blob 列）→ JS 侧 fflate 压缩 → 单条短事务 UPDATE（置 blob + encoding + content_json=''）→ 批间 `setTimeout(0)` 让步（mobile 事务内另有 TDBC 16ms 量子让步兜底）。
- 幂等可重入：中断（杀进程/会话运行）随时停，重启后谓词重扫续跑，已压缩行天然排除。
- 完成判定（两态口径）：**进行中（剩余 N 条）**（谓词 COUNT；从未开始时 N=全部——库里只有完成标记一种持久化进度，数据上无法区分「从未跑过」与「跑过若干批」，故不设「未开始」态）/ **已完成**（谓词空 → 置 KKV 完成标记，两段式 `kkv.set('nm-message-content', 'compactionDone', ...)`——对齐仓库约定（module 为 nm- 短横线、key 为 camelCase，先例 `nm-search`/`nm-compaction-conditions`）→ **调用 `runStartupMaintenanceOnce`（进程级去重的收尾维护入口；GC → checkpoint → VACUUM 在其内部执行，同进程内已有任务触发过维护则跳过，不与 blob 归一任务叠加多次全库 VACUUM）**）。此后每次启动先查标记即走，零成本。
- **迁移完成的三层确认手段**：
  1. **app 内（终端用户主通道）**：双端存储页状态行两态显示「消息压缩：进行中（剩余 N 条）/ 已完成」（desktop 落点 `apps/desktop/renderer/features/settings/SettingsViews.tsx`「数据清理」区块；mobile 落点 StorageConfigScreen）；「已完成」态副文案注明「存储已优化完成」；进行中态副文案提示「完成前升级新版本，会在首次启动时等待优化收尾（一次性）」——给终端用户「是否现在更新应用」的行为指引。
  2. **DB 直查（开发者/高级用户通道）**：对运行库（adb run-as 拉取，先例：RULE「报错在 B 表时先查数据现场」）或备份导出文件（.nmbackup，整库拷贝天然含状态）执行：`SELECT COUNT(*) FROM chat_message WHERE content_json != '';`（**0 = 已完成**）+ KKV 完成标记复核 `SELECT COUNT(*) FROM kkv_entry WHERE module = 'nm-message-content' AND key = 'compactionDone';`（**1 = 已置**）。升级 V1 前想确认的用户走备份文件即可，无需打开 app。
  3. **V1 兜底（未确认就升级也安全）**：见「迁移生命周期」——V1 启动先查标记（已完成直接放行零感知），未完成才进强制收尾门并带进度文案。确认手段省的是「升级后首启等待」这一次性体验，不是安全前提。
- 调度：mobile 在 runtime 就绪后低优先调度（agent 活跃即暂停）；desktop main 进程就绪后同样预算制循环（better-sqlite3 无量子，靠批间 setTimeout 让步 main 事件循环）；CLI 命令进程内同步跑（预算制，幂等，跑完即快）。运行守卫为 **app 层组合守卫（按端取用）**：desktop 侧 `runtime/agent-activity.ts` / `services/db-maintenance-busy.ts` / `services/cloud-sync.service.ts`，mobile 侧 `runtime/agent-activity.ts` + StorageConfigScreen 的 `dbBusy`，与云同步/备份互斥；core 侧（infra/db-maintenance 内的压缩任务本体）不感知这些守卫，并发安全靠驱动连接级互斥（tdbc）。
- 状态可见（**按实现形态订正**）：独立状态采样出口 `getMessageCompactionStatus`（谓词 COUNT + 完成标记快照），desktop 侧经 `DbStatsResult` 增设的 `messageCompaction` 字段随 stats 聚合走 IPC 透传，mobile service 侧直接调用；双端存储页各加两态状态行（desktop 落点 SettingsViews.tsx「数据清理」区块、mobile 落点 StorageConfigScreen；口径见上「完成判定」与「三层确认手段」）。原设计的「在 stats 聚合里直接加 pending 计数」未被采用——状态采样与体积统计解耦，采样失败可独立降级、不拖垮既有指标。

### 4. 迁移生命周期：三段式确定性下线（C 端强制口径）

C 端无法控制用户的升级节奏，所以每个阶段的完成**都不依赖用户行为**，最终迁移代码全部移除，只留永久的压缩写/解压读 codec：

**阶段 V0（本迭代上线）——搬运期**：后台谓词任务（如前述）+ **升级首启同步收尾预算**：启动时谓词非空先同步搬运最多 60s（量子让步保响应；小库当场搬完直接进入完成态），超预算残余转后台继续。绝大多数用户（库小）V0 首启即完成。

**阶段 V1（约 10 个 tag 后，与 migration 清理同轮）——下线后台迁移**：
- 最低支持基线抬到 V0（复用 assertMinimumBaseline/BASELINE_MIGRATION_IDS 既有机制），低于 V0 的库按既有 fail-fast 语义拒绝——老库不再产生新明文入口。基线判据登记（远期细化即可）：V0 本身不注册 migration，「基线 = V0」无法只靠 BASELINE_MIGRATION_IDS 表达——须新增 legacy 形态探测（探 `chat_message` 缺 `content_encoding` 列即低于 V0，对齐 detectLegacyShape 既有做法），或依赖 V0~V1 之间其它迭代落下的 migration id 充当锚点；V1' 阶段「全压缩已保证」的判据 = KKV 完成标记已置或谓词为空；
- 启动入口改为**强制同步收尾门**：先查 KKV 完成标记，已置直接放行（绝大多数用户零感知）；未置才谓词收尾——谓词非空（仅剩「装过 V0 但未搬完就跳装 V1」的极少数库）则同步搬完才放行进 UI（无预算上限，极端重度库分钟级阻塞，一次性代价，带进度文案「正在完成存储优化（剩余 N 条）」）；
- 删除：后台任务调度、谓词后台循环、明文读路径（`rowToMessage` 只走解压）、双形态分支与相关测试（T-C3/T-C12 随之退役）。
- 该轮清理三件套登记进 CHANGELOG 与迭代文档，与史前 migration 清理同流程执行。

**阶段 V1'（再下一轮清理，基线抬过 V1）——下线收尾门**：≥V1 的库都被 V1 的强制门保证全压缩，基线抬到 V1 后，从 V0~V1 跳装 V1' 的入口也不存在了；删除启动同步收尾入口。**至此迁移代码归零**，仓库里只剩压缩编码/解码（与 vfs blob codec 同级的永久设施）。

每段移除点都有明确版本锚（跟随既有「10 tag 清理节奏 + 基线抬升」流程），不需要任何一段无限期保留。

### 与 PRD 的口径修正（待随 spec 一并确认）

- **AC-3 收窄落为流程**：PRD AC-3「既有全部消息读写相关测试零断言修改通过」收窄为：**经 service/repository API 的行为断言零修改通过；SQL 直读类测试基建（schema-align-columns / usage-cache-model-schema / legacy-db-fixtures / mobile e2e fixture）允许形态适配，附豁免清单**（探索实证：读侧单点收口使前者成立，后者字面口径必不成立）。豁免清单作为**验收附件**交付；若最终零豁免兑现（第 1 轮审查实核四个豁免文件大概率零修改可过），则按 PRD 原口径验收，不受本条收窄保护。
- **「不阻塞启动」口径**：PRD 核心需求 2 的「不阻塞启动」应理解为「**不无限期阻塞启动**」——V0 升级首启存在 ≤60s 的**有界同步收尾预算**（超预算残余转后台继续），属设计内的一次性代价，非与 PRD 冲突。
- **AC-1 按端拆分（按 A2 现状订正）**：PRD AC-1 的「压缩至 1/3 以下」原按端拆分（desktop/CLI ≥3:1、mobile 因 zlib-b64 +33% 膨胀折为 ≥2.5:1）；A2 写侧统一恒二进制后该折扣不再发生，**三端统一按 ≥3:1 口径验收**（存量 base64 行由 blob 归一任务原地转回二进制，见 binary-blob 迭代 spec）。

## 最终项目结构

```
packages/core/src/
  bootstrap/chat/chat-schema.ts                    # DDL + 两新列（canonical）
  bootstrap/schema-align/schema-column-alignments.ts  # 两列 align 条目
  bootstrap/novel-master-bootstrap.ts              # SCHEMA_BOOT_VERSION bump（集成分支定稿为 17——与 main 的 v16 撞号：main v16 = stream-metrics 两列、本迭代 v16 = chat_message 压缩两列，按撞号纪律顺延，v16 保留主干含义、压缩两列重编号 v17；若用 16，真实 1.5.24 存量库走快路径、压缩列永远补不上）
  domain/chat/repositories/impl/sqlite-message.repository.ts  # codec 收口 + searchMessages 重写
  domain/chat/repositories/message.port.ts         # updateContent 签名
  service/chat/impl/message.service.ts             # 去掉 service 层 stringify；searchMessages 两段式注释更新
  domain/chat/logic/message-content-codec.ts       # chat 侧薄封装（复用 vfs zlib-codec，不另起实现；写侧恒二进制 zlib，平台分支与 forceZlibB64 注入已在 A2 删除）
  infra/db-maintenance/                            # 压缩任务 + 独立状态采样 getMessageCompactionStatus + 完成后挂 runStartupMaintenanceOnce（进程级去重）；chat_message 的 blob 归一适配器由 binary-blob 迭代在同域接入（跨迭代耦合，见其 spec）
  (导出) 不新增 exports 子路径：`./compaction` 子路径名已归属历史上下文裁剪域，压缩任务并入主入口 index.ts 的 infra/db-maintenance 导出区是既定出口设计（packages/core/package.json exports + apps/desktop/src/main/ipc/handlers/compaction.ts 消费）；message-content-codec 为 core 内部设施（写侧无平台分支、无注入参数），不对外导出
apps/mobile/  db 就绪后调度 + StorageConfigScreen 状态行 + e2e fixture 验证（明文直插仍可用）
apps/desktop/ main 就绪后调度 + renderer/features/settings/SettingsViews.tsx（「数据清理」区块）状态行
apps/cli/      runtime 内联预算制执行
```

## 变更点清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `bootstrap/chat/chat-schema.ts` | DDL 增两列，精确文本：`content_encoding TEXT NULL CHECK (content_encoding IN ('zlib', 'zlib-b64'))`（CHECK 沿用 vfs 先例 `vfs-content-blob-schema.ts` 的写法；SQLite CHECK 对 NULL 放行，legacy 明文行合法、须容 NULL）、`content_blob BLOB NULL` |
| 2 | `bootstrap/schema-align/schema-column-alignments.ts` | 两列 ADD COLUMN 条目 |
| 3 | `bootstrap/novel-master-bootstrap.ts` | SCHEMA_BOOT_VERSION bump + 注释（集成分支定稿 **17**：与 main 的 v16 撞号按纪律顺延，v16 保留主干 stream-metrics 含义、压缩两列重编号 v17——RULE v9/v10 事故的同款纪律是 bump 本身，不是具体号） |
| 4 | `domain/chat/logic/message-content-codec.ts`（新） | encode/decode 薄封装（**写侧恒二进制 zlib，无平台分支、无 `forceZlibB64` 注入点**——A2 已删；读侧三形态兼容，对齐 file-cache-blob-codec 先例） |
| 5 | `sqlite-message.repository.ts` | `toMessageParams`/`rowToMessage`/`updateContent`/INSERT SQL/SELECT 列清单；`searchMessages` 去 LIKE 改全量内存筛 |
| 6 | `message.port.ts` | `updateContent(id, content: MessageContent)` |
| 7 | `message.service.ts` | 删 service 层 `JSON.stringify`；搜索两段式注释与逻辑对齐 |
| 8 | `infra/db-maintenance/` | `runMessageContentCompaction`（批预算/守卫/谓词/完成标记）+ 独立状态采样出口 `getMessageCompactionStatus`（desktop 侧 `DbStatsResult` 增 `messageCompaction` 字段透传）+ 完成后挂 `runStartupMaintenanceOnce`（进程级去重） |
| 9 | `apps/mobile` | 调度接线 + StorageConfigScreen 状态行 |
| 10 | `apps/desktop` | main 调度接线 + `renderer/features/settings/SettingsViews.tsx`「数据清理」区块状态行 |
| 11 | `apps/cli` | runtime 内联执行 |
| 12 | 测试 | 新增见测试策略；按需形态适配（预计零修改；确需改动才动并登记豁免清单）：schema-align-columns / usage-cache-model-schema / legacy-db-fixtures / mobile e2e fixture |
| 13 | `docs` | CHANGELOG Unreleased；RULE.md 若有新纪律（压缩列约定） |

## 详细实现步骤

- Step 1 — phase-schema-foundation — blocking: yes — qa: auto：DDL 两列 + align 条目 + SCHEMA_BOOT_VERSION bump（集成分支定稿 17，撞号顺延裁决见变更点 #3）；schema-align/legacy fixture 按需形态适配（预计零修改；确需改动才动并登记豁免清单，含 `schema-align-columns.test.ts` 等）。
- Step 2 — phase-codec-repository — blocking: yes — qa: auto：message-content-codec 薄封装（写侧恒二进制，无注入分支）；repository 写读双形态（读侧含存量 `zlib-b64` 兼容）；updateContent 签名下沉 stringify；T-C1~T-C5、T-C12 用例。
- Step 3 — phase-search-rewrite — blocking: yes — qa: auto：searchMessages 去 LIKE 改全量内存筛；`message-search.test.ts` 全量回归（含转义/元字符/分页）；T-C6。
- Step 4 — phase-compaction-job — blocking: yes — qa: auto：`runMessageContentCompaction`（谓词/批预算/守卫/完成标记/挂 VACUUM；升级首启同步收尾预算 60s，超预算残余转后台）+ stats pending；T-C7~T-C9；三端调度接线（mobile/desktop/cli）。
- Step 5 — phase-regression — blocking: yes — qa: auto：core 全量 + desktop + mobile（先重建 core dist，mobile jest 消费 dist 是硬依赖）+ 全仓 typecheck；perf 阈值用例 T-C10/T-C11。
- Step 6 — phase-docs — blocking: no — qa: auto：CHANGELOG Unreleased（变更段：消息正文压缩存储；存储页状态行）；RULE.md 压缩列约定条目（若评审通过）。
- Step 7 — phase-manual-verify — blocking: no — qa: manual_user：真机/实库验收——用户 523MB 实库（或 .nmbackup 副本）升级后观察：启动不无限期阻塞（重度库首启同步收尾在 60s 预算内，超预算转后台）、压缩进行中状态行（两态与副文案）、完成后体积对比（desktop/CLI ≥3:1、mobile ≥2.5:1）、**外部确认 SQL：`SELECT COUNT(*) FROM chat_message WHERE content_json != ''` 归零 + KKV 标记已置（module `nm-message-content` / key `compactionDone`）**、抽查会话内容逐条一致、搜索/回滚/复制会话正常、二次启动无重扫。

## 测试策略

新增（core node:test，对齐 file-cache-store.test.ts 的混存自愈先例）：

- T-C1 — blocking: yes — 压缩往返：append → SQL 层读出为压缩形态（zlib 二进制）→ API 读回与原文逐字节等价（映射 Step 2）
- T-C2 — blocking: yes — 存量 `zlib-b64` 文本行读回等价：直插 SQL 构造 base64 文本存量行，断言 `encoding='zlib-b64'`、blob 为 base64 文本、读回等价（写侧已无平台分支与注入参数，**单测按非 RN 口径构造存量行**，映射 Step 2）
- T-C3 — blocking: yes — 混存自愈：同表 legacy 明文行（手工 INSERT 明文，模拟 e2e fixture）与压缩行并存，list/get 均正确还原（映射 Step 2）
- T-C4 — blocking: yes — 坏数据 fail-fast：损坏 blob 解压失败抛类型化错误（含消息 id），不静默丢行（映射 Step 2）
- T-C5 — blocking: yes — 编辑路径：updateContent 写压缩、读回等价；port 新签名三端编译通过（映射 Step 2）
- T-C6 — blocking: yes — 搜索语义：`message-search.test.ts` 既有断言零修改全绿（关键词/转义/分页/T-CS9 LIKE 元字符）（映射 Step 3）
- T-C7 — blocking: yes — 压缩任务幂等：跑两遍第二遍 no-op（谓词空）（映射 Step 4）
- T-C8 — blocking: yes — 可重入：批间中断（模拟杀进程）后重启续跑收敛（映射 Step 4）
- T-C9 — blocking: yes — 零丢失：混合内容（长中文/附件/tool 块）压缩搬运前后全量逐字节比对（映射 Step 4）
- T-C10 — blocking: yes — schema：legacy 库 align 后两列就位、BOOT_VERSION 快路径/慢路径各自生效（断言引用 SCHEMA_BOOT_VERSION 常量）（映射 Step 1/5）
- T-C11 — blocking: no — perf 阈值：40 条 × 20KB tail 加载（含解压）与压缩搬运单批耗时不劣化到可感知（阈值 SPEC 后续评审可调；对齐 40 条页界实测场景）（映射 Step 5）
- T-C12 — blocking: yes — mobile e2e fixture 明文直插行在压缩版本下仍可读（双形态保证）（映射 Step 2/5）

## 风险与回滚方案

- **mobile 压缩比折扣（已随 A2 消解）**：初版设计 mobile 走 zlib-b64（+33% 膨胀，压缩比预期 2.5~3:1）；op-sqlite 二进制 BLOB 通道经真机六项探针验证通过后，A2 已把写侧统一为恒二进制 zlib——该折扣不再发生，三端压缩比同口径；存量 base64 文本行由 blob 归一任务原地转回（读侧三形态兼容兜底，见 binary-blob 迭代 spec）。
- **搜索性能**：全量内存筛在大会话（几千条）搜索时多付解压成本；现状 listBySession 全量路径（回滚 plan/token 估算）本就全量 parse，量级同级；真机验收覆盖搜索项。
- **降级/跨版本云同步**：旧版本 app 读压缩形态会 fail-fast（与今日坏 JSON 同语义）；降级安装本就不在支持范围，云同步跨版本 Pull 压缩库同样受限——登记为已知限制，不在本期解决。
- **回滚方案**：读路径永远容忍明文（双形态），发布后发现 codec 缺陷可整体回滚写路径（回到只写明文），已压缩行仍可读；schema 两列遗留无消费方，无需回滚 DDL（用户_version 只升不降，对齐既有纪律）。最坏情况（解压 bug）影响面 = 压缩任务已搬运的行，可用同款压缩任务反向解回明文（谓词反转），作为应急预案写入实现注释。

## Context Bundle

```yaml
iteration_name: message-content-compression
requirement_path: docs/Iterations/message-content-compression/prd.md
spec_path: docs/Iterations/message-content-compression/spec.md
explore_summary: >
  读写 SQL 层单点收口于 sqlite-message.repository（三端零直接 SQL）；唯一受影响读路径是
  searchMessages 的 LIKE 粗筛；codec 先例（zlib-codec 三形态自愈/zlib-b64 RN 分支/双列形态）
  全部现成；跨 boot 迁移框架确认完全缺失且被 vfs-version-redesign、storage-cache-dedup 两度
  绕开/拒绝——本 spec 以「后台谓词驱动压缩任务」绕开框架缺口（先例：runDeferredFileCacheGc
  事务后调度 + vfs-content-blob-zlib-v1 谓词分批骨架），schema 变更走 DDL+align+SCHEMA_BOOT_VERSION
  递增（+1，以主干现值为准，并行迭代撞号则顺延）常规通道，不注册数据迁移。
impact_files:
  - packages/core/src/bootstrap/chat/chat-schema.ts
  - packages/core/src/bootstrap/schema-align/schema-column-alignments.ts
  - packages/core/src/bootstrap/novel-master-bootstrap.ts
  - packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts
  - packages/core/src/domain/chat/repositories/message.port.ts
  - packages/core/src/service/chat/impl/message.service.ts
  - packages/core/src/domain/chat/logic/message-content-codec.ts (新)
  - packages/core/src/infra/db-maintenance/
  - apps/mobile/src/db/ + StorageConfigScreen
  - apps/desktop/src/main/ + renderer/features/settings/SettingsViews.tsx（数据清理区块）
  - apps/cli/src/runtime.ts
constraints:
  - SCHEMA_BOOT_VERSION 必须 bump（v9/v10 漏 bump 真机事故先例；纪律是 bump 本身而非具体号——与并行迭代（如 mobile-perf-2026-09/stream-metrics-tokens）同轮撞号时，实施以主干现值为准递增顺延）
  - 空占位 migration 禁令（登记即已执行）
  - 不新增 core exports 子路径：./compaction 已被上下文裁剪域占用，压缩任务并入主入口 infra/db-maintenance 导出区（若未来确需新增子路径，须同步 tsconfig.test.json paths——src/dist 双载假象事故红线）
  - mobile 若新增 core 子路径消费，须同步 apps/mobile/jest.config.js moduleNameMapper（本次拍板不新增，此条为未来防线）
  - mobile jest 消费 core dist，回归前必须重建
  - VACUUM 事务外直调、维护链路收敛 infra/db-maintenance
  - 消息为用户数据本体：解压失败 fail-fast 不自愈、迁移不可清空重填
blocking_steps: [1, 2, 3, 4, 5]
```
