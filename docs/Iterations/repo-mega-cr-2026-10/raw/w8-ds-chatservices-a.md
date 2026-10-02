---
zone: w8-ds-chatservices-a
agent: 独立双扫 A（domain-survey schema）
files_scanned:
  - packages/core/src/service/chat/create-chat-services.ts
  - packages/core/src/service/chat/create-message-transcript-effects.ts
  - packages/core/src/service/chat/create-user-vfs-turn-service.ts
  - packages/core/src/service/chat/message-transcript-effects.port.ts
  - packages/core/src/service/chat/message.port.ts
  - packages/core/src/service/chat/project.port.ts
  - packages/core/src/service/chat/session.port.ts
  - packages/core/src/service/chat/usage-stats.port.ts
  - packages/core/src/service/chat/user-vfs-turn.port.ts
  - packages/core/src/service/chat/impl/message-transcript-effects.service.ts
  - packages/core/src/service/chat/impl/message.service.ts
  - packages/core/src/service/chat/impl/project.service.ts
  - packages/core/src/service/chat/impl/session.service.ts
  - packages/core/src/service/chat/impl/usage-stats.service.ts
  - packages/core/src/service/chat/impl/user-vfs-turn.service.ts
---

## 摘要

chat 服务层：project/session/message 三个 CRUD + 复制（fork/copy）树、消息 transcript 副作用
（hide/show/tail 截断/置位）、token 用量统计聚合、用户 VFS turn 编排。全部走 TDBC 单连接，
写路径以「事务内裸写 + 事务提交后 deferred GC / KKV 失效」为骨架；VFS 树、会话 KKV、workplace
规则、checkpoint/revision 四类资源由本区统一编排。

## 职责与边界

- **ProjectService**：项目 CRUD + `copy`（复制 project 模板 VFS + `project:{id}:meta` 技能域 VFS +
  技能负清单行 + 播 live-head revision）；`delete` 用 BFS 展开子会话后逐个清 fs/kkv/vfs/run_state。
  项目智能体（agent_config_json）已下线，`getAgentConfig`/`updateAgentConfig` 标 `@deprecated` 仅保留读兼容。
- **SessionService**：会话 CRUD + `create`（初始化 session 工作区：从 project 模板 replace VFS +
  copyScope 目录规则 + 写 agent 配置）、`createSubSession`（**仅 insert**，不碰 VFS/KKV）、
  `copy`（VFS 树 + 消息 + agent 配置，走 `seedForkCopyParity`）、`delete`（递归删子树）、
  `pullTemplate`/`pushTemplate`（委托 `DefaultTemplatePullService`）、composer 草稿读写、
  会话智能体配置 partial-overlay 更新。
- **MessageService**：`seq` 单调递增的消息 CRUD、fork（按 `seq <= upTo.seq` 截断复制）、
  hide/show/hideRange/showRange、truncateAfter（回滚锚点后物理删尾）、searchMessages。
- **MessageTranscriptEffectsService**：hide/show range、tail 截断、**置位（set floor）**的
  统一副作用实现。置位是唯一带 `CoordinatedWrite` 补偿的多资源写编排点。
- **UsageStatsService**：只读聚合（summary / 日桶 / 时桶 / 模型分账 / 流水分页 / 会话详情），
  唯一写动作是 `usage_stats.toolUseCount` 缓存回填。
- **UserVfsTurnService**：用户侧 VFS 写（新建/删除/重命名/保存文件）经合成 tool 即时执行，
  失败按 head 快照 restore。

## 对外接口

| 符号 | 位置 | 说明 |
|---|---|---|
| `createChatServices(conn, sessionDeps, options?)` | `create-chat-services.ts:64` | 一次装配 4 个服务；`options.yieldFn` 仅透给 messageRepo |
| `createProjectService/createSessionService/createMessageService/createUsageStatsService` | 同上 `:109/:114/:122/:127` | 单服务糖，内部仍走全量 bundle |
| `createMessageTranscriptEffectsService(conn)` | `create-message-transcript-effects.ts:18` | 自建一个 `createMessageService(conn)` |
| `createUserVfsTurnServiceBundle/createUserVfsTurnService` | `create-user-vfs-turn-service.ts:33/:102` | user VFS turn 装配 |
| `DefaultProjectService/SessionService/MessageService/UsageStatsService/MessageTranscriptEffectsService/UserVfsTurnService` | `impl/*.service.ts` | 默认实现 |
| `MessageService` / `SessionService` / `ProjectService` / `UsageStatsService` / `MessageTranscriptEffectsService` / `UserVfsTurnService` | `*.port.ts` | 端口类型，经 `public/chat.ts:309-353` 导出 |

## 数据访问

| 资源 | 触点 |
|---|---|
| `chat_project` | `project.service.ts:104-146`（list/get/create/rename/updateAgentConfig）、`:189` delete |
| `chat_session` | `session.service.ts:90-205`、`:261-327`（agent_config_json / composer_draft_json）；子会话枚举 `sqlite-session.repository.ts:38`（`parent_session_id IS NULL`）、`:51`（`listByParentSession`） |
| `chat_message` | `message.service.ts:132-516`；`UNIQUE(session_id, seq)` 见 `bootstrap/chat/chat-schema.ts:56` |
| `vfs_entry` / `vfs_content_blob` / `vfs_revision` | `copyVfsTree`（fork/copy）、`deleteVfsPrefix`（session/project delete）、`seedLiveHeadRevisionsUnderPrefix`（project copy）、`sweepSessionRevisions`（message delete） |
| `message_checkpoint` | `message.service.ts:253/455/487`、`deleteSessionFsData`（session delete/pullTemplate） |
| `session_kkv_entry` + `session_file_cache_entry` | `createSessionKkvService(tx).clearSession`（session/project delete）、`clearDomain`（置位清 `rule_snapshot`+`file_cache`、`delete`/`truncateAfter` 清 `backfill_cursor`）、`usage_stats.toolUseCount` 哨兵写 |
| `workplace_dir_rule` / `workplace_file_rule` | 仅经 `seedForkCopyParity` 的 `worktree.copyScope`（session→session，`domain/chat/logic/seed-fork-copy-parity.ts:109`）间接写；**本区无任何 deleteScope 调用** |
| `skill_disabled_rule` | `project.service.ts:182` removeScope、`:279` copyScopeRules |
| `session_run_state` | `session.service.ts:222` deleteBySession、`project.service.ts:178` deleteByProject |

## 依赖关系

**import（出）**：`domain/chat/{repositories,logic,model,content}`、`domain/vfs/*`、`domain/workplace/*`、
`domain/message-checkpoint/*`、`domain/session-kkv/*`、`domain/session-run-state/*`、
`domain/skills/repositories/impl/sqlite-skill-disabled-rule.repository`、
`service/{template,session-fs,session-kkv,session-run-state,agent/logic,coordinated-write,message-checkpoint/*}`、
`infra/tokenizer/logic/session-api-prompt-token-store`、`infra/{tdbc,sql-template,serialization}`。

**被消费（入）**：
- `apps/desktop/src/main/runtime/create-desktop-runtime.ts:139-145`、`apps/mobile/src/runtime/create-mobile-runtime.ts:111-118`、`apps/cli/src/runtime.ts:222-248` —— 三端 runtime 装配。
- desktop IPC：`handlers/messages.ts`（list/search/append/edit/hide/show/hideRange/showRange/truncateAfter/delete/fork/setFloor）、`handlers/sessions.ts`（pull/pushTemplate、delete、agent 绑定、model 覆盖）。
- `service/agent/logic/run-agent-turn.ts`：`ChatAgentSession`（append/truncateAfterMessage）、`messageTranscriptEffects`（压缩）、`runChildAgent`（createSubSession）。
- `service/compaction-conditions/{run-compaction,hide-message.action}.ts`。
- `service/vfs/logic/clear-session-prompt-caches.ts`（导入路径的四件套，与本区失效口径同源）。
- `service/message-checkpoint/impl/message-rollback.service.ts`（回滚链自建失效，不走本区）。

## 发现清单

### F-w8-ds-chatservices-a-1 | P1 | packages/core/src/service/chat/impl/project.service.ts:263-296

```
await copyVfsTree(r.vfs, { scopeKey: `project:${id}` }, "/", ...);
...
await copyVfsTree(r.vfs, { scopeKey: `project:${id}:meta` }, "/", ...);
await new SqliteSkillDisabledRuleRepository(tx).copyScopeRules(`project:${id}`, `project:${copy.id}`);
await seedLiveHeadRevisionsUnderPrefix(r.vfs, r.revisions, `project:${copy.id}`, "/", contentStore);
```

**描述**：项目 copy 复制了 VFS 树（普通域 + meta 域）、技能负清单、live-head revision，
但**没有复制 `workplace_dir_rule` / `workplace_file_rule`**。而这两个表才是「目录规则」的
真源——`initialize-session-workspace.ts:49-52` 建会话时正是从 `project:{projectId}` 域
`copyScope` 到 `session:{sessionId}`。后果：复制出来的项目里所有目录都「无规则行 = rule_off」
（RULE.md「目录规则」条目明写此口径），新建会话的常驻工作区文件树被裁成空/仅根，
且用户在源项目调好的目录规则全部丢失。项目 copy 只在 CLI 有活入口
（`apps/cli/src/project/commands.ts:68`），双端 UI 无入口，故影响面受限但仍是数据正确性问题。

**建议**：`project.service.copy` 事务内补一次
`new SqliteWorkplaceRepository(tx).copyScope('project:'+id, 'project:'+copy.id, normalizePath)`，
与 skill 负清单复制并列；补一条「copy 后规则等价」的断言测试。

**置信**：confirmed（`SqliteWorkplaceRepository` 在整个 project.service.ts 中零引用，已 grep 核实）。

### F-w8-ds-chatservices-a-2 | P2 | packages/core/src/service/chat/impl/session.service.ts:207-232

```
await r.messages.deleteBySession(session.id);
await deleteSessionFsData(tx, session.id, session.projectId);
await createSessionKkvService(tx).clearSession(session.id);
await createSessionRunStateService(tx).deleteBySession(session.id);
await deleteVfsPrefix(r.vfs, `session:${session.projectId}:${session.id}`, "/");
```

**描述**：会话删除清了 messages / checkpoint+revision / KKV / run_state / VFS，
唯独没清 `workplace_dir_rule` / `workplace_file_rule` 中 `scope_key = session:{sessionId}` 的行。
这些行由 `initialize-session-workspace.ts:49`（建会话）与 `seed-fork-copy-parity.ts:109`
（fork/copy 会话）写入，`WorkplaceRepository.deleteScope` 是现成方法但全仓唯一调用点是
`copyScope` 内部（`sqlite-workplace.repository.ts:244`）。表无 FK、无触发器、无 GC 任务
（`infra/db-maintenance/impl/` 只有 blob/message-content/db-maintenance 三个），
孤儿规则行随会话增删无限累积。项目删除同样漏（`project.service.ts:168-174` 逐会话清，
也没碰 workplace 表）。

**建议**：在 `deleteSessionTree` 的 `deleteSessionFsData` 之后加一行
`new SqliteWorkplaceRepository(tx).deleteScope(workplaceScopeKey({kind:'session', sessionId}))`；
`project.service.delete` 的循环内同理补 session 域，并在循环外补 `project:{id}` 域。

**置信**：confirmed。

### F-w8-ds-chatservices-a-3 | P2 | packages/core/src/service/chat/impl/message.service.ts:433-492

```
async truncateAfter(sessionId, afterMessageId) {
  ...
  await messages.deleteAfterSeq(sessionId, anchor.seq);
}
await this.invalidatePromptTokens(sessionId);
await this.invalidateToolUseCount(sessionId);
```

**描述**：`truncateAfter` 的 tail 分支**不 sweep revision**（`delete(id)` 分支有
`sweepSessionRevisions`，见 `:254`；`truncateTailInTransaction` 也有 `sweepRevisions` 开关）。
删消息时 `deleteCheckpointsForMessages` 会 −ref，revision 行 ref_count 归零但**留在表里**。
唯一兜底是 `message-rollback.service.ts:295` 的 `scheduleDeferredRevisionOrphanGc`，
而该函数全仓只有这一个调用点（已 grep 核实）——即走 `chat-agent-session.truncateAfterMessage`
（agent turn abort 回滚，`chat-agent-session.ts:58`）这条路时，没有任何后续清扫，
孤儿 revision 行与它们 pin 住的 `vfs_content_blob` 长期驻留。
`afterMessageId == null` 的「清空整 session」分支（`:446-458`）同样不 sweep。

**建议**：与 `delete` 分支对齐，在事务尾部调
`sweepSessionRevisions(revisions, entries, checkpoints, projectId, sessionId, tx)`；
注意 `truncateAfter` 目前没有 `projectId` 入参，需从 session 行取或给 port 加参数。
另可考虑事务提交后 `scheduleDeferredRevisionOrphanGc(this.deps.conn)`。

**置信**：suspected（数据确实会留，但是否有别的路径偶然清扫未穷尽证明——已查 `infra/db-maintenance` 与全仓 `sweepSessionRevisions` 调用点，只有 delete / session-delete / user-vfs-turn / rollback 四处）。

### F-w8-ds-chatservices-a-4 | P2 | packages/core/src/service/chat/impl/message-transcript-effects.service.ts:63-77

```
async truncateMessagesAfter(projectId, sessionId, afterSeq, options?) {
  await this.deps.conn.transaction(async (tx) => {
    await truncateTailInTransaction(createTruncateTailDepsFromTx(tx), {
      projectId, sessionId, afterSeq, sweepRevisions: options?.sweepRevisions ?? false,
    });
  });
}
```

**描述**：`truncateMessagesAfter` 删消息后**既不失效 API prompt 占用、也不失效工具调用数缓存**。
对比同区 `MessageService.truncateAfter`（`message.service.ts:490-491`）两条都做；
`message-rollback.service.ts:269-289` 也两条都做。而 `truncateTailInTransaction`
只清 `backfill_cursor` + Composer 状态域（`truncate-tail-in-transaction.ts:87-97`），
不含 `prompt_tokens` / `usage_stats`。活消费方是 desktop IPC
`handleMessagesTruncateAfter`（`apps/desktop/src/main/ipc/handlers/messages.ts:252`）
—— 批量删后重启，陈旧 API 占用会按 api 口径（跳掉 0.85 安全垫）参与压缩阈值判定，
陈旧 toolUseCount 会让弹窗工具调用数虚高。两条失效在 `session-kkv-domains.ts:37-49`
的口径注释里被列为强制要求（「凡是改变当前可见 prompt 的路径，成功后必须调」）。

**建议**：`truncateMessagesAfter` 事务提交后补
`await invalidateSessionApiPromptTokenEntry(this.deps.sessionKkv, sessionId)`
与 toolUseCount 哨兵写（可直接抽成本区共享 helper，避免第三次复制粘贴）。

**置信**：confirmed（对照三条同构路径逐行核实）。

### F-w8-ds-chatservices-a-5 | P2 | packages/core/src/service/chat/impl/session.service.ts:234-246

```
async pullTemplate(sessionId: string): Promise<void> {
  await this.get(sessionId);
  await new DefaultTemplatePullService(this.deps.conn).sessionTemplatePull(sessionId);
}
```

**描述**：「从上级同步」整树覆盖 session VFS（`template-pull.service.ts:30-34` →
`initializeSessionWorkspace(clearCheckpoints: true)`），但**全程不碰 session KKV**：
`file_cache`（按 `{status}:{path}` 缓存的文件正文）与 `rule_snapshot`（规则快照 canon）
都留着覆盖前的旧值。`load-or-fill-file-cache.ts:51-56` 命中即无条件返回、**无 mtime 校验**
（RULE.md「常驻工作区」条目明写此不变量），所以同步后下一次组装仍按旧正文拼 `<workplace>` 前缀。
API prompt 占用同样没失效。对照：导入路径专门有 `clear-session-prompt-caches.ts` 做
「清 rule_snapshot + file_cache + 双删 prompt token + 工具数哨兵」四件套，且 `docs/apm/RULE.md`
「导入缓存对齐」条目把这条列为拍板口径。`pullTemplate` 是同一语义（用户主动重置工作区）却漏了。
`pushTemplate` 方向是 session→project，不影响本会话缓存，无需处理。

**建议**：`sessionTemplatePull` 事务提交后调 `clearSessionPromptCaches(sessionId, this.sessionKkv)`
（或等价四件套）。注意 RULE 记录导入路径用 try/catch 吞错 + warn、置位/压缩用裸 await 上抛——
pullTemplate 属用户主动重置，建议照置位口径裸 await。

**置信**：confirmed。

### F-w8-ds-chatservices-a-6 | P3 | packages/core/src/service/chat/impl/usage-stats.service.ts:250-273

```
for (let hour = 0; hour < 24; hour++) {
  const startMs = new Date(year, month, day, hour).getTime();
  const endMs = new Date(year, month, day, hour + 1).getTime();
  const row = startMs < endMs ? await this.queryAggregateRow(startMs, endMs, ...) : ZERO_AGG_ROW;
  buckets.push(this.toBucket(startMs, row));
}
```

**描述**：`getHourlyBuckets` 是 24 次串行聚合查询（N+1）。同文件 `getDailyBuckets` 已经用
单条 `GROUP BY day_key`（`:208-226`，注释明写「替代旧实现的逐日 N+1」），小时桶这条路径没跟上，
在消息量大的库上单次展开就是 24 次全表聚合扫。DST 缺失钟点的退化处理（`startMs < endMs`
否则退零值桶）是对的，只是实现方式可以换成一次 GROUP BY + 小时桶。

**建议**：改成单条 `SELECT strftime('%H', created_at_ms/1000,'unixepoch','localtime') AS hour_key, AGG... GROUP BY hour_key`，再用现成的 `rowByDay` 同款 Map 填桶；DST 缺失钟点靠「桶里没数据 → ZERO_AGG_ROW」自然退化。

**置信**：confirmed。

### F-w8-ds-chatservices-a-7 | P3 | packages/core/src/service/chat/impl/usage-stats.service.ts:352-366

```
const limit = Math.floor(page.limit);
if (!Number.isFinite(limit) || limit < 1 || limit > 200) { throw chatInvalidArgument(...) }
if (!Number.isFinite(page.offset)) { throw chatInvalidArgument(...) }
const offset = Math.max(0, Math.floor(page.offset));
```

**描述**：分页入参做了 `Number.isFinite` 拒收（注释还专门解释 NaN/Infinity 会穿透
`Math.floor`/`Math.max` 进 SQL 绑定）。**但只在这一处做了**。同文件
`queryAggregateRow` / `listRequestUsage` 绑定的 `fromMs`/`toMs` 来自
`resolveDayRangeMs`（`:583-593` `new Date(y, m, d).getTime()`，必为有限数），没问题；
真正的口径不一致在**邻区**：`message.service.ts:515` 的
`.slice(0, Math.max(1, Math.floor(query.limit)))` —— `query.limit` 为 NaN 时
`Math.floor(NaN)=NaN`、`Math.max(1,NaN)=NaN`，`slice(0, NaN)` 返回空数组（静默返回 0 条，
不报错）。仓储层 `sqlite-message.repository.ts:513` 同样 `Math.max(1, Math.floor(query.limit))`，
NaN 会直接进 SQL `LIMIT #{limit}` 绑定。desktop `MessagesSearchRequest.limit` 是必填 `number`
但 IPC 边界无校验（`apps/desktop/shared/ipc-types.ts:659`）。

**建议**：在 `MessageService.searchMessages` 入口加与 `listRequestUsage` 同款的
`Number.isFinite(limit)` 拒收（或 `clamp` 到 [1, 上限]），避免 NaN 静默返回空集 / 绑定炸库。

**置信**：confirmed。

### F-w8-ds-chatservices-a-8 | P3 | packages/core/src/service/chat/impl/user-vfs-turn.service.ts:44-62

```
readonly sessionKkv: SessionKkvService;   // :44
readonly messages: MessageService;        // :45
readonly chatMessages: MessageRepository; // :50
readonly messageCheckpoint: MessageCheckpointService; // :62
```

**描述**：四个注入依赖在 `DefaultUserVfsTurnService.executeOp`（`:71-148`）中**全部未被读取**——
`this.deps.` 实际只出现 `sessions` / `resolveToolCtx` / `toolRunner` / `revisions` / `entries` /
`checkpoints` / `conn` 七个（已 grep 逐行核实）。字段注释自称「保留以便工厂签名稳定」
（历史 user_ops 拆除、`preview*` stub、`checkpoint` 改挂），属**有意保留**，标 intentional。
但代价是 `create-user-vfs-turn-service.ts:42-49` 白白 new 了一个 `DefaultMessageService`
（连带 5 个 repository）并调 `createMessageCheckpointService(conn)`，每次 runtime 装配都付这份成本。

**建议**：若确定不再恢复 preview/flush，把四个字段与工厂里对应的 `DefaultMessageService` /
`createMessageCheckpointService` 构造一并删掉；若要保留兼容，把注释里「零消费」的事实写明
（现在是「保留以便签名稳定」，读起来像还有消费方），并标注已核实无引用。

**置信**：intentional（死依赖，注释已说明保留原因）。

### F-w8-ds-chatservices-a-9 | P3 | packages/core/src/service/chat/impl/message-transcript-effects.service.ts:114-116

```
let hiddenCount = 0;
let shownCount = 0;
const write = new CoordinatedWrite();
if (hidePrefix != null) { write.register({ name: "hide-prefix", execute: async () => { hiddenCount = ... } ...
```

**描述**：置位的 `hiddenCount` / `shownCount` 由 execute 闭包回写外层 `let`。
正常路径没问题（`write.run()` 顺序 await 完再 return），但若 `clear-rule-snapshot` 抛错，
`CoordinatedWrite.run` 会逆序 rollback 后 rethrow —— 此时两个计数已被 execute 写过、
rollback 也已把可见性改回去，函数走 throw 出口不返回，**所以没有实际泄漏**。
真正值得记的是：`hidePrefix`/`showSuffix` 的 rollback 用的是「反向 range 操作」
（`showRange(1, floorSeq-1)` / `hideRange(floorSeq, maxSeq)`），而
`updateHiddenRange` 带 `AND hidden = 0/1` 过滤（`sqlite-message.repository.ts:487`）。
若区间内原本就有「同状态」的行（例如 prefix 中早已被压缩隐藏的行），
反向操作会把它们一起翻开/隐藏，与调用前状态不完全等价。
T-SC3 测试（`packages/core/test/chat/message-transcript-effects.test.ts:245-297`）
恰好构造了「后两条先隐藏」的初始态并断言 `deepEqual(beforeVisibility)`——
说明这个语义已被测试锁定为「按范围反向补偿」而非「按行精确还原」，属**有意设计**，
但注释（`:117-119`「恢复可见性计数一致」）没点出这一层差异。

**建议**：在 `setMessageFloorAtMessage` 的注释里补一句「补偿按 seq 范围反向操作，
区间内调用前即处于目标态的行会一并翻转；这是已知取舍」，避免后人误以为是精确还原。

**置信**：intentional（行为已被测试锁定），风险点为文档表述不足。

### F-w8-ds-chatservices-a-10 | P3 | packages/core/src/service/chat/create-user-vfs-turn-service.ts:2

```
/**
 * 鐢ㄦ埛 VFS U-A-U-A 鏈嶅姟宸ュ巶銆?
```

**描述**：该文件全部中文注释是 **UTF-8 被按 GBK 解码后再编码**产生的乱码
（`鐢ㄦ埛` = 「用户」的 GBK 误解码形态；实测文件本身是合法 UTF-8、无 U+FFFD 替换字符，
说明是历史某次按错误编码读写后**已落盘固化的乱码**，非当前终端显示问题）。
乱码集中在 `:2`、`:25`、`:31-32`、`:101` 四处 JSDoc。
全仓 `rg "銆|锟|鈥|娴|鏂"` 在 `packages/`+`apps/`+`scripts/` 下**只命中此一文件**
（`docs/Iterations/.../raw|w8-ds-chatservices-b.md` 另有命中，但那是 CR 报告正文引用本发现，不算源码）。
AGENTS.md 的 PowerShell/GBK 编码事故记录说明本仓踩过多次同类坑。

**建议**：按语义重写这四段 JSDoc 为正常 UTF-8 中文（内容可从 `@module` 与函数签名反推：
「用户 VFS U-A-U-A 服务工厂。」「`createUserVfsTurnServiceBundle` 返回值。」「创建用户 VFS turn
服务与补挂 append 包裹（共享连接与 repo）。」「创建 `UserVfsTurnService` 实例。」）。
改时务必用专用 Edit 工具（RULE.md「PowerShell 管道改写 UTF-8 中文文件必毁编码」）。

**置信**：confirmed。

### F-w8-ds-chatservices-a-11 | P3 | packages/core/src/service/chat/impl/session.service.ts:293-300

```
const modelId: string | undefined;
if (patch.modelId === undefined) { modelId = baseline.modelId; }
else if (patch.modelId === null) { modelId = undefined; }
else { modelId = patch.modelId; }
const merged = modelId == null ? { agentId } : { agentId, modelId };
const validated = decode(sessionAgentConfigSchema.toWire(merged), sessionAgentConfigSchema);
```

**描述**：merge 分支正确实现了三态语义（undefined=保持 / null=清除 / 非空串=覆盖），
`modelId == null` 的判定也正确覆盖了「baseline 本身无 modelId」的情况。
唯一毛刺：`patch.modelId === ""`（空串，非 null）会走到 else 分支得到 `modelId = ""`，
`merged = { agentId, modelId: "" }` 经 `sessionAgentConfigSchema`（`.strict()` +
`modelId: z.string().min(1)`，`session-agent-config.schema.ts:12`）校验**抛 ZodError**，
而非「当作清除」。`agentId` 侧对空串做了显式兜底（`:282` `patch.agentId !== ""`），
两侧不对称。desktop IPC `SessionSetModelOverrideRequest.modelId: string | null`
（`apps/desktop/shared/ipc-types.ts:383-387`）无空串防线，UI 传空串即触发未归一的
Zod 错误（`formatIpcError` 会兜住不崩，但用户看到的是 schema 原文而非业务提示）。

**建议**：`updateSessionAgentConfig` 里把 `else if (patch.modelId === null)` 扩成
`patch.modelId == null || patch.modelId === ""`，与 agentId 侧的空串兜底对齐。

**置信**：confirmed（读码推导；未跑真机复现 UI 能否传空串）。

### F-w8-ds-chatservices-a-12 | P3 | packages/core/src/service/chat/impl/message.service.ts:91-96

```
private async invalidatePromptTokens(sessionId: string): Promise<void> {
  await invalidateSessionApiPromptTokenEntry(createSessionKkvService(this.deps.conn), sessionId);
}
```

**描述**：`invalidatePromptTokens` / `invalidateToolUseCount` 每次调用都
`createSessionKkvService(this.deps.conn)` 现造一个服务实例（`:93`、`:113`）。
`DefaultSessionService` 有同样的现造模式（`:322`）。注释已解释「本类只持有 conn：
就地建一个 SessionKkvService（无状态、只是仓储包装）」——即**有意为之**，避免在 port 上
多挂一个依赖，属 intentional。代价是每次失效多两个对象分配 + 一个 `SqlTemplateParser`
（`SqliteSessionKkvRepository` 构造函数内建，`session-kkv/impl/session-kkv.service.ts`）。
在 `delete` / `truncateAfter` 这类一次操作调 1~2 次失效的量级下可忽略；
但 agent abort 高频回滚 + 双端 run 收尾叠加时是可测的小成本。

**建议**：若要优化，在 service 构造时缓存一个 `private readonly kkv = createSessionKkvService(conn)`
（无状态，跨事务安全——注意 KKV 删除在 `conn.transaction` 块外调用，缓存实例不违反该约束）。
优先级低，不必进本轮 backlog。

**置信**：intentional。

## 争议与存疑

1. **F-3（truncateAfter 不 sweep revision）**：我确认了「该路径不 sweep」与「孤儿 GC 只有
   rollback 一个调用点」两个事实，但**没有排除**「下一次任意 delete / session 删除 / user-vfs-turn
   失败路径顺带把同 scope 孤儿清掉」的可能。若后续核实这些路径在真实使用中总会发生，
   严重度可降 P3。列为存疑而非 confirmed。

2. **F-1（project.copy 漏 workplace 规则）的实际影响面**：项目 copy 在双端 UI 无入口，
   只有 CLI `projects copy` 能触发。若团队认为 CLI 项目复制是低频/实验功能，
   可降 P2。但**数据丢失是确定的**（用户在源项目调的目录规则进不了副本），故不降。

3. **F-5（pullTemplate 缓存不失效）**：`docs/apm/RULE.md` 的「常驻工作区」条目把
   「改写缓存的只有用户改规则、压缩/置位、会话删除」写成既定不变量——按这条，
   pullTemplate 不在列表里。但同条目也没把「session 导入」列进去（那条在「导入缓存对齐」
   条目里单独处理），说明这份清单本身不完整、而是随迭代追加的。pullTemplate 整树覆盖 VFS
   与导入同属「用户主动重置工作区」语义，我判定为漏项而非有意排除。**若主代理找到
   pullTemplate 不清缓存的显式拍板记录，此条应改标 intentional。**

4. **`updateHiddenRange` 的 `AND hidden = 0/1` 过滤与「置位幂等性」**：
   重复对同一锚点置位时，`hidePrefix` 第二次的 changes 为 0（行已是 hidden=1），
   `hiddenCount` 返回 0 而非区间长度。UI 若把 `hiddenCount` 当「隐藏了几条」展示，
   二次置位会显示 0。这是 port 契约（`:84`「Returns count of affected messages」）的
   直译，未发现消费方误用，但值得在 synth 阶段与 UI 侧对账。

5. **`usage-stats.port.ts:45` 有一处错别字**：「展示名由 UI 层解析兑底」应为「兜底」
   （同文件 `:44` 上方还有一处 `解析兑底`）。纯文档，未单列为发现条目。

6. **`ZERO_AGG_ROW` 是模块级共享可变对象**（`usage-stats.service.ts:156`），
   被 `queryAggregateRow`（`:628`）、`getDailyBuckets`（`:242`）、`getHourlyBuckets`（`:269`）
   三处当作默认值返回。当前所有消费方（`toBucket` / `getSummary`）只读不写，安全；
   但任何人未来往 `Row` 上写字段就会跨调用污染。属潜在陷阱，未达 P3 门槛，仅记录。

7. **未覆盖的相邻面**：`packages/core/src/service/template/`（pull/push 实现）严格说
   属本区边界外（`session.service.ts:236/243` 是它的唯一调用点），我只读了三份文件
   用于判定 F-5/F-1 的边界，未全量测绘 template 域。若 F-5 的修复要动 template 层，
   建议由 template 域的机位复核。
