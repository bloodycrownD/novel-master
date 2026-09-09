# agent-run-parallel-and-notify 第 1 轮 CR 修复（spec-parallel + prd-parallel）

<!-- 第 2 轮追加见文末 -->
<!-- 第 3 轮（impl）追加见文末 -->

日期：2026-08-30

## 请求

对 `docs/Iterations/agent-run-parallel-and-notify/{prd,spec}.md` 做第 1 轮审查修复，只改文档不改实现代码，闭合 P0-1 / P1-1~P1-5 / P2-1~P2-2 共 8 项 must-fix。不动 `main-session-stream-resume/` 与 `import-dir-rule-default-on`。

## 修复要点（拍板结论）

- **P0-1 Manager 装配契约**：spec 新增小节。拍板在 `NovelMasterProvider` bootstrap effect 内、runtime 就绪后实例化 Manager，挂 runtime 对象（`MobileNovelMasterRuntime` 加 `agentRunManager` 字段），ChatComposer/ChatTabProvider 经 `useNovelMaster().runtime.agentRunManager` 获取。retry 重建时对齐 desktop `main.ts` 先 detach 模式：`manager.dispose()`（退订 + 按 RunEntry 逐个 decrement 清零模块级 refcount + 停前台服务）必须在 `closeMobileConnection()` 之前调。桥（uiBridge/prefGetter/scopeBridge）Provider ready 后注入，未注入期间 console 兜底。
- **P1-1 options 契约**：`startRun` 增加 `onUserMessageAppended`（透传 core，清草稿）与 `onSettled`（终态回调，驱动 chip 刷新 + onMessagesChanged + 空续跑兜底清草稿）。Step 2 补单测（T-P10）。
- **P1-2 读取桥**：桥清单补 `scopeBridge.getCurrentSessionId`（React 外读 scope.sessionId）与 `scopeBridge.setCurrentSession`（拍板「context 方法经桥注入」：闭包内 `setMobileSession` 持久化 + 直接 `setScope`，不走 refreshScope）。
- **P1-3 早退兜底**：对齐 desktop `agent.ts` C-orch-1，fire-and-forget promise 链尾 `.finally()`——RUN_STARTED 未达即抛错时清 entry + decrement。补 T-P9。
- **P1-4 融合规则**：spec 新增「与恢复窗口机制的融合」小节，用 `RunEntry.status`（starting/running/缺失）区分投影为 null 的两种来源，`getUiRunning` 职责不变（stale 守卫），恢复窗口开闭条件保留、只换输入源。只写本 spec 侧。
- **P1-5 dataSync 超时**：第 3 块补 Android 14+ 约 6 小时上限约束（targetSdk 36），超时按「外力关闭」口径兜底；notifee 对 onTimeout 的暴露程度 Step 5 实现时核实；拍板维持 dataSync（shortService 约 3 分钟不够、specialUse 有 Play 审核成本）。
- **P2-1 前台口径**：PRD/SPEC 同步改为「app 在前台（任意页面）不发、仅后台发」（AppState.currentState 判断，RN 模块级 API 无需经桥），标注默认口径、用户确认 spec 时可推翻。验收标准与 T-P4、Step 7 同步。
- **P2-2 权限时机**：钉死「首次发起 run 且通知开关为开时」申请，写进第 4 块与 PRD 约束。

## 证据定位（实现侧，未改）

- `apps/mobile/src/runtime/novel-master-context.tsx`：runtime 为 Provider React state；retry 走 `closeMobileConnection()` 整体重建；scope 为 React state。
- `apps/mobile/src/runtime/mobile-scope.ts` `setMobileSession`：只写持久层不更新 React scope。
- `apps/desktop/src/main/ipc/handlers/agent.ts` L324-350：finally 早退兜底（C-orch-1）。
- `apps/desktop/src/main/main.ts` L128-152：先 detach 再 attach 模式。
- `apps/mobile/src/components/chat/ChatComposer.tsx` L341-440：onUserMessageAppended 清草稿、await 后刷 chip、末尾 onMessagesChanged。
- `apps/mobile/android/build.gradle`：targetSdkVersion 36。

## 第 2 轮 CR 修复（2026-08-30，spec-parallel 为主）

### 请求

第 2 轮审查修复，只改 PRD/SPEC 文档，闭合 P1-a / P1-b / P2-a~P2-d 共 6 项 must-fix。不动 `main-session-stream-resume/` 与 `import-dir-rule-default-on`。

### 修复要点（拍板结论）

- **P1-a 融合信号替换**：spec 融合小节把开窗/合成触发信号从 `registry.has` 扩为 `registry.has ∥ Manager 投影（RunEntry starting/running）`，承认这是对前置迭代开窗输入源的显式替换（本迭代落地后生效，前置迭代先按 `has()` 单信号落地）；删除「不改窗口本身逻辑」的矛盾表述（窗口开闭条件、反填同步顺序、stale 守卫语义仍按前置迭代不变）。根因：core register 在 `run-agent-turn.ts:592`（用户消息 append 后）才执行，starting 期间 `has()` 恒 false；`shouldIgnoreStaleRunStarted = !uiRunning`（`agent-run-lifecycle-helpers.ts:19-25`）会丢弃迟到 RUN_STARTED。补 T-P11（starting 窗口切走再切回 RUN_STARTED 接纳反填）。
- **P1-b 门禁空窗**：startRun 门禁钉死「RunEntry 存在（starting/running）或 `abortRegistry.has`」——受理→register 之间有异步空窗（has()=false），只看 registry 会打出同会话双 run，且 Map.set 覆盖（`create-agent-abort-registry.ts:21-23`）冲掉第一个 controller。T-P2 补「entry 处 starting 时二次 startRun 被拒」，Step 1 单测清单同步。
- **P2-a refcount 时机**：钉死 increment 在 startRun 受理路径同步执行（对齐 desktop `agent.ts:296-298`：activeRuns.set + increment 先于 fire-and-forget），事件订阅只负责 decrement；RUN_STARTED 事件只迁移 entry 状态。第 0 块、第 1 块、变更点清单、Step 1、风险段全同步。
- **P2-b onSettled 签名**：收敛为 `'finished' | 'failed'`（拍板二选一取收敛）。abort 收场归入 `'finished'`——FINISHED payload 只有 stopReason、FAILED 只有 error 字符串，无结构化 abort 标记，`'aborted'` 无判定来源；未来要区分须 core 先提供结构化标记，另行立项。
- **P2-c 双刷口径**：拍板「onSettled 列表刷新定位为切走/无面板场景的补刷，当前面板接受双刷（幂等，多一次全量 DB 读），不去重」。写进第 2 块 chip/列表刷新处。
- **P2-d dispose 与在途回调**：dispose 只退订/清计数/停服务，不撤销已透传回调（`onUserMessageAppended` 是 core 直接调用的，无从拦截），UI 侧按既有卸载吞错口径；`onSettled` 由事件订阅驱动，dispose 后不再触发，在途 run 后续终态由新 Manager 接管（无 entry 不 decrement，防负）。写进装配契约第 3 点。
- **PRD 同步**：验收标准补两条 starting 窗口用例（切走再切回接纳反填；starting 内再点发送被拒）。

### 涉及文件

- `docs/Iterations/agent-run-parallel-and-notify/spec.md`（第 0/1/2 块、装配契约、融合小节、变更点清单、Step 1/3、T-P2/T-P11、风险段）
- `docs/Iterations/agent-run-parallel-and-notify/prd.md`（验收标准）

## 第 3 轮：impl 实现（2026-08-30，impl-parallel 节点）

### 请求

在 worktree `.woktree/parallel-notify`（分支 `feat/agent-run-parallel-and-notify`）按最终 spec 实现 Step 1/2/4/5(代码)/6：Manager + 装配、ChatComposer 迁移、通知模块、前台保活代码、偏好开关与单测；Step 3 主体（activeRunId per-session 化与 ChatTabProvider/useSessionStream context 改造）延后与 main-session-stream-resume 融合；Step 5/7 真机验证不做。

### 实现要点（含与 spec 的小差异记录）

- **依赖**：`@notifee/react-native` 锁 `9.1.8`（npm 精确版本）。注意项目真 lockfile 是 `package-lock.json`（npm workspaces）；worktree 里 `pnpm install` 只装根目录依赖且会生成 untracked 的 `pnpm-lock.yaml`（已删），mobile 依赖需 npm install。
- **AgentRunManager**（`services/agent-run-manager.service.ts`）：门禁（RunEntry starting/running 或 abortRegistry.has）、受理同步 increment、事件驱动 decrement（RUN_STARTED 只迁移 entry）、finally 早退兑底（`current !== entry || current.runId != null` 提前 return 防双减）、dispose 清零；桥三件套（uiBridge→showAppToast / prefBridge / scopeBridge）。
- **小差异（按 spec 意图）**：工厂返回 `MobileRuntimeCore = Omit<runtime,'agentRunManager'>`，Provider bootstrap 内 `Object.assign(rt, {agentRunManager: new AgentRunManager(...)})` 装配——保持「Provider 内实例化」的 spec 钉死，同时工厂纯度不破坏；useAgentRunLifecycle 中 onRunFinished/onRunFailed 的 decrement 也一并移除（spec 只点名 beginUiRun/endUiRunOnError，但保留会与 Manager 双减）。
- **通知模块**（`services/agent-finished-notification.ts`）：AppState 前台不发、同会话失败 5 分钟合并、Android 13+ 权限拒绝后不再申请、dataSync 前台服务（模块级 keepAliveRunning 标记跨 Manager 实例共享）、点按→scopeBridge.setCurrentSession + navigateToChatTabFromNotification。
- **测试坑**：mock runAgentTurn 立即 resolve 会触发 finally 早退把 entry 清掉——事件驱动型用例必须让 mock 挂起或同步 publish 事件；`Platform.OS = 'android'` / `Object.defineProperty(AppState,'currentState')` 是前台后台/权限断言的 mock 手段；notifee 全局 Jest stub 在 `test-utils/notifee-mock.ts` + jest.config moduleNameMapper。
- **环境坑**：worktree 里 workspace 包 dist 缺失会让 5 个无关 suite 挂（cloud-sync / connection / db-backup 等）——先 build cloud-sync-driver-s3 / tdbc-driver-op-sqlite / tokenizer-driver-rn 等再跑全量。

### 提交

5 个 commit：deps（notifee）、notify（封装+Manifest+ref）、manager（Manager+装配+lifecycle 收口）、composer（迁移）、pref（开关）。

### 验证

`npx jest` 186 suites / 1083 tests 全绿；`npm run build` + `npm run typecheck` 通过；eslint error 数与基线持平（22=22，存量）。
## cr-func 代码审查修复（2026-08-30，fix-parallel 节点，worktree .woktree/parallel-notify）

### 请求

在 worktree `parallel-notify`（分支 feat/agent-run-parallel-and-notify）闭合 cr-func 两条 must-fix：T-P7 守卫用例缺失、RUN_STARTED 后失败双 toast。只改最小范围，不动 useSessionStream/ChatTabProvider 与 docs/Iterations/。

### 修复要点

- **must-fix 1（T-P7）**：`apps/mobile/__tests__/agent-activity.test.ts` 新增「T-P7 守卫：refcount 单一归属」describe——受理即活跃、STARTED 不碰计数、FINISHED/FAILED 事件收尾归零、finally 早退归零、跨会话并行归零在最后一个 run 收尾；另有静态断言锁定 lifecycle 路径（useAgentRunLifecycle.ts / useSessionStream.ts）不含计数 API 的调用或导入（正则带括号/匹配 import 语句，注释提及 API 名不算）。`db-backup.service.test.ts` 补 import 侧守卫用例（活跃期间选择器启动前即拒）。
- **must-fix 2（双 toast）**：根因是 core `agent-runner.ts:774` 失败时既 publish EVENT_AGENT_RUN_FAILED 又 throw，Manager 的 onRunFailed 与 .catch 都调 uiBridge.onError。修复：`.catch` 仅当 `entries.get(sessionId) === entry && entry.runId == null`（resolve/register 阶段错误，事件永不来）时才 onError；事件已收尾或 RUN_STARTED 已达由事件路径负责。补两条测试：RUN_STARTED 后失败只弹一次、早退 throw 兜底弹一次。

### 提交与验证

- 35ed6fd fix(manager): 失败双 toast——throw 路径仅在事件路径未收尾时兜底 onError
- 54bb4b0 test(t-p7): 补 refcount 单一归属守卫用例
- `cd apps/mobile && npx jest` 全量 186 套件 / 1091 用例全过；`npm run typecheck` 干净。

### 经验

- 静态源码断言（readFileSync + 正则）要区分「调用/导入」与「注释提及」，否则误伤既有注释。
- Manager 双路径收尾的去重判断统一用「entry 是否仍是本次 + runId 是否已回填」两个信号，覆盖受理空窗、事件先到、throw 先到三种时序。

## 续作启动（2026-09-05，主会话）

### 请求

新建 worktree（沿用 `.worktree/agent-run-parallel-and-notify`，原 worktree 一直在未清理），把 main 合入 feat/agent-run-parallel-and-notify，准备继续做该迭代。

### 合并与裁决

- worktree 里发现一场合到一半的 merge（MERGE_HEAD=main 顶端），95 文件已暂存、剩 2 处冲突。
- docs/apm/memory 同名文件冲突：main 侧「第 3 轮 impl」vs 分支侧「cr-func 修复」，按时间序两段全保留。
- useAgentRunLifecycle.ts 冲突为架构对决：main 的 refCountedRef 所有权守卫（1.5.9 修复）vs 分支的 refcount 整体上收 AgentRunManager（T-P7 静态断言锁死 lifecycle 不碰计数）。裁决取分支侧（Manager 方案是同一泄漏的更根本修复），并清除自动合并漏进来的孤儿（refCountedRef 声明、beginUiRun 置位）。main 的流式恢复机制（保护窗/恢复窗口/反填）完整保留——notify PRD 依赖它。
- use-agent-run-lifecycle 的「refcount 平衡」断言按新语义对齐（计数断言移除，归 T-P7 Manager 套件覆盖）。
- 验证：8 套件 105 测试全绿（含 T-P7、composer 两轮回归、webview 重挂回归）；merge commit 8991cd7，分支领先 main 14 提交、落后 0。

## Step 3 落地（2026-09-05，worktree）

### 请求

主 worktree 停用（用户占用），在 .worktree/agent-run-parallel-and-notify 继续 notify 迭代；main 领先 152 提交（1.5.11→1.5.14、正则移除、body-params、workspace-push、图表重做），重新合入后实现 spec Step 3。

### 实现

- 重合 main：旧 worktree 已被并行会话清理，重建后合并，仅记忆文档一处冲突（照旧双保留），代码零冲突；npm install + core dist 重建 + 9 套件 102 绿后开工。
- Manager 投影面：getEntry（starting runId=null）/subscribeEntries（5 变更点通知）。
- lifecycle：getManagerEntry 注入；reset 采纳 running 投影 runId（重进即严格匹配）；starting 不采纳走恢复窗口；RUN_STARTED 直通路径保持 payload.runId 回填（事件序保证 Manager 先填、UI 后读，同值）。
- Provider：开窗资格与探针 isRunRegistered 扩 registry.has ∥ manager.hasRun（封受理空窗回页误收尾）；sessionAgentRunning 新视图（transcript agentRunning/reload 语义随之会话化——别的会话 run 不再冻结本会话）。
- 测试：T-P3a/b/c/d + mock 桩；9 套件 116 全绿、tsc 0 错、prettier/eslint 过（no-void 警告为分支存量）。提交 942a6a98。
- 记忆改记 worktree 侧（随分支走，避免下次合并再撞同一文档冲突）。
