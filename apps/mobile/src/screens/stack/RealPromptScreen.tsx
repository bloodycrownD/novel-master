/**
 * Full-screen real prompt preview: collapsible segment cards (default folded).
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  InteractionManager,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {PromptPreviewSegment} from '@novel-master/core/prompt';
import {PromptPreviewSegmentCard} from '../../components/prompt/PromptPreviewSegmentCard';
import {useMobileScope} from '../../hooks/useMobileScope';
import {useRuntime} from '../../hooks/useRuntime';
import {buildRealPromptPreviewSegments} from '../../services/prompt-preview.service';
import {AgentRunError} from '../../services/agent-run.service';
import {useTheme} from '../../theme/ThemeProvider';

export function RealPromptScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const {projectId, sessionId} = useMobileScope();
  const [segments, setSegments] = useState<readonly PromptPreviewSegment[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (projectId == null || sessionId == null) {
      setError('请先选择项目与会话');
      setSegments([]);
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
      setSegments(list);
    } catch (err) {
      const message =
        err instanceof AgentRunError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setError(message);
      setSegments([]);
    } finally {
      setLoading(false);
    }
  }, [runtime, projectId, sessionId]);

  // 导航动画期间不触发 prompt 组装（resolveAgentForProject → buildSessionPromptInput
  // 的同步段会占 JS 线程，把 native stack push 动画挤掉帧）。等交互结束再开始重活。
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      load().catch(() => undefined);
    });
    return () => handle.cancel();
  }, [load]);

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      {loading ? (
        <ActivityIndicator style={styles.loader} />
      ) : error ? (
        <Text style={[styles.error, {color: tokens.danger}]}>{error}</Text>
      ) : (
        <FlatList
          data={segments}
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
          renderItem={({item}) => <PromptPreviewSegmentCard segment={item} />}
        />
      )}
    </View>
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
