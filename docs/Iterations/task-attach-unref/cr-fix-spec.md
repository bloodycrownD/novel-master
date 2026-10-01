# CR Fix Spec: task-attach-unref（v1.5.30）

## 元信息
- repo: D:\Dev\nm-worktree\tau @ feat/task-attach-unref
- base_sha: fe79b781 / head_sha: ad1d5ed6（61 files，+7649/−2574）
- prd_path: 无独立 PRD（需求即 spec 前言 + docs/apm/memory/20260927-worktree-123-verify-guide.md 轮次记录）
- spec_path: docs/Iterations/task-attach-unref/spec.md
- review_round: 6（CR 3 轮 + spec-check 2 轮：R1 No-Go（1P0+4P1+7P2）→ doc-fix 12 项 → R2 **Go（execute-ready）**：12 项全修复核验通过、三条高风险改法（C-01 分页+Set / G-2 裸 SQL 造行 / d-s0-G1 stub 行为断言）实测可落；R2 附带 1P1+8P2（新-1..新-9）已全部 doc-fix 订正入条目：B-01 判据改「前值 < ABS(delta)」、C-01 补 JSDoc 同步+空集快路径+BATCH_SIZE、A-1/A-3 措辞统一「复用此前的子会话」、C-1 扩三处订正（含 L111）、Closure 同步、C-3 计数 16→15、d-s0/G-1 落点改既有文件追加、G-8 残留分批措辞订正、D-01 补 patch 前置条件）
- dag_version: 6
- 状态: execute-ready 待用户确认（R2 结论 Go；确认后可交 code-dev-loop 执行）

---

## Must-fix（按 P0 → P1 → P2；P0 = 0）

### b-migration/B-01 [P1] D15 第三子句未实现：delta<0 命中 no-op 无 warn 区分坏行 + UPDATE 无下限夹逼
- 维度：B + D（spec deviation D15）
- 文件：packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts:470（batchAdjustRefCountWithDelta）；packages/core/src/infra/db-maintenance/impl/message-ref-unref.ts:733 附近（单行事务）
- 问题：spec D15 白纸黑字「delta<0 命不中 no-op 时记 warn 区分坏行」未落地——adjustReadRefCount 吞 changes、delta<0 分支无存在性预查、L583 注释「行级 warn 已在上方记下成因」对「读取成功后、提交前被 GC」不成立。且 UPDATE 无 `ref_count > 0` 夹逼，误减可致负数 → deleteUnreferencedUnderScope 误删活 revision（不可恢复方向）。
- 改法：① repository 的 delta<0 UPDATE 加下限夹逼——`AND ref_count >= ABS(delta)`（或等价 `AND ref_count + <delta> >= 0`）。**注意 round2 P1-1：`ref_count > 0` 不够**——五路径 −1 经 `aggregateReadRefs` 聚合后 weight 可为 −2/−3（count≥2），`ref_count=1, delta=-2` 在 `>0` 夹逼下仍写出 −1；夹逼必须按 |delta| 量级。② **−1 之前**在同 tx 内对 plan.refs 做 `SELECT entry_id, version, ref_count FROM vfs_revision WHERE (entry_id, version) IN (...)`，对**行缺失**或**前值 < ABS(delta)** 的 pair `console.warn`（含 chat_message.id + entryId/version + 前值）——判据必须锚在「−1 之前的前值不足」或「行缺失」上，**不得**用「减完等于 0」（v1.5.29 的 read +1 叠加在 live head +1 之上，「读过 N 次后又被编辑」的旧 revision 迁移前 ref_count=N、逐条 −1 归零是**正确终态**，按减完判 0 会在存量库上打与存量行同量级的 warn 风暴且 CI 全绿）。**spec-check R2 新-1：前值判据与①夹逼同源**——`前值=1、delta=−2` 正是「夹逼落空、UPDATE 未命中、计数没减」的真实坏行档位，须含在 warn 内。**round2 P2-7：新 warn 须跳过 `badBlockCount > 0` 的行**（坏块成因已由 planRow 既有 warn 记过，不重复告警）。
- 执行顺序约束（round2 N-6）：本条与 e-tests/G-5 **必须同批落地**——改法②要在 tx 上加 SELECT，而 `connWithFailingRefDelta` 的 `{...tx}` 展开丢 `query` 原型方法，只落本条不动 G-5 会让 T-UM3 以 `tx.query is not a function` 崩掉。
- 影响面登记（round2 P1-1）：该 repository 是五路径 −1 共享面，改完须跑 `read-ref-count` / `read-ref-safety` / `rollback-ref-count` 三组对账全绿。
- 验收/测试：packages/core/test/vfs/read-ref-count.test.ts 补「ref_count=0 时 −1 保持 0 不为负」「ref_count=1、delta=−2 时保持 0 不为负」断言；message-ref-unref.test.ts 补三档——「−1 前值充足：无 warn」「行缺失或前值 < ABS(delta)（含 ref_count=1、delta=−2 → ref_count 保持 1）：输出 warn 且该行照常写回、不判失败」「badBlockCount>0 的行不重复 warn」（spy console.warn）。
- 来源：review-b-migration round1

### e-tests/G-1 [P1] S0 唯一真实触发链（显式 header 目录）零端到端覆盖
- 维度：G（spec deviation G6 回归锁缺失）
- 文件：packages/core/test/workplace/assemble-workplace-display.test.ts（新增用例）；packages/core/test/chat/prepare-user-messages-for-prompt.test.ts（可选串联）
- 问题：S0 修复的实际价值只在显式 fillPolicy:"header" 目录下成立（默认配置 prefixPaths 与 visiblePaths 恒等）。现有 T-WP-VP2 手写快照绕开规则引擎、T-S01 手喂 seenPaths 绕开 assemble——把 evaluateFileDisplay 的 header 判定或 assemble 的 full 条件改坏，全部照绿。
- 改法：补端到端用例 T-S01-E2E：真 `setDirRule({logicalPath:"/", fillPolicy:"header", headCount:0, tailCount:0, ...})` → 不预置快照让 assemble 走真 evaluateRuleView → 断言 `visiblePaths.includes("/hdr.md")` 且 `!prefixPaths.includes("/hdr.md")`（牙齿）；尾部把该批 path 喂 prepareUserMessagesForPrompt（prefixPaths→seenPaths、visiblePaths→workplaceSeenPaths），断言同路径 attach 拿 `1|HEADER-BODY` 全文、无 alreadyReferenced。
- 验收/测试：本条即测试；用例须三段串联（规则引擎→assemble→prepare），任一段改坏即红。
- 来源：review-e-tests round1

### f-doc/A-1 [P1] CHANGELOG 三条分类错位 + 终稿全文（含 A-2/A-3/H-1/H-2 的正文修改，一次落笔）
- 维度：A（novel-master-changelog skill 分类规范）
- 文件：CHANGELOG.md（Unreleased 段）
- 问题：三条全在「### 变更」；第二条「task 续用与文件附件」是新增能力（用户此前做不到）应入「### 新增」；第三条「文件引用去重更精确」是行为修正应入「### 修复」。且段序须按仓内 1.5.28 惯例排「新增 → 变更 → 修复」。
- 改法（round2 P2-2/P2-3：直接给可落笔终稿，替换整个 Unreleased 段——A-2 删句后不留悬空破折号、A-3 限定作用域、H-1/H-2 披露并入第一条，全部在此终稿内闭合）：

```
## [Unreleased]

### 新增

- **子代理会话支持续用与文件附件**（双端）：`task` 派发新增两项能力——主智能体可在同一个对话内复用此前的子会话继续任务（同一子代理保留先前上下文，不必每次重新读一遍工作区），也可随任务直接附带文件路径（与主会话 `@` 引用同款链路）。附件设有总量预算（约 10 万 token 当量、20 个文件），预算内的文件全文附带，超出的以路径清单交付、由子代理自行用 `read` 分段读取——子会话反复开荒重读同一批文件是此前消息存储膨胀的重要来源之一，这两项从源头削减

### 变更

- **文件读取结果回归全文存储**（双端）：`read` / `skill` 工具的结果消息不再以「引用 + 发送时重放」的形式落库，改回直接存文件全文；历史引用消息由后台任务自动回迁为可读全文（静默进行、无需处理），存储体积会随回迁小幅回增，量级取决于升级前引用化消息的多少。回迁完成前，个别历史消息在复制正文与搜索命中统计里仍显示为占位文本，下次启动会继续回迁、完成后自动恢复（大型库可能需要重启数次直至完成）；个别指向已丢失文件的历史消息会显示为错误提示且正文无法恢复，不影响其余消息的回迁

### 修复

- **文件引用去重更精确**（双端）：只有真正在前缀里全文注入过的文件才参与「已引用过」去重；此前工作区里配置为「仅展示文件头」的目录，其文件被引用时会被误判为已加载而省略全文，现在会正常附带
```

- 验收/测试：对照 .agents/skills/novel-master-changelog/SKILL.md 分类表人工核验；「得不偿失」与「主要来源」字样在 Unreleased 已消失；三条正文与 spec L26 归因修正段一致；发版前过目。
- 来源：review-f-apps-doc round1 + spec-check R1 P2-2/P2-3 终稿化

### f-doc/A-2 [P1] CHANGELOG 内部细节与归因夸大（已并入 A-1 终稿）
- 维度：A
- 文件：CHANGELOG.md:7-13
- 问题：「引用机制在工程上得不偿失」是内部工程判断（面向用户违规）；「子会话反复开荒重读同一批文件是此前消息存储膨胀的主要来源」沿用了 spec 已修正的旧归因（96.2% 产生于旧 regime，v1.5.26 起前缀注入已前置缓解）；且单删半句会留「——；」悬空破折号。
- 改法：按 A-1 终稿落笔（第一句收在「改回直接存文件全文」直接接分号；「主要来源」→「重要来源之一」）。
- 验收/测试：grep 确认「得不偿失」「主要来源」不在 Unreleased；断句无悬空破折号。
- 来源：review-f-apps-doc round1

### f-doc/H-1 [P1] 过渡期占位未披露（spec 风险 8 点名 CHANGELOG 披露）
- 维度：H（spec deviation 风险8）
- 文件：CHANGELOG.md 第一条
- 问题：回迁完成前，复制正文与搜索命中统计仍是 `[read ref: path]` 占位（desktop messages.ts:82-106 保留至清理轮）；CHANGELOG 一字未提，用户会以为 bug。
- 改法：按 A-1 终稿落笔——第一条末含「回迁完成前，个别历史消息在复制正文与搜索命中统计里仍显示为占位文本，下次启动会继续回迁、完成后自动恢复（大型库可能需要重启数次直至完成）」。
- 验收/测试：与 desktop 占位实现对照措辞准确性。
- 来源：review-f-apps-doc round1

### f-doc/H-2 [P1] 坏行不可恢复未披露（不能照抄 v1.5.29「原样保留」口径）
- 维度：H
- 文件：CHANGELOG.md 第一条
- 问题：回迁对 revision 缺失/blob 缺失/deleted 的行写错误占位 JSON（文案「回迁已落错误占位，正文不可恢复」），且占位行退出谓词不再重试——正文永久不可恢复、用户可见。本条与 v1.5.29「原样保留不强行转换」语义不同，缺披露。
- 改法：按 A-1 终稿落笔——第一条含「个别指向已丢失文件的历史消息会显示为错误提示且正文无法恢复，不影响其余消息的回迁」。
- 验收/测试：与 message-ref-unref.ts:573 占位实现对照。
- 来源：review-f-apps-doc round1

---

### b-migration/B-02 [P2] 收尾 stalled 误判：解压并发解回明文的行冒充「驱动不生效」
- 维度：B
- 文件：packages/core/src/infra/db-maintenance/impl/message-ref-unref.ts:804-817
- 问题：`leftover > residualKeys.size → stalled` 会把「解压任务把压缩行解回明文、该行在游标扫过之后才进谓词」误判 stalled → warn 谎报 + 三端本进程 return 不再重试。
- 改法：D19 的 deferred 判定（isDecompressTaskDone）**前移**到收尾残留校验之前——解压未完成时 warn + return deferred；仅解压已完成才用 leftover 判 stalled。**同步注释（spec-check R1 P2-5）**：模块头 L65-71 与收尾段 L797-803 的「收尾不变量 / D19 否决在后」注释须一并更新为「deferred 让位判定前置于残留下沉校验，两者同为不置标记的显式失败路径」——否则下一位读者会以为破坏了「收尾前不得提前 break」的红线。
- 验收/测试：message-ref-unref.test.ts 补「解压标记未置 + 收尾有残留 → deferred 不判 stalled」用例；注释与新顺序一致（人工过目）。
- 来源：review-b-migration round1

### b-migration/D-01 [P2] planRow 整行归一化改写：销毁面超出任务范围
- 维度：D（不可逆销毁面收敛）
- 文件：packages/core/src/infra/db-maintenance/impl/message-ref-unref.ts:586（planRow，对照 :530）
- 问题：写回用 parseMessageContent 的结果重新 stringify——parse 会丢空 text 块、白名单外块字段（meta 只保 subagentSessionId/skillRef），回迁一行=整行所有块不可逆归一化，而非只搬 contentRef。
- 改法：refs 计算仍用 parseMessageContent（口径不动）；写回改为对 `JSON.parse(contentJson)` 原始 blocks 原地 patch——只对带 contentRef 的块替换 content 并 delete contentRef，其余块原样保留后 stringify（约 15 行）。**raw↔parsed 对应约束（round2 N-3）**：`parseBlocksArray` 会丢弃空 text 块，两侧下标在含空 text 块的行上整体错位——raw 块与 parsed 块的匹配**必须按 `contentRef` 的 `(entryId, version, path)` 键匹配、禁止按下标**；或直接在 raw 块上读 `raw.contentRef` 做判定（raw 已含全字段），明文按 memo 取。
- 执行顺序约束（spec-check R1 P2-4）：与 `message-ref-unref.test.ts` 的 T-UM1/T-UM6 **JSON.stringify 全等断言同批核对**——raw patch 须保持 `content` 字段在原键位（原地赋值不重排键序），避免既有全等断言因键序漂移误红；若断言仍需调整，随本条同批改。**前置条件（R2 新-9）**：patch 仅作用于 `raw.type === "tool_result" && raw.contentRef != null` 的块——正文里恰好带 `contentRef` 字段的 text 块不得误改（与 D12 假阳性同款风险）。
- 验收/测试：补「夹带空 text 块/未白名单字段的行，回迁后原样保留」用例；补「text 块恰好含 contentRef 字段不被误改」用例；既有 T-UM1/T-UM6 全等断言同步核对通过。
- 来源：review-b-migration round1

### b-migration/C-01 [P2] hasPendingRows 的 failedIds 全量 NOT IN 可撞绑定变量上限；完成态探针成本登记失真
- 维度：C-orch/B
- 文件：packages/core/src/infra/db-maintenance/impl/message-ref-unref.ts:361-379（调用点 :607）
- 问题：failedIds 展开成单条 id NOT IN (?,?,…)——大库假阳性行多则撞 SQLITE_MAX_VARIABLE_NUMBER（默认 32766），异常位于入口最前方 → 每次冷启动硬失败、迁移永不推进。另：D13 登记「未完成态全表读正文」，实现完成态也探（先例同款，登记口径失真一档）。
- 改法（round2 P0-1 订正：**排除集合不可分批切**——按 500 切 NOT IN 会让落在第 2 批及以后的假阳性行在第 1 批查询里不被排除、探针恒命中 → 清标记 → 全表重扫 → 再撞同一批，正是该函数 JSDoc 与文件头点名要避免的「永不收敛」循环）：failedIds 改为 **JS 侧 Set 过滤**——`SELECT id FROM chat_message WHERE <谓词> AND rowid > ? ORDER BY rowid LIMIT N` 分页循环取候选 id，命中任一**不在 failedIds Set** 的 id 即 true（或临时表/CTE join 等价实现，排除集合完整语义不变）。**实现注（R2 新-9）**：failedIds 为空集合时保留现有 `LIMIT 1` 快路径；分页大小复用既有 `BATCH_SIZE`(100)。**同步注释（R2 新-2）**：hasPendingRows 的 JSDoc（:348-360 整段占位符/`?` 展开论证）一并改写为「排除集合在 JS 侧按 Set 判定，不受 SQLITE_MAX_VARIABLE_NUMBER 约束、不得按批切分排除集合」。spec D13 措辞订正为「完成态入口探针同为全表谓词扫描（与解压任务同款先例，已知成本，快照短路留清理轮评估）」。
- 验收/测试：补「假阳性行满 501 条（跨过多页）时探针仍返 **false**」用例（分页 + Set 排除语义，防分批切排除集合的倒退）；保留「合法待迁行存在时 true」对照。
- 来源：review-b-migration round1

### c-task/B-1 [P2] 预算计量路径的异常未被驯服：裸 VfsError 逃逸 + findContentSize 无保护
- 维度：B
- 文件：packages/core/src/domain/chat/logic/scan-at-path-attachments.ts:126-137；packages/core/src/domain/tool/builtin/subagent-tool.ts:245
- 问题：①`/../x` 等在 attachFromPath 内抛 VfsError，task 层 catch 只认 AttachmentPathArgumentError → 模型拿裸 VfsError、无「fileAttachment 路径非法」引导；②estimateAttachmentChars 的 getContentSize 无 try/catch，`/template/...` 旧前缀在 assert 阶段抛 vfsInvalidPath 会掀翻整次派发（同仓 load-or-fill-file-cache.ts:181-186 先例是包住按可读处理）。
- 改法：①attachmentsFromPaths 内把 VfsError 一并包成 AttachmentPathArgumentError（保留原 message）；②estimateAttachmentChars 对 getContentSize 包 try/catch → 异常按 0 计，注释引 probeOversizePlaceholder 先例。
- 验收/测试：subagent-tool-session-file.test.ts 补「`/../evil` 路径 → ToolError 文案含 fileAttachment 引导」「getContentSize 抛错 → 附件照常挂载（按 0 字节计）」两用例。
- 来源：review-c-task round1

### c-task/B-2 [P2] 先建会话后物化：参数非法留下删不掉的空孤儿子会话
- 维度：B
- 文件：packages/core/src/domain/tool/builtin/subagent-tool.ts:418-421（createChildSession）vs :429-453（物化）
- 问题：fileAttachment 唯一硬错误（空串元素）在 createChildSession 之后抛 → 子会话已落库且零消息、模型拿不到 subagentSessionId、重试再堆一个空会话。
- 改法：fileAttachment 物化 + splitAttachmentsByBudget 整段**上移**到 requestedSessionId/createChildSession 判定之前（预算计量只依赖 subagent.getContentSize，不依赖 childSessionId，前移无副作用）。
- 验收/测试：补「空串 fileAttachment 元素 → ToolError 且 chat_session 不新增行」用例。
- 来源：review-c-task round1

### c-task/C-orch-1 [P2] prompt 纯空白时 append 跳过 → 已物化附件静默蒸发
- 维度：C-orch
- 文件：packages/core/src/service/agent/logic/run-agent-turn.ts:1237-1246（对照 subagent-tool.ts:341）
- 问题：append 守卫 `prompt.trim().length > 0` 而 schema `z.string().min(1)` 放行纯空白串（" "）→ 整条 user 消息不落库、预算内附件一并丢失，task 却「正常」返回，故障完全静默。
- 改法：append 条件放宽为「prompt 非空白 || attachments 非空」；或 prompt 判空时把 attachments 单独 append 一条 user 消息。
- 验收/测试：subagent-task-session-attach.test.ts 补「prompt=" " + 有效附件 → 附件仍落库」用例。
- 来源：review-c-task round1

### c-task/D-1 [P2] fileAttachment 绕过 A-14 路径白名单的 extractInputPaths
- 维度：D（登记/补口子）
- 文件：packages/core/src/domain/tool/logic/tool-path-policy.ts:17（对照 subagent-tool.ts:352-357）
- 问题：extractInputPaths 只抽顶层 path/filePath/from/to 字符串，fileAttachment 数组不进校验——当前无实际越权（session 作用域 vfs 收口），但「allowedPaths 一旦打开，task 附件面成为唯一不设防入口」。
- 改法：extractInputPaths 增加 fileAttachment: string[] 数组展开（一条 if，2 行）。
- 验收/测试：tool-path-policy 相关测试补「fileAttachment 路径参与 allowedPaths 校验」用例（若该文件有测试；无则补一条最小单测）。
- 来源：review-c-task round1

### c-task/C-1 [P2] run-agent-turn 手工编辑残留缩进/括号错位
- 维度：C
- 文件：packages/core/src/service/agent/logic/run-agent-turn.ts:1274-1287（1290-1340 五成员字段属「不动」区）
- 问题：createChildSession 闭包体重排后 publish 顶格、三级闭合各差两格、`return` 行残留错位——语法平衡但可读性差，需逐字符数括号才能确认字段没被误塞进闭包。
- 改法（round2 N-2 订正 + round3 R3-1 补 L1286，以实测列位为准）：`subagent: {` 在 6、成员在 8、`createChildSession` 体在 10。共修**五处**错位——`1280` publish 语句 0→**10**、`1281-1284` publish 属性 10→**12**、`1285` `});` 8→**10**、`1286` `return grandchild.id;` 8→**10**、`1287` 闭合 `},` 6→**8**；**parentSessionId/isSessionRunActive/getContentSize/resolveChildModelId/runChildAgent 五个成员字段现均已正确在 8，一律不动**（按 round1 旧改法会把它们反向改坏）。
- 验收/测试：typecheck 照旧全绿（纯格式）。
- 来源：review-c-task round1

### c-task/B-3 [P2] resolveResumeSessionId 无差别 catch 吞 DB 故障（主代理裁决自 c-task OQ1）
- 维度：B
- 文件：packages/core/src/domain/tool/builtin/subagent-tool.ts:172-181
- 问题：catch {} 把非 chatNotFound 的 DB 故障也吞成「找不到子会话（可能已被删除）去掉 sessionId 新开」——瞬时 DB 抖动误导模型新建重复子会话。
- 改法：收窄为仅 `chatNotFound`（按 err.code 或错误类型判别）转四态 not-exists 文案；其余 rethrow。
- 验收/测试：subagent-tool-session-file.test.ts 补「sessions.get 抛非 NOT_FOUND 错误 → ToolError 原样上抛、不新建会话」用例。
- 来源：review-c-task round1 OQ1 裁决升格（改法明确）

### a-unref/C-1 [P2] hydrate 测试头注释与实现的 memo 口径打架
- 维度：C（文档自洽；spec deviation Step3 收敛）
- 文件：packages/core/test/chat/hydrate-tool-results.test.ts:20（对照 src/domain/chat/logic/hydrate-tool-results-for-prompt.ts:60-72,116,165）
- 问题：测试头写「废除的旧口径：…调用内 memo 去重」，但实现保留了明文侧 plainByRefKey（模块 doc 论证过是有意设计）——三处口径打架，后人会照测试头删掉被刻意保留的缓存。
- 改法（主代理裁决：实现保留 + 补用例，spec 措辞按实现收敛；round2 P1-4 + R2 新-4 扩为**三处**——Step4 的「删 memo 用例」与变更点清单 L111 的「删三个 replay + memo + hash 比对」必须一并订正，否则下游照 spec 执行会把 G-4 刚补的用例再删掉）：测试头第 20 行改「废除的旧口径：wire 逐字节等值重放、hash fail-fast、wire 重放侧调用内 memo（wireByReplayKey）；明文侧去重（plainByRefKey）本版保留」；spec **三处**订正——Step3（:129）补「明文侧调用内 memo 保留（省同批重复解码）」、Step4（:130）的「删 … memo 用例」改「删 wire 重放侧 memo 用例（明文侧 memo 用例保留，见 e-tests/G-4）」、L111 的「删三个 replay + memo + hash 比对」改「删三个 replay + wire 重放侧 memo + hash 比对（明文侧 memo 保留）」。
- 验收/测试：见 e-tests/G-4（补 memo 用例，两者配套）；另加一条——grep spec.md 确认已无与 G-4 冲突的「删 memo」表述（Step4 与 L111 两处都查）。
- 来源：review-a-unref round1 + e-tests/G-4 联合裁决

### a-unref/C-2 [P2] parse-message-content 注释漂移（相邻文件，主代理划入 a 线收口）
- 维度：C
- 文件：packages/core/src/domain/chat/content/parse-message-content.ts:119-120,146
- 问题：注释仍用「重放不出附属文件尾注（wire 逐字节失真）」「按 read 白名单重放 skill ref」描述已不存在的 wire 重放不变量——后人照此摘白名单会踩 spec 风险 5 红线。
- 改法：119-120 改为「否则 read 白名单会静默吞掉 skill ref 的 action/domain/name/files；过渡期兜底 hydrate 只按 (entryId,version) 取明文、不消费这些派生字段，但字段被吞会让白名单语义失真、清理轮无从复原」；146 行「重放」→「解析」。
- 验收/测试：注释纯改，人工过目。
- 来源：review-a-unref round1

### a-unref/C-3 [P2] 行尾换行补齐（round2 P2-1 扩范围：实测本迭代触碰文件有 16 个缺尾换行，非「其余文件均带」）
- 维度：C
- 文件：本迭代 fe79b781..ad1d5ed6 触碰过的全部 `.ts/.tsx` 文件中缺行尾换行者（实测 **15** 个，R2 新-6 订正计数——含 read-ref-prompt-parity.test.ts、read-tool-result-ref.test.ts、message-ref-unref.test.ts、message-ref-unref.ts、subagent-tool-session-file.test.ts、read-ref-count.test.ts、subagent-task-session-attach.test.ts、desktop/mobile 各 2 个 service 等；以 `git diff --name-only fe79b781..HEAD` 结果逐一检查末字节为准）
- 改法：对上述清单全量补行尾换行（**不要**按「仓内其余文件均带」的旧前提只补两个——该前提与实测不符）。
- 验收/测试：扫描脚本确认清单内文件末字节均为 `\n`；git diff 仅 +\n 行。
- 来源：review-a-unref round1 + spec-check R1 P2-1 订正

### d-s0/G-1 [P2] 三处消费方双字段接线无测试锁死
- 维度：G/C-orch
- 文件：packages/core/src/service/agent/impl/agent-runner.ts:457-458；apps/desktop/src/main/services/session-prompt-input.service.ts:122-124；apps/mobile/src/services/session-prompt-input.service.ts:142-144
- 问题：接线正确但零断言——删掉 `workplaceSeenPaths: visiblePaths` 全部照绿，workplaceSeen 静默回落 seenPaths（只含 full），G6 修的洞以静默倒退回归。
- 改法（round2 P1-3 订正方案为**不 mock、行为断言**；R2 新-7 订正落点：**直接在既有 `apps/mobile/__tests__/session-prompt-input.service.test.ts` 追加一条用例**——该文件的 runtime stub 本就支持 workplaceFiles 让 assemble 真跑（文件头声明「不整体 mock、真跑分段逻辑」），追加用例复用既有 harness 最省；「必须新文件」的旧理由随 mock 方案作废。若追加用例与既有 7 条用例的 stub 形态冲突，再退回新建文件并注明隔离理由）：追加用例——stub runtime 里 `evaluateRuleView` 产出 full 档与 header 档文件各一，`listBySession` 返回带「workplace 附件（header 文件）」与「attach 附件（header 文件）」的用户消息，断言 ① workplace 附件被省略（`content === ""`，证明 workplaceSeenPaths 已接线）且 ② attach 附件拿到全文（证明 seenPaths 只吃 full 档）。删掉任一接线字段，两断言之一必红。（与 e-tests/G-1 的 core 端规则引擎串联互补：G-1 钉「规则引擎→assemble→prepare」，本条钉「三端装配点→runtime 双字段」。）
- 验收/测试：本条即测试；删任一字段跑该用例必红；不动既有用例的结构与断言。
- 来源：review-d-s0 round1

### d-s0/G-2 [P2] T-WP-VP1 用例标题声称覆盖两处早退、实际只走一处
- 维度：G
- 文件：packages/core/test/workplace/assemble-workplace-display.test.ts:531-554
- 问题：早退② 因空数组快照被 loadOrCreateRuleSnapshot 视为未就绪而实际走正常装配；`visiblePaths` 必填字段漏补由全仓 typecheck 拦截，单测在此冗余且标题骗人。
- 改法（采 review 推荐①）：标题降级为「早退①：无 workplace 块时补齐 visiblePaths: []」，删除早退②段与退化断言（恒等式钉不住任何行为）。
- 验收/测试：用例改后仍绿；标题与断言一致。
- 来源：review-d-s0 round1

### e-tests/G-2 [P2] VfsContentSize→预算口径映射闭包零覆盖
- 维度：G
- 文件：packages/core/test/tool/subagent-tool-session-file.test.ts:552-583（对照 run-agent-turn.ts:1295-1303）
- 问题：所有预算用例喂映射后形态——映射写反（inlineChars 当 blob ×4）全部照绿；集成用例夹具太小测不出。
- 改法（round2 P1-2 订正：写侧**永远不产 inline 行**——insert/update 恒 `content=NULL`+content_hash，`findContentSizeByPath` 见 hash 即返 blob 档；「真写文件造 inlineChars」走不通，且「夹具换 30KB+ 文本断言仍挂附件」在映射翻转时 blob 按原样计更小、同样挂附件——牙齿不存在，原②作废）：用**裸 SQL 造遗留 inline 行**——真写文件后 `UPDATE vfs_entry SET content = <30KB 明文>, content_hash = NULL WHERE path = ?`，再走真 `findContentSize` 得 `inlineChars` 30_000 → 经 run-agent-turn:1295-1303 映射为 inline 档计 30_000 ≤ 100_000 → 断言挂附件；**翻转映射实现（inline 当 blob ×4 = 120_000 > 100_000）该用例必红**（自验牙齿）。
- 验收/测试：本条即测试；翻转映射跑该用例必红。
- 来源：review-e-tests round1

### e-tests/G-3 [P2] T-UA4c 名实不符 + blob 抛错真路径零测试
- 维度：G
- 文件：packages/core/test/chat/hydrate-tool-results.test.ts:384-417（对照 hydrate 实现 catch 分支、sqlite-vfs-content-store.ts:97-99）
- 问题：T-UA4c 标题「blob 缺失」实际测的是「元数据命中但 find 返 null」分支；真实「blob 被清理」走 contentStore.get 抛错 → hydrate catch → 占位文案「读取 revision 失败：vfs_content_blob 缺失」——这条真路径无测试；`revision.content == null` 在生产仓储下不可达（防御分支）。
- 改法：T-UA4c 改名对齐实际分支并注明「防御分支：生产仓储下不可达，防未来仓储变更」；新增真路径用例：真写文件 → `DELETE FROM vfs_content_blob WHERE content_hash=?` + clearDecodedContentCaches() → 断言**占位自包含**（匹配 /取不回/ 与 /本次装配中不可用/——占位文案按 G-4 终稿，成因不进占位）且 **warn 留痕**（/读取 revision 失败/ + /vfs_content_blob/）、hydrate 不抛错（impl-B 落地订正：实现里 reason 只进 warn，占位走通用文案——与 G-4 钦定文案一致，原「占位 error 匹配 /读取 revision 失败/」口径不可达）。
- 验收/测试：本条即测试。
- 来源：review-e-tests round1

### e-tests/G-4 [P2] HydrateMemo 有实现、无用例（与 a-unref/C-1 配套）
- 维度：G
- 文件：packages/core/test/chat/hydrate-tool-results.test.ts；**packages/core/src/domain/chat/logic/hydrate-tool-results-for-prompt.ts:168-176（round2 P2-6 补：占位文案必改，实现文件入清单）**
- 问题：Step4 删了 memo 用例但实现保留 plainByRefKey——删 memo 或改键任何测试不红。且现占位文案「(entryId=…, version=…) 的明文取不回，见上方 warn」对 memo 命中 null 的第二个块是悬空引用（warn 可能属另一消息/另一 path）。
- 改法：①补 3 行用例：一条消息两个块引用同一 (entryId,version)，断言 findMetaByEntryAndVersion 只被调 1 次；②**确定动作**（原条件句落地）：占位文案改为自包含——`(entryId=X, version=Y) 的明文取不回：该 revision 的正文在本次装配中不可用`，不再引用「上方 warn」（主代理裁决 a-unref OQ1 并入此条）。
- 验收/测试：本条即测试；grep 实现确认「见上方 warn」字样已移除。
- 来源：review-e-tests round1 + a-unref OQ1 裁决并入 + spec-check R1 P2-6

### e-tests/G-5 [P2] connWithFailingRefDelta 对象展开丢原型方法
- 维度：G（mock 质量）
- 文件：packages/core/test/infra/message-ref-unref.test.ts:458-500
- 问题：`{...base}`/`{...tx}` 展开类实例丢原型方法，现靠「恰好只用 execute」侥幸绿；将来 −1 路径加前置查询即以 `tx.query is not a function` 崩掉而非可读断言失败。同批 subagent-task-session-attach.test.ts:374 已有 Proxy 先例并注明 RULE。`restore: () => undefined` 为死代码。
- 改法：内层改 Proxy 转发（同 subagent-task-session-attach 先例）或补齐 tx 全部 5 方法；删 restore 或 finally 真调。
- 验收/测试：现有用例照绿；mock 结构与被测接口方法集对齐。
- 来源：review-e-tests round1

### e-tests/G-6 [P2] 三处边界未钉死：恰好 20 条 / blob×4 恰等预算 / claim 败方文案
- 维度：G
- 文件：packages/core/test/tool/subagent-tool-session-file.test.ts（补 2 例）；packages/core/test/service/agent/subagent-task-session-attach.test.ts:288-319（补断言）
- 改法：①补 T-TA3a2：恰好 20 条 → atts.length===20 且 prompt 无尾注（若实现误写 `<=` 判定，23 条那条不红、这条红）；②T-TA3c 补对照：{kind:"blob", size:25_000} → 恰等 100_000 预算 → 断言挂附件（实现 `usedChars+chars<=BUDGET` 应进）；③T-TS3 补：败方 tool_result content 匹配 /去掉 sessionId/ 且 block.ok===false。
- 验收/测试：本条即测试。
- 来源：review-e-tests round1

### e-tests/G-7 [P2] mobile chips 测试白盒耦合（children 下标穿透 + 函数名匹配）
- 维度：G
- 文件：apps/mobile/__tests__/task-file-attachment-chips.test.ts:79-89,116-139
- 问题：`section.props.children[1]`/`chip.props.children[0]` 下标穿透内部结构、`pickAttachGroup` 按函数名 'AttachGroup' 匹配 vnode type（压缩/匿名化即失效）——不会假绿但红得莫名其妙。
- 改法：renderChipLabels 断言改用递归 collectText 取文本（第四用例同款）或集合语义 toContain；pickAttachGroup 注释锁定耦合点。
- 验收/测试：本条即测试；重构 CollapsibleSection children 形状不误红。
- 来源：review-e-tests round1

### e-tests/G-8 [P2] T-UM5 探针「1 条 failedIds」档位缺失（spec deviation D-1 收口）
- 维度：G
- 文件：packages/core/test/infra/message-ref-unref.test.ts:717-796
- 问题：标题「三档：0/1/2」实际只跑 0 与 2。
- 改法：补 1 条档用例——谓词候选里**只剩该 1 条假阳性行**（failedIds 含它）时探针返 **false**（排除集合完整、**不切分**——与 C-01 的分页+Set 语义对齐；R2 新-8 订正旧「单批内命中即 true」措辞，那是已废弃的分批方案的语义）。
- 验收/测试：本条即测试。
- 来源：review-e-tests round1（spec deviation D-1 并入）

### f-doc/A-3 [P2] 「可复用已有子会话」未限定作用域（已并入 A-1 终稿，措辞以终稿为准）
- 维度：A
- 文件：CHANGELOG.md:12
- 改法：按 A-1 终稿落笔——「可在同一个对话内复用此前的子会话继续任务」（D2 只允许直接父会话的子会话）。
- 验收/测试：与 subagent-tool 四态实现对照；终稿内该句与 A-3 措辞逐字一致。
- 来源：review-f-apps-doc round1

### f-doc/A-4 [P2]（主代理裁决改写）RULE.md 术语更新已在主仓工作区完成、未随分支提交
- 维度：A（spec Step13 交付项核查）
- 文件：D:\Dev\Js\novel-master\docs\apm\RULE.md（主仓，非 worktree）
- 问题（裁决后）：子代理在 worktree 看到的 RULE.md 仍是 v1.5.29 正形态——但主代理已于本迭代在**主仓工作区**完成三处更新（read/skill 引用化→已回退历史概念；子会话→task 双参数；workplace→S0 双读），docs/apm 属主仓维护面不随 feat 分支走。风险点：发版提交若遗漏，main 上口径与实现相反。
- 改法：发版收尾步骤（K 节）固定一条「主仓 docs/apm/RULE.md 三处术语更新随发版提交」；本次 CR 不改 worktree 文件。
- 验收/测试：发版 diff 里包含 RULE.md 修改。
- 来源：review-f-apps-doc round1（A-4 原报「未执行」，主代理裁决为「已执行未提交+发版时随附」）

### f-doc/C-1 [P2] revisionRepo 注释漂移 6 处（「推导 read +1 通道」已失效）
- 维度：C
- 文件：apps/cli/src/runtime.ts:161-164,252-253；apps/desktop/src/main/runtime/types.ts:108-109；apps/desktop/src/main/runtime/create-desktop-runtime.ts:146-147；apps/mobile/src/runtime/types.ts:102-103；apps/mobile/src/runtime/create-mobile-runtime.ts:119-120
- 问题：注释仍说 revisionRepo「推导 read +1 通道并透传 prepare hydrate」——通道已摘除，误导后人接回 +1。
- 改法：统一改「存量 contentRef 行的兜底 hydrate 取数用（回迁完成前保留，回迁后无生产消费方）」。
- 验收/测试：注释纯改。
- 来源：review-f-apps-doc round1

### f-doc/K-1 [P2] mobile session-prompt-input.service 的 __DEV__ console.log 残留
- 维度：K（收尾时二选一）
- 文件：apps/mobile/src/services/session-prompt-input.service.ts:88,101,136,157,168
- 改法：删除，或文件头登记为长期诊断日志（确认 L70 诊断说明是否覆盖）。
- 验收/测试：format:check 照绿。
- 来源：review-f-apps-doc round1

### f-doc/K-2 [P2] getMessageRefUnrefStatus 无生产消费方（清理轮拍板项）
- 维度：K
- 文件：packages/core/src/index.ts:100-106（含 allowlist 快照）
- 问题：导出仅测试消费（D14 选静默无状态行）；status.done 口径与 marker 置位存在「假阳性行永留谓词 → pendingCount 恒 >0」的埋坑。
- 改法：本版保留（KKV 常量确有清理轮立账用途）；清理轮拍板移出主入口或接 UI；顺手把 getMessageRefUnrefStatus 的 done 判据改「marker 已置即 done」（一行，消除口径矛盾——若拍板保留函数则改，移出则不改）。
- 验收/测试：无（登记项）。
- 来源：review-f-apps-doc round1 + b-migration OQ3/OQ4 合并

### f-doc/A-5 [P2]（round2 N-4 新增）spec T-UM7 的 mobile 侧观测口径订正
- 维度：A（spec 措辞收口；spec deviation T-UM7 承载条目）
- 文件：docs/Iterations/task-attach-unref/spec.md（T-UM7 行）；apps/mobile/__tests__/message-ref-unref.service.test.ts:122,141（对照）
- 问题：T-UM7 对 mobile 侧的期望含「标记未置」观测，但 mobile 测试是 jest.mock 整体替换的全 mock 版式（:17-21），结构性无从查 KKV——spec 期望与 mobile 可观测面不匹配，且该 deviation 此前无任何承载条目。
- 改法：spec T-UM7 措辞订正为「mobile 侧观测限定为服务层白盒断言 deferred/stalled 分支收手；KKV 标记观测只在 core 侧真库用例」。
- 验收/测试：对照 mobile 测试 :122/:141 两条用例（warn 文案断言在位即可）。
- 来源：review-full round2（N-4）

---

## Spec deviations
- D15 第三子句（delta<0 命中记 warn）→ **已写入 fix-spec（b-migration/B-01，round3 已按 N-1 订正判据为「−1 之前前值/未命中」），待执行后转 fixed**
- Step3 memo 措辞（删调用内 memo vs 实现保留明文侧）→ **裁决：实现自洽保留 + 补用例（e-tests/G-4）+ spec 措辞订正一句（a-unref/C-1 内含）→ fixed**
- D13 代价登记口径 → **措辞订正入 fix-spec（b-migration/C-01 内含）→ fixed**
- spec T-UM5「0/1/2 档」→ **补 1 条档用例（e-tests/G-8）→ fixed**
- spec T-UM7 mobile 侧无标记观测 → **承载条目已补（f-doc/A-5，round3）→ fixed**
- spec Step13 RULE.md → **裁决：主仓工作区已执行，发版时随附提交（f-doc/A-4）→ fixed**
- spec 风险8 CHANGELOG 披露 → **已写入 fix-spec（f-doc/H-1）→ fixed**
- 其余（D1-D14/D16-D19/G5/G6/Step 其余）：none

## Open questions / 待拍板（不阻塞）
1. D13 完成态探针的快照短路（marker 存行数，行数不变跳过 LIKE）——与解压任务同款先例，留清理轮统一评估。
2. 回迁无用户中断入口（与兄弟任务一致）——确认「不可手动停」是有意为之即可。
3. v1.529 +1 按块 vs 回迁 −1 按消息的不对称——刻意决策（T-UM2 钉死），建议 CHANGELOG/文件头写实「历史遗留溢出按泄漏计、由 repair 报告不自动修」。
4. c-task：getContentSize 在 claim 前的败方浪费（D5 只钉不留孤儿，达标）——接受或后续加 prepare 钩子。
5. c-task：getContentSize optional 的三处口径（测试 convenience）——未来新装配点忘注入会静默退化，可在 builtin-tool-context 注释登记。
6. d-s0：header 档「前缀省略+attach 全文」组合的 UI 提示（产品面）。
7. d-s0：filename 档在 workplace-materialize-engine 是死分支——visiblePaths JSDoc 补一句说明。
8. a-unref：parity fixture totalBytes 30→33（纯装饰噪音）、read-ref-production-smoke 改名 read-fulltext-production-smoke（清理轮立账）。
9. e-tests：三红归属静态核验成立（usage-stats 时区×2 + mermaid×1，与本 diff 18 个测试文件零交集）——verify 阶段实跑复证红测名称。
10. f：CLI 内联 await 措辞（「后台」字样）——H-1 披露句已含「下次启动继续」，可不动。
11. f：desktop 无子会话界面——第二条「（双端）」是否加「子代理对话界面目前仅移动端可见」注（建议加，发版前拍板）。

## 已豁免（用户确认不修）
- 无。

## 合并后 QA（manual_user）
- 真机升级路径实测：v1.5.29 库 → 本版，回迁一轮跑完、复制/搜索恢复正常（Step 15 原有项）。
- 存储膨胀对比与子会话 read 次数下降的体感观察。

## 执行补记（dev-fix wave，2026-10-02）
- **e-tests/G-7 已补执行**（cr-func 抓出 wave-0 漏派）：renderChipLabels 改 collectText 递归收集（消 chip 内 `children[0]` 下标穿透）、断言改 toContain 集合语义（chip 全文含徽标 `@path文件`）、CollapsibleSection `[1]` 下标与 pickAttachGroup 函数名匹配各加耦合点注释；4/4 绿。
- **B-01「行缺失」档注记**：`prev === undefined` 分支为 resolve 成功后、同 tx SELECT 前行被并发删除的**竞态窗防御**（resolve 与 warn SELECT 同查 vfs_revision，正向构造互斥不可达）——实现处已补防御注释登记；可构造面（前值不足 / badBlock 跳过 / 前值充足）三档测试覆盖在案。
- **cr-func nit 四处已修**：repository.ts 与 message-ref-unref.ts 两处顶格注释缩进、create-desktop/mobile-runtime 注释首句重复。
- **verify-apps 范围外发现（登记不修）**：`apps/desktop/scripts/run-tests.mjs` 的单引号 glob 在 Windows cmd 下不展开 → `npm test` 静默跑 0 条假绿（exit 0、tests 0）——Windows 上验 desktop 须用双引号等价跑法；建议单独立项修复。

## K 节建议（下游执行时闭合）
- f-doc/K-1（console.log 二选一）、f-doc/K-2（status 导出拍板）、A-4（发版随附主仓 RULE.md 提交）。
- 全量 format/lint 一轮（core 无 prettier 门禁，mobile format:check 覆盖 core 之外的面）。
- **U+FFFD 字符损坏立账（cr-func 发现，登记不修）**：`packages/core/test/chat/read-ref-parity.test.ts` 含 732 处 U+FFFD（ac0a3269 Step4 引入，base 为 0）——需按语义恢复中文注释；`apps/mobile/src/services/session-prompt-input.service.ts` 含 178 处（fe79b781 base 即有、主仓同款，非本迭代引入）。清理轮参照 fc6c49b0 修 .gitignore 历史乱码的先例处理。

## Fix-Spec Closure
| 项 | 状态 |
|---|---|
| fix-spec-ready / execute-ready | **yes**（CR 3 轮 + spec-check 2 轮收敛；R2 复审结论 Go，12 项修复全核验、新-1..新-9 已全部订正入条目） |
| fix_spec_path | docs/Iterations/task-attach-unref/cr-fix-spec.md |
| dag_version / review_round | 6 / 6（CR 3 + spec-check 2 + doc-fix 轮计） |
| P0 / P1 / P2（已写入） | 0 / 6 / 27（合计 33） |
| 未写入的开放 must-fix | 0 |
| spec_deviations | 7 条实质 deviation 全部对应 fix-spec 条目或裁决（D15/T-UM7 待执行转 fixed，其余 fixed；catch-all none） |
| C-orch | 已查（c-task C-orch-1、b-migration C-01、三端 parity 面；review-full 跨面契约抽查全过） |
| C 类合并后 QA | 见上 |
