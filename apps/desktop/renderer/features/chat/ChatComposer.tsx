import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageAttachmentDto } from "@shared/ipc-types";
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
  onComposerAttachmentsSuggest,
} from "@/ipc/client";
import { useShellNav } from "@/providers/ShellNavProvider";
import {
  ComposerAttachChips,
  ComposerStatusChips,
} from "./AttachmentDraftChips";
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

function mergeAttachmentsByPath(
  existing: readonly MessageAttachmentDto[],
  incoming: readonly MessageAttachmentDto[],
): MessageAttachmentDto[] {
  const out = [...existing];
  const seen = new Set(
    existing
      .map(a => (a.path != null && a.path !== "" ? `path:${a.path}` : null))
      .filter((k): k is string => k != null),
  );
  for (const item of incoming) {
    const key =
      item.path != null && item.path !== "" ? `path:${item.path}` : null;
    if (key != null && seen.has(key)) {
      continue;
    }
    if (key != null) {
      seen.add(key);
    }
    out.push(item);
  }
  return out;
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
  const [bridgePendingAttachments, setBridgePendingAttachments] = useState<
    MessageAttachmentDto[]
  >([]);
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

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

  const runAgent = useCallback(
    async (
      content: string,
      allowResumeWithoutInput: boolean,
      runAttachments: readonly MessageAttachmentDto[],
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

      // 显式 attachments 仅 attach；workplace 由 Core materialize，不随入参上传
      const shouldClearComposer =
        content.trim() !== "" ||
        runAttachments.length > 0 ||
        hasPendingUserOps ||
        hasWorkplaceDelta;
      const previousValue = attachmentsRef.current;
      // 不在 IPC 前清输入：失败时保留原文；成功后再清

      const streamResult = await ipcPreferencesGetLlmStream();
      const stream = streamResult.ok ? streamResult.data : true;
      const result = await ipcAgentRun({
        projectId,
        sessionId,
        userContent: content,
        stream,
        allowResumeWithoutInput,
        ...(runAttachments.length > 0
          ? { attachments: runAttachments }
          : {}),
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
      // 发送 flush 后 pending 空 → 上条应空（整清 draft 后仍重投影保险）
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
    const { attachOnly, hasWorkplaceDelta, hasSendable, allowResumeWithoutInput } =
      intent;
    const hasAttachments = attachOnly.length > 0;
    if (!hasSendable && !allowResumeWithoutInput) {
      return;
    }

    if ((content || hasAttachments) && lastMessageIsPlainUserText) {
      return;
    }

    if (content && lastMessageHasToolResult) {
      setBridgePendingText(content);
      setBridgePendingAttachments([...attachOnly]);
      return;
    }

    await runAgent(
      content,
      allowResumeWithoutInput,
      attachOnly,
      hasWorkplaceDelta,
    );
  };

  const confirmBridge = async () => {
    const content = bridgePendingText?.trim();
    if (!content) {
      setBridgePendingText(null);
      setBridgePendingAttachments([]);
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
      const pendingAttachments = bridgePendingAttachments;
      setBridgePendingText(null);
      setBridgePendingAttachments([]);
      const hasWorkplaceDelta = attachmentsRef.current.some(
        a => a.source === "workplace",
      );
      await runAgent(content, false, pendingAttachments, hasWorkplaceDelta);
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
        {/* 状态条在输入框外上方：不可叉，与可取消的 @ 附件区分 */}
        <ComposerStatusChips
          attachments={attachments}
          disabled={inputDisabled}
        />
        <div className="chat-composer__box">
          <ComposerAttachChips
            attachments={attachments}
            disabled={inputDisabled}
            onRemoveAttach={attachIndex => {
              let seen = -1;
              onAttachmentsChange(
                attachments.filter(a => {
                  if (a.source !== "attach") {
                    return true;
                  }
                  seen += 1;
                  return seen !== attachIndex;
                }),
              );
            }}
          />
          <textarea
            ref={textareaRef}
            className="chat-composer__input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={inputDisabled}
            placeholder={inputPlaceholder}
            aria-label="消息输入"
            rows={1}
            onKeyDown={(e) => {
              handleMultilineSubmitKeyDown(
                e,
                () => void send(),
                { disabled: sendDisabled },
              );
            }}
          />
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
        onConfirm={picked => {
          onAttachmentsChange(mergeAttachmentsByPath(attachments, picked));
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
          setBridgePendingAttachments([]);
        }}
      />
    </>
  );
}
