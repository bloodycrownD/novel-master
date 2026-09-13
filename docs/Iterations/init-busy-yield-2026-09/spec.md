---
date: 2026-09-13
---

# 初始化长任务分片让步（init-busy-yield-2026-09）技术规格（SPEC）

## 设计目标

需求来源：`docs/Iterations/init-busy-yield-2026-09/prd.md`（含四大长任务源与 GWT-1~7 验收）。本 spec 将其落为可实施方案：通用让步原语、水合/启动链分片、backfill 低成本判定、快照链路分片化（RN 构建 O(n²) 消除 + 分片协议 + web 窗口化）、通知忙期优先。

## 总体方案

五条独立工作流，按依赖顺序实施：

1. **让步原语**（一切分片的地基）：复刻 TDBC 已验证的「16ms 时间量子 + setTimeout(0)」模式（`packages/tdbc-driver-op-sqlite/src/connection.ts:246-267` 同款），封装为可注入函数。**不用 InteractionManager**（RN 0.85 新架构下交互信号语义弱化、全库零使用、fake timers 下挂死）。
2. **水合与启动链分片**：manager `hydrate()` 逐行循环按量子让步（保持「markHydrated 前投影恒 null」的全有或全无语义）；idle tail 加载改单查询多取一条判定 hasMore（`listBySessionTail(limit: 页大小 + 1)`，一次往返天然消除第二次探针查询，beforeSeq 语义不变）；ChatTab 首屏串行查询（`reloadLists` 三段、`refreshChatMeta` 三段+双触发）并行化/去重。
3. **backfill 低成本判定**（core）：发送链路上两段式判定「无空窗」短路——第一段 O(1) 计数比对（`countBySession` ≤ 游标直接短路），第二段对游标边界之后的新增段做 O(新增段) 有界覆盖比对（覆盖口径与空窗语义等价：段内每条消息含 assistant 均有 checkpoint；组合闲置原语 `hasAnyCheckpointForSession` / `countBySession`）；判定不确定时**保守回退全量扫描**（回滚保证宁误报勿漏报）；`session_kkv` 挂扫描游标消除常态扫描，truncate 时清游标（seq 复用坑）。
4. **快照链路分片**：
   - RN 侧：`buildChatListItems` 消 O(n²)（预扫一次构建 toolUseId→result map + lastIncompleteToolAssistant，循环内只读）；`buildTranscriptRows`/`enrichTranscriptRows` 按行分片构建；发送侧按片序列化。
   - bridge 协议：`sessionSnapshot` 增分片元数据（**generation 代次 + chunkIndex/chunkTotal**）；force 直发 = 新代次整包（作废在途旧片）；web 侧丢弃未知代次分片——appendTailRows 无去重的叠加坑由代次机制封死。
   - web 侧：`RowList` 窗口化（可见窗口 + 上下占位，Preact 内实现，避免「分批手动 insert 被下次全量 renderRows 洗掉」）；分片期间的滚动副作用（stick 判定/scrollSnapshot 回发）聚合到末片。
5. **通知忙期优先**：keepalive 通知「先出后补标签」——受理后不等会话名/项目名查询，默认文案立即 display，标签查回后同 id 重发刷新（notifee 原位刷新机制现成）；两个标签查询并行化。

## 最终项目结构

```
apps/mobile/src/services/yield-quantum.ts                    [新增] 让步原语（量子化 setTimeout，可注入）
apps/mobile/src/services/session-stream-unit-manager.service.ts [改] 水合分片、idle 探针并行
apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts      [改] reloadLists/refreshChatMeta 并行化
apps/mobile/src/screens/tabs/chat-tab/ChatTabProvider.tsx     [改] 首屏 effect 双触发去重
apps/mobile/src/components/chat/message-blocks.ts             [改] O(n²) 消除（预扫 map）
apps/mobile/src/components/chat/ChatTranscriptBridge.ts       [改] 分片协议类型
apps/mobile/src/components/chat/ChatTranscriptWebView.tsx     [改] 分片构建/发送、generation、force 路径适配
apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts       [改] 分片分发
apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts [改] 分片应用、滚动副作用聚合
apps/mobile/src/web/chat-transcript/webview/ui/render/RowList.tsx   [改] 窗口化
packages/core/src/domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts [改] O(1) 判定 + 游标
packages/core/src/domain/message-checkpoint/logic/truncate-tail-in-transaction.ts [改] 清游标
packages/core/src/domain/session-kkv/model/session-kkv-domains.ts  [改] 新游标域常量
packages/core/src/service/message-checkpoint/impl/message-checkpoint.service.ts [改] 判定先行
apps/mobile/src/screens/tabs/chat-tab/ChatSessionListPanel.tsx [改] 「活跃中」→「已中断」文案
apps/mobile/__tests__/yield-quantum.test.ts 等               [新增/改] 各工作流测试
```

## 变更点清单

（对应上方结构，逐文件改动点在「详细实现步骤」展开；core 侧改动三端共用，core 测试即回归门禁，desktop 对本次触达的 mobile 侧模块零引用。）

## 详细实现步骤

- Step 1 — phase-yield-primitive — blocking: yes — qa: auto：新增 `yield-quantum.ts`——`createQuantumYield(intervalMs=16)` 返回 `() => Promise<void>` 零参让步函数：内部自记 lastYieldAt（同 TDBC connection.ts:259-263 模式），跨量子窗才 `await setTimeout(0)`，调用方零参使用；测试经构造参数注入同步 mock（使用方构造函数收 yield 依赖、测试传同步 resolve 的 mock，见 Step 2 的 manager 注入，fake timers 下无需真实定时器）；单测覆盖量子行为与注入 mock（同步 resolve）。
- Step 2 — phase-hydrate-yield — blocking: yes — qa: auto：`hydrate()` activeRows 逐行循环与 settledRows 循环插量子让步；每个让步点后复查 `disposed`（现仅 1 处，service:501）；**保持全有或全无**（markHydrated 时机不变）；manager 构造参数注入 yield（缺省量子实现）；五套件 fake-timers 适配（harness 注入同步 mock，persist 套件 13+ 处 `await hydrate()` 不动断言）；`loadIdleTailMessages` 改单查询判定 hasMore——tail 查询一次取 `limit: SESSION_STREAM_MESSAGES_PAGE_SIZE + 1`，返回行数超过页大小即 hasMore=true 并**裁去多取的最旧一行**（`listBySessionTail` 返回 seq 升序、最旧在前（sqlite-message.repository.ts:172-181 外层 `ORDER BY seq ASC`），多取的一行在数组**头部**即 `list[0]`，不是末行）（一次往返消除原第二次探针查询；原探针的 `beforeSeq` 取自 tail 首行 seq、依赖前一次查询结果，`Promise.all` 照字面不可行，故不并行而改单查询多取，beforeSeq 语义不变）；「结果只落属主视图」语义守卫不变；受影响断言随实现同步：messages.test:320-322 的 `limit: SESSION_STREAM_MESSAGES_PAGE_SIZE` 更新为 `+1` 口径（292-296 同款断言一并同步），hasMore/缓存/属主语义断言不动。
- Step 3 — phase-chattab-queries — blocking: no — qa: auto：`reloadLists` 三段串行（projects.list/get + sessions.listByProject）与 `refreshChatMeta` 内部三段（resolveAgent/getSessionConfig/resolveModelLabel）并行化（无依赖部分 Promise.all）；首屏 `refreshChatMeta` 双触发去重。
- Step 4 — phase-core-backfill — blocking: yes — qa: auto：`backfillBaselineCheckpoints` 入口做**两段式判定**（升级依据，代码核实三点：其一，空窗语义含 assistant——backfill-baseline-checkpoints.ts:36 `listBySession` 取全量消息不分 role，:41-50 倒序找最后一个有 checkpoint 的消息，:62-69 对其后**每条消息（含 assistant 与 tool-result user）**逐条 `insertCheckpoint`，insertCheckpoint 实现（sqlite-message-checkpoint.repository.ts:111 起）按 session_id+message_id 直插、无 role 过滤；其二，源头建点覆盖面——发送链仅 user 建点（run-agent-turn.ts:435 append → :443-447 注释「每条新 user 消息都写 baseline」→ :466 capture 锚定该 append），mutating 工具轮的含 tool_use assistant 在工具结果落库前补一次 capture（agent-runner.ts:711-722，仅 vfsMutated 触发），**纯文本轮尾部 assistant 与 tool-result user（agent-runner.ts:739 append）无源头建点**，须靠下一次 backfill 补齐；其三，时序——backfill（run-agent-turn.ts:328）先于本轮 user append（:435）执行，连续对话每轮 run 开头 count 恒大于上次确认总数，单层「count ≤ 游标」在正常发送场景必然失效、GWT-4 无达成路径，故升级两段式）：第一段 O(1)——读游标（session_kkv 新域），`countBySession(sessionId)` ≤ 游标值（当前消息总数未超过上次扫描确认无空窗时的总数）则短路 no-op；第二段 O(新增段)——count > 游标时有界圈段：按 seq 升序取游标行数之后的消息为新增段（`WHERE session_id=? ORDER BY seq LIMIT -1 OFFSET <游标>`，连续对话通常 2 条），段内做 checkpoint 覆盖比对（段内消息数 vs 段内 checkpoint 行数，一条 `message_id IN (...)` 计数查询），**覆盖口径与现状空窗语义严格等价：新增段每条消息（含 assistant）均有 checkpoint**——比对相等 → 短路 no-op 且游标前移至 count；不等（典型：上一轮纯文本对话尾部 assistant / tool-result user 尚无 checkpoint，属真实空窗、本就该补）→ 回退现全量逻辑（回退路径行为即现状），全量补点后游标补写至新 count。原语用途：`hasAnyCheckpointForSession`（sqlite-message-checkpoint.repository.ts:99-109，现成闲置）承担两处守卫——游标缺失时的首扫前置（会话无任何 checkpoint 即无短路资格，直接走全量）与游标存在时的矛盾检测（游标 > 0 意味上次确认过无空窗、会话必有点，hasAny=false 即游标不可信，走全量）；`findCheckpointMessageIdAtOrBefore` 经核实第二层判定用不上（段内覆盖计数比对无需定位「最近有 checkpoint 的消息」），从组合清单移除、不留无用途原语（其既有调用方 resolve-target-tree.ts:26/48 不动）。undo_send 回滚保证不削弱：第二层判定只可能比现状更严——游标前段由上次全量扫描确认无空窗、新增段经机器验证与空窗语义等价，任何不确定（游标缺失、矛盾态、段内缺口）一律回退全量；「短路且前移游标」与「跑一遍全量 backfill 后前移」落点一致，undo_send 可用的回滚点集合不变。判定与游标读写均在 backfill 既有 `conn.transaction` 内执行（message-checkpoint.service.ts 的事务包裹不动，游标经事务内以 tx 构造的 `SqliteSessionKkvRepository`——实现 `SessionKkvRepository` 端口——绑定事务）；写通游标——游标 schema：域常量按现有模式新增 `SESSION_KKV_DOMAIN_BACKFILL_CURSOR`（落 session-kkv-domains.ts，形如 `SESSION_KKV_DOMAIN_FILE_CACHE = "file_cache"`），key 用会话内固定键（如 `lastScannedCount`），值存「上次扫描确认无空窗时的消息总数」，判定用计数口径（`countBySession` 原语现成，sqlite-message.repository.ts:153-162）而非 maxSeq；会话删除路径游标随 session_kkv 级联清理（session.service.ts 的 deleteSessionTree 经 `clearSession` 清该会话全部 kkv），残留游标仅导致一次保守回退（判定不确定→走全量扫描并补写游标），无正确性影响；`truncate-tail-in-transaction.ts` 清该会话游标（seq 复用防线）；integrity-repair 的 detect op 同步换判定；**T-DS4a-d 语义测试全部保持**（判定路径与回退路径都要过）、T-DS5 调用契约不动；新增游标×truncate 交互测试与 T-B5（连续对话第二轮 run 两段式短路）。core 全量测试回归（三端共用）。
- Step 5 — phase-rows-on2 — blocking: yes — qa: auto：`message-blocks.ts` 预扫改造——`buildChatListItems` 开头一次构建 `toolResultByUseId` map 与 `lastIncompleteToolAssistant`，循环内 `resolveUnpairedToolStatus`/`isTurnToolExecuting`/`turnToolResultsComplete` 改读预扫结果（函数签名内部化，导出面不动）；`build-transcript-rows.test.ts` 全量语义等价守护；新增长列表（500+ 消息密集 tool）构建的对照测试（新实现 vs 旧实现输出全等）。
- Step 6 — phase-snapshot-chunk-rn — blocking: yes — qa: auto：`sendSessionSnapshotNow` 分片化——起点固定 messages/options 快照，预扫全局状态后按行分片构建+enrich+逐片编码 post（片大小常量化，如 50 行）；`sessionSnapshot` 载荷扩展 `{generation, chunkIndex, chunkTotal}`（单片时 chunkTotal=1 等价旧行为）；分片载荷字段分布约定——`sessionKey`/`hasMore`/`generating` 每片重复携带（任意片到达即可用，web 侧不依赖拼装完成即可读快照级标量）、`rows` 每片独立（只含本片行）、`scrollIntent`/`restoreScroll` 仅末片（chunkIndex=chunkTotal-1）携带（与 T-S4 滚动副作用聚合到末片的口径一致）；generation 单调递增，force 直发与新快照均开新代次，**在途旧代次作废**；6 条 force/直发路径（needsOpenSnapshot/pendingSubagentSessions/needsFullSnapshot/adapter forceSnapshot/flushPendingSnapshot/defer 到期）逐一适配「作废在途分片」；`syncStreamToolInvoking()` 的调用时机=分片全部发完后（末片 post 之后）统一执行一次，保持「工具调用条与快照末态一致」的既有时序语义；repaintEpoch 重挂时分片序列复位（postToWeb 增 ready 守卫或发送前校验代次）；`T-ST1` 断言重定义为「分片序列完整有序且全部先于后续 delta」；T-REPAINT/T-SUB-CARD 红线保持。
- Step 7 — phase-snapshot-chunk-web — blocking: yes — qa: auto：web 侧 `bridge.ts` 分发新载荷：同代次按 chunkIndex 顺序拼装（乱序/未知代次丢弃，等重传语义=force 新代次）；`snapshot.ts` 分片应用期间抑制 stick/emitScrollSnapshot（聚合到 chunkTotal 最后一片）；`RowList.tsx` 窗口化（可见窗口 + 上下占位 div，滚动边界扩充；占位高度按「已渲染行实测平均高度 × 未渲染行数」估算，prependPage 后按 scrollHeight 差值对占位高度校正一次，读位锚定复用 `snapshot.ts` 既有 prepend 补偿逻辑——scrollTop 累加 scrollHeight 差值；es2018/禁 lookbehind 约束遵守，禁 requestIdleCallback）；web jest 直测（fake DOM 行为级，照 `rows-click-anchor.test.ts` 先例）覆盖窗口化与分片拼装；`npm run build:webview` 产物链验证。
- Step 8 — phase-notify-priority — blocking: no — qa: auto：`startKeepAliveFor` 改两段式**调用时序**——受理后先无标签调 `startAgentKeepAliveService(sessionId)`（默认文案沿用 `buildKeepAliveContent` 现有默认文案「正在生成」（agent-finished-notification.ts:351-352），立即 display，不等标签查询，函数复用不动）；随后会话名/项目名两查询 `Promise.all` 并行，查回后带标签再调同一函数，经既有 labelsVersion → `reconcileKeepAlive`「同 id 原位刷新」机制刷新文案（`agent-finished-notification.ts:110-149/276-300` 现成行为：无标签调用保持旧文案、带标签调用经 labelsVersion 触发同 id 重发刷新；manager 侧零新接口、只改调用时序，`buildKeepAliveContent` 复用不动）；打点断言「首调（无标签）先于标签查询完成」；manager 契约 smoke 用例同步。
- Step 9 — phase-copy-fix — blocking: no — qa: auto：会话列表中断会话文案改「已中断」语义——补数据管道：manager 新增 `interruptedSessionIds(): ReadonlySet<string>`（扫 units 中 status='interrupted' 的单元；变更经既有 notifyChanged/subscribe 通知驱动刷新，与 activeSessionIds 同款模式）；`ChatSessionListPanel` 徽标三态判定，优先级 running > interrupted > isCurrent：running（activeRunIds 含该会话）→「生成中」；interrupted（interruptedSessionIds 含该会话，**无论是否当前会话**）→「已中断」；isCurrent 且非上述两态→保留现有「活跃中」徽标语义。「当前会话×interrupted」必须落「已中断」——会话 A 中断后重启 app 且当前停留在 A 时，A 既是当前会话又是中断态，正是 GWT-6 要修的原样复现场景；若按「interrupted 且非当前会话」判定，该组合会被吞进「活跃中」、bug 原样保留。
- Step 10 — phase-device-validation — blocking: no — qa: manual_user：真机验收 GWT-1~5（reload 后通知 ≤2s、大会话消息面 ≤3s、交互插队 ≤100ms、正常场景 ≤1s、session-stream-unit 全 GWT 回归）+ release 包冷启动基线补测。测量口径：GWT-2 数据集用脚本向测试会话灌 1000+ 消息（灌数脚本为本次新增交付物，落点 scripts/e2e/ 下沿现有 case-*.mjs/diag-*.mjs 先例；或注明改用现成备份导入通道（备份真机大会话导入测试环境）替代、此时不新增脚本），不依赖现网数据；GWT-3 首选 run-timing 打点扩展（tap 事件→handler 首次执行的间隔），打点扩展未落地时退化为「忙期点发送→保活通知 ≤2s（即 GWT-1 结论）间接佐证交互可插队」，验收记录须注明所用口径。

## 测试策略

**现状基线注记**：GWT-7 所指 `run-timing` 打点（`__DEV__` 门控）已随 adb7d2be 入库（`apps/mobile/src/debug/run-timing.ts`），现状即满足——本迭代零新增动作，验收直接引用现状；GWT-3 的 tap→handler 打点为可选增强，未落地时按 Step 10 退化口径验收（忙期点发送→保活通知 ≤2s 间接佐证交互可插队）并在验收记录注明所用口径。

### 测试用例

- T-Y1 — blocking: yes — 量子让步原语：窗内连调不 await、跨窗 setTimeout(0)；注入 mock 同步直通（Step 1）。
- T-H1 — blocking: yes — 水合全有或全无：分片过程中 snapshot 恒 null、markHydrated 后全量可读且通知计数不变（守卫 manager.service.test:135-153）（Step 2）。
- T-H2 — blocking: yes — 分片让步可插队：水合 N 行（注入计数 yield）期间插入的同步任务在让步点执行（Step 2）。
- T-H3 — blocking: yes — disposed 中止：让步点后 dispose，后续行不再 adopt（Step 2）。
- T-H4 — blocking: yes — idle 单查询多取：tail 查询 `limit: 页大小 + 1` 一次往返后 hasMore 判定（多取的最旧一行即升序数组首行 `list[0]` 被裁去）、「结果只落属主视图」与缓存语义不变（守卫 messages 套件 300/328；其中 320-322 的 limit 断言随实现更新为 `+1` 口径，语义守卫不变；messages.test:339 的 `messages[0].seq=11` 断言保持不动——裁剪方向写反误裁末行时首行 seq 会变 10、该断言即红，作为裁剪方向的守卫）（Step 2）。
- T-C1 — blocking: no — reloadLists/refreshChatMeta 并行化后数据语义等价（Step 3）。
- T-B1 — blocking: yes — 游标短路：已扫会话再 run 开头 backfill 为 no-op（不发全量扫描查询）（Step 4）。
- T-B2 — blocking: yes — 判定回退：游标缺失/可疑时走全量扫描并补游标（T-DS4a-d 语义保持）（Step 4）。
- T-B3 — blocking: yes — truncate 清游标：回滚删尾后新消息复用 seq 仍被下次 backfill 覆盖（Step 4）。
- T-B4 — blocking: yes — T-DS5 契约：每轮 run 仍恰好调用一次 `backfillMissingBaselines`（Step 4）。
- T-B5 — blocking: yes — 两段式第二层短路（连续对话）：会话已确认无空窗（游标=N）后追加一轮「源头已建点」的新消息（发送链 user capture + mutating 工具轮 assistant capture，共 2 条，即连续对话上一轮的产出形态），第二次 run 开头 backfill：count=N+2 > 游标 → 新增段有界覆盖比对通过（段内 2 条均有 checkpoint，与空窗语义等价）→ 短路 no-op、不回退全量扫描查询、游标前移至 N+2（Step 4）。
- T-R1 — blocking: yes — 预扫等价：500+ 消息密集 tool 场景新实现输出与旧实现全等（Step 5）。
- T-S1 — blocking: yes — 分片完整有序：大快照分多片到达 web 后 rows 与单包等价（Step 6/7）。
- T-S2 — blocking: yes — 代次防叠加：分片在途时 force 新代次，旧片作废不重复渲染（Step 6/7）。
- T-S3 — blocking: yes — T-ST1 重定义：分片序列全部先于后续 streamDelta；T-REPAINT/T-SUB-CARD 红线绿（Step 6）。
- T-S4 — blocking: yes — 滚动副作用聚合：分片期间无 scrollSnapshot 回发、末片后一次（Step 7）。
- T-W1 — blocking: yes — 窗口化渲染：窗口外行不进 vnode、滚动扩窗正确、锚点/加载更旧不回归；prependPage 后读位偏移在容差内（行为级断言，容差如 ±1 平均行高，web jest 直测覆盖，不全押真机）（Step 7）。
- T-N1 — blocking: no — 通知两段式：display 首调先于标签查询；标签刷新同 id（Step 8）。
- T-X1 — blocking: no — 中断会话列表显示「已中断」：interruptedSessionIds 数据源正确（interrupted 单元入集、状态迁移经 subscribe 驱动刷新）+ 三态判定按优先级 running > interrupted > isCurrent（running→「生成中」；interrupted 无论是否当前会话→「已中断」；isCurrent 且非上述两态→「活跃中」语义保留）；补「当前会话×interrupted」分支用例，断言显示「已中断」而非「活跃中」（GWT-6 原样复现场景，防判定把该组合吞进「活跃中」）（Step 9）。

## 风险与回滚方案

- **分片协议代次设计是最大风险**（乱序/叠加=渲染错乱）：web 侧对未知代次分片一律丢弃等新代次兜底；单片快照（chunkTotal=1）等价旧协议，小会话零行为变化；回滚= revert Step 6/7（协议回退单包）。
- **fake timers 适配量大**（五套件）：yield 注入点是唯一的测试面（harness 传同步 mock），断言不动；适配失败可回退 Step 2 单独 revert。
- **core backfill 判定的保守性**：判定只做「确认无空窗」的短路，任何不确定走原全量路径；游标只在确定写入点更新；回滚 = 移除短路分支（行为即回现状）。
- **RowList 窗口化**：Preact diff 依赖 key=row.id，窗口化后滚动锚定与「加载更旧」按钮交互以 web jest 行为级断言守卫（T-W1 的 prepend 读位容差断言）+ 真机验证双保险（Step 10 覆盖）；web 侧独立 revert 不影响 RN 侧分片收益。
- **三层产物链**：web 侧改动须 `build:webview` → `build:webview:native` → gradle → adb install，CI 不覆盖 assets 时本地验收成本已计入。
