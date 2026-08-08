/**
 * 子代理会话只读浏览页（mobile）。
 *
 * 主会话里点击 `task` 工具卡片跳转到此页，展示子 agent 的完整消息历史。
 * 复用主会话的 {@link ChatTranscriptWebView}（WebView 引擎），与主会话共享
 * 富文本渲染、工具卡片展示、消息宽度等所有视觉行为。
 *
 * 实时刷新：子 agent run 现在发 `publishRunLifecycle: true` 事件，
 * 本页订阅 `agent.step.committed`（按 sessionId 过滤）每步重新拉消息，
 * `agent.run.started/finished` 控制 loading 样式——和主会话体验一致。
 *
 * 只读：无 composer、无 streaming 输入。
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {ChatMessage} from '@novel-master/core/chat';
import {
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_STEP_COMMITTED,
  type AgentRunStartedPayload,
  type AgentRunFinishedPayload,
  type AgentRunFailedPayload,
  type AgentStepCommittedPayload,
} from '@novel-master/core/events';
import {ChatTranscriptWebView} from '../../components/chat/ChatTranscriptWebView';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {useRuntime} from '../../hooks/useRuntime';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {readChatRichTextEnabled} from '../../storage/chat-rich-text-pref';
import {useTheme} from '../../theme/ThemeProvider';
import type {RootStackParamList} from '../../navigation/types';

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
  const [agentRunning, setAgentRunning] = useState(false);
  const [richTextEnabled, setRichTextEnabled] = useState(false);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    try {
      const list = await runtime.messages.listBySession(sessionId);
      setMessages(list);
    } catch (error) {
      showToast(toastMessage('加载子会话失败', error));
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

  // 订阅子 agent run 事件：实时刷新消息 + loading 样式。
  // 子 agent run 现在 publishRunLifecycle=true，事件按 sessionId 过滤不会串到主会话。
  useEffect(() => {
    if (sessionId == null) {
      return undefined;
    }
    const sid = sessionId;
    const bus = runtime.eventBus;

    // 节流：step committed 可能连续触发，合并到一次 reload。
    const scheduleReload = () => {
      if (reloadTimerRef.current != null) {
        clearTimeout(reloadTimerRef.current);
      }
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;
        reload();
      }, 100);
    };

    const subStarted = bus.subscribe(
      EVENT_AGENT_RUN_STARTED,
      (payload: AgentRunStartedPayload) => {
        if (payload.sessionId !== sid) return;
        setAgentRunning(true);
        scheduleReload();
      },
    );
    const subStep = bus.subscribe(
      EVENT_AGENT_STEP_COMMITTED,
      (payload: AgentStepCommittedPayload) => {
        if (payload.sessionId !== sid) return;
        scheduleReload();
      },
    );
    const subFinished = bus.subscribe(
      EVENT_AGENT_RUN_FINISHED,
      (payload: AgentRunFinishedPayload) => {
        if (payload.sessionId !== sid) return;
        setAgentRunning(false);
        scheduleReload();
      },
    );
    const subFailed = bus.subscribe(
      EVENT_AGENT_RUN_FAILED,
      (payload: AgentRunFailedPayload) => {
        if (payload.sessionId !== sid) return;
        setAgentRunning(false);
        scheduleReload();
      },
    );
    return () => {
      subStarted.unsubscribe();
      subStep.unsubscribe();
      subFinished.unsubscribe();
      subFailed.unsubscribe();
      if (reloadTimerRef.current != null) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
    };
  }, [runtime.eventBus, sessionId, reload]);

  // 子会话里也可能有 task 工具（递归层级内），支持继续点击进入更深的子会话。
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

  if (initialLoading) {
    return (
      <View style={[styles.root, {backgroundColor: tokens.background}]}>
        <View style={styles.center}>
          <Text style={{color: tokens.textSecondary}}>加载中…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      {messages.length === 0 && !agentRunning ? (
        <View style={styles.center}>
          <Text style={{color: tokens.textSecondary}}>子会话暂无消息</Text>
        </View>
      ) : (
        <ChatTranscriptWebView
          sessionKey={sessionKey}
          messages={messages}
          flags={flags}
          agentRunning={agentRunning}
          defaultScrollToBottom={false}
          onOpenSubagentSession={onOpenSubagentSession}
        />
      )}
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
});
