/**
 * 子代理会话只读浏览页（mobile）。
 *
 * 主会话里点击 `task` 工具卡片跳转到此页，展示子 agent 的完整消息历史。
 * 复用主会话的 {@link ChatTranscriptWebView}（WebView 引擎），与主会话共享
 * 富文本渲染、工具卡片展示、消息宽度、流式输出等所有视觉行为。
 *
 * Phase 2 重构后：消费 {@link useSessionStream} + {@link useSessionAbort} +
 * {@link useSessionBatch}（不接 composer），删除原本手搓的事件订阅/state 平行实现，
 * 与主会话共用同一套 stream/abort/batch 单元。
 *
 * 错过 RUN_STARTED 的 stale 守卫（P1-1）：子会话页可能晚于 run 启动打开，
 * 此时 mount 主动查 `abortRegistry.has(sessionId)`，若该 sessionId 已有
 * in-flight run 则合成一次 markRunStarted 初始化 uiRunning，避免后续 stream
 * delta 因 uiRunning=false 被全部丢弃。
 *
 * 只读：无 composer；但 agent 运行中时显示停止按钮（调 abortRegistry.abort）。
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {ChatMessage} from '@novel-master/core/chat';
import type {
  AgentRunFailedPayload,
  AgentRunFinishedPayload,
  AgentRunStartedPayload,
  AgentStepCommittedPayload,
} from '@novel-master/core/events';
import {ChatTranscriptWebView} from '../../components/chat/ChatTranscriptWebView';
import type {ChatTranscriptWebViewHandle} from '../../components/chat/ChatTranscriptWebView';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {useRuntime} from '../../hooks/useRuntime';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {readChatRichTextEnabled} from '../../storage/chat-rich-text-pref';
import {useTheme} from '../../theme/ThemeProvider';
import type {RootStackParamList} from '../../navigation/types';
import {useSessionAbort} from '@/screens/tabs/chat-tab/useSessionAbort';
import {useSessionBatch} from '@/screens/tabs/chat-tab/useSessionBatch';
import {useSessionStream} from '@/screens/tabs/chat-tab/useSessionStream';
import type {StreamWireChunk} from '@/services/stream-wire-queue';

type ScreenRoute = RouteProp<RootStackParamList, 'SubagentSessionView'>;

export function SubagentSessionScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const {appUi} = useNovelMaster();
  const navigation = useNavigation();
  const route = useRoute<ScreenRoute>();
  const {sessionId, projectId} = route.params;

  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [richTextEnabled, setRichTextEnabled] = useState(false);
  const transcriptWebRef = useRef<ChatTranscriptWebViewHandle>(null);
  const messagesCountRef = useRef(0);

  const reload = useCallback(async (): Promise<readonly ChatMessage[]> => {
    try {
      const list = await runtime.messages.listBySession(sessionId);
      setMessages(list);
      messagesCountRef.current = list.length;
      return list;
    } catch (error) {
      showToast(toastMessage('加载子会话失败', error));
      return [];
    }
  }, [runtime, sessionId, showToast]);

  // 初次加载
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await runtime.messages.listBySession(sessionId);
        if (!cancelled) {
          setMessages(list);
          messagesCountRef.current = list.length;
        }
      } catch (error) {
        if (!cancelled) {
          showToast(toastMessage('加载子会话失败', error));
        }
      } finally {
        if (!cancelled) {
          setInitialLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runtime, sessionId, showToast]);

  // 继承主会话的富文本偏好
  useEffect(() => {
    if (appUi == null) {
      return;
    }
    readChatRichTextEnabled(appUi)
      .then(setRichTextEnabled)
      .catch(() => undefined);
  }, [appUi]);

  // 装配 stream/abort/batch（与主会话同构，但不接 composer）。
  const onStreamResetRef = useRef<() => void>(() => undefined);
  const applySegmentsRef = useRef<(segments: readonly StreamWireChunk[]) => void>(
    () => undefined,
  );

  const abort = useSessionAbort({
    sessionId,
    abortRegistry: runtime.abortRegistry,
    onStreamResetRef,
  });

  const batch = useSessionBatch({
    applySegments: segments => applySegmentsRef.current(segments),
  });

  // 子会话只有一个 in-flight run，acceptRunEvent 放宽：任何非空 runId 都接受。
  const acceptRunEvent = useCallback(
    (runId: string | undefined) => runId != null && runId !== '',
    [],
  );

  // 子会话 run 回调：同步 uiRunning + 触发 reload（落库消息接管渲染）。
  const handleRunStarted = useCallback(
    (_payload: AgentRunStartedPayload) => {
      abort.markRunStarted();
      void reload().catch(() => undefined);
    },
    [abort, reload],
  );
  const handleRunFinished = useCallback(
    (_payload: AgentRunFinishedPayload) => {
      abort.markRunEnded();
      void reload().catch(() => undefined);
    },
    [abort, reload],
  );
  const handleRunFailed = useCallback(
    (_payload: AgentRunFailedPayload) => {
      abort.markRunEnded();
      void reload().catch(() => undefined);
    },
    [abort, reload],
  );
  const handleStepCommitted = useCallback(
    (_payload: AgentStepCommittedPayload) => {
      void reload().catch(() => undefined);
    },
    [reload],
  );

  const stream = useSessionStream({
    sessionId,
    useWebviewTranscript: true,
    batchEnabled: true,
    transcriptWebRef,
    uiRunning: abort.uiRunning,
    acceptRunEvent,
    onRunStarted: handleRunStarted,
    onRunFinished: handleRunFinished,
    onRunFailed: handleRunFailed,
    getUiRunning: abort.getUiRunning,
    getTranscriptFreezeCount: abort.getTranscriptFreezeCount,
    getAbortRetainPending: abort.getAbortRetainPending,
    clearAbortRetainPending: abort.clearAbortRetainPending,
    batchIngest: batch.ingestWireChunk,
    batchClear: batch.clearBuffers,
    onMessagesChanged: reload,
    getMessageCount: () => messagesCountRef.current,
    onStepCommitted: handleStepCommitted,
  });
  // 拆环：stream mount 后把 apply 叶子 / reset 写入两个占位 ref。
  applySegmentsRef.current = stream.applySegments;
  onStreamResetRef.current = stream.handleStreamReset;

  // P1-1 stale 守卫：子会话页晚于 run 启动打开时，主动查 registry 合成 markRunStarted，
  // 避免 uiRunning=false 导致后续 stream delta 被丢弃。
  useEffect(() => {
    if (sessionId == null) {
      return;
    }
    if (runtime.abortRegistry.has(sessionId)) {
      abort.markRunStarted();
      void reload().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 mount 时检查
  }, [sessionId]);

  const onOpenSubagentSession = useCallback(
    (childSessionId: string) => {
      navigation.navigate('SubagentSessionView', {
        projectId,
        sessionId: childSessionId,
      });
    },
    [navigation, projectId],
  );

  const sessionKey = useMemo(
    () => `${projectId}:${sessionId}`,
    [projectId, sessionId],
  );

  const flags = useMemo(
    () => ({richText: richTextEnabled}),
    [richTextEnabled],
  );

  const onStop = useCallback(() => {
    if (sessionId == null) {
      return;
    }
    // 与主会话停止按钮一致：经 abortRegistry.abort 触发 Core 层中断。
    // 不传 freezeAt——子会话只读，无需 freeze 列表（无 composer 续跑场景）。
    abort.abortUiRun();
  }, [abort, sessionId]);

  if (initialLoading) {
    return (
      <View style={[styles.root, {backgroundColor: tokens.background}]}>
        <View style={styles.center}>
          <Text style={{color: tokens.textSecondary}}>加载中…</Text>
        </View>
      </View>
    );
  }

  const agentRunning = abort.uiRunning;

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      {messages.length === 0 && !agentRunning ? (
        <View style={styles.center}>
          <Text style={{color: tokens.textSecondary}}>子会话暂无消息</Text>
        </View>
      ) : (
        <ChatTranscriptWebView
          ref={transcriptWebRef}
          sessionKey={sessionKey}
          messages={messages}
          streamingText={stream.streamingText}
          streamingThinking={stream.streamingThinking}
          flags={flags}
          agentRunning={agentRunning}
          defaultScrollToBottom={false}
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
