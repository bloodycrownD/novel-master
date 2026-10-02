/**
 * Full-screen real prompt preview: turns (轮) — template/user 轮渲染折叠段卡片，
 * assistant 轮渲染 PromptTurnCard（摘要 + 进详情）。
 *
 * 导航红线：顶层**只** import `useRoute`，`useNavigation` 留在 PromptTurnCard
 * 内部（既有 scope 用例对 @react-navigation/native 整模块 mock 只有 useRoute）。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {PromptPreviewTurn} from '@novel-master/core/prompt';
import {useRoute, type RouteProp} from '@react-navigation/native';
import {PromptPreviewSegmentCard} from '@/components/prompt/PromptPreviewSegmentCard';
import {PromptTurnCard} from '@/components/prompt/PromptTurnCard';
import {useMobileScope} from '@/hooks/useMobileScope';
import {useRuntime} from '@/hooks/useRuntime';
import {buildRealPromptPreviewSegments} from '@/services/prompt-preview.service';
import {AgentRunError} from '@/services/agent-run.service';
import {useTheme} from '@/theme/ThemeProvider';
import type {RootStackParamList} from '@/navigation/types';

export function RealPromptScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  // scope 优先取路由参数、缺省回落到全局 scope（AM-3）：
  // 只读 useMobileScope() 会在「后台通知栈外改 scope、栈顶却还停在别的会话详情页」
  // 时展示**别的会话**的提示词，而屏上不出现任何会话名、用户无从察觉。
  // 回落分支是防御性的：无参进栈的存量路径行为与修复前逐字一致。
  const route = useRoute<RouteProp<RootStackParamList, 'RealPrompt'>>();
  const params = route.params ?? {};
  const {
    projectId: scopeProjectId,
    sessionId: scopeSessionId,
  } = useMobileScope();
  const projectId = params.projectId ?? scopeProjectId;
  const sessionId = params.sessionId ?? scopeSessionId;
  const [turns, setTurns] = useState<readonly PromptPreviewTurn[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (projectId == null || sessionId == null) {
      setError('请先选择项目与会话');
      setTurns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const list = await buildRealPromptPreviewSegments(runtime, {
        projectId,
        sessionId,
      });
      setTurns(list);
    } catch (err) {
      const message =
        err instanceof AgentRunError
          ? err.message
          : err instanceof Error
          ? err.message
          : String(err);
      setError(message);
      setTurns([]);
    } finally {
      setLoading(false);
    }
  }, [runtime, projectId, sessionId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      {loading ? (
        <ActivityIndicator style={styles.loader} />
      ) : error ? (
        <Text style={[styles.error, {color: tokens.danger}]}>{error}</Text>
      ) : (
        <FlatList
          data={turns}
          keyExtractor={item => item.id}
          style={styles.list}
          contentContainerStyle={styles.content}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
          ListEmptyComponent={
            <Text style={{color: tokens.textSecondary}}>（空提示词）</Text>
          }
          ListFooterComponent={
            <Text style={[styles.hint, {color: tokens.textSecondary}]}>
              在聊天工作区调整纳入规则可改变预览内容。默认折叠以减轻长文本渲染压力。
            </Text>
          }
          renderItem={({item}) => <PromptTurnRow turn={item} />}
        />
      )}
    </View>
  );
}

/**
 * 一轮的渲染：assistant 轮走整轮卡片（点进详情读全文），
 * template/user 轮把该轮各段按序铺成现有折叠段卡片（user 轮可能多段）。
 */
function PromptTurnRow({turn}: {turn: PromptPreviewTurn}) {
  if (turn.kind === 'assistant') {
    return <PromptTurnCard turn={turn} />;
  }
  return (
    <React.Fragment key={turn.id}>
      {turn.items.map(segment => (
        <PromptPreviewSegmentCard key={segment.id} segment={segment} />
      ))}
    </React.Fragment>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  loader: {marginTop: 32},
  error: {padding: 16, fontSize: 14},
  list: {flex: 1},
  content: {padding: 16, paddingBottom: 32},
  hint: {marginTop: 8, fontSize: 13},
});
