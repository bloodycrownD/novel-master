import { useCallback, useState } from "react";
import type { WorkspacePanelScope } from "../../../shared/ipc-types";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { IconButton } from "../../components/ui/IconButton";
import { showToast } from "../../components/ui/toast";
import {
  ipcProjectsPullTemplate,
  ipcSessionsPullTemplate,
  ipcVfsZipExport,
  ipcVfsZipImport,
  vfsScope,
} from "../../ipc/client";
import { useShellNav } from "../../providers/ShellNavProvider";

type ConfirmKind = "import-zip" | "pull-template";

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

  const confirmMessage =
    confirmKind === "import-zip"
      ? "导入 ZIP 将覆盖当前工作区全部文件，确定继续？"
      : panelScope === "session"
        ? "将从全局工作区覆盖当前项目工作区，本地修改将丢失。确定继续？"
        : "将从项目工作区覆盖当前聊天工作区，本地修改将丢失。确定继续？";

  return (
    <>
      <div className="explorer-header__actions">
        {showSync ? (
          <IconButton
            label="从上级同步"
            onClick={() => setConfirmKind("pull-template")}
          >
            ↻
          </IconButton>
        ) : null}
        <IconButton label="导出 ZIP" onClick={() => void exportZip()}>
          ⬇
        </IconButton>
        <IconButton label="导入 ZIP" onClick={() => setConfirmKind("import-zip")}>
          ⬆
        </IconButton>
      </div>
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
