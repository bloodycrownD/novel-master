/**
 * 会话详情抽屉（desktop）。
 *
 * 收拢原 `#session-actions-menu`（重命名 / 压缩 / 切模型 / 切智能体）
 * 与旧底部栏（agent/model 切换 + token 占用）的散落入口，
 * 统一为单一模态抽屉。整体走「点击即编辑 / 点击即切换」的轻交互，
 * 不再堆叠菜单按钮。
 *
 * - 聊天名：点击文字直接进入行内编辑（input），回车或失焦保存，
 *   Esc 取消；保存时调用 `ipcSessionsRename`，成功后回调 `onRenamed`。
 * - Agent / 模型：点击卡片弹出 picker，写 session 级绑定
 *   （`ipcSessionsSetAgentBinding` / `ipcSessionsSetModelOverride`），
 *   不再写 workspace 全局。
 *
 * 锁定规则（与 mobile/B-1 方案一一致）：
 * - 只有 `source === 'session'`（session.agentId 指向真实 agent）才允许切 agent/model。
 * - `source === 'none'`（agentId 指向已删 agent）一律锁卡，避免已删 agent 场景下还能点出 picker。
 *   项目智能体已下线，不再有 project-custom 分支。
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
  onAgentStream,
} from "@/ipc/client";
import {
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_STEP_COMMITTED,
  type AgentRunFinishedPayload,
  type AgentStepCommittedPayload,
} from "@novel-master/core/events";
import { useShellNav } from "@/providers/ShellNavProvider";
import { runCompaction } from "./ConversationPanel";
import { ChatHistorySearchPanel } from "./ChatHistorySearchPanel";
import { SessionSkillPanel } from "./SessionSkillPanel";
import { formatTokenCount } from "@novel-master/core/common";
import { formatCounterKindLabel } from "@novel-master/core/provider";

interface SessionDetailDrawerProps {
  open: boolean;
  projectId: string;
  sessionId: string;
  sessionName: string;
  onClose: () => void;
  /** 重命名成功后通知父级同步导航处会话名。 */
  onRenamed?: (newName: string) => void;
}

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
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [skillsPanelOpen, setSkillsPanelOpen] = useState(false);

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

  // 订阅 agent stream 生命周期事件：每条消息落库（step committed）或一轮跑完
  // （run finished）后 token 占用都会变，这里实时 reload 一下，免得用户发完
  // 消息还得关掉抽屉再打开才能看到新计数。
  useEffect(() => {
    if (!open || sessionId == null) {
      return;
    }
    return onAgentStream((envelope) => {
      const { type, payload } = envelope;
      if (type === EVENT_AGENT_STEP_COMMITTED) {
        const p = payload as AgentStepCommittedPayload;
        if (p.sessionId === sessionId) {
          void reload();
        }
        return;
      }
      if (type === EVENT_AGENT_RUN_FINISHED) {
        const p = payload as AgentRunFinishedPayload;
        if (p.sessionId === sessionId) {
          void reload();
        }
      }
    });
  }, [open, sessionId, reload]);

  // 回滚成功后 ConversationPanel 会 dispatch 一个 DOM CustomEvent，
  // 这里订阅一下、按 sessionId 过滤，命中就 reload 抽屉里的 token 统计。
  useEffect(() => {
    if (!open || sessionId == null) {
      return;
    }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId: string }>).detail;
      if (detail?.sessionId === sessionId) {
        void reload();
      }
    };
    window.addEventListener('messages-rollback', handler);
    return () => window.removeEventListener('messages-rollback', handler);
  }, [open, sessionId, reload]);

  // 置位（set floor）/ 手动压缩（manual compaction）改变了上下文范围，
  // ConversationPanel 在这两条路径成功后会 dispatch context-changed（按 sessionId 过滤）。
  // 这里订阅一下，命中就 reload 抽屉里的 token 统计。回滚仍走 messages-rollback，事件分开以免语义混淆。
  useEffect(() => {
    if (!open || sessionId == null) {
      return;
    }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId: string }>).detail;
      if (detail?.sessionId === sessionId) {
        void reload();
      }
    };
    window.addEventListener('context-changed', handler);
    return () => window.removeEventListener('context-changed', handler);
  }, [open, sessionId, reload]);

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
  // 锁定口径：只有 source === 'session'（session.agentId 指向真实 agent）才允许切；
  // source === 'none'（session.agentId 指向已删 agent，handler 内层 catch 命中）一律锁，
  // 与 mobile/B-1 方案一保持一致。项目智能体已下线，不再有 project-custom 分支。
  const agentLocked = source !== "session";
  // model 同口径收口：source !== 'session' 即锁定，避免 source='none' 时 model 卡仍可点
  // （原 agent pin / 专属模型判定已废弃，统一走 source 判定）
  const modelLocked = source !== "session";

  const openAgentPicker = async () => {
    if (agentLocked) {
      showToast("当前会话未绑定有效智能体，无法在会话内切换。");
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
      showToast("当前智能体已锁定模型，会话内无法覆盖。");
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

        {searchPanelOpen ? (
          <ChatHistorySearchPanel
            projectId={projectId}
            sessionId={sessionId}
            onClose={() => setSearchPanelOpen(false)}
          />
        ) : skillsPanelOpen ? (
          <SessionSkillPanel
            projectId={projectId}
            onClose={() => setSkillsPanelOpen(false)}
          />
        ) : (
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
              className="session-detail-pick"
              data-session-detail-action="open-skills"
              aria-label="查看会话技能"
              onClick={() => setSkillsPanelOpen(true)}
            >
              <span
                className="session-detail-pick__icon session-detail-pick__icon--skills"
                aria-hidden="true"
              >
                ⚡
              </span>
              <span className="session-detail-pick__body">
                <span className="session-detail-pick__label">技能</span>
                <span className="session-detail-pick__value">
                  查看与管理
                </span>
              </span>
              <span
                className="session-detail-pick__chevron"
                aria-hidden="true"
              >
                ›
              </span>
            </button>
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
              <span
                className="session-detail-pick__icon session-detail-pick__icon--agent"
                aria-hidden="true"
              >
                A
              </span>
              <span className="session-detail-pick__body">
                <span className="session-detail-pick__label">Agent</span>
                <span className="session-detail-pick__value">
                  {meta?.agentName ?? "—"}
                </span>
                {agentLocked ? (
                  <span className="session-detail-pick__lock">
                    <span
                      className="session-detail-pick__lock-icon"
                      aria-hidden="true"
                    >
                      🔒
                    </span>
                    智能体未绑定
                  </span>
                ) : null}
              </span>
              <span
                className="session-detail-pick__chevron"
                aria-hidden="true"
              >
                {agentLocked ? "" : "›"}
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
              <span
                className="session-detail-pick__icon session-detail-pick__icon--model"
                aria-hidden="true"
              >
                M
              </span>
              <span className="session-detail-pick__body">
                <span className="session-detail-pick__label">模型</span>
                <span className="session-detail-pick__value">
                  {meta?.modelLabel ?? "—"}
                </span>
                {modelLocked ? (
                  <span className="session-detail-pick__lock">
                    <span
                      className="session-detail-pick__lock-icon"
                      aria-hidden="true"
                    >
                      🔒
                    </span>
                    智能体锁定
                  </span>
                ) : null}
              </span>
              <span
                className="session-detail-pick__chevron"
                aria-hidden="true"
              >
                {modelLocked ? "" : "›"}
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
                    {formatCounterKindLabel(tokenStats.counterKind)}
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
            <span className="session-detail-drawer__dot" aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              className="session-detail-drawer__link"
              data-session-detail-action="search-history"
              onClick={() => setSearchPanelOpen(true)}
            >
              查找聊天记录
            </button>
          </div>
        </div>
        )}

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
          noneLabel="清除会话覆盖（使用智能体锁定模型）"
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
