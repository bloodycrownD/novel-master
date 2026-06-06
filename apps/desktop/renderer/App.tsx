import { useCallback, useEffect, useState } from "react";
import { useColumnSplitters } from "./hooks/useColumnSplitters";
import { useBatchSelection } from "./hooks/useBatchSelection";
import { runSessionAction } from "./features/chat/ConversationPanel";
import {
  runWorkspaceContextAction,
  type WorkspaceContextTarget,
} from "./layout/ExplorerPane";
import { AppChrome } from "./layout/AppChrome";
import { MainShell } from "./layout/MainShell";
import { SettingsOverlay } from "./layout/SettingsOverlay";
import { NovelMasterProvider } from "./providers/NovelMasterProvider";
import { ShellNavProvider, useShellNav } from "./providers/ShellNavProvider";
import { ToastHost } from "./components/ui/Toast";
import { ThemeProvider } from "./providers/ThemeProvider";

function DesktopOverlays() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const columnLayout = useColumnSplitters();
  const messageBatch = useBatchSelection();
  const { projectId, sessionId, refreshWorkspaceTrees } = useShellNav();

  const [workspaceMenu, setWorkspaceMenu] = useState<
    (WorkspaceContextTarget & { items: Array<{ action: string; label: string; danger?: boolean }> }) | null
  >(null);
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
    const isDir = target.row.kind === "dir";
    const items = isDir
      ? [
          { action: "rule-config", label: "规则配置" },
          { action: "rename", label: "重命名" },
          { action: "delete", label: "删除", danger: true },
        ]
      : [
          { action: "include-hide", label: "隐藏文件" },
          { action: "include-show", label: "展示文件" },
          { action: "include-follow", label: "跟随目录" },
          { action: "rename", label: "重命名" },
          { action: "delete", label: "删除文件", danger: true },
        ];
    setWorkspaceMenu({ ...target, items });
    setSessionMenu(null);
  }, []);

  const openSessionActions = useCallback((anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    setSessionMenu({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 200)),
      bottom: window.innerHeight - rect.top + 8,
    });
    setWorkspaceMenu(null);
  }, []);

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
              void runWorkspaceContextAction(
                menu,
                item.action,
                projectId,
                sessionId,
                refreshWorkspaceTrees,
              );
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
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
