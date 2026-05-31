/**
 * Full-screen real prompt preview for current session scope.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useMobileScope} from '../../hooks/useMobileScope';
import {useRuntime} from '../../hooks/useRuntime';
import {buildRealPromptPreview} from '../../services/prompt-preview.service';
import {AgentRunError} from '../../services/agent-run.service';
import {useTheme} from '../../theme/ThemeProvider';

export function RealPromptScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const {projectId, sessionId} = useMobileScope();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (projectId == null || sessionId == null) {
      setError('请先选择项目与会话');
      setText('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const preview = await buildRealPromptPreview(runtime, {
        projectId,
        sessionId,
      });
      setText(preview || '（空提示词）');
    } catch (err) {
      const message =
        err instanceof AgentRunError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setError(message);
      setText('');
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
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <Text
            style={[styles.mono, {color: tokens.text}]}
            selectable>
            {text}
          </Text>
          <Text style={[styles.hint, {color: tokens.textSecondary}]}>
            在会话工作区调整纳入规则可改变预览内容。
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  loader: {marginTop: 32},
  error: {padding: 16, fontSize: 14},
  scroll: {flex: 1},
  content: {padding: 16, paddingBottom: 32},
  mono: {fontFamily: 'monospace', fontSize: 12, lineHeight: 18},
  hint: {marginTop: 16, fontSize: 13},
});
