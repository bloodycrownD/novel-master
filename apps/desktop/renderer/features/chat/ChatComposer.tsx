import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageAttachmentDto } from "@shared/ipc-types";
import { useAutoResizeTextarea } from "@/hooks/useAutoResizeTextarea";
import { handleMultilineSubmitKeyDown } from "@/utils/textarea-enter-shortcuts";
import {
  hasComposerSendableInput,
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
  onComposerAttachmentsSuggest,
} from "@/ipc/client";
import { useShellNav } from "@/providers/ShellNavProvider";
import { AttachmentDraftChips } from "./AttachmentDraftChips";
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
        mergeAttachmentsByPath(attachmentsRef.current, payload.attachments),
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
      if (content || runAttachments.length > 0) {
        onChange("");
        onAttachmentsChange([]);
      }

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

      await onMessagesChanged();
      return true;
    },
    [
      abortUiRun,
      beginUiRun,
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

    const content = value.trim();
    const hasAttachments = attachments.length > 0;
    const hasSendable = hasComposerSendableInput({
      text: content,
      attachmentCount: attachments.length,
      hasPendingUserOps,
    });
    const allowResumeWithoutInput =
      !content && !hasAttachments && canResumeWithoutInput;
    if (!hasSendable && !allowResumeWithoutInput) {
      return;
    }

    if ((content || hasAttachments) && lastMessageIsPlainUserText) {
      return;
    }

    if (content && lastMessageHasToolResult) {
      setBridgePendingText(content);
      setBridgePendingAttachments([...attachments]);
      return;
    }

    await runAgent(content, allowResumeWithoutInput, attachments);
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
      await runAgent(content, false, pendingAttachments);
    } finally {
      setBridgeBusy(false);
    }
  };

  const inputDisabled =
    (!hasModel && !running) || lastMessageIsPlainUserText;
  const sendDisabled =
    !hasModel ||
    (!running &&
      !hasComposerSendableInput({
        text: value,
        attachmentCount: attachments.length,
        hasPendingUserOps,
      }) &&
      !canResumeWithoutInput);

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
          <AttachmentDraftChips
            attachments={attachments}
            disabled={inputDisabled}
            onRemove={index => {
              onAttachmentsChange(attachments.filter((_, i) => i !== index));
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
