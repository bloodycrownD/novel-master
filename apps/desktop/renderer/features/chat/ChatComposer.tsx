import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MessageAttachmentDto, WorktreeListRowDto } from "@shared/ipc-types";
import { useAutoResizeTextarea } from "@/hooks/useAutoResizeTextarea";
import { handleMultilineSubmitKeyDown } from "@/utils/textarea-enter-shortcuts";
import {
  replaceComposerStatusAttachments,
  TOOL_TURN_BRIDGE_TEXT,
} from "@novel-master/core/chat";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  ipcAgentAbort,
  ipcAgentRun,
  ipcMessagesAppendToolTurnBridge,
  ipcPreferencesGetLlmStream,
  ipcPromptAgentMeta,
  ipcSessionsProjectComposerStatus,
  ipcWorktreeBuildListRows,
  onComposerAttachmentsSuggest,
  vfsScope,
} from "@/ipc/client";
import { useShellNav } from "@/providers/ShellNavProvider";
import { ComposerStatusChips } from "./AttachmentDraftChips";
import { AtPathTypeahead } from "./AtPathTypeahead";
import { ComposerAtPathInput } from "./ComposerAtPathInput";
import {
  type AtPathRef,
  filterAtPathTypeaheadCandidates,
  findActiveAtQuery,
  replaceActiveAtWithToken,
} from "./composer-at-path";
import { resolveComposerSendIntent } from "./composer-send-intent";
import { FileReferencePicker } from "./FileReferencePicker";

interface ChatComposerProps {
  projectId: string;
  sessionId: string;
  value: string;
  onChange: (text: string) => void;
  attachments: readonly MessageAttachmentDto[];
  onAttachmentsChange: (attachments: MessageAttachmentDto[]) => void;
  running: boolean;
  /** 末条为 user 时可空发续跑。 */
  canResumeWithoutInput: boolean;
  /** 会话有 pending→user_ops（空发门闩）。 */
  hasPendingUserOps: boolean;
  /** 末条 user 含 tool_result。 */
  lastMessageHasToolResult: boolean;
  /** 末条为 plain user 文本时禁用输入。 */
  lastMessageIsPlainUserText: boolean;
  /** 受控内联错误（由 ConversationPanel 提升状态）。 */
  error?: string;
  /** 内联错误变更回调；未传入时回退到组件内 local state。 */
  onErrorChange?: (msg: string | undefined) => void;
  beginUiRun: () => void;
  abortUiRun: () => void;
  onStreamReset: () => void;
  onMessagesChanged: () => void | Promise<void>;
  /** 打开会话操作菜单；由父级定位并渲染菜单。 */
  onOpenSessionActions?: (anchor: HTMLElement) => void;
}

function rowsToAtPathRefs(rows: readonly WorktreeListRowDto[]): AtPathRef[] {
  return rows
    .filter((r) => r.path !== "/")
    .map((r) => ({
      path: r.path,
      kind: r.kind === "dir" ? ("dir" as const) : ("file" as const),
    }));
}

export function ChatComposer({
  projectId,
  sessionId,
  value,
  onChange,
  attachments,
  onAttachmentsChange,
  running,
  canResumeWithoutInput,
  hasPendingUserOps,
  lastMessageHasToolResult,
  lastMessageIsPlainUserText,
  error: controlledError,
  onErrorChange,
  beginUiRun,
  abortUiRun,
  onStreamReset,
  onMessagesChanged,
  onOpenSessionActions,
}: ChatComposerProps) {
  const { agentConfigRevision } = useShellNav();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [localError, setLocalError] = useState<string | undefined>();
  const [hasModel, setHasModel] = useState(false);
  const [bridgePendingText, setBridgePendingText] = useState<string | null>(
    null,
  );
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [typeaheadRows, setTypeaheadRows] = useState<WorktreeListRowDto[]>([]);

  const checkModel = useCallback(async () => {
    const result = await ipcPromptAgentMeta({ projectId, sessionId });
    if (result.ok) {
      setHasModel(
        result.data.modelLabel !== "未选择模型" && result.data.modelLabel !== "—",
      );
    }
  }, [projectId, sessionId]);

  useEffect(() => {
    void checkModel();
  }, [checkModel, sessionId, agentConfigRevision]);

  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  useEffect(() => {
    return onComposerAttachmentsSuggest(payload => {
      if (payload.sessionId !== sessionId) {
        return;
      }
      onAttachmentsChange(
        replaceComposerStatusAttachments(
          attachmentsRef.current,
          payload.attachments,
        ),
      );
    });
  }, [sessionId, onAttachmentsChange]);

  useAutoResizeTextarea(textareaRef, value, 200);

  const activeAt = useMemo(
    () => findActiveAtQuery(value, cursor),
    [value, cursor],
  );

  useEffect(() => {
    if (activeAt == null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await ipcWorktreeBuildListRows(
        vfsScope("session", projectId, sessionId),
      );
      if (cancelled || !result.ok) {
        return;
      }
      setTypeaheadRows(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAt != null, projectId, sessionId]);

  const typeaheadCandidates = useMemo(() => {
    if (activeAt == null) {
      return [];
    }
    return filterAtPathTypeaheadCandidates(
      rowsToAtPathRefs(typeaheadRows),
      activeAt.query,
      5,
    );
  }, [activeAt, typeaheadRows]);

  const isControlled = onErrorChange != null;
  const displayError = isControlled ? controlledError : localError;

  const reportError = useCallback(
    (msg: string | undefined) => {
      if (onErrorChange) {
        onErrorChange(msg);
      } else {
        setLocalError(msg);
      }
    },
    [onErrorChange],
  );

  const insertTokensIntoComposer = useCallback(
    (tokens: readonly string[]) => {
      if (tokens.length === 0) {
        return;
      }
      const el = textareaRef.current;
      const start = el?.selectionStart ?? value.length;
      const end = el?.selectionEnd ?? start;
      const before = value.slice(0, start);
      const after = value.slice(end);
      const gapBefore =
        before.length === 0 || /\s$/.test(before) ? "" : " ";
      const joined = tokens.join(" ");
      const gapAfter = after.length === 0 || /^\s/.test(after) ? "" : " ";
      const inserted = `${gapBefore}${joined}${gapAfter}`;
      const next = `${before}${inserted}${after}`;
      onChange(next);
      const nextCursor = before.length + inserted.length;
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta != null) {
          ta.focus();
          ta.setSelectionRange(nextCursor, nextCursor);
          setCursor(nextCursor);
        }
      });
    },
    [onChange, value],
  );

  const applyTypeaheadToken = useCallback(
    (token: string) => {
      if (activeAt == null) {
        return;
      }
      const next = replaceActiveAtWithToken(
        value,
        cursor,
        activeAt.start,
        token,
      );
      onChange(next.text);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta != null) {
          ta.focus();
          ta.setSelectionRange(next.cursor, next.cursor);
          setCursor(next.cursor);
        }
      });
    },
    [activeAt, cursor, onChange, value],
  );

  const runAgent = useCallback(
    async (
      content: string,
      allowResumeWithoutInput: boolean,
      hasWorkplaceDelta: boolean,
    ) => {
      const modelCheck = await ipcPromptAgentMeta({ projectId, sessionId });
      if (
        modelCheck.ok &&
        (modelCheck.data.modelLabel === "未选择模型" ||
          modelCheck.data.modelLabel === "—")
      ) {
        reportError("请先配置模型");
        return false;
      }

      reportError(undefined);
      onStreamReset();
      beginUiRun();

      // 文件引用由 Core 扫描正文 `@`；workplace 由 Core materialize
      const shouldClearComposer =
        content.trim() !== "" ||
        hasPendingUserOps ||
        hasWorkplaceDelta;
      const previousValue = attachmentsRef.current;

      const streamResult = await ipcPreferencesGetLlmStream();
      const stream = streamResult.ok ? streamResult.data : true;
      const result = await ipcAgentRun({
        projectId,
        sessionId,
        userContent: content,
        stream,
        allowResumeWithoutInput,
      });

      if (!result.ok) {
        reportError(result.error.message);
        abortUiRun();
        return false;
      }

      if (shouldClearComposer) {
        onChange("");
        onAttachmentsChange([]);
      }
      await onMessagesChanged();
      const statusRes = await ipcSessionsProjectComposerStatus({ sessionId });
      if (statusRes.ok) {
        onAttachmentsChange(
          replaceComposerStatusAttachments(
            shouldClearComposer ? [] : previousValue,
            statusRes.data,
          ),
        );
      }
      return true;
    },
    [
      abortUiRun,
      beginUiRun,
      hasPendingUserOps,
      onMessagesChanged,
      onStreamReset,
      projectId,
      reportError,
      sessionId,
      onChange,
      onAttachmentsChange,
    ],
  );

  const send = async () => {
    if (running) {
      abortUiRun();
      await ipcAgentAbort({ sessionId });
      return;
    }

    const intent = resolveComposerSendIntent({
      text: value,
      attachments,
      hasPendingUserOps,
      canResumeWithoutInput,
      hasModel,
      running,
    });
    const content = value.trim();
    const { hasWorkplaceDelta, hasSendable, allowResumeWithoutInput } = intent;
    if (!hasSendable && !allowResumeWithoutInput) {
      return;
    }

    if (content && lastMessageIsPlainUserText) {
      return;
    }

    if (content && lastMessageHasToolResult) {
      setBridgePendingText(content);
      return;
    }

    await runAgent(content, allowResumeWithoutInput, hasWorkplaceDelta);
  };

  const confirmBridge = async () => {
    const content = bridgePendingText?.trim();
    if (!content) {
      setBridgePendingText(null);
      return;
    }
    setBridgeBusy(true);
    try {
      const bridgeResult = await ipcMessagesAppendToolTurnBridge({ sessionId });
      if (!bridgeResult.ok) {
        reportError(bridgeResult.error.message);
        return;
      }
      await onMessagesChanged();
      setBridgePendingText(null);
      const hasWorkplaceDelta = attachmentsRef.current.some(
        a => a.source === "workplace",
      );
      await runAgent(content, false, hasWorkplaceDelta);
    } finally {
      setBridgeBusy(false);
    }
  };

  const inputDisabled =
    (!hasModel && !running) || lastMessageIsPlainUserText;
  const sendDisabled = resolveComposerSendIntent({
    text: value,
    attachments,
    hasPendingUserOps,
    canResumeWithoutInput,
    hasModel,
    running,
  }).sendDisabled;

  const inputPlaceholder = hasModel
    ? "输入消息…（Ctrl+Enter 发送）"
    : "请先配置模型（设置 → Provider）";

  return (
    <>
      {displayError ? (
        <p className="chat-composer__error">{displayError}</p>
      ) : null}
      <div className="chat-composer" id="chat-composer">
        <div className="chat-composer__box">
          {/* 状态 chip 在输入框内顶部：不可叉；无文件引用 attach chip */}
          <ComposerStatusChips
            attachments={attachments}
            disabled={inputDisabled}
            composerText={value}
          />
          <div className="chat-composer__input-wrap">
            <AtPathTypeahead
              open={activeAt != null && !inputDisabled}
              candidates={typeaheadCandidates}
              onSelect={applyTypeaheadToken}
            />
            <ComposerAtPathInput
              textareaRef={textareaRef}
              value={value}
              onChange={onChange}
              onSelectChange={setCursor}
              disabled={inputDisabled}
              placeholder={inputPlaceholder}
              aria-label="消息输入"
              onKeyDown={(e) => {
                handleMultilineSubmitKeyDown(
                  e,
                  () => void send(),
                  { disabled: sendDisabled },
                );
              }}
            />
          </div>
          <div className="chat-composer__toolbar">
            <Tooltip content="更多选项">
              <button
                type="button"
                className="chat-composer__more"
                data-action="open-session-actions"
                aria-label="更多选项"
                aria-haspopup="menu"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenSessionActions?.(e.currentTarget);
                }}
              >
                ⋯
              </button>
            </Tooltip>
            <div className="chat-composer__toolbar-spacer" />
            <Tooltip content="引用文件">
              <button
                type="button"
                className="chat-composer__at"
                aria-label="引用文件"
                disabled={inputDisabled}
                onClick={() => setPickerOpen(true)}
              >
                @
              </button>
            </Tooltip>
            <Tooltip content={running ? "停止" : "发送"}>
              <button
                type="button"
                className="chat-composer__send"
                disabled={sendDisabled}
                aria-label={running ? "停止" : "发送"}
                onClick={() => void send()}
              >
                {running ? "■" : "↑"}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
      <FileReferencePicker
        open={pickerOpen}
        projectId={projectId}
        sessionId={sessionId}
        onClose={() => setPickerOpen(false)}
        onConfirm={(tokens) => {
          insertTokensIntoComposer(tokens);
        }}
      />
      <ConfirmModal
        open={bridgePendingText != null}
        title="插入桥接消息"
        message={`为保证对话连续，将插入 Assistant 消息「${TOOL_TURN_BRIDGE_TEXT}」，再发送您的消息。`}
        confirmLabel="确认并发送"
        busy={bridgeBusy}
        onConfirm={() => void confirmBridge()}
        onCancel={() => {
          setBridgePendingText(null);
        }}
      />
    </>
  );
}
