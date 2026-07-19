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
import type { WorktreeListRow } from '@novel-master/core/worktree';

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
  readChatComposerDraftState,
  refreshComposerAnnotateChips,
  subscribeChatComposerDraft,
  writeChatComposerDraftState,
} from '@/storage/chat-composer-draft';
import {
  clearChatAnnotateDrafts,
  hasChatAnnotateDrafts,
  listChatAnnotateDrafts,
  subscribeChatAnnotateDraft,
} from '@/storage/chat-annotate-draft';

import { projectComposerStatusForSession } from '@/services/project-composer-status.service';

import { ComposerStatusChips } from './AttachmentDraftChips';
import {
  ComposerAtPathInput,
  type ComposerAtPathInputHandle,
} from './ComposerAtPathInput';
import { AtPathTypeahead } from './AtPathTypeahead';
import {
  type AtPathRef,
  countScannedAtPathAttachments,
  filterAtPathTypeaheadCandidates,
  findActiveAtQuery,
  replaceActiveAtWithToken,
} from './composer-at-path';
import { composerDockBottomPadding } from './composer-dock-padding';
import { FileReferencePicker } from './FileReferencePicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const insets = useSafeAreaInsets();
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
  const [cursor, setCursor] = useState(0);
  const [typeaheadRows, setTypeaheadRows] = useState<WorktreeListRow[]>([]);
  const inputRef = useRef<TextInput>(null);
  /** 程序化插入 @path（选择器 / typeahead）走 mentions 提交路径。 */
  const atPathInputRef = useRef<ComposerAtPathInputHandle>(null);

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

  const activeAt = findActiveAtQuery(text, cursor);

  useEffect(() => {
    if (activeAt == null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const session = await runtimeRef.current.sessions.get(sessionId);
        const worktree = runtimeRef.current.worktree({
          kind: 'session',
          projectId: session.projectId,
          sessionId,
        });
        const rows = await worktree.buildListRows();
        if (!cancelled) {
          setTypeaheadRows(rows);
        }
      } catch {
        if (!cancelled) {
          setTypeaheadRows([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAt != null, sessionId]);

  const typeaheadCandidates = (() => {
    if (activeAt == null) {
      return [] as AtPathRef[];
    }
    const refs: AtPathRef[] = typeaheadRows
      .filter(r => r.path !== '/')
      .map(r => ({
        path: r.path,
        kind: r.kind === 'dir' ? ('dir' as const) : ('file' as const),
      }));
    return filterAtPathTypeaheadCandidates(refs, activeAt.query, 5);
  })();

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
      const pending = await runtimeRef.current.userVfsTurn.hasPendingTurns(
        sessionId,
      );
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

  useEffect(() => {
    return subscribeChatAnnotateDraft(changedSessionId => {
      if (changedSessionId !== sessionId) {
        return;
      }
      refreshComposerAnnotateChips(sessionId);
    });
  }, [sessionId]);

  const executeRun = useCallback(
    async (
      content: string,
      allowResumeWithoutInput: boolean,
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

      // 有正文 / pending / workplace 差集 → 成功后清输入；pending 仍可发（门闩）
      // annotate 仅在 onUserMessageAppended 清 store（与正文分轨可并存于回调）
      const shouldClearComposer =
        content.trim() !== '' ||
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
        const annotateDrafts = listChatAnnotateDrafts(sessionId);
        // 文件引用由 Core 扫描正文 `@`；workplace 由 Core materialize
        await runAgentTurn(runtime, scope, content, {
          stream,
          allowResumeWithoutInput,
          signal: controller.signal,
          annotateDrafts:
            annotateDrafts.length > 0 ? annotateDrafts : undefined,
          onUserMessageAppended: () => {
            // append 成功后再清输入 + annotate，避免失败时丢草稿
            clearChatAnnotateDrafts(sessionId);
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
                      await executeRun(content, false, hasWorkplaceDelta);
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

      await executeRun(content, allowResumeWithoutInput, hasWorkplaceDelta);
    },
    [lastMessageHasToolResult, runtime, sessionId, executeRun],
  );

  const insertTokensIntoComposer = useCallback(
    (tokens: readonly string[]) => {
      if (tokens.length === 0) {
        return;
      }
      // 有未完成 @… 时从 @ 起替换到光标，避免残留半截查询
      const replaceStart = activeAt != null ? activeAt.start : cursor;
      const before = text.slice(0, replaceStart);
      const after = text.slice(cursor);
      const gapBefore =
        before.length === 0 || /\s$/.test(before) ? '' : ' ';
      const joined = tokens.join(' ');
      // 对齐 replaceActiveAtWithToken：after 为空或非空白开头时补尾空格
      const gapAfter =
        after.length === 0 || !/^\s/.test(after) ? ' ' : '';
      const inserted = `${gapBefore}${joined}${gapAfter}`;
      const next = `${before}${inserted}${after}`;
      const nextCursor = before.length + inserted.length;
      // 程序化 API：新增 @path 提成 mention（成 tag + 可原子删）
      if (atPathInputRef.current) {
        atPathInputRef.current.replaceCommittedText(next, nextCursor);
        return;
      }
      const statusOnly = attachments.filter(
        a => a.source === 'workplace' || a.source === 'user_ops',
      );
      setText(next);
      persistDraft(next, statusOnly);
      setCursor(nextCursor);
    },
    [activeAt, attachments, cursor, persistDraft, text],
  );

  const applyTypeaheadToken = useCallback(
    (token: string) => {
      // 优先 mentions onSelect；失败再整段 replaceCommittedText
      if (atPathInputRef.current?.replaceActiveAt(token)) {
        return;
      }
      if (activeAt == null) {
        return;
      }
      const next = replaceActiveAtWithToken(text, cursor, activeAt.start, token);
      if (atPathInputRef.current) {
        atPathInputRef.current.replaceCommittedText(next.text, next.cursor);
        return;
      }
      const statusOnly = attachments.filter(
        a => a.source === 'workplace' || a.source === 'user_ops',
      );
      setText(next.text);
      persistDraft(next.text, statusOnly);
      setCursor(next.cursor);
    },
    [activeAt, attachments, cursor, persistDraft, text],
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
    const scannedCount = countScannedAtPathAttachments(text);
    // 状态条 workplace 差集 = 可发输入；有差集禁止纯 resume
    const hasWorkplaceDelta = attachments.some(a => a.source === 'workplace');
    const hasSendable = hasComposerSendableInput({
      text: content,
      attachmentCount: scannedCount,
      hasPendingUserOps,
      hasWorkplaceDelta,
      hasAnnotateDrafts: hasChatAnnotateDrafts(sessionId),
    });
    // 仅当无可发输入（含无 workplace）且 canResume 时才允许空续跑
    const allowResumeWithoutInput = !hasSendable && canResumeWithoutInput;

    if (!hasSendable && !allowResumeWithoutInput) {
      return;
    }

    if (content && lastMessageIsPlainUserText) {
      return;
    }

    await sendWithBridgeIfNeeded(
      content,
      allowResumeWithoutInput,
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
  const sendHasWorkplaceDelta = attachments.some(a => a.source === 'workplace');
  const sendDisabled =
    !hasModel ||
    (!running &&
      !hasComposerSendableInput({
        text,
        attachmentCount: countScannedAtPathAttachments(text),
        hasPendingUserOps,
        hasWorkplaceDelta: sendHasWorkplaceDelta,
        hasAnnotateDrafts: hasChatAnnotateDrafts(sessionId),
      }) &&
      !canResumeWithoutInput);

  const inputPlaceholder = hasModel ? '输入消息…' : '选择模型后可发送';

  return (
    <View
      style={[
        styles.dock,
        {
          backgroundColor: tokens.background,
          paddingBottom: composerDockBottomPadding(insets.bottom),
        },
      ]}
    >
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
        {/* 状态 chip 在输入框内顶部：不可叉；无文件引用 attach chip */}
        <ComposerStatusChips
          attachments={attachments}
          disabled={inputDisabled}
        />
        <AtPathTypeahead
          open={activeAt != null && !inputDisabled}
          candidates={typeaheadCandidates}
          onSelect={applyTypeaheadToken}
        />
        <ComposerAtPathInput
          ref={atPathInputRef}
          inputRef={inputRef}
          testID="chat-composer-input"
          style={styles.input}
          placeholder={inputPlaceholder}
          placeholderTextColor={tokens.textSecondary}
          value={text}
          cursor={cursor}
          onChangeText={next => {
            setText(next);
            const statusOnly = attachments.filter(
              a => a.source === 'workplace' || a.source === 'user_ops',
            );
            persistDraft(next, statusOnly);
          }}
          onSelectionChange={e => {
            setCursor(e.nativeEvent.selection.start);
          }}
          editable={!inputDisabled}
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
        onConfirm={tokens => {
          insertTokensIntoComposer(tokens);
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
    lineHeight: 22,
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
