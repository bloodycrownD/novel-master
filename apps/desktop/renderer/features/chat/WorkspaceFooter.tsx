import { useCallback, useEffect, useState } from "react";
import {
  ipcAgentListPicker,
  ipcAgentSetCurrent,
  ipcModelListPicker,
  ipcModelSetCurrent,
  ipcPromptAgentMeta,
  ipcPromptChatTokenLabel,
} from "../../ipc/client";

interface WorkspaceFooterProps {
  projectId: string;
  sessionId: string;
}

export function WorkspaceFooter({ projectId, sessionId }: WorkspaceFooterProps) {
  const [agentName, setAgentName] = useState("—");
  const [modelLabel, setModelLabel] = useState("—");
  const [tokenLabel, setTokenLabel] = useState("");

  const reload = useCallback(async () => {
    const [meta, tokens] = await Promise.all([
      ipcPromptAgentMeta(),
      ipcPromptChatTokenLabel({ projectId, sessionId }),
    ]);
    if (meta.ok) {
      setAgentName(meta.data.agentName);
      setModelLabel(meta.data.modelLabel);
    }
    if (tokens.ok) {
      setTokenLabel(tokens.data);
    }
  }, [projectId, sessionId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openAgentPicker = async () => {
    const result = await ipcAgentListPicker();
    if (!result.ok || result.data.rows.length === 0) {
      window.alert("暂无 Agent，请先在设置中配置。");
      return;
    }
    const labels = result.data.rows.map((r) => r.label).join("\n");
    const pick = window.prompt(
      `选择 Agent（当前：${agentName}）\n${result.data.rows.map((r, i) => `${i + 1}. ${r.label}`).join("\n")}\n输入序号：`,
    );
    const idx = Number(pick) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= result.data.rows.length) {
      return;
    }
    await ipcAgentSetCurrent({
      agentId: result.data.rows[idx]!.agentId,
    });
    await reload();
  };

  const openModelPicker = async () => {
    const result = await ipcModelListPicker();
    if (!result.ok || result.data.rows.length === 0) {
      window.alert("暂无模型，请先在设置中配置 Provider。");
      return;
    }
    const pick = window.prompt(
      `选择模型（当前：${modelLabel}）\n${result.data.rows.map((r, i) => `${i + 1}. ${r.label}`).join("\n")}\n输入序号：`,
    );
    const idx = Number(pick) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= result.data.rows.length) {
      return;
    }
    await ipcModelSetCurrent({
      applicationModelId: result.data.rows[idx]!.applicationModelId,
    });
    await reload();
  };

  return (
    <div id="conversation-meta" className="workspace-footer-card">
      <div className="workspace-footer__picks">
        <button
          type="button"
          className="workspace-pick"
          data-action="open-agent-picker"
          aria-label="切换 agent"
          onClick={() => void openAgentPicker()}
        >
          <span className="workspace-pick__icon" aria-hidden="true">
            🧠
          </span>
          <span className="workspace-pick__body">
            <span className="workspace-pick__label">Agent</span>
            <span className="workspace-pick__value">{agentName}</span>
          </span>
        </button>
        <button
          type="button"
          className="workspace-pick"
          data-action="open-model-picker"
          aria-label="切换模型"
          onClick={() => void openModelPicker()}
        >
          <span className="workspace-pick__icon" aria-hidden="true">
            🤖
          </span>
          <span className="workspace-pick__body">
            <span className="workspace-pick__label">模型</span>
            <span className="workspace-pick__value">{modelLabel}</span>
          </span>
        </button>
      </div>
      {tokenLabel ? (
        <div className="workspace-token-stats">
          <div className="workspace-token-stats__head">
            <span className="workspace-token-stats__title">上下文占用</span>
          </div>
          <div className="workspace-token-stats__foot">
            <span className="workspace-token-stats__count">{tokenLabel}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function useWorkspaceFooterReload(): {
  reloadFooter: () => void;
  footerKey: number;
} {
  const [footerKey, setFooterKey] = useState(0);
  const reloadFooter = useCallback(() => setFooterKey((k) => k + 1), []);
  return { reloadFooter, footerKey };
}
