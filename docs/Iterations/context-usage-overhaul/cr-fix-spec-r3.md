# CR Fix Spec: r3 —— 上下文统计修复层 × 事件系统/run 整体统一性

## 元信息
- repo: D:\Dev\Js\novel-master
- base_sha: 4cd06bb0（v1.5.27 发版）
- head_sha: 当前工作区（未提交 diff，44 个代码文件：core 12 / mobile 21 / desktop 10 / Kotlin 1）
- prd_path: docs/Iterations/context-usage-overhaul/prd.md
- spec_path: docs/Iterations/context-usage-overhaul/features/*/spec.md
- review_round: 3（wave-1 取证 105 条 → wave-2 裁决 12 条 → round-2 校验 22 点修正 + 3 漏项 → v2 合入用户两拍板 → round-3 定向校验：core 路线链路验通 + 1 P0 执行歧义 + 5 处留白 → 本 v3 全部合入，round-3 预授权放行）
- dag_version: 3
- 状态: **fix-spec-ready**（待用户确认开工）
- 证据包: cache/cr-r3-e1-core-run.md、cache/cr-r3-e2-token-chain.md、cache/cr-r3-e3-mobile-lifecycle.md（过程产物，不入库）
- 用户拍板原则（2026-09-30）：**怎么彻底怎么干净怎么来，不能治标不治本**——事件系统是唯一事实源，双端收敛到同一条事件路径。

---

## Must-fix（按 P0 → P1 → P2；执行序见「优先级排序」）

### r3-run-1 [P0] 前奏期无终态事件的双端统一收口（core 事件路线，用户拍板）
- 维度：COR/ARC
- 文件：
  - packages/core/src/service/agent/logic/run-agent-turn.ts:362-:698（前奏段）、:699（主 try）、:702（runner.run）、:714-722（catch）、:547-552/:688-693（检查点①②）、（⓪ 与子 run 检查点同规则）
  - packages/core/src/domain/events/model/event-types.ts:41-55（payload 必填四元组：sessionId/projectId/runId/stopReason|error，vfsMutated 可选）
  - apps/desktop/src/main/ipc/handlers/agent.ts:205-214（finishTrackedRun 的 trackedRunId 匹配）、:250-251（事件订阅）、:300-344（promise 链）
  - apps/desktop/renderer/hooks/useAgentRunLifecycle.ts（**在 renderer/hooks/，不在 features/chat/**；shouldAcceptRunEvent 于 activeRunId==null 恒 false，agent-run-lifecycle-helpers.ts:10-17——**该 helper 双端共用注释已过期，mobile 已不引用，本条只影响 desktop**）
  - apps/desktop/renderer/hooks/useAgentStream.ts:228-251（acceptRunEvent → onRunFinished/onRunFailed）
  - apps/desktop/renderer/features/chat/ConversationPanel.tsx:150-155（abortUiRun freezeAt）、:191（metricsRunKey）、:397（正文清空）、:404-408（shouldApplyTranscriptReload / handleRunFinishedAbortRetain）、:437-455（FAILED 链）
  - apps/desktop/renderer/features/chat/conversation-abort-retain.ts:43-52/:91-113
  - apps/mobile/src/services/session-stream-unit-manager.service.ts:1142-1155（.then）、:1156-1175（.catch toast）、:1176-1199（.finally）、:1353-1360（事件入口）、:1378-1381（runId='' 已放行）
- 问题：core 前奏检查点命中时返回合成 cancelled、不发事件——desktop 前奏抛错 uiRunning 永久 true；前奏取消转录冻结永久挂起；mobile 靠 .then 手工补丁、双端都在事件系统之外打补丁。
- 改法（round-3 定稿，六步）：
  1. **core 发事件（payload 硬约束）**：检查点⓪/①/②（含 r3-run-3 子 run 检查点）命中时，返回合成 cancelled 前发 `EVENT_AGENT_RUN_FINISHED`，payload 写死：`runId: ''`、`vfsMutated: false`（**硬约束**——ShellNavProvider.tsx:341 按 vfsMutated!==true 早退，填错会误刷工作区树）、sessionId/projectId 主 run 用 `scope.sessionId/scope.projectId`、子 run 用 `childSessionId/parentProjectId`；stopReason 按现有字段如实填 cancelled。
  2. **core 抛错也发（作用域写死，防双发——round-3 P0）**：
     a. 前奏段（`run-agent-turn.ts:362` 到主 try `:699` 之前，现无 try 的真实抛错出口）**单独包 try/catch**：catch 发 `EVENT_AGENT_RUN_FAILED`（runId:''、error 原样、payload 约束同上）后 rethrow；
     b. `:714` 现有 catch 加 `runnerEntered` 标志守卫：标志在 `:702 await runner.run(...)` 紧前置真；catch 里仅 `!runnerEntered` 时补发 FAILED('')，为真时原样 rethrow（agent-runner.ts:923-930 已发过真实 runId 的那条，**不得再发**）。
     新不变式：runAgentTurn 返回 cancelled ⇒ 恰好一条 FINISHED('')；抛错 ⇒ 恰好一条 FAILED（前奏=''、runner 期=真实 runId），任何形态不双发。
  3. **desktop main 收口**：finishTrackedRun 匹配放宽 `runId === '' && entry.runId == null`（现码 `trackedRunId = entry?.runId ?? sessionRunIds.get(...)`，前奏期两者皆无 → null !== '' 被拒，放宽条件即此处）。事件路径统一清 activeRuns + decrement。
  4. **desktop renderer 放行前奏终态**：beginUiRun 同步置 `activeRunIdRef.current = PENDING_RUN_ID`（新常量 `'__pending__'`，**只改 ref 不入 state**——入 state 会触发 ConversationPanel:191 metricsRunKey 多一次 re-seed）；RUN_STARTED 覆盖真实 runId；shouldAcceptRunEvent 增加放行 `payload.runId === '' && activeRunId === PENDING_RUN_ID`。放行后走**既有**链（round-3 已逐段验通：useAgentStream accept → ConversationPanel onRunFinished → abort-retain finishUiRun 清 uiRunning/freezeCount/abortRetainPending → reloadMessages；FAILED 同理 setComposerError + showToast + reload）。
     **前奏终态强制 reload（round-3 补）**：`ConversationPanel.onRunFinished` 对 accept 住的 `runId === ''` payload 强制 `shouldReload = true`——前奏终态无在途 delta 会丢，强制全量 reload 安全；不补这条，「发送→立刻停止」场景（abortUiRun 先行、freezeCount!=null、无 step/assistant 例外）用户消息已落库但面板永不刷新、composer 正文已清空 = 消息凭空消失。
  5. **mobile 降级兜底**：`.then`/`.catch` 保留为幂等兜底（settle 守卫 round-3 已验三方互斥：事件路径 settle 后 .then 的 finishRun 被 settle 状态机挡成 no-op、.finally 被 isSettled 早退）。`.catch` toast 条件补 `!isSessionStreamUnitSettled(current.getStatus())`（事件路径已弹，不补必双弹）。
  6. **mobile .finally 对齐**（E3-A3/A4）：补调 `unit.invokeOnSettled('failed')`（invokeOnSettled 自带 try/catch，destroy 后调用安全）——「事件+.then 双失」的极端兜底也有草稿清理/chip 刷新出口。
- 已知边界（注释留痕）：① 前奏抛错时用户消息已落库而 composer 正文未清，可能重发（与流式中途失败同语义）；② SessionDetailDrawer.tsx:165 只按 sessionId 过滤，前奏取消会多触发一次 reload——可接受，run 已结束不在 r3-dt-align 抑制范围，记入 dt-align 边界；③ forward-event-bus 会为 FAILED('') 多打一行 desktopLogError——可接受。
- 验收/测试：
  - core：检查点命中 → 恰好一条 FINISHED('')、无 STARTED、vfsMutated===false；前奏段抛错 → 一条 FAILED('') 后 rethrow；**runner 起步后失败 → 恰好一条 FAILED(真实 runId)、零条 FAILED('')**（锁死不双发）。
  - desktop main：FINISHED('') → activeRunsCount===0、isDesktopAgentActive()===false。
  - desktop renderer：未收 STARTED 直接收 FINISHED('') → uiRunning===false、freezeCount===null、**reloadMessages 被调（含发送后立刻停止场景）**；FAILED('') → 错误提示 + uiRunning===false；use-agent-run-lifecycle.test.ts:17「activeRunId 为空拒绝」在 PENDING 分支下仍绿（null !== PENDING）。
  - mobile：事件路径收口后 .then no-op；FAILED('') 后 toast 恰一次。
- 来源：E1-B1/A7/D4 + round-2 修正 1-4 + 用户拍板 + round-3 定稿（1.a/1.b/1.c/1.d）

### r3-run-2 [P0] 「RUN_STARTED 已发但无终态事件」的 refcount 永久泄漏（desktop 锁死到重启）
- 维度：COR
- 文件：packages/core/src/service/agent/impl/agent-runner.ts:235（STARTED 在主 try :375 之外）、:294（findById 抛穿）、:303-318（:310 throw）、:885-933/:924-929；apps/desktop/src/main/ipc/handlers/agent.ts:333-336（.finally 早退）
- 问题：STARTED 与主 try 之间抛错 → 无 FAILED → desktop .finally 因 runId 已回填早退 → refcount 永久泄漏 → 全部后续 AGENT_BUSY。mobile 同场景安全。
- 改法：
  1. core：`bus.publish(EVENT_AGENT_RUN_STARTED,...)` 从 :234-236 下移到 :374（主 try 紧前）。round-2 已核安全（中间无事件、shouldIgnoreStaleRunStarted 恒等 !uiRunning、mobile starting 单元由 begin() 建立、listCalibratableSessionIds 语义不变、agent-runner.test.ts:527 只记顺序）。**与 r3-run-1 步骤 2 互补**：下移后 findById 抛错无 STARTED，由入口壳前奏段 FAILED('') 兜住——本条验收场景顺带被 r3-run-1 覆盖。
  2. desktop 防御：RunEntry 加 `terminalSeen`，finishTrackedRun 置真；`.finally` 改 `if (entry == null || entry.terminalSeen) return;`。**注释写死两条**：不双递减依赖事件总线同步分发（finishTrackedRun 在 bus 回调同步 delete，.finally 时 get 必 undefined）；terminalSeen 兜的是 runId 不匹配的 stale 终态事件，非废字段。
- 验收/测试：core——findById 抛错时不发 STARTED 不发 FAILED、run reject（+ r3-run-1 的 FAILED('') 恰一条）；desktop——「STARTED 无终态」场景 activeRunsCount===0 且 isDesktopAgentActive()===false。
- 来源：E1-D4 + round-2 修正 5 + round-3 1.c 互补确认

### r3-chip-1 [P1] 弃权未覆盖 resolve 段：进得去停不下（含 ~5.8s 原生计数）
- 维度：PERF/COR [改 core 签名]
- 文件：apps/mobile/src/services/session-prompt-input.service.ts:83/:96/:117/:133（bail 点）、:31（注释）；apps/mobile/src/services/chat-prompt-tokens.service.ts:114-123（catch 只认 ChatPromptBuildBailedError）、:124-:131（插入点）、:138-148（无模型早退残留）；packages/core/src/infra/tokenizer/logic/resolve-current-prompt-tokens.ts:202-206（options 形状）、:248-273（preferEstimate 早退段）、:275-280（seeds）、:285（countPromptLlmInput）；resolve-prompt-tokens-with-backfill.ts:34（透传）；packages/core/src/domain/compaction-conditions/triggers/token-ratio.trigger.ts:58（唯一不透传调用方）
- 问题：bail 只在 build 段；resolve 链（含原生整串计数 ~5.8s）无弃权点；preferEstimate 早退段的 serializePromptLlmInput + lookupWholeCacheEntry（内部再序列化一次）同样整串级无 bail。
- 改法（round-3 定稿，错误风格写死）：
  1. mobile `loadChatTokenLabelWithFlag` 在 build 返回后、getSessionAgentConfig 之前加检查点（命中返回空串哨兵）；
  2. **[改 core 签名]** `ResolveCurrentPromptTokensOptions` 加 `shouldBail?: () => boolean`（对不传的调用方零影响——round-3 已核调用面全清单）；插入点两处：preferEstimate 早退段**序列化之前**一道；L1/L2 seed 之后、`:285 countPromptLlmInput` 之前一道。命中抛 **core 新错误类 `PromptTokenResolveBailedError`，从 `@novel-master/core/provider` 导出**（core 引不到 app 层的 ChatPromptBuildBailedError；不用返回 null——那要放宽返回类型并给 token-ratio.trigger 加分支，改动面更大）；
  3. **mobile catch 扩 catch 为必做项**：`chat-prompt-tokens.service.ts:114-123` 的 catch 同时捕获 `ChatPromptBuildBailedError` 与 `PromptTokenResolveBailedError`，都返回空串哨兵——不扩则 resolve 段 bail 错误逃逸成 unhandled rejection；desktop 读口在 r3-dt-align 落地时同款扩；
  4. `session-prompt-input.service.ts:31` 注释改「build 分段间 + build/resolve 关键边界检查」。
- 已知残留（注释留痕）：`:138-148` 无模型早退分支的 serialize + countFallbackTokens 无 bail（无升级价值且罕见）。
- 验收/测试：mobile——① build 返回后翻真 → 空串且 getSessionAgentConfig 未调；② seed 后、驱动调用前翻真 → 空串且驱动计数未被调（registry spy）；③ **resolve 段 bail 错误不逃逸**（catch 扩展后返回空串）。core——shouldBail 命中时抛 PromptTokenResolveBailedError、token-ratio.trigger 不传时行为不变。
- 来源：E2-S-1 + round-2 修正 6-8 + round-3 3.1-3.5 定稿

### r3-l2-1 [P1] seededSessions 登记不回收：一次瞬时读错永久失去种子
- 维度：CACHE
- 文件：packages/core/src/infra/tokenizer/logic/token-chunk-cache.ts:360/:363/:368-374/:375-378/:344-347
- 改法：读抛错与坏 JSON 两个分支各补 `seededSessions.delete(sessionId)` 再 return 0；方法注释补「读失败/坏行会撤销登记、下轮重试」。
- 验收/测试：首次 seed 读抛错后第二次仍发 KKV 读（gets===2）。
- 来源：E2-S-13

### r3-cache-1 [P1] desktop 压缩暖机 inflight 去重打破「IPC 返回前已暖好」不变式
- 维度：CACHE/ORC
- 文件：apps/desktop/src/main/services/chat-prompt-tokens.service.ts:374-377/:218/:309/:311/:334；compaction.ts:44-50；compaction-handler.test.ts（T-IPC2）
- 改法：拆 `compactionWarmInflight` / `readWarmInflight` 两个 Set，各自 add/finally delete；压缩路径不查读口 inflight、自己完整跑一轮并 await（T-IPC2b 必然成立，无需「await 读口在途轮」选项——读口暖机是 void 出来的没有可 await 句柄）。
- 验收/测试：占住 readWarmInflight 再调压缩暖机 → 完整 resolve 被调用且首帧命中 L1；T-IPC2b：inflight 占位时 IPC 返回那一刻精确档仍就绪。
- 来源：E2-S-21 + round-2 修正 12 + round-3 冲突 2（与 dt-align 补推解耦——补推走防抖读口不占压缩 Set）

### r3-dt-align [P1] desktop 对齐 mobile 四层防护（用户拍板：对齐；round-3 接线定稿）
- 维度：ARC/PERF
- 文件：apps/desktop/src/main/ipc/handlers/agent.ts:183-185（activeRuns Map，sessionId 键）、:270-275（handleAgentRunIsActive 走 rt.abortRegistry.has）、:217（onCoreRunFinished）、:250-251；apps/desktop/src/main/services/chat-prompt-tokens.service.ts:305-335（防抖读口 loadChatPromptTokenStats）、:588-597（Resilient 的 fallback 陷阱）、:171-174（build 调用）；apps/desktop/src/main/services/session-prompt-input.service.ts:29-84（desktop build 五段，bail 点对应 :38/:45/:62/:74）；prompt-preview.service.ts:65（不传 options 的消费者）；shared/ipc-types.ts prompt.ts:42-52（PromptChatTokenStatsResponse 契约）
- 问题：mobile 真机实锤的阻塞类在 desktop main 同样成立（同进程单事件循环、单 SQLite 连接），desktop 全链零抑制零弃权（E2-S-19）。
- 改法（round-3 定稿，四层接线单方向收敛）：
  1. **判活源写死 `rt.abortRegistry.has(sessionId)`**（不用 activeRuns——abortRegistry 在 runAgentTurn 函数入口注册、语义更贴「在途」、额外覆盖子 run，且 desktop 已有 handleAgentRunIsActive 先例）。查询口从 agent.ts 导出单方向引用（`chat-prompt-tokens → agent.ts`，**补推订阅也放 agent.ts 的 onCoreRunFinished/onCoreRunFailed 内、且在 finishTrackedRun(...) 返回之后调用**——不依赖事件订阅顺序；禁止反向 import 防循环依赖）。
  2. **run 在途抑制 + 返回契约（写死，防 fallback 陷阱）**：读口/后台暖机/压缩暖机入口查判活，在途**跳过本轮**；跳过的返回契约 = 公开读口返回类型放宽 `PromptChatTokenStatsResponse | null`，IPC 回 `{ok:true, data:null}`，renderer 收 null **保留旧标签**；**`loadChatPromptTokenStatsResilient` 必须单独识别 bail 错误并直接返回 null，绝不进 `loadChatPromptTokenStatsFallback`**（fallback 是完整 build + 启发式计数，正是要消灭的重活——mobile 侧 :115-121 有同款防陷阱注释，照抄）。
  3. **build 弃权**：desktop buildSessionPromptInput 五段照抄 mobile 的分段 shouldBail（bail 点 :38/:45/:62/:74，desktop 侧同构已核）；抛 ChatPromptBuildBailedError 同款；预览消费者不传 options 不变。
  4. **结束后补推（补跑槽等价物）**：FINISHED/FAILED 后（onCoreRunFinished 内）调**防抖读口入口 `loadChatPromptTokenStats`**（自带首帧估算 + 后台暖 + 推送，语义即补跑槽；**不要用 warmChatPromptTokenStatsAfterCompaction**——它会占 r3-cache-1 刚拆的 compactionWarmInflight，语义串味，且与 SessionDetailDrawer 自己发的那次读口 IPC 不共享防抖槽会双跑重活；走防抖入口则与抽屉 IPC 合并成一次）。
  5. 压缩冻结层：desktop 架构是 await-warm，r3-cache-1 保不变式 + 本条第 2 层抑制叠加即覆盖，无独立改动。
- 已知边界（注释留痕）：① SessionDetailDrawer 在 FINISHED 的自发 reload 不在抑制范围（run 已结束，多一次读口走防抖合并）；② 手动压缩 IPC 无 run 忙闲守卫，与 run 并发时暖机被抑制只是升级变慢、不破 r3-cache-1 不变式。
- 验收/测试：desktop——run 在途时读口跳过（build 调用次数 0、IPC data:null、renderer 旧标签保留）；结束后补推恰好一次且与抽屉 IPC 合并（防抖槽观测）；build 中 run 起步 → 本轮弃权；**bail 错误不进 fallback**（fallback 调用次数 0）。
- 来源：E2-S-19 + 用户拍板 + round-3 2.1-2.7 定稿

### r3-orc-1 [P1] 两处压缩 handler 手工副本漂移五处 + 提前解冻窗口
- 维度：ORC
- 文件：apps/mobile/src/screens/tabs/chat-tab/useChatTabMessageActions.ts:117-159（warm fire-and-forget :142-154）；apps/mobile/src/screens/stack/SessionDetailScreen.tsx:167-212（:184/:209 失败出口、:198-205 暖后补发、:207 await load() 两分支后都跑）
- 改法：apps/mobile/src/services/ 新增 `runCompactionWithTokenWarm(runtime, scope, {onFailed?, onSucceeded?, onFinally?})`——**三钩子**（round-3 核实详情页三出口一个不能少）。内部：beginChatTokenLabelFreeze → runCompaction → 成功 await warm 并 finally 解冻；失败/异常统一解冻。`preciseWarmInflight`（mobile 侧，apps/mobile/.../chat-prompt-tokens.service.ts——与 desktop 同名变量不同文件，勿改错）从 Set 换 `Map<sessionId, number>`：begin 与 warm 各 ++、各自 finally 各 --，解冻条件 = 计数归零（begin 的 add 到 2、warm 的 finally 只减 1，解冻等两路落定）。
- 验收/测试：新入口单测成功/失败/异常三支，isChatTokenPreciseWarmInflight 三种结局都归 false；UI 侧只留渲染断言。
- 来源：E3-E1~E5 + round-2 修正 15-16 + round-3 一致性确认

### r3-run-3 [P1] runChildAgent 的 abort 注册未前移且无前奏检查点
- 维度：ARC
- 文件：packages/core/src/service/agent/logic/run-agent-turn.ts:765（childDepth）、:768（baseRegistry）、:772（list）、:782（skills）、:797（vfs）、:799-812（childController 块，round-3 逐行核实只依赖 opts.signal）、:821（try）、:822（register）、:824（streamRegistry.register）、:963-967（finally 须容忍 streamHandle undefined）
- 改法：
  1. :799-812 整块上移到 :765 childDepth 之后、:768 baseRegistry 之前；register 置于该块之后、agentRegistry.list() 之前；
  2. 检查点两道（register 后 list 前、skills 后），均置于 try 内（第一道在 :822 register 后、:824 streamRegistry.register 前）；命中按 r3-run-1 规则发 FINISHED(runId:'', sessionId=childSessionId, projectId=parentProjectId, vfsMutated:false) 再返回合成 cancelled；
  3. finally 容忍 streamHandle === undefined（主 run :689 同款）。
- 验收/测试：子 run 用例——list 期间 abort 子会话 → has===true、子 runner.run 未调、stopReason==='cancelled'、收到 FINISHED('')（payload 归属子会话）、收尾后 has===false。
- 来源：E1-A6 + round-2 修正 9 + round-3 一致性逐点确认

### r3-run-4 [P1] 前奏检查点覆盖不全：backfill 段与 ①② 之间无观察点
- 维度：PERF/COR [改 core 签名]
- 文件：packages/core/src/service/agent/logic/run-agent-turn.ts:392/:400/:416/:426/:451-483/:552-:690（:565/:577）
- 改法：
  1. 入口检查点⓪（preludeAbortResult 定义后、backfill 前）：命中发 FINISHED('')（r3-run-1 规则）后返回合成 cancelled——用户消息不落库 = 这次发送没发生；**与 r3-run-1 联动注释**：⓪ 命中后 settle 的 reloadMessages 拿旧列表是正确行为；
  2. **[改 core 签名]** backfillMissingBaselines 加可选 signal，游标扫描循环内检查提前退出（conn.transaction 内中途退出提交已写部分——幂等、下轮补齐，注释留痕）；
  3. :565 与 :577 之后各插一道检查点。
- 验收/测试：①入口 aborted → backfill 未被调；②backfill 扫描中 abort → 有限步退出且 cancelled；③list 期间 abort → skills 未被调（**与 r3-test-1 T-ABORT-EARLY-2 改造同批落**）。
- 来源：E1-A1/A2/C1/C4 + round-2 修正 10-11

### r3-cache-2 [P2] promptWholeCache 的 L1 seed 无节流
- 维度：CACHE/PERF
- 文件：packages/core/src/infra/tokenizer/logic/prompt-whole-cache.ts:233-268（现状无 seededSessions，:247-253 读抛错直接 return 0）、resolve-current-prompt-tokens.ts:279/:252→:185
- 改法：加独立 seededSessions（不与 L2 共享）；**登记点必须在 KKV get 之前、照抄 token-chunk-cache.ts:359-360 的先登记再 await**（并发去重性质）；**L1 读失败/坏行两分支同样补 delete**。
- 验收：连刷两轮完整口径 L1 的 KKV gets===1，**按 key 过滤**（PROMPT_WHOLE_CACHE_KEY vs TOKEN_CHUNKS_CACHE_KEY 同域不同键）。
- 来源：E2-S-17 + round-2 修正 13 + round-3 登记点补注

### r3-cache-3 [P2] desktop 推送前「补读」完整重跑 build
- 维度：CACHE/PERF
- 文件：apps/desktop/src/main/services/chat-prompt-tokens.service.ts:258-272/:252-255/:171-174；SessionDetailDrawer.tsx:203-205、ConversationPanel.tsx:255-259（无回落保护的消费方）
- 改法：直接推 warm 手里的 precise 结果（build 调用 0 次）；仅「warm 期间模型或内容已变」才补读（params.savedModelId 与当前会话模型比对）；**直接推也过 `precise.estimated === false` 闸**（不补会被 heuristic 档盖掉精确标签）。
- 验收：T-T9b 补推送路径 buildSessionPromptInput 调用次数 0。
- 来源：E2-S-11 + round-2 修正 14

### r3-test-1 [P2] 关键测试无牙齿（五处）
- 维度：TEST
- 文件：packages/core/test/service/agent/run-agent-turn-abort-registry.test.ts:520-590；apps/mobile/__tests__/session-stream-unit-manager.service.test.ts:215-216；apps/mobile/__tests__/use-chat-tab-scope-token-debounce.test.ts:26-29
- 改法：
  1. T-ABORT-EARLY-2 补断言 streamRegistry.register 调 0 次 + runner 未产出（区分①②；round-3 确认与 r3-run-3 检查点①位置一致、断言有效；**与 r3-run-4 验收③同批落**）；
  2. manager 用例 abortRegistry.has 依 startRun 调用次数返回真/假；
  3. 冻结闸 hook 级用例（isChatTokenPreciseWarmInflight 可翻真 → 不排程）；
  4. build 内 bail 检查点真跑用例（不整体 mock build，shouldBail 第 N 段翻真 → 抛错且后续段未执行）；
  5. starting→settled 单元级用例。
- 验收：五条删实现即红。
- 来源：E1-E6/E3-F2/F7/F12/E2-S-30 + round-2 修正 17

### r3-doc-1 [P2] 过期注释纠偏（round-3 扩充清单）
- 维度：DOC
- 文件：apps/mobile/src/services/session-stream-unit-manager.service.ts:65、:481-482、:1059-1063（命中 :1061）、:1087-1088（**删 :1088 保 :1087**）、:1865、:1872、**:1143-1148 与 :1165-1168（「core 不发 RUN_STARTED/RUN_FINISHED」「FAILED 永远不会来」——r3-run-1 落地后当场变假）**；run-finish-calibration-probe.ts:16-18；session-stream-unit.ts:470-474；**agent-run-lifecycle-helpers.ts:2（「双端共用」过期——mobile 已不引用 shouldAcceptRunEvent）**
- 改法（统一口径）：:65/:481-482/:1059-1063/:1865 一律「register 在 runAgentTurn 函数入口执行，受理即在途」；:1872「判据是 runId 非空（starting 单元 runId 由 RUN_STARTED 回填），与 registry 注册时机无关」；:1143-1148/:1165-1168 改「core 前奏终态发 FINISHED/FAILED(runId='')，事件路径优先收口，.then/.catch 为幂等兜底」；helper:2 删「双端共用」表述。与 r3-run-3/run-4 同批落。
- 来源：E1-B3/E3-F11/F14 + round-2 修正 18 + round-3 1.d/四.6

---

## Spec deviations
1. **随执行批** L2 seed-once + 脏标记 + 既有落代偏离（「第 2 代 vs 第 3 代」与 seed-once 是 message-token-cache/spec.md:23 同一句的两处，**注记必须合一**，只注一半自相矛盾）。锚定承载：r3-l2-1 / r3-cache-2 验收清单加「spec 注记已落」检查项。
2. （已并入 #1）
3. **独立 doc 任务** workplace 冷 miss fire-and-forget：features/message-token-cache/spec.md 内 file_cache 行为描述段（grep `file_cache` 定位句子）加注记——12 条 must-fix 不碰该文件、无承载必漏，故单列 K 节第一条。
4. **fixed（超 spec 增强）** 压缩消跳变双端。
5. **fixed（超 spec 增强）** abort 前移 + 检查点（r3-run-1/3/4 修完收口）。

## Open questions / 待拍板
1. ~~desktop 对齐~~ → 已拍板对齐（r3-dt-align）。
2. ~~r3-run-1 路线~~ → 已拍板 core 事件路线（v3 定稿）。
3. 会话删除的统一缓存 forget 出口：内存级影响，是否加。
4. 前奏收口发「生成完成」通知：既有行为一致延伸，改口径须独立拍板。
5. stopRun 返回 false 的 UI 反馈：r3-run-3/4 落地后窗口极小。
6. L2 跨会话共享 + seed-once 组合盲区：**r3-l2-1 不覆盖本条**（读失败回收 ≠ 登记成功零落盘）；真修需「有 record 才标记 seeded」，属语义变更另立项。
7. runCompaction 与后台回填交错：按 2026-09-29「压缩不清 file_cache」判定无害。
8. D1/D2 无实害成立；**D3（STREAM_USAGE 经 bus 外 microtask 合批、顺序不单调）——事件总线同步分发不是兜底前提**，影响面为速率采样偏差，备查、日后单独评估。
9. 压缩冻结闸在换会话槽重置之前 return（useChatTabScope.ts:191-193 vs :196-207）：预热窗口内切会话旧 timer 不取消、hasLabel 不重置；本轮不修，r3-orc-1 收敛后如复现再立。

## 已判定不修（备查）
- E1-B6：前奏检查点路径不失效 API 占用基线（⓪/① 取消时消息未追加或刚追加，基线语义由 run 末失效/回锚兜住）。
- E1-C3：desktop 无 undo_send 对等能力（平台差异）。
- E2-S-12：sessionKkv/preferEstimate 三处手写（r3-chip-1 改签名时顺手可收敛，不单列）。
- E3-C1：manager refcount 依赖事件总线同步分发（r3-run-2 注释留痕，总线改异步属架构变更另议）。

## 已豁免（用户确认不修）
（暂无）

## 合并后 QA（manual_user）
- 真机：回滚+重发 → POST ≤+2s、run 期间 chip 不动、结束补一轮；前奏任意阶段（含 backfill 中途）停止秒级兑现；**发送→立刻停止 → 用户消息可见**（强制 reload）；子会话前奏停止同样秒级。
- desktop：发送后立刻停止 → composer 解锁、无残留；前奏抛错 → 有错误提示且可再次发送；run 在途时打开 drawer 不卡顿（读口抑制）；「发送→立刻停止」用户消息不消失。
- 压缩（双端）：标签直达精确档；压缩后立即再压缩（读口暖机在途真实时序）仍无跳变。
- core 事件面：runner 期失败恰好一条 FAILED（真实 runId）；前奏失败恰好一条 FAILED('')——logcat/测试双验不双发。

## K 节建议（下游执行时闭合）
1. **doc 任务（deviation #3）**：message-token-cache spec 的 file_cache 段加 fire-and-forget 注记。
2. core dist 重建（r3-run-1/2/3/4、r3-chip-1、r3-l2-1、r3-cache-2 均改 core）后才能跑 mobile/desktop 测试与 Metro 真机验证。
3. **[改 core 签名] 两条**（r3-run-4 backfill signal、r3-chip-1 读口 shouldBail）落地后跑**全量 mock 面**（昨日 listBySessionTail 教训）。
4. spec 注记（deviation #1+#2 合一）随 r3-l2-1/r3-cache-2 执行批提交。
5. **排期约束**：r3-test-1 的 T-ABORT-EARLY-2 改造与 r3-run-4 验收③同文件同处，并入第 5 步同批；第 5→8 步分批提交时不得只合其一。

## 优先级排序（执行序建议）
1. r3-run-1 + r3-run-2（同源，core 事件路线一起落）
2. r3-chip-1（[改 core 签名] 彻底版，含 mobile catch 扩展）
3. r3-cache-1（desktop 跳变不变式）
4. r3-l2-1 + r3-cache-2（同族；L1 必须含失败分支 delete 与先登记再 await）
5. r3-run-4 + r3-run-3（**含 r3-test-1 的 T-ABORT-EARLY-2 改造半条**）
6. r3-dt-align（依赖第 1 步事件完备；接线按 round-3 定稿：abortRegistry 判活 + 防抖读口补推 + null 哨兵契约）
7. r3-orc-1（压缩编排收敛）
8. r3-cache-3 + r3-test-1 其余 + r3-doc-1（收尾批）

---

## Fix-Spec Closure
| 项 | 状态 |
| fix-spec-ready | **yes**（round-3 预授权：6 条修正已全部逐字合入本 v3；待用户确认开工） |
| fix_spec_path | 本文件 |
| dag_version / review_round | 3 / 3 |
| P0 / P1 / P2（已写入） | 2 / 6 / 5 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | 1 随执行批（含并入的落代注记）；3 独立 doc 任务；4/5 fixed |
| C-orch | ✅（r3-orc-1 + r3-dt-align 接线单方向收敛） |
| C 类合并后 QA | 见上 |
| 审查留痕 | wave-1 证据包 105 条 → wave-2 裁决 → round-2（22 修正+3 漏项）→ v2（用户两拍板）→ round-3（core 路线验通 + 1 P0 歧义 + 5 留白，预授权 v3 放行）→ v3 |
