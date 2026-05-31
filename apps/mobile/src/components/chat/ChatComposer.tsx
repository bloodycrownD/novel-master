/**
 * Chat input: disabled without workspace model; send → user append + agent run.
 */
import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
import {formatError} from '../../errors/format-error';
import {runAgentTurn, type AgentRunScope} from '../../services/agent-run.service';
import {useRuntime} from '../../hooks/useRuntime';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {readLlmStreamEnabled} from '../../storage/llm-stream-pref';

type Props = {
  scope: AgentRunScope;
  hasModel: boolean;
  running: boolean;
  onRunningChange: (running: boolean) => void;
  onStreamText: (delta: string) => void;
  onStreamThinking: (delta: string) => void;
  onStreamReset: () => void;
  onMessagesChanged: () => void;
  onNeedModel: () => void;
};

export function ChatComposer({
  scope,
  hasModel,
  running,
  onRunningChange,
  onStreamText,
  onStreamThinking,
  onStreamReset,
  onMessagesChanged,
  onNeedModel,
}: Props) {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const {appUi} = useNovelMaster();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();

  const send = useCallback(async () => {
    if (!hasModel) {
      onNeedModel();
      return;
    }
    if (running) {
      return;
    }
    const content = text.trim();
    if (!content) {
      return;
    }
    setError(undefined);
    onStreamReset();
    onRunningChange(true);
    setText('');
    try {
      const stream =
        appUi != null ? await readLlmStreamEnabled(appUi) : true;
      await runAgentTurn(
        runtime,
        scope,
        content,
        stream
          ? {
              onStreamText,
              onStreamThinking,
            }
          : undefined,
        {stream},
      );
      onMessagesChanged();
    } catch (err) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[novel-master/chat]', err);
      }
      setError(formatError(err));
      onMessagesChanged();
    } finally {
      onRunningChange(false);
      onStreamReset();
    }
  }, [
    hasModel,
    running,
    text,
    runtime,
    scope,
    onNeedModel,
    onRunningChange,
    onStreamText,
    onStreamThinking,
    onStreamReset,
    onMessagesChanged,
    appUi,
  ]);

  const disabled = !hasModel || running;

  return (
    <View style={[styles.dock, {borderTopColor: tokens.border}]}>
      {!hasModel ? (
        <Pressable onPress={onNeedModel} style={styles.hintRow}>
          <Text style={{color: tokens.primary}}>请先选择工作区模型</Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text style={[styles.error, {color: tokens.danger}]}>{error}</Text>
      ) : null}
      <View style={styles.row}>
        <TextInput
          style={[
            styles.input,
            {
              color: tokens.text,
              backgroundColor: tokens.surface,
              borderColor: tokens.border,
            },
          ]}
          placeholder={hasModel ? '输入消息…' : '选择模型后可发送'}
          placeholderTextColor={tokens.textSecondary}
          value={text}
          onChangeText={setText}
          editable={!disabled}
          multiline
        />
        <Pressable
          onPress={send}
          disabled={disabled}
          style={[
            styles.sendBtn,
            {backgroundColor: disabled ? tokens.border : tokens.primary},
          ]}
          accessibilityLabel="发送">
          {running ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.sendLabel}>发送</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  hintRow: {paddingVertical: 4},
  error: {fontSize: 12},
  row: {flexDirection: 'row', alignItems: 'flex-end', gap: 8},
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
  },
  sendBtn: {
    minWidth: 56,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendLabel: {color: '#fff', fontWeight: '600'},
});
