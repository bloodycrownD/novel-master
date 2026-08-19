import { useCallback, useMemo, useState } from "react";
import type { WorkspacePanelScope } from "@shared/ipc-types";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { IconButton } from "@/components/ui/IconButton";
import { showToast } from "@/components/ui/show-toast";
import { ipcSessionsPullTemplate } from "@/ipc/client";
import { useShellNav } from "@/providers/ShellNavProvider";

type ConfirmKind = "pull-template";

type MenuState = {
  x: number;
  y: number;
};

interface WorkspaceHeaderActionsProps {
  panelScope: WorkspacePanelScope;
  onRefresh: () => void;
}

export function WorkspaceHeaderActions({
  panelScope,
  onRefresh,
}: WorkspaceHeaderActionsProps) {
  const { workspaceSessionId } = useShellNav();
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [busy, setBusy] = useState(false);

  // 仅 chat 面板保留同步（从项目工作区拉模板）；project 域 pull 已拆除。
  const showSync = panelScope === "chat";

  const pullTemplate = useCallback(async () => {
    setBusy(true);
    try {
      if (workspaceSessionId) {
        const result = await ipcSessionsPullTemplate({ sessionId: workspaceSessionId });
        if (result.ok) {
          onRefresh();
          showToast("已从项目工作区同步");
        } else {
          showToast(result.error.message);
        }
      }
    } finally {
      setBusy(false);
      setConfirmKind(null);
    }
  }, [workspaceSessionId, onRefresh]);

  const menuItems = useMemo((): readonly ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (showSync) {
      items.push({ label: "初始化", action: "pull-template" });
    }
    return items;
  }, [showSync]);

  const handleMenuSelect = useCallback((action: string) => {
    if (action === "pull-template") {
      setConfirmKind("pull-template");
    }
  }, []);

  // Header 无 ZIP 时若无可选项则隐藏 ⋯
  if (menuItems.length === 0) {
    return null;
  }

  const confirmMessage =
    "将从项目工作区覆盖当前聊天工作区，本地修改将丢失。确定继续？";

  return (
    <>
      <div className="explorer-header__actions">
        <IconButton
          className="explorer-header__more-btn"
          label="更多"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({
              x: Math.max(8, rect.right - 120),
              y: Math.max(8, rect.bottom + 4),
            });
          }}
        >
          ⋯
        </IconButton>
      </div>
      <ContextMenu
        open={menu != null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menuItems}
        onSelect={handleMenuSelect}
        onClose={() => setMenu(null)}
      />
      <ConfirmModal
        open={confirmKind != null}
        title="确认操作"
        message={confirmMessage}
        busy={busy}
        onConfirm={() => {
          void pullTemplate();
        }}
        onCancel={() => !busy && setConfirmKind(null)}
      />
    </>
  );
}
