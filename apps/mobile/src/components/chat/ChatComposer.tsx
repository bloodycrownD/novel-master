/**
 * Chat input: disabled without workspace model; send → user append + agent run.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import Svg, {Path, Rect} from 'react-native-svg';
import {
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  type AgentStreamTextDeltaPayload,
  type AgentStreamThinkingDeltaPayload,
} from '@novel-master/core';
import {useTheme} from '../../theme/ThemeProvider';
import {formatError} from '../../errors/format-error';
import {runAgentTurn, type AgentRunScope} from '../../services/agent-run.service';
import {useRuntime} from '../../hooks/useRuntime';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {readLlmStreamEnabled} from '../../storage/llm-stream-pref';
import {flushRunUi} from './flush-run-ui';

type Props = {
  scope: AgentRunScope;
  hasModel: boolean;
  running: boolean;
  onRunningChange: (running: boolean) => void;
  onStreamText: (delta: string) => void;
  onStreamThinking: (delta: string) => void;
  onStreamReset: () => void;
  onMessagesChanged: () => void | Promise<void>;
  onNeedModel: () => void;
  canResumeWithoutInput: boolean;
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
  canResumeWithoutInput,
}: Props) {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const {appUi} = useNovelMaster();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [runAbortController, setRunAbortController] = useState<AbortController | null>(
    null,
  );

  const streamHandlersRef = useRef({
    onStreamText,
    onStreamThinking,
    onMessagesChanged,
    onStreamReset,
  });
  streamHandlersRef.current = {
    onStreamText,
    onStreamThinking,
    onMessagesChanged,
    onStreamReset,
  };

  useEffect(() => {
    const bus = runtime.eventBus;
    const sid = scope.sessionId;
    const subText = bus.subscribe(
      EVENT_AGENT_STREAM_TEXT_DELTA,
      (payload: AgentStreamTextDeltaPayload) => {
        if (payload.sessionId === sid) {
          streamHandlersRef.current.onStreamText(payload.text);
        }
      },
    );
    const subThinking = bus.subscribe(
      EVENT_AGENT_STREAM_THINKING_DELTA,
      (payload: AgentStreamThinkingDeltaPayload) => {
        if (payload.sessionId === sid) {
          streamHandlersRef.current.onStreamThinking(payload.text);
        }
      },
    );
    const subFinished = bus.subscribe(EVENT_AGENT_RUN_FINISHED, payload => {
      if (payload.sessionId === sid) {
        const {onMessagesChanged: reload, onStreamReset: reset} =
          streamHandlersRef.current;
        flushRunUi(reload, reset).catch(() => undefined);
      }
    });
    return () => {
      subText.unsubscribe();
      subThinking.unsubscribe();
      subFinished.unsubscribe();
    };
  }, [runtime.eventBus, scope.sessionId]);

  const send = useCallback(async () => {
    if (!hasModel) {
      onNeedModel();
      return;
    }
    if (running) {
      runAbortController?.abort();
      // WHY: keep stream overlay until run teardown persists partial output + reload.
      setRunAbortController(null);
      onRunningChange(false);
      return;
    }
    const content = text.trim();
    const allowResumeWithoutInput = !content && canResumeWithoutInput;
    if (!content && !allowResumeWithoutInput) {
      return;
    }
    const controller = new AbortController();
    setError(undefined);
    onStreamReset();
    onRunningChange(true);
    if (content) {
      setText('');
    }
    setRunAbortController(controller);
    try {
      const stream =
        appUi != null ? await readLlmStreamEnabled(appUi) : true;
      await runAgentTurn(runtime, scope, content, {
        stream,
        allowResumeWithoutInput,
        signal: controller.signal,
        onUserMessageAppended: () => {
          void Promise.resolve(streamHandlersRef.current.onMessagesChanged()).catch(
            () => undefined,
          );
        },
      });
    } catch (err) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        const detail =
          err instanceof Error
            ? {
                name: err.name,
                message: err.message,
                stack: err.stack,
                cause: String((err as Error & {cause?: unknown}).cause ?? ''),
              }
            : {name: typeof err, message: String(err)};
        console.error('[novel-master/chat] run failed', detail);
      }
      setError(formatError(err));
      await flushRunUi(onMessagesChanged, onStreamReset);
    } finally {
      setRunAbortController(null);
      onRunningChange(false);
    }
  }, [
    hasModel,
    running,
    text,
    canResumeWithoutInput,
    runAbortController,
    runtime,
    scope,
    onNeedModel,
    onRunningChange,
    onStreamReset,
    onMessagesChanged,
    appUi,
  ]);

  // Input should remain editable whenever the user can type (model selected and not running).
  // Send button can be disabled separately when there is nothing to send/resume.
  const inputDisabled = !hasModel || running;
  const sendDisabled =
    !hasModel || (!running && !text.trim() && !canResumeWithoutInput);

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
          editable={!inputDisabled}
          multiline
        />
        <Pressable
          onPress={send}
          disabled={sendDisabled}
          style={[
            styles.sendBtn,
            {
              backgroundColor: sendDisabled
                ? tokens.border
                : running
                  ? tokens.danger
                  : tokens.primary,
            },
          ]}
          accessibilityLabel={running ? '终止' : '发送'}>
          {running ? <TerminateIcon /> : <SendIcon />}
        </Pressable>
      </View>
    </View>
  );
}

function SendIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path
        d="M22 2L11 13"
        stroke="#fff"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M22 2L15 22L11 13L2 9L22 2Z"
        stroke="#fff"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function TerminateIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Rect x={6} y={6} width={12} height={12} rx={2} fill="#fff" />
    </Svg>
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
});
