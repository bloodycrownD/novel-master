/**
 * Chat input: disabled without workspace model; send → user append + agent run.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Alert, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import Svg, {Path, Rect} from 'react-native-svg';
import { TOOL_TURN_BRIDGE_TEXT } from "@novel-master/core/chat";

import { EVENT_AGENT_RUN_FINISHED, EVENT_AGENT_STEP_COMMITTED, EVENT_AGENT_STREAM_TEXT_DELTA, EVENT_AGENT_STREAM_THINKING_DELTA, type AgentRunFinishedPayload, type AgentStepCommittedPayload, type AgentStreamTextDeltaPayload, type AgentStreamThinkingDeltaPayload } from "@novel-master/core/events";
import {useTheme} from '../../theme/ThemeProvider';
import {formatError} from '../../errors/format-error';
import {runAgentTurn, type AgentRunScope} from '../../services/agent-run.service';
import {useRuntime} from '../../hooks/useRuntime';
import {
  readChatComposerDraft,
  writeChatComposerDraft,
} from '../../storage/chat-composer-draft';
import {flushAgentStepUi, flushRunUi} from './flush-run-ui';

type Props = {
  scope: AgentRunScope;
  hasModel: boolean;
  running: boolean;
  onRunningChange: (running: boolean) => void;
  onStreamText: (delta: string) => void;
  onStreamThinking: (delta: string) => void;
  onStreamReset: () => void;
  onMessagesChanged: () => void | Promise<void>;
  onStepCommitted?: (payload: AgentStepCommittedPayload) => void;
  onRunFinished?: (payload: AgentRunFinishedPayload) => void;
  onNeedModel: () => void;
  /** 末条为 user 时可空发续跑。 */
  canResumeWithoutInput: boolean;
  /** 末条 user 含 tool_result。 */
  lastMessageHasToolResult: boolean;
  /** 末条为 plain user 文本时禁用输入。 */
  lastMessageIsPlainUserText: boolean;
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
  onStepCommitted,
  onRunFinished,
  onNeedModel,
  canResumeWithoutInput,
  lastMessageHasToolResult,
  lastMessageIsPlainUserText,
}: Props) {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const {sessionId} = scope;
  const [text, setText] = useState(() => readChatComposerDraft(sessionId));
  const [error, setError] = useState<string | undefined>();
  const [runAbortController, setRunAbortController] = useState<AbortController | null>(
    null,
  );

  const streamHandlersRef = useRef({
    onStreamText,
    onStreamThinking,
    onMessagesChanged,
    onStreamReset,
    onStepCommitted,
    onRunFinished,
  });
  streamHandlersRef.current = {
    onStreamText,
    onStreamThinking,
    onMessagesChanged,
    onStreamReset,
    onStepCommitted,
    onRunFinished,
  };

  useEffect(() => {
    setText(readChatComposerDraft(sessionId));
  }, [sessionId]);

  useEffect(() => {
    const bus = runtime.eventBus;
    const sid = sessionId;
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
    const subStep = bus.subscribe(
      EVENT_AGENT_STEP_COMMITTED,
      (payload: AgentStepCommittedPayload) => {
        if (payload.sessionId === sid) {
          const {
            onMessagesChanged: reload,
            onStreamReset: reset,
            onStepCommitted: onCommitted,
          } = streamHandlersRef.current;
          flushAgentStepUi(payload.phase, reload, reset)
            .then(() => onCommitted?.(payload))
            .catch(() => undefined);
        }
      },
    );
    const subFinished = bus.subscribe(
      EVENT_AGENT_RUN_FINISHED,
      (payload: AgentRunFinishedPayload) => {
        if (payload.sessionId === sid) {
          const {
            onMessagesChanged: reload,
            onStreamReset: reset,
            onRunFinished: onFinished,
          } = streamHandlersRef.current;
          flushRunUi(reload, reset)
            .then(() => onFinished?.(payload))
            .catch(() => undefined);
        }
      },
    );
    return () => {
      subText.unsubscribe();
      subThinking.unsubscribe();
      subStep.unsubscribe();
      subFinished.unsubscribe();
    };
  }, [runtime.eventBus, scope.sessionId]);

  const executeRun = useCallback(
    async (content: string, allowResumeWithoutInput: boolean) => {
      const controller = new AbortController();
      setError(undefined);
      onStreamReset();
      onRunningChange(true);
      if (content) {
        writeChatComposerDraft(sessionId, '');
        setText('');
      }
      setRunAbortController(controller);
      try {
        const stream = await runtime.preferences.getLlmStreamEnabled();
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
    },
    [
      runtime,
      scope,
      sessionId,
      onRunningChange,
      onStreamReset,
      onMessagesChanged,
    ],
  );

  const sendWithBridgeIfNeeded = useCallback(
    async (content: string, allowResumeWithoutInput: boolean) => {
      if (content && lastMessageHasToolResult) {
        return new Promise<void>(resolve => {
          Alert.alert(
            '插入桥接消息',
            `为保证对话连续，将插入 Assistant 消息「${TOOL_TURN_BRIDGE_TEXT}」，再发送您的消息。`,
            [
              {
                text: '取消',
                style: 'cancel',
                onPress: () => resolve(),
              },
              {
                text: '确认并发送',
                onPress: () => {
                  void (async () => {
                    try {
                      await runtime.appendToolTurnBridge(sessionId);
                      await streamHandlersRef.current.onMessagesChanged();
                      await executeRun(content, false);
                    } catch (err) {
                      setError(formatError(err));
                    } finally {
                      resolve();
                    }
                  })();
                },
              },
            ],
          );
        });
      }
      await executeRun(content, allowResumeWithoutInput);
    },
    [
      lastMessageHasToolResult,
      runtime,
      sessionId,
      executeRun,
    ],
  );

  const send = useCallback(async () => {
    if (!hasModel) {
      onNeedModel();
      return;
    }
    if (running) {
      runAbortController?.abort();
      // WHY: keep `running` true until `finally` — abort must not race with teardown.
      return;
    }
    const content = text.trim();
    const allowResumeWithoutInput = !content && canResumeWithoutInput;
    if (!content && !allowResumeWithoutInput) {
      return;
    }
    if (content && lastMessageIsPlainUserText) {
      return;
    }
    await sendWithBridgeIfNeeded(content, allowResumeWithoutInput);
  }, [
    hasModel,
    running,
    text,
    canResumeWithoutInput,
    lastMessageIsPlainUserText,
    runAbortController,
    onNeedModel,
    sendWithBridgeIfNeeded,
  ]);

  const inputDisabled = !hasModel || running || lastMessageIsPlainUserText;
  const sendDisabled =
    !hasModel || (!running && !text.trim() && !canResumeWithoutInput);

  const inputPlaceholder = hasModel ? '输入消息…' : '选择模型后可发送';

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
          testID="chat-composer-input"
          style={[
            styles.input,
            {
              color: tokens.text,
              backgroundColor: tokens.surface,
              borderColor: tokens.border,
            },
          ]}
          placeholder={inputPlaceholder}
          placeholderTextColor={tokens.textSecondary}
          value={text}
          onChangeText={next => {
            setText(next);
            writeChatComposerDraft(sessionId, next);
          }}
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
