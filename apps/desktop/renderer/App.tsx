import { useCallback, useEffect, useState } from "react";
import { useColumnSplitters } from "./hooks/useColumnSplitters";
import { useBatchSelection } from "./hooks/useBatchSelection";
import { runCompaction, runSessionAction } from "./features/chat/ConversationPanel";
import { ConfirmModal } from "./components/ui/ConfirmModal";
import { TextPromptModal } from "./components/ui/TextPromptModal";
import { showToast } from "./components/ui/show-toast";
import { DirectoryRuleModal } from "./features/workspace/DirectoryRuleModal";
import { FileInclusionModal } from "./features/workspace/FileInclusionModal";
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  entryLabelForTarget,
  renameWorkspaceEntry,
} from "./features/workspace/workspace-actions";
import { workspaceMenuItems } from "./features/workspace/workspace-context";
import type { WorkspaceContextTarget } from "./features/workspace/WorkspaceTree";
import { AppChrome } from "./layout/AppChrome";
import { MainShell } from "./layout/MainShell";
import { SettingsOverlay } from "./layout/SettingsOverlay";
import { NovelMasterProvider } from "./providers/NovelMasterProvider";
import { ShellNavProvider, useShellNav } from "./providers/ShellNavProvider";
import { ToastHost } from "./components/ui/ToastHost";
import { ThemeProvider } from "./providers/ThemeProvider";
import { ipcWorktreeInvalidateSessionSnapshot, ipcSessionsRename } from "./ipc/client";

type WorkspaceMenuState = WorkspaceContextTarget & {
  items: ReturnType<typeof workspaceMenuItems>;
};

type WorkspacePromptState =
  | { kind: "create-file"; target: WorkspaceContextTarget }
  | { kind: "create-folder"; target: WorkspaceContextTarget }
  | { kind: "rename"; target: WorkspaceContextTarget; initialName: string };

type WorkspaceConfirmState = { kind: "delete"; target: WorkspaceContextTarget };

type SessionRenamePromptState = {
  sessionId: string;
  initialTitle: string;
};

function DesktopOverlays() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const columnLayout = useColumnSplitters();
  const messageBatch = useBatchSelection();
  const { projectId, sessionId, sessionName, updateSessionName, refreshWorkspaceTrees, notifyAgentConfigChanged } =
    useShellNav();

  const [workspaceMenu, setWorkspaceMenu] = useState<WorkspaceMenuState | null>(null);
  const [workspacePrompt, setWorkspacePrompt] = useState<WorkspacePromptState | null>(null);
  const [workspaceConfirm, setWorkspaceConfirm] = useState<WorkspaceConfirmState | null>(null);
  const [dirRuleTarget, setDirRuleTarget] = useState<WorkspaceContextTarget | null>(null);
  const [fileInclusionTarget, setFileInclusionTarget] =
    useState<WorkspaceContextTarget | null>(null);
  const [sessionMenu, setSessionMenu] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const [confirmCompact, setConfirmCompact] = useState(false);
  const [sessionRenamePrompt, setSessionRenamePrompt] =
    useState<SessionRenamePromptState | null>(null);

  const closeMenus = useCallback(() => {
    setWorkspaceMenu(null);
    setSessionMenu(null);
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest("[data-action='open-session-actions']") ||
        target?.closest("#session-actions-menu")
      ) {
        return;
      }
      closeMenus();
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [closeMenus]);

  const openWorkspaceContextMenu = useCallback((target: WorkspaceContextTarget) => {
    setWorkspaceMenu({ ...target, items: workspaceMenuItems(target) });
    setSessionMenu(null);
  }, []);

  const openBlankWorkspaceContextMenu = useCallback(
    (target: Extract<WorkspaceContextTarget, { kind: "blank" }>) => {
      openWorkspaceContextMenu(target);
    },
    [openWorkspaceContextMenu],
  );

  const openSessionActions = useCallback((anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    setSessionMenu({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 200)),
      bottom: window.innerHeight - rect.top + 8,
    });
    setWorkspaceMenu(null);
  }, []);

  const handleWorkspaceAction = useCallback(
    async (target: WorkspaceContextTarget, action: string) => {
      if (action === "create-file") {
        setWorkspacePrompt({ kind: "create-file", target });
        return;
      }
      if (action === "create-folder") {
        setWorkspacePrompt({ kind: "create-folder", target });
        return;
      }
      if (action === "rename" && target.kind === "row") {
        setWorkspacePrompt({
          kind: "rename",
          target,
          initialName: entryLabelForTarget(target),
        });
        return;
      }
      if (action === "delete") {
        setWorkspaceConfirm({ kind: "delete", target });
        return;
      }
      if (action === "rule-config") {
        setDirRuleTarget(target);
        return;
      }
      if (action === "file-inclusion") {
        setFileInclusionTarget(target);
        return;
      }
    },
    [],
  );

  const handleWorkspacePromptConfirm = useCallback(
    async (value: string) => {
      const prompt = workspacePrompt;
      setWorkspacePrompt(null);
      if (!prompt) {
        return;
      }
      let result: { ok: true } | { ok: false; message: string };
      if (prompt.kind === "create-file") {
        result = await createWorkspaceEntry(
          prompt.target,
          "file",
          value,
          projectId,
          sessionId,
        );
      } else if (prompt.kind === "create-folder") {
        result = await createWorkspaceEntry(
          prompt.target,
          "folder",
          value,
          projectId,
          sessionId,
        );
      } else {
        result = await renameWorkspaceEntry(
          prompt.target,
          value,
          projectId,
          sessionId,
        );
      }
      if (result.ok) {
        refreshWorkspaceTrees();
      } else {
        showToast(result.message);
      }
    },
    [workspacePrompt, projectId, sessionId, refreshWorkspaceTrees],
  );

  const handleSessionRenameConfirm = useCallback(
    async (title: string) => {
      const prompt = sessionRenamePrompt;
      setSessionRenamePrompt(null);
      if (!prompt) {
        return;
      }
      const trimmed = title.trim();
      if (!trimmed) {
        return;
      }
      const result = await ipcSessionsRename({
        id: prompt.sessionId,
        title: trimmed,
      });
      if (result.ok) {
        if (prompt.sessionId === sessionId) {
          updateSessionName(trimmed);
        }
        showToast("已重命名会话");
      } else {
        showToast(result.error.message);
      }
    },
    [sessionRenamePrompt, sessionId, updateSessionName],
  );

  const handleWorkspaceConfirm = useCallback(async () => {
    const confirm = workspaceConfirm;
    setWorkspaceConfirm(null);
    if (!confirm) {
      return;
    }
    if (confirm.kind === "delete") {
      const result = await deleteWorkspaceEntry(
        confirm.target,
        projectId,
        sessionId,
      );
      if (result.ok) {
        refreshWorkspaceTrees();
      } else {
        showToast(result.message);
      }
      return;
    }
  }, [workspaceConfirm, projectId, sessionId, refreshWorkspaceTrees]);

  return (
    <>
      <div id="app">
        <AppChrome
          columnLayout={columnLayout}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((open) => !open)}
        />
        <div
          id="main-shell"
          hidden={settingsOpen}
          className={settingsOpen ? "hidden" : undefined}
        >
          <MainShell
            workspaceRef={columnLayout.workspaceRef}
            onOpenWorkspaceContextMenu={openWorkspaceContextMenu}
            onBlankWorkspaceContextMenu={openBlankWorkspaceContextMenu}
            onOpenSessionActions={openSessionActions}
            messageBatch={messageBatch}
            settingsOpen={settingsOpen}
          />
        </div>
        <SettingsOverlay
          open={settingsOpen}
          onClose={() => {
            setSettingsOpen(false);
            notifyAgentConfigChanged();
          }}
        />
      </div>

      <div
        id="session-actions-menu"
        className={`session-actions-menu${sessionMenu ? "" : " hidden"}`}
        role="menu"
        aria-label="会话操作"
        hidden={!sessionMenu}
        style={
          sessionMenu
            ? { left: sessionMenu.left, bottom: sessionMenu.bottom }
            : undefined
        }
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          data-session-action="hide-messages"
          onClick={() => {
            closeMenus();
            if (projectId && sessionId) {
              void runSessionAction(
                "hide-messages",
                projectId,
                sessionId,
                messageBatch,
              );
            }
          }}
        >
          隐藏消息
        </button>
        <button
          type="button"
          data-session-action="restore-messages"
          onClick={() => {
            closeMenus();
            if (projectId && sessionId) {
              void runSessionAction(
                "restore-messages",
                projectId,
                sessionId,
                messageBatch,
              );
            }
          }}
        >
          恢复消息
        </button>
        <button
          type="button"
          data-session-action="delete-messages"
          onClick={() => {
            closeMenus();
            if (projectId && sessionId) {
              void runSessionAction(
                "delete-messages",
                projectId,
                sessionId,
                messageBatch,
              );
            }
          }}
        >
          删除消息
        </button>
        <button
          type="button"
          data-session-action="rename"
          onClick={() => {
            closeMenus();
            if (sessionId && sessionName != null) {
              setSessionRenamePrompt({
                sessionId,
                initialTitle: sessionName,
              });
            }
          }}
        >
          聊天重命名
        </button>
        <button
          type="button"
          data-session-action="refresh-worktree"
          onClick={() => {
            closeMenus();
            if (projectId && sessionId) {
              void (async () => {
                const result = await ipcWorktreeInvalidateSessionSnapshot({
                  projectId,
                  sessionId,
                });
                if (result.ok) {
                  showToast("工作树已刷新");
                } else {
                  showToast(result.error.message);
                }
              })();
            }
          }}
        >
          刷新工作树
        </button>
        <button
          type="button"
          data-session-action="compact-chat"
          onClick={() => {
            closeMenus();
            if (projectId && sessionId) {
              setConfirmCompact(true);
            }
          }}
        >
          压缩上下文
        </button>
      </div>

      <ConfirmModal
        open={confirmCompact}
        title="压缩上下文"
        message="将按照事件配置压缩上下文。是否继续？"
        onConfirm={() => {
          setConfirmCompact(false);
          if (projectId && sessionId) {
            void runCompaction(projectId, sessionId);
          }
        }}
        onCancel={() => setConfirmCompact(false)}
      />

      <div
        id="workspace-context-menu"
        className={`workspace-context-menu${workspaceMenu ? "" : " hidden"}`}
        role="menu"
        aria-label="工作区操作"
        hidden={!workspaceMenu}
        style={
          workspaceMenu
            ? {
                left: Math.max(8, workspaceMenu.x),
                top: Math.max(8, workspaceMenu.y),
              }
            : undefined
        }
        onClick={(e) => e.stopPropagation()}
      >
        {workspaceMenu?.items.map((item) => (
          <button
            key={item.action}
            type="button"
            data-workspace-action={item.action}
            className={item.danger ? "is-danger" : undefined}
            onClick={() => {
              const menu = workspaceMenu;
              closeMenus();
              if (!menu) {
                return;
              }
              void handleWorkspaceAction(menu, item.action);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <TextPromptModal
        open={workspacePrompt != null}
        title={
          workspacePrompt?.kind === "create-file"
            ? "新建文件"
            : workspacePrompt?.kind === "create-folder"
              ? "新建文件夹"
              : "重命名"
        }
        placeholder={
          workspacePrompt?.kind === "create-folder" ? "文件夹名称" : "名称"
        }
        initialValue={
          workspacePrompt?.kind === "rename" ? workspacePrompt.initialName : ""
        }
        onClose={() => setWorkspacePrompt(null)}
        onConfirm={handleWorkspacePromptConfirm}
      />

      <TextPromptModal
        open={sessionRenamePrompt != null}
        title="重命名会话"
        placeholder="会话名称"
        initialValue={sessionRenamePrompt?.initialTitle ?? ""}
        onClose={() => setSessionRenamePrompt(null)}
        onConfirm={handleSessionRenameConfirm}
      />

      <ConfirmModal
        open={workspaceConfirm?.kind === "delete"}
        title="确认删除"
        message={`确定删除「${workspaceConfirm ? entryLabelForTarget(workspaceConfirm.target) : ""}」？`}
        danger
        onConfirm={handleWorkspaceConfirm}
        onCancel={() => setWorkspaceConfirm(null)}
      />

      <DirectoryRuleModal
        open={dirRuleTarget != null}
        target={dirRuleTarget}
        projectId={projectId}
        sessionId={sessionId}
        onClose={() => setDirRuleTarget(null)}
        onSaved={() => {
          refreshWorkspaceTrees();
          showToast("目录规则已保存");
        }}
      />

      <FileInclusionModal
        open={fileInclusionTarget != null}
        target={fileInclusionTarget}
        projectId={projectId}
        sessionId={sessionId}
        onClose={() => setFileInclusionTarget(null)}
        onSaved={() => refreshWorkspaceTrees()}
      />

      <ToastHost />
    </>
  );
}

function DesktopShell() {
  return (
    <ThemeProvider>
      <ShellNavProvider>
        <DesktopOverlays />
      </ShellNavProvider>
    </ThemeProvider>
  );
}

function AppContent() {
  return <DesktopShell />;
}

export function App() {
  return (
    <NovelMasterProvider>
      <AppContent />
    </NovelMasterProvider>
  );
}
