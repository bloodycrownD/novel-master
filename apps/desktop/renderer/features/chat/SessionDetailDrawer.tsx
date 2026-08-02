/**
 * 会话详情抽屉（desktop）。
 *
 * 收拢原 `#session-actions-menu`（重命名 / 压缩 / 切模型 / 切智能体）
 * 与 `WorkspaceFooter`（agent/model 切换 + token 占用）的散落入口，
 * 统一为单一模态抽屉。整体走「点击即编辑 / 点击即切换」的轻交互，
 * 不再堆叠菜单按钮。
 *
 * - 聊天名：点击文字直接进入行内编辑（input），回车或失焦保存，
 *   Esc 取消；保存时调用 `ipcSessionsRename`，成功后回调 `onRenamed`。
 * - Agent / 模型：点击卡片弹出 picker，写 session 级绑定
 *   （`ipcSessionsSetAgentBinding` / `ipcSessionsSetModelOverride`），
 *   不再写 workspace 全局。
 *
 * 锁定规则（保持不变）：
 * - `source === 'project-custom'` → agent 切换禁用（项目截断，引导去项目设置）。
 * - `source === 'session'` → agent 可切换（会话独立持有 agentId）。
 * - `modelSource === 'agent-pin'` 或 agent definition 自带 model → model 切换禁用
 *   （agent pin 压制 session）。
 *
 * core 移除 workspace 回退后：会话始终持有 agentId（必填）+ modelId（可选），
 * 因此 agent picker 不允许 none；model picker 允许 none（清除会话覆盖，
 * 回退到 agent pin 指定的模型）。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  PromptAgentMetaResponse,
  PromptChatTokenStatsResponse,
} from "@shared/ipc-types";
import { PickerModal } from "@/components/ui/PickerModal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
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
  "project-custom": "项目专属",
  session: "会话",
  none: "未配置",
};

const MODEL_SOURCE_LABEL: Record<
  NonNullable<PromptAgentMetaResponse["modelSource"]>,
  string
> = {
  "agent-pin": "Agent 固定",
  session: "会话",
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
  const [compactOpen, setCompactOpen] = useState(false);

  // 聊天名行内编辑状态
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(sessionName);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  // 防止 blur 与 keydown Enter 重复提交
  const submittingRef = useRef(false);

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

  // 外部传入的 sessionName 变化时同步草稿（非编辑态下）
  useEffect(() => {
    if (!editingName) {
      setDraftName(sessionName);
    }
  }, [sessionName, editingName]);

  // 进入编辑态时聚焦并全选
  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  if (!open) {
    return null;
  }

  const source = meta?.source ?? "none";
  const modelSource = meta?.modelSource;
  // project-custom 截断 → agent 锁；session 是会话绑定，用户可改，不锁
  const agentLocked = source === "project-custom";
  // agent pin：definition 自带 model（hasDedicatedModel）压制 session
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

  const startRename = () => {
    setDraftName(sessionName);
    setEditingName(true);
  };

  const commitRename = async () => {
    if (submittingRef.current) {
      return;
    }
    const trimmed = draftName.trim();
    // 空串或未改动 → 直接退出编辑，不调用 IPC
    if (!trimmed || trimmed === sessionName) {
      setEditingName(false);
      setDraftName(sessionName);
      return;
    }
    submittingRef.current = true;
    const result = await ipcSessionsRename({ id: sessionId, title: trimmed });
    submittingRef.current = false;
    setEditingName(false);
    if (result.ok) {
      onRenamed?.(trimmed);
      showToast("已重命名会话");
    } else {
      showToast(result.error.message);
      setDraftName(sessionName);
    }
  };

  const cancelRename = () => {
    setEditingName(false);
    setDraftName(sessionName);
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
          {/* 聊天名：点击进入行内编辑 */}
          <div className="session-detail-drawer__name-row">
            {editingName ? (
              <input
                ref={nameInputRef}
                className="session-detail-drawer__name-input"
                data-session-detail-action="rename-input"
                value={draftName}
                placeholder="会话名称"
                aria-label="编辑会话名称"
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelRename();
                  }
                }}
                onBlur={() => void commitRename()}
              />
            ) : (
              <button
                type="button"
                className="session-detail-drawer__name"
                data-session-detail-action="rename"
                title="点击重命名"
                onClick={startRename}
              >
                <span className="session-detail-drawer__name-text">
                  {sessionName}
                </span>
              </button>
            )}
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

          {/* 次要操作：弱化为底部文字链接 */}
          <div className="session-detail-drawer__secondary">
            <button
              type="button"
              className="session-detail-drawer__link"
              data-session-detail-action="view-prompt"
              onClick={() => {
                onClose();
                requestViewPrompt();
              }}
            >
              查看提示词
            </button>
            <span className="session-detail-drawer__dot" aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              className="session-detail-drawer__link"
              data-session-detail-action="compact"
              onClick={() => setCompactOpen(true)}
            >
              压缩上下文
            </button>
          </div>
        </div>

        {/* 会话必须持有 agentId，agent picker 不允许 none */}
        <PickerModal
          open={agentPickerOpen}
          title={`选择 Agent（当前：${meta?.agentName ?? "—"}）`}
          rows={agentRows.map((r) => ({ id: r.agentId, label: r.label }))}
          currentId={meta?.agentId}
          onClose={() => setAgentPickerOpen(false)}
          onSelect={(agentId) => {
            if (agentId == null) {
              return;
            }
            void ipcSessionsSetAgentBinding({ sessionId, agentId }).then(() => {
              void reload();
              notifyAgentConfigChanged();
            });
          }}
        />
        {/* model 可清除会话覆盖 → 回退到 agent pin 指定的模型 */}
        <PickerModal
          open={modelPickerOpen}
          title={`选择模型（当前：${meta?.modelLabel ?? "—"}）`}
          rows={modelRows.map((r) => ({ id: r.savedModelId, label: r.label }))}
          allowNone
          noneLabel="清除会话覆盖（使用 Agent 指定模型）"
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
