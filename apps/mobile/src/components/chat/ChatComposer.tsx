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
  hasComposerSendableInput,
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
  applyComposerStatusAttachmentsReplace,
  clearChatComposerDraft,
  hydrateChatComposerDraftFromDb,
  mergeComposerAttachAttachments,
  readChatComposerDraftState,
  subscribeChatComposerDraft,
  writeChatComposerDraftState,
} from '@/storage/chat-composer-draft';

import { projectComposerStatusForSession } from '@/services/project-composer-status.service';

import {
  ComposerAttachChips,
  ComposerStatusChips,
  partitionComposerChipAttachments,
} from './AttachmentDraftChips';
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
  const [hasPendingUserOps, setHasPendingUserOps] = useState(false);
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

  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  const persistDraft = useCallback(
    (nextText: string, nextAttachments: readonly MessageAttachment[]) => {
      writeChatComposerDraftState(
        sessionId,
        {
          text: nextText,
          attachments: nextAttachments,
        },
        runtimeRef.current.sessions,
      );
    },
    [sessionId],
  );

  const refreshPendingUserOps = useCallback(async () => {
    try {
      const pending =
        await runtimeRef.current.userVfsTurn.hasPendingTurns(sessionId);
      setHasPendingUserOps(pending);
    } catch {
      setHasPendingUserOps(false);
    }
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rt = runtimeRef.current;
      await hydrateChatComposerDraftFromDb(sessionId, rt.sessions);
      if (cancelled) {
        return;
      }
      try {
        const session = await rt.sessions.get(sessionId);
        const worktree = rt.worktree({
          kind: 'session',
          projectId: session.projectId,
          sessionId,
        });
        const status = await projectComposerStatusForSession(
          rt,
          worktree,
          sessionId,
        );
        if (cancelled) {
          return;
        }
        applyComposerStatusAttachmentsReplace({
          sessionId,
          attachments: status,
        });
      } catch {
        // 投影失败时仍用已水化的 attach+text
      }
      if (cancelled) {
        return;
      }
      const draft = readChatComposerDraftState(sessionId);
      setText(draft.text);
      setAttachments([...draft.attachments]);
      void refreshPendingUserOps();
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, draftRestoreToken, refreshPendingUserOps]);

  useEffect(() => {
    return subscribeChatComposerDraft(changedSessionId => {
      if (changedSessionId !== sessionId) {
        return;
      }
      const draft = readChatComposerDraftState(sessionId);
      setText(draft.text);
      setAttachments([...draft.attachments]);
      void refreshPendingUserOps();
    });
  }, [sessionId, refreshPendingUserOps]);

  const executeRun = useCallback(
    async (
      content: string,
      allowResumeWithoutInput: boolean,
      runAttachments: readonly MessageAttachment[],
      /** 状态条有 workplace 差集：可发且发送后须清上条（由重投影收敛）。 */
      hasWorkplaceDelta: boolean,
    ) => {
      if (isMobileAgentActive()) {
        return;
      }

      const controller = new AbortController();
      setError(undefined);
      onStreamReset();
      beginUiRun();

      // 有正文 / attach / pending / workplace 差集 → 成功后清输入；pending 仍可发（门闩）
      const shouldClearComposer =
        content.trim() !== '' ||
        runAttachments.length > 0 ||
        hasPendingUserOps ||
        hasWorkplaceDelta;
      let composerCleared = false;
      const clearComposerNow = () => {
        if (composerCleared) {
          return;
        }
        composerCleared = true;
        clearChatComposerDraft(sessionId, runtime.sessions);
        setText('');
        setAttachments([]);
      };

      setRunAbortController(controller);

      try {
        const stream = await runtime.preferences.getLlmStreamEnabled();
        // 显式 attachments 仅 attach；workplace 由 Core materialize，勿传预览 chip
        await runAgentTurn(runtime, scope, content, {
          stream,
          allowResumeWithoutInput,
          attachments: runAttachments.length > 0 ? runAttachments : undefined,
          signal: controller.signal,
          onUserMessageAppended: () => {
            // append 成功后再清输入，避免失败时「字没了、消息也没落盘」
            clearComposerNow();
            void Promise.resolve(
              streamHandlersRef.current.onMessagesChanged(),
            ).catch(() => undefined);
          },
        });
        // 空续跑 / 仅 flush / 仅 workplace 等路径可能不走 append 回调
        if (shouldClearComposer) {
          clearComposerNow();
        }
        // 发送 flush 后 pending 空 → 上条应空；以投影为准刷新 chip
        try {
          const session = await runtime.sessions.get(sessionId);
          const worktree = runtime.worktree({
            kind: 'session',
            projectId: session.projectId,
            sessionId,
          });
          const status = await projectComposerStatusForSession(
            runtime,
            worktree,
            sessionId,
          );
          applyComposerStatusAttachmentsReplace({
            sessionId,
            attachments: status,
          });
        } catch {
          // 投影失败不影响发送结果
        }
        // 再刷一次列表，覆盖 re-append / 流式末态漏刷新
        await Promise.resolve(
          streamHandlersRef.current.onMessagesChanged(),
        ).catch(() => undefined);
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
        void refreshPendingUserOps();
      }
    },
    [
      runtime,
      scope,
      sessionId,
      beginUiRun,
      onStreamReset,
      refreshPendingUserOps,
      hasPendingUserOps,
    ],
  );

  const sendWithBridgeIfNeeded = useCallback(
    async (
      content: string,
      allowResumeWithoutInput: boolean,
      runAttachments: readonly MessageAttachment[],
      hasWorkplaceDelta: boolean,
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
                      await executeRun(
                        content,
                        false,
                        runAttachments,
                        hasWorkplaceDelta,
                      );
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

      await executeRun(
        content,
        allowResumeWithoutInput,
        runAttachments,
        hasWorkplaceDelta,
      );
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
    const { attach: attachOnly } = partitionComposerChipAttachments(attachments);
    // 状态条 workplace 差集 = 可发输入；有差集禁止纯 resume
    const hasWorkplaceDelta = attachments.some(a => a.source === 'workplace');
    const hasAttachments = attachOnly.length > 0;
    const hasSendable = hasComposerSendableInput({
      text: content,
      attachmentCount: attachOnly.length,
      hasPendingUserOps,
      hasWorkplaceDelta,
    });
    // 仅当无可发输入（含无 workplace）且 canResume 时才允许空续跑
    const allowResumeWithoutInput =
      !hasSendable && canResumeWithoutInput;

    if (!hasSendable && !allowResumeWithoutInput) {
      return;
    }

    if ((content || hasAttachments) && lastMessageIsPlainUserText) {
      return;
    }

    await sendWithBridgeIfNeeded(
      content,
      allowResumeWithoutInput,
      attachOnly,
      hasWorkplaceDelta,
    );
  }, [
    hasModel,
    running,
    text,
    attachments,
    hasPendingUserOps,
    canResumeWithoutInput,
    lastMessageIsPlainUserText,
    runAbortController,
    abortUiRun,
    onNeedModel,
    sendWithBridgeIfNeeded,
  ]);

  const inputDisabled = !hasModel || running || lastMessageIsPlainUserText;
  const sendHasWorkplaceDelta = attachments.some(
    a => a.source === 'workplace',
  );
  const sendDisabled =
    !hasModel ||
    (!running &&
      !hasComposerSendableInput({
        text,
        attachmentCount: partitionComposerChipAttachments(attachments).attach
          .length,
        hasPendingUserOps,
        hasWorkplaceDelta: sendHasWorkplaceDelta,
      }) &&
      !canResumeWithoutInput);

  const inputPlaceholder = hasModel ? '输入消息…' : '选择模型后可发送';

  return (
    <View
      style={[styles.dock, { backgroundColor: tokens.background }]}
    >
      {!hasModel ? (
        <Pressable onPress={onNeedModel} style={styles.hintRow}>
          <Text style={{ color: tokens.primary }}>请先选择工作区模型</Text>
        </Pressable>
      ) : null}

      {error ? (
        <Text style={[styles.error, { color: tokens.danger }]}>{error}</Text>
      ) : null}

      {/* 状态条：输入框外上方；与 dock 同色实底，避免键盘顶起后消息透出 */}
      <View
        style={[styles.statusOutside, { backgroundColor: tokens.background }]}
        pointerEvents="box-none"
      >
        <ComposerStatusChips
          attachments={attachments}
          disabled={inputDisabled}
        />
      </View>
      <View
        style={[
          styles.box,
          { backgroundColor: tokens.surface, borderColor: tokens.border },
        ]}
      >
        <ComposerAttachChips
          attachments={attachments}
          disabled={inputDisabled}
          onRemoveAttach={attachIndex => {
            setAttachments(prev => {
              let seen = -1;
              const next = prev.filter(a => {
                if (a.source !== 'attach') {
                  return true;
                }
                seen += 1;
                return seen !== attachIndex;
              });
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
          mergeComposerAttachAttachments(
            sessionId,
            picked,
            runtimeRef.current.sessions,
          );
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
    flexShrink: 0,
    // 实底由 tokens.background 注入；盖住消息区溢出，键盘顶起时不透出
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
    gap: 4,
    zIndex: 2,
    elevation: 4,
  },
  statusOutside: {
    // 与 dock 同色，形成连续「状态 bar」
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
