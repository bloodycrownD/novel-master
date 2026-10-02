---
zone: core-small
agent: domain-survey
files_scanned: 32
---

# W2 · core-small 按域测绘报告

区域：`packages/core/src/domain/` 下 7 个小域——`depth`(3)、`events`(1)、`feature-flags`(1)、
`kkv`(4)、`session-kkv`(7)、`smart-sort-rule`(9)、`compaction-conditions`(7)，合计 32 文件。
基线：`feat/repo-mega-cr` worktree `D:\Dev\nm-worktree\mcr`（2026-09-30 只读测绘）。

## 摘要

七个互不相关的小域，充当「大服务层与存储层之间的纯逻辑/契约层」：**depth** 定义 tail-based
depth 编号与压缩隐藏区间锚定（唯一带业务口径重的一域）；**events** 只有一组事件名常量与
payload 类型（无实现）；**feature-flags** 只有一个 user-VFS 统一 tool turn 开关（含模块级
可变快照）；**kkv / session-kkv** 是两套 KKV 的端口 + SQLite 实现（session 侧 file_cache
域已做 blob 去重化分流）；**smart-sort-rule** 是智能排序规则的 zod 契约、正则编译与
YAML 交换文档；**compaction-conditions** 是压缩条件的模型、schema 与三个触发器。
整体代码质量高、注释密度罕见地高、口径大多有 RULE 背书；问题集中在**死代码/死导出**、
**孤儿 blob 回收缺口**、**与 RULE 的口径漂移**三处。

## 职责与边界

- **depth**（`domain/depth/logic/`，3 文件）：只做「可见消息 → tail depth」的编号与区间匹配，
  以及 hide-message 的 seq 隐藏区间锚定。**不碰 DB、不碰 KKV**。数据源由调用方
  （`service/compaction-conditions/hide-message.action.ts`）以头投影喂进来。
  锚定口径为 chat-fixes-2026-08 拍板版（RULE「压缩」条目权威）。
- **events**（1 文件）：进程内事件总线的**事件名与 payload 类型单源**。无 emit、无订阅。
- **feature-flags**（1 文件）：一个产品开关的读取优先级链（显式 configured → env → preference
  快照 → 默认值），含模块级可变状态与测试复位口。
- **kkv**（4 文件）：`kkv_entry`（module 作用域）的行模型 + 两个端口
  （`KkvRepository` 完整读写契约 / `KkvReaderPort` 最小子集）+ SQLite 实现。
- **session-kkv**（7 文件）：`session_kkv_entry`（sessionId × domain × key）的行模型 / 端口 /
  SQLite 实现，外加 `file_cache` 域的 blob 编解码与孤儿 blob 延期 GC。RULE「KKV（session KKV）」
  条目所指的域定义文件即 `model/session-kkv-domains.ts`。
- **smart-sort-rule**（7 文件 + 2 model）：单表扁平规则的实体、zod 写载荷、正则编译与草稿校验、
  编辑器预览用的匹配/高亮切分、以及 CLI/desktop/mobile 共享的 YAML 交换文档（含 v1→v2 迁移）。
- **compaction-conditions**（7 文件）：压缩条件的 v4 线文档模型 + zod schema、触发器端口与三个
  触发器实现（token-ratio / visible-floor / OR 组合）、以及一个 heuristic token 估算 helper。

## 对外接口

| 域 | 导出（`public/*` 子路径） | 关键符号 |
|---|---|---|
| depth | `core/compaction` | `DepthSlice`、`matchDepth`、`validateDepthSlice`、`messageIdsInSlice`、`depthByMessageId`、`listVisibleForDepth`、`resolveHideMessageRange`、`HideMessageSeqRange` |
| compaction-conditions | `core/compaction` | `CompactionConditions`、`DEFAULT_HIDE_START_DEPTH=6`、`compactionConditionsSchema` |
| session-kkv | `core/session-kkv` | `SESSION_KKV_DOMAIN_{FILE_CACHE,RULE_SNAPSHOT,PROMPT_TOKENS,STREAM_METRICS,USER_VFS_PENDING}`、`SESSION_KKV_COMPOSER_STATUS_DOMAINS`、`RULE_SNAPSHOT_CANON_KEY`、`USER_VFS_PENDING_QUEUE_KEY`、`STREAM_METRICS_FINAL_RATE_KEY`、`PROMPT_TOKENS_LAST_USAGE_KEY`、`fileCacheKey`、`WorkplaceDisplayStatus` |
| feature-flags | `core/feature-flags` | `DEFAULT_USER_VFS_UNIFIED_TOOL_TURN`、`isUserVfsUnifiedToolTurnEnabled`、`refreshUserVfsUnifiedToolTurnSnapshot` |
| events | `core/events` | 9 个 `EVENT_*` 常量 + 对应 payload interface（`public/events.ts`） |
| smart-sort-rule | `core/smart-sort-rule` | `validateSmartSortRuleDraft`、`parsePatternInput`、`formatPatternInput`、`matchSmartSortPattern`、`splitSmartSortHighlightSegments`、bundle 编解码 |
| kkv | （无 barrel） | `KkvRepository`/`KkvReaderPort`/`SqliteKkvRepository` 仅 core 内消费 |

未进 public barrel 但存在域内的导出：`depthSliceFromWire`、`depthFromTailIndex`、
`estimateTokens`、`KkvEntry`、`SessionKkvEntry`。

## 数据访问

| 表 / 域 | 触碰点（file:line） | 口径 |
|---|---|---|
| `kkv_entry` | `domain/kkv/repositories/impl/sqlite-kkv.repository.ts:37,47,61,71` | module 作用域 upsert / delete；**仅 `blob-binary-normalization.ts`、`message-content-compaction.ts` 两个后台维护任务 + `service/kkv` 工厂消费** |
| `session_kkv_entry` | `domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts:215,309,338,347,359,391,473,493` | 非 file_cache 域（`rule_snapshot`/`backfill_cursor`/`stream_metrics`/`prompt_tokens`/`token_chunks`/`usage_stats`）与 file_cache 退化路径 |
| `session_file_cache_entry` | 同上 `:109,302,332,365,378,417` | file_cache 域引用行，PK `(session_id, key)` |
| `session_file_cache_blob` | 同上 `:152,251,260,441` + `logic/deferred-file-cache-gc.ts:36` | `content_hash` sha256 主键、`WITHOUT ROWID`、`CHECK encoding IN ('zlib','zlib-b64')`（DDL 见 `bootstrap/session-kkv/file-cache-schema.ts:19`） |
| `smart_sort_rule` | `domain/smart-sort-rule/repositories/impl/sqlite-smart-sort-rule.repository.ts:53,66,79,105,133,140,151` | 扁平单表，`ORDER BY sort_order, rule_id` |

`file_cache` 域的**透明分流**（`sqlite-session-kkv.repository.ts:74,97,232,296,326,371`）是本区
最复杂的一段：新表命中走 entry→blob 两跳，新表未命中退化查 `session_kkv_entry` 旧行；
`listKeys` 用 `UNION` 合并两表键集（`:378-385`）。

## 依赖关系

**import 了谁**
- depth → `domain/chat/logic/message-visible-floor`、`domain/chat/logic/message-content-helpers`、`domain/chat/model/message`（均在 `depth/` 之外）
- session-kkv → `infra/tdbc/{ports,logic}`、`infra/sql-template`、`infra/content-cache/logic/decoded-content-cache`、`domain/vfs/content-store/logic/{hash-content,zlib-codec}`、`domain/workplace/logic/rule-snapshot-codec`
- smart-sort-rule → `zod`、`infra/serialization/decode`、`domain/workplace/logic/smart-sort`（`FIXED_MIN/MAX_SORT_TUPLE`、`formatSortTupleForDisplay`、`parseChineseNum`）、`errors/smart-sort-rule-errors`
- compaction-conditions → `domain/agent/session/agent-session.port`、`domain/prompt/model/*`、`infra/llm-protocol/ports/adapter.port`、`infra/tokenizer/**`、**`service/session-kkv/session-kkv.port`（domain 反向依赖 service 层，边界倒置）**
- kkv → 仅 `infra/tdbc` + `infra/sql-template`

**被谁消费**
- depth 三个 logic → `service/compaction-conditions/hide-message.action.ts:19-21`、`config-forms/shared/depth-slice.ts`、`public/compaction.ts`
- events 9 常量 → `service/agent/impl/agent-runner.ts:71-78`、`service/agent/logic/run-agent-turn.ts:47-49`、`public/events.ts`。**apps 侧零硬编码字符串**（实测 `apps/{desktop,mobile}/src` 搜 `agent.run.started` 无命中），全部走常量。
- session-kkv repository → `service/session-kkv/create-session-kkv-service.ts:20`、`service/chat/impl/message.service.ts:249,451,483`、`service/message-checkpoint/impl/message-checkpoint.service.ts:90`、`service/message-checkpoint/truncate-tail-wiring.ts:29`
- kkv repository → `service/kkv/create-kkv-service.ts:18`、`infra/db-maintenance/impl/{blob-binary-normalization,message-content-compaction}.ts`
- feature-flags → 仅 mobile：`apps/mobile/src/components/vfs/VfsFileManager.tsx:46`、`apps/mobile/src/screens/stack/FileEditorScreen.tsx:22`、`apps/mobile/src/runtime/create-mobile-runtime.ts:27`

## 发现清单

### depth 域

---
**F-core-small-1 | P3 | `packages/core/src/domain/depth/logic/depth-slice.ts:70`**

```ts
export function depthSliceFromWire(raw: Record<string, unknown>): DepthSlice {
```

`depthSliceFromWire` 全仓零消费方（实测 `grep -rln "depthSliceFromWire"` 仅命中定义处；
`apps/{desktop,mobile}/src` 与 `packages/core/test` 均无引用），且**未进 `public/compaction.ts`
barrel**——即外部包也够不着。同一文件里被真正使用的 `matchDepth`/`validateDepthSlice`/
`messageIdsInSlice` 都进了 barrel。
**建议**：确认 CLI/GUI 是否曾计划走 kebab-case wire（`start-depth`）；若确定不用，删函数；
若要留，补一条 `@deprecated` 或至少补测试锁住行为。
**置信**：confirmed

---
**F-core-small-2 | P3 | `packages/core/src/domain/depth/logic/resolve-hide-message-range.ts:55`**

```ts
export function resolveHideMessageRange(
  visible: readonly ChatMessage[],
  _slice: DepthSlice,
```

`_slice` 形参从未被读。函数实质只吃「slice 内已选出的 messageIds」+ 全量 visible。
调用方 `hide-message.action.ts:73` 仍老老实实传 slice，读代码的人会误以为锚定逻辑会
二次使用 slice 边界。
**建议**：删形参并改调用点（3 处调用签名），或补一行注释说明「slice 边界已在
`messageIdsInSlice` 阶段折进 messageIds，故此处不再需要」。
**置信**：confirmed

---
**F-core-small-3 | P3 | `packages/core/src/domain/depth/logic/depth-from-tail.ts:19`**

```ts
export function depthByMessageId(
```

`depthByMessageId` 与 `listVisibleForDepth` 虽经 `public/compaction.ts:7-10` 导出，但实测
`packages/core/src` 内零消费、`apps/{desktop,mobile}/src` 内零消费。只有 `listVisibleForDepth`
被 `hide-message.action.ts:20` 用到（即经域内深路径 import，而非 barrel）。
**建议**：depth 域公开面 4 个符号里 3 个无消费方，建议收敛 barrel 导出面。
**置信**：confirmed

### events 域

---
**F-core-small-4 | P3 | `packages/core/src/domain/events/model/event-types.ts:7`**

```ts
/** User-configurable and lifecycle event type strings. */
```

注释里的 "User-configurable" 已过时——用户可配置事件（事件编排器）已整体移除，
`service/compaction-conditions/hide-message.action.ts:6-7` 明写「事件编排器移除后，本动作的
唯一活消费方是 runCompaction」。现存 9 个事件全是生命周期/流式内部事件。
**建议**：改为「进程内生命周期与流式事件名（事件编排器已于 v1.5.x 移除，用户可配置事件不再走事件总线）」。
**置信**：confirmed

### feature-flags 域

---
**F-core-small-5 | P3 | `packages/core/src/domain/feature-flags/user-vfs-unified-tool-turn.ts:5,32`**

```ts
 * 环境变量 NM_USER_VFS_UNIFIED_TOOL_TURN=0 仅作运维紧急关闭（同步生效）。
...
  if (process.env.NM_USER_VFS_UNIFIED_TOOL_TURN === "0") return false;
```

该 env 逃生阀在**唯一真实消费端上永不生效**：`isUserVfsUnifiedToolTurnEnabled` 全仓三处
消费方全在 mobile（VfsFileManager / FileEditorScreen / create-mobile-runtime），而 React Native
的 `process` shim 只内联 `NODE_ENV`，其余 `process.env.X` 恒为 `undefined`；desktop 完全不用
这个开关。文档承诺的「运维紧急关闭」能力实际不存在。
**建议**：要么把注释改成明说「env 逃生阀仅 desktop/CLI 有效，mobile 端只有 preferences 一条路」，
要么补 mobile 侧的真实关闭通道（PersistentPreferences 已有，需确认设置界面有入口）。
**置信**：confirmed（消费方分布实测 + RN `process.env` 语义）

### kkv 域

无发现。`SqliteKkvRepository` 四方法均为参数化模板 + `ON CONFLICT DO UPDATE`，无拼接；
`KkvRepository` 与 `KkvReaderPort` 的双端口分层（前者给 `service/kkv` 全量契约，后者给
`domain/provider/repositories/impl/kkv-model-suggestion.repository.ts:37` 的最小子集）是有意
的依赖倒置让步，不是重复实现。`KkvEntry` 三字段 `readonly` 且全 `String()` 归一，无隐患。

### session-kkv 域

---
**F-core-small-6 | P2 | `packages/core/src/domain/session-kkv/logic/deferred-file-cache-gc.ts:29`**

```ts
export async function runDeferredFileCacheGc(
  conn: TdbcConnection
): Promise<number> {
```

`session_file_cache_blob` 的孤儿回收只有 3 个挂点（实测 `grep -rln runDeferredFileCacheGc`）：
`service/chat/impl/session.service.ts:197`（删会话）、`project.service.ts:196`（删项目）、
`infra/db-maintenance/impl/db-maintenance.service.ts:66`（手动「数据清理」）。

**而 `clearDomain(sessionId, "file_cache")` 的 4 个调用方全都不调度 GC**：
- `service/chat/impl/message-transcript-effects.service.ts:176`（置位 set floor）
- `service/compaction-conditions/run-compaction.ts`（压缩——注：2026-09-29 起压缩已不清 file_cache）
- `service/vfs/logic/clear-session-prompt-caches.ts:35`（导入缓存对齐）
- `service/workplace/refresh-rule-snapshot.ts:41`（用户改目录规则）

这些是高频路径（每次置位/每次导入/每次改规则），每次都把整会话的 entry 引用行删光而不回收
blob。结果：一个从不删除会话的长期用户，blob 表随「文件内容被改写的次数」单调增长，
直到某次删会话或手动清理才一次性回收。feature A 去重化省下的空间会以孤儿形式陆续还回去。
**建议**：在 `clearDomain` 的 file_cache 分支（`sqlite-session-kkv.repository.ts:326-342`）
之后由调用方调度 GC，或在 `runDeferredFileCacheGc` 上加「距上次 GC ≥ N 秒 / 删除行数 ≥ M」
的节流钩子，避免每次置位都全表扫。
**置信**：confirmed

---
**F-core-small-7 | P3 | `packages/core/src/domain/session-kkv/model/session-kkv-domains.ts:123`**

```ts
export type SessionKkvDomain =
  | typeof SESSION_KKV_DOMAIN_RULE_SNAPSHOT
  ...
  | typeof SESSION_KKV_DOMAIN_TOKEN_CHUNKS
  | (string & {});
```

这个「域定义单源」的联合类型漏列了同文件第 87 行已定义、且被 3 个服务实际使用的
`SESSION_KKV_DOMAIN_USAGE_STATS = "usage_stats"`（`message.service.ts:115`、
`usage-stats.service.ts:474,550,556`、`message-rollback.service.ts:279`、
`clear-session-prompt-caches.ts:44`）。因为末尾的 `(string & {})` 开放分支，**不会报类型错**，
属静默失真：读者会以为该联合是完整枚举。
**建议**：补上 `typeof SESSION_KKV_DOMAIN_USAGE_STATS`（以及若将来拆出更多域一并补齐）；
或把注释改成「已知域前缀枚举（开放）」以免误读为完备集。
**置信**：confirmed

---
**F-core-small-8 | P3 | `packages/core/src/domain/session-kkv/model/session-kkv-domains.ts:104`**

```ts
 * - `user_vfs_pending` → user_ops chip
```

`SESSION_KKV_COMPOSER_STATUS_DOMAINS` 仍含 `user_vfs_pending`，并被
`domain/message-checkpoint/logic/truncate-tail-in-transaction.ts:94` 在回滚截断时逐域清。
但该域**已无任何写入方**（RULE「KKV（session KKV）」条目明写「user ops 拆除后已无写入方，
仅剩 truncate 清旧域路径与域常量」；实测 `grep -rln USER_VFS_PENDING_QUEUE_KEY` 只命中定义处
与两个 barrel）。注释里的「user_ops chip」在 chat-fixes-2026-08 已随 user ops 整体拆除。
**建议**：**保留清理语句**（旧库确有该域行，属正确的历史数据清理），
但把注释改成「user_vfs_pending：user ops 已拆除，此处仅作旧域残留清理，不再有新写入」，
避免后人误以为还有 chip 功能依赖它。
**置信**：intentional（保留清理是有意的，标注出处：RULE「KKV（session KKV）」条目；
过时注释本身是真问题）

---
**F-core-small-9 | P3 | `packages/core/src/public/session-kkv.ts:17,22`**

```ts
  SESSION_KKV_DOMAIN_USER_VFS_PENDING,
  ...
  USER_VFS_PENDING_QUEUE_KEY,
```

公开子路径 `@novel-master/core/session-kkv` 仍在导出一个零写入方域的常量与其单键
`USER_VFS_PENDING_QUEUE_KEY = "queue"`（实测全仓零消费方）。对外暴露死键等于邀请
新调用方往一个不会再被读写的域里写数据。
**建议**：从 public barrel 摘掉该 key 常量（域常量可留，因 truncate 清理链要用）。
**置信**：confirmed

### smart-sort-rule 域

---
**F-core-small-10 | P3 | `packages/core/src/domain/smart-sort-rule/logic/match-smart-sort-pattern.ts:99`**

```ts
  const globalFlags = base.flags.includes("g") ? base.flags : `${base.flags}g`;
  const matcher = new RegExp(base.source, globalFlags);
  for (const m of text.matchAll(matcher)) {
```

两个编辑期风险：(a) `matchAll` 会对用户输入的**任意长度文本**跑用户输入的**任意正则**，
两者都无长度/复杂度上限（`parsePatternInput` 不限长，zod `pattern: z.string().min(1)` 也不限上界），
catastrophic backtracking 形态的 pattern（`(a+)+$` 类）会直接卡死 UI 线程——目前靠
「用户自己点测试按钮」兜底，用户也可粘贴整本小说做测试文本。
(b) flags 允许 `y`（sticky，schema `:28` 允许 `gimsuy`）；`gy` 组合下 `matchAll` 只在
`lastIndex` 精确位置匹配，用户输入 `/1/y` 测「第1章」只在文本偏移 0 命中，
编辑器里看起来像「正则不生效」。
**建议**：(a) 给 `matchSmartSortPattern` 加测试文本长度上限（如 100KB）与 pattern 长度上限，
超出返回 `{ok:false, error:'输入过长'}`；(b) 在 `validateSmartSortRuleDraft` 里对
含 `y` 的 flags 给出明确提示，或在预览路径上剔除 `y`。
**置信**：suspected（(a) 是可构造的 ReDoS 面但需用户主动触发；(b) 语义差异已复核成立）

---
**F-core-small-11 | P3 | `packages/core/src/domain/smart-sort-rule/logic/parse-pattern-input.ts:79`**

```ts
    for (let j = i - 1; j >= 1 && input[j] === "\\"; j--) {
      backslashes++;
    }
```

反斜杠计数下界写 `j >= 1` 而非 `j >= 0`。当前**恰好正确**——`parsePatternInput` 只在
`input.startsWith("/")` 时进入本分支，index 0 恒为开定界符 `/`，不可能是反斜杠，
所以计数不会漏。但这个正确性依赖一个 40 行之外的前置条件，且与同文件
`containsUnescapedSlash`（`:27` 从 0 起扫全串）的写法不一致，读者无法一眼看出等价。
**建议**：加一行注释「j 下界取 1：index 0 恒为开定界符 `/`，不可能落在反斜杠串内」。
**置信**：confirmed（现状无缺陷，属可读性/回归风险）

### compaction-conditions 域

---
**F-core-small-12 | P2 | `packages/core/src/domain/compaction-conditions/triggers/visible-floor.trigger.ts:21`**

```ts
    const visible = await session.list();
    return visible.length > this.visibleFloor;
```

只需要一个**条数**，却把整会话可见消息（含正文解压）全量物化。且这条路径
**每个 agent 回合都跑**：`service/agent/impl/agent-runner.ts:506` 调
`shouldRequestCompaction` → `create-compaction-condition-evaluator.ts:92` →
`CompositeConditionTrigger`（OR 语义，`tokenRatio` 未命中时会继续问 `visibleFloor`）→
本方法。

同一迭代已经就**完全同款问题**治本过一次，且把结论写在了
`service/compaction-conditions/hide-message.action.ts:8-13`：
「区间计算只需要 id/seq/role/hidden——先取**消息头投影**（不选 content 列、不解压正文）；
大会话上原先全量 `listBySession` 连解压是压缩卡顿主源之一」，并由
`ChatAgentSession.list()`（`service/agent/impl/chat-agent-session.ts:30-37`，2026-09-30
首字延迟排查实锤）改为 SQL 层 `includeHidden: false`。可见消息正文仍然是全量拉回+解压的。
**建议**：本触发器改用 `listMessageHeadersBySession` 之类的计数读口（或新增
`countVisible(sessionId)` 端口方法），只取条数。
**置信**：confirmed

---
**F-core-small-13 | P2 | `docs/apm/RULE.md`（压缩条目） ↔ `packages/core/src/service/compaction-conditions/run-compaction.ts:12`**

```ts
 * **不再清 `rule_snapshot` + `file_cache`**（历史行为，自置位照搬）：压缩只
 * 改消息可见性，不改文件内容与规则——这两个域按内容寻址、与消息面正交，
```

RULE「消息与提示词层 → 压缩」条目现文仍写「**副作用：清 `rule_snapshot` + `file_cache`**」，
与代码相反。代码侧是 2026-09-29 用户拍板（「压缩与文件缓存无关」）的修正，注释里写明了
理由（回合内前缀冻结不变量），**代码是对的、RULE 是旧的**。本轮 CR 的合同要求子代理
「开工先读 RULE 做决策感知」，后续所有机位与优化批次都会照这条 RULE 理解压缩副作用，
会做出错误的改动计划（例如给压缩路径补 file_cache 清理，或误判 F-core-small-6 的
GC 挂点范围）。
**建议**：把 RULE 压缩条目的副作用句改为「压缩**不**清 `rule_snapshot` + `file_cache`
（2026-09-29 用户拍板，回合内前缀冻结不变量）；置位与导入缓存对齐才清」，
并把 prompt-token 失效（`invalidateSessionApiPromptTokenEntry`）补进去。
**置信**：confirmed

---
**F-core-small-14 | P3 | `packages/core/src/domain/compaction-conditions/model/compaction-conditions.schema.ts:18`**

```ts
    visibleFloor: z.number().int().nonnegative().optional(),
    "visible-floor": z.number().int().nonnegative().optional(),
```

同一语义字段允许 camel + kebab 双写，两键**同时出现且值不等**时 transform
（`:47` `doc.visibleFloor ?? doc["visible-floor"]`）静默取 camel，v3 老文档里若两键并存
（迁移工具或多端写盘混用）会静默丢一个值，且 `.strict()` 不会报错。
`hideStartDepth` / `hide-start-depth`（`:20-21`）同款。
**建议**：`.superRefine` 里加「两键不得同时出现」或「同时出现必须相等」的 issue。
**置信**：suspected（双写是否真会在存量库里出现未实测，属防御性加固）

---
**F-core-small-15 | P3 | `packages/core/src/domain/compaction-conditions/logic/token-estimate.ts:13`**

```ts
export function estimateTokens(messages: readonly ChatMessage[]): number {
  return _heuristic.countMessages(messages);
}
```

全文件（含模块级 `new HeuristicTokenCounter()` 单例）零消费方：实测
`grep -rln "estimateTokens("` 在 `packages/core/src`、`packages/core/test`、
`apps/{desktop,mobile}/src` 均只命中本定义与同名但不同实现的
`infra/tokenizer/logic/estimate-tokens-cjk-aware.ts:42`。压缩 token 判定实际走
`infra/tokenizer/logic/resolve-current-prompt-tokens.ts`。
**建议**：删除整个文件（连同 `_heuristic` 单例）。它没有进 public barrel，
删掉不影响任何导出面。
**置信**：confirmed

---
**F-core-small-16 | P3 | `packages/core/src/service/compaction-conditions/run-compaction.ts:70`**

```ts
  } catch {
    return { ok: false };
  }
```

catch-all 吞掉 hide-message 的**全部**异常且不打日志。压缩静默失效（DB 错、schema 错、
锚定 bug 未来回归）在用户侧表现为「会话越聊越长但就是压不下去」，无任何可观测线索。
本区负责的锚定逻辑（`resolve-hide-message-range.ts`）一旦未来回归，这条 catch 会
把病灶完全掩盖。
**建议**：`catch (e) { console.warn('[compaction] hide-message failed', e); return { ok: false }; }`
（对照本仓既有做法：`clear-session-prompt-caches.ts` 的「整体 try/catch 吞错 + console.warn」）。
**置信**：confirmed

---
**F-core-small-17 | P3 | `packages/core/src/domain/compaction-conditions/triggers/token-ratio.trigger.ts:37`**

```ts
export const DEFAULT_HEURISTIC_SAFETY_FACTOR = 0.85;
...
        ? this.options.heuristicSafetyFactor ?? DEFAULT_HEURISTIC_SAFETY_FACTOR
        : 1;
```

`heuristicSafetyFactor` 被文档定义为「< 1 的保守系数」（`:26` 「（< 1）」），
但代码零校验：`>= 1` 的值会让**非精确计数的阈值高于精确计数的阈值**，方向与安全意图相反。
当前唯一构造点 `create-compaction-condition-evaluator.ts:57-66` 不传该参数、走默认 0.85，
所以是纯防御性缺口（未来接入配置化时会踩）。
**建议**：`constructor` 里 clamp 到 `(0, 1]` 或在 options 装配处断言。
**置信**：confirmed（当前无活跃 bug，属 latent）

## 争议与存疑

1. **F-core-small-6（孤儿 blob 回收缺口）的严重度取决于未实测的事实**：我没有实测
   「置位 N 次后 `SELECT COUNT(*) FROM session_file_cache_blob` 与
   `session_file_cache_entry` distinct hash 的差值」。静态上确定存在缺口
   （4 个 clearDomain 调用方无 GC 调度），增长速率取决于用户改文件/改规则的频率。
   建议 W6 验证代理用真库或 fixture 实测一次量级再定 P1/P2。**若实测增长可忽略，可降 P3。**
2. **F-core-small-12（visibleFloor 全量拉正文）同样缺实测**：需要「大可见历史 + 大量长正文」
   的会话才能量化。当前判 P2 依据是同款问题在 hide-message 路径已被实锤为「秒级卡顿源」，
   但那条路径此前是**全量 listBySession（含 hidden）**，本条是 `includeHidden:false` 的可见集，
   规模可能差一个量级。建议验证代理实测。
3. **F-core-small-5（env 逃生阀在 mobile 失效）** 我没有跑真机确认 RN 侧
   `process.env.NM_USER_VFS_UNIFIED_TOOL_TURN` 到底是 `undefined` 还是抛错。RN 的
   `process` shim 是 Metro 内置的（只内联 `NODE_ENV`），按语义应为 `undefined` 不抛错，
   但这是推断不是实测。若实际抛错，F-5 需从 P3 提到 P2。
4. **F-core-small-10(a) ReDoS** 需要构造恶意/病态 pattern 才会触发，属用户自伤面。
   是否值得加固取决于产品是否允许用户把外部正则粘进编辑器——从 `parse-pattern-input` 的
   存在看是允许的。**这条我给 suspected 而非 confirmed。**
5. **F-core-small-13（RULE 漂移）** 严格说不在本 zone 的代码文件里，但它是本区
   （compaction + depth 锚定）的直接消费契约，且本轮 CR 明令所有机位「读 RULE 做决策感知」——
   RULE 错了会让后续所有机位对压缩副作用产生系统性误判，故上报而非只在争议里提。
6. **本区未覆盖的邻接面**：`domain/workplace/logic/smart-sort.ts`（smart-sort-rule 的
   消费方，含 `parseChineseNum`/`FIXED_*_SORT_TUPLE`/`extractSortKey` 的比较器实现）、
   `service/compaction-conditions/*`、`service/session-kkv/*`、`domain/workplace/logic/rule-snapshot-codec.ts`
   都不在我的 zone，仅在确认口径时定点读过。若 smart-sort 的排序比较器本身有问题，
   应由认领 workplace 域的机位负责。
