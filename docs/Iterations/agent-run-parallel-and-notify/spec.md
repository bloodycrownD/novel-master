---
date: 2026-08-30
---

# 多会话并行 + 后台保持请求 + 完成通知技术规格（SPEC）

## 设计目标

对应 PRD：`docs/Iterations/agent-run-parallel-and-notify/prd.md`（依赖 `docs/Iterations/main-session-stream-resume/prd.md` 的回页恢复机制）。mobile 实现跨会话并行（单会话串行）、后台保持（除用户关闭 app 外请求不断）、完成通知（本地、可开关、点按直达会话）。core 层 per-session registry 已就绪不动；desktop 不在本次范围。

## 总体方案

四块改造，**前置缺陷必须先修**：

**第 0 块（前置）：refcount 收尾改事件驱动。** 现状 `decrementAgentActive` 只由「当前面板会话」的事件消费触发（`useSessionStream` 按 `payload.sessionId === sid` 过滤后走 lifecycle 收尾），切走会话后 FINISHED 被丢弃 → refcount 泄漏 → `isMobileAgentActive()` 永久 true、全局卡死。并行化让「切走」成为常态，此缺陷从偶发变高频。修法：全局 refcount 的加减全部收口到新的 AgentRunManager——**increment 在 `startRun` 受理路径同步执行、decrement 由订阅的全量 FINISHED/FAILED 事件驱动**（按 sessionId 维护 per-session 记录，不经过 UI 面板过滤；时机细节与理由见第 1 块）。

**第 1 块：app 级 AgentRunManager（fire-and-forget 编排）。** 参照 desktop main 的 `attachAgentRunLifecycleListeners` + `activeRuns` 形状，新建 React 树外的 manager（挂在 runtime 装配层，`create-mobile-runtime.ts` 一带）：

- `startRun(sessionId, projectId, content, options)`：per-session 门禁钉死为「**RunEntry 存在（`starting` 或 `running`）或 `abortRegistry.has(sessionId)` 为 true 即拒绝**，返回明确错误而非静默」→ 受理后 fire-and-forget 调 `runAgentTurn`（不 await 返回 UI，`startRun` 本身同步返回受理/拒绝结果）。门禁不能只看 `abortRegistry.has`：core 的 `register` 要到 `run-agent-turn.ts` 内用户消息 append 之后（L592，之前还有 backfill baseline、resolve agent/model 等一长段 async）才执行，「受理 → register」之间存在 `has()` 恒为 false 的异步空窗——只看 registry 会在空窗内受理第二个同会话 run，而 registry 的 `register` 是 Map.set 覆盖式（`create-agent-abort-registry.ts:21-23`），会冲掉第一个 run 的 controller；RunEntry 从受理起就是 `starting`，正好封住这个空窗（与「恢复窗口融合」专节的接纳路径共用同一信号）。`options` 契约（供 `ChatComposer.executeRun` 等 UI 侧消费）：
  - `stream` / `annotateDrafts` / `allowResumeWithoutInput`：原样透传给 `runAgentTurn`；
  - `onUserMessageAppended?: () => void`：透传 `runAgentTurn` 同名回调——UI 侧在此清批注草稿与输入草稿（append 成功后才清、失败不丢草稿的既有语义不变，时机不变）；
  - `onSettled?: (status: 'finished' | 'failed') => void`：run 终态回调（由 Manager 事件订阅驱动，与 UI 面板可见性无关）——UI 侧在此做「结束后」副作用：`projectComposerStatusForSession` 刷新 chip、`onMessagesChanged` 刷列表、空续跑未清草稿的兑底清理。组件卸载后回调仍可能触发，UI 侧自行 catch 吞错。状态判定来源钉死：FINISHED 事件 → `'finished'`、FAILED 事件 → `'failed'`；**abort 收场归入 `'finished'`**——FINISHED payload 只有 `stopReason`、FAILED 只有 error 字符串，均无结构化 abort 标记，`'aborted'` 无可靠判定来源，故从签名中移除；abort 后 chip/列表刷新等副作用照常执行。若未来需要区分 abort，须 core 先提供结构化标记，另行立项。
- 订阅 `EVENT_AGENT_STARTED/FINISHED/FAILED` 全量事件：维护 per-session `RunEntry`（runId、状态 `starting` → `running` → 空）、驱动全局 refcount（替代 `useAgentRunLifecycle` 的 refcount 归属）、触发通知。`RunEntry.status === 'starting'` 表示已受理但 RUN_STARTED 未达，是区分「无 run」与「run 在途」的信号（恢复窗口融合见专节）。**refcount 时机钉死：increment 在 `startRun` 受理路径同步执行**（对齐 desktop `agent.ts:296-298` 的形状——`activeRuns.set` + `incrementDesktopAgentActive()` 先于 fire-and-forget 的 `runAgentTurn`），**事件订阅只负责 decrement**（FINISHED/FAILED）；RUN_STARTED 事件本身只做 entry 状态迁移（`starting` → `running`）与 runId 回填，不碰 refcount——若 increment 挪到 RUN_STARTED 事件而 decrement 留在受理失败路径，两处时机错配会在 RUN_STARTED 丢失时偷走其它会话的计数。
- **无 RUN_STARTED 早退兜底**（对齐 desktop `agent.ts` IPC 后台任务的 finally 兜底，注释 C-orch-1）：fire-and-forget 的 promise 链尾挂 `.finally()`——若 `runAgentTurn` 抛错时该 session 的 RunEntry 仍处 `starting`（RUN_STARTED 未达），同步删除 entry 并 `decrementAgentActive()`（抵消受理路径已同步执行的 increment），否则 refcount 永不回落、`isMobileAgentActive()` 永久 true；若 RUN_STARTED 已达，则 FINISHED/FAILED 的事件路径负责收尾，finally 提前 return 不双减（`decrementAgentActive` 对 0 幂等）。
- 错误展示桥：run 失败经注入的回调转发到 `ToastHost`/`showToast`（Manager 在 React 外，经 `NovelMasterProvider` 注入一个 UI 桥回调，见下「Manager 装配契约」）。
- 注意 core `abortRegistry.register` 是 Map.set 覆盖式、无同 session 拒绝——**单会话串行完全靠 Manager 门禁保证**（core 不加防护，避免动 core 影响双端）。

### Manager 装配契约（实例化、暴露、重建、桥）

现状约束：`MobileNovelMasterRuntime` 由 `NovelMasterProvider` 的 React state 持有，`createMobileNovelMasterRuntime` 是纯 async 工厂；bootToken retry 路径会先 `closeMobileConnection()` 再整体重建 runtime；`agent-activity` 是模块级 refcount，runtime 重建不会自动清零。装配契约钉死四点：

1. **实例化时机**：在 `NovelMasterProvider` 的 bootstrap effect 内、runtime 创建完成后实例化（`new AgentRunManager(rt.eventBus)`），并挂到 runtime 对象上（`MobileNovelMasterRuntime` 类型加 `agentRunManager` 字段，`create-mobile-runtime.ts` 侧补类型）。不放进单独的 React state 或 context 通道——runtime 本身就是现成的分发通道，且 Manager 生命周期天然跟随 runtime。
2. **暴露方式与 `startRun` 获取路径**：`ChatComposer` / `ChatTabProvider` 经 `useNovelMaster().runtime.agentRunManager` 获取（两者已持有 runtime 引用，零新增 context）。`startRun` 只在 UI 事件处理器中同步调用，受理/拒绝同步返回，不产生「runtime 未就绪时调用」的窗口（Provider ready 前组件本就不可达）。
3. **retry 重建 runtime 时的销毁**：对齐 desktop `main.ts` 的先 detach 模式（`bootstrapMainServices` 先 `detachMainEventBusListeners()` 再重新 attach）。本侧在重建前先调 `manager.dispose()`：退订事件总线、按 Manager 自身 RunEntry 记录逐个递减 `agent-activity`（模块级计数不随 runtime 重建归零，必须由 dispose 显式清零；decrement 对 0 幂等，不会双减）、停止前台服务。`dispose()` 必须在 `closeMobileConnection()` **之前**调用（先 detach、后销毁连接）；新 runtime 就绪后重新实例化 Manager。dispose 与在途 run 回调的交互钉死：dispose 只做退订、清计数、停服务，**不撤销已透传给 core 的回调**——`onUserMessageAppended` 是 `runAgentTurn` 内部直接调用的，Manager 无从拦截，retry 重建后旧 run 的该回调仍可能触发，UI 侧按既有「组件卸载后回调自行 catch 吞错」口径处理；`onSettled` 由事件订阅驱动，dispose 退订后旧 Manager 不再触发，在途 run 的后续 FINISHED/FAILED 由新 Manager 的事件订阅接管 refcount（新 Manager 无对应 entry 的终态事件不 decrement，防负——dispose 已按 entry 清零过）。降级声明：dispose 清零是两害相权的正确取舍（不清零会因新 Manager 听不到旧事件而永久卡死）；retry 重建后至旧 run 实际结束期间 `isMobileAgentActive()=false`，备份/云同步守卫短暂开窗、前台保活停咕属接受的降级——连接重建后旧 run 大概率随旧连接失败自然终结。
4. **桥的注入时序与降级**：Manager 构造时可不带桥，`NovelMasterProvider` 在 ready 后注入（`setUiBridge` / `setPrefGetter` / `setScopeBridge`，清单见下）。桥未注入期间（bootstrap 早期与 retry 窗口）的降级：失败 toast 与完成通知不发，仅 `console.error` 兜底；refcount 与 RunEntry 维护不依赖桥，始终生效。

**桥清单**（全部经 Provider 注入，Manager 不直接 import React 侧模块）：

- `uiBridge.onError(message: string)`：失败 toast 上浮（`ToastHost`/`showToast`）。
- `prefGetter.isEnabled(): Promise<boolean>`：读「生成结束通知」开关（appUi 通道，见第 4 块）。
- `scopeBridge.getCurrentSessionId(): string | undefined`：React 外读「当前停留会话」。`scope.sessionId` 是 Provider 的 React state，React 外读不到，必须经桥。
- `scopeBridge.setCurrentSession(sessionId: string): Promise<void>`：通知点按路径的 scope 同步。**拍板采用「context 方法经桥注入」**：Provider 闭包内实现为调 `setMobileSession(runtime, projectId, sessionId)` 持久化 + 直接 `setScope(snapshot)` 更新 React state。不在 React 外裸调模块级 `setMobileSession`（它只写持久层、不更新 React scope，点按后会话不切换）；也不走 `refreshScope`（闭包内已有 `setScope`，免一次重读盘）。

**第 2 块：门禁与 UI 状态 per-session 化。**

- `ChatComposer.executeRun` 瘦身：门禁从 `isMobileAgentActive()`（全局）改为「调 `Manager.startRun`，由其 per-session 拒绝」；`endUiRunOnError` 移除（收尾归 Manager）。fire-and-forget 化后 UI 副作用的驱动方式：**清草稿**由 `options.onUserMessageAppended` 回调驱动（append 成功后清批注 + 输入草稿，失败不丢草稿，时机与现状一致）；**chip 刷新与列表刷新**由 `options.onSettled` 驱动（run 终态后 `projectComposerStatusForSession` 刷 chip + `onMessagesChanged`，契约见第 1 块）；与 `useSessionStream` 的 FINISHED 路径双刷新口径钉死：onSettled 的列表刷新定位为**切走 / 无面板场景的补刷**，用户停留当前面板时两条路径各刷一次——双刷幂等，代价是多一次全量 DB 读，可接受，不做去重；「空续跑不走 append 回调」的兑底清草稿也挪进 `onSettled`（若仍未清则清）。`send()` 里「running 时点发送 = 停止」的行为保留（双保险）。
- `useAgentRunLifecycle` 的 `activeRunId` 单值 → per-session（从 Manager 状态投影），`resetUiForSessionChange` 语义按 main-session-stream-resume 的恢复机制改造（切走不清恢复窗口）。
- `agent-activity` 保留全局聚合语义（refcount 由 Manager 驱动）；消费方分流：发送门禁、transcript `agentRunning` 改 per-session；DB 备份/恢复、云同步、StorageConfigScreen 禁用、SessionDetailScreen 压缩守卫**保留全局**（PRD「守卫不回退」；压缩守卫维持全局是拍板取舍：一个会话生成时另一个空闲会话也不能压缩，保守但安全）。

### 与恢复窗口机制的融合（对 main-session-stream-resume）

前置迭代（`Iterations/main-session-stream-resume/spec.md`）的「恢复窗口 + 首事件反填」以 `activeRunId` 为 lifecycle 本地 state 为前提；本 spec 把 activeRunId 改为 Manager 投影后，融合规则钉死如下（规则写在本 spec 侧、不改前置迭代文件；但其中「开窗与合成触发信号替换」一条是对前置迭代开窗输入源的显式替换，本迭代落地后生效）：

- **投影为 null 的两种来源，分别走不同接纳路径**。区分信号来自 Manager 的 `RunEntry.status`：`starting`（已受理、RUN_STARTED 未达）与 `running` 都算「有 run」，entry 缺失才算「无 run」。
  - 来源一（真无 run）：entry 缺失 → 走前置迭代的「无 run 终态」路径，恢复窗口按其关闭条件收敛，不等待。
  - 来源二（RUN_STARTED 未达、事件在途）：entry 处 `starting` → 投影为非 null（UI 侧把 `starting` 与 `running` 同等对待），走前置迭代的「首事件反填」接纳路径——恢复窗口保持开启，等 RUN_STARTED 反填 runId、后续流式事件续上。
- **stale 守卫 `getUiRunning` 与投影的关系**：`getUiRunning` 仍是 abort 单元的本地 UI 乐观状态（beginUiRun 置位），职责不变——过滤「abort 后迟到的 RUN_STARTED」，不参与回页接纳裁决。回页合成路径置位 `uiRunning`（`markRunStarted`）后，迟到的真 RUN_STARTED 不会被该守卫误杀（对齐前置迭代「先合成 uiRunning」的既有时序，见下条信号替换）。回页时的最终裁决以 Manager 投影为准：投影有 run（starting/running）→ 恢复窗口开启等待；投影无 run → 终态收敛，本地 uiRunning 残留由既有 deactivate 路径清理。
- **开窗与合成触发信号替换（本迭代落地后生效）**：前置迭代的恢复窗口开窗与 `markRunStarted` 合成以 `runtime.abortRegistry.has(sid)` 为触发信号；core 的 `register` 要到 `run-agent-turn.ts` 内用户消息 append 之后（L592，之前还有 backfill baseline、resolve agent/model 等一长段 async）才执行，`starting` 期间 `has()` 恒为 false。若维持原信号，`starting` 窗口内切走再切回时：reset 清掉 `uiRunning`，回页重建查 `has()` 为 false、合成不了 `markRunStarted`、恢复窗口不开；迟到的 RUN_STARTED 到达时被 `shouldIgnoreStaleRunStarted = !uiRunning`（`agent-run-lifecycle-helpers.ts:19-25`）直接丢弃，反填永远发生不了——上文「starting 接纳路径」名存实亡。因此本 spec **把开窗与合成的触发信号从 `registry.has` 扩为 `registry.has ∥ Manager 投影（RunEntry 为 `starting` 或 `running`）`**。这是对前置迭代开窗输入源的显式替换（不再宣称「不动前置迭代信号」）：窗口的开闭条件、反填的同步副作用顺序、stale 守卫语义仍按前置迭代定义不变，替换的只有「该不该开窗/合成」这一个判定输入。落地时序：前置迭代先按 `has()` 单信号落地，本迭代合入后该信号即被替换。
- **投影为 activeRunId 的输入源同步替换**：activeRunId 从 lifecycle 本地 state 换成 Manager 投影 + RunEntry 状态（与上一条同一批落地，经 `useAgentRunLifecycle` 投影层适配，不反向要求前置迭代文件改动）。
- **收尾校准探针的输入信号同步替换**：前置迭代的收尾探针（`uiRunning=true` 但 `registry.has(sid)=false` → 校准收尾）同样受 `starting` 空窗影响——starting 窗口内投影置位 uiRunning 而 `has()=false`，若探针触发（回前台 / 30s 轮询）且 starting 横跨 800ms 复询，会误收尾置 uiRunning=false，导致迟到的 RUN_STARTED 被 stale 守卫丢弃、反填链路复发。因此探针的 `isRunRegistered` 输入同批扩为 `registry.has ∥ Manager 投影（starting/running）`。

**第 3 块：后台保持（前台服务）。** 引入 `@notifee/react-native`：run 活跃期间启动前台服务（`dataSync` 类型）展示常驻「正在生成」通知，run 全部结束后停止；`AndroidManifest.xml` 补 `POST_NOTIFICATIONS`、`FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_DATA_SYNC`。传输层现状 XHR 在 JS 线程，前台服务解决后台网络/定时器限制的主体场景；厂商 ROM 强杀不在承诺内（PRD 已声明）。

**系统超时约束（Android 14+ dataSync 上限）**：targetSdk 36（`android/build.gradle`）下，`dataSync` 前台服务受系统约 6 小时运行上限约束——超时后系统回调 `onTimeout` 并停止服务（Android 15+ 要求实现该回调）。降级口径：**对齐「ROM 强杀不在承诺内」的处理方式**——生成业务时长为数十秒到数分钟，远低于 6 小时上限，超时属极端边界；`onTimeout` 后服务停止、进行中请求可能被系统中断，按「应用被外力关闭」的既有口径兑底（已落库内容存活、无恢复承诺）。notifee 对 `onTimeout` 的暴露程度**需在 Step 5 实现时核实**：若未透传，需评估原生侧补 `Service.onTimeout()` 覆写或接受降级。备选取舍（拍板维持 `dataSync`）：`shortService` 上限约 3 分钟，覆盖不了「数分钟」级生成；`specialUse` 需向 Play 声明使用理由、审核成本高；`dataSync` 与「网络请求续跑」语义最贴、上限余量最大。

**第 4 块：完成通知 + 设置开关。**

- 触发（前台/后台口径，**默认口径、用户确认 spec 时可推翻**）：Manager 收到 FINISHED/FAILED 且 **app 在后台**（`AppState.currentState !== 'active'`）时发本地通知——app 在前台（任意页面，含生成中的会话界面）均不发，前台界面自有反馈、避免打扰；通知文案含会话名与成功/失败；失败通知按会话 5 分钟内合并抑制（防频繁失败噪音）。`AppState` 是 RN 模块级 API，Manager 在 React 外可直接读 `AppState.currentState`，无需经桥；若恰好在状态切换瞬间错过，容忍（下次后台结束会发）。
- 点按导航：`RootNavigator` 的 `NavigationContainer` 加 `createNavigationContainerRef`，通知回调里先经 scope 桥 `scopeBridge.setCurrentSession(sessionId)`（持久化 + React scope 同步，见「Manager 装配契约」桥清单）再导航到 Chat tab（会话不是 stack 路由而是 scope 状态，编程式导航比 deep link scheme 改动小且免 Manifest intent-filter）。
- 开关：mobile-only UI 偏好走 `appUi` 通道（`nm-mobile-ui`，与 `chatRichText` 同型）——`storage/app-ui-keys.ts` 加键 + 新 `storage/agent-finished-notification-pref.ts` + `ChatConfigScreen` 加 `ProfileSwitchItem`（`persistSwitchWithRollback` 模式），默认开启。Manager（React 外）读开关经 Provider 注入的 getter 桥。
- 权限：Android 13+ `POST_NOTIFICATIONS` 运行时权限，申请时机钉死为**首次发起 run 且通知开关为开时**（不在 app 启动时、不在设置页预申请，尽量晚打扰）；**拒绝时降级**：前台保活照常（前台服务通知受同一权限影响，系统层面可能不展示，但服务本身继续）、完成通知不发、不重复骚扰申请。

**范围边界（拍板）**：iOS 本次不承诺后台保活与通知（并行与 app 内保持天然跨平台生效；iOS 后台手段另立项）；`SessionDetailScreen` 压缩守卫维持全局口径。

## 最终项目结构

新增：

- `apps/mobile/src/services/agent-run-manager.service.ts` — app 级编排（门禁、activeRuns、事件驱动 refcount、通知触发、前台服务起停）
- `apps/mobile/src/services/agent-finished-notification.ts` — 通知发送 + 权限 + 点按回调注册（notifee 封装）
- `apps/mobile/src/storage/agent-finished-notification-pref.ts` — appUi 偏好读写

修改：

- `apps/mobile/src/components/chat/ChatComposer.tsx` — 门禁与发起迁移
- `apps/mobile/src/hooks/useAgentRunLifecycle.ts` — activeRunId per-session 化（Manager 投影）
- `apps/mobile/src/screens/tabs/chat-tab/{ChatTabProvider,ChatConversationPanel}.tsx` — context 字段语义（`agentActive` 拆 per-session 视图）、错误 toast 桥
- `apps/mobile/src/runtime/{create-mobile-runtime.ts,agent-activity.ts,novel-master-context.tsx}` — Manager 装配（类型字段、Provider 内实例化与桥注入、retry 重建时先 dispose）、refcount 收口
- `apps/mobile/src/navigation/RootNavigator.tsx` — navigationContainerRef
- `apps/mobile/src/screens/stack/ChatConfigScreen.tsx` — 通知开关
- `apps/mobile/src/storage/app-ui-keys.ts` — 新键
- `apps/mobile/android/app/src/main/AndroidManifest.xml` — 权限与 foregroundServiceType
- `apps/mobile/package.json` — `@notifee/react-native`

## 变更点清单

（见上表；关键语义变更：`agent-activity` 的增减触发方从 `useAgentRunLifecycle` 改为 Manager——increment 在 `startRun` 受理路径同步执行，decrement 由事件订阅驱动；`useAgentRunLifecycle` 保留 uiRunning/activeRunId 的 UI 侧状态与守卫，但 refcount 归属移交。）

## 详细实现步骤

- Step 1 — phase-manager-core — blocking: yes — qa: auto：新建 `AgentRunManager`：`startRun`（per-session 门禁钉死「RunEntry 存在（starting/running）或 `abortRegistry.has`」 + fire-and-forget + options 契约 + 受理路径同步 increment）、全量事件订阅、per-session RunEntry（含 `starting` 状态）、事件驱动 decrement（RUN_STARTED 只迁移 entry 状态，不碰 refcount）、promise 链尾 finally 早退兑底（RUN_STARTED 未达即抛错 → 清 entry + decrement）、可注入 UI/pref/scope 桥；同步落地「Manager 装配契约」：`novel-master-context.tsx` 内实例化挂 runtime、retry 重建时先 dispose（退订 + refcount 清零 + 停前台服务）再 `closeMobileConnection()`；单测：并行两 session 互不阻塞、同 session 二次 startRun 被拒（registry 已注册与 entry 处 `starting` 两个信号各验一次）、切走会话后 FINISHED 仍正确 decrement（修泄漏）、startRun 后未收到 RUN_STARTED 即抛错 → refcount 回落、dispose 后模块级 refcount 归零。
- Step 2 — phase-composer-migrate — blocking: yes — qa: auto：`ChatComposer.executeRun` 迁移到 `Manager.startRun`（移除 `isMobileAgentActive` 门禁与 `endUiRunOnError` 的 refcount 职责）；UI 副作用改由 options 回调驱动：清草稿走 `onUserMessageAppended`、chip 刷新与列表刷新走 `onSettled`；失败 toast 经桥上浮；`agent-run.service.integration.test.ts` 更新，补「append 后清草稿、结束后 chip 刷新」单测。
- Step 3 — phase-lifecycle-persession — blocking: yes — qa: auto：`useAgentRunLifecycle` activeRunId 改 Manager 投影（per-session），恢复窗口开窗/合成触发信号从 `registry.has` 扩为 `registry.has ∥ Manager 投影（starting/running）`（融合规则见专节），`ChatTabProvider` context 字段（`agentActive` 拆「当前会话运行中」与「全局任意运行中」两个视图），`ChatConversationPanel` 消费点对应改造；`use-agent-run-lifecycle.test.ts` / `agent-activity.test.ts` 扩展。**依赖 main-session-stream-resume 的恢复机制先落地**。
- Step 4 — phase-notify-infra — blocking: yes — qa: auto：引入 notifee、Manifest 权限、通知模块（channel、完成通知发送、失败 5 分钟合并、权限申请（时机：首次发起 run 且开关为开）与拒绝降级）、`navigationContainerRef` + 点按回调（`scopeBridge.setCurrentSession` + 导航 Chat tab）；通知触发条件单测（app 在后台才发，前台任意页面不发，AppState mock）。
- Step 5 — phase-fgs-keepalive — blocking: yes — qa: manual_user：run 活跃期间前台服务（dataSync）常驻「正在生成」通知，全部 run 结束后停止；核实 notifee 对 `onTimeout` 的暴露程度（未透传则评估原生侧覆写或降级，见第 3 块系统超时约束）；Android 13+ 真机验证退后台 / 锁屏 5 分钟请求不断。
- Step 6 — phase-pref-switch — blocking: yes — qa: auto：appUi 偏好键 + 读写模块 + `ChatConfigScreen` 开关（默认开、`persistSwitchWithRollback`）；关闭后完成通知不发、保活不变的单测。
- Step 7 — phase-parallel-notify-manual — blocking: no — qa: manual_user：真机验收：双会话并行各自完成、后台完成点按直达会话、app 在前台（含停留生成中会话）时不发通知、开关关闭、备份/同步守卫不回退、主动杀 app 后重进无「生成中」残留且已落库内容完整。

## 测试策略

单测集中在 Manager（node:test + mock runtime，参照 `agent-run.service.integration.test.ts` 与 desktop `agent.ts` 的生命周期形状）与偏好/开关；真机项（前台服务、通知点按、并行实测）走 manual_user。

### 测试用例

- T-P1 — blocking: yes — 并行：session A run 进行中 `startRun(B)` 正常受理，两者事件与状态互不串扰（映射 Step 1）
- T-P2 — blocking: yes — 单会话串行：`abortRegistry.has(A)=true` 时 `startRun(A)` 被拒绝且返回明确错误；**entry 处 `starting`（RUN_STARTED 未达、registry 尚未 register 的受理空窗）时二次 `startRun(A)` 同样被拒**（映射 Step 1）
- T-P3 — blocking: yes — refcount 事件驱动：切走会话后其 FINISHED 仍触发 decrement，全局 busy 不卡死（修泄漏，映射 Step 1）
- T-P4 — blocking: yes — 通知触发：run 结束且 app 在后台 → 发通知；app 在前台（任意页面，含当前停留会话）→ 不发（AppState mock，映射 Step 4）
- T-P5 — blocking: yes — 失败合并：同会话 5 分钟内多次失败只发一条（映射 Step 4）
- T-P6 — blocking: yes — 开关：偏好关闭后完成通知不发、前台保活与并行行为不变（映射 Step 6）
- T-P7 — blocking: yes — 守卫：任意 run 活跃期间备份 / 云同步 / 压缩不被触发（`agent-activity.test.ts` 扩展，映射 Step 1/3）
- T-P8 — blocking: no — 真机：锁屏 5 分钟回进度、通知点按直达、杀 app 重进无残留（映射 Step 5/7）
- T-P9 — blocking: yes — 早退兑底：`startRun` 后未收到 RUN_STARTED 即抛错 → finally 清 entry 并 decrement，refcount 回落、后续 run 不被 AGENT_BUSY 卡死（映射 Step 1）
- T-P10 — blocking: yes — UI 副作用迁移：`onUserMessageAppended` 后清批注与输入草稿（失败不清）、`onSettled` 后 chip 刷新与列表刷新（映射 Step 2）
- T-P11 — blocking: yes — starting 接纳：`startRun(A)` 受理后（RUN_STARTED 未达）切走再切回，恢复窗口经 Manager 投影（entry `starting`）开启并合成置位 `uiRunning`，迟到的 RUN_STARTED 被接纳并反填 runId、不遭 stale 守卫丢弃（映射 Step 1/3）

## 风险与回滚方案

- **refcount 语义迁移是最大风险**：增触发方换到受理路径、减触发方换到 Manager 事件订阅，迁移期若两条路径并存会双计——Step 1/2 必须同批合入，`agent-activity.test.ts` 扩展「单一归属」用例守护。
- **前台服务的 ROM 差异**：厂商省电策略仍可能强杀，PRD 已声明不在承诺内；前台服务起停与 run 生命周期严格绑定（有活跃 run 才启动，全空闲即停止），避免常驻耗电投诉。
- **notifee 新原生依赖**：需重新构建 APK；锁版本、验证 debug/release 两套构建；若集成受阻，回滚方案是砍掉 Step 5（保活）与通知仅保留并行能力（Step 1-3 独立成立，不依赖 notifee）。
- **回滚分界**：Step 1-3（编排与并行）与 Step 4-6（通知与保活）是两个独立可回滚批次；前者 revert 恢复全局单 run 现状，后者 revert 仅失去通知/保活、并行不受影响。
- **iOS**：本次不承诺；并行与 app 内保持不依赖原生侧，天然跨平台生效。
