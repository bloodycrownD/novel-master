# agent-run-parallel-and-notify 第 1 轮 CR 修复（spec-parallel + prd-parallel）

<!-- 第 2 轮追加见文末 -->

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
