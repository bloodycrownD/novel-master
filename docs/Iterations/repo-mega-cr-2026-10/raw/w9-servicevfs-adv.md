---
zone: w9-servicevfs-adv
agent: 辩护人（advocate / defense counsel）
files_scanned: 72
---

# w9-servicevfs-adv —— 辩护报告

> 机位立场：为 `packages/core/src/service/` 下 vfs / workplace / skills / kkv / session-kkv /
> persistent-preferences / persistent-state / smart-sort-rule / template / compaction-conditions /
> prompt / provider 十二个子域的**设计合理性**辩护，同时诚实标注必须让步的缺陷。
> 独立性：本机位**未读取** `raw/`、`synth/` 下任何其他机位报告。

---

## 摘要

这十二个子域是 core 的「存储与装配骨架层」：vfs 提供三域（global/project/session）+ 两个 meta 域的
逻辑文件系统与版本链；workplace 按「规则快照 + 文件缓存」两条 session KKV 域拼装每轮提示词的
常驻前缀；template 负责 project↔session 的整树拉推；kkv/session-kkv 是全仓的模块级与会话级
键值底座；compaction-conditions 管压缩条件与 hide 执行；prompt 是三区 layout 的唯一渲染出口；
provider 是服务商/模型/请求的 CRUD 与重试。整体是一层**高度收敛的薄编排**——业务判断几乎全在
`domain/` 纯函数里，service 层只做事务边界、路由与错误翻译。

## 职责与边界

| 子域 | 职责 | 明确不管 |
|---|---|---|
| `vfs/` | scope 键空间翻译、revision 版本链、ZIP/角色卡导入、批量 ingest/export、只读物理树 | 不做规则评估、不做 checkpoint 语义 |
| `workplace/` | 目录/文件规则 CRUD、规则视图评估、L1 视图缓存、常驻前缀拼装 | 不做消息可见性、不做 token 计数 |
| `skills/` | 技能目录读写、合并视图、启停负清单、改名事务 | 不解析 front matter 语义（走 domain） |
| `kkv/` `session-kkv/` | 模块级 / 会话级 KV 薄委托 | 不含任何业务策略 |
| `persistent-preferences` / `persistent-state` | 偏好与工作区指针的强类型包装 | 不做校验以外的业务 |
| `smart-sort-rule/` | 智能排序规则 CRUD、调序、导入导出、预览 | 不做实际排序（消费端在 workplace） |
| `template/` | project→session 拉取、session→project 推送 | 不碰消息、不碰 rule_snapshot |
| `compaction-conditions/` | 条件评估（OR 触发器）+ hide 执行 + token 失效 | 不决定压缩锚点（走 `domain/depth`） |
| `prompt/` | 三区 layout 单次遍历渲染 + 三个 view-time 变换 | 不落库、不做宏求值（在 domain） |
| `provider/` | provider/model/request CRUD + 重试策略 | 不含协议细节（在 `infra/llm-protocol`） |

## 对外接口

- `createScopedVfsService(conn, scope)` / `createVfsService(conn)` / `createPhysicalVfsService(conn)`
- `createWorkplaceService(conn, scope)`、`assembleWorkplaceDisplay(scope, deps, options?)`、`refreshRuleSnapshot(sessionId, deps)`
- `createCharacterCardImportService(conn, options?)`、`createVfsZipIoService(conn, options?)`、`createVfsBatchIoService(conn, options?)`
- `createKkvService(conn)` / `createSessionKkvService(conn)`
- `runCompaction(deps, params)`、`createCompactionConditionEvaluator(deps)`
- `buildPromptLlmInputFromLayout` / `buildPromptAssemblyFromLayout` / `buildPromptPreviewSegmentsFromLayout` / `computeLlmExportZonesFromLayout`
- `createProviderServices(conn, secretStore)`
- `clearSessionPromptCaches(sessionId, sessionKkv)`（经 `@novel-master/core` 内部路径）

## 数据访问

| 资源 | 位置 | 证据 |
|---|---|---|
| `kkv_entry`（模块级） | `KkvService` 全部四方法 | `service/kkv/impl/kkv.service.ts:17-38` |
| `session_kkv_entry` / `session_file_cache_entry` / `session_file_cache_blob` | `SessionKkvService` 七方法 | `service/session-kkv/impl/session-kkv.service.ts:16-56` |
| `nm-preferences` | 4 个偏好键 + `list/setPreference` 裸通道 | `service/persistent-preferences/impl/preference-keys.ts:8-21` |
| `nm-workspace-state` | 5 个指针键 | `service/persistent-state/impl/workspace-state-keys.ts` |
| `nm-compaction-conditions` / `nm-model-retry` | 各 1 个 `policy` 键 | `service/compaction-conditions/impl/compaction-conditions-store.service.ts:19-20`、`service/provider/impl/model-retry-policy.service.ts:17-18` |
| `vfs_entry` / `vfs_revision` / `vfs_content_blob` | 三个 factory + 四个 impl | `service/vfs/create-scoped-vfs-service.ts:25-30` 等 |
| `workplace_dir_rule` / `workplace_file_rule` | `DefaultWorkplaceService.setDirRule` 等 | `service/workplace/impl/workplace.service.ts:154`、`:174` |
| `smart_sort_rule` | 全 CRUD | `service/smart-sort-rule/impl/smart-sort-rule.service.ts:88`、`:116` |
| `skill_disabled_rule` | 负清单 | `service/skills/impl/skills.service.ts:411`、`:459` |
| `chat_message` / `chat_message_checkpoint` | 导入后 baseline 回填 | `service/vfs/impl/character-card-import.service.ts:172-181` |

## 依赖关系

- **入向**：`service/agent`（常驻前缀、KKV 失效）、`service/chat`（模板拉推、会话删除）、
  `domain/tool/builtin`（vfs 工具 → `ScopedVfsService`）、`apps/desktop|cli|mobile`（工厂 + IPC）。
- **出向**：几乎全部指向 `domain/*`（纯逻辑）与 `infra/tdbc`、`infra/llm-protocol`。
- **层内耦合**：`workplace` → `session-kkv`（窄 Pick 切片）；`template` → `vfs/logic` + `session-fs`；
  `vfs/*` → `workplace`（仅 `ensureImportDirRules` 写规则表）。**无环**——已实测
  `service/` 内部无 import 环。

---

## 辩护理由清单

以下每条是本机位认为**不应被判为缺陷**、或**缺陷成本高于收益**的设计决策。

### D1 导入缓存对齐采用 best-effort 整体吞错口径 —— 合理，且是有意识的一致性取舍

`service/vfs/logic/clear-session-prompt-caches.ts:33-53` 整体 `try/catch` + `console.warn`。
辩护理由三条：

1. **语义自洽**：调用点在 `character-card-import.service.ts:196-198` 与 `vfs-zip-io.service.ts:258-260`，
   都严格位于 `await this.conn.transaction(...)` **之后**。文件已落库，缓存对齐只影响下一次提示词
   重评估，让它把错误冒泡成「导入失败」是错误映射（用户会以为文件没进去而重试，造成重复覆盖）。
2. **与置位/压缩的差异是有文档的**（`run-compaction.ts:74-77`、`message-transcript-effects`），
   `RULE.md`「导入缓存对齐」条目把「裸 await vs 吞错」写成了口径对照表，不是疏漏。
3. **失败不会静默**：`console.warn` 带 sessionId 与原始 error，可检索。

### D2 `ensureImportDirRules` 在**事务内**吞错，不算设计缺陷

`service/vfs/logic/ensure-import-dir-rules.ts:11-13` 自己写明了依赖：「依赖 SQLite 语句级失败不自动
ROLLBACK、后续语句可继续提交的行为（由 T-I5 故障注入用例守卫）」，且 `:117-124` 有逐目录 catch +
`:127-133` 有外层兜底。**有显式风险声明 + 有故障注入测试守卫**的写法在本仓属于正确工程实践，
不应按「事务内吞错」这一表象扣分。

### D3 模板「拉/推」共用同一套骨架、只对调方向 —— 合理

`template/logic/push-session-workspace.ts` 与 `logic/initialize-session-workspace.ts` 结构镜像，
差别被显式列出（推不清 checkpoint：无 checkpoint 外挂；推无 exclude：project 域无版本链）。
单一骨架避免了两份 `replaceVfsSubtree` 参数漂移；`template-pull.service.ts:35`、`:48` 事务提交后
统一挂 `runDeferredBlobGc`，覆盖 blob 孤儿（`test/vfs/vfs-gc-trigger.test.ts:115` 有载体测试）。
**结构选择本身站得住**（缺口在别处，见 C1）。

### D4 workplace 装配的三处优化都是实测驱动的，不是过早优化

- **批量预取**（`assemble-workplace-display.ts:150-158`）：`getMany` 把每文件两跳串行 SQL 收敛到
  两条 IN。`session-kkv.port.ts:19-27` 的 `getMany` 就是为它而加的（端口注释明说）。
- **fire-and-forget 回填**（`:175-187` 的 `deferBackfillWrite`）：`domain/workplace/logic/load-or-fill-file-cache.ts:60-78`
  给了实测数字（冷态 466ms → 128ms），并解释了为什么是 `setTimeout(0)` 而不是裸 `void`（`fflate.zlibSync`
  是同步 CPU，不推迟照样抢线程，375ms → 128ms）。
- **conn 级 L1 memo**（`impl/workplace-view-cache.ts:4-13`）：放点选得很讲究——工厂每次 new 实例，
  实例级 memo 无效（RULE 有 agent-runner 被击穿的记录），而裸模块级 `Map` 会在多库同进程测试与
  rebootstrap 下串库；`WeakMap<conn, Map<scopeKey,…>>` 同时解掉两个问题且 conn 关闭即回收。

### D5 装配热路径刻意绕开 workplace 全量评估 —— 这是本区域最漂亮的一处设计

`assembleWorkplaceDisplay` 先读 `rule_snapshot/canon`，**只有 miss 或空快照才调 `evaluateRuleView()`**
（`assemble-workplace-display.ts:213-239`）。命中时整条「读 3 张表 + 评估 + 渲染树」的重链完全不走。
这让 `evaluateCachedView` 里「每次都无条件采样签名」（`workplace.service.ts:313-336`）的成本只落在
冷路径上，是刻意的**过度失效可接受**换正确性，而不是疏忽。

### D6 `evaluateCachedView` 的「脏结果最多存活一次读取」是明确的正确性取舍

`workplace-view-cache.ts:84-99`：发布时携带**计算开始前**采样的 sigs，计算期间若有写入，下一个读者
比对不匹配即重算。不需要 epoch 或写路径钩子，也不会永久脏。`workplace.service.ts:283-287` 的
`finally` 里 `entry.inFlight === computing` 才清理，避免覆盖后来者的 in-flight——并发去重语义跨实例
提升后仍然正确。**这是教科书式的 read-through validation**，不应报为竞态。

### D7 `assembleWorkplaceDisplay` 的 `shouldStop` 粒度细化是治本而非打补丁

`assemble-workplace-display.ts:68-89` 的类注释给出了现场（「停止要等 14 秒」、连点 17 次 abort 全派发
却无从兑现），并在 `:146`（快照加载后）与 `:167`（每文件前）设两个观察点，且**诚实地写明残余边界**：
单个大文件的读取本身仍是原子单元。这类「量化问题 → 分层观察点 → 显式声明残余」的注释密度，
本身就是设计质量的证据。

### D8 `file_cache` 命中无条件返回（无 mtime 校验）是**有意的回合冻结不变量**

`load-or-fill-file-cache.ts:42-58` + RULE「前缀回合内天然冻结」。若加 mtime 校验，agent 回合中写盘会
让前缀变化，破坏 provider 前缀缓存命中（每步请求本应是前一步的纯追加）。这是一个**用正确性换缓存
命中率**的显式决策，且被 `run-compaction.ts:15-16` 反向印证：压缩若中途清这两域反而破坏该不变量。

### D9 prompt 三区 layout 的「单次遍历」抽象避免了预览/序列化/LLM 三路漂移

`render-prompt.ts:260-345`（segments）与 `:350-401`（LLM messages）是同一套顺序的两种投影，
`computeLlmExportZonesFromLayout`（`:67-93`）用**与注入逻辑完全同源**的条件计算三区边界
（`workplaceDisplay.trim() !== ""` 而非 `!= null`）。`workplace` 包裹只有
`wrapWorkplaceDisplay` 一处出口（`:95-100`），文件头明文禁止二次包裹。这类「投影而非复制」的结构，
是本仓里少见的、真的被测试锁住的（`test/prompt/prompt-assembly-parity.test.ts`）。

### D10 prompt 的三个 view-time 变换全部「不可变 + 无变更返回原引用」

`apply-thinking-context-for-llm.ts:20`（不可变契约）、`normalize-orphan-tool-results-for-llm.ts:56-80`、
`:85-102` 都有 `if (!changed) return msg`。`resolve-preview-thinking-context.ts` 只负责喂判据，
边界判定留在纯函数里（`:2-12` 注释说明与 wire 侧同源）——预览与线上不会给出两种答案。

### D11 三个 KKV store 对「缺失」的处理各有正确形态

- `KkvService.get` 缺失**抛** `KkvError`（低层契约明确，`kkv.port.ts:10`）。
- `SessionKkvService.get` 缺失返回 `null`（`session-kkv.port.ts:9-11` 给了理由：便于 assemble 判断空快照）。
- 上层三个 store 各自把 `NOT_FOUND` 翻成 `undefined`/`null`（`persistent-preferences:125-134`、
  `persistent-state:112-121`、`compaction-conditions-store:158-167`、`model-retry-policy:61-77`）。

这不是四份重复，是**四种语义**。`model-retry-policy` 额外把「解析失败」也当 unset
（`:71-76`，注释「avoid bricking requests」）尤其正确：配置坏了不该让所有请求 500。

### D12 `DefaultVfsService` 的 unsupported 抛错优于静默 no-op

`impl/vfs.service.ts:206-247`：`resetHeadToVersion` / `renamePath` / `renamePrefix` 全部显式抛
「unsupported without revision history」，并注明生产 wiring 走 `RevisionAwareVfsService` 不会命中。
补偿合同依赖 revision，静默 no-op 会让回滚「成功」但数据没回退——**fail-fast 是对的**。

### D13 版本分配器 `max(head, MAX(version)) + 1` 是被真实场景逼出来的

`revision-aware-vfs.service.ts:398-412`：head 回拨后高版本被 checkpoint 钉住是合法状态，
`head + 1` 会撞已占号。`appendDeletedRevisionsForSubtree`（`:448-484`）用 `findMaxVersionsForEntries`
批量取齐避免 N+1，并解释了为何 deleted 行直接以 `refCount=1` 落库（与逐条 append+adjust 等价）。
**这段的注释密度本身就说明设计者踩过坑。**

### D14 skills 的三态探测与错误文案工程

`skills.service.ts:166-189` 的 `skillFileExistsInDomain` 返回 `true/false/null` 三态，
注释明说「把『查不了』说成『没有』会误导调用方去错误的方向新建」；
`:191-223` 的 `toWriteNotFoundError` 把裸 `Path not found: /meta/skills/...` 翻成可操作文案，
理由写得很清楚（模型据此无法自我修复）。`updateSkillInfo` 的七道校验链（`:476-601`）全部标了
「校验链 N」并说明各自堵的竞态（链 4 明写「收口 TOCTOU」），`:596-599` 还处理了两 driver 的
`SQLITE_ERROR` 包装差异。

### D15 skills 的孤儿负清单边界是**已文档化的已知边界**

`skills.service.ts:576-580`：global X 与 project P 的 X 并存且 (P,X) 被禁用时改 global X 名会留孤儿行，
注释写明「低频组合接受」。**明确声明并接受**的边界在本仓属 `intentional`，不应按 bug 记。

### D16 `smart-sort-rule` 的「全量校验后删除」与 resetDefaults 的撞号防御

- `deleteBatch:132-147` 先全量校验（存在 + 非 builtin）再删，避免半删状态。
- `resetDefaults:253-288` 在删 builtin **之前**快照用户规则相对顺序（`:255-257` 明写若事后用
  `listOrdered()` 兜底，种子 sortOrder 1..4 会与用户规则撞号，按 `rule_id` 隐式决胜把用户规则
  交错进 builtin 中间），并显式 `renumber` 而不走兜底。
- `reorderRules:204-225` 校验去重 + 恰好全覆盖。
- `generateRuleId:356-369` 时间戳+随机、5 次重试、失败抛 CONFLICT。

这些都是**为具体失败模式写的**代码，不是模板 CRUD。

### D17 provider 的跨资源写用 `CoordinatedWrite` 补偿而非假装有事务

`provider.service.ts:92-117`（create）、`:170-207`（edit）、`:228-273`（delete）：secretStore 无事务，
`edit` 先捕获原始明文（`:132-135`）以便失败时精确写回，`delete` 先快照 suggestions/savedModels/
secret 再逆序补偿。**这是 SQLite + 外部密钥存储组合下的正解**，用 `CoordinatedWrite` 而不是
`conn.transaction` 包住外部调用是对的。

### D18 `model-request` 的重试分级是本区域最精细的一段逻辑

`model-request.service.ts:69-104`：`LlmStreamTimeoutError` 按 `phase === "first-chunk"` 分流
（0 字节无副作用可重试 / 已有部分输出重试会重复计费），并**显式要求该分支必须置于「非 ProviderError
默认 true」之前**（`:73-77`）；abort 形态的 `ProviderError` 单列不可重试（`:85-95`，附「黑洞复现实验
r3 实锤」）。`attempt <= policy.maxRetries` + `attempt` 从 1 起算 = 1 次初始 + 2 次重试，语义正确。
每一条分支都有实测来源，不是拍脑袋。

---

## 发现清单（辩护人承认的缺陷）

> 与检察官机位独立。凡我不否认的，`置信` 一律 `confirmed`（我已自行复核代码）；
> 凡只在我无法单方面定论的，标 `suspected` 并写明分歧点。

### F-w9-servicevfs-adv-1 | **P1** | `packages/core/src/service/template/impl/template-pull.service.ts:24-36`

```ts
async sessionTemplatePull(sessionId: string): Promise<void> {
  ...
  await this.conn.transaction(async (tx) => {
    await initializeSessionWorkspace(tx, session.projectId, sessionId, { clearCheckpoints: true });
  });
  await runDeferredBlobGc(this.conn);
}
```

**描述**：模板拉取是 project→session 的**整树覆盖**（`initialize-session-workspace.ts:37-53`
同时 `replaceVfsSubtree` 与 `worktree.copyScope`），但**全链没有任何一处清 `rule_snapshot` / `file_cache`**。
实测确认：全仓 `clearSessionPromptCaches` 的接入点只有
`service/vfs/impl/character-card-import.service.ts:197` 与 `service/vfs/impl/vfs-zip-io.service.ts:259`
两处；`session.service.ts:234-239` 的 `pullTemplate`、desktop IPC
`apps/desktop/src/main/ipc/handlers/sessions.ts:93-98`、mobile
`apps/mobile/src/components/prompt/TemplatePullButton.tsx:45` 三条链路均无 kkv 操作。

**后果（已复核推理链）**：`loadOrFillFileCache` 命中无条件返回、无 mtime 校验
（`domain/workplace/logic/load-or-fill-file-cache.ts:51-56`）；`loadOrCreateRuleSnapshot` 命中非空快照
直接返回（`service/workplace/assemble-workplace-display.ts:222-228`）。因此拉取后，
该会话的常驻前缀会继续输出**拉取前的文件正文与拉取前的规则集**（而规则表已被 `copyScope` 覆盖成
project 模板的），直到下一次置位/压缩/改规则才自愈。用户点一次「拉取模板」，模型看到的文件树是旧的。

**建议**：`sessionTemplatePull` 事务提交后调 `clearSessionPromptCaches(sessionId, createSessionKkvService(conn))`，
与导入链完全同款（best-effort 口径也可直接沿用）。`sessionTemplatePush` 不需要——它只改 project 域，
session 的快照与缓存仍与 session 树一致。

**辩护方的部分抗辩（不影响结论成立）**：拉取是低频用户显式动作，且拉取前的 prompt 通常已经发出，
当轮不会立刻错；但**下一轮**就会错，所以不能算「不可观测」。

**置信**：confirmed

---

### F-w9-servicevfs-adv-2 | **P2** | `packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts:246-250, 261-265, 372-382`

```ts
await this.deps.rules.deleteAll();
for (const entity of entities) { await this.deps.rules.insert(entity); }
```

**描述**：`importRules`、`resetDefaults`、`renumber` 都是**无事务的多语句写**。`importRules`
先 `deleteAll()` 再逐条 insert，第 3 条失败即留下「整表已清 + 插了 2 条」的状态；`resetDefaults`
先删 builtin 再灌种子，种子 insert 失败即 builtin 排序规则全失（用户工作区文件排序静默退化）。
`renumber` 逐条 UPDATE，中途失败留下部分重编号。

**对照**：`deleteBatch`（`:132-147`）刻意做了「先全量校验再删」以避免半删，说明作者**知道**
这类风险，但三个写路径没统一到同一纪律上。

**建议**：三者套 `conn.transaction`（repo 端口已支持传 tx），或至少 `importRules` 先
`decode + validate` 全量（已有）再在事务内 deleteAll+insert。

**置信**：confirmed（无事务这一点已复核：`deps.rules` 由工厂注入同一 `conn`，无 tx 包装）

---

### F-w9-servicevfs-adv-3 | **P2** | `packages/core/src/service/compaction-conditions/run-compaction.ts:70-72`

```ts
} catch {
  return { ok: false };
}
```

**描述**：`runHideMessageAction` 的异常被**完全静默**吞掉，无 `console.warn`、无 error 上报，
只返回一个 `{ ok: false }`。对照本区域的 best-effort 惯例（`clear-session-prompt-caches.ts:49-52`、
`ensure-import-dir-rules.ts:120-123` 都吞错但必 warn），这里是唯一一处「吞错且无痕」。
失败时压缩静默不发生，用户看到 token 持续增长却没有任何线索。

**辩护方抗辩**：`:53-57` 的注释说明这是为对齐旧事件编排器 `emit()` 的历史语义。
**但**：注释解释的是**行为兼容**，不是**可观测性缺失**；加一行 warn 不改变行为。

**建议**：`catch (error) { console.warn(...); return { ok: false }; }`。

**置信**：confirmed

---

### F-w9-servicevfs-adv-4 | **P3** | `packages/core/src/service/vfs/logic/clear-session-prompt-caches.ts:33-53`

**描述**：四步清理（清 rule_snapshot / 清 file_cache / 失效 prompt token / 写 usage_stats 哨兵）
共用**一个** `try/catch`。第一步失败则后三步全部跳过——这比「best-effort」字面语义粗：
best-effort 通常意味着**逐项尽力**。当前实现下，一次 `clearDomain(rule_snapshot)` 的瞬时失败会让
`file_cache` 与 token 缓存一起留脏。

**建议**：逐项独立 try/catch（与 `ensureImportDirRules` 的「逐目录 try/catch + 外层兜底」同款，
该处已有此先例）。

**置信**：confirmed

---

### F-w9-servicevfs-adv-5 | **P3** | `docs/apm/RULE.md:16` vs `packages/core/src/service/compaction-conditions/run-compaction.ts:8-18`

**描述**：RULE.md「压缩」条目写「副作用：清 `rule_snapshot` + `file_cache`」，而代码在 2026-09-29
经用户拍板「压缩与文件缓存无关」后**明确改为不清**（`run-compaction.ts:13-18` 给了完整理由：
这两个域按内容寻址、与消息面正交，压缩发生在回合中段，清缓存会破坏前缀回合内冻结不变量）。
`session-kkv.port.ts:13` 的注释已同步为「压缩不再清」，但 RULE 未同步。

**影响**：后续 agent 按 RULE 会把「压缩清缓存」当既有事实，可能写回回归代码。

**辩护方立场**：**代码是对的，文档是错的**。这是纯文档欠账，不构成代码缺陷。

**建议**：更新 `RULE.md`「压缩」条目，与 `run-compaction.ts` 模块头对齐。

**置信**：confirmed

---

### F-w9-servicevfs-adv-6 | **P3** | `packages/core/src/service/compaction-conditions/impl/compaction-conditions-store.service.ts:117-156`

**描述**：`getConditions()` 是读方法，却在 `:137` 与 `:148` **写回**迁移结果（v2→v4 / v3→v4）。
该方法被 `create-compaction-condition-evaluator.ts:84` 与 `:95` 调用，即每个 agent step 的
`shouldRequestCompaction` 都会走。后果：① 读路径可能因写失败抛错，让压缩条件评估整体失败；
② 迁移写成功前，每次读都重复一次写。

**辩护方抗辩**：迁移自愈式写回是常见且可接受的模式，且失败会抛类型化错误（`rethrowDecodeError`）
而非静默。
**建议**：如要改，把迁移写移出读路径（bootstrap/首次 `setConditions` 时做），或在 evaluator 侧
对读做一次进程内 memo 抑制重复写。优先级低。

**置信**：confirmed（写回事实）；**修复必要性 suspected**（是否有真实故障场景我无证据）

---

### F-w9-servicevfs-adv-7 | **P3** | `packages/core/src/service/workplace/assemble-workplace-display.ts:222-238`

**描述**：空快照被当作「未就绪」（`:225` 的注释：「避免首次空快照粘住后工作区永久消失」），
因此**每次**装配都会重跑 `evaluateRuleView()` 并把 `[]` 写回 KKV。对「layout 开了 workplace 但
scope 无文件」的 agent，每轮多一次完整规则评估 + 一次 KKV 写。

**辩护方抗辩**：这是为避免**永久粘空**而刻意付的代价，方向正确（不粘空 > 省一次写）。
**建议**：若要优化，可引入「空快照 + vfs 签名未变 → 复用」的二级判据，但会重新引入粘空风险。
**列为 P3 且不建议现在改。**

**置信**：confirmed（行为）；**优先级 suspected**

---

### F-w9-servicevfs-adv-8 | **P3** | `packages/core/src/service/persistent-preferences/impl/persistent-preferences.service.ts:87-100`

**描述**：`list()` 先 `listKeys` 再**逐键串行** `get`（N+1，且 `await` 在循环内）。该模块的
`list()` 只服务 `nm preferences list` CLI 命令，N 极小（当前 4 个键）。
`:94-96` 的 try/catch 注释「Skip keys removed between list and get」说明作者已考虑并发删除。

**辩护方抗辩**：低频 CLI 路径，N=4，改动收益低于引入 `getMany` 耦合的收益。
**建议**：不改，或在未来 KKV 增 `getManyByModule` 时顺带优化。

**置信**：confirmed

---

### F-w9-servicevfs-adv-9 | **P3** | `packages/core/src/service/vfs/impl/{character-card-import.service.ts:49-84, vfs-zip-io.service.ts:71-103, vfs-batch-io.service.ts:67-82}`

**描述**：`ensureEmptyDirectoryRow` 与 `assertDirectoryPathNotFile` 在 zone 内有**三份**近乎重复的
实现（两处 25 行几乎逐行相同，batch-io 是精简版）。且**错误类型不一致**：
角色卡/ZIP 抛类型化 `CharacterCardError` / `VfsZipError`，batch-io 抛裸 `new Error(...)`。

**辩护方抗辩**：batch-io 的裸 Error 是被 `applyBatchIngest` 收进 `failed[].message` 的批量语义
（`:318`），不参与错误码透传，可接受。
**建议**：把两个 `ensureEmptyDirectoryRow` 提到 `domain/vfs/logic/` 共用（错误类型由调用方包一层），
batch-io 版本另留。不紧急。

**置信**：confirmed

---

### F-w9-servicevfs-adv-10 | **P3** | `packages/core/src/service/vfs/impl/character-card-import.service.ts:187-188` vs `vfs-zip-io.service.ts:249-250`

**描述**：同样的「事务异常解包」逻辑，一边用 `error instanceof CharacterCardError`，一边用
`error.name === "VfsZipError"`（字符串比较，跨 realm / 多次打包后脆弱）。ZIP 版还有
`error.message === "test import failure"` 的字符串哨兵。

**建议**：ZIP 版改用 `instanceof VfsZipError`（若跨 bundle realm 不成立，则抽
`isVfsZipError` 到 `errors/vfs-zip-errors.ts`，与其他错误模块的 `isVfsError`/`isKkvError` 一致）。

**置信**：confirmed

---

### F-w9-servicevfs-adv-11 | **P3** | `packages/core/src/service/persistent-state/impl/persistent-state.service.ts:133-142`

```ts
await this.set(key, value);
const sessionId = await this.getCurrentSessionId();
if (sessionId != null) { await invalidateSessionApiPromptTokenEntry(...); }
```

**描述**：指针写入与 token 失效是两次独立写，非原子。中间失败 → 指针已切、token 缓存留脏。
最坏后果是「按 api 口径参与阈值判定」（该函数自身注释 `:128-131` 描述的风险），下次压缩判定可能偏。
`setCurrentProviderId` 不做失效是**有意的**（`persistent-state.port.ts:23-27` 标注 CLI-scoped）。

**建议**：可接受现状。若要收紧，把 `invalidateSessionApiPromptTokenEntry` 提到 `set` 之前
（先失效后写指针，中途失败最坏是「失效了但指针没换」= 一次多余的重算，安全方向）。

**置信**：confirmed

---

### F-w9-servicevfs-adv-12 | **P3** | `packages/core/src/service/template/impl/template-pull.service.ts:26-29`

**描述**：`findById` 在事务**外**，随后才进事务做整树替换。若会话在两者之间被删除，
事务内的 `replaceVfsSubtree` 会在一个已删会话的 scope 上执行（可能写入孤儿 VFS 行，随后
`deleteSessionTree` 的 `deleteVfsPrefix` 已跑过）。

**辩护方抗辩**：窗口极窄（同步 SQLite 单连接，同进程内几乎不可能），且写入是幂等覆盖不是破坏。
**建议**：不改；若要改，把 `findById` 移进事务回调首行（同 `pushSessionWorkspace` 一致处理）。

**置信**：confirmed

---

## 争议与存疑（不抹平）

1. **F-1 的严重级可能偏低**。辩护方给 P1，理由是「下一轮提示词即错」。反方若认为「用户点拉取后
   通常会立刻发消息，且常驻前缀文件多为 filename 档位（不读正文）」，可争 P2。
   **我保留 P1**：`rule_snapshot` 被 `copyScope` 改写而快照不改，规则不一致这一条与 status 档位无关。

2. **F-6 的必要性我拿不准**。「读方法内写迁移」在本仓是否有先例？我只查了本 zone。
   `docs/apm/RULE.md` 的「schema migration 清理」条目讲的是**注册表**层，不覆盖「KKV 文档形态
   迁移」。**无法单方面判定这是孤立写法还是既定模式**，交给 reduce 层核实。

3. **F-7 我主动反对修**。P3 是妥协后的级别；我的立场是「不粘空」这个正确性收益高于省一次写，
   优化它会重新引入「首次空快照粘住后工作区永久消失」这一**已修过的**缺陷。
   若 reduce 层要提优化项，此条应带「勿动」标注。

4. **测试覆盖未做穷尽核查**。我实测到本 zone 相关测试文件约 120 个（`test/workplace/` 21、
   `test/vfs/` 40、`test/smart-sort-rule/` 5、`test/provider/` 26、`test/compaction-conditions/` 4、
   `test/prompt/` 14、`test/skills/` 11、`test/session-kkv/` 4 等），覆盖密度足以支撑 D1–D18 的辩护；
   但我**没有逐个读测试内容**，因此不声称「所有辩护点都有测试锁定」，只声称「关键辩护点有对应测试文件存在」。

5. **与 RULE 的另一处可能漂移（未展开，供 reduce 层查）**：`session-kkv.port.ts:14` 写
   「fork / copy 会话**不**复制本表行」。我未去核对 fork/copy 实现，该陈述我**未验证**，既不辩护也不指控。

---

## 让步清单（辩护人明确承认、建议进入台账）

| # | 让步点 | 级 | 一句话修法 |
|---|---|---|---|
| Y1 | 模板拉取不清 `rule_snapshot`/`file_cache`，导致拉取后常驻前缀输出旧内容与旧规则 | P1 | `sessionTemplatePull` 提交后调 `clearSessionPromptCaches` |
| Y2 | `smart-sort-rule` 的 `importRules`/`resetDefaults`/`renumber` 无事务，失败留半成品（builtin 可能全失） | P2 | 三者包 `conn.transaction` |
| Y3 | `runCompaction` 吞错无日志，压缩静默失效不可诊断 | P2 | catch 内加 `console.warn` |
| Y4 | `clearSessionPromptCaches` 四步共用一个 try/catch，首步失败连坐后三步 | P3 | 改逐项 try/catch（`ensureImportDirRules` 已有先例） |
| Y5 | `RULE.md`「压缩」条目仍写「清 rule_snapshot + file_cache」，与 2026-09-29 拍板的代码相反 | P3 | 更新文档，代码不动 |
| Y6 | `getConditions()` 在读路径内写回 v2/v3→v4 迁移 | P3 | 迁移写移出读路径或加进程内 memo |
| Y7 | 空快照每次装配重评估 + 重写 KKV | P3（**建议勿改**） | — |
| Y8 | `PersistentPreferences.list()` N+1 串行读 | P3（**建议勿改**） | — |
| Y9 | `ensureEmptyDirectoryRow`/`assertDirectoryPathNotFile` 三份重复 + 错误类型不一致 | P3 | 提取共用 + 统一错误类型 |
| Y10 | ZIP 导入用 `error.name` 字符串比较判错误类型 | P3 | 改 `instanceof` 或补 `isVfsZipError` |
| Y11 | `persistent-state` 指针写与 token 失效非原子 | P3 | 调换顺序（先失效后写指针） |
| Y12 | `templatePull` 的 `findById` 在事务外 | P3（**建议勿改**） | — |

**辩护方立场总结**：本区域 **P0 = 0**。骨架设计（VFS scope 键空间分离、workplace 装配分层、
模板拉推共用骨架、provider 补偿写、prompt 单次遍历投影）经得起推敲，绝大多数「看起来像问题」的地方
都能在代码注释里找到**带实测数据或带事故记录的**决策依据。唯一真正的正确性缺口是 **Y1（模板拉取
未做缓存对齐）**——它恰好是 RULE 已为「角色卡/ZIP 导入」建立的同一套对齐口径的**漏网场景**，
补法现成、风险极低。其余 P2/P3 均为可观测性、事务原子性与文档一致性层面的欠账。