import { useCallback, useEffect, useState } from "react";
import { Tooltip } from "../../components/ui/Tooltip";
import {
  ipcAgentAbort,
  ipcAgentRun,
  ipcAppUiGet,
  ipcPromptAgentMeta,
} from "../../ipc/client";
import { useShellNav } from "../../providers/ShellNavProvider";

const LLM_STREAM_KEY = "llmStream";

async function readLlmStreamEnabled(): Promise<boolean> {
  const result = await ipcAppUiGet(LLM_STREAM_KEY);
  const raw = result.ok ? result.data : undefined;
  const value = raw ?? "true";
  return value !== "false";
}

interface ChatComposerProps {
  projectId: string;
  sessionId: string;
  running: boolean;
  onRunningChange: (running: boolean) => void;
  onStreamReset: () => void;
  onMessagesChanged: () => void | Promise<void>;
}

export function ChatComposer({
  projectId,
  sessionId,
  running,
  onRunningChange,
  onStreamReset,
  onMessagesChanged,
}: ChatComposerProps) {
  const { agentConfigRevision } = useShellNav();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [hasModel, setHasModel] = useState(false);

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

  const send = async () => {
    if (running) {
      await ipcAgentAbort({ sessionId });
      onRunningChange(false);
      onStreamReset();
      return;
    }

    const content = text.trim();
    if (!content) {
      return;
    }

    const modelCheck = await ipcPromptAgentMeta();
    if (
      modelCheck.ok &&
      (modelCheck.data.modelLabel === "未选择模型" ||
        modelCheck.data.modelLabel === "—")
    ) {
      setError("请先配置模型");
      return;
    }

    setError(undefined);
    onStreamReset();
    onRunningChange(true);
    setText("");

    const stream = await readLlmStreamEnabled();
    const result = await ipcAgentRun({
      projectId,
      sessionId,
      userContent: content,
      stream,
    });

    if (!result.ok) {
      setError(result.error.message);
      onRunningChange(false);
      return;
    }

    await onMessagesChanged();
  };

  return (
    <>
      {error ? <p className="chat-composer__error">{error}</p> : null}
      <div className="chat-composer" id="chat-composer">
        <div className="chat-composer__box">
          <textarea
            className="chat-composer__input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!hasModel && !running}
            placeholder={
              hasModel ? "输入消息…" : "请先配置模型（设置 → Provider）"
            }
            aria-label="消息输入"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
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
                disabled={!hasModel && !running}
                aria-label={running ? "停止" : "发送"}
                onClick={() => void send()}
              >
                {running ? "■" : "↑"}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </>
  );
}
