import { useCallback, useEffect, useState } from "react";
import type { PromptChatTokenStatsResponse } from "../../../shared/ipc-types";
import { PickerModal } from "../../components/ui/PickerModal";
import { showToast } from "../../components/ui/show-toast";
import {
  ipcAgentListPicker,
  ipcAgentSetCurrent,
  ipcModelListPicker,
  ipcModelSetCurrent,
  ipcPromptAgentMeta,
  ipcPromptChatTokenLabel,
} from "../../ipc/client";
import { formatTokenCount } from "../../utils/format-token-count";

interface WorkspaceFooterProps {
  projectId: string;
  sessionId: string;
}

function tokenCountLabel(stats: PromptChatTokenStatsResponse): string {
  const prefix = stats.estimated ? "~" : "";
  const current = formatTokenCount(stats.tokenCount);
  if (stats.contextWindow == null || stats.contextWindow <= 0) {
    return stats.estimated
      ? `${prefix}${current} tokens (est.)`
      : `${current} tokens`;
  }
  return `${prefix}${formatTokenCount(stats.tokenCount)} / ${formatTokenCount(stats.contextWindow)}`;
}

export function WorkspaceFooter({ projectId, sessionId }: WorkspaceFooterProps) {
  const [agentName, setAgentName] = useState("—");
  const [modelLabel, setModelLabel] = useState("—");
  const [tokenStats, setTokenStats] = useState<PromptChatTokenStatsResponse | null>(
    null,
  );
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [agentRows, setAgentRows] = useState<Array<{ agentId: string; label: string }>>([]);
  const [modelRows, setModelRows] = useState<Array<{ applicationModelId: string; label: string }>>([]);

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
      setTokenStats(tokens.data);
    }
  }, [projectId, sessionId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openAgentPicker = async () => {
    const result = await ipcAgentListPicker();
    if (!result.ok || result.data.rows.length === 0) {
      showToast("暂无 Agent，请先在设置中配置。");
      return;
    }
    setAgentRows(result.data.rows);
    setAgentPickerOpen(true);
  };

  const openModelPicker = async () => {
    const result = await ipcModelListPicker();
    if (!result.ok || result.data.rows.length === 0) {
      showToast("暂无模型，请先在设置中配置 Provider。");
      return;
    }
    setModelRows(result.data.rows);
    setModelPickerOpen(true);
  };

  const barPct =
    tokenStats?.pct != null
      ? Math.min(100, Math.max(0, tokenStats.pct))
      : tokenStats != null
        ? Math.min(100, Math.max(2, (tokenStats.tokenCount > 0 ? 8 : 0)))
        : 0;

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
      {tokenStats ? (
        <div className="workspace-token-stats">
          <div className="workspace-token-stats__head">
            <span className="workspace-token-stats__title">上下文占用</span>
            {tokenStats.pct != null ? (
              <span className="workspace-token-stats__pct">
                {tokenStats.estimated ? "~" : ""}
                {tokenStats.pct}%
              </span>
            ) : null}
          </div>
          <div
            className="workspace-token-bar"
            role="progressbar"
            aria-valuenow={tokenStats.pct ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={
              tokenStats.pct != null
                ? `上下文占用约 ${tokenStats.pct}%`
                : "上下文占用（估算）"
            }
          >
            <div
              className="workspace-token-bar__fill"
              style={{ width: `${barPct}%` }}
            />
          </div>
          <div className="workspace-token-stats__foot">
            <span className="workspace-token-stats__count">
              {tokenCountLabel(tokenStats)}
            </span>
            <span className="workspace-token-stats__tokenizer" title="分词器">
              {tokenStats.counterKind}
            </span>
          </div>
        </div>
      ) : null}
      <PickerModal
        open={agentPickerOpen}
        title={`选择 Agent（当前：${agentName}）`}
        rows={agentRows.map((r) => ({ id: r.agentId, label: r.label }))}
        onClose={() => setAgentPickerOpen(false)}
        onSelect={(agentId) => {
          void ipcAgentSetCurrent({ agentId }).then(() => reload());
        }}
      />
      <PickerModal
        open={modelPickerOpen}
        title={`选择模型（当前：${modelLabel}）`}
        rows={modelRows.map((r) => ({ id: r.applicationModelId, label: r.label }))}
        onClose={() => setModelPickerOpen(false)}
        onSelect={(applicationModelId) => {
          void ipcModelSetCurrent({ applicationModelId }).then(() => reload());
        }}
      />
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
