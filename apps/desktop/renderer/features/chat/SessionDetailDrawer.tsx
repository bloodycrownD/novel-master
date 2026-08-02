/**
 * 会话详情抽屉（desktop）。
 *
 * 承载原 `#session-actions-menu`（重命名 / 压缩 / 切模型 / 切智能体）
 * 与 `WorkspaceFooter`（agent/model 切换 + token 占用）的散落入口，
 * 收拢为单一模态抽屉。agent/model 切换一律走 session 级 IPC
 * （`ipcSessionsSetAgentBinding` / `ipcSessionsSetModelOverride`），
 * 不再写 workspace 全局。
 *
 * 锁定规则：
 * - `source === 'project-custom'` 时 agent 切换禁用（项目截断，引导去项目设置改）。
 * - `source === 'session-bind'` 时 agent 可切换（这是 session 绑定，用户可改）。
 * - `modelSource === 'agent-pin'` 或 agent definition 自带 model 时 model 切换禁用
 *   （agent pin 压制 session/workspace）。
 */
import { useCallback, useEffect, useState } from "react";
import type {
  PromptAgentMetaResponse,
  PromptChatTokenStatsResponse,
} from "@shared/ipc-types";
import { PickerModal } from "@/components/ui/PickerModal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { TextPromptModal } from "@/components/ui/TextPromptModal";
import { Tooltip } from "@/components/ui/Tooltip";
import { showToast } from "@/components/ui/show-toast";
import {
  ipcAgentListPicker,
  ipcModelListPicker,
  ipcPromptAgentMeta,
  ipcPromptChatTokenLabel,
  ipcSessionsRename,
  ipcSessionsSetAgentBinding,
  ipcSessionsSetModelOverride,
} from "@/ipc/client";
import { useShellNav } from "@/providers/ShellNavProvider";
import { runCompaction } from "./ConversationPanel";
import { formatTokenCount } from "@/utils/format-token-count";

interface SessionDetailDrawerProps {
  open: boolean;
  projectId: string;
  sessionId: string;
  sessionName: string;
  onClose: () => void;
  /** 重命名成功后通知父级同步导航处会话名。 */
  onRenamed?: (newName: string) => void;
}

const AGENT_SOURCE_LABEL: Record<PromptAgentMetaResponse["source"], string> = {
  global: "工作区",
  "session-bind": "会话绑定",
  "project-custom": "项目专属",
  none: "未配置",
};

const MODEL_SOURCE_LABEL: Record<
  NonNullable<PromptAgentMetaResponse["modelSource"]>,
  string
> = {
  "agent-pin": "Agent 固定",
  "session-override": "会话覆盖",
  workspace: "工作区",
};

function tokenCountLabel(stats: PromptChatTokenStatsResponse): string {
  const prefix = stats.estimated ? "~" : "";
  const current = formatTokenCount(stats.tokenCount);
  if (stats.contextWindow == null || stats.contextWindow <= 0) {
    return stats.estimated
      ? `${prefix}${current} tokens (est.)`
      : `${current} tokens`;
  }
  return `${prefix}${formatTokenCount(stats.tokenCount)} / ${formatTokenCount(
    stats.contextWindow,
  )}`;
}

export function SessionDetailDrawer({
  open,
  projectId,
  sessionId,
  sessionName,
  onClose,
  onRenamed,
}: SessionDetailDrawerProps) {
  const { notifyAgentConfigChanged, requestViewPrompt } = useShellNav();
  const [meta, setMeta] = useState<PromptAgentMetaResponse | null>(null);
  const [tokenStats, setTokenStats] =
    useState<PromptChatTokenStatsResponse | null>(null);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [agentRows, setAgentRows] = useState<
    Array<{ agentId: string; label: string }>
  >([]);
  const [modelRows, setModelRows] = useState<
    Array<{ savedModelId: string; label: string }>
  >([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [compactOpen, setCompactOpen] = useState(false);

  const reload = useCallback(async () => {
    const [metaRes, tokens] = await Promise.all([
      ipcPromptAgentMeta({ projectId, sessionId }),
      ipcPromptChatTokenLabel({ projectId, sessionId }),
    ]);
    if (metaRes.ok) {
      setMeta(metaRes.data);
    }
    if (tokens.ok) {
      setTokenStats(tokens.data);
    }
  }, [projectId, sessionId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void reload();
  }, [open, reload]);

  if (!open) {
    return null;
  }

  const source = meta?.source ?? "none";
  const modelSource = meta?.modelSource;
  const agentLocked = source !== "session-bind" && source !== "global";
  // agent pin：definition 自带 model（hasDedicatedModel）压制 session/workspace
  const modelLocked =
    modelSource === "agent-pin" || (meta?.hasDedicatedModel ?? false);

  const openAgentPicker = async () => {
    if (agentLocked) {
      showToast("本项目使用项目专属智能体，请在项目设置中修改。");
      return;
    }
    const result = await ipcAgentListPicker();
    if (!result.ok || result.data.rows.length === 0) {
      showToast("暂无 Agent，请先在设置中配置。");
      return;
    }
    setAgentRows(result.data.rows);
    setAgentPickerOpen(true);
  };

  const openModelPicker = async () => {
    if (modelLocked) {
      showToast("当前 Agent 已固定模型，请先在 Agent 配置中修改。");
      return;
    }
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
        ? Math.min(100, Math.max(2, tokenStats.tokenCount > 0 ? 8 : 0))
        : 0;

  return (
    <div className="session-detail-drawer" id="session-detail-drawer">
      <div
        className="session-detail-drawer__backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="session-detail-drawer__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-detail-drawer__title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="session-detail-drawer__head">
          <h3 id="session-detail-drawer__title" className="session-detail-drawer__title">
            会话详情
          </h3>
          <button
            type="button"
            className="session-detail-drawer__close"
            data-session-detail-action="close"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="session-detail-drawer__body">
          <div className="session-detail-drawer__row">
            <span className="session-detail-drawer__row-label">聊天名</span>
            <div className="session-detail-drawer__row-value">
              <span className="session-detail-drawer__name">{sessionName}</span>
              <button
                type="button"
                className="session-detail-drawer__inline-btn"
                data-session-detail-action="rename"
                onClick={() => setRenameOpen(true)}
              >
                重命名
              </button>
            </div>
          </div>

          <div className="session-detail-drawer__pick">
            <button
              type="button"
              className={`session-detail-pick${
                agentLocked ? " session-detail-pick--locked" : ""
              }`}
              data-session-detail-action="switch-agent"
              aria-label={agentLocked ? "切换智能体（已锁定）" : "切换智能体"}
              aria-disabled={agentLocked}
              onClick={() => void openAgentPicker()}
            >
              <span className="session-detail-pick__icon" aria-hidden="true">
                🧠
              </span>
              <span className="session-detail-pick__body">
                <span className="session-detail-pick__label">Agent</span>
                <span className="session-detail-pick__value">
                  {meta?.agentName ?? "—"}
                </span>
                <span className="session-detail-pick__source">
                  {AGENT_SOURCE_LABEL[source]}
                  {agentLocked ? " · 锁定" : ""}
                </span>
              </span>
            </button>
            <button
              type="button"
              className={`session-detail-pick${
                modelLocked ? " session-detail-pick--locked" : ""
              }`}
              data-session-detail-action="switch-model"
              aria-label={modelLocked ? "切换大模型（已锁定）" : "切换大模型"}
              aria-disabled={modelLocked}
              onClick={() => void openModelPicker()}
            >
              <span className="session-detail-pick__icon" aria-hidden="true">
                🤖
              </span>
              <span className="session-detail-pick__body">
                <span className="session-detail-pick__label">模型</span>
                <span className="session-detail-pick__value">
                  {meta?.modelLabel ?? "—"}
                </span>
                <span className="session-detail-pick__source">
                  {modelSource ? MODEL_SOURCE_LABEL[modelSource] : ""}
                  {modelLocked ? " · 锁定" : ""}
                </span>
              </span>
            </button>
          </div>

          {tokenStats ? (
            <div className="session-detail-drawer__tokens">
              <div className="session-detail-drawer__tokens-head">
                <span className="session-detail-drawer__tokens-title">
                  上下文占用
                </span>
                {tokenStats.pct != null ? (
                  <span className="session-detail-drawer__tokens-pct">
                    {tokenStats.estimated ? "~" : ""}
                    {tokenStats.pct}%
                  </span>
                ) : null}
              </div>
              <div
                className="session-detail-drawer__tokens-bar"
                role="progressbar"
                aria-valuenow={tokenStats.pct ?? undefined}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="上下文占用"
              >
                <div
                  className="session-detail-drawer__tokens-bar-fill"
                  style={{ width: `${barPct}%` }}
                />
              </div>
              <div className="session-detail-drawer__tokens-foot">
                <span>{tokenCountLabel(tokenStats)}</span>
                <Tooltip content="分词器" placement="top">
                  <span className="session-detail-drawer__tokens-tokenizer">
                    {tokenStats.counterKind}
                  </span>
                </Tooltip>
              </div>
            </div>
          ) : null}

          <div className="session-detail-drawer__actions">
            <button
              type="button"
              className="session-detail-drawer__action"
              data-session-detail-action="view-prompt"
              onClick={() => {
                onClose();
                requestViewPrompt();
              }}
            >
              查看提示词
            </button>
            <button
              type="button"
              className="session-detail-drawer__action"
              data-session-detail-action="compact"
              onClick={() => setCompactOpen(true)}
            >
              压缩上下文
            </button>
          </div>
        </div>

        <PickerModal
          open={agentPickerOpen}
          title={`选择 Agent（当前：${meta?.agentName ?? "—"}）`}
          rows={agentRows.map((r) => ({ id: r.agentId, label: r.label }))}
          currentId={meta?.agentId}
          allowNone
          noneLabel="解除会话绑定（回退工作区）"
          onClose={() => setAgentPickerOpen(false)}
          onSelect={(agentId) => {
            void ipcSessionsSetAgentBinding({ sessionId, agentId }).then(() => {
              void reload();
              notifyAgentConfigChanged();
            });
          }}
        />
        <PickerModal
          open={modelPickerOpen}
          title={`选择模型（当前：${meta?.modelLabel ?? "—"}）`}
          rows={modelRows.map((r) => ({ id: r.savedModelId, label: r.label }))}
          allowNone
          noneLabel="清除会话覆盖（回退工作区）"
          onClose={() => setModelPickerOpen(false)}
          onSelect={(savedModelId) => {
            void ipcSessionsSetModelOverride({
              sessionId,
              modelId: savedModelId,
            }).then(() => {
              void reload();
              notifyAgentConfigChanged();
            });
          }}
        />

        <TextPromptModal
          open={renameOpen}
          title="重命名会话"
          placeholder="会话名称"
          initialValue={sessionName}
          onClose={() => setRenameOpen(false)}
          onConfirm={async (title) => {
            const result = await ipcSessionsRename({ id: sessionId, title });
            if (result.ok) {
              onRenamed?.(title);
              showToast("已重命名会话");
            } else {
              showToast(result.error.message);
            }
          }}
        />

        <ConfirmModal
          open={compactOpen}
          title="压缩上下文"
          message="将按照事件配置压缩上下文。是否继续？"
          onConfirm={() => {
            setCompactOpen(false);
            void runCompaction(projectId, sessionId);
          }}
          onCancel={() => setCompactOpen(false)}
        />
      </div>
    </div>
  );
}
