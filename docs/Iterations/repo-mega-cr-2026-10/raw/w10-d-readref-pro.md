---
zone: d-readref-pro
agent: 检察官（对抗对 W10 · v1.5.29 引用化链）
files_scanned:
  - packages/core/src/domain/chat/logic/hydrate-tool-results-for-prompt.ts (351)
  - packages/core/src/domain/vfs/logic/revision-ref-count.ts (436)
  - packages/core/src/domain/tool/logic/build-tool-result-block.ts (580)
  - packages/core/src/domain/tool/builtin/skill-tool.ts (603)
  - packages/core/src/domain/tool/logic/skill-read-truncation.ts (126)
  - packages/core/src/domain/tool/logic/tool-output-limits.ts (223)
  - packages/core/src/domain/tool/logic/format-tool-output.ts (475)
  - packages/core/src/domain/tool/builtin/vfs-tools.ts (692)
  - packages/core/src/domain/chat/model/content-block.ts (211)
  - packages/core/src/domain/chat/content/parse-message-content.ts (330+)
  - packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts (641)
  - packages/core/src/service/agent/logic/run-agent-turn.ts (装配段)
  - packages/core/src/service/agent/impl/agent-runner.ts (装配段)
  - packages/core/src/service/chat/impl/message.service.ts
  - packages/core/src/service/chat/impl/session.service.ts
  - packages/core/src/service/chat/impl/project.service.ts
  - packages/core/src/service/chat/create-user-vfs-turn-service.ts
  - packages/core/src/infra/llm-protocol/logic/gemini-content-mapper.ts (402)
  - packages/core/src/infra/llm-protocol/impl/gemini.adapter.ts (183)
  - packages/core/src/bootstrap/novel-master-bootstrap.ts (装配段)
head: fe79b781
---

## 摘要

v1.5.29 把 read / skill read / skill load 三类工具结果从「content 存全文」改成
「content 存占位空串 + contentRef 引用」。引用按全局键 `(entryId, version)` 指向
`vfs_revision`，发送提示词前由 `hydrateToolResultsForPrompt` 查 revision、重放
截断管线、经冻结 formatter 还原 wire 全文。同时 `vfs_revision.ref_count` 引入
第三类持有者「消息侧 read 引用」。本区域的核心不变量有三条：**① 有引用必有计数、
② 有计数必能重放、③ 重放逐字节等值**。本次对抗发现 2 条 P1（计数对账口径破裂 +
repair 安全网整体未接线）、1 条 P2（skill load 的 memo 键漏 `files` 导致 wire 失真）、
3 条 P3。

## 职责与边界

- **产引用**：`build-tool-result-block.ts` 从工具输出解析 `contentRef`，把 `content`
  置空串。
- **保活计数**：`vfs-tools.ts` read 分支、`skill-tool.ts` load/read 分支在工具返回前
  同步 `adjustRevisionRefCount(+1)`。
- **挂点对账**：`revision-ref-count.ts` 提供 `collectReadRefs` / `aggregateReadRefs`
  （消息内去重、消息间累加）与删除/覆写/fork/copy/会话删除/项目删除六处 −1/+1 挂点。
- **重放**：`hydrate-tool-results-for-prompt.ts` 在 `prepareUserMessagesForPrompt`
  尾部统一 hydrate。
- **单源截断**：`skill-read-truncation.ts` 抽出 `deriveSkillReadTruncation` /
  `deriveSkillLoadTruncation`，供 `skill-tool.ts` 执行侧与 hydrate 重放侧共用。
- **不在本区**：GC 触发时机、blob 触发器维护、UI 渲染、压缩策略。

## 对外接口

| 符号 | 位置 |
|---|---|
| `hydrateToolResultsForPrompt(messages, revisionRepo?)` | `hydrate-tool-results-for-prompt.ts:323` |
| `ReadResultHydrateError` / `ReadResultHydrateErrorCode` | 同上 `:69` / `:86` |
| `ReadResultRef` / `SkillResultRef` / `ToolResultBlock.contentRef` | `content-block.ts:100` / `:145` / `:59` |
| `buildToolResultBlock` | `build-tool-result-block.ts:430` |
| `collectReadRefs` / `aggregateReadRefs` / `adjustReadRefCount` | `revision-ref-count.ts:72` / `:98` / `:131` |
| `aggregateReadRefsFromAllMessages` | `revision-ref-count.ts:166` |
| `repairRefCounts` / `createRevisionRefCountRepairOperation` | 同上 `:275` / `:357` |
| `deriveSkillReadTruncation` / `deriveSkillLoadTruncation` | `skill-read-truncation.ts:54` / `:115` |
| `resolveReadRefCountChannel` | `run-agent-turn.ts:201` |

## 数据访问

| 目标 | 位置 | 说明 |
|---|---|---|
| `vfs_revision.ref_count` | `revision-ref-count.ts:131-156`、`:203-210` | +1/−1 走 `batchAdjustRefCountWithDelta` |
| `vfs_revision` 元数据/明文读 | `hydrate-tool-results-for-prompt.ts:243`、`:265` | `findMetaByEntryAndVersion`（零解码）/ `findByEntryAndVersion` |
| `vfs_content_blob` | **不由本区维护** | 由 SQLite 触发器在 revision INSERT/DELETE/UPDATE OF content_hash 时维护（`revision-ref-count.ts:352-355`） |
| `chat_message` 全表扫描 | `revision-ref-count.ts:175` | repair 三类化聚合 read 引用 |
| 工具输出 KKV `file_cache` | `vfs-tools.ts:591` | read 侧缓存，与引用化正交 |

## 依赖关系

- **import 谁**：`hydrate` → `format-tool-output.js`（`formatReadOutput` / `formatSkillLoadOutput`）、`skill-read-truncation.js`、`tool-output-limits.js`（`capUtf8BytesFill` / `sliceLinesFromOffset`）、`vfs-revision.port.js`。`build-tool-result-block` → `content-block.js` + `skill-tool-ref.js`。`revision-ref-count` → `parse-message-content.js` + `message-content-codec.js` + 三个 repository port。
- **被谁消费**：`prepare-user-messages-for-prompt.ts:639` 是 hydrate 的唯一生产调用点（主链与 token/压缩 parity 链共用）；`agent-runner.ts:449` 是其唯一上游。`aggregateReadRefs` / `adjustReadRefCount` 六个挂点见下表。

---

## 发现清单

### F-d-readref-pro-1 | **P1** | 计数对账口径破裂：+1 按工具调用计，−1 按消息去重计

- **file:line**：`packages/core/src/domain/vfs/logic/revision-ref-count.ts:72-90`（去重口径）、`packages/core/src/domain/tool/builtin/vfs-tools.ts:237-247`（+1 口径）、`packages/core/src/service/agent/impl/agent-runner.ts:864-882` 与 `:912`（同一条消息装下全部并行结果）
- **引文**：
  ```ts
  // revision-ref-count.ts:79 —— 消息内去重
  const key = `${block.contentRef.entryId}:${block.contentRef.version}`;
  if (seen.has(key)) { continue; }
  ```
  ```ts
  // vfs-tools.ts:243 —— 每次 run() 各 +1（并行 N 次即 +N）
  await ctx.adjustRevisionRefCount([{ entryId: raw.entryId!, version: raw.version }], +1);
  ```
- **描述**：引用化链的两端用了**不对等的计数单位**。+1 发生在工具 `run()` 内部，每个
  tool_use 各加一次；−1 发生在消息删除/截断侧，`collectReadRefs` 对
  `(entryId, version)` 做消息内 `Set` 去重。而 `agent-runner.ts:912` 把**同一轮全部
  并行工具结果塞进同一条消息**：
  ```ts
  const toolResults: ToolResultBlock[] = toolUses.map((tu, i) => buildToolResultBlock(...));
  ...
  await session.append("user", { blocks: toolResults });
  ```
  于是只要模型在一轮里对同一文件发两次 `read`（或 `skill read`/`skill load` 打同一
  SKILL.md），`ref_count` 就 +2，而这条消息在删除/截断时只贡献 −1，**永久多出 1**。
  同理适用于 `message.service.ts:249`（delete）、`:491/:531`（truncateAfter）、
  `truncate-tail-in-transaction.ts:81`、`session.service.ts:224/:399`、
  `project.service.ts:176` 全部挂点。
  `revision-ref-count.ts:95-97` 的注释「挂点两侧共用同一口径——保证『每条持有消息恰好
  +1 / −1』严格对账」在 +1 侧并不成立：+1 侧根本没有「消息」这个单位。
- **建议**：二选一。要么把 +1 也收敛到「每条消息一次」——即 `append` 落库时按
  `collectReadRefs` 补 +1、工具侧 +1 降级为「仅存在性校验」（但那样仍有 sweep 窗口，
  需要保留工具侧 +1 并在 append 时**补差**而非重复加）；要么在 `collectReadRefs`
  上引入 `count` 权重（同一 pair 在同一消息出现 N 次就计 N），并让 `aggregateReadRefs`
  跨消息求和得到真实工具调用数。前者改动面小且能同时修掉 fork/copy 的期望值口径。
- **置信**：**confirmed**（三处代码已逐行核对；触发条件为「同一轮并行读同一文件」，
  LLM 行为高频）

### F-d-readref-pro-2 | **P1** | repair 三类化整体未接线：文档承诺的泄漏兜底是死代码

- **file:line**：`packages/core/src/domain/vfs/logic/revision-ref-count.ts:357`（定义）、`:166`（`aggregateReadRefsFromAllMessages`）、`packages/core/src/bootstrap/novel-master-bootstrap.ts:420-423`（唯一 repair 注册点）、`packages/core/src/domain/tool/builtin/vfs-tools.ts:232-233`（承诺方）
- **引文**：
  ```ts
  // vfs-tools.ts:232 —— 「+1 泄漏由 repair 检测兜底」
  // 方向取舍：宁多不少，read 后 append 前崩溃留下的 +1 泄漏由 repair 检测兜底
  ```
  ```ts
  // novel-master-bootstrap.ts:421 —— 全仓只注册了发号器修复
  const reports = await new IntegrityRepairRegistry()
    .register(createVfsEntrySequenceRepairOperation(conn))
    .runAll();
  ```
- **描述**：`createRevisionRefCountRepairOperation` 在**全仓生产代码中零调用**。我对
  `packages/` 与 `apps/` 下全部 `.ts/.tsx/.js/.mjs`（排除 test）做了符号检索，
  命中仅 3 处，全部是注释或定义本身：
  - `revision-ref-count.ts:357`（定义）
  - `service/integrity-repair.ts:78`（JSDoc 示例 `registry.register(createRevisionRefCountRepairOperation({...}))`）
  - `domain/provider/logic/provider-identity-repair.ts:18`（注释里说「那是 createRevisionRefCountRepairOperation 的职责」）

  bootstrap 只注册了 `createVfsEntrySequenceRepairOperation`。连带地，
  `aggregateReadRefsFromAllMessages`（唯一调用方是 repair op 的 `repair()`，
  `:396-399`）与 `repairRefCounts` 的 `overExpected` 泄漏报告在生产中**从不执行**。
  这直接掏空了三条不变量里的两条兜底：
  1. `vfs-tools.ts:232` 承诺的「append 前崩溃的 +1 泄漏由 repair 兜底」——不成立；
  2. `hydrate-tool-results-for-prompt.ts:111-115` 声明「刻意不做跨调用持久缓存，
     因为 dangling/已删除的 fail-fast 是保活链断裂的安全网」——安全网本身从未运行，
     一旦计数真的漂移，**没有任何自动或人工检出的通路**；
  3. F-1 的计数偏差也只能永远累积。

  泄漏路径确实存在且不是理论：`agent-runner.ts:908-911` 在工具已执行（+1 已发生）
  之后、`session.append` 之前检查 abort 并 `break`，这条消息永远不会落库，+1 永久泄漏。
- **建议**：在 bootstrap 的 repair 链上补注册，并明确 `conn` 传参（`conn == null` 时
  `readRefs` 为 `undefined`，期望值退化成两类化，`overExpected` 会把全部 read 持有
  行误报为泄漏——见 F-4）。同时把 `overExpected` 的结果接到启动日志/告警，否则注册了
  也没人看。
- **置信**：**confirmed**（符号检索覆盖 packages + apps 全部非测试源码）

### F-d-readref-pro-3 | **P2** | hydrate memo 键漏 `files`：skill load 的附属文件尾注会串

- **file:line**：`packages/core/src/domain/chat/logic/hydrate-tool-results-for-prompt.ts:292-293`（键构造）、`:205-213`（消费方读 `ref.files`）、`packages/core/src/domain/tool/builtin/skill-tool.ts:455-468`（`files` 与 `result.version` 非同源）
- **引文**：
  ```ts
  // hydrate:293 —— 键里没有 files
  const wireKey = `${plainKey}:${actionKey}:${ref.offset}:${ref.limit ?? ""}:${ref.path}`;
  ```
  ```ts
  // skill-tool:455-465 —— content 来自 result.version，files 来自另一次 listSkills
  const { content, truncated } = deriveSkillLoadTruncation(result.content);
  const list = await service.listSkills(...);
  const files = list.find((e) => e.name === name)?.files.filter((f) => f !== "SKILL.md") ?? [];
  ```
- **描述**：`replaySkillLoadWireText` 的 wire 文本**依赖 `ref.files`**（经
  `formatSkillLoadOutput` 拼出「附属文件（相对技能目录）：…」尾注，见
  `format-tool-output.ts:316-321`），但 `files` **不在 `wireKey` 里**。同一批消息里若
  存在两条 `skill load` 引用块，它们的 `(entryId, version, path, offset=1, 无 limit)`
  全部相同——`skill-tool.ts:462-465` 显示 `files` 来自一次**独立的 `listSkills` 调用**，
  而 `entryId/version` 来自 `readSkillFile` 的 SKILL.md 快照；技能目录新增/删除附属
  文件**不会 bump SKILL.md 的 version**。于是：第 1 轮 load 技能 X（SKILL.md v5，
  files=[a.md]）→ agent `skill write X/b.md`（SKILL.md 仍 v5）→ 第 2 轮 load 技能 X
  （SKILL.md 仍 v5，files=[a.md, b.md]）。第 3 轮 prepare 时两条块同处一批消息、
  一次 hydrate 调用，wireKey 碰撞，第 2 条块**复用第 1 条的 wire**，LLLM 看到的附属
  文件清单是过期的（少了 b.md），可能据此漏读一个真实存在的附属文件。
  注：`files` 同样不在 `plainByRefKey` 里，但明文与 files 无关，那处是对的。
- **建议**：把 `files` 纳入 wireKey（skill load 分支追加 `ref.files.join("\u0000")`），
  或更彻底——让 memo 缓存「重放所需的 ref 投影」而非整个 ref 的少数字段，从根上消除
  「新增 ref 字段忘记进键」这一类漏。
- **置信**：**confirmed**（键构造与消费方字段已逐行比对；触发条件为同一 SKILL.md 版本
  下附属文件清单发生变化）

### F-d-readref-pro-4 | **P3** | `conn` 缺省时 `overExpected` 会把全部 read 持有行误报为泄漏

- **file:line**：`packages/core/src/domain/vfs/logic/revision-ref-count.ts:307-310`、`:330-341`、`:396-399`
- **引文**：
  ```ts
  // :396-399
  const readRefs = conn == null ? undefined : await aggregateReadRefsFromAllMessages(conn);
  ```
  ```ts
  // :330-335 —— 期望值缺第三类，但当前值含第三类 → 必然「偏高」
  const overExpected = rows.filter((row) => row.refCount > (expected.get(key) ?? 0))
  ```
- **描述**：`createRevisionRefCountRepairOperation` 的 `conn` 是可选参数。不传时
  `readRefs` 为 `undefined`，`expected` 只含 checkpoint 指针 + live head 两类，而
  `refCount` 里含着 read 引用的 +1，于是**每一条被 read 引用持有的 revision 都会被
  判为「疑似泄漏」**并进入 `overExpected`。虽然按「只报告不自动修」的哲学不会造成
  误删，但报告一旦被当真去人工处置，会引导错误结论。
- **建议**：`conn == null` 时直接在 `RepairReport` 上标注「期望值未含 read 引用，
  `overExpected` 不可用」，或干脆不产出 `overExpected`。修 F-2 时务必连同传参一起处理。
- **置信**：**confirmed**

### F-d-readref-pro-5 | **P3** | `aggregateReadRefsFromAllMessages` 全表解码，per-scope 重复扫描

- **file:line**：`packages/core/src/domain/vfs/logic/revision-ref-count.ts:169-177`
- **引文**：
  ```ts
  const rows = await conn.query<...>(`SELECT id, content_encoding, content_blob, content_json FROM chat_message`);
  ```
- **描述**：该函数 `SELECT` **全库** `chat_message`（含 hidden、含所有 project/session）
  并逐行 zlib 解码 + `parseMessageContent`。`repairRefCounts` 是按
  `(scopeKey, pathPrefix)` 调用的，`createRevisionRefCountRepairOperation` 的命名也
  按 scope 生成——一旦按 F-2 接上 bootstrap 且按 scope 批量注册，代价是
  `O(scope 数 × 全库消息数)` 次解码。建议把聚合结果提到循环外算一次复用。
  （当前因 F-2 未接线而无实际开销，故记 P3。）
- **建议**：把 `readRefs` 的计算上移到注册/编排层，作为参数传给每个 scope 的 repair。
- **置信**：**confirmed**

### F-d-readref-pro-6 | **P3** | hydrate 对无引用消息也整数组拷贝 + 重复扫描

- **file:line**：`packages/core/src/domain/chat/logic/hydrate-tool-results-for-prompt.ts:327`、`:336`
- **引文**：
  ```ts
  if (!messages.some(messageHasReadResultRef)) { return [...messages]; }
  ...
  for (const message of messages) { if (!messageHasReadResultRef(message)) { ... } }
  ```
- **描述**：`messageHasReadResultRef` 每条消息被调用两次（一次 `.some` 预扫、一次主循环），
  且无引用时仍 `[...messages]` 整数组浅拷贝。绝大多数会话（无 read 引用）走的是这条
  路径。历史消息动辄数百条，属可测量的无谓开销，且与本文件头强调的性能修复基调不符。
- **建议**：合并成单次遍历；无引用时直接 `return messages as ChatMessage[]`（上游
  `prepareUserMessagesForPrompt` 返回的 `out` 已是新数组，不会被别名化）。
- **置信**：**confirmed**

---

## 已核实为「不是缺陷」（避免下游重复下水）

以下几点是本区域的承重设计，我逐行比对后确认自洽，记录在此以免 reduce 阶段误报：

1. **重放逐字节等值（read 路径）**：`replayReadWireText`（`hydrate:131-166`）与
   `vfs-tools.ts:197-227` 的 `sliceLinesFromOffset` / `capUtf8BytesFill` /
   `truncated` 三分支 / `nextOffset` 推导**逐行同参同序**，`lastLineTruncated` 的
   透传条件（`byteCapped.lastLinePartial`）也一致。`formatReadOutput` 只消费
   `content/offset/truncated/lastLineTruncated/totalLines/nextOffset` 六个字段，两侧
   喂入一致 → 等值成立。
2. **skill read / load 单源**：`deriveSkillReadTruncation` / `deriveSkillLoadTruncation`
   是执行侧（`skill-tool.ts:455`、`:496-502`）与重放侧（`hydrate:178-213`）共用的
   **同一份函数**，不是复刻两份——「截断单源」这条纪律在 skill 侧落实到位。
3. **skill load 不带 totalLines**：`formatSkillLoadOutput` 内部委托 `formatReadOutput`，
   truncated 时会拼 `Total lines: N.`；hydrate 侧刻意不传 `totalLines`（`content-block.ts:162-183`
   把它定为 load 侧占位假值 0 并标注「消费方禁读」），两侧都因 `typeof totalLines !== "number"`
   而跳过该提示 → 等值成立。
4. **`plainByRefKey` 不含 kind**：明文与 kind/action 无关（同一 revision 的同一版正文），
   load 与 read 共用一份解码是有意的省一次 blob 解码，注释也写明了。
5. **`alreadyReferenced` 不产引用块**：`build-tool-result-block.ts:153-155` 显式短路，
   理由（wire 是常量 tip、无正文可引、hydrate 无法重放该语义）成立——若产了引用块，
   重放端确实拿不到「本请求已注入」这个状态位。
6. **kind 分派顺序**：`parse-message-content.ts:136-139` 先按 `kind` 分派再进各自白名单，
   read 白名单不会吞掉 skill 的 `action/domain/name/files`；未知 kind 由
   `parseReadResultRef:154-158` fail-fast 拒绝，不会静默当 read 处理。
7. **hydrate 与孤儿拍平的先后**：`prepare-user-messages-for-prompt.ts:636-639` 明确
   hydrate 必须早于 `normalizeOrphanToolResultsForLlm`，否则未 hydrate 的空 content 会被
   拍成占位文本——顺序正确。
8. **gemini mapper 消费 hydrated content**：`toolResultToGeminiPart` 直接用
   `block.content`，其入参 `req.history` 即 `agent-runner` 经 prepare 后的 `visible`，
   不存在「未 hydrate 就出站」的窗口。孤儿分支退化为 `[tool_result]` 也只在
   `toolUseId` 解析不出函数名时发生，此时内容本就不参与配对。
9. **无「−1 多于 +1」的路径**：已逐个核对六个 −1 挂点，它们全部使用去重后的
   `collectReadRefs`/`aggregateReadRefs`，相对工具侧 +1 只可能**少减**不可能多减，
   因此本区域的计数漂移方向单一（偏高的泄漏），**不会导致提前 GC / 悬空引用 /
   hydrate 抛 REVISION_MISSING**。这是本区域目前最值得庆幸的一点，也是我把 F-1/F-2
   定为 P1 而非 P0 的理由。

## 争议与存疑

- **F-1 的修法归属**：我倾向「append 侧按消息补差」，但这会牵动 `message.service.append`
  的事务边界（append 目前**完全不碰** ref_count，是纯 `insert`，见
  `message.service.ts:179-228`），改它影响面覆盖所有消息写入路径。另一条路是给
  `collectReadRefs` 加权重，代价是 `aggregateReadRefs` 的语义从「持有消息数」变成
  「持有次数」，而 `revision-ref-count.ts:38-39` 的注释与 `ReadRefCountAggregate.count`
  的字段文档都写死了「count = 持有该 pair 的消息数」。**这是个需要主代理裁决的口径
  变更，不该由 CR 单方拍板**。两条路都会让现有测试
  （`test/vfs/read-ref-count.test.ts:474` 附近「collectReadRefs 按消息内 (entryId, version)
  去重 → 只 +1」）的断言语义发生位移，需同步改。
- **F-2 是否算「已知待接线」**：代码注释把 repair 三类化写得像已生效的运行时保障
  （`vfs-tools.ts:232`、`hydrate:111-115`、`revision-ref-count.ts:266-273` 的
  `@remarks` 都以现在时描述它）。但 bootstrap 里没有它，也没有 feature-flag 或
  TODO 标注。若主仓 APM 记忆里有「repair 链分期接线」的拍板记录，本条应降级为
  `intentional`；我未读 `docs/apm/`（本轮纪律只允许读 PLAN 协议指定项），故按
  代码事实记为 confirmed 缺陷。
- **F-3 的实际影响面**：`files` 串味只在「同一 SKILL.md 版本下附属文件清单变化过」
  时显现，且症状是 LLM 少看到一个附属文件（不是发错正文），不会触发 hydrate 的
  fail-fast。定 P2 而非 P1。
- **未覆盖**：`vfs_content_blob.ref_count` 的 SQLite 触发器侧我按
  `revision-ref-count.ts:352-355` 的声明采信「应用层 repair 不碰它」，未去读触发器
  DDL 实证；`test/` 下的相关测试我只用于确认设计意图，未逐条审计测试有效性。