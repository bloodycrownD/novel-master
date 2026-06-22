import { useCallback, useEffect, useRef, useState } from "react";
import { useAutoResizeTextarea } from "@/hooks/useAutoResizeTextarea";
import { handleMultilineSubmitKeyDown } from "@/utils/textarea-enter-shortcuts";
import { TOOL_TURN_BRIDGE_TEXT } from "@novel-master/core/chat";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  ipcAgentAbort,
  ipcAgentRun,
  ipcMessagesAppendToolTurnBridge,
  ipcPreferencesGetLlmStream,
  ipcPromptAgentMeta,
} from "@/ipc/client";
import { useShellNav } from "@/providers/ShellNavProvider";

interface ChatComposerProps {
  projectId: string;
  sessionId: string;
  running: boolean;
  /** 末条为 user 时可空发续跑。 */
  canResumeWithoutInput: boolean;
  /** 末条 user 含 tool_result。 */
  lastMessageHasToolResult: boolean;
  /** 末条为 plain user 文本时禁用输入。 */
  lastMessageIsPlainUserText: boolean;
  /** 受控内联错误（由 ConversationPanel 提升状态）。 */
  error?: string;
  /** 内联错误变更回调；未传入时回退到组件内 local state。 */
  onErrorChange?: (msg: string | undefined) => void;
  onRunningChange: (running: boolean) => void;
  onStreamReset: () => void;
  onMessagesChanged: () => void | Promise<void>;
}

export function ChatComposer({
  projectId,
  sessionId,
  running,
  canResumeWithoutInput,
  lastMessageHasToolResult,
  lastMessageIsPlainUserText,
  error: controlledError,
  onErrorChange,
  onRunningChange,
  onStreamReset,
  onMessagesChanged,
}: ChatComposerProps) {
  const { agentConfigRevision } = useShellNav();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [localError, setLocalError] = useState<string | undefined>();
  const [hasModel, setHasModel] = useState(false);
  const [bridgePendingText, setBridgePendingText] = useState<string | null>(
    null,
  );
  const [bridgeBusy, setBridgeBusy] = useState(false);

  const checkModel = useCallback(async () => {
    const result = await ipcPromptAgentMeta();
    if (result.ok) {
      setHasModel(
        result.data.modelLabel !== "未选择模型" && result.data.modelLabel !== "—",
      );
    }
  }, []);

  useEffect(() => {
    void checkModel();
  }, [checkModel, sessionId, agentConfigRevision]);

  useAutoResizeTextarea(textareaRef, text, 200);

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
    async (content: string, allowResumeWithoutInput: boolean) => {
      const modelCheck = await ipcPromptAgentMeta();
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
      onRunningChange(true);
      if (content) {
        setText("");
      }

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
        onRunningChange(false);
        return false;
      }

      await onMessagesChanged();
      return true;
    },
    [
      onMessagesChanged,
      onRunningChange,
      onStreamReset,
      projectId,
      reportError,
      sessionId,
    ],
  );

  const send = async () => {
    if (running) {
      await ipcAgentAbort({ sessionId });
      onRunningChange(false);
      onStreamReset();
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

    if (content && lastMessageHasToolResult) {
      setBridgePendingText(content);
      return;
    }

    await runAgent(content, allowResumeWithoutInput);
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
      await runAgent(content, false);
    } finally {
      setBridgeBusy(false);
    }
  };

  const inputDisabled =
    (!hasModel && !running) || lastMessageIsPlainUserText;
  const sendDisabled =
    !hasModel || (!running && !text.trim() && !canResumeWithoutInput);

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
          <textarea
            ref={textareaRef}
            className="chat-composer__input"
            value={text}
            onChange={(e) => setText(e.target.value)}
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
              >
                ⋯
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
      <ConfirmModal
        open={bridgePendingText != null}
        title="插入桥接消息"
        message={`为保证对话连续，将插入 Assistant 消息「${TOOL_TURN_BRIDGE_TEXT}」，再发送您的消息。`}
        confirmLabel="确认并发送"
        busy={bridgeBusy}
        onConfirm={() => void confirmBridge()}
        onCancel={() => setBridgePendingText(null)}
      />
    </>
  );
}
