import { useCallback, useMemo, useState } from "react";
import type { WorkspacePanelScope } from "@shared/ipc-types";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { IconButton } from "@/components/ui/IconButton";
import { showToast } from "@/components/ui/show-toast";
import {
  ipcProjectsPullTemplate,
  ipcSessionsPullTemplate,
  ipcVfsZipExport,
  ipcVfsZipImport,
  vfsScope,
} from "@/ipc/client";
import { useShellNav } from "@/providers/ShellNavProvider";

type ConfirmKind = "import-zip" | "pull-template";

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
  const { projectId, sessionId } = useShellNav();
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [busy, setBusy] = useState(false);

  const req = vfsScope(panelScope, projectId, sessionId);
  const showSync = panelScope === "session" || panelScope === "chat";

  const exportZip = useCallback(async () => {
    const result = await ipcVfsZipExport(req);
    if (result.ok && result.data === "saved") {
      showToast("已导出 ZIP");
    } else if (!result.ok) {
      showToast(result.error.message);
    }
  }, [req]);

  const importZip = useCallback(async () => {
    setBusy(true);
    try {
      const result = await ipcVfsZipImport({ ...req, confirmed: true });
      if (result.ok && result.data === "imported") {
        onRefresh();
        showToast("已导入 ZIP");
      } else if (!result.ok) {
        showToast(result.error.message);
      }
    } finally {
      setBusy(false);
      setConfirmKind(null);
    }
  }, [req, onRefresh]);

  const pullTemplate = useCallback(async () => {
    setBusy(true);
    try {
      if (panelScope === "session" && projectId) {
        const result = await ipcProjectsPullTemplate({ projectId });
        if (result.ok) {
          onRefresh();
          showToast("已从全局工作区同步");
        } else {
          showToast(result.error.message);
        }
      } else if (panelScope === "chat" && sessionId) {
        const result = await ipcSessionsPullTemplate({ sessionId });
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
  }, [panelScope, projectId, sessionId, onRefresh]);

  const menuItems = useMemo((): readonly ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (showSync) {
      items.push({ label: "初始化", action: "pull-template" });
    }
    items.push({ label: "导入", action: "import-zip" });
    items.push({ label: "导出", action: "export-zip" });
    return items;
  }, [showSync]);

  const handleMenuSelect = useCallback(
    (action: string) => {
      if (action === "export-zip") {
        void exportZip();
        return;
      }
      if (action === "import-zip") {
        setConfirmKind("import-zip");
        return;
      }
      if (action === "pull-template") {
        setConfirmKind("pull-template");
      }
    },
    [exportZip],
  );

  const confirmMessage =
    confirmKind === "import-zip"
      ? "导入 ZIP 将覆盖当前工作区全部文件，确定继续？"
      : panelScope === "session"
        ? "将从全局工作区覆盖当前项目工作区，本地修改将丢失。确定继续？"
        : "将从项目工作区覆盖当前聊天工作区，本地修改将丢失。确定继续？";

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
        danger={confirmKind === "import-zip"}
        busy={busy}
        onConfirm={() => {
          if (confirmKind === "import-zip") {
            void importZip();
          } else {
            void pullTemplate();
          }
        }}
        onCancel={() => !busy && setConfirmKind(null)}
      />
    </>
  );
}
