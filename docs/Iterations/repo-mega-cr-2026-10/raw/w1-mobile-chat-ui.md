---
zone: mobile-chat-ui
agent: domain-survey
files_scanned: 47
---

## 摘要（≤150字）

移动端聊天 UI 两个目录共 47 个文件、约 9.9k 行。消息面已收口到 `SessionStreamUnitManager` + WebView transcript（MessageList 留作 KKV 回滚线），composer 已 WebView 化（ComposerAtPathInput 退化为薄壳）。本波无 P0/P1。核心问题是一批**完全无引用的死文件/死导出/不可达分支**（flush-run-ui、tool-turn-actions、transcript-selectable-role 三个整文件零引用；`buildTranscriptRows` 的 stream 分支不可达；两处桥协议死消息），以及**跨端逐字重复的纯逻辑**（message-blocks 工具摘要、composer-send-state）。另有大量 useCallback 冗余依赖与每渲染新建对象导致的回调churn。

## 职责与边界

本区是「移动端聊天 tab 的纯展示 + 交互编排层」，位于 `runtime`（services 层）与 UI 原语（`components/ui`、`BottomSheetMenu`、`VfsFileManager`）之间。

三层结构：

1. **Provider/Context 层**（`ChatTabProvider.tsx`）：把 `useMobileScope` 的 projectId/sessionId、`useChatTabScope`（列表/菜单/导航/缓存清理）、`useChatTabMessages`（仅剩 `draftRestoreToken` + 一个 DeviceEventEmitter 监听）、`useChatTabScrollCache` 汇成 `ChatTabContextValue`；订阅 `runtime.sessionStreamUnitManager` 的投影与消息面。**Provider 不持任何消息 state**（注释明确：运行态唯一出口是 `unitView`）。
2. **编排 hook 层**（`useChatTabController` → `useChatTabMessageActions`）：压缩 / 分叉 / 回滚 / 置位 / 编辑 / 复制；回滚链的 composer 反投影、token 错峰、快照完成信号都在这里。
3. **展示层**（`components/chat/*`）：transcript（WebView 主路径 + MessageList 回滚路径）、composer（WebView 输入壳）、工具卡、菜单、附件 chip。

**边界约定**（区内自述且被遵守）：chat-tab 目录零导航依赖，导航能力一律由父层（`ChatTabScreen`）注入回调（`ChatConversationPanel.tsx:38-41`）；`useChatTabScope.ts:4-5` 说明该层不反向依赖 components。

## 对外接口（对 services 层的依赖面）

| 依赖 | 位置 | 用途 |
|---|---|---|
| `runtime.sessionStreamUnitManager` | `ChatTabProvider.tsx:219,255-270,283,313-320,359,373` | 消息面唯一来源：`snapshot` / `readMessagesSnapshot` / `subscribe` / `loadSessionTailMessages` / `loadOlderSessionMessages` / `attachWebview` / `detachWebview` / `activeSessionIds` / `interruptedSessionIds` / `startRun` / `stopRun` / `requestStreamReset` |
| `runtime.messages`（fork/hide/delete/updateContent） | `useChatTabMessageActions.ts:171` | 分叉 |
| `runtime.messageTranscriptEffects.setMessageFloorAtMessage` | `useChatTabMessageActions.ts:429` | 置位 |
| `runtime.sessions` / `projects` | `useChatTabScope.ts:396-413,447,460,476,478,488,511,524,570,596` | 列表 CRUD |
| `runtime.workplace` / `sessionVfs` / `projectVfs` | `useChatTabScope.ts:689,696,705,738`；`ChatComposer.tsx:174` | 工作区服务 |
| `runtime.skills().effectiveSkills` | `ChatComposer.tsx:203` | `$` typeahead |
| `runtime.state.getCurrentModelId` / `runtime.preferences.getLlmStreamEnabled` | `useChatTabScope.ts:346`；`ChatComposer.tsx:347` | 偏好 |
| `runtime.abortRegistry.has` | `useChatTabScope.ts:165,198` | token 标签 run 在途冻结闸 |
| `services/message-rollback.service.rollbackToMessage` | `useChatTabMessageActions.ts:270` | 回滚本体 |
| `services/compaction-warm-orchestration.runCompactionWithTokenWarm` | `useChatTabMessageActions.ts:114` | 压缩编排（注释称详情页手工副本曾漂移五处，已收口） |
| `services/project-composer-status` | `useChatTabMessageActions.ts:34-37`、`ChatComposer.tsx:41` | composer chip 投影 |
| `services/chat-session-view-cache` / `chat-list-scroll-cache` / `chat-transcript-scroll-cache` | `useChatTabScope.ts:31-37,526,598-600` | 缓存清理 |
| `services/chat-agent-meta` / `chat-prompt-tokens.service` | `useChatTabScope.ts:21-28` | meta/token 标签 |
| `services/session-stream-webview-adapter.createTranscriptStreamHandle` | `ChatTabProvider.tsx:38,313` | 单元→webview 句柄适配 |
| `services/stream-wire-queue.appendWireChunk` | `ChatTranscriptWebView.tsx:75,786,813` | 流式分片合并 |
| `storage/chat-composer-draft` / `chat-transcript-engine` / `chat-rich-text-pref` | `ChatComposer.tsx:26-33`；`ChatTabProvider.tsx:52-56` | 草稿 / 引擎开关 / 富文本开关 |
| `services/yield-quantum` / `chat-transcript-telemetry` / `snapshot-complete-signal` | `ChatTranscriptWebView.tsx:39,66`；`useChatTabController.ts:13` | 让步、打点、错峰信号 |

## 数据访问（读哪些 service/store/state）

- **本地 state**：`useChatTabScope` 持 12 个 useState（projects / sessions / currentProject / 三个面板开关 / 两个 drawer / vfsRefreshKey / menuSessionId / sessionRenamePrompt / agentMeta / hasWorkspaceModel）；`ChatTabProvider` 持 10 个（两个 picker、webview refs、chatRichTextEnabled、messageMenuTarget/Anchor、webMenuOpen/CloseSignal、mermaidViewerOpen/CloseSignal、messageEditPrompt、chatTranscriptEngine、transcriptReadyEpoch、modelPicker/agentPicker）。
- **ref 槽（去抖/在途/代次）**：`useChatTabScope.ts:106,135-144,310-315,320`（token 标签身份闸、防抖槽、meta 在途槽、round 计数、showToast 稳定化）；`ChatTranscriptWebView.tsx:425,430,434-447,451-454,455-458,464-494,501-521`（webReady 镜像、repaintEpoch、forceSnapshot 标志、脏推送计数、prev* 基线、defer timer、pendingSnapshot、RAF 句柄、两套流式分段队列、四个累积 ref、in-flight 代次、deferred 队列）。
- **DeviceEventEmitter**：`session-renamed`（`useChatTabScope.ts:427`）、`session-transcript-changed`（`useChatTabMessages.ts:38`）。
- **KKV/偏好**：`chatTranscriptEngine`（webview | legacy-rn）、`chatRichText`、以及 `runtime.abortRegistry`。
- **进程内 store**：`@novel-master/core/chat` 的 `addChatAnnotateDraft` / `listChatAnnotateDrafts` / `subscribeChatAnnotateDraft`（批注草稿，**不进 composer 草稿**，与 RULE 术语条目「批注」一致）。

## 依赖关系

```
ChatTabScreen
└─ ChatTabProvider ─┬─ useChatTabScope (lists/menus/nav/caches/token label)
                    ├─ useChatTabMessages (draftRestoreToken + emitter)
                    └─ useChatTabStream (=useChatTabScrollCache)
   └─ ChatTabNavigationProvider (顶栏/返回态; WorkspaceBackCtx)
      ├─ ChatSessionListPanel  (会话列表 + 项目工作区)
      └─ ChatConversationPanel
         ├─ useChatTabController → useChatTabMessageActions
         ├─ useInterruptedPartialCommit
         ├─ ChatMetaBar / ChatStreamMetricsBarLive
         ├─ ChatComposer ─ ComposerAtPathInput ─ ComposerInputWebView ─(web bundle)
         │                     └─ ComposerInputBridge (协议)
         │                 ├─ AtPathTypeahead / SkillTypeahead / TypeaheadList
         │                 ├─ FileReferencePicker / SkillPicker
         │                 └─ AttachmentDraftChips(ComposerStatusChips)
         ├─ ChatTranscriptWebView ─ ChatTranscriptBridge / enrich-transcript-rows
         │                          └─ message-blocks (行构建) → ChatTranscriptBridge
         ├─ MessageList (legacy-rn 回滚路径) → message-blocks
         ├─ MessageActionMenu → anchored-menu-layout (→ webview-host 真源)
         ├─ MessageEditModal → message-edit
         └─ VfsFileManager
```

外部共享真源：`@novel-master/core/chat`（`@路径` 查询、发送态、批注解析、回滚锚点提示语、link 识别、skill/vfs 工具引用解析）、`webview-host/*`（composer 与 transcript 的 web 包 URI + 菜单布局纯函数）、`web/*`（block-split、transcript-capabilities、mermaid-core）。

## 发现清单

### P2

**F-mobile-chat-ui-1 | P2 | apps/mobile/src/components/chat/message-blocks.ts:527**
```
  if (
    stream != null &&
    (stream.text.length > 0 || stream.thinking.length > 0)
  ) {
    rows.push({kind: 'stream', text: stream.text, thinking: stream.thinking});
```
`buildTranscriptRows` 的 `stream` 形参与 `kind:'stream'` 行分支不可达：全仓两个调用点都不传 stream（`ChatTranscriptWebView.tsx:1303` 显式传 `undefined`，另一处省略）。legacy MessageList 的 stream 行是自己拼的字面量（`MessageList.tsx:347-348`），不走这里。连带 `message-blocks.ts:452` 的 `TranscriptStreamState` re-export 也不可达。描述：死分支 + 被它撑起的死 re-export。建议：删 `stream` 形参与 527-536 分支、删 450-452 re-export。置信 confirmed。

**F-mobile-chat-ui-2 | P2 | apps/mobile/src/components/chat/ChatTranscriptBridge.ts:189**
```
  | BridgeEnvelope<'messagePatch', {messageId: string; patch: unknown}>
```
`messagePatch` 协议消息 RN 侧从未构造也从未发送；web 侧 bridge 的注释自己就把它归为「协议内不存在的消息（含 transcript 的 log/messagePatch 类死消息）」（`web/composer-input/webview/runtime/bridge.ts:67`）。同文件的 `stream?: TranscriptStreamState`（`:113-114`，已标 `@deprecated`）同样无发送方。描述：协议里两条永不走通的死消息。置信 confirmed。

**F-mobile-chat-ui-3 | P2 | apps/mobile/src/components/chat/ChatTranscriptBridge.ts:260,269,286 与 ComposerInputBridge.ts:89,112**
```
export type HostToTranscriptType = HostToTranscriptMessage['type'];
export function encodeTranscriptToHost(message: TranscriptToHostMessage): string
export function decodeHostToTranscript(raw: string): HostToTranscriptMessage
```
这 5 个导出在 `apps/mobile/src` 全域只出现一次（定义处），无任何 import 方。两个桥模块各留一个「反向」编解码器：宿主→web 的编码器在用，web→宿主的解码器在用，而「web→host 编码器」与「host→web 解码器」两边都没人调。描述：两个桥模块各留一对从未使用的对称 API。置信 confirmed。

**F-mobile-chat-ui-4 | P2 | apps/mobile/src/components/chat/flush-run-ui.ts:17 / tool-turn-actions.ts:10 / transcript-selectable-role.ts:32**
```
export async function flushRunUi(onMessagesChanged: FlushMessagesChanged, ...)
export async function hideToolTurn(runtime: MessageRuntime, ...)
export function isTailBatchMode(mode: MessageBatchMode | null): mode is 'restore' | 'delete'
```
三个整文件在 `apps/mobile/src`、`apps/mobile/e2e`、仓内任何路径下**零引用**（`findstr /S` 全仓扫描无命中）。成因清晰可见：`tool-turn-actions.ts` 的 hide/delete tool-turn 是 mobile 已下线的能力（`message-edit.ts:52` 明写菜单「无 hide/delete」），实现留在了 desktop 的 `apps/desktop/renderer/features/chat/tool-turn-actions.ts:12`；`transcript-selectable-role.ts` 是一层对 `@novel-master/core/chat` 的薄 re-export，调用方已改从 core 直引；`flush-run-ui.ts` 的 flushRunUi/flushAgentStepUi 在 Step 6 单元化后由 manager 收编。描述：功能退役后未清理的三个整文件（约 115 行）。建议：删除；若 desktop 侧仍用 tool-turn-actions，请顺手评估 mobile 是否需要同款能力（当前明确不需要）。置信 confirmed。

**F-mobile-chat-ui-5 | P2 | apps/mobile/src/components/chat/message-blocks.ts:277-328（对照 apps/desktop/renderer/features/chat/message-blocks.ts:178-241）**
```
export function summarizeToolInput(name: string, input: Record<string, unknown>): string {
export function toolCallSummary(tool: ToolCallView): string {
```
`summarizeToolInput` + `toolCallSummary` 在 mobile 与 desktop 逐字重复（120 字符截断、`slice(0,117)+'…'`、`error && summary` 短路全同），两端各有一份、无共享源。同类重复还有发送态推导：mobile `components/chat/composer-send-state.ts:14,27` 的 `findLastVisibleMessage` / `deriveComposerSendState` 与 desktop `renderer/features/chat/composer-send-state.ts:63,76` 的 `findLastVisibleMessageDto` / `deriveComposerSendState` 是同一套规则的两个实现（仅 DTO/suffix 差异）。而 `@路径` 查询（`composer-at-path.ts`）、`applyTextEditToMessage`、锚点菜单布局（`anchored-menu-layout.ts` → `webview-host`）都已正确收口到共享源，说明这套收口在工具摘要与发送态两块漏了。描述：跨端纯逻辑重复，已有实测漂移风险。置信 confirmed。

**F-mobile-chat-ui-6 | P2 | apps/mobile/src/components/chat/enrich-transcript-rows.ts:43 与 message-blocks.ts:145,198**
```
/** Test-only: reset the bounded cache between cases. */
export function clearRichHtmlCacheForTests(): void { richHtmlCache.clearAll(); }
```
`clearRichHtmlCacheForTests` 注释写明是测试专用，但全仓无任何测试引用它（`e2e` 与 `src` 均无）——富文本 HTML LRU 缓存一旦在某条路径被填充就没有复位口子。同批还有 `message-blocks.ts:145` 的 `turnToolResultsComplete` 与 `:198` 的 `isTurnToolExecuting` 两个导出，同样零调用方（内部已有 `...With` 变体在用）。描述：为不存在的测试预留的复位钩子 + 两个已被 `...With` 变体取代的旧导出。置信 confirmed。

### P3

**F-mobile-chat-ui-7 | P3 | apps/mobile/src/screens/tabs/chat-tab/useChatTabMessageActions.ts:503**
```
    [
      handleForkFromMessage,
      handleSetFloorFromMessage,
      handleRollbackFromMessage,
      sessionId,
      projectId,
      agentRunning,
      runtime,
      reloadMessages,
      refreshChatTokenLabel,
      setMessageEditPrompt,
      showToast,
    ],
```
`handleMessageMenuAction` 的闭包体（474-502）只用 `target` / `setMessageEditPrompt` / `showToast` / 三个 handler，依赖数组里的 `sessionId`、`projectId`、`agentRunning`、`runtime`、`reloadMessages`、`refreshChatTokenLabel` 六项全部未被引用——是拆分 `handleRollbackFromMessage` 等子回调时残留的。后果不只是冗余：任一项变动都会白重建该回调。置信 confirmed。

**F-mobile-chat-ui-8 | P3 | apps/mobile/src/components/chat/ChatComposer.tsx:527**
```
  }, [
    runtime, sessionId, hasModel, running, text,
    canResumeWithoutInput,      // ← 闭包体未用（用的是 sendIntent.allowResumeWithoutInput）
    lastMessageIsPlainUserText, onNeedModel, executeRun, sendIntent,
  ]);
```
`send` 的依赖数组含未使用的 `canResumeWithoutInput`。同文件 `:416-421` 的 `executeRun` 依赖 `scope`（对象）而实际只用 `scope.projectId`；配合 `ChatConversationPanel.tsx:284` 每次渲染新建的 `scope={{projectId, sessionId}}` 字面量，`executeRun` 与 `send` 每次渲染必重建。置信 confirmed。

**F-mobile-chat-ui-9 | P3 | apps/mobile/src/components/chat/ChatComposer.tsx:163**
```
  const hasAnnotateDrafts = hasChatAnnotateDrafts(sessionId);
  void annotateEpoch;
```
`annotateEpoch` 只是个 bump 计数器（唯一用途是触发重渲染），却必须靠 `void annotateEpoch;` 压制 lint 才算「被使用」——一个可读性债务。替代做法是 `useSyncExternalStore` 直接订阅 `subscribeChatAnnotateDraft`（该订阅在 `:317-325` 已存在，顺手可得布尔值）。置信 confirmed。

**F-mobile-chat-ui-10 | P3 | apps/mobile/src/components/chat/ChatComposer.tsx:93-97 与 :604-615**
```
  /** 暂未使用：工具栏「更多」按钮已注释隐藏，调用方也不再传该 prop。保留接口，
   *  后续若恢复按钮再从解构里取回即可。 */
  onOpenMore?: () => void;
  ...
          {/*
          <Pressable onPress={onOpenMore} ... >
          ...
          </Pressable>
          */}
```
`onOpenMore` prop 声明、且工具栏「更多」按钮整段 JSX 以注释形式保留（12 行）。`ChatConversationPanel.tsx:295-297` 同步留了注释掉的传参。属有意保留（注释明说），但注释代码块不参与类型检查也跑不起来，入口恢复时很可能已经腐坏。标 intentional（出处=文件自身注释）+ 建议改记进 issue 而非留注释块。置信 intentional。

**F-mobile-chat-ui-11 | P3 | apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:983**
```
      flushPendingStreamDeltas,
      flushPendingStreamBatch,
      enqueueDeferredStreamFlush,   // ← 闭包体（835-970）从未调用它
    ],
```
`sendSessionSnapshotNow` 的依赖数组含未使用的 `enqueueDeferredStreamFlush`。同文件另有两处同类：`:1088` / `:1172` / `:1318` 的 `agentRunning`（闭包实际经 `transcriptListOptions` 捕获 agentRunning），以及 `:405` 的 `uiRunning` 兜底表达式。置信 confirmed。

**F-mobile-chat-ui-12 | P3 | apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:414**
```
      const transcriptListOptions = {
        agentRunning,
        runUiStopped: !uiRunning,
        pendingSubagentSessions,
      };
```
每渲染新建的裸对象（未 useMemo），被 5 个 useCallback（`sendSessionSnapshotNow` / `sendAppendTailRows` / `tryCommitStreamTail` / `sendPrependPage` / `commitStreamTail` 间接）当作依赖挂住，导致这些回调与 `useImperativeHandle`（`:1271-1291`）产出的 handle 每次渲染都换身份。文件内已为 `sendSessionSnapshot` 单独做过 ref 取最新（`:1051-1058`）来规避同类问题，说明这条路径被识别过但只修了一处。置信 confirmed。

**F-mobile-chat-ui-13 | P3 | apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:1652**
```
          for (let i = 0; i < messages.length; i += 1) {
            if (prevMsgs[i]!.hidden !== messages[i]!.hidden) {
```
压缩/置位后 hidden 变化的兜底检测是逐条线性扫描，且没有任何前置预算/上限（与同文件 `planSnapshotChunkBounds` 特意做的 256KB 字节预算、50 条分片形成了鲜明反差）。已有 `prevMsgs.length === messages.length` 的前置守卫，但全量 tail（数百条）下每次 messages 变更仍要多扫一遍。建议：折叠 `hidden` 指纹（数量+首尾序）比较。置信 confirmed。

**F-mobile-chat-ui-14 | P3 | apps/mobile/src/screens/tabs/chat-tab/ChatTabProvider.tsx:71**
```
export type ChatTabContextValue = {
  readonly tokens?: never;
  readonly projectId: string | undefined;
```
`tokens?: never` 是一个永不赋值的占位字段，`never` 类型让它连赋值都编译不过。属于 ctx 形状定型时留下的空位。置信 confirmed。

**F-mobile-chat-ui-15 | P3 | apps/mobile/src/screens/tabs/chat-tab/ChatTabProvider.tsx:437**
```
  const refreshChatTranscriptEngine = useCallback(async () => {
    setChatTranscriptEngine(await readChatTranscriptEngine(appUi));
  }, [appUi]);
```
`refreshChatRichTextPref`（`:430-435`）有 `if (appUi == null) return;` 守卫，`refreshChatTranscriptEngine` 没有，直接把可能为 null 的 `appUi` 传下去。已核 `readChatTranscriptEngine`（`storage/chat-transcript-engine.ts:23-25`）签名接受 `null | undefined` 并交给 `readEnumPref`，所以**当前无害**；但两个姊妹函数一个守一个不守，日后收紧 `readEnumPref` 签名就会在这里炸。低危，标 suspected（实际风险低、隐患是防线不对称）。置信 suspected。

**F-mobile-chat-ui-16 | P3 | apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx:381**
```
            disabled: controller.onNavigateRealPrompt == null,
```
`onNavigateRealPrompt` 在 `useChatTabController.ts:106-108` 是无条件定义的 useCallback，永不为 null，这个 `disabled` 恒为 false。置信 confirmed。

**F-mobile-chat-ui-17 | P3 | apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx:317-331**
```
          {Platform.OS === 'android' ? (
            <View style={chatPanelStyle} pointerEvents={chatPointerEvents}>
              {chatHeader}
              <AndroidKeyboardClipBody>
                <View style={styles.transcriptHost}>{chatTranscript}</View>
                {chatComposer}
              </AndroidKeyboardClipBody>
            </View>
          ) : (
            <View style={chatPanelStyle} pointerEvents={chatPointerEvents}>
              {chatHeader}
              <View style={styles.transcriptHost}>{chatTranscript}</View>
              {chatComposer}
            </View>
          )}
```
两个分支除 `AndroidKeyboardClipBody` 包裹外逐字相同。可提取 `inner`，用 `Platform.OS === 'android' ? wrap(…) : inner` 收敛。置信 confirmed。

**F-mobile-chat-ui-18 | P3 | apps/mobile/src/screens/tabs/chat-tab/ChatSessionListPanel.tsx:406,413,421**
```
  currentBadge: {paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, marginRight: 4},
  generatingBadge: { … 同上逐字 … },
  interruptedBadge: { … 同上逐字 … },
```
三个徽标样式块逐字相同（`currentBadgeText` 共用是对的，容器样式却各抄一份）。同文件 `:103-108` 与 `:116-121` 又是同一 `manager.subscribe(sync)` 模式的两份复制（`activeRunIds` / `interruptedRunIds`），可合并为一次订阅同时算两个 Set。置信 confirmed。

**F-mobile-chat-ui-19 | P3 | apps/mobile/src/screens/tabs/chat-tab/useChatTabController.ts:86**
```
    [ctx, sessionRunActive],
```
本文件 6 个 useCallback（`:86, :104, :118, :127, :141, :172`）以整个 `ctx` 为依赖。`ctx` 由 `ChatTabProvider.tsx:453` 的 `useMemo` 产出，其依赖里含 `scope`/`scroll`/`composerSendState`/`messages` 等每次渲染都会换引用的对象——于是这些回调在任何一次 Provider 重算后全部换身份，下游 `ChatConversationPanel` 传进 `ChatTranscriptWebView` 的 `onWebMenuOpenChange` / `onWebMessageMenuAction` / `onSnapshotComplete` 也就跟着失效（`chatTranscriptWebViewPropsEqual` 不比较回调但 `handleMessage` 的 `useCallback` 会重建）。`messageActions`（`:55`）返回的是每次新建的对象字面量，`[ctx, messageActions]`（`:127`、`:141`）恒变。置信 confirmed。

**F-mobile-chat-ui-20 | P3 | apps/mobile/src/screens/tabs/chat-tab/useChatTabStream.ts:25**
```
export function useChatTabScrollCache({...})
```
文件名 `useChatTabStream.ts` 与唯一导出 `useChatTabScrollCache` 不符（该文件已无任何 stream 逻辑，文件头 `:1-3` 自述「scroll cache helpers」）。`ChatTabProvider.tsx:63` 的 import 路径也据此命名。属命名漂移。置信 confirmed。

**F-mobile-chat-ui-21 | P3 | apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts:792 / useChatTabMessages.ts:55 / useChatTabStream.ts:91 / useChatTabController.ts:177**
```
export type UseChatTabScopeResult = ReturnType<typeof useChatTabScope>;
```
四个 `ReturnType` 导出别名（外加 `UseChatTabMessagesResult` / `UseChatTabScrollCacheResult` / `ChatTabController`）全仓零引用。仓内惯例是消费方自己 `ReturnType<typeof useX>`，别名属于早期脚手架残留。置信 confirmed。

**F-mobile-chat-ui-22 | P3 | apps/mobile/src/components/chat/message-blocks.ts:461**
```
      ? item.message.attachments!.filter(isDisplayableAttachment)!.map(a => ({
```
`filter` 之后紧跟的 `!` 非空断言是多余的（`filter` 必然返回数组）。同文件 `:459` 的 `attachments!` 是必要的，但 filter 后的这个不是。置信 confirmed。

**F-mobile-chat-ui-23 | P3 | apps/mobile/src/components/chat/ComposerInputWebView.tsx:98**
```
  /**
   * 外部要求失焦（照 code-editor）。
   * 当前无调用方，留作发送后收键盘等未来需求。
   */
  blur: () => void;
```
以及同文件 `:429` 的不限高分支：
```
  const unbounded = metrics.maxHeight == null;
```
`blur` 无调用方、`unbounded` 分支无生产消费方（`metrics.maxHeight` 恒为数字）。两处都在文件头 `:10-12` / `:97-99` 显式声明「勿当作无用代码删」。标 intentional（出处=文件头注释），建议改挂 issue 追踪，避免「留作未来」变成永久沉积。置信 intentional。

**F-mobile-chat-ui-24 | P3 | apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts:437 与 :521 / :564**
```
  const currentSession = sessions.find(s => s.id === sessionId);
```
`currentSession` 只从当前 `sessions` 列表（仅含当前 project）里找；跨项目切会话的中间帧会得到 `undefined` 并让 `ChatTabNavigationProvider.tsx:53-54` 的标题退化成 sessionId（已有 `?? id` 兜底，故不炸、只是标题闪一下）。同文件 `handleDeleteSession`（`:521-541`）与 `deleteSelectedSessions`（`:564-589`）的 `clearSessionViewCache` 循环体逐字重复，只差单条/批量。置信 confirmed。

**F-mobile-chat-ui-25 | P3 | docs/apm/RULE.md:21（术语条目「composer tag 多行闪烁」）对照 apps/mobile/src/components/chat/ComposerAtPathInput.tsx:1-15**
```
 * main 版 mention 库全链（useMentions / nativeTruthRef 自愈对账 / promotePlainMentions
 * / replaceActiveAt 的 onSelect）随 WebView 化整体消失：高亮分段、原子删、选区真源
 * 都在 web 单引擎内（`composer-highlight` + `atomic-range-delete` 进 web bundle），
```
RULE 的已知问题条目把根因描述为「胶囊内联在 TextInput 内则不可避免」，并指向 `ComposerAtPathInput.tsx`；但该文件现在只是 `ComposerInputWebView` 的 props↔桥消息搬运壳，构成该现象的 TextInput + 内联 span 实现已整体删除。当前该条目既不是有效的排查入口，也可能诱导后来者去「修」一个不存在的实现。建议：条目标注实现已替换、现象是否仍在需真机复验。标 intentional 的 RULE 条目 + 事实性漂移。置信 confirmed。

### intentional（已核实为有意设计，不作缺陷计）

- **MessageList 全链路（`MessageList.tsx:1-11` + `ToolCallCard` / `ToolCallGroupCard` / `ThinkingBlockCard` / `ToolTurnPhaseBar` / `message-blocks.buildChatListItems`）**：`@deprecated`，但由 `storage/chat-transcript-engine.ts:13` 的 KKV 开关（`chatTranscriptEngine: 'legacy-rn'`）真实可达，是免重装的回滚线。`ChatConversationPanel.tsx:220/248` 的三元分支就是这条回滚线。**不是死代码**。出处：文件头 + 引擎开关文件。
- **`message-blocks.ts:73-75` `isDisplayableAttachment`（丢弃非 annotate 的 user_ops）**：RULE 术语条目「user ops / 操作日志（已拆除）」明写「遗留历史消息中的操作日志附件在展示层直接丢弃（过滤非 annotate 的 user_ops，原始数据不删）」，并点名本文件为丢弃口径。标 intentional。
- **`ChatSessionListPanel.tsx:218-232` 「· 活跃中」挂 `isRunning` 而非 `isCurrent`**：注释带日期与真机实录编号（GWT-7，2026-09-30），是为修「run 已收尾 4 分钟仍显示活跃中」「重启后凭空出现」而刻意改的。标 intentional。
- **`useChatTabScope.ts:108-128` 切会话同步清 token chip（`useLayoutEffect`）**：注释标注 r4-app-2，理由是 post-paint 的 useEffect 会漏一帧。标 intentional。
- **`ComposerAtPathInput.tsx` 双层壳 + `ComposerInputWebView` 的受控桥（打字不上抛回写）**：注释标注 v1.5.9 的 IME 防线（`setSelectionRange` 打断 IME 组合态会把光标拽回去），是踩过坑的定稿。标 intentional。
- **两处 `useCallback([ctx])`（F-19）与 `transcriptListOptions`（F-12）虽同源，但文件内已分别留了 ref 取最新的局部缓解**（`useChatTabController.ts:23` 的 `snapshotSignalRef`、`ChatTranscriptWebView.tsx:1055` 的 `sendSessionSnapshotRef`），说明这是已知未收敛项而非疏忽。已按 P3 记。

## 争议与存疑

1. **F-mobile-chat-ui-1（`buildTranscriptRows` 的 stream 分支）我判为死代码而非「防御性保留」**：理由是 legacy MessageList 的 stream 行自己拼字面量（`MessageList.tsx:347-348`），说明这条能力在两侧被各写了一遍。如果作者认为 MessageList 应当改走 `buildTranscriptRows`，那结论会反过来——但那需要 MessageList 一起改，现状是两份实现。若后续确认 MessageList 退役（`chatTranscriptEngine` 的回滚线也一并下掉），本条与 F-4 应收敛成一次清理。
2. **F-mobile-chat-ui-5（跨端重复）我不主张现在合并**：`toolCallSummary`/`summarizeToolInput` 目前逻辑逐字相同，合并无行为风险；但它属于 desktop 域，收编位置要跨到 desktop 侧决策（放 core 还是 web/shared），不是本区能单方面定的。列出是因为它与已正确收口的 `@路径` 查询 / 锚点菜单布局形成反差，说明收口清单漏了项。
3. **F-mobile-chat-ui-15 我刻意标 suspected 而非 confirmed**：`readChatTranscriptEngine` 的签名确实接受 null，所以现状不是 bug；把它列出来是因为「一个姊妹函数守、一个不守」是防线不对称的早期信号。严重度可能应低于 P3。
4. **F-mobile-chat-ui-25（RULE 漂移）需要一次真机复验才能定性**：我能确认的是「条目描述的实现已被 WebView 单引擎取代」这一事实；「闪烁现象现在是否还存在」我没有真机证据，不排除 WebView 化后问题已自然消失（那本条应升级为 RULE 清理项而非已知问题）。
5. **未细读清单（诚实标注）**：本区 47 个文件全部扫描（行数 + 引用关系 + 导出符号），但逐行细读的只有上表引用的部分。**未逐行细读**：`FileReferencePicker.tsx`(418)、`MessageEditModal.tsx`(239)、`MessageList.tsx` 的 120-640 段（约 520 行）、`ChatStreamMetricsBarLive.tsx`(175)、`ToolCallCard.tsx`(172)、`AttachmentDraftChips.tsx`(106)、`ChatMetaBar.tsx`(111)、`ChatStreamMetricsBar.tsx`(75)、`ThinkingBlockCard.tsx`(90)、`ToolCallGroupCard.tsx`(83)、`ComposerInputBridge.ts`(109)、`composer-highlight.ts`(57)。这些文件均跑过「导出符号全域引用计数」与「文件级引用扫描」，未报死代码；**但其中的内部逻辑冗余、双源、未细读分支不在本波覆盖范围内**，需要第二轮按需下钻。
6. **本波未覆盖的横向检查**：`web/`（composer-input 与 chat-transcript 的 web 侧 bundle）、`webview-host/`（菜单布局、URI）、`services/session-stream-*`（单元管理器）。跨端比对只做了 mobile↔desktop 纯逻辑的定向 grep，未做全量对照。
