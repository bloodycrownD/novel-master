# CR Fix Spec: integration/rollback-large-jank（② 回滚卡顿 + ③ 后台停摆）

## 元信息

- repo: D:\Dev\Js\novel-master\.worktree\i-rollback（worktree）
- base_sha: 4a6f7d4e087bff3d14e1e6e9042bdfc60fb1abe0（main）
- head_sha: 916c5c48（integration/rollback-large-jank）
- prd_path: docs/Iterations/mobile-perf-2026-09/features/rollback-large-jank/prd.md、docs/Iterations/mobile-perf-2026-09/features/background-run-continuity/prd.md
- spec_path: docs/Iterations/mobile-perf-2026-09/features/rollback-large-jank/spec.md、docs/Iterations/mobile-perf-2026-09/features/background-run-continuity/spec.md
- review_round: 1 / dag_version: 1（round 指代码评审轮次；spec 修订留痕见下行）
- 修订留痕：round 2（review-fixspec-verify）修订 N1~N6；round 3 B-01 方案收敛为「窗口上限自动失效」；round 4 终校验通过（主代理补两处小修）；SD-1/SD-3 经用户确认闭合（2026-09-27）。
- 状态：fix-spec-ready

评审来源（三路 readonly）：review-scope-rollback-core、review-scope-rollback-mobile、review-scope-background。
本文件只描述「要怎么改」，不含任何实现代码改动；执行由下游 impl 波次承接。

## Must-fix（按 P0 → P1 → P2）

P0：0 条。

### P1（2 条）

#### RB-CORE-01 [P1] 共享函数 truncateTailInTransaction 写死 includeGlobalOrphans:false

- 维度：B + C-orch
- 文件：
  - packages/core/src/domain/message-checkpoint/logic/truncate-tail-in-transaction.ts:60-73
  - 连带 packages/core/src/service/chat/impl/message-transcript-effects.service.ts:63-77
  - 连带 packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts:235（改后唯一传入 `deferGlobalOrphanGc: true` 的调用点）
- 问题：该函数是回滚与批量删共用的共享函数，却把 `{includeGlobalOrphans: false}` 写死在函数体内。另一调用方 `DefaultMessageTranscriptEffectsService.truncateMessagesAfter({sweepRevisions: true})` 也会静默丢掉全局孤儿清扫，且那条路径没有任何 deferred 调度补做——孤儿行永久残留。函数注释声称「由回滚服务在事务提交后 fire-and-forget 调度」对该调用方是假话。spec 的原意是「回滚事务内移出全局清扫」，不是「所有截断路径都不做」。目前未炸只因 desktop 调用方未传 `sweepRevisions`（默认 false），属无测试兜底的静默陷阱。
- 改法（推荐 A）：
  - A) 开关上提参数层——`TruncateTailParams` 增加 `readonly deferGlobalOrphanGc?: boolean`；函数内 `if (sweepRevisions) { await sweepSessionRevisions(..., deferGlobalOrphanGc === true ? {includeGlobalOrphans: false} : undefined); }`；只有 `message-rollback.service.ts:235` 处传 `deferGlobalOrphanGc: true`，其余调用方缺省不变（保持原行为）。
  - B) 备选：保留硬编码，但在 `truncateMessagesAfter` 事务提交后也 `scheduleDeferredRevisionOrphanGc`。
- 验收/测试：补测试断言 `truncateMessagesAfter(..., {sweepRevisions: true})` 路径下全局孤儿 DELETE 仍会发生（同步或 deferred）。
- 来源：review-scope-rollback-core / round 1

#### B-01 [P1] 回滚计时窗口只开不关（rollbackT0 无关闭点）

- 维度：B / C
- 文件：
  - apps/mobile/src/debug/run-timing.ts:38-57（窗口上限常量落在 rollbackT0 声明上方）
  - 触发点 apps/mobile/src/screens/tabs/chat-tab/useChatTabMessageActions.ts:259 `resetRollbackTiming()`（零改动）
  - apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:1335（**仅可选增强涉及**，本轮主推方案代码零改动，仅 L1332-1334 注释一行需同步——见改法）
- 问题：`rollbackT0` 只在 `resetRollbackTiming()` 赋值，全仓无关闭点。首次回滚后窗口永久打开，run-timing.ts:35 注释承诺的「窗口外（t0=0）所有站 no-op」不成立：此后每一次滚动都会打 `[nm-rollback] web render receipt (scrollSnapshot)`，日常快照分片站持续输出。后果：① dev logcat 被无关事件淹没；② AC-3 打点失去可判读性（后续所有快照站挂在同一条 t0 上）。
- 改法（主推）：在 `rollbackTimingLog` 内部加窗口上限，超时自动失效——
  - 新增模块级常量 `const ROLLBACK_TIMING_WINDOW_MS = 10000;`（10s）。
  - 在 `rollbackTimingLog` 的 `rollbackT0 === 0` 早退之后插入窗口判定：`if (Date.now() - rollbackT0 > ROLLBACK_TIMING_WINDOW_MS) { rollbackT0 = 0; return; }`。
  - 窗口取值依据：回滚链 AC-1 目标为秒级（toast → 界面刷新 <1s），10s 为充裕余量；窗口内每站照常输出，超时后自动 no-op。
  - **入口守卫天然自洽**：`rollbackT0 === 0` 时 `Date.now() - 0` 为 epoch 量级，必然远超窗口 → 自动落 no-op。因此不需要为「未 reset」再补任何额外守卫分支，run-timing.ts:53 原有早退与新窗口判定形成双重兜底。
  - 同步修正 run-timing.ts:32-37 的模块注释：把「回滚窗口外（t0=0）所有站 no-op」补成「t0=0 或超出 `ROLLBACK_TIMING_WINDOW_MS` 后所有站 no-op」，让注释重新成立。
  - 连带修正 ChatTranscriptWebView.tsx:1332-1334 的站点注释：把「回滚窗口外 no-op，不影响日常滚动噪音」改为「窗口内（t0 起 10s 内）日常滚动同样会打点，超窗后 no-op」，与「已知取舍」口径一致。
- 明确不做（本轮不落地）：
  - **不做显式 `closeRollbackTiming()` + 哨兵状态位方案**。理由：① 哨兵需新增状态位，并要解决其置位/复位生命周期——「快照 aborted 时谁来清哨兵」又变成与本条同款的问题；② `web render receipt (scrollSnapshot)` 不是回滚专属通道——`apps/mobile/src/web/chat-transcript/webview/runtime/scroll/scroll.ts:75` 的 onScroll 防抖同样调 `emitScrollSnapshot`，日常滚动产生的回执与回滚快照回执在 RN 侧不可区分，哨兵式关窗会误关窗。
  - **不采用「回执到达即关窗」方案**（round 1 的方案 1）。除上述来源不可区分外，还有无兜底缺口：`ChatTranscriptWebView.tsx:844-855` 的 snapshot aborted 分支（代次被顶替 / WebView 重挂）直接 `return`，**不产生任何回执**，回执式关窗在此路径下永不触发。
  - 上述「回执 + 哨兵精确关窗」降级为**后续可选增强**：若将来确需精确关窗，需先解决回执来源标记与 aborted 路径兜底两个前提，再单独立项；本轮不作为落地要求。
- 已知取舍（接受）：窗口期（≤10s）内的无关打点（如日常滚动触发的 `web render receipt (scrollSnapshot)`）仍会短暂输出。相比原 bug（永久输出、后续所有站挂在同一条 t0 上）已收口——最长 10s 后自动静止。对 AC-3 判读无影响：回执站只要在 10s 内到达即可读到有效 elapsed。
- 验收/测试：`apps/mobile/__tests__/rollback-probe-timing.test.ts` 用 Date mock 补三条用例——
  - ① **窗口超时自动失效**：`resetRollbackTiming()` → 推进时间 >10s → 调 `rollbackTimingLog(...)` → 断言 `logSpy` 无新增调用。
  - ② **窗口内正常打点**：`resetRollbackTiming()` → 推进时间 <10s → 调 `rollbackTimingLog(...)` → 断言 `logSpy` 有新增调用且带 elapsed。
  - ③ 保留既有「未 reset（t0=0）no-op」用例。
  - 不需要 web 渲染次序断言（方案调整后不再涉及回执关窗）。
- 来源：review-scope-rollback-mobile / round 1；round 3 方案收敛（review-fixspec-verify N1）

### P2（11 条）

#### RB-CORE-02 [P2] deferred-revision-orphan-gc.ts 两个零调用方导出

- 维度：C（死代码）
- 文件：packages/core/src/domain/message-checkpoint/logic/deferred-revision-orphan-gc.ts:35-40、79-83
- 问题：`isDeferredRevisionOrphanGcInFlight()` 注释自称「仅测试断言用」但全仓 grep 只命中定义处，无任何调用；`runDeferredRevisionOrphanGc()` 已 export，但唯一调用方是同文件的 `scheduleDeferredRevisionOrphanGc`，无外部调用方也无测试。
- 改法：删掉 `isDeferredRevisionOrphanGcInFlight`；`runDeferredRevisionOrphanGc` 去掉 export 收为模块私有。若要保留测试钩子，则在 T-R4b 守卫复位断言处真正使用它。
- 验收/测试：typecheck + 现有测试全绿；若保留钩子则补用法。
- 来源：review-scope-rollback-core / round 1

#### RB-CORE-03 [P2] createSessionFsService 暴露 message-checkpoint 的 options 类型（跨层耦合）

- 维度：C（分层 / 命名）
- 文件：packages/core/src/service/session-fs/create-session-fs-service.ts:23-29
- 问题：session-fs 的公开装配 API 直接复用 `MessageRollbackServiceOptions` 类型，跨层耦合；spec 的变更点清单里该文件只该透传 `yieldFn`。
- 改法：session-fs 侧定义本地 `SessionFsServiceOptions { readonly probe?: RollbackProbe; readonly yieldFn?: () => Promise<void> }`，函数体内转为 `createMessageRollbackService(conn, { probe, yieldFn })`。调用方 apps/mobile/src/runtime/create-mobile-runtime.ts:171 零改动。
- export 约束（易漏）：本地 `SessionFsServiceOptions` 须 `export`。理由是 **declaration emit**：`createSessionFsService` 是 public API，模块私有类型会致 `tsc --declaration` 报「has or is using private name」。注：`packages/core/src/public/session-fs.ts` 只导出 `createSessionFsService` 本身，选项类型不在该文件快照内——**不要动 public 快照**。
- 验收/测试：typecheck 零错。
- 来源：review-scope-rollback-core / round 1

#### RB-CORE-04 [P2] 新增测试文件 5 处 unused-vars lint warning

- 维度：C / F（lint）
- 文件：packages/core/test/message-checkpoint/deferred-revision-orphan-gc.test.ts:49、:105；packages/core/test/message-checkpoint/rollback-plan-scope.test.ts:99；packages/core/test/message-checkpoint/rollback-probe.test.ts:54、:108
- 问题：eslint 报 `@typescript-eslint/no-unused-vars` warning（0 error），污染 lint 输出。这些是「造一条 user 消息占位」用的变量，声明后没有接住返回值。
- 改法：改成 `await ctx.messages.append(...)` 不接返回值。注意 T-R1c / T-R0 里的 `assistant0` / `user0` 有真被断言使用，不要一起删。
- 验收/测试：`eslint` 跑变更文件 0 warning。
- 来源：review-scope-rollback-core / round 1

#### A-01 [P2] 快照 build 的两段 O(n) 预扫落在打点起点之前

- 维度：A / G
- 文件：apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:832-842
- 问题：`sendSessionSnapshotNow` 第一个计时站 `bootTimingLog('snapshot begin')` 之前，已经跑完两段不可让步的同步全量扫描：`buildToolPairingContext` 与新增的 `planSnapshotChunkBounds`（内部对每条 content 做 `JSON.stringify`）。Step 3 新引入的分桶量测段在回滚轴上不可见，AC-3 无法核验它是否形成百 ms 级独占段。
- 改法：L832 预扫之前加 `rollbackTimingLog('snapshot build begin (msgs=N)')`；`chunkTotal` 算完之后加 `rollbackTimingLog('snapshot prescan done (pairing+bucket, chunks=N)')`。
- 验收/测试：改为可自动判定的形式——`__DEV__` 下构造 200 条大消息触发 `sendSessionSnapshotNow`，用 console.log spy 断言 `snapshot build begin` 与 `snapshot prescan done` 两站都出现、且两站 elapsed 差值 < 阈值（阈值取值按本机基线定，写死在测试里）。测试内先调 `resetRollbackTiming()`（或用 fake timers 钉住时钟），避免构造过程超过 `ROLLBACK_TIMING_WINDOW_MS`（10s）而撞上 B-01 的窗口超时 no-op。Step 7 真机数值只作参考，不进验收线（Step 7 已降级为可选项，见「合并后 QA」）。
- 来源：review-scope-rollback-mobile / round 1（与 SD-2 同源）

#### C-02 [P2] SNAPSHOT_CHUNK_BYTES 名不副实（.length 是 UTF-16 code unit）

- 维度：C（命名 / 口径）
- 文件：apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:190-221（常量 L195、度量表达式 L210）
- 问题：常量名与注释称「字节预算」，实现是 `JSON.stringify(content).length`，即 UTF-16 code unit 数。中文场景 1 汉字 = 3 UTF-8 字节，256KB 预算的有效载荷可达约 768KB。项目既有字节惯例是 `TextEncoder().encode().byteLength` / `Buffer.byteLength`。
- 改法：二选一，自洽即可——
  - (a) 改用 `TextEncoder` 计真实字节（并在 A-01 的新站点核对耗时）；
  - (b) 保留 `.length`，但把常量与注释改写为「源 content JSON 字符串长度（UTF-16 code unit）预算」，并把数值下调到与 256KB UTF-8 相当。
- 验收/测试：若走 (a)，补中文正文用例（如每条 8 万汉字）断言分桶数与 chunkTotal。
- 来源：review-scope-rollback-mobile / round 1

#### G-01 [P2] 新判定缺「仍应吞」的正向回归

- 维度：G
- 文件：apps/mobile/__tests__/chat-transcript-snapshot-after-stream-commit.test.tsx:199-222
- 问题：`committedStreamRowsStillPresent` 改判条件只钉住了「不满足 → 走全量快照」这一侧；第二条用例走的是更早的 `prevMessagesRef` 同引用早退，与新判定无关，证明不了「修复没有把本该吞掉的场景也改成全量」。
- 改法：补一条正向用例——`tryCommitStreamTail` 提交后（真实 message id，apps/mobile/__tests__/chat-transcript-webview.test.tsx:1767 有先例），用「新数组引用、条数不变、首条 id 不变、hidden 未变」的 messages 触发 effect，断言不产生 sessionSnapshot。
- 验收/测试：新用例与既有套件全绿并存。
- 来源：review-scope-rollback-mobile / round 1

#### M1 [P2] emitter dispose()/flush() 后 append() 仍会同步投递

- 维度：B（终态契约）
- 文件：packages/core/src/infra/llm-protocol/logic/sse-chunk-emitter.ts:90-100
- 问题：两条终态路径只调 `stopTimer()`，不更新 `lastFlushAt`，也不置终态标志，闸门仍开着。实测 `dispose()` 之后 `append("after-dispose")` 仍会触发 `onChunk`。当前 transport 不可达（守卫完备），但契约上「dispose 后 append 绝不投递」被打破，且改写后的头注 / 接口 JSDoc 没有声明这一点。
- 改法：`stopTimer()` 内置 `stopped = true`；`append()` 首行加 `if (stopped) return;`；头注 Invariants 补「`flush()` / `dispose()` 后 emitter 进入终态，`append()` 为 no-op」。
- 验收/测试：补单测——dispose / flush 之后 append 不投递。
- 来源：review-scope-background / round 1

#### M2 [P2] emitter 头注 invariant 是假陈述（interval 通道不过闸）

- 维度：C（文档 / 注释一致性）
- 文件：packages/core/src/infra/llm-protocol/logic/sse-chunk-emitter.ts:15-17（连带 L51-54）
- 问题：注释称「闸门保证任意两次实际投递间隔 ≥ tickMs」「与仅 interval 方案严格等价」，但 `setInterval` 回调是无条件 `emitBuffer()`，不过闸，实测相邻投递间隔出现 0ms / 16ms / 31ms。功能无害，但注释断言强于实现。连带 D4：L51-54 代码注释「首个 append 必落在开窗内」的推论在生产（建连 + TTFT 远超 32ms）并不成立。
- 改法：把该段改为准确表述——「窗口内多次 append 至多触发一次同步 flush；interval 兜底通道不受闸门约束，append 投递与紧随 tick 的间隔可小于 tickMs（最坏 0ms）；整流上限为每 32ms 一次 append 触发 + 一次 tick」。同时修正 L51-54 的「首个 append 必落在窗口内」表述，说明生产环境首 chunk 通常过闸直投属预期行为。
- 验收/测试：无（仅注释修正）；D4 见下方「Spec deviations」条目，随本条修正表述（标注 `open → 随 M2 转 fixed`）。
- 来源：review-scope-background / round 1

#### M3 [P2] U-01/U-02 测试依赖真实墙钟

- 维度：G（测试确定性）
- 文件：packages/core/test/infra/llm-protocol/sse-chunk-emitter.test.ts:20-38、40-64
- 问题：`lastFlushAt` 初始化为 `Date.now()`，U-01「零投递」只在「创建到首个 append < 32ms」时成立；GC 停顿 / CI 高负载下会假失败（实测 40ms 延迟即被打破）。
- 改法：这两条改用 `mock.timers.enable({ apis: ["setInterval", "Date"] })` 钉住时钟，时间推进交给 `mock.timers.tick(32)`。T-B1 / T-B2 保留真实 `sleep(45)` 或一并改（注意：Date 被 mock 之后，T-B1 需要 `tick` 才能过闸）。
- 验收/测试：改后两条用例绿，且不依赖真实时间。
- 来源：review-scope-background / round 1

#### M4 [P2] db-backup.service.ts 注册覆盖陷阱（缺 isBackground 探测）

- 维度：C-orch（装配单点化）
- 文件：
  - apps/mobile/src/services/db-backup.service.ts:87
  - 连带 apps/mobile/src/db/connection.ts:53（探测上移后的新导出落点 `registerMobileOpSqliteDriver`）
  - 连带 apps/mobile/__tests__/db-backup.service.test.ts（mock 同步，见下）
- 问题：`registerOpSqliteDriver()` 没有注入 `isBackground` 探测；全局 registry 是 last-wins，`openDbForProviderRestore()` 会把 apps/mobile/src/db/connection.ts:53 那个带探测的版本覆盖成无探测版本。当前被 self-heal 掩盖，但属静默回归陷阱——两处装配长得几乎一样，只有一处带参。
- 改法：把探测提为单点——由 `db/connection.ts` 导出 `registerMobileOpSqliteDriver(): void`（内部固定 `() => AppState.currentState === 'background'`），`getMobileConnection` 与 `db-backup.service.ts` 都改调它；`db-backup.service.ts` 删掉对 `@novel-master/tdbc-driver-op-sqlite/native` 的直接 import。
- 测试 mock 同步（否则验收不可达）：`apps/mobile/__tests__/db-backup.service.test.ts` 的 `jest.mock('@/db/connection', ...)` 是**全量替换型** mock（现只含 `checkpointMobileDatabase` / `closeMobileConnection` / `getMobileConnection` 三个键，见该文件 L48-52），须补 `registerMobileOpSqliteDriver: jest.fn()`，否则新导入为 undefined、调用即 TypeError。同时 `jest.mock('@novel-master/tdbc-driver-op-sqlite/native', ...)`（该文件 L44-46）随 import 移除可删。
- 验收/测试：`db-backup.service.test.ts` 全绿；可选补断言「restore 之后 registry 版本仍带 isBackground」。
- 来源：review-scope-background / round 1

#### M5 [P2] CHANGELOG ③ 条目口径与实现 / 架构交互不符

- 维度：A（口径）
- 文件：CHANGELOG.md:14
- 问题：条目写「流式数据到达即投递」，但 v1.5.23 已发布的 ⑥ 原生传输层在移动端优先于 XHR（native 分支不经 emitter），这半句在主流配置下用户不可感知；真正兜住后台连续性的是路径无关的 TDBC 让步跳过。
- 改法：删掉「流式数据到达即投递」，条目收敛为「后台写库不再被定时器挂起，后台持续生成（已知限制：…）」；如果要保留投递语义，必须限定为「原生传输不可用时的回落路径」。
- 验收/测试：文风不动，只改口径。
- 来源：review-scope-background / round 1

## Spec deviations

- **SD-1 [fixed]**：三处补修（提交 a4ac7546）已按用户确认「按现状收窄」（2026-09-27）回填文档——`rollback-large-jank/spec.md` 变更点 #8 + 批次 PRD「用户拍板记录」补条目（验收：运行中回滚必弹明确模态、回滚后列表即时刷新无需重进）。
- **SD-2 [fixed]**：同 A-01（快照 build 预扫段未纳入打点）——A-01 两站打点已落地并有验收测试钉住（2026-09-27 impl 完成）。
- **D4 [fixed]**：sse-chunk-emitter.ts L51-54 代码注释「首个 append 必落在开窗内」这一推论被证伪（生产环境建连 + TTFT 远超 32ms，首 chunk 走「过闸直投」属预期行为）——已随 M2 一并修正（2026-09-27 impl 完成）。

> 标注语义统一说明：本段 `[fixed]` / `[open → 随 X 转 fixed]` 中的「fixed」一律指**已被 must-fix 条目认领且给出了明确改法**，不代表代码已落地；代码落地后方可转为真正的 fixed。
- **SD-3 [fixed]**（原 scope-c D3）：chrome inspect 前提验证已于 2026-09-27 **补做完成，实证结论为肯定**（后台 timer 停摆成立）：模拟器（Android 16 / API 36）经 metro inspector CDP 注入 2s 周期 `setInterval` 打点——注入后 96.5s 内前台周期稳定 2.0s；切后台出现 **47.2s 空白间隔**（零 tick），回前台立即恢复 2.0s 周期。spec §4 根因前提确认成立，实现改动无需撤回。实证方法备忘：`/json/list` 取 target → 手搓带 `Origin: http://127.0.0.1:8081` 的 WS 客户端（metro inspector proxy 校验 Origin hostname 白名单，Node 内置 WebSocket 无法设 Origin）→ `Runtime.evaluate` 注入/读取。
- **已 fixed（简表）**：
  - deferred GC 由 `queueMicrotask` 改为 `setImmediate` 宏任务化。
  - 双入口统一到 `registerOpSqliteDriverWith`。
  - 「未注入恒按前台让步」已修正。
  - `RollbackProbe` 注入通道为合理补充，已确认。
  - T-R0 `contentBytes` 口径收窄。

## Open questions / 待拍板

三路评审共 16 条 open question，择要列出：

**rollback-core（4 条）**
1. 全局孤儿清扫的归属到底是「回滚事务内移出」还是「全链路移出」？直接影响 RB-CORE-01 选 A 还是 B。（来源：review-scope-rollback-core）
2. deferred GC 是否需要跨进程 / 跨启动兜底（当前只在进程内调度）？（来源：review-scope-rollback-core）
3. `RollbackProbe` 的采样开销在大会话下是否可忽略（探针本身也是 O(n) 日志源）？（来源：review-scope-rollback-core）
4. `truncateTailInTransaction` 的参数层重构是否需要向后兼容旧签名（对外 API 可见性）？（来源：review-scope-rollback-core）

**rollback-mobile（7 条）**
5. ~~打点窗口应「显式关闭」还是「按时间上限自动失效」？~~ **已定（round 3）**：选「按时间上限自动失效」（B-01 主推方案），不设显式关窗。理由见 B-01 条目「明确不做」小节。（来源：review-scope-rollback-mobile）
6. 快照分桶预算的口径到底按 UTF-8 还是 UTF-16？（对应 C-02 的 (a)/(b)）（来源：review-scope-rollback-mobile）
7. 打点站点数量是否已够 AC-3 判读，还是还要在 web view 侧加同步/异步桥接点？（来源：review-scope-rollback-mobile）
8. 快照分片的 chunk 边界在 composer 刷新链路上是否也需要同样的分桶保护？（来源：review-scope-rollback-mobile）
9. 「门禁 Alert 分支零测试」——`committedStreamRowsStillPresent` 判定的 false 分支目前无直接用例，是否随本轮 must-fix 一并补齐？**建议随本轮 must-fix 一并处理**。（来源：review-scope-rollback-mobile）
10. P5 同族路径 `applyComposerRestore` 是否一并做同样的截断隔离？**建议随本轮 must-fix 一并处理**。（来源：review-scope-rollback-mobile）
11. Step 7 真机基线是否必须进硬门禁，还是降级为人工可选项（见「合并后 QA」）？（来源：review-scope-rollback-mobile）

**background（5 条）**
12. ~~SD-3 的 chrome inspect 门禁补做实证，还是按用户真机验收豁免？~~ **已定（2026-09-27）**：补做实证完成，结论肯定（见 Spec deviations SD-3）。（来源：review-scope-background）
13. emitter 终态（dispose / flush 后 append no-op）是否属于对外契约变更，需要走 API 评审？（对应 M1）（来源：review-scope-background）
14. M4 的装配单点化是否顺带收编其他 driver 注册点（是否有第三处 last-wins 风险）？（来源：review-scope-background）
15. mock.timers 方案在 Bun test 下与现有 `mock` 能力是否一致（对应 M3）？（来源：review-scope-background）
16. CHANGELOG ③ 条目收敛后，是否需要在已知限制里补「原生传输优先」这一前提？（对应 M5）（来源：review-scope-background）

## 已豁免（用户确认不修）

- 暂无。

## 合并后 QA（manual_user）

1. ① 真机两场景「后台双证」：已由用户实测通过（2026-09-27）。
2. ② 大会话回滚打点对比（Step 7）：降级为可选，不再作为合并门禁。
3. ③ chrome inspect 门禁：**已补做**（2026-09-27），结论肯定（后台 timer 停摆成立），见 SD-3。

## K 节建议（下游执行时闭合）

- **eslint / format 收尾**：随 RB-CORE-04 一并处理，验收线是变更文件 0 warning。
- **CHANGELOG 口径修正**：M5，只改口径不动文风。
- **若 SD-1 获确认**：回填 `rollback-large-jank/spec.md` 变更点与批次 PRD 的 AC（文档改动，不涉及实现代码）。
