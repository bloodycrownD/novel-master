---
zone: apps-mobile
agent: W6-verify
input: synth/apps-mobile.md（P1×3 = AM-1 / AM-2 / AM-3）
measured_at_head: feat/repo-mega-cr @ 9ca5f5ad
method: AM-1 / AM-2 双源免验（抽查行号在位）；AM-3 非双源，从代码重新推导
p1_total: 3
p1_confirmed: 3
p1_refuted: 0
p1_adjusted: 0
---

# W6 验证 · apps-mobile

验证对象是 `synth/apps-mobile.md` 的三条 P1。AM-1（forgetSession 零调用）与 AM-2（云同步 busy
令牌泄漏）已有 ≥2 处独立来源印证，按编队纪律只做**行号在位抽查**（确认行号未漂、上下文与条目
描述一致），不重跑机制推导；AM-3（RealPrompt 路由无参数）**不在双源免验名单内**，本次从代码
重新推导，并补齐了原报告缺失的触发路径。

**结论：3/3 confirmed，无 refuted、无 adjusted。** AM-3 的置信度由原报告的
「confirmed（前置条件未真机复现）」升级为「confirmed（触发路径已读码闭环）」。

---

## 一、免验清单（行号抽查）

抽查口径：条目给的 `file:line` 必须存在、该行/该段内容与条目描述一致；上下文若与描述冲突
则升级为重新推导。

### AM-1 forgetSession 零生产调用

| 抽查点 | 期望 | 实测 | 判定 |
|---|---|---|---|
| `services/session-stream-unit-manager.service.ts:717` | `forgetSession` 定义在 717 | 717 正是 `forgetSession(sessionId: string): void {`，JSDoc 710-716 写明「Step 6 会话删除链路调用」 | 在位 |
| 全仓调用面 | 生产调用 0 | `git grep forgetSession -- apps/mobile` 共 10 命中 = 定义/注释 4（manager:50/246/323/717）+ 测试 6（`__tests__/session-stream-unit-manager.service.test.ts:765`、`__tests__/session-stream-unit-persist.test.ts:779/785/795`）。**生产调用 0** 属实 | 确认 |
| 删除链路三处 | 只 `sessions.delete` + `clearSessionViewCache*`，不碰 manager | `screens/tabs/chat-tab/useChatTabScope.ts:521-541`（`handleDeleteSession`，成功分支 524-535 只有 `runtime.sessions.delete` + `clearSessionViewCache`）、`:564-589`（`deleteSelectedSessions`，循环体 570-573 同上）、`:591-610`（`handleDeleteProjects`，598-600 清三个缓存）——三处**逐行读过，零 `forgetSession`** | 确认 |
| `idleMessageViews` 无上限 | hydrate 无条件 set | `:915-936` `hydrateSessionMessages`：命中缓存 923 set、**miss 也 929 set 空壳**；全文件对该 Map 只有 `get/set/delete/clear`，**无任何淘汰/LRU 逻辑**（grep `idleMessageViews` 20 处命中逐条核过） | 确认 |
| `:923/:929` 两条 set 与「40 条 + 分页累积深拷贝」 | `[...cached.messages]` 深拷贝 | 924 行确为 `messages: [...cached.messages]` | 在位 |
| `settledProjections` 无界 | 无上限 | 定义 353，唯一清理点 738（forgetSession 内）与 1970（dispose） | 确认 |
| 徽标消费方 | `ChatSessionListPanel` 读 `interruptedSessionIds` | 实际路径是 `screens/tabs/chat-tab/ChatSessionListPanel.tsx:115`（`useMemo` 同步）与 `:118`（`subscribe` 回填）——报告写的是 `components/chat/ChatSessionListPanel.tsx`，**路径前缀有误、行号正确** | 在位（路径订正） |

**行号在位，无漂移。AM-1 维持 confirmed。** 唯一订正是 `ChatSessionListPanel.tsx` 的目录前缀
（`screens/tabs/chat-tab/`，非 `components/chat/`）——不影响结论，仅供修 bug 时定位。

### AM-2 pullCloudSync busy 令牌泄漏

| 抽查点 | 期望 | 实测 | 判定 |
|---|---|---|---|
| `cloud-sync.service.ts:317` acquire | 在 `try` 之外 | 317 正是 `acquireMobileDbMaintenanceBusy();`，其后 318 `let pullBusyHeld = true` | 在位 |
| `:338` try | 与 acquire 之间隔真实 await | 317→338 之间有 **332 `await createCoordinator(...)`**（一个真 await：读 KKV 配置 → SKSP 读 secret → `createS3ObjectStorage` → `createRnS3Client`）与 326 `createCloudSyncProgress`（同步） | 确认 |
| `:367` finally 释放 | 异常路径释放不了 | `finally` 首行 367 就是 `releasePullBusy();`，只覆盖 338 起的 try 块。332 抛错 → 317 的 acquire 永不配对 | 确认 |
| `db-maintenance-busy.ts:15` 计数 | 进程级单向计数 | 15 `let maintenanceBusyCount = 0;`；18-20 `isMobileDbMaintenanceBusy()` 是唯一读点、23-25 acquire、31-33 release（带 `Math.max(0,…)` 钳制）。**无上限、无自愈** | 在位 |
| 两个后台循环是让路守卫 | 泄漏即永久停摆 | `blob-binary-normalization.service.ts:50` 与 `message-content-compaction.service.ts:26` 都 `return isMobileAgentActive() \|\| isMobileDbMaintenanceBusy()`；前者 `:68-72` 是 `for(;;)` 无限循环 + `sleep(GUARD_RETRY_DELAY_MS); continue`——**busy 期间既不退出也不降级，只无限重试**，故泄漏 = 本进程内永久停摆（到冷启动） | 确认 |
| `pushCloudSync` 无此问题 | 对照 | `pushCloudSync` 从 `:374` 起，busy 配对在 379 之后统一 try 内（grep：cloud-sync.service.ts 中 acquire/release 仅 317/322 一对） | 确认 |

**行号在位，无漂移。AM-2 维持 confirmed。** 补充一条对修法有利的实测：`createCoordinator`
的返回是 `const {coordinator, exportTempPath, importTempPath}`（332 行一次性解构），把它移进
`try` 需要把 368-369 的 `unlink` 改成判空——与原报告修法一致，无额外成本。

### AM-3 RealPrompt 路由无参数（非双源，本次重新推导）

原报告置信标注为「confirmed（错数据路径已读码闭环，仅『scope 在详情页被改』这一前置条件未做
真机复现）」，并把该前置条件的可达性交给 W6。本次**不接受这个悬置**，从代码把链路走完。

**事实层（全部行号实测在位）：**

| 断言 | 实测 | 判定 |
|---|---|---|
| `navigation/types.ts:16` `RealPrompt: undefined` | 16 行逐字为 `RealPrompt: undefined;` | 在位 |
| `RealPromptScreen.tsx:23` 从全局 scope 取 | `const {projectId, sessionId} = useMobileScope();` | 在位 |
| `RealPromptScreen` 只有这一个数据入口 | `:28-55` `load` 唯一依赖 `{runtime, projectId, sessionId}`，`:38-41` 唯一数据源 `buildRealPromptPreviewSegments(runtime, {projectId, sessionId})`；全文件再无 `useRoute` | 确认 |
| 详情页入口不传参 | `screens/stack/SessionDetailScreen.tsx:397` `onPress={() => navigation.navigate('RealPrompt')}`，而同页 `:366` 的 ChatHistorySearch 明确传 `{projectId, sessionId}`——**同页兄弟入口都传参，只有它不传** | 确认 |
| 详情页路由参数确实是 `{projectId, sessionId}` | `SessionDetailScreen.tsx:67` `const {projectId, sessionId} = route.params;` | 在位 |
| 另一入口 | `useChatTabController.ts:106-108` `ctx.navigation.navigate('RealPrompt')`，无参 | 在位 |
| 装配 | `navigation/RootNavigator.tsx:115/:223-226`，`options={{animation:'none'}}` | 在位 |
| 页面无任何会话标识 | `RealPromptScreen.tsx:61-90` 全文无 sessionId/标题渲染；`navigation/header-config.ts:20` 标题固定 `'查看提示词'` | 确认 → **错数据零视觉线索，「无任何提示」属实** |

**触发路径（原报告缺，本次第 1 步补齐）——把「scope 在详情页被改」从推断变成读码闭环：**

原报告只做了「`setCurrentSession` 有 5 处调用点，见 grep」，没区分哪些在 React 树内、哪些在树外。
本次把写面逐个归位，得到**唯一一条树外写面**：

```
notifee 通知点按（前台 :471-479 / 后台 headless :515-526）
  └─ tapHandler(sessionId)                       agent-finished-notification.ts
       └─ manager 构造时注册的闭包               session-stream-unit-manager.service.ts:470-479
            ├─ if (getCurrentSessionId() !== sessionId)
            │    void scopeBridge.setCurrentSession(sessionId)      ← 异步、fire-and-forget
            └─ navigateToChatTabFromNotification()
                 └─ navigationContainerRef.navigate('MainTabs', {screen:'Chat'})
                                                          ← 注意：无 pop 选项
```

`scopeBridge` 的实现是**注册时注入的回调**（`runtime/novel-master-context.tsx:238-251`），
它 `await setMobileSession(rt, projectId, sessionId)` 写持久层后 **`setScope(next)` 改 React
state**——也就是 `useMobileScope()` 的数据源被换掉了。这条写面**不需要任何 UI 交互**，
是后台事件驱动的。

于是两条都可达、且都无需真机即可判定的具体序列：

1. **后台点按（最干净）**：用户停在会话 A 的 `SessionDetail`，App 切后台 → 会话 B 的后台
   agent run 完成并发通知 → 用户在系统栏点按 → `onBackgroundEvent` 跑
   `await tapHandler('B')`（`:523`）→ scope 变 B；`pendingTapNavigation = true` 让导航推迟到
   前后台切换（`:525/:529-534`），App 回前台时**恢复在原来的 `SessionDetail(A)` 栈顶**
   （导航还没发生）。此刻点「查看提示词」→ `RealPrompt` 无参 → 读到 scope=B → **显示 B 的
   提示词，页面锚定在 A**。一次点按、零额外手势。
2. **前台点按（附一条顺带实证）**：`navigate('MainTabs', {screen:'Chat'})` 走的是
   `@react-navigation/routers@7` 的 `StackRouter.tsx:361-459`——`NAVIGATE` 只在
   ①`routeGetId` 命中、②`name === currentRoute.name`、③`payload.pop === true` 三者之一时
   复用已有 route，否则（`:448-459`）**push 一条新的 MainTabs**。`RootNavigator.tsx:213` 的
   `MainTabs` 没配 `getId`，`:496-499` 的调用也没带 `pop`，所以当前栈顶是 `SessionDetail`
   时**不会回退、而是压入第二个 MainTabs**。用户按一次返回键即落回仍挂载的
   `SessionDetail(A)`，而 scope 已是 B → 同样的错数据。

**判定：AM-3 confirmed（维持 P1），置信理由由「前置条件靠推断」升级为「触发路径逐跳读码闭环」。**
错数据 + 零视觉线索 + 无自愈路径，符合本簇 P1 口径（「用户可见错误数据且无自愈路径」）。

---

## 二、verdict 表

| 编号 | 标题 | 报告置信 | W6 判定 | 等级 | 处置 |
|---|---|---|---|---|---|
| AM-1 | `forgetSession` 零生产调用，会话删除后四张 Map 残留 | confirmed（5 处撞车） | **confirmed**（行号抽查全在位） | P1 维持 | 修：三处删除成功分支补 `manager.forgetSession(id)` + `idleMessageViews`/`settledProjections` 挂 500 LRU 兜底 |
| AM-2 | `pullCloudSync` 的 busy 令牌在 `createCoordinator` 抛错时永久泄漏 | confirmed（双源） | **confirmed**（行号抽查全在位） | P1 维持 | 修：`createCoordinator` 移进 `try`（临时路径改 `let` 声明、`finally` 判空 unlink）；补「注入 createCoordinator 抛错 → `isMobileDbMaintenanceBusy()` 回 false」用例 |
| AM-3 | `RealPrompt` 路由无参数，详情页入口拿全局 scope 可能展示别会话提示词 | confirmed（前置条件未真机复现） | **confirmed**（触发路径补齐为读码闭环） | P1 维持 | 修：`RealPrompt` 路由加可选参数 `{projectId?, sessionId?}`，两处入口显式传、缺省回落 scope |

**合计：verified 3（confirmed 3 / refuted 0 / adjusted 0）。**

### 验证过程中产生的事实订正（不改变任何条目存在性与等级）

1. `ChatSessionListPanel.tsx` 的目录是 `apps/mobile/src/screens/tabs/chat-tab/`，AM-1 里写的
   `components/chat/ChatSessionListPanel.tsx` 路径前缀有误、行号 115-118 正确。
2. AM-2 的 `pushCloudSync` 对照：busy 的 acquire/release 在整个 `cloud-sync.service.ts` 里只有
   317/322 一对，`push` 侧不经过外层互斥，报告结论正确。
3. AM-3 附带发现（不计入本簇 P1/P2 计数，仅作修 AM-3 时的连带事实）：`navigateToChatTabFromNotification`
   的 `navigate('MainTabs', {screen:'Chat'})` 在栈顶非 `MainTabs` 时会**压入第二个 MainTabs**
   （依据 `@react-navigation/routers@7` `StackRouter.tsx:361-459` + `RootNavigator.tsx:213` 无
   `getId`）。这是**独立的导航栈缺陷**（返回键要多按一次、栈里出现两个 tab 宿主），建议单开一条
   由 synth-cloudsync / synth-apps-mobile 裁决归属；本文件只登记事实，不改 AM-3 计数。

### 移交提示

- AM-2 的完整链路（含 S3 侧）仍归 synth-cloudsync，本文件只判 mobile 侧令牌配对。
- AM-1 的「加 LRU 兜底」这半个修法与是否降级无关，若主代理决定把 AM-1 降 P2，该修法仍应保留
  （正常浏览即涨，不依赖删除路径）。
