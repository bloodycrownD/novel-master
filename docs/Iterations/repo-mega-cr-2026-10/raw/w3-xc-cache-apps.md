---
zone: xc-cache-apps
agent: cross-cutting / 双端 UI 层缓存·订阅·监听泄漏普查
files_scanned: 41（mobile 生产 24 + desktop 生产 15 + 判定文件 2）
---

# W3 横切报告：双端 UI 层缓存/订阅/监听泄漏普查（xc-cache-apps）

## 摘要

本机位普查双端 UI 层的「内存驻留物」——事件总线/IPC 订阅、DOM/window 监听器、
Animated/timer/RAF 句柄、per-session Map 缓存——逐处给「建立点 / 清理点 / 残留路径」
三元组。mobile 侧重心是 `SessionStreamUnitManager` 的六张常驻 Map 与三条定时器链
（校准探针 / 写通 coalescer / 单元宽限），desktop 侧重心是 `useAgentStream` 订阅、
`conversation-batch` 的 RAF、ShellNavProvider 的双路 IPC 订阅、preload 桥的
callback→listener 映射。核心结论：**mobile 的 `forgetSession` 至今零生产调用**，
会话删除/项目删除链路完全绕开 manager，导致 `idleMessageViews` / `settledProjections` /
`pendingChildParentByChild` / `consumptiveSessions` 四张 Map 无界增长（view cache 有
500 条 LRU，manager 侧没有），这是本次最实的 P1。desktop 侧的订阅/监听/RAF 清理
整体成对，唯一缺口是 preload 桥的 `ipcListenerByCallback` 在「同一 callback 复用」
下的解绑语义，以及 `useConversationBatch` 的 `flushRef` 在 effect 外赋值导致的
flush→setState-after-unmount 窗口。

## 职责与边界

- **负责**：双端 UI 进程内的一切「建立—清理—残留」配对，含 React effect 订阅、
  IPC/eventBus 订阅、WebView bridge 双向监听、BackHandler/DeviceEventEmitter/AppState、
  setTimeout/setInterval/requestAnimationFrame 句柄、以及纯内存缓存的容量上限。
- **不负责**：订阅所承载的业务正确性（事件语义、载荷字段、状态机判定），那是
  `core-agent` / `mobile-runtime` / `desktop-main` 的地盘；持久层缓存（KKV /
  view cache 文件）也不在本格。本格只看**进程内**驻留。
- **判定基线**：`docs/apm/RULE.md` L41（desktop 子会话写入刷新旁路订阅，
  `ShellNavProvider` 绕过 `useAgentStream` 守卫是**故意设计**）、L21（composer tag
  闪烁是已知问题勿当 bug）、L94（RN bridgeless 包装禁令，与本 zone 无直接关系但
  涉及 native 侧句柄）、L50（mermaid 全屏查看器的 document 级事件委托「DOM 被整树
  重建不丢监听」是**故意设计**）。

## 对外接口

mobile `SessionStreamUnitManager`（`apps/mobile/src/services/session-stream-unit-manager.service.ts`）
的进程内 API 面：

| 符号 | 职责 | 建/清 |
|---|---|---|
| `subscribe(listener): () => void` | 投影变更广播，`listeners: Set` | 建 815 / 清 818,1973 |
| `forgetSession(sessionId)` | 会话删除链路清内存现场 | **零生产调用**（见 F-1） |
| `dispose()` | runtime 重建前全量销毁 | 1939–1975 |
| `attachWebview` / `detachWebview` | webview 句柄挂载 | 831/839 |
| `snapshot` / `readMessagesSnapshot` / `rateTokensPerSecond` | 读面 | 803/885/696 |
| `activeSessionIds` / `interruptedSessionIds` | 判活 | 753/773 |

`SessionStreamUnit`（`apps/mobile/src/services/session-stream-unit.ts`）：
`begin/markRunning/settle/settleAsInterrupted/hydrateFromRunState/destroy`，
自带 `graceTimer`（宽限）与 `ingressTimer`（32ms 合流）+ `applyBuffer`（64ms apply 节拍）三条定时器。

desktop：`useAgentStream`（`apps/desktop/renderer/hooks/useAgentStream.ts`）、
`useConversationBatch`（`.../features/chat/conversation-batch.ts`）、
`ShellNavProvider`（`.../providers/ShellNavProvider.tsx`）、
`onAgentStream` / `onWorkspaceMutated`（`.../ipc/client.ts:189,209`）、
preload 桥（`apps/desktop/src/preload/preload.ts:47-67`）。

## 数据访问

本 zone 不碰表/KKV，只碰进程内 Map/Set。清单（含上限）：

| Map/Set | 位置 | 上限 | 清空路径 |
|---|---|---|---|
| `units` | manager:312 | settled 侧 LRU 8（`SESSION_STREAM_MAX_SETTLED_UNITS`:158） | `removeUnit`:1618 |
| `settledProjections` | manager:353 | **无上限** | 仅 `forgetSession`:738 / `dispose`:1970 |
| `idleMessageViews` | manager:358 | **无上限** | 仅 `forgetSession`:739 / `dispose`:1971 |
| `pendingChildParentByChild` | manager:326 | 无上限（受 run 生命周期约束） | `clearPendingChildIndex`:1363 / `forgetSession`:721 / `dispose`:1963 |
| `consumptiveSessions` | manager:332 | 无上限 | `removeUnit`:1631 / `dispose`:1964 |
| `writethroughs` | manager:349 | 无上限（受活跃 run 约束） | `flushAndDisposeWritethrough`:1860 / `discardWritethrough`:1871 |
| `listeners` | manager:370 | 无上限 | `subscribe` 退订 818 / `dispose`:1973 |
| `sessionViewCache` | `chat-session-view-cache.ts:12` | **500 LRU** ✓ | `clearSessionViewCache` / `clearByProjectPrefix` |
| `chat-list-scroll-cache` | `chat-list-scroll-cache.ts:11` | **500 LRU** ✓ | 同上 |
| `vendorModelHintBySession` | `stream-token-estimator.ts` | **32 FIFO** ✓ | TTL + FIFO:218-224 |
| `bySession`（草稿） | `chat-composer-draft.ts:18` | **无上限** | `clearChatComposerDraft` / 空文本自清；**会话删除不触发**（见 F-6） |
| `ipcListenerByCallback` | preload:33 | WeakMap（随 callback GC） | 每次 `off` 删一条 |

关键对照：view cache 与 scroll cache 都是 500 条 LRU 的**有界**设计，而 manager 的
`idleMessageViews` / `settledProjections` 是**裸 Map 无上限**——同一批作者的两种
口味，说明 manager 侧是遗漏而非有意。

## 依赖关系

```
mobile:
  ChatTabProvider ──subscribe/attach/detach/hydrateSessionMessages──▶ SessionStreamUnitManager
  ChatTabScreen.openConversation ──hydrateSessionMessages────────────▶ 同上
  SubagentSessionScreen ──attach/detach──────────────────────────────▶ 同上
  SessionStreamUnitManager ──eventBus.subscribe×8───────────────────▶ core eventBus
                      ──createRunFinishCalibrationProbe─────────────▶ setInterval + per-session setTimeout
                      ──createRunStateWritethrough──────────────────▶ per-session setTimeout
                      ──AppState.addEventListener('change')─────────▶ 校准触发
                      ──registerAgentNotificationTapHandling───────▶ notifee.onForegroundEvent
  SessionStreamUnit ──setTimeout(grace) / setTimeout(ingress) / applyBuffer 64ms
  manager.dispose() ← NovelMasterProvider bootToken>0 分支 / cancelled 分支（novel-master-context.tsx:168,198）

desktop:
  App ──▶ ShellNavProvider ──onWorkspaceMutated + onAgentStream────▶ preload bridge ─▶ ipcRenderer
  ConversationPanel ──useAgentStream──onAgentStream────────────────▶ 同上
                    ──useAgentStreamMetrics──setInterval 250ms
                    ──useChatMessagesScrollFollow──RAF + scroll listener
                    ──useConversationBatch──RAF
                    ──useReadOnlyRunProbe──visibilitychange + setInterval 30s
  SessionDetailDrawer / ChatComposer ──onAgentStream / onPromptChatTokenUpdated / onComposerAttachmentsSuggest
  main: attachEventBusForwarder（8 事件）── detachMainEventBusListeners（quit/rebootstrap）
```

## 发现清单

### F-xc-cache-apps-1 | P1 | apps/mobile/src/services/session-stream-unit-manager.service.ts:717

```ts
forgetSession(sessionId: string): void {
  ...
  this.settledProjections.delete(sessionId);
  this.idleMessageViews.delete(sessionId);
```

**建立点**：`forgetSession` 是 `settledProjections`(:738) / `idleMessageViews`(:739) /
`pendingChildParentByChild`(:721-725) / `units`(:726) 四张 Map 的**唯一**按会话清理入口。

**清理点**：`forgetSession` 本体 + `dispose()`（:1939）。

**残留路径（实测）**：`forgetSession` 的**生产调用方为 0**。`git grep -n "forgetSession" -- "*.ts" "*.tsx"` 只命中三处测试文件（`apps/mobile/__tests__/session-stream-unit-manager.service.test.ts:765`、
`session-stream-unit-persist.test.ts:779,785,788,795`）与 manager 自身的注释/定义行。
而真实的会话删除链路在 `apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts`：
- `handleDeleteSession`:521-541 → `runtime.sessions.delete(targetSessionId)` +
  `clearSessionViewCache(...)`，**不调 manager**；
- `deleteSelectedSessions`:564-589 → 逐个 `runtime.sessions.delete(id)` +
  `clearSessionViewCache(...)`，**不调 manager**；
- `handleDeleteProjects`:591-610 → `runtime.projects.delete(id)` +
  `clearSessionViewCachesByProject` + `clearScrollSnapshotsByProject` +
  `clearTranscriptScrollSnapshotsByProject`，**也不调 manager**。

**后果**：view cache / scroll cache 在删除时被清了，manager 里的同款副本
（`idleMessageViews` 存的是**完整 messages 数组引用拷贝** `[...cached.messages]`，
:924/:929/:1044；`settledProjections` 存指标 + 速率）一个都没清。用户在 app 存活期内
浏览过 N 个会话就有 N 份残留。项目删除同理：`clearSessionViewCachesByProject` 清了
`chat-session-view-cache`，但 manager 的 `idleMessageViews` 里该项目所有会话的消息数组
仍常驻。数据量级：每会话 tail 40 条（`SESSION_STREAM_MESSAGES_PAGE_SIZE = 40`）+
分页累积，单条 ChatMessage 含 body 文本/blocks。长期使用 + 大量会话 = 内存单调增长，
且删除的用户数据仍以内存副本形式留存（对「已删除」的用户可见数据是隐私面）。

**建议**：在 `useChatTabScope` 的三处删除成功后调
`runtime.sessionStreamUnitManager.forgetSession(id)`（项目删除则遍历其会话 id 逐个调
或给 manager 加 `forgetProject(projectId)` 走 `sessionViewCacheKey` 的前缀语义）。
manager 侧另建议给 `idleMessageViews` / `settledProjections` 加与 view cache 同款的
容量上限（兜底，防再有第二条删除路径漏掉）。

**置信**：confirmed（调用方 grep 实测 + 三处删除链路逐行读过）

---

### F-xc-cache-apps-2 | P1 | apps/mobile/src/services/session-stream-unit-manager.service.ts:358

`private readonly idleMessageViews = new Map<string, IdleMessageView>();`

**建立点**：五处 —
`hydrateSessionMessages`:923/:929（会话切换，防闪路径，`ChatTabScreen.openConversation`:127
每次开会话都调）、`loadIdleOlderMessages`:991/:1003/:1019/:1028（分页）、
`applyIdleMessages`:1043（tail 加载）、`removeUnit`:1624（单元销毁时投影消息面交接）。

**清理点**：**只有** `forgetSession`:739 与 `dispose`:1971。`removeUnit` 是**写**不是清
（把投影消息面搬进 idle 视图，注释明说这是「交接」）。

**残留路径**：任意一条不经过 `forgetSession` 的路径都留条目，其中最现实的两条：
1. 会话删除（F-1）；
2. **正常浏览**——`hydrateSessionMessages` 对**每个**打开过的会话无条件
   `idleMessageViews.set(sessionId, {messages: [...cached.messages], ...})`（:923），
   连缓存 miss 的空壳（:929 `messages: []`）都写。翻 200 个会话就是 200 个条目，
   没有任何上限或 LRU 淘汰。对照 `chat-session-view-cache` 是 `maxEntries: 500`
   的 LRU（`chat-session-view-cache.ts:12`），此处裸 Map 明显是遗漏。

**后果**：内存随「打开过的会话数」单调增长，无上界。空壳条目（`messages: []`）
本身无害但吃 map node；有内容条目的量级是 40+ 条消息的深拷贝数组。

**建议**：二选一 —— ①给 `idleMessageViews` 加 `maxEntries` LRU（与 view cache 同口径，
最容易落）；②或让 `idleMessageViews` 只作「当前会话 + 上一个会话」的二级缓存，
`readMessagesSnapshot` 读不中直接回源（`loadIdleTailMessages` 的 miss 分支已经是
正确回源逻辑，:963）。前者改动小、风险低。

**置信**：confirmed

---

### F-xc-cache-apps-3 | P2 | apps/mobile/src/services/session-stream-unit-manager.service.ts:353

`private readonly settledProjections = new Map<string, SessionStreamSettledProjection>();`

**建立点**：`hydrate`:636（重启回填全部 settled 行）、`finishRun` 消费型分支:1421、
`finishRun` 发起型分支:1443。

**清理点**：`forgetSession`:738、`dispose`:1970。

**残留路径**：同 F-1（删除链路绕开）。此外注意 `hydrate`:636 的回填循环**没有上限**——
`store.listByStatuses(['settled'])` 返回该库全部 settled 行，有多少写多少
（中断检查 :631 在循环内，但那只防 dispose 竞态，不限行数）。库里有几百条历史
settled 行，启动水合就全量进内存。

**后果**：单条体量比 `idleMessageViews` 小得多（只有 4 个数字 + `metrics` 里的 4 个数字 +
一个 nullable 速率，无消息正文），是「条目数」而非「字节数」问题。量级上：
每个跑过 run 的会话一条，长期使用几百到几千条，每条约 100 字节 → 百 KB 级。
危害远小于 F-2，但同样是无界结构。

**建议**：随 F-2 一起加 LRU 上限（上限值可与 `SESSION_STREAM_MAX_SETTLED_UNITS`
同量级或更大——它是「上次生成」的数据源，条目本身极小，不必压得太狠）。
另可考虑 `hydrate` 回填时按 `updated_at_ms` 只留最近 N 条。

**置信**：confirmed

---

### F-xc-cache-apps-4 | P2 | apps/mobile/src/services/session-stream-unit-manager.service.ts:326

```ts
private readonly pendingChildParentByChild = new Map<string, string>();
```

**建立点**：`onChildSessionCreated`:1350-1353（**前置条件**：`this.units.get(payload.parentSessionId)`
非 null，见 :1346-1348 的早退）。

**清理点**：三条 —— `clearPendingChildIndex(parentSessionId)`:1363（父 run 收尾
`finishRun`:1415/:1434、单元出表 `removeUnit`:1632）、`forgetSession`:721-725（双向）、
`dispose`:1963。

**残留路径**：清理设计本身是完备的（父收尾即清、单元出表即清、dispose 全清），
**唯一的洞是 `forgetSession` 零调用**（F-1）：会话被删时，若该会话作为**子**（key 侧）
或**父**（value 侧）参与过 task fork，其条目要等到「父 run 收尾」或「单元出表」才清。
但会话已删 → 单元多半也在 LRU/宽限里被清 → `removeUnit` 会 `clearPendingChildIndex`
顺带清掉。所以**这一条的实际残留窗口很窄**：真正删不掉的形态是
「子会话先于父 run 收尾被单独删除」——不过 core 的 `deleteSessionTree`
（`packages/core/src/service/chat/impl/session.service.ts:207-232`）是**递归**删子会话，
删父必删子，所以单独删子会话的 UI 入口不存在。

**降级理由**：条目量级极小（两个 string），且正常路径（父收尾/出表）都有清理。
保留 P2 是因为它与 F-1 同源——修 F-1 时顺手在 `forgetSession` 里覆盖即可，
不需要单独改动。

**建议**：随 F-1 一并修（`forgetSession` 已有双向清理逻辑 :721-725，只要有人调）。

**置信**：confirmed（清理路径读完），但危害等级 suspected（P2 是「同源共修」而非
「独立可触发的泄漏」）

---

### F-xc-cache-apps-5 | P2 | apps/mobile/src/services/session-stream-unit-manager.service.ts:1297

```ts
/** 宽限销毁与发起型 run 同口径（cr-fix-spec mobile-metrics/C-1）：不接
 *  `onGraceExpired` 的话，宽限到期后单元会永久残留在注册表里 … */
private adoptConsumptiveUnit(sessionId, projectId): SessionStreamUnit {
  const unit = new SessionStreamUnit({
    ...
    onGraceExpired: expired => this.handleGraceExpired(sessionId, expired),
```

**三元组**：本条是「已修的对照样本」，列出来是为了给同族位置定基线。

`adoptInterruptedUnit`:1249-1267（消费型单元的**兄弟**方法，水合建 interrupted 单元用）
**没有传 `onGraceExpired`**。这是**正确的**——`settleAsInterrupted()`:505-512 注释
明说「不启动宽限定时器（常驻至替换或 LRU 淘汰）」，中断现场要常驻到用户重进会话。
`adoptConsumptiveUnit` 传了 `onGraceExpired` 也**是正确的**——它 `begin()` 起步、
经 `markRunning` 进 running、经 `finishRun` settle 进宽限，必须有到期销毁。
两者形态不同不是漏配。

**残留路径（消费型单元的真实残留面）**：`consumptiveSessions`:332 在
`removeUnit`:1631 删。若某个子会话 run 的终态事件丢失，`consumptiveSessions` 的条目
靠 `handleGraceExpired`→`removeUnit` 兜；若 `listCalibratableSessionIds`:1891 也不认
它（认的是 `isActiveUnit && getRunId() != null`，消费型单元 RUN_STARTED 后就有 runId，
所以认），校准会走 `finishLostRun` 收尾。这条链是闭合的。

**结论**：**未发现残留**。此条作为「查过且干净」的负例记录，避免 reduce 阶段重复怀疑。

**置信**：confirmed（无缺陷，负例）

---

### F-xc-cache-apps-6 | P2 | apps/mobile/src/storage/chat-composer-draft.ts:18

`const bySession = new Map<string, ChatComposerDraft>();`

**建立点**：`writeChatComposerDraft`:98、`writeChatComposerDraftState`:128、
`hydrateChatComposerDraftFromDb`:177、`applyComposerStatusAttachmentsReplace`:202。

**清理点**：`writeChatComposerDraft` 空文本自清:89、`writeChatComposerDraftState`
空自清:116、`hydrateChatComposerDraftFromDb` 空自清:172、
`applyComposerStatusAttachmentsReplace` 空自清:197、`clearChatComposerDraft`:141（发送成功后）。

**残留路径**：会话删除**不触发任何清理**——`useChatTabScope.handleDeleteSession`:521
只清了 view cache（:526-528），草稿 Map 里那条 `bySession` 保留。项目删除
（:591-610）同理。这与 F-1 是同一类洞，但落在另一个模块（不在本 zone 的 manager 里）。

**后果**：每条草稿含正文文本（可能几百字）+ attachments 数组。删除会话后草稿仍在
内存，且若将来 sessionId 有复用风险则是脏数据源（当前 sessionId 是 UUID，实际不会）。

**建议**：与 F-1 同批修——`handleDeleteSession` / `deleteSelectedSessions` 里加
`clearChatComposerDraft(id)`（该函数已导出且接受 `sessions` 可选参数，不传即只清内存）。
另考虑加容量上限（草稿是有界的业务对象，超 N 条按 LRU 淘汰最旧的）。

**置信**：confirmed

---

### F-xc-cache-apps-7 | P2 | apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:448

```ts
const snapshotDeferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

**建立点**：`sendSessionSnapshot`:1033（`setTimeout(..., 0)`，快照推迟发送）、
`flushPendingStreamDeltas`:673 / `flushPendingStreamBatch`:730（`streamRafRef` 的 RAF）。

**清理点**：`sendSessionSnapshot` 内三处早退/复用:988-990/:1010-1012/（webReady 侧）、
`commitStreamTail`:1105-1108、`clearLocalStreamBuffers`:497-500（清 RAF）。
`streamRafRef` 的另两处建立点（:673/:730）的回调体首行都置 `= null`。

**残留路径**：`git grep -n "return () =>" -- apps/mobile/src/components/chat/ChatTranscriptWebView.tsx`
**零命中**——17 个 `useEffect` 里**没有任何一个返回清理函数**，即**组件卸载时不取消
挂着的 RAF / setTimeout**。同理 `ComposerInputWebView.tsx`（6 个 effect）、
`CodeEditorWebView.tsx`（3 个 effect）也无 `return () =>`。

**后果**：分级看——
- `snapshotDeferTimerRef` 是 `setTimeout(..., 0)`，下一宏任务即触发，**实际危害≈0**
  （回调体本身有 `webReadyRef` 守卫，`postToWeb`:526 早退）；
- `streamRafRef` 的 RAF 同理是下一帧，卸载后最多多跑一帧；回调里 `postToWeb` 有
  `webReadyRef.current` 守卫早退，且 `webRef.current?.postMessage`（:532）自带
  `?.`，组件卸载后 `webRef.current` 为 null，**不会抛**。

所以真实危害是「资源不主动释放」而非「崩溃」——但这是**所有同族位置的基线缺口**：
一旦将来任何一个 effect 里挂了长周期定时器（现在没有），或 RN 的 WebView 在
repaintEpoch 重挂（:1811 `key={transcript-repaint-${repaintEpoch}}`）时序里出现
「旧实例 RAF 落在新实例 ready 之后」，就会往新 WebView 投递旧世代的 streamDelta。
`webReadyRef` 恰好挡住了这条（重挂时 `webReady` 翻 false → 重挂完成前不发），
属于**当前安全、但靠巧合安全**。

**建议**：在组件顶层加一个统一的 unmount effect，取消两个句柄：
```ts
useEffect(() => () => {
  if (streamRafRef.current != null) cancelAnimationFrame(streamRafRef.current);
  if (snapshotDeferTimerRef.current != null) clearTimeout(snapshotDeferTimerRef.current);
}, []);
```
（RN 的 `cancelAnimationFrame` 在 `react-native` 全局可用，:498 已在用。）
同款给 `ComposerInputWebView` / `CodeEditorWebView` 补一遍（它们目前无待清句柄，
补成空 effect 亦可锁死契约）。

**置信**：confirmed（无 cleanup 属实）／危害 suspected（P3 级，但作为基线缺口记 P2，
因为同族文件是三个 WebView 组件的公共骨架）

---

### F-xc-cache-apps-8 | P3 | apps/mobile/src/web/shared/host-message-channel.ts:44

```ts
export function bindHostMessageChannel(handler: HostMessageHandler): void {
  const onMessage = (event) => { ... };
  document.addEventListener('message', onMessage as EventListener);
  window.addEventListener('message', onMessage as EventListener);
}
```

**建立点**：函数体内无配对移除。四个调用方都是**模块初始化期一次性**：
`chat-transcript/.../boot-transcript.ts:13`（经 `startTranscriptBoot`:34）、
`code-editor/webview/main.ts:8`、`composer-input/webview/main.ts:17`、
`rich-document/webview/main.ts:54`。

**残留路径**：WebView 页面生命周期 = WebView 组件生命周期，组件卸载 → 整个
document/window 连同监听器一起销毁，**没有跨实例残留**。同文件的
`mermaid-fullscreen.ts:94-114` 有 `_delegationAttached` 幂等守卫、
`code-copy.ts:19-23` 有 `attached` 守卫，说明作者知道这个模式；`bindHostMessageChannel`
不需要守卫是因为它只在 main.ts 顶层跑一次。

**结论**：**这是正确设计，不是缺陷**。Android 走 document、iOS 走 window 的双注册
是必要的（见文件头注），无 remove 是因为页面级生命周期。

**置信**：intentional（记录为负例，避免 reduce 阶段误报；出处=文件头注 + 四个调用方
全在模块顶层）

---

### F-xc-cache-apps-9 | P3 | apps/desktop/src/preload/preload.ts:47

```ts
on(channel, callback) {
  let listener = ipcListenerByCallback.get(callback);
  if (!listener) { listener = (_event, payload) => { callback(payload); }; ... }
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); ipcListenerByCallback.delete(callback); };
},
```

**建立点**：`on()` 每次调用 `ipcRenderer.on`。renderer 侧六处订阅
（`ShellNavProvider`:313/:331、`ConversationPanel`:261、`SessionDetailDrawer`:159/:202、
`ChatComposer`:125、`useAgentStream`:153、`useDesktopAgentActive`:14）全部
`return on...` 或 `return () => { off(); ... }`，**清理成对**（逐个核过）。

**残留路径**：`on()` 用 `callback` 作 WeakMap key 缓存 listener，若**同一个 callback
函数引用**被 `on()` 注册两次（例如 `onAgentStream(cb)` 在两个 effect 里用了同一个
`cb` 变量），则第二次 `on` 会**复用同一个 listener**、而 `ipcRenderer.on` 把它
**再挂一次**；`EventEmitter` 对同一函数引用会**去重**（不重复触发），但返回的两个
退订函数里**任意一个**被调都会 `removeListener` 掉那一个唯一 listener 并从 WeakMap
删除 —— 于是**第二个订阅方还活着，事件却再也收不到**（静默失联，不是泄漏）。

**危害**：当前六处订阅的 callback 都是**内联箭头函数**（每次渲染新引用），实际不会
复用同一引用，所以今天不触发。但它是一个**契约级的哑雷**：任何一处将来把 callback
提成 `useCallback` 稳定化、或同一 callback 订阅两个 channel（`off(channel, callback)`
的 API 形状就是为多 channel 设计的），就会命中。

**建议**：把 `ipcListenerByCallback` 的值从「单个 listener」改成
「`listener` + 引用计数」，或更简单：`on()` 里对已存在的 `(channel, callback)`
组合直接返回同一个退订闭包并计数，`off` 时计数归零才 `removeListener`。
或者退一步：renderer 侧六处订阅都改成内联（现状即安全），并在 preload 的
`on` 上加注释说明「同一 callback 不得复用」。

**置信**：suspected（机制确认存在，触发前提今天不成立——引用的都是内联箭头）

---

### F-xc-cache-apps-10 | P3 | apps/desktop/renderer/features/chat/conversation-batch.ts:47

```ts
// flush 回调存 ref：每帧拿最新的 onTextFlush / onThinkingFlush，不用重排 RAF。
const flushRef = useRef<() => void>(() => {});
flushRef.current = () => { ... onTextFlush(text); ... };   // 渲染期无条件赋值
```

**建立点**：`flushRef.current` 在**渲染期**（不是 effect）被无条件重写，
`rafIdRef` 在 `schedule`:68-76 建立 RAF。

**清理点**：`useEffect(() => () => { cancelRaf(); }, [cancelRaf])`:79-83 —— **有**，
且 `deps` 是稳定的 `useCallback([])`，所以 unmount 时确实会 cancel。

**残留路径**：真正的隐患不是 RAF 泄漏（`cancelRaf` 在），而是 `flushRef.current` 的
**渲染期赋值 + RAF 回调在 unmount 后仍可能被调用**这一组合的时序：
RAF 若在 unmount effect 执行**之前**已入队同一帧，React 的 cleanup 与 RAF 回调的
先后取决于宿主调度（Electron renderer 里 RAF 通常在微/宏任务之后，但 React 18
concurrent 下 passive effect 的 flush 时机不保证早于 rAF）。此时 `onTextFlush`
（= `useAgentStream.applyTextDelta`:98-105）会对**已卸载组件所属 hook 的 state**
调 `setStreamingText`。React 18 对卸载后 setState 不再警告也不再崩，但会白跑一次
`prev + delta` 并持有字符串。

**对照**：`useAgentStream` 的 `usageTimer` 清理写得比这里严谨——它在 cleanup 里
`clearTimeout` + `flushUsageNote()`（:255-261），且注释解释了「卸载时冲刷在途 pending
防终值丢失」的**主动**语义。这里是**被动**（cancel 但不 flush），二者口径不同但
都不算错。

**建议**：`flushRef` 改到 `useEffect` 里赋值（与 `useAgentStream` 的
`sendSessionSnapshotRef`:1055-1058 同款），并在 unmount effect 里显式
`flushRef.current = () => {}` 置空，杜绝卸载后调老回调。

**置信**：suspected（时序依赖宿主，非必现）

---

### F-xc-cache-apps-11 | P3 | apps/desktop/renderer/providers/ShellNavProvider.tsx:330

```ts
useEffect(() => {
  return onAgentStream((envelope) => {
    const { type, payload } = envelope;
    if (type !== EVENT_AGENT_STEP_COMMITTED && type !== EVENT_AGENT_RUN_FINISHED) return;
    const p = payload as ...;
    if (p.vfsMutated !== true || p.projectId !== projectId || p.sessionId === workspaceSessionId) return;
    notifyWorkspaceMutated();
  });
}, [projectId, workspaceSessionId, notifyWorkspaceMutated]);
```

**三元组**：建立 = `onAgentStream`（preload `ipcRenderer.on`）；清理 = effect 返回的
退订闭包（`return onAgentStream(...)`，React 自动调）。**成对，无残留。**

**依赖抖动**：`deps` 含 `projectId` / `workspaceSessionId`，会话切换即**退订+重订**一次。
`ipcRenderer` 的 `on/removeListener` 是 O(1) 引用操作，且切会话本就是低频，
**不是泄漏**。同形状的 `onWorkspaceMutated` effect:312-318 同理。`mutateDebounceRef`
的 `setTimeout` 有专门的 unmount 清理 effect:304-310。**全部成对。**

**旁路订阅的存在本身是 intentional**——`docs/apm/RULE.md` L41 明写：「mobile 无此问题：
工作区面板是切换式视图，每次切入全量 reload」，desktop 侧必须旁路，代码注释:320-329
也完整写了理由。不当缺陷报。

**置信**：intentional / 无缺陷（负例）

---

### F-xc-cache-apps-12 | P3 | apps/desktop/renderer/hooks/useAgentStream.ts:132

```ts
useEffect(() => {
  if (sessionId == null) { return; }
  ...
  const off = onAgentStream((envelope) => { ... });
  return () => { if (usageTimer != null) clearTimeout(usageTimer); flushUsageNote(); off(); };
}, [sessionId, callbacksRef, applyTextDelta, applyThinkingDelta]);
```

**三元组**：建立 = `onAgentStream`；清理 = `clearTimeout` + `flushUsageNote()` + `off()`，
**三样齐全且顺序正确**（先清 timer 防重复触发，再 flush pending，最后退订）。
`deps` 里 `applyTextDelta`/`applyThinkingDelta` 是 `useCallback([])` 稳定引用、
`callbacksRef` 是 ref，**不会引起重复订阅**。`batchEnabled` 走 `batchEnabledRef`:129-130
的 ref 通道不进 deps，正确。`useConversationBatch` 的 RAF 有独立的 unmount 清理
（见 F-xc-cache-apps-10）。**无残留。**

**结论**：负例。这条是全仓订阅清理的**样板**：订阅建立 → 三样（timer/flush/off）齐收。
F-9/F-10 之所以是问题，正是因为它们偏离了这个样板。

**置信**：confirmed（无缺陷，负例）

---

### F-xc-cache-apps-13 | P3 | apps/desktop/renderer/hooks/useAgentStreamMetrics.ts:246

```ts
const id = setInterval(() => setTick((t) => t + 1), 250);
return () => clearInterval(id);
```

**建立点**：`running` 为真时的 effect 分支（:210-248）建 250ms 渲染 tick interval。

**清理点**：同分支 `return () => clearInterval(id)`（:247）。deps `[running, runKey, rateSampler]`
—— `rateSampler` 是 `useRef` 惰性建的稳定单例（:182-186，注释明说「改在首次渲染时按需建
（ref 稳定，全生命周期复用）」），**不会引起重复建 interval**。

**残留路径**：`running` 翻假时 cleanup 先跑（清 interval）再走 else 分支冻结
`lastRun`。无残留。

**结论**：负例。

**置信**：confirmed（无缺陷，负例）

---

### F-xc-cache-apps-14 | P3 | apps/mobile/src/services/run-finish-calibration-probe.ts:72

```ts
const reconfirmTimers = new Map<string, ReturnType<typeof setTimeout>>();
...
let pollingInterval: ReturnType<typeof setInterval> | null = null;
```

**建立点**：`calibrate`:92（per-session 复询 `setTimeout`，800ms 防抖）、
`setPollingEnabled`:112（`setInterval(calibrate, 30_000)`，仅在有待校准会话时惰性起）。

**清理点**：`clearReconfirm`:75-81（`clearTimeout` + delete）、
`setPollingEnabled(false)`:113-116（`clearInterval`）、
`dispose`:118-126（`clearInterval` + 遍历清全部 `reconfirmTimers`）。
manager 侧 `dispose`:1943-1946 同时 `calibrationProbe?.dispose()` +
`calibrationAppStateSub?.remove()`（AppState 订阅），**成对**。

**启停正确性**：`setPollingEnabled` 的入参来自 `notifyChanged`:1919-1927 的
`listCalibratableSessionIds().length > 0`——**空闲期不留常驻 interval**，
且 `dispose` 兜底。`reconfirmTimers` 由 `reconfirmTimers.has(sessionId)` 守卫
去重排程（:89-91），回调里 `activeSessionIds().includes` + `isRunRegistered()`
双重复检（:96-101）。**无残留。**

**结论**：负例，且实现质量高（去重排程 + 复询防抖 + 惰性启停 + dispose 全清）。

**置信**：confirmed（无缺陷，负例）

---

### F-xc-cache-apps-15 | P3 | apps/mobile/src/services/session-stream-unit.ts:280

```ts
private graceTimer: ReturnType<typeof setTimeout> | null = null;
private ingressTimer: ReturnType<typeof setTimeout> | null = null;
```

**建立点**：`scheduleGraceDestroy`:1263（settled 宽限）、
ingress 合流:1121（32ms 合并窗）。

**清理点**：`destroy()`:575-590 —— `clearTimeout(graceTimer)` + `clearTimeout(ingressTimer)`
+ `applyBuffer.dispose()`（64ms apply 节拍的 interval/RAF 也在其中）+ `webviewHandles.length = 0`。
另有 `flushStreamBuffers` 路径在 :1146 `clearTimeout(ingressTimer)`。
`destroy()` 由 manager 的 `removeUnit`:1634 在**所有**出表路径调用
（宽限到期 / LRU 淘汰 / startRun 替换 / dispose），**幂等**（:576-578 早退）。

**残留路径**：唯一能绕过 `removeUnit` 的是「单元建了但永远不出表」——
`adoptInterruptedUnit`:1249-1267 建的 interrupted 单元**故意常驻**（无宽限定时器，
靠 LRU 上限 8 释放），这是设计。`units` 里的 settled 单元总数由
`evictSettledOverflow`:1592-1606 按 `settledAtMs` 升序淘汰到 `maxSettledUnits`=8。
**有界，无泄漏。**

**结论**：负例。这条是全仓定时器清理的样板。

**置信**：confirmed（无缺陷，负例）

---

### F-xc-cache-apps-16 | P3 | apps/mobile/src/runtime/novel-master-context.tsx:168

```ts
if (bootToken > 0) {
  runtimeRef.current?.sessionStreamUnitManager.dispose();
  await closeMobileConnection();
}
...
if (cancelled) {
  runtime.sessionStreamUnitManager.dispose();
  await closeMobileConnection();
  return;
}
```

**三元组**：manager 的**全量 dispose 入口有两条** —— ①retry 重建前（:168，
对齐 desktop main 的「先 detach 后销毁连接」时序，注释:164-167 写了理由）；
②effect 已构造 manager 但 component 卸载/依赖变更（:198，svc/B-2 补的）。
**两条都在「销毁连接之前」**——顺序正确（dispose 里 `flushAndDisposeWritethrough`
要写库，连接已关就会失败）。

**残留路径**：第三种形态——**组件整体卸载**（用户退出 app / 热重载）时，
effect 的 cleanup 只有 `cancelled = true`（:216-218），**不调 dispose**。
但此时进程即将终止，manager 的 Map 随 GC 回收，`AppState` 订阅随 JS 上下文销毁。
**不构成泄漏。**

**结论**：负例。dispose 契约与调用时序完整。

**置信**：confirmed（无缺陷，负例）

---

### F-xc-cache-apps-17 | P3 | apps/mobile/src/hooks/useChatTabMessages.ts:38

```ts
const sub = DeviceEventEmitter.addListener('session-transcript-changed', (e) => {...});
return () => sub.remove();
```

**建立点**：`DeviceEventEmitter.addListener`（RN 全局事件总线）。三个 DeviceEventEmitter
使用点全部核过：`useChatTabMessages`:38（`session-transcript-changed`，
deps `[sessionId, onTranscriptChanged]`，有 `sub.remove()`）、
`useChatTabScope`:427（`session-renamed`，deps `[reloadLists]`，有 `sub.remove()`）、
`ChatTabProvider`:388（`subscribeMobileAgentActivity(setAgentActive)`，
deps `[]`，`useEffect` 直接返回退订函数）。**三处全部成对，无残留。**

`SessionDetailScreen` 只有 `DeviceEventEmitter.emit`（:114/:184/:192），是发射端不是接收端。
`agent-activity.ts:21-28` 的 `listeners: Set` 由 `subscribeMobileAgentActivity` 返回的
退订函数 `listeners.delete(listener)` 摘除，**WeakSet 语义外的 Set 但有唯一摘除点**。
`chat-composer-draft.ts:31-38` 的 `subscribeChatComposerDraft` 同款。

**结论**：负例。

**置信**：confirmed（无缺陷，负例）

---

## 争议与存疑

1. **F-2 与 F-3 的等级**：`idleMessageViews`（F-2）我给 P1，理由是它持有**消息正文
   数组**且无上限；`settledProjections`（F-3）只存数字给 P2。但二者是**同款结构缺陷**
   （裸 Map、无上限、唯一清理点同一个零调用的 `forgetSession`）。若主代理认为
   「无上限但条目小」应统一降 P2，我接受——**争议点是 P1/P2 的界，不是事实**。
   另需注意 `idleMessageViews` 的无上限**不依赖删除路径**：正常浏览就会涨
   （`hydrateSessionMessages` 对每个打开过的会话无条件 set），这是 F-2 独立于 F-1 的
   部分，也是我把它单列而非并入 F-1 的原因。

2. **F-7 的等级**：三个 WebView 组件**零 cleanup** 是实测事实，但当前所有待清句柄
   都是「下一宏任务 / 下一帧」级、且回调体有 `webReadyRef` / `?.` 双重守卫，
   **实际不可观测故障**。我给 P2 是因为它们是三个组件的公共骨架、属基线缺口；
   按「当前危害」判应为 P3。**请 reduce 阶段按危害而非按「未来风险」定级。**

3. **F-9 是否算缺陷**：`ipcListenerByCallback` 的复用语义问题机制成立，但今天六处
   订阅的 callback 全是内联箭头、无一复用。我标 suspected 而非 confirmed。
   若主代理或对抗对成员认为「不可触发即非缺陷」，可以整条降为「记录不改」。

4. **未覆盖的两处边界**（留给相邻机位或 W6）：
   - `apps/mobile/src/web/**` 下的 web 侧 JS（`menu.ts` 的 5 处
     `document.addEventListener`/`removeEventListener` 配对、`scroll.ts`、
     `stream-markdown.ts` 的 mermaid 缓存 LRU）我只扫了 listener 配对的 grep 面，
     **未逐文件读完**——web 侧的生命周期是「页面级」，与本 zone 的「组件级」清理
     口径不同，建议由 `w2-mobile-web` 那条线的后续机位补齐 mermaid `svgCache` /
     `failedErrorCache` 的 LRU/TTL 清理。
   - desktop **main 进程**的 listener 生命周期（`forward-event-bus.ts` 的 8 个订阅
     我核过是成对的：`attachEventBusForwarder`:57 先 `detachEventBusForwarder()` 再挂、
     返回退订、main.ts:157-164 `detachMainEventBusListeners` 在 rebootstrap 与
     `before-quit` 都调），但 `attachAgentRunLifecycleListeners` /
     `attachAgentActivityForwarder` 两个我只看了调用点没读实现，属 `desktop-main`
     机位范围。

5. **`interruptedSessionIds()` 的对称性缺口**：`:773-784` 遍历 `units` 找
   `status === 'interrupted'`，读的是**单元状态**而非 Map 键；`activeSessionIds()`
   同款。两者都靠 LRU 上限 8 兜底。水合回填的 interrupted 单元若**全部**占满 8 个
   LRU 槽，一批真正在跑的会话被 `startRun` 替换时（:1094-1098 `takeWebviewHandles` +
   `removeUnit`）不会触发 `evictSettledOverflow`——**新单元是 active 不占槽**，
   所以不会挤掉。但反过来：**8 个 interrupted 单元常驻 + 一个新 interrupted 水合进来**
   → `adoptInterruptedUnit`:1264 调了 `evictSettledOverflow`，正确。
   **此路径闭合，无缺陷**，记录在此以免 reduce 阶段重复怀疑。
