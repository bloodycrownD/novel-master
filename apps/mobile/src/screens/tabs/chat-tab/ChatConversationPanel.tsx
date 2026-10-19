/**
 * Chat tab conversation subview: transcript, composer, session workspace.
 *
 * 布局形态（chat-webview-unify Step 7 起；composer-native-2026-10 Step 5 起
 * 输入框原生化）：裁切容器内是「转录 webview + 原生输入 dock」两个 RN 兄弟——
 * `<ChatConversationWebView>` 已退为纯转录宿主（加载 chat-transcript 独立包），
 * 输入框由 `<NativeChatComposer>`（EnrichedMarkdownTextInput 基座）承接，
 * Android 与 iOS 同构（iOS 不套裁切容器）。转录文档的恢复链（init→快照）与
 * composer 的恢复链（草稿水化 → ref.setText）**并行**、互不握手（D8）。
 * 两个 RN Modal 选择器仍挂本面板（选文件 / 选技能后经 M7 命令式通道回填正文）。
 *
 * `ChatConversationWebSurface` 这个子组件边界的存在理由是**把 controller 与它的
 * 一堆派生收敛在一个稳定的子树上**：`useChatTabController` /
 * `useChatComposerController` 都只在这里调，面板本体只管 header、workspace
 * 面板与各类 RN Modal 开关。
 *
 * ## 回滚 SPA 化之后的形态
 *
 * 1. **面板随 `chatSubview` 条件渲染**：`ChatTabScreen` 在 `chatSubview ===
 *    'conversation'` 时才挂本面板，会话列表（RN 的 `ChatSessionListPanel`）与它
 *    平铺为两个兄弟——WebView 文档里不再有「列表视图」这回事，`viewState` /
 *    `sessionList` / `onListAction` 一整套列表域已从宿主侧拆除。
 * 2. **切会话经 key 重挂**：`<ChatConversationWebView>` 带
 *    `key={chatScrollKey ?? 'no-session-scroll'}`，切会话销毁重建 WebView，
 *    文档状态天然归零（这段 key 曾随 SPA 化被拆，本轮回滚恢复）。composer 不随
 *    key 重挂：草稿属 controller（订阅 sessionId），切会话由水化链把新会话草稿
 *    经命令式通道送进输入框。
 * 3. **会话行 ⋮ 菜单**随之回迁 `ChatSessionListPanel`（菜单本体始终留在 RN：
 *    BottomSheetMenu/Alert 不进 web）。
 */
import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import {Platform, StyleSheet, Text, View} from 'react-native';
import {type VfsScope} from '@novel-master/core/vfs';
import {formatStatusChipLabelFromAttachment} from '@novel-master/core/chat';
import {AgentPickerModal} from '@/components/agent/AgentPickerModal';
import {ChatConversationWebView} from '@/components/chat/ChatConversationWebView';
import {conversationThemeFromTokens} from '@/components/chat/conversation-theme';
import {
  NativeChatComposer,
  type NativeChatComposerInstance,
} from '@/components/chat/NativeChatComposer';
import type {TokenRange} from '@/components/chat/native-composer/token-ranges';
import {FileReferencePicker} from '@/components/chat/FileReferencePicker';
import {SkillPicker} from '@/components/skills/SkillPicker';
import {
  useChatComposerController,
  type ComposerFullscreenPayload,
} from '@/components/chat/useChatComposerController';
import {ChatMetaBar} from '@/components/chat/ChatMetaBar';
import {ChatStreamMetricsBarLive} from '@/components/chat/ChatStreamMetricsBarLive';
import {MessageEditModal} from '@/components/chat/MessageEditModal';
import {ModelPickerModal} from '@/components/provider/ModelPickerModal';
import {BottomSheetMenu} from '@/components/sheet/BottomSheetMenu';
import {VfsFileManager} from '@/components/vfs/VfsFileManager';
import {SegmentedControl} from '@/components/ui/SegmentedControl';
import {AndroidKeyboardClipBody} from '@/components/chrome/AndroidKeyboardClipBody';
import {useToast} from '@/components/chrome/ToastHost';
import {useTheme} from '@/theme/ThemeProvider';
import {
  AGENT_LOCK_TOAST_GUIDE,
  isAgentLocked,
  isModelLocked,
  MODEL_LOCK_TOAST,
} from '@/services/chat-agent-meta';
import type {ThemeTokens} from '@/theme/tokens';
import {useChatTabContext} from './ChatTabProvider';
import {useChatTabWorkspaceBackState} from './ChatTabNavigationProvider';
import {useChatTabController} from './useChatTabController';
import {useInterruptedPartialCommit} from './useInterruptedPartialCommit';

export type ChatConversationPanelProps = {
  tokens: ThemeTokens;
  visible: boolean;
  /**
   * ⛶ 全屏编辑入口：父层（ChatTabScreen）注入，转交 composer controller。
   * 本面板不做导航（chat-tab 目录零导航依赖），只当通道。
   */
  onOpenComposerFullscreen?: (payload: ComposerFullscreenPayload) => void;
};

/**
 * 对话面：纯转录 `<ChatConversationWebView>` + 原生 `<NativeChatComposer>` +
 * controller 接线 + 两个 RN Modal 选择器（composer-native-2026-10 Step 5）。
 *
 * `projectId` / `sessionId` 由调用方在已判非空的分支里传入——controller 的 scope
 * 两者皆必填，**不**在本组件里做二次判空（判空就得放 hook 之前 early return，
 * 那会让「本次渲染 hook 数」随入参变化，React 直接报 hook 顺序错）。
 */
function ChatConversationWebSurface(props: {
  readonly projectId: string;
  readonly sessionId: string;
  readonly onOpenComposerFullscreen?: (
    payload: ComposerFullscreenPayload,
  ) => void;
}) {
  const {projectId, sessionId} = props;
  const ctx = useChatTabContext();
  const controller = useChatTabController();
  const {
    agentMeta,
    unitView,
    transcriptWebRef,
    chatScrollKey,
    chatMessages,
    hasMoreMessages,
    chatRichTextEnabled,
    pendingSubagentSessions,
    webMenuCloseSignal,
    mermaidViewerCloseSignal,
    restoredTranscriptScroll,
    defaultChatScrollToBottom,
    hasWorkspaceModel,
    canResumeWithoutInput,
    lastMessageIsPlainUserText,
    draftRestoreToken,
    onMessagesChanged,
    onNeedModel,
    onChatScrollSnapshot,
    onLoadOlderMessages,
  } = ctx;

  // 当前会话 run 是否活跃（单元投影派生：starting|running；含受理未回填的
  // 保护窗——starting 投影即时可见，乐观置位已随单元化退役）。
  const unitActive =
    unitView?.status === 'starting' || unitView?.status === 'running';

  // 中断现场渲染（Step 6，语义说明见 hook 模块头）：与 SubagentSessionScreen
  // 共用同一份 effect（ui/C-1 抽取）；ready 世代入依赖修 ui/B-1 的
  // 「tail 先于 webview ready 到达」时序。
  useInterruptedPartialCommit({
    unitView,
    webRef: transcriptWebRef,
    readyEpoch: ctx.transcriptReadyEpoch,
  });

  const transcriptFlags = useMemo(
    () => ({richText: chatRichTextEnabled}),
    [chatRichTextEnabled],
  );

  // ⛶ 入口的可用性判据（照 onOpenSessionDetail 先例，回调只在 scope 就绪时注入）：
  // 未就绪时不注入，走既有的「回调缺失即 disabled」通路，而不是让用户点一个静默
  // return 的死按钮（fullscreen/B-1）。本组件的 scope 由调用方判过非空，故恒可用。
  const onOpenComposerFullscreen = props.onOpenComposerFullscreen;

  const composerRef = useRef<NativeChatComposerInstance | null>(null);

  /**
   * M7 命令式通道的原生落点：controller 的整段写入（Picker 插入 / 草稿水化 /
   * 发送清空）经 ref.setText 进框。ref 为 null（composer 未挂载）时静默忽略，
   * 挂载后由 value effect 兜底补写，写入不丢。
   *
   * **三参必须逐字透传（D4 / R2 P0-2）**：TypeScript 允许少参函数赋多参类型，
   * 这里漏写第三参编译不报错、运行期被静默丢弃，等于水化直写通道没接上——
   * 面板集成测试（T-CA6）锁的就是这条真实下发路径。
   */
  const setComposerText = useCallback(
    (text: string, cursor?: number, ranges?: readonly TokenRange[]) => {
      composerRef.current?.setText(text, cursor, ranges);
    },
    [],
  );

  /**
   * composer controller（dock 域一切真源，spec 变更点 #6）：草稿链 /
   * Picker 状态机 / 发送决策照旧运转，产出的 composerState 不再经桥下发——
   * **数据来源在 Step 5 换向**：打字/选区来自 `NativeChatComposer` 组件事件直连，
   * 命令式写入（Picker 插入 / 水化 / 清空）经 `setComposerText` 落到 composer 的
   * `ref.setText`（M7 通道，见下方接线）。
   */
  const composer = useChatComposerController({
    scope: {projectId, sessionId},
    hasModel: hasWorkspaceModel || (agentMeta?.hasDedicatedModel ?? false),
    running: unitActive,
    onMessagesChanged,
    onNeedModel,
    canResumeWithoutInput,
    lastMessageIsPlainUserText,
    draftRestoreToken,
    onOpenComposerFullscreen,
    setComposerText,
  });

  /**
   * 主题 9 键：与转录文档同源同值（同一份 tokens 经同一映射），面板不各算一套。
   */
  const {tokens: themeTokens} = useTheme();
  const composerTheme = useMemo(
    () => conversationThemeFromTokens(themeTokens),
    [themeTokens],
  );

  /**
   * chip 文案表（I 组）：core `formatStatusChipLabelFromAttachment` 单一真源，
   * 与 web dock 的 resolveChipLabels 同口径；chips 引用稳定时文案引用随稳。
   */
  const chipLabels = useMemo(
    () =>
      composer.composerState.chips.map(formatStatusChipLabelFromAttachment),
    [composer.composerState.chips],
  );

  return (
    <>
      <ChatConversationWebView
        ref={transcriptWebRef}
        // 切会话经 key 重挂：销毁重建整个 WebView，文档内状态（转录滚动、
        // 会话工作区游标等）天然归零，不必在宿主侧手动清场。SPA 化期间这段
        // key 与配套的 sessionKey 清场链一并被拆（改为文档内切视图），
        // 本轮回滚恢复。
        key={chatScrollKey ?? 'no-session-scroll'}
        sessionKey={chatScrollKey ?? 'no-session'}
        messages={chatMessages}
        hasMore={hasMoreMessages}
        agentRunning={unitActive}
        uiRunning={unitActive}
        toolInvoking={unitActive}
        flags={transcriptFlags}
        menuCloseSignal={webMenuCloseSignal}
        mermaidViewerCloseSignal={mermaidViewerCloseSignal}
        initialScroll={restoredTranscriptScroll ?? null}
        defaultScrollToBottom={defaultChatScrollToBottom}
        onScrollSnapshot={onChatScrollSnapshot}
        onLoadOlder={onLoadOlderMessages}
        onReady={ctx.onTranscriptWebviewReady}
        onOpenToolFile={ctx.scope.openSessionFilePreview}
        onLinkClick={ctx.scope.openChatLink}
        onOpenSubagentSession={ctx.scope.openSubagentSession}
        onOpenSkillDetail={ctx.scope.openSkillDetail}
        onOpenToolResult={ctx.scope.openToolResult}
        pendingSubagentSessions={pendingSubagentSessions}
        onWebMenuOpenChange={controller.onWebMenuOpenChange}
        onWebMermaidViewerOpenChange={ctx.setMermaidViewerOpen}
        onMessageMenuAction={controller.onWebMessageMenuAction}
        onSnapshotComplete={controller.notifySnapshotComplete}
      />
      {/*
        原生输入 dock（composer-native-2026-10 Step 5，spec 变更点 #14）：
        与转录 webview 平级的 RN 兄弟节点，flex 布局天然实现「输入框长高 →
        转录区当帧收缩」；键盘 padding / dock 结构内置在组件里（D7/D8）。
        恢复链并行：本组件挂载即拉起 controller 草稿水化 → ref.setText，
        不等转录 webview 的 ready 握手（D8，两链零依赖）。
      */}
      <NativeChatComposer
        ref={composerRef}
        testID="chat-native-composer-input"
        value={composer.text}
        tokenRanges={composer.tokenRanges}
        hasModel={composer.composerState.hasModel}
        disabled={composer.composerState.inputDisabled}
        theme={composerTheme}
        running={unitActive}
        canSend={!composer.composerState.sendDisabled}
        error={composer.composerState.error}
        chipLabels={chipLabels}
        uiRunning={unitActive}
        inputDisabled={composer.composerState.inputDisabled}
        keyboardUp={composer.composerState.keyboardUp}
        safeAreaBottom={composer.safeAreaBottom}
        fullscreenEnabled={composer.composerState.fullscreenEnabled}
        onComposerChangeText={composer.onChangeText}
        onComposerSelectionChange={composer.onSelectionChange}
        onDockAction={composer.handleDockAction}
      />
      {/* 两个选择器仍是 RN 全屏 Modal：确认后经 controller 的 M7 通道回填正文。 */}
      <FileReferencePicker
        visible={composer.pickerOpen}
        projectId={projectId}
        sessionId={sessionId}
        onClose={composer.closeAtPicker}
        onConfirm={composer.onAtPickerConfirm}
      />
      <SkillPicker
        visible={composer.skillPickerOpen}
        projectId={projectId}
        onClose={composer.closeSkillPicker}
        onConfirm={composer.onSkillPickerConfirm}
      />
    </>
  );
}

/**
 * Android：裁切抬升由 AndroidKeyboardClipBody 统一持有（screens/C-2），这里只负责
 * 把 header 放在裁切窗口外、对话面放进去；iOS 分支结构一致、不套裁切容器。
 */
export function ChatConversationPanel({
  tokens,
  visible,
  onOpenComposerFullscreen,
}: ChatConversationPanelProps) {
  const ctx = useChatTabContext();
  const controller = useChatTabController();
  const setWorkspaceBackState = useChatTabWorkspaceBackState();
  const {showToast} = useToast();
  const {
    conversationPanel,
    setConversationPanel,
    projectId,
    sessionId,
    agentMeta,
    unitView,
    sessionVfs,
    sessionWorktree,
    sessionDrawerOpen,
    setSessionDrawerOpen,
    modelPickerOpen,
    setModelPickerOpen,
    agentPickerOpen,
    setAgentPickerOpen,
    messageEditPrompt,
    setMessageEditPrompt,
    vfsRefreshKey,
    bumpWorktreeUiToken,
    onOpenFileEditor,
    onRefreshChatMeta,
    workspaceVfsRef,
  } = ctx;

  // 当前会话 run 是否活跃（单元投影派生：starting|running）。
  const unitActive =
    unitView?.status === 'starting' || unitView?.status === 'running';

  const sessionVfsScope = useMemo((): VfsScope | null => {
    if (projectId == null || sessionId == null) {
      return null;
    }
    return {kind: 'session', projectId, sessionId};
  }, [projectId, sessionId]);

  const emitWorkspaceBackState = useCallback(() => {
    if (setWorkspaceBackState == null) {
      return;
    }
    if (conversationPanel !== 'workspace') {
      setWorkspaceBackState(null);
      return;
    }
    const handle = workspaceVfsRef?.current;
    if (handle == null) {
      setWorkspaceBackState(null);
      return;
    }
    setWorkspaceBackState({
      canGoUp: handle.canGoUp(),
      goUp: () => handle.goUp(),
    });
  }, [conversationPanel, setWorkspaceBackState, workspaceVfsRef]);

  useEffect(() => {
    emitWorkspaceBackState();
  }, [emitWorkspaceBackState, vfsRefreshKey]);

  useEffect(() => {
    if (conversationPanel === 'workspace') {
      void workspaceVfsRef?.current?.reload();
    }
  }, [conversationPanel, workspaceVfsRef]);

  // 顶部 meta 条点 agent / model 名 → 判锁定后开对应 picker，判据统一走 helper，
  // 不再各处手写 source/modelSource/hasDedicatedModel 的组合。
  // agent 卡：meta 未加载时锁（防误触）；none 态（智能体已删）放开为待重选，
  // 点击直接弹 picker 重选（meta 条已带已删标识，不再额外弹 toast）。
  // model 卡：none / agent-pin 态维持锁定。
  const openAgentPicker = useCallback(() => {
    if (isAgentLocked(agentMeta)) {
      showToast(AGENT_LOCK_TOAST_GUIDE);
      return;
    }
    setAgentPickerOpen(true);
  }, [agentMeta, showToast, setAgentPickerOpen]);

  const openModelPicker = useCallback(() => {
    if (isModelLocked(agentMeta)) {
      showToast(MODEL_LOCK_TOAST);
      return;
    }
    setModelPickerOpen(true);
  }, [agentMeta, showToast, setModelPickerOpen]);

  // 「工作区面板盖住对话面」是唯一收起对话面的场景。
  const workspaceActive = conversationPanel === 'workspace';
  const chatPanelHidden = conversationPanel !== 'chat';
  const chatPanelStyle = [
    styles.chatPanel,
    chatPanelHidden && styles.panelHidden,
  ];
  const chatPointerEvents = chatPanelHidden
    ? ('none' as const)
    : ('auto' as const);
  const chatHeader =
    projectId != null && sessionId != null ? (
      <>
        <ChatMetaBar
          meta={agentMeta}
          onPressAgent={openAgentPicker}
          onPressModel={openModelPicker}
        />
        <ChatStreamMetricsBarLive
          agentRunning={unitActive}
          sessionId={sessionId}
          // 「上下文占用」行与顶部 chip 同源（agentMeta.tokenLabel 现成字符串）。
          contextTokenLabel={
            agentMeta?.tokenLabel ? agentMeta.tokenLabel : undefined
          }
        />
      </>
    ) : null;

  /** WebView 容器是否渲染：scope 就绪才挂，否则落「请先选择会话」占位。 */
  const surfaceReady = projectId != null && sessionId != null;
  const chatBody = surfaceReady ? (
    // 转录 webview（flex:1 吃满余高）+ 原生 dock（自然高度贴底）：输入框长高
    // 挤压转录区，flex 布局当帧生效，无跨桥 heightChange。
    <ChatConversationWebSurface
      projectId={projectId!}
      sessionId={sessionId!}
      onOpenComposerFullscreen={onOpenComposerFullscreen}
    />
  ) : null;

  return (
    <View
      style={[styles.subviewFill, !visible && styles.panelHidden]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <SegmentedControl
        tokens={tokens}
        value={conversationPanel}
        onChange={setConversationPanel}
        options={[
          {value: 'chat', label: '聊天', testID: 'tab-chat'},
          {value: 'workspace', label: '聊天工作区', testID: 'tab-workspace'},
        ]}
      />
      {surfaceReady ? (
        <>
          {Platform.OS === 'android' ? (
            <View style={chatPanelStyle} pointerEvents={chatPointerEvents}>
              {chatHeader}
              <AndroidKeyboardClipBody>
                <View style={styles.transcriptHost}>{chatBody}</View>
              </AndroidKeyboardClipBody>
            </View>
          ) : (
            <View style={chatPanelStyle} pointerEvents={chatPointerEvents}>
              {chatHeader}
              <View style={styles.transcriptHost}>{chatBody}</View>
            </View>
          )}
          {/* 工作区只在「确有选中会话」时存在（`surfaceReady` 已保证两者皆非空，
              这里显式带上 `sessionId != null` 一并收窄类型）。 */}
          {sessionVfs && sessionWorktree && sessionId != null ? (
            <View
              style={[
                styles.flexFill,
                !workspaceActive && styles.panelHidden,
              ]}
              pointerEvents={workspaceActive ? 'auto' : 'none'}
            >
              <VfsFileManager
                ref={workspaceVfsRef}
                // key 必须含 sessionId：SPA 化后外层不再随会话重挂，而浏览位置等
                // 面板状态属会话——key 丢掉 sessionId 会跨会话残留 currentPath，
                // 切会话以新 VFS list 旧目录 → 误弹「文件不存在或已被删除」
                // （10-02 修复曾因未合入 main 丢失，v1.5.30~33 连续带病，勿再冲掉）。
                key={`session-vfs-${sessionId}-${vfsRefreshKey}`}
                scope={sessionVfsScope!}
                vfs={sessionVfs}
                workplace={sessionWorktree}
                rootPath="/"
                pullFromParent={{
                  scope: {kind: 'session', sessionId},
                  onPulled: bumpWorktreeUiToken,
                }}
                pushToParent={{
                  scope: {kind: 'session', sessionId},
                  onPushed: bumpWorktreeUiToken,
                }}
                onOpenFile={path => onOpenFileEditor(path, 'session')}
                onDirectoryChange={emitWorkspaceBackState}
              />
            </View>
          ) : workspaceActive ? (
            <View style={styles.placeholder}>
              <Text style={{color: tokens.textSecondary}}>
                聊天工作区不可用
              </Text>
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.placeholder}>
          <Text style={{color: tokens.textSecondary}}>请先选择会话</Text>
        </View>
      )}
      <BottomSheetMenu
        visible={sessionDrawerOpen}
        title="会话操作"
        items={[
          {
            label: '查看提示词',
            action: 'real-prompt',
            disabled: controller.onNavigateRealPrompt == null,
          },
          {label: '压缩上下文', action: 'compact'},
          {label: '切换大模型', action: 'switch-model'},
          {label: '切换智能体', action: 'switch-agent'},
        ]}
        onClose={() => setSessionDrawerOpen(false)}
        onSelect={action => {
          if (action === 'real-prompt') {
            controller.onNavigateRealPrompt?.();
          } else if (action === 'compact') {
            controller.handleCompactSession();
          } else if (action === 'switch-model') {
            setModelPickerOpen(true);
          } else if (action === 'switch-agent') {
            setAgentPickerOpen(true);
          }
        }}
      />
      <MessageEditModal
        visible={messageEditPrompt != null}
        title="编辑消息"
        label="内容"
        placeholder="输入消息内容"
        initialValue={messageEditPrompt?.initialText ?? ''}
        confirmLabel="保存"
        onClose={() => setMessageEditPrompt(undefined)}
        onConfirm={async value => {
          const prompt = messageEditPrompt;
          setMessageEditPrompt(undefined);
          if (prompt) {
            await controller.handleSaveMessageEdit(prompt.messageId, value);
          }
        }}
      />
      <ModelPickerModal
        sessionId={sessionId}
        visible={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        onSelected={onRefreshChatMeta}
      />
      <AgentPickerModal
        sessionId={sessionId}
        visible={agentPickerOpen}
        onClose={() => setAgentPickerOpen(false)}
        onSelected={onRefreshChatMeta}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  subviewFill: {flex: 1, minHeight: 0},
  panelHidden: {display: 'none'},
  chatPanel: {flex: 1, backgroundColor: 'transparent'},
  /**
   * 对话面容器：`flex: 1, minHeight: 0` 给对话面一个确定高度；其内转录 webview
   * 自身的 `styles.fill` 吃满余高，原生 dock 以自然高度贴底（composer-native
   * Step 5 起两层都是 RN 兄弟节点，布局当帧生效）。
   */
  transcriptHost: {flex: 1, minHeight: 0},
  flexFill: {flex: 1},
  placeholder: {flex: 1, justifyContent: 'center', alignItems: 'center'},
});
