import { useCallback, useEffect, useState } from 'react';
import { useColumnSplitters } from './hooks/useColumnSplitters';
import { SessionDetailDrawer } from './features/chat/SessionDetailDrawer';
import { ConfirmModal } from './components/ui/ConfirmModal';
import { TextPromptModal } from './components/ui/TextPromptModal';
import { showToast } from './components/ui/show-toast';
import { DirectoryRuleModal } from './features/workspace/DirectoryRuleModal';
import { FileInclusionModal } from './features/workspace/FileInclusionModal';
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  entryLabelForTarget,
  renameWorkspaceEntry,
  scopeRequestFromTarget,
} from './features/workspace/workspace-actions';
import {
  workspaceMenuItems,
  zipDirectoryPathForTarget,
  zipImportConfirmMessage,
} from './features/workspace/workspace-context';
import type { WorkspaceContextTarget } from './features/workspace/WorkspaceTree';
import { AppChrome } from './layout/AppChrome';
import { MainShell } from './layout/MainShell';
import { SettingsOverlay } from './layout/SettingsOverlay';
import { NovelMasterProvider } from './providers/NovelMasterProvider';
import { ShellNavProvider, useShellNav } from './providers/ShellNavProvider';
import { ToastHost } from './components/ui/ToastHost';
import { ThemeProvider } from './providers/ThemeProvider';
import {
  ipcVfsCharacterCardImport,
  ipcVfsZipExport,
  ipcVfsZipImport,
} from './ipc/client';

type WorkspaceMenuState = WorkspaceContextTarget & {
  items: ReturnType<typeof workspaceMenuItems>;
};

type WorkspacePromptState =
  | { kind: 'create-file'; target: WorkspaceContextTarget }
  | { kind: 'create-folder'; target: WorkspaceContextTarget }
  | { kind: 'rename'; target: WorkspaceContextTarget; initialName: string };

type WorkspaceConfirmState =
  | { kind: 'delete'; target: WorkspaceContextTarget }
  | { kind: 'import-zip'; target: WorkspaceContextTarget; directoryPath: string }
  | {
      kind: 'import-character-card';
      target: WorkspaceContextTarget;
      directoryPath: string;
    };

function DesktopOverlays() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const columnLayout = useColumnSplitters();
  const {
    projectId,
    sessionId,
    // 工作区操作（context menu / 规则编辑 / 文件增删）统一读 workspaceSessionId。
    // 子会话与父会话共享工作区，它恒等于 sessionId（父 session）。
    workspaceSessionId,
    sessionName,
    updateSessionName,
    notifyWorkspaceMutated,
    notifyAgentConfigChanged,
    markPreviewTabsDeletedUnderPath,
    renamePreviewTab,
    registerEnsurePreviewVisible,
  } = useShellNav();

  const [workspaceMenu, setWorkspaceMenu] = useState<WorkspaceMenuState | null>(
    null,
  );
  const [workspacePrompt, setWorkspacePrompt] =
    useState<WorkspacePromptState | null>(null);
  const [workspaceConfirm, setWorkspaceConfirm] =
    useState<WorkspaceConfirmState | null>(null);
  const [dirRuleTarget, setDirRuleTarget] =
    useState<WorkspaceContextTarget | null>(null);
  const [fileInclusionTarget, setFileInclusionTarget] =
    useState<WorkspaceContextTarget | null>(null);
  // 会话详情抽屉（原 #session-actions-menu 收拢入口）
  const [sessionDetailOpen, setSessionDetailOpen] = useState(false);

  const closeMenus = useCallback(() => {
    setWorkspaceMenu(null);
  }, []);

  useEffect(() => {
    registerEnsurePreviewVisible(() => {
      if (!columnLayout.columnVisibility.preview) {
        columnLayout.toggleColumn('preview');
      }
    });
  }, [
    registerEnsurePreviewVisible,
    columnLayout.columnVisibility.preview,
    columnLayout.toggleColumn,
  ]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      // 会话操作入口点击交给 ChatComposer onClick 处理（打开详情抽屉）
      if (target?.closest("[data-action='open-session-actions']")) {
        return;
      }
      closeMenus();
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [closeMenus]);

  const openWorkspaceContextMenu = useCallback(
    (target: WorkspaceContextTarget) => {
      setWorkspaceMenu({ ...target, items: workspaceMenuItems(target) });
    },
    [],
  );

  const openBlankWorkspaceContextMenu = useCallback(
    (target: Extract<WorkspaceContextTarget, { kind: 'blank' }>) => {
      openWorkspaceContextMenu(target);
    },
    [openWorkspaceContextMenu],
  );

  // 原浮动菜单收拢为模态抽屉：保留 anchor 入参以兼容现有按钮回调签名
  const openSessionActions = useCallback((_anchor: HTMLElement) => {
    setSessionDetailOpen(true);
  }, []);

  const handleWorkspaceAction = useCallback(
    async (target: WorkspaceContextTarget, action: string) => {
      if (action === 'create-file') {
        setWorkspacePrompt({ kind: 'create-file', target });
        return;
      }
      if (action === 'create-folder') {
        setWorkspacePrompt({ kind: 'create-folder', target });
        return;
      }
      if (action === 'rename' && target.kind === 'row') {
        setWorkspacePrompt({
          kind: 'rename',
          target,
          initialName: entryLabelForTarget(target),
        });
        return;
      }
      if (action === 'delete') {
        setWorkspaceConfirm({ kind: 'delete', target });
        return;
      }
      if (action === 'rule-config') {
        setDirRuleTarget(target);
        return;
      }
      if (action === 'file-inclusion') {
        setFileInclusionTarget(target);
        return;
      }
      if (action === 'export-zip') {
        const directoryPath = zipDirectoryPathForTarget(target);
        if (directoryPath == null) {
          return;
        }
        const req = {
          ...scopeRequestFromTarget(target, projectId, workspaceSessionId),
          directoryPath,
        };
        const result = await ipcVfsZipExport(req);
        if (result.ok && result.data === 'saved') {
          showToast('已导出 ZIP');
        } else if (!result.ok) {
          showToast(result.error.message);
        }
        return;
      }
      if (action === 'import-zip') {
        const directoryPath = zipDirectoryPathForTarget(target);
        if (directoryPath == null) {
          return;
        }
        setWorkspaceConfirm({ kind: 'import-zip', target, directoryPath });
        return;
      }
      if (action === 'import-character-card') {
        const directoryPath = zipDirectoryPathForTarget(target);
        if (directoryPath == null) {
          return;
        }
        setWorkspaceConfirm({
          kind: 'import-character-card',
          target,
          directoryPath,
        });
      }
    },
    [projectId, workspaceSessionId],
  );

  const handleWorkspacePromptConfirm = useCallback(
    async (value: string) => {
      const prompt = workspacePrompt;
      setWorkspacePrompt(null);
      if (!prompt) {
        return;
      }
      let result: { ok: true } | { ok: false; message: string };
      if (prompt.kind === 'create-file') {
        result = await createWorkspaceEntry(
          prompt.target,
          'file',
          value,
          projectId,
          workspaceSessionId,
        );
      } else if (prompt.kind === 'create-folder') {
        result = await createWorkspaceEntry(
          prompt.target,
          'folder',
          value,
          projectId,
          workspaceSessionId,
        );
      } else {
        result = await renameWorkspaceEntry(
          prompt.target,
          value,
          projectId,
          workspaceSessionId,
        );
        if (result.ok && prompt.target.kind === 'row') {
          const row = prompt.target.row;
          const parent =
            row.path === '/'
              ? ''
              : row.path.slice(0, row.path.lastIndexOf('/')) || '';
          const newPath = `${parent}/${value.trim()}`.replace(/\/+/g, '/');
          renamePreviewTab(prompt.target.panelScope, row.path, newPath);
        }
      }
      if (result.ok) {
        notifyWorkspaceMutated();
      } else {
        showToast(result.message);
      }
    },
    [
      workspacePrompt,
      projectId,
      workspaceSessionId,
      notifyWorkspaceMutated,
      renamePreviewTab,
    ],
  );

  const handleWorkspaceConfirm = useCallback(async () => {
    const confirm = workspaceConfirm;
    setWorkspaceConfirm(null);
    if (!confirm) {
      return;
    }
    if (confirm.kind === 'delete') {
      const result = await deleteWorkspaceEntry(
        confirm.target,
        projectId,
        workspaceSessionId,
      );
      if (result.ok) {
        if (confirm.target.kind === 'row') {
          markPreviewTabsDeletedUnderPath(
            confirm.target.panelScope,
            confirm.target.row.path,
          );
        }
        notifyWorkspaceMutated();
      } else {
        showToast(result.message);
      }
      return;
    }
    if (confirm.kind === 'import-zip') {
      const req = {
        ...scopeRequestFromTarget(confirm.target, projectId, workspaceSessionId),
        confirmed: true,
        directoryPath: confirm.directoryPath,
      };
      const result = await ipcVfsZipImport(req);
      if (result.ok && result.data === 'imported') {
        notifyWorkspaceMutated();
        showToast('已导入 ZIP');
      } else if (!result.ok) {
        showToast(result.error.message);
      }
      return;
    }
    if (confirm.kind === 'import-character-card') {
      const req = {
        ...scopeRequestFromTarget(confirm.target, projectId, workspaceSessionId),
        confirmed: true,
        directoryPath: confirm.directoryPath,
      };
      const result = await ipcVfsCharacterCardImport(req);
      if (result.ok && result.data === 'imported') {
        notifyWorkspaceMutated();
        showToast('已导入角色卡');
      } else if (!result.ok) {
        showToast(result.error.message);
      }
    }
  }, [
    workspaceConfirm,
    projectId,
    workspaceSessionId,
    notifyWorkspaceMutated,
    markPreviewTabsDeletedUnderPath,
  ]);

  return (
    <>
      <div id="app">
        <AppChrome
          columnLayout={columnLayout}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen(open => !open)}
        />
        <div
          id="main-shell"
          hidden={settingsOpen}
          className={settingsOpen ? 'hidden' : undefined}
        >
          <MainShell
            workspaceRef={columnLayout.workspaceRef}
            onOpenWorkspaceContextMenu={openWorkspaceContextMenu}
            onBlankWorkspaceContextMenu={openBlankWorkspaceContextMenu}
            onOpenSessionActions={openSessionActions}
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

      <SessionDetailDrawer
        open={sessionDetailOpen && !!projectId && !!sessionId}
        projectId={projectId ?? ''}
        sessionId={sessionId ?? ''}
        sessionName={sessionName ?? ''}
        onClose={() => setSessionDetailOpen(false)}
        onRenamed={updateSessionName}
      />

      <div
        id="workspace-context-menu"
        className={`workspace-context-menu${workspaceMenu ? '' : ' hidden'}`}
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
        onClick={e => e.stopPropagation()}
      >
        {workspaceMenu?.items.map(item => (
          <button
            key={item.action}
            type="button"
            data-workspace-action={item.action}
            className={item.danger ? 'is-danger' : undefined}
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
          workspacePrompt?.kind === 'create-file'
            ? '新建文件'
            : workspacePrompt?.kind === 'create-folder'
            ? '新建文件夹'
            : '重命名'
        }
        placeholder={
          workspacePrompt?.kind === 'create-folder' ? '文件夹名称' : '名称'
        }
        initialValue={
          workspacePrompt?.kind === 'rename' ? workspacePrompt.initialName : ''
        }
        onClose={() => setWorkspacePrompt(null)}
        onConfirm={handleWorkspacePromptConfirm}
      />

      <ConfirmModal
        open={workspaceConfirm?.kind === 'delete'}
        title="确认删除"
        message={`确定删除「${
          workspaceConfirm?.kind === 'delete'
            ? entryLabelForTarget(workspaceConfirm.target)
            : ''
        }」？`}
        danger
        onConfirm={handleWorkspaceConfirm}
        onCancel={() => setWorkspaceConfirm(null)}
      />

      <ConfirmModal
        open={workspaceConfirm?.kind === 'import-zip'}
        title="导入 ZIP"
        message={
          workspaceConfirm?.kind === 'import-zip'
            ? zipImportConfirmMessage(workspaceConfirm.directoryPath)
            : ''
        }
        danger
        onConfirm={handleWorkspaceConfirm}
        onCancel={() => setWorkspaceConfirm(null)}
      />

      <ConfirmModal
        open={workspaceConfirm?.kind === 'import-character-card'}
        title="导入角色卡"
        message={
          workspaceConfirm?.kind === 'import-character-card'
            ? zipImportConfirmMessage(workspaceConfirm.directoryPath)
            : ''
        }
        danger
        onConfirm={handleWorkspaceConfirm}
        onCancel={() => setWorkspaceConfirm(null)}
      />

      <DirectoryRuleModal
        open={dirRuleTarget != null}
        target={dirRuleTarget}
        projectId={projectId}
        sessionId={workspaceSessionId}
        onClose={() => setDirRuleTarget(null)}
        onSaved={() => {
          notifyWorkspaceMutated();
          showToast('目录规则已保存');
        }}
      />

      <FileInclusionModal
        open={fileInclusionTarget != null}
        target={fileInclusionTarget}
        projectId={projectId}
        sessionId={workspaceSessionId}
        onClose={() => setFileInclusionTarget(null)}
        onSaved={() => notifyWorkspaceMutated()}
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
