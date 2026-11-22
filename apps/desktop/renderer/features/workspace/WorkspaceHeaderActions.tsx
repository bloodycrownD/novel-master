import { useCallback, useMemo, useState } from "react";
import type { WorkspacePanelScope } from "@shared/ipc-types";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { IconButton } from "@/components/ui/IconButton";
import { showToast } from "@/components/ui/show-toast";
import { coreT } from "@shared/logic/core-i18n";
import { ipcSessionsPullTemplate, ipcSessionsPushTemplate } from "@/ipc/client";
import { useShellNav } from "@/providers/ShellNavProvider";

type ConfirmKind = "pull-template" | "push-template";

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
    const { workspaceSessionId, subagentSessionId } = useShellNav();
    const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
    const [menu, setMenu] = useState<MenuState | null>(null);
    const [busy, setBusy] = useState(false);

    // 子会话视图不提供覆盖类操作（推送/初始化都会整体覆盖某个工作区），
    // 子会话面板纯观感——共享父工作区的入口收敛到主会话。
    const isSubagentView = subagentSessionId != null;
    // 仅 chat 面板保留同步（从项目工作区拉模板）与推送（覆盖项目工作区）。
    const showSync = panelScope === "chat" && !isSubagentView;

    const pullTemplate = useCallback(async () => {
        setBusy(true);
        try {
            if (workspaceSessionId) {
                const result = await ipcSessionsPullTemplate({ sessionId: workspaceSessionId });
                if (result.ok) {
                    onRefresh();
                    showToast(coreT({key: "ui.vfs.synced_from_project"}));
                } else {
                    showToast(result.error.message);
                }
            }
        } finally {
            setBusy(false);
            setConfirmKind(null);
        }
    }, [workspaceSessionId, onRefresh]);

    const pushTemplate = useCallback(async () => {
        setBusy(true);
        try {
            if (workspaceSessionId) {
                const result = await ipcSessionsPushTemplate({ sessionId: workspaceSessionId });
                if (result.ok) {
                    onRefresh();
                    showToast(coreT({key: "ui.vfs.pushed_to_project"}));
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
            items.push({ label: coreT({key: "ui.vfs.init_action"}), action: "pull-template" });
            items.push({ label: coreT({key: "ui.vfs.push_project_title"}), action: "push-template", danger: true });
        }
        return items;
    }, [showSync]);

    const handleMenuSelect = useCallback((action: string) => {
        if (action === "pull-template" || action === "push-template") {
            setConfirmKind(action);
        }
    }, []);

    // Header 无 ZIP 时若无可选项则隐藏 ⋯
    if (menuItems.length === 0) {
        return null;
    }

    // 拉取与推送的确认文案分别明示各自影响面（覆盖哪个工作区、谁丢修改）。
    const pushTemplateConfirmMessage = coreT({key: "ui.vfs.push_confirm_desktop"});
    const pullTemplateConfirmMessage = coreT({key: "ui.vfs.pull_confirm"});
    const confirmCopy = confirmKind === "push-template" ? { message: pushTemplateConfirmMessage, danger: true } : { message: pullTemplateConfirmMessage, danger: false };

    return (
        <>
            <div className="explorer-header__actions">
                <IconButton
                    className="explorer-header__more-btn"
                    label={coreT({key: "ui.common.more"})}
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
                title={coreT({key: "ui.common.confirm_op"})}
                message={confirmCopy.message}
                danger={confirmCopy.danger}
                busy={busy}
                onConfirm={() => {
                    if (confirmKind === "push-template") {
                        void pushTemplate();
                    } else {
                        void pullTemplate();
                    }
                }}
                onCancel={() => !busy && setConfirmKind(null)}
            />
        </>
    );
}
