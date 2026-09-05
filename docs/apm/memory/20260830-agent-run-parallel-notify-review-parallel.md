# review-parallel 节点：agent-run-parallel-and-notify diff 深审（cr）

## 2026-08-30 请求

用户要求在 worktree `/home/bloodycrown/Dev/novel-master/.woktree/parallel-notify`（readonly，禁止修改）做单轮深审：

- BASE_SHA `6c8a872` → HEAD_SHA `ce289b4`，`git diff 6c8a872..ce289b4`
- 对照 spec（Step 矩阵 + 测试矩阵 T-P1~T-P11）与 PRD，检查维度 B–K 全维（含 C-orch）
- 已登记 deviation：parallel-step3-defer；已修复：失败双 toast、T-P7 守卫组；cr-func 留过 onForegroundEvent listener 累积轻微项
- 产出：diff 摘要 / must-fix / open_questions / spec_deviations / 结论（通过 | 需产出 fix-spec | 阻塞）
- cr-fix-spec 尚未创建；K 节只给收尾步骤不跑 lint

## 评审结论（要点）

结论：需产出 fix-spec。P1 三项：

1. `onRunFailed` 未做 entry/runId 所有权校验就 `uiBridge.onError` —— core 子会话 run（run-agent-turn.ts L840-842 publishRunLifecycle:true）失败与 retry 重建后旧连接失败的 FAILED 事件都会误弹 toast。改法：toast 移入 finishRun 匹配分支。
2. RUN_STARTED 已达但 core 主 try 前抛错（agent-runner.ts L238–L325 窗口，如 savedModels.findById）无 FAILED 事件，Manager `.finally` 因 `runId != null` 早退 → entry/refcount 永久泄漏。事件总线是同步的（事件路径收尾过则 finally 时 entry 必已删），finally 里 `current === entry` 一律收尾是严格安全的。desktop agent.ts 同形状、同理论窗口（对称但不代表正确）。
3. 后台点按通知主场景可能收不到 `onForegroundEvent`（notifee 后台期事件走 onBackgroundEvent/headless）→ 点按只开 app 不切会话。需补 onBackgroundEvent PRESS 或真机验证。

P2 若干：保活起停竞态（stop 进行中 start no-op → 在途 run 无前台服务；stopForegroundService 抛错时 keepAliveRunning 永久卡 true 且 syncKeepAlive 无 catch）；onForegroundEvent listener 随 retry 累积（cr-func 旧项未修）；onRunFailed 桥未注入时无 console.error 兜底（违反 spec 降级口径）；`getCurrentSessionId` 桥死代码；iOS 通知无平台门禁。

deviation 核对：parallel-step3-defer 属实（activeRunId 仍本地态、ChatTabProvider agentActive 仍全局、T-P11 未落地）；双 toast 修复与 T-P7 守卫组已核实落地；C-orch 单入口收敛核实（startRun 仅 ChatComposer 一处调用，MessageEditModal 只改不跑）。

## 2026-08-30 spec-fix-parallel 节点（后续追加）

### 请求

按上节评审结论产出 fix-spec：在 worktree `.woktree/parallel-notify` 新建 `docs/Iterations/agent-run-parallel-and-notify/cr-fix-spec.md`（只改文档不改实现）。范围=全部 must-fix（P1×3 + P2×5），元信息 base_sha=6c8a872、head_sha=ce289b4、review_round=1、dag_version=2、状态 draft。spec.md/prd.md 只读参考。

### 产出

- 新建 cr-fix-spec.md：MF-1（onRunFailed 的 onError 移入 finishRun 匹配分支）/ MF-2（finally 仅判 current===entry 即收尾，依据=事件总线同步分发）/ MF-3（补 onBackgroundEvent PRESS，共用 tapHandler）/ MF-4（保活起停 promise 链串行 + try/finally 复位 + 调用点 catch）/ MF-5（保存 unsubscribe，dispose 退订）/ MF-6（uiBridge null 时 console.error 兜底）/ MF-7（删除 AgentRunScopeBridge.getCurrentSessionId 死代码）/ MF-8（notifyAgentRunFinished 入口 Android 门禁）。每条含 id/严重度/维度/文件/问题/改法/验收/来源（review-parallel round 1），行号已对照 ce289b4 工作区核实。
- open_questions 附录 5 条：notifee onTimeout 暴露程度（真机核实）、MF-3 后台点按真机确认、点按 stale sessionId 校验与否、permissionEnsured 前置位、失败合并窗口发送前写入。
- spec deviations：parallel-step3-defer=open 待用户确认收窄；endUiRunOnError 保留 / onRunXxx decrement 移入 Manager / 失败双 toast（35ed6fd）/ T-P7 守卫组（54bb4b0）=fixed。
- K 节：定向六套件（agent-run-manager.service / agent-finished-notification / agent-finished-notification-pref / agent-activity / chat-composer.integration / use-agent-run-lifecycle）→ 全量 jest → typecheck → lint（留步骤不跑）→ 真机 manual（后台点按直达、锁屏 5 分钟、双会话并行、杀 app 无残留）。
- desktop agent.ts 同形状 finally 窗口问题：MF-2 内注明另行立项，不在本 spec 范围。

## 2026-08-30 fix-cr-parallel 节点（执行 cr-fix-spec 8 条 must-fix）

### 请求

在 worktree `.woktree/parallel-notify`（分支 feat/agent-run-parallel-and-notify，基线 0184f44）按 cr-fix-spec 闭合全部 8 条 must-fix（P1×3 + P2×5），按逻辑块中文 commit，验证全量 jest + typecheck，不动 docs/Iterations/。

### 实现与提交（4 个逻辑块）

1. `2bb2a2c` MF-4/MF-8（agent-finished-notification.ts）：start/stop 改期望态 + promise 链串行（enqueueKeepAliveSync 写期望态、reconcileKeepAlive 链尾对齐；stop try/finally 复位标记）；notifyAgentRunFinished 入口 `Platform.OS !== 'android'` 门禁，失败合并窗口写入移到门禁后。notifee mock 补 onBackgroundEvent、单独暴露 onForegroundEventUnsubscribe。
2. `d893625` MF-3/MF-5：onBackgroundEvent 模块级一次注册（返回 void 不可退订、handler 引用替换、与 onForegroundEvent 共用 tapHandler、observer 返回 Promise<void>）；headless 里导航不可达时记 pendingTapNavigation，AppState 回前台消费；Manager 保存 onForegroundEvent 退订函数、dispose() 退订。
3. `fd8e098` MF-1/MF-2/MF-6（manager）：onError 移入 finishRun 匹配分支（failed 时；uiBridge null 走 console.error 兜底，均在分支内防无主事件刷日志）；finally 判定改仅 `current === entry` 即收尾（注释含同步总线时序依据 + finishRun 所有权双保险）；syncKeepAlive 调用点（原 L247/L301）统一走 syncKeepAliveQuietly（catch + console.error）。
4. `3d3bd4b` MF-7：删 AgentRunScopeBridge.getCurrentSessionId 声明与 novel-master-context.tsx 注入。

### 关键实现决策 / 偏离

- MF-3 的 onBackgroundEvent 模块级注册**不加 Platform 门禁**（spec 只要求注册提前）：onBackgroundEvent 是跨平台 API，iOS 注册无害；而 registerForegroundService 是 Android-only 才有门禁。不加门禁同时保证 jest（preset 默认 OS='ios'）里模块级注册可被 mock 捕获、可测。
- MF-4 选「期望态 + reconcile」而非纯串行队列：期望态在入队时写入，stop 在途期间 start 到来有两种收敛路径（未执行的 stop 直接跳过 / stop 完成后补 start），测试两种时序都覆盖。
- 测试适配：T-P4/T-P5 既有用例补 `Platform.OS='android'`（MF-8 门禁的必然结果）；模块级注册的断言须在测试文件顶层（import 后立即）捕获——beforeEach 的 clearAllMocks 会清掉 import 时的调用记录。
- jest 坑：clearAllMocks 不清 mockImplementationOnce 队列，挂起的 Once 会泄漏到下个用例造成超时（MF-4 首版测试踩过）。

### 验证

- 定向：agent-finished-notification（17 passed）、agent-run-manager.service（19 passed）、agent-finished-notification-pref 全绿。
- 全量：`npx jest`（apps/mobile）186 suites / 1105 tests 全过。
- `npm run typecheck`（root + mobile + web + e2e）绿。
- 新增测试：MF-1（无 entry / runId 不匹配不弹且不误收尾）、MF-2（RUN_STARTED 已达 reject 无终态 → refcount 回落）、MF-3（后台 PRESS 触发 tapHandler / 非 PRESS 不触发 / 待导航意图回前台消费）、MF-4（stop 在途 start 生效 / reject 后标记复位 / 期望态回切跳过未执行 stop）、MF-5（注册退订净值对齐）、MF-6（兜底日志 + 无主不刷日志）、MF-8（iOS 不触碰 Android-only API / 不消耗失败合并窗口）。

### 遗留

- 真机 manual 未做（后台点按全链路、锁屏 5 分钟保活、双会话并行、杀 app 无残留）——合并后 QA 项。
- lint 留步骤未跑（沿用 CR 收尾口径）；open_questions 5 条待拍板；parallel-step3-defer 待用户确认收窄。

## 第 N 轮：cr-func-cr-parallel（fix wave 复核，readonly）

日期：2026-08-30。范围 `git diff 0184f44..3d3bd4b`（4 提交，MF-1~8 全部），对 cr-fix-spec 逐条实质闭合核验。

结论：**func-ready: yes**，无 must-fix、无未登记偏离。

- MF-1/2/5/6/7 落在 agent-run-manager.service.ts（onError+兜底日志收口进 finishRun 匹配分支；finally 仅 `current === entry` 单一归属 + 同步总线时序注释；offNotificationTap 保存退订；getCurrentSessionId 已删，残留仅在 core persistent-state API / mobile-scope.ts，属 spec 豁免路径）。
- MF-3/4/8 落在 agent-finished-notification.ts（onBackgroundEvent 模块级一次注册 + pendingTapNavigation 回前台消费；enqueueKeepAliveSync 期望态入队 + reconcileKeepAlive 链尾对齐，stop try/finally 复位标记；Platform 门禁在最前、合并窗口写入移到门禁后）。
- 四条重点抽查的测试断言口径真实：无 entry/r runId 不匹配的 FAILED 不弹也不误收尾；RUN_STARTED 已达 reject 无终态 → refcount 回落；stop 在途 start 补发（displayNotification 第 2 次）与期望态回切跳过未执行 stop 两种时序都覆盖；iOS 门禁不消耗合并窗口（切回 android 后同会话失败仍发 1 次）。
- 证据链复核：本机复跑 `npx jest`（apps/mobile）186 套 / 1105 例全过；`npm run typecheck`（mobile build+web+e2e）绿。注意 jest 必须在 apps/mobile workspace 内跑，根目录 npx jest 会因缺 TS transform 配置报错（非代码问题）。
- onBackgroundEvent 不加 Platform 门禁的决策核实合理：该 API 跨平台、iOS 注册无副作用（通知路径本身被 MF-8 挡住）；jest preset 默认 OS='ios'，加门禁会让测试文件顶层捕获 observer 的做法失效。与 registerForegroundService 有门禁（真 Android-only 行为）不矛盾。
- 遗留不变：真机 manual（后台点按全链路等）合并后 QA；open_questions 5 条待拍板；parallel-step3-defer 待确认。
