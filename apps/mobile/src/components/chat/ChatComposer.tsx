/**
 * Chat input: 大框 + 框内「更多 / @ / 发送」；attachments draft。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import Svg, { Path, Rect } from 'react-native-svg';

import {
  TOOL_TURN_BRIDGE_TEXT,
  type MessageAttachment,
} from '@novel-master/core/chat';

import { useTheme } from '@/theme/ThemeProvider';

import { formatError } from '@/errors/format-error';

import { runAgentTurn, type AgentRunScope } from '@/services/agent-run.service';

import { useRuntime } from '@/hooks/useRuntime';

import {
  decrementAgentActive,
  isMobileAgentActive,
} from '@/runtime/agent-activity';

import {
  applyComposerAttachmentsSuggest,
  clearChatComposerDraft,
  readChatComposerDraftState,
  subscribeChatComposerDraft,
  writeChatComposerDraftState,
} from '@/storage/chat-composer-draft';

import { AttachmentDraftChips } from './AttachmentDraftChips';
import { FileReferencePicker } from './FileReferencePicker';

type Props = {
  scope: AgentRunScope;

  hasModel: boolean;

  running: boolean;

  beginUiRun: () => void;

  abortUiRun: () => void;

  onStreamReset: () => void;

  onMessagesChanged: () => void | Promise<void>;

  onNeedModel: () => void;

  /** 末条为 user 时可空发续跑。 */
  canResumeWithoutInput: boolean;

  /** 末条 user 含 tool_result。 */
  lastMessageHasToolResult: boolean;

  /** 末条为 plain user 文本时禁用输入。 */
  lastMessageIsPlainUserText: boolean;

  /** undo_send 回滚成功后递增，触发从 draft 刷新输入框。 */
  draftRestoreToken?: number;

  /** 打开更多菜单（压缩 / 模型 / Agent 等）。 */
  onOpenMore?: () => void;
};

export function ChatComposer({
  scope,
  hasModel,
  running,
  beginUiRun,
  abortUiRun,
  onStreamReset,
  onMessagesChanged,
  onNeedModel,
  canResumeWithoutInput,
  lastMessageHasToolResult,
  lastMessageIsPlainUserText,
  draftRestoreToken,
  onOpenMore,
}: Props) {
  const { tokens } = useTheme();
  const runtime = useRuntime();
  const { sessionId } = scope;
  const initial = readChatComposerDraftState(sessionId);
  const [text, setText] = useState(initial.text);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([
    ...initial.attachments,
  ]);
  const [error, setError] = useState<string | undefined>();
  const [runAbortController, setRunAbortController] =
    useState<AbortController | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const streamHandlersRef = useRef({
    onMessagesChanged,
    onStreamReset,
  });
  streamHandlersRef.current = {
    onMessagesChanged,
    onStreamReset,
  };

  const persistDraft = useCallback(
    (nextText: string, nextAttachments: readonly MessageAttachment[]) => {
      writeChatComposerDraftState(sessionId, {
        text: nextText,
        attachments: nextAttachments,
      });
    },
    [sessionId],
  );

  useEffect(() => {
    const draft = readChatComposerDraftState(sessionId);
    setText(draft.text);
    setAttachments([...draft.attachments]);
  }, [sessionId, draftRestoreToken]);

  useEffect(() => {
    return subscribeChatComposerDraft(changedSessionId => {
      if (changedSessionId !== sessionId) {
        return;
      }
      const draft = readChatComposerDraftState(sessionId);
      setText(draft.text);
      setAttachments([...draft.attachments]);
    });
  }, [sessionId]);

  const executeRun = useCallback(
    async (
      content: string,
      allowResumeWithoutInput: boolean,
      runAttachments: readonly MessageAttachment[],
    ) => {
      if (isMobileAgentActive()) {
        return;
      }

      const controller = new AbortController();
      setError(undefined);
      onStreamReset();
      beginUiRun();

      if (content || runAttachments.length > 0) {
        clearChatComposerDraft(sessionId);
        setText('');
        setAttachments([]);
      }

      setRunAbortController(controller);

      try {
        const stream = await runtime.preferences.getLlmStreamEnabled();
        await runAgentTurn(runtime, scope, content, {
          stream,
          allowResumeWithoutInput,
          attachments: runAttachments.length > 0 ? runAttachments : undefined,
          signal: controller.signal,
          onUserMessageAppended: () => {
            void Promise.resolve(
              streamHandlersRef.current.onMessagesChanged(),
            ).catch(() => undefined);
          },
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          const detail =
            err instanceof Error
              ? {
                  name: err.name,
                  message: err.message,
                  stack: err.stack,
                  cause: String(
                    (err as Error & { cause?: unknown }).cause ?? '',
                  ),
                }
              : { name: typeof err, message: String(err) };
          console.error('[novel-master/chat] run failed', detail);
        }
        setError(formatError(err));
      } finally {
        setRunAbortController(null);
        if (isMobileAgentActive()) {
          decrementAgentActive();
        }
      }
    },
    [runtime, scope, sessionId, beginUiRun, onStreamReset],
  );

  const sendWithBridgeIfNeeded = useCallback(
    async (
      content: string,
      allowResumeWithoutInput: boolean,
      runAttachments: readonly MessageAttachment[],
    ) => {
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
                      await executeRun(content, false, runAttachments);
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

      await executeRun(content, allowResumeWithoutInput, runAttachments);
    },
    [lastMessageHasToolResult, runtime, sessionId, executeRun],
  );

  const send = useCallback(async () => {
    if (!hasModel) {
      onNeedModel();
      return;
    }

    if (running) {
      runAbortController?.abort();
      abortUiRun();
      return;
    }

    const content = text.trim();
    const hasAttachments = attachments.length > 0;
    const allowResumeWithoutInput =
      !content && !hasAttachments && canResumeWithoutInput;

    if (!content && !hasAttachments && !allowResumeWithoutInput) {
      return;
    }

    if ((content || hasAttachments) && lastMessageIsPlainUserText) {
      return;
    }

    await sendWithBridgeIfNeeded(
      content,
      allowResumeWithoutInput,
      attachments,
    );
  }, [
    hasModel,
    running,
    text,
    attachments,
    canResumeWithoutInput,
    lastMessageIsPlainUserText,
    runAbortController,
    abortUiRun,
    onNeedModel,
    sendWithBridgeIfNeeded,
  ]);

  const inputDisabled = !hasModel || running || lastMessageIsPlainUserText;
  const sendDisabled =
    !hasModel ||
    (!running &&
      !text.trim() &&
      attachments.length === 0 &&
      !canResumeWithoutInput);

  const inputPlaceholder = hasModel ? '输入消息…' : '选择模型后可发送';

  return (
    <View style={[styles.dock, { borderTopColor: tokens.border }]}>
      {!hasModel ? (
        <Pressable onPress={onNeedModel} style={styles.hintRow}>
          <Text style={{ color: tokens.primary }}>请先选择工作区模型</Text>
        </Pressable>
      ) : null}

      {error ? (
        <Text style={[styles.error, { color: tokens.danger }]}>{error}</Text>
      ) : null}

      <View
        style={[
          styles.box,
          { backgroundColor: tokens.surface, borderColor: tokens.border },
        ]}
      >
        <AttachmentDraftChips
          attachments={attachments}
          disabled={inputDisabled}
          onRemove={index => {
            setAttachments(prev => {
              const next = prev.filter((_, i) => i !== index);
              persistDraft(text, next);
              return next;
            });
          }}
        />
        <TextInput
          testID="chat-composer-input"
          style={[styles.input, { color: tokens.text }]}
          placeholder={inputPlaceholder}
          placeholderTextColor={tokens.textSecondary}
          value={text}
          onChangeText={next => {
            setText(next);
            persistDraft(next, attachments);
          }}
          editable={!inputDisabled}
          multiline
        />
        <View style={styles.toolbar}>
          <Pressable
            onPress={onOpenMore}
            disabled={onOpenMore == null}
            style={[styles.toolBtn, { borderColor: tokens.border }]}
            accessibilityLabel="更多选项"
          >
            <Text style={{ color: tokens.textSecondary, fontSize: 18 }}>⋯</Text>
          </Pressable>
          <View style={styles.toolbarSpacer} />
          <Pressable
            onPress={() => setPickerOpen(true)}
            disabled={inputDisabled}
            style={[styles.toolBtn, { borderColor: tokens.border }]}
            accessibilityLabel="引用文件"
          >
            <Text style={{ color: tokens.textSecondary, fontSize: 16 }}>@</Text>
          </Pressable>
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
            accessibilityLabel={running ? '终止' : '发送'}
          >
            {running ? <TerminateIcon /> : <SendIcon />}
          </Pressable>
        </View>
      </View>

      <FileReferencePicker
        visible={pickerOpen}
        projectId={scope.projectId}
        sessionId={sessionId}
        onClose={() => setPickerOpen(false)}
        onConfirm={picked => {
          applyComposerAttachmentsSuggest({
            sessionId,
            attachments: picked,
          });
          const draft = readChatComposerDraftState(sessionId);
          setAttachments([...draft.attachments]);
        }}
      />
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
  hintRow: { paddingVertical: 4 },
  error: { fontSize: 12 },
  box: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 4,
  },
  input: {
    minHeight: 56,
    maxHeight: 160,
    paddingHorizontal: 4,
    paddingVertical: 6,
    fontSize: 16,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  toolbarSpacer: { flex: 1 },
  toolBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    minWidth: 44,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
});
