/**
 * 子代理会话只读浏览页（mobile）。
 *
 * 主会话里点击 `task` 工具卡片跳转到此页，展示子 agent 的完整消息历史。
 * 复用主会话的 {@link ChatTranscriptWebView}（WebView 引擎），与主会话共享
 * 富文本渲染、工具卡片展示、消息宽度、流式输出等所有视觉行为。
 *
 * Step 6 起删除第二套装配（原 useSessionStream + useSessionAbort +
 * useSessionBatch + useRunResumeProbe + 内联注入），改为订阅同一
 * SessionStreamUnitManager：子会话 run 的事件由 manager 的消费型单元落点
 * 承接（RUN_STARTED 到达时 lazy 建立），本页只做——
 * - 订阅子会话的单元投影（运行态视图：流式/停止按钮/中断现场）；
 * - 把自己的 webview 句柄 attach 进 manager（单元的单一注入实现自动补齐
 *   重进 partial——与本页旧的内联注入版语义一致，实现只剩单元一份）；
 * - 消息面：有单元走投影，无单元（run 已结束且单元出表）本地回源。
 *
 * 只读：无 composer；agent 运行中时显示停止按钮（经 manager.stopRun 走
 * abortRegistry 的 abort 语义）。
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type {ChatMessage} from '@novel-master/core/chat';
import {ChatTranscriptWebView} from '../../components/chat/ChatTranscriptWebView';
import {showAppToast} from '@/services/app-toast';
import {chatLinkNotFoundMessage} from '@novel-master/core/chat';
import type {ChatTranscriptWebViewHandle} from '../../components/chat/ChatTranscriptWebView';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {useRuntime} from '../../hooks/useRuntime';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {readChatRichTextEnabled} from '../../storage/chat-rich-text-pref';
import {resolveChatLinkIntent} from '@/screens/tabs/chat-tab/chat-link-nav';
import {useInterruptedPartialCommit} from '@/screens/tabs/chat-tab/useInterruptedPartialCommit';
import {useTheme} from '../../theme/ThemeProvider';
import type {RootStackParamList} from '../../navigation/types';
import type {SessionStreamUnitView} from '@/services/session-stream-unit';
import {createTranscriptStreamHandle} from '@/services/session-stream-webview-adapter';

type ScreenRoute = RouteProp<RootStackParamList, 'SubagentSessionView'>;

/** 子会话 webview 句柄在单元注册表里的稳定标识（attach/detach 对账用）。 */
const SUBAGENT_TRANSCRIPT_HANDLE_ID = 'subagent-transcript';

export function SubagentSessionScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const {appUi} = useNovelMaster();
  const navigation = useNavigation();
  const route = useRoute<ScreenRoute>();
  const {sessionId, projectId, parentSessionId} = route.params;
  const manager = runtime.sessionStreamUnitManager;

  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [richTextEnabled, setRichTextEnabled] = useState(false);
  const transcriptWebRef = useRef<ChatTranscriptWebViewHandle>(null);

  // ===== 单元投影订阅（与 ChatTabProvider 同构：subscribe + sync） =====
  const [unitView, setUnitView] = useState<SessionStreamUnitView | null>(() =>
    sessionId != null ? manager.snapshot(sessionId) : null,
  );
  useEffect(() => {
    const sync = () =>
      setUnitView(sessionId != null ? manager.snapshot(sessionId) : null);
    sync();
    return manager.subscribe(sync);
  }, [manager, sessionId]);

  // 消息面：有单元（消费型/interrupted/宽限中的 settled）走单元管线水合，
  // 无单元本地回源（run 早已结束且单元出表的兜底）。
  const hasUnit = unitView != null;
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<readonly ChatMessage[]> => {
      if (sessionId == null) {
        return [];
      }
      if (manager.snapshot(sessionId) != null) {
        try {
          return (await manager.loadSessionTailMessages(sessionId)) ?? [];
        } catch (error) {
          showToast(toastMessage('加载子会话失败', error));
          return [];
        }
      }
      try {
        return await runtime.messages.listBySession(sessionId);
      } catch (error) {
        showToast(toastMessage('加载子会话失败', error));
        return [];
      }
    };
    void load()
      .then(list => {
        if (!cancelled) {
          setMessages(list);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setInitialLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/会话变化时水合一次；后续刷新由投影自驱
  }, [sessionId, hasUnit]);

  // 继承主会话的富文本偏好
  useEffect(() => {
    if (appUi == null) {
      return;
    }
    readChatRichTextEnabled(appUi)
      .then(setRichTextEnabled)
      .catch(() => undefined);
  }, [appUi]);

  // ===== webview 句柄 attach（ready 后挂进单元——注入/流式推送的落点） =====
  const [webviewReadyEpoch, setWebviewReadyEpoch] = useState(0);
  const onWebviewReady = useCallback(() => {
    setWebviewReadyEpoch(epoch => epoch + 1);
  }, []);

  useEffect(() => {
    if (sessionId == null || webviewReadyEpoch === 0) {
      return;
    }
    const web = transcriptWebRef.current;
    if (web == null) {
      return;
    }
    const sid = sessionId;
    // 单元载荷/控制消息 → webview handle 适配（与主屏同一份哑引擎契约，
    // 映射细节见 services/session-stream-webview-adapter）。
    const handle = createTranscriptStreamHandle(
      SUBAGENT_TRANSCRIPT_HANDLE_ID,
      web,
    );
    manager.attachWebview(sid, handle);
    return () => {
      manager.detachWebview(sid, handle.handleId);
    };
  }, [manager, sessionId, webviewReadyEpoch, hasUnit]);

  // 中断现场渲染（Step 6，语义说明见 hook 模块头）：与主屏
  // ChatConversationPanel 共用同一份 effect（ui/C-1 抽取）；本屏的
  // webviewReadyEpoch 直接入参，ready 世代驱动修 ui/B-1 的
  // 「tail 先于 webview ready 到达」时序。
  useInterruptedPartialCommit({
    unitView,
    webRef: transcriptWebRef,
    readyEpoch: webviewReadyEpoch,
  });

  // 嵌套子会话（孙会话）也共享同一个根父工作区，因此透传同一个 parentSessionId，
  // 而不是当前子会话的 id。
  const onOpenSubagentSession = useCallback(
    (childSessionId: string) => {
      navigation.navigate('SubagentSessionView', {
        projectId,
        sessionId: childSessionId,
        parentSessionId,
      });
    },
    [navigation, projectId, parentSessionId],
  );

  // 文件引入卡片点击：导航到文件编辑器。文件在共享的父会话工作区，
  // 所以 session scope 用 parentSessionId（而非当前子会话 id），
  // 否则 FileEditor 按子 session VFS 查不到文件会报「文件不存在或已删除」。
  const onOpenToolFile = useCallback(
    (path: string) => {
      navigation.navigate('FileEditor', {
        path,
        scopeKind: 'session',
        projectId,
        sessionId: parentSessionId,
      });
    },
    [navigation, projectId, parentSessionId],
  );

  // markdown 链接点击：识别与探测在 chat-link-nav 纯函数完成，这里只执行意图。
  // 子会话共享父会话工作区，故 session 探测/打开均用 parentSessionId（与
  // onOpenToolFile 同口径）；http(s) 外跳，失败静默兜底。
  const onLinkClick = useCallback(
    (href: string) => {
      const sessionVfs = runtime.sessionVfs(projectId, parentSessionId);
      const projectVfs = runtime.projectVfs(projectId);
      void resolveChatLinkIntent(href, {sessionVfs, projectVfs}).then(
        intent => {
          if (intent.kind === 'external') {
            void Linking.openURL(intent.url).catch(() => undefined);
            return;
          }
          if (intent.kind === 'not-found') {
            // 路径型链接双域探测未命中：用户拍板弹提示，不再静默无动作
            showAppToast(chatLinkNotFoundMessage(intent.path));
            return;
          }
          if (intent.kind === 'file') {
            if (intent.scope === 'session') {
              navigation.navigate('FileEditor', {
                path: intent.path,
                scopeKind: 'session',
                projectId,
                sessionId: parentSessionId,
              });
            } else {
              navigation.navigate('FileEditor', {
                path: intent.path,
                scopeKind: 'project',
                projectId,
              });
            }
          }
        },
      );
    },
    [runtime, navigation, projectId, parentSessionId],
  );

  const sessionKey = useMemo(
    () => `${projectId}:${sessionId}`,
    [projectId, sessionId],
  );

  const flags = useMemo(() => ({richText: richTextEnabled}), [richTextEnabled]);

  const onStop = useCallback(() => {
    if (sessionId == null) {
      return;
    }
    // 与主会话停止入口一致：经 manager.stopRun → abortRegistry.abort 触发
    // core 层中断；后续 FINISHED 照常走事件路径收尾（投影回落、按钮消失）。
    manager.stopRun(sessionId);
  }, [manager, sessionId]);

  if (initialLoading) {
    return (
      <View style={[styles.root, {backgroundColor: tokens.background}]}>
        <View style={styles.center}>
          <Text style={{color: tokens.textSecondary}}>加载中…</Text>
        </View>
      </View>
    );
  }

  const agentRunning =
    unitView?.status === 'starting' || unitView?.status === 'running';
  const displayMessages = unitView?.messages ?? messages;

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      {unitView?.status === 'interrupted' ? (
        // 中断现场的正面标识（Step 7，与主屏指标条同语义）：轻量文本行，
        // 复用既有视觉 token，不动 webview 协议。
        <View style={[styles.interruptedBanner, {borderColor: tokens.danger}]}>
          <Text style={[styles.interruptedText, {color: tokens.danger}]}>
            已中断
          </Text>
        </View>
      ) : null}
      {displayMessages.length === 0 && !agentRunning ? (
        <View style={styles.center}>
          <Text style={{color: tokens.textSecondary}}>子会话暂无消息</Text>
        </View>
      ) : (
        <ChatTranscriptWebView
          ref={transcriptWebRef}
          sessionKey={sessionKey}
          messages={displayMessages}
          flags={flags}
          agentRunning={agentRunning}
          uiRunning={agentRunning}
          defaultScrollToBottom={false}
          onReady={onWebviewReady}
          onOpenToolFile={onOpenToolFile}
          onLinkClick={onLinkClick}
          onOpenSubagentSession={onOpenSubagentSession}
        />
      )}
      {agentRunning ? (
        <Pressable
          onPress={onStop}
          accessibilityLabel="停止子会话"
          style={[
            styles.stopBtn,
            {backgroundColor: tokens.danger, borderColor: tokens.border},
          ]}
        >
          <Text style={styles.stopBtnText}>停止</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  interruptedBanner: {
    alignSelf: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  interruptedText: {
    fontSize: 12,
    fontWeight: '600',
  },
  stopBtn: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    elevation: 4,
  },
  stopBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
