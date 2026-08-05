/**
 * 子代理会话只读浏览页（mobile）。
 *
 * 主会话里点击 `task` 工具卡片跳转到此页，展示子 agent 的完整消息历史。
 * 与 {@link SessionDetailScreen} 同属栈页，但这里只读：无 composer、无 streaming、
 * 不传 agentRunning。子会话的消息历史通过 `runtime.messages.listBySession` 一次性加载。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useRoute, type RouteProp} from '@react-navigation/native';
import type {ChatMessage} from '@novel-master/core/chat';
import {MessageList} from '../../components/chat/MessageList';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';
import type {RootStackParamList} from '../../navigation/types';

type ScreenRoute = RouteProp<RootStackParamList, 'SubagentSessionView'>;

export function SubagentSessionScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const route = useRoute<ScreenRoute>();
  const {sessionId} = route.params;

  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 子会话只读浏览：一次性拉全量消息（子 agent run 通常消息量可控）。
      const list = await runtime.messages.listBySession(sessionId);
      setMessages(list);
    } catch (error) {
      showToast(toastMessage('加载子会话失败', error));
    } finally {
      setLoading(false);
    }
  }, [runtime, sessionId, showToast]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  if (loading) {
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
      {messages.length === 0 ? (
        <View style={styles.center}>
          <Text style={{color: tokens.textSecondary}}>子会话暂无消息</Text>
        </View>
      ) : (
        <MessageList messages={messages} defaultScrollToBottom={false} />
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
