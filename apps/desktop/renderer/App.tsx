import { useCallback, useEffect, useState } from "react";
import { useColumnSplitters } from "./hooks/useColumnSplitters";
import { useBatchSelection } from "./hooks/useBatchSelection";
import { runSessionAction } from "./features/chat/ConversationPanel";
import { ConfirmModal } from "./components/ui/ConfirmModal";
import { TextPromptModal } from "./components/ui/TextPromptModal";
import { showToast } from "./components/ui/toast";
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  entryLabelForTarget,
  renameWorkspaceEntry,
  runDirectWorkspaceAction,
  setDirRuleEnabled,
} from "./features/workspace/workspace-actions";
import { workspaceMenuItems } from "./features/workspace/workspace-context";
import type { WorkspaceContextTarget } from "./features/workspace/WorkspaceTree";
import { AppChrome } from "./layout/AppChrome";
import { MainShell } from "./layout/MainShell";
import { SettingsOverlay } from "./layout/SettingsOverlay";
import { NovelMasterProvider } from "./providers/NovelMasterProvider";
import { ShellNavProvider, useShellNav } from "./providers/ShellNavProvider";
import { ToastHost } from "./components/ui/Toast";
import { ThemeProvider } from "./providers/ThemeProvider";

type WorkspaceMenuState = WorkspaceContextTarget & {
  items: ReturnType<typeof workspaceMenuItems>;
};

type WorkspacePromptState =
  | { kind: "create-file"; target: WorkspaceContextTarget }
  | { kind: "create-folder"; target: WorkspaceContextTarget }
  | { kind: "rename"; target: WorkspaceContextTarget; initialName: string };

type WorkspaceConfirmState =
  | { kind: "delete"; target: WorkspaceContextTarget }
  | { kind: "dir-rule"; target: WorkspaceContextTarget };

function DesktopOverlays() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const columnLayout = useColumnSplitters();
  const messageBatch = useBatchSelection();
  const { projectId, sessionId, refreshWorkspaceTrees } = useShellNav();

  const [workspaceMenu, setWorkspaceMenu] = useState<WorkspaceMenuState | null>(null);
  const [workspacePrompt, setWorkspacePrompt] = useState<WorkspacePromptState | null>(null);
  const [workspaceConfirm, setWorkspaceConfirm] = useState<WorkspaceConfirmState | null>(null);
  const [sessionMenu, setSessionMenu] = useState<{
    left: number;
    bottom: number;
  } | null>(null);

  const closeMenus = useCallback(() => {
    setWorkspaceMenu(null);
    setSessionMenu(null);
  }, []);

  useEffect(() => {
    const onDocClick = () => closeMenus();
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
        setWorkspaceConfirm({ kind: "dir-rule", target });
        return;
      }

      const result = await runDirectWorkspaceAction(
        target,
        action,
        projectId,
        sessionId,
      );
      if (result.ok) {
        refreshWorkspaceTrees();
      } else {
        showToast(result.message);
      }
    },
    [projectId, sessionId, refreshWorkspaceTrees],
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
    if (confirm.kind === "dir-rule") {
      const result = await setDirRuleEnabled(
        confirm.target,
        true,
        projectId,
        sessionId,
      );
      if (result.ok) {
        refreshWorkspaceTrees();
        showToast("目录规则已开启");
      } else {
        showToast(result.message);
      }
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
          />
        </div>
        <SettingsOverlay
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
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
          data-session-action="batch-ops"
          onClick={() => {
            closeMenus();
            if (projectId && sessionId) {
              void runSessionAction(
                "batch-ops",
                projectId,
                sessionId,
                messageBatch.enter,
              );
            }
          }}
        >
          批量操作
        </button>
        <button
          type="button"
          data-session-action="compact-chat"
          onClick={() => {
            closeMenus();
            if (projectId && sessionId) {
              void runSessionAction(
                "compact-chat",
                projectId,
                sessionId,
                messageBatch.enter,
              );
            }
          }}
        >
          压缩聊天
        </button>
      </div>

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

      <ConfirmModal
        open={workspaceConfirm?.kind === "delete"}
        title="确认删除"
        message={`确定删除「${workspaceConfirm ? entryLabelForTarget(workspaceConfirm.target) : ""}」？`}
        danger
        onConfirm={handleWorkspaceConfirm}
        onCancel={() => setWorkspaceConfirm(null)}
      />

      <ConfirmModal
        open={workspaceConfirm?.kind === "dir-rule"}
        title="目录规则"
        message="是否开启该目录的规则？"
        confirmLabel="开启"
        onConfirm={handleWorkspaceConfirm}
        onCancel={async () => {
          const confirm = workspaceConfirm;
          setWorkspaceConfirm(null);
          if (confirm?.kind === "dir-rule") {
            const result = await setDirRuleEnabled(
              confirm.target,
              false,
              projectId,
              sessionId,
            );
            if (result.ok) {
              refreshWorkspaceTrees();
              showToast("目录规则已关闭");
            } else {
              showToast(result.message);
            }
          }
        }}
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
