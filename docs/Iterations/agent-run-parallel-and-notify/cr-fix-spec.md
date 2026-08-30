# CR Fix Spec: feat/agent-run-parallel-and-notify 分支评审修复（review-parallel round 1）

## 元信息

- repo: `.woktree/parallel-notify`（分支 feat/agent-run-parallel-and-notify）
- base_sha: `6c8a872`
- head_sha: `ce289b4`
- prd_path: `docs/Iterations/agent-run-parallel-and-notify/prd.md`（只读参考，勿改）
- spec_path: `docs/Iterations/agent-run-parallel-and-notify/spec.md`（只读参考，勿改）
- review_round: 1（review-parallel）
- dag_version: 2
- must-fix 总数: 8（P1 ×3，P2 ×5）
- 本 wave 范围: 全部 must-fix（P1 ×3 + P2 ×5；改动集中在 `agent-run-manager.service.ts` 与 `agent-finished-notification.ts` 两个文件，无跨条目冲突）
- 状态: draft

> 说明：本 spec 只描述「要怎么修」，不包含实现代码。下游执行节点按本 spec 落地实现，落地后回填状态。
> 行号以 head_sha `ce289b4` 的工作区为准，实现时如有漂移按符号定位。

---

## Must-fix（按 P1 → P2）

### P1

#### parallel/MF-1 — FAILED 事件未做 entry/runId 所有权校验就弹错误 toast

- **严重度**: P1
- **维度**: B（正确性 / 误报）
- **文件**: `apps/mobile/src/services/agent-run-manager.service.ts`（`onRunFailed`，约 L284–L288）
- **问题**:
  `onRunFailed` 里 `this.uiBridge?.onError(payload.error)` 在 `finishRun` 的 entry/runId 匹配之前无条件执行。而 Manager 是全量订阅 `EVENT_AGENT_RUN_FAILED`（不经 UI 面板过滤），core 的子会话 run 以 `publishRunLifecycle: true` 发事件（`run-agent-turn.ts` 约 L840–L842），所以父 run 正常进行时，每个失败的 subagent 任务都会让 Manager 弹一条错误 toast；同理 retry 重建连接后，旧连接产生的 FAILED 事件也会误弹。`finishRun` 里的所有权校验（entry 存在且 `entry.runId === runId`）只保护了收尾，没保护 toast。
- **改法**:
  把 `uiBridge?.onError(payload.error)` 移入所有权校验之后的路径——即 `finishRun` 匹配成功（entry 存在且 runId 相等）且 `status === 'failed'` 时才弹 toast。实现上二选一：
  1. 在 `finishRun` 匹配成功的分支里、`status === 'failed'` 时触发 `uiBridge?.onError(...)`（推荐，收口一处）；
  2. 或在 `onRunFailed` 里先做同样的 entry/runId 预检，匹配才弹。
  注意 MF-6 的 `console.error` 兜底也要放在同一匹配分支内，避免无主 FAILED 事件刷日志。
- **验收/测试**:
  - 补测试：publish 一条「无 entry」的 FAILED 事件（以及一条 runId 不匹配的 FAILED），断言 `uiBridge.onError` 未被调用（无 entry 的 FAILED 事件不弹 toast）。
  - 回归：既有「失败路径弹一次 toast」的用例仍绿（与 throw 路径的防双 toast 逻辑不冲突——throw 路径只在 `current.runId == null` 时弹，事件路径移入匹配分支后两条路径仍然互斥）。
- **来源**: review-parallel / round 1

#### parallel/MF-2 — RUN_STARTED 已达但无终态事件时，finally 早退导致 entry/refcount 永久泄漏

- **严重度**: P1
- **维度**: B（正确性 / 资源泄漏）
- **文件**: `apps/mobile/src/services/agent-run-manager.service.ts`（`startRun` 的 `.finally`，约 L237–L254）
- **问题**:
  `.finally` 里的判定是 `current !== entry || current.runId != null` 时早退。存在一个理论窗口：`RUN_STARTED` 事件已达（entry.runId 已回填为非 null），但 core 在 `RUN_STARTED` publish 之后、主 try 之前抛错（`agent-runner.ts` 约 L238–L325 窗口，例如 `savedModels.findById` 抛错），此时既没有 FINISHED 也没有 FAILED 终态事件，finally 又因 `runId != null` 早退——entry 永不清、模块级 refcount 永不回落、`isMobileAgentActive()` 永久 true，保活服务也停不下来。
  时序依据：事件总线是同步分发的。如果事件路径已经收尾过（FINISHED/FAILED 处理完成），那么 finally 执行时 `entries.get(sessionId)` 必然已经不等于 entry（要么已 delete，要么已被新一轮 startRun 替换）——`current === entry` 且 `runId != null` 且事件路径还会再来的组合不存在。因此在 finally 里只要 `current === entry` 就一律收尾，是严格安全的。
- **改法**:
  `.finally` 判定改为仅 `current === entry` 即执行 `entries.delete` + `decrementAgentActive()` + `void this.syncKeepAlive()`（去掉 `runId != null` 的早退条件）。同时在注释里写明安全性依据：「事件总线同步分发，事件路径收尾过则此刻 entry 必已删除/替换；`current === entry` 时不可能再有终态事件来双减」。
- **验收/测试**:
  - 补测试：`RUN_STARTED` 已达（entry.runId 已回填）但 `runAgentTurn` promise reject 且不发 FAILED 事件 → 断言 entry 被清、refcount 回落（`isMobileAgentActive()` 回 false）。
  - 回归：既有「无 RUN_STARTED 早退收尾」「正常 FINISHED 收尾」用例仍绿（可顺带断言 FINISHED 正常路径不会双减——refcount 不为负）。
- **范围备注**: desktop `agent.ts` 是同形状、同理论窗口，另行立项，不在本 spec 范围内。
- **来源**: review-parallel / round 1

#### parallel/MF-3 — 通知点按只挂 onForegroundEvent，后台点按主场景大概率不触发导航

- **严重度**: P1
- **维度**: A（需求符合性）
- **文件**: `apps/mobile/src/services/agent-finished-notification.ts`（`registerAgentNotificationTapHandling`，约 L190–L203）
- **问题**:
  点按处理只注册了 `notifee.onForegroundEvent`。PRD 的主场景是「后台收到完成通知后点按直达会话」，而 notifee 在 app 处于后台时事件走 `onBackgroundEvent`（headless 任务），后台点按大概率不触发 `onForegroundEvent` 的回调——「点按直达会话」的验收标准落空。现有单测 mock 的是 `onForegroundEvent`，发现不了这个问题。
- **改法**:
  补 `notifee.onBackgroundEvent` 的 PRESS 处理，与 foreground 共用同一个 `tapHandler`。后台路径的导航天然要等 app 回前台后才生效，可以只做 scope 切换 + 容器 ready 后导航（`navigateToChatTabFromNotification` 已有 `isReady()` 守卫，可复用；若 headless 里导航不可达，则记录待导航意图、回前台后消费，实现时按真机行为取最小可行方案）。**notifee 9.x API 事实（已对照 9.1.8 类型定义）**：`onBackgroundEvent(observer)` 返回 `void`，没有 unsubscribe、不可动态退订——只能模块级注册一次，内部 handler 引用替换（即现有 `tapHandler` 单变量覆盖模式的延伸）；observer 签名必须返回 `Promise<void>`（headless 任务语义，notifee 等 promise 结束才标记任务完成）；注册时机应尽量提前（模块级而非 Manager 构造时，避免 app 存活但 runtime 未装配时 headless 事件到达而 handler 未就绪）。
- **验收/测试**:
  - 单测：mock notifee 的 `onBackgroundEvent`，触发携带 sessionId data 的 PRESS，断言 tapHandler 被调用。
  - 真机验证后台点按全链路（并入 Step 7 manual，见「K 节建议」）。
- **来源**: review-parallel / round 1

---

### P2

#### parallel/MF-4 — 保活起停无串行化：stop 在途期间 start 被挡、异常时标记永久卡死、无 catch

- **严重度**: P2
- **维度**: B（竞态 / 健壮性）
- **文件**:
  - `apps/mobile/src/services/agent-finished-notification.ts`（`startAgentKeepAliveService` / `stopAgentKeepAliveService` / 模块级 `keepAliveRunning`，约 L46、L156–L182）
  - `apps/mobile/src/services/agent-run-manager.service.ts`（`syncKeepAlive` 定义约 L334；无 catch 的调用点为 L247、L301 两处）
- **问题**:
  三个叠加缺陷：
  1. 起停无串行化：会话 A 收尾触发的 `stopAgentKeepAliveService` 在途（`stopForegroundService` promise 未决、`keepAliveRunning` 尚未复位）期间，会话 B 受理新 run 触发 `startAgentKeepAliveService`，后者看到 `keepAliveRunning === true` 直接 no-op——B 的 run 没有前台服务保护。
  2. `stopForegroundService()` 抛错时 `keepAliveRunning = false`（L181）不会执行，标记永久卡 true，之后所有 start 都 no-op。
  3. `void this.syncKeepAlive()` 的调用点没有 catch，start/stop 任一 reject 都是 unhandled rejection。
- **改法**:
  1. 起停经同一 promise 链串行（模块级队列 promise，`syncKeepAlive` 的每次决策排到链尾执行）；或采用「期望态 + reconcile」——记录期望运行态，链式排队执行并对齐期望态（stop 在途时来了 start，最终收敛为运行）。
  2. `stopAgentKeepAliveService` 的 stop 路径用 try/finally 复位 `keepAliveRunning`，保证异常时标记不卡死。
  3. Manager 侧所有 `void this.syncKeepAlive()` 调用点补 `.catch(() => undefined)`（或等价吞错并 console.error 记录）。
- **验收/测试**:
  - 补测试（mock notifee）：`stopForegroundService` 挂起未决期间触发 start（期望态变为运行），断言链收敛后前台服务处于运行（`displayNotification` 的保活通知最终发出 / 期望态对齐为 running）。
  - 补测试：`stopForegroundService` reject 后 `keepAliveRunning` 已复位，后续 start 能正常发起。
- **来源**: review-parallel / round 1

#### parallel/MF-5 — onForegroundEvent 的 unsubscribe 被丢弃，listener 随 retry 重建累积泄漏

- **严重度**: P2
- **维度**: C（资源泄漏）
- **文件**:
  - `apps/mobile/src/services/agent-finished-notification.ts`（`registerAgentNotificationTapHandling`，约 L190–L203）
  - `apps/mobile/src/services/agent-run-manager.service.ts`（构造器调用处约 L152、`dispose` 约 L350）
- **问题**:
  `registerAgentNotificationTapHandling` 返回的 unsubscribe（`notifee.onForegroundEvent` 的退订函数）在 Manager 构造器里被丢弃。Provider retry 重建 runtime 时会 new 一个新 Manager、再注册一次 listener，旧 listener 永远退不掉，随 retry 累积泄漏（cr-func 轮已提过此轻微项，本轮仍未修）。
- **改法**:
  Manager 只保存 `onForegroundEvent` 的 unsubscribe（如 `this.offNotificationTap`），`dispose()` 里调用退订；`onBackgroundEvent` 按 MF-3 修订口径为模块级一次注册、handler 引用替换，Manager 不持有其退订（该 API 返回 void）。`tapHandler` 是模块级单变量、后注册覆盖先注册，行为上无重复触发。
- **验收/测试**:
  - 补测试：mock notifee，构造 Manager 后 dispose，再构造再 dispose，断言 listener 注册次数与退订次数对齐（净值不随重建累积）。
- **来源**: review-parallel / round 1（cr-func 轮遗留项）

#### parallel/MF-6 — onRunFailed 在 uiBridge 未注入时既无 toast 也无日志

- **严重度**: P2
- **维度**: A（spec 符合性 / 可观测性）
- **文件**: `apps/mobile/src/services/agent-run-manager.service.ts`（`onRunFailed` / `finishRun`，随 MF-1 调整后的落点）
- **问题**:
  `this.uiBridge?.onError(payload.error)` 在 `uiBridge == null` 时静默跳过——run 失败既没有 toast 也没有任何日志。spec 已钉死：桥未注入期间用 `console.error` 兜底（与装配契约「未注入期间 console 兜底」口径一致）。
- **改法**:
  在 MF-1 移入的匹配分支内补兜底：`uiBridge` 存在走 `onError`；为 null 时 `console.error('[novel-master/agent-run-manager] run failed (uiBridge not ready)', {sessionId, runId, error})`。注意兜底放在匹配分支内，避免无主 FAILED 事件（MF-1 场景）刷日志。
- **验收/测试**:
  - 补测试：不注入 uiBridge，publish 一条匹配的 FAILED 事件，断言 `console.error` 被调用（spy 断言）。
- **来源**: review-parallel / round 1

#### parallel/MF-7 — AgentRunScopeBridge.getCurrentSessionId 是死代码

- **严重度**: P2
- **维度**: C（死代码）
- **文件**:
  - `apps/mobile/src/services/agent-run-manager.service.ts`（`AgentRunScopeBridge` 接口声明，约 L95）
  - `apps/mobile/src/runtime/novel-master-context.tsx`（注入处实现，约 L166）
- **问题**:
  `getCurrentSessionId` 的接口声明与 Provider 侧注入俱全，但整个消费链上没有任何调用方——死代码。注意区分：`mobile-scope.ts` L21 的 `runtime.state.getCurrentSessionId()` 是 core state API，与此桥方法无关，不受影响。
- **改法**:
  删除 `AgentRunScopeBridge` 接口里的 `getCurrentSessionId` 声明和 `novel-master-context.tsx` 注入处对应的实现。Step 3 融合阶段若确需「React 外读当前会话」，再加回来并在注释里注明用途与消费方。
- **验收/测试**:
  - typecheck 绿。
  - grep `getCurrentSessionId` 在桥相关路径（manager 接口 + context 注入）无残留；core state API 调用处不受影响。
- **来源**: review-parallel / round 1

#### parallel/MF-8 — notifyAgentRunFinished 无平台门禁，iOS 会走到 Android-only API

- **严重度**: P2
- **维度**: B（平台边界）
- **文件**: `apps/mobile/src/services/agent-finished-notification.ts`（`notifyAgentRunFinished`，约 L110–L148）
- **问题**:
  `notifyAgentRunFinished` 入口没有平台判断，iOS 上会一路走到 `ensureChannels`（`createChannel` 是 Android-only API）和带 `android` channel 配置的 `displayNotification`，行为未定义。spec 明确本次 iOS 不承诺通知。
- **改法**:
  入口加 `if (Platform.OS !== 'android') { return; }` 直接返回，与保活起停（`startAgentKeepAliveService` / `stopAgentKeepAliveService`）的门禁口径一致。失败合并窗口的写入在平台门禁之后（放在 return 之后），避免 iOS 上污染窗口状态。
- **验收/测试**:
  - 补测试（mock `Platform.OS = 'ios'`）：调用 `notifyAgentRunFinished`，断言 `displayNotification` / `createChannel` 未被调用。
- **来源**: review-parallel / round 1

---

## Spec deviations

- **parallel-step3-defer — open**：Step 3 主体（`activeRunId` per-session 化 / ChatTabProvider·useSessionStream context 拆分 / 融合信号扩容 / T-P11）延后至与 main-session-stream-resume 的融合阶段。已登记为偏差，**待用户确认收窄**（接受延后 or 本轮补齐），不阻塞本 wave 的 8 项 must-fix。
- **endUiRunOnError 保留 — fixed**：实现保留了 run 失败时的 UI 终态收口，与 spec 一致，无需再动。
- **onRunXxx decrement 移入 Manager — fixed**：事件订阅路径的 decrement 已由 Manager 统一负责（`finishRun` 收口），符合拍板结论。
- **失败双 toast — fixed（35ed6fd）**：throw 路径与事件路径的互斥判定已落地，本轮 MF-1 是它的延伸（事件路径自身的所有权校验），不冲突。
- **T-P7 守卫组 — fixed（54bb4b0）**：相关守卫测试已补齐。

## Open questions / 待拍板（不阻塞修复，随修复批次顺带确认）

1. **notifee onTimeout 暴露程度**：spec Step 5 要求实现时核实，实现已合入但未核实——这是一次未登记的口径漂移，现明示登记：留待真机阶段核实（涉及 dataSync 约 6 小时上限的兑底口径）。
2. **MF-3 后台点按行为**：不同 Android 版本 / ROM 上 `onBackgroundEvent` 的触发时机报告不一，修复前建议真机确认一次，避免按错误假设实现。
3. **点按 stale sessionId**：`setMobileSession` 不校验会话存在性，通知携带的 sessionId 若已被删除会切到空/无效会话——接受现状还是加校验（不存在时落回当前会话或首页），待拍板。
4. **权限申请瞬态失败也永久不再申请**：`permissionEnsured` 在 `requestPermission` 之前置位（约 L266），申请本身抛错（瞬态失败）后也永久跳过——要不要只在「明确申请过一次」时置位（把置位移到 `ensureAgentNotificationPermission` 成功返回后，或让其返回申请结果）。
5. **失败合并窗口在发送前写入**：`lastFailedNotifyAt.set` 在 `displayNotification` 之前执行（约 L125），通知发送失败也会消耗 5 分钟窗口，期间真实失败不再通知——可接受否，待拍板。

## 已豁免

- 无。（本 round 无豁免条目。）

## 合并后 QA

- 真机 manual（对应 Step 7，随 MF-3 一并验证）：后台点按直达会话（MF-3 全链路）、锁屏 5 分钟保活、双会话并行（refcount 与保活起停）、杀 app 后无残留通知/服务。

## K 节建议（下游执行时闭合）

1. **定向测试**（六个套件，改动直接相关）：`agent-run-manager.service` / `agent-finished-notification` / `agent-finished-notification-pref` / `agent-activity` / `chat-composer.integration` / `use-agent-run-lifecycle`。
2. **全量 jest**：`apps/mobile` 全量，防远处回归。
3. **typecheck**：全仓 typecheck 绿（MF-7 删接口方法后重点看 context 注入处）。
4. **lint**：本节点只留步骤不跑（沿用本 CR 的收尾口径），下游统一闭合。
5. **真机 manual**：后台点按直达（对应 MF-3）、锁屏 5 分钟、双会话并行、杀 app 无残留（见「合并后 QA」）。
