import { useCallback, useEffect, useRef, useState } from 'react';
import { validateVfsEntryName } from "@shared/logic/vfs";
import { useColumnSplitters } from './hooks/useColumnSplitters';
import { SessionDetailDrawer } from './features/chat/SessionDetailDrawer';
import { ConfirmModal } from './components/ui/ConfirmModal';
import { TextPromptModal } from './components/ui/TextPromptModal';
import { showToast } from './components/ui/show-toast';
import { DirectoryRuleModal } from './features/workspace/DirectoryRuleModal';
import { FileInclusionModal } from './features/workspace/FileInclusionModal';
import {
  ImportFormModal,
  type ImportForm,
} from './features/workspace/ImportFormModal';
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  entryLabelForTarget,
  renameWorkspaceEntry,
  scopeRequestFromTarget,
  startSingleFileImport,
  confirmSingleFileImport,
  exportWorkspaceTarget,
} from './features/workspace/workspace-actions';
import {
  formatBatchApplyToast,
  skippedBinaryToastMessage,
} from './features/workspace/workspace-batch-dnd';
import {
  batchIngestOverwriteMessage,
  characterCardImportConfirmMessage,
  exportFilePathForTarget,
  workspaceMenuItems,
  zipDirectoryPathForTarget,
  zipImportConfirmMessage,
} from './features/workspace/workspace-context';
import type { WorkspaceContextTarget } from './features/workspace/WorkspaceTree';
import { AppChrome } from './layout/AppChrome';
import { MainShell } from './layout/MainShell';
import { SettingsOverlay, type SettingsOverlayHandle } from './layout/SettingsOverlay';
import { NovelMasterProvider } from './providers/NovelMasterProvider';
import { ShellNavProvider, useShellNav } from './providers/ShellNavProvider';
import { ToastHost } from './components/ui/ToastHost';
import { ThemeProvider } from './providers/ThemeProvider';
import {
  ipcVfsCharacterCardImport,
  ipcVfsZipImport,
} from './ipc/client';
import {
  OPEN_SETTINGS_VIEW_EVENT,
  type OpenSettingsViewDetail,
} from './features/skills/skill-ui';
import { ToolResultViewerModal } from './features/chat/ToolResultViewer';

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
    }
  // 菜单单文件导入的覆盖确认（needs_confirm 后二次提交，与拖拽链路同协议不同编排）。
  | {
      kind: 'ingest-file';
      target: WorkspaceContextTarget;
      targetDir: string;
      hostPaths: string[];
      conflictCount: number;
    };

/** 批量 ingest 成功后的两条 toast（写入汇总 + 非 UTF-8 跳过明示），菜单与拖拽同口径。 */
function showBatchIngestAppliedToast(
  report: Parameters<typeof formatBatchApplyToast>[0],
  skippedBinary: readonly string[],
): void {
  showToast(formatBatchApplyToast(report));
  if (skippedBinary.length > 0) {
    showToast(skippedBinaryToastMessage(skippedBinary.length));
  }
}

function DesktopOverlays() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 关闭设置走 Overlay 内部的 handleClose（守卫 + onClose 副作用单点）。
  // 直接 setSettingsOpen(!open) 会绕过脏表单确认与 notifyAgentConfigChanged。
  const settingsOverlayRef = useRef<SettingsOverlayHandle | null>(null);
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

  // 会话技能面板 / 工具卡片请求打开设置：SettingsOverlay 监听同名事件做栈内导航。
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenSettingsViewDetail>).detail;
      if (detail != null) {
        setSettingsOpen(true);
      }
    };
    window.addEventListener(OPEN_SETTINGS_VIEW_EVENT, handler);
    return () => window.removeEventListener(OPEN_SETTINGS_VIEW_EVENT, handler);
  }, []);
  const [workspacePrompt, setWorkspacePrompt] =
    useState<WorkspacePromptState | null>(null);
  const [workspaceConfirm, setWorkspaceConfirm] =
    useState<WorkspaceConfirmState | null>(null);
  const [dirRuleTarget, setDirRuleTarget] =
    useState<WorkspaceContextTarget | null>(null);
  const [fileInclusionTarget, setFileInclusionTarget] =
    useState<WorkspaceContextTarget | null>(null);
  // 菜单「导入」的形式选择弹窗目标（ZIP / 角色卡 / 单文件三选一）。
  const [importFormTarget, setImportFormTarget] =
    useState<WorkspaceContextTarget | null>(null);
  const [ingestFileBusy, setIngestFileBusy] = useState(false);
  // 覆盖确认弹窗点「覆盖」的防重入闸：弹窗关闭与 await 之间可能连点两次。
  const ingestFileBusyRef = useRef(false);
  // 「导入」形式选择提交（ImportFormModal 底部主按钮）的在途闸：纵深防御，
  // 防连点或多入口重复触发同一次导入编排（单文件分支会连弹系统选择框）。
  const importFormBusyRef = useRef(false);
  // 会话详情抽屉（原 #session-actions-menu 收拢入口）
  const [sessionDetailOpen, setSessionDetailOpen] = useState(false);

  const closeMenus = useCallback(() => {
    setWorkspaceMenu(null);
  }, []);

  // 内联箭头会让 onClose 每次提交都换身份 ⇒ SettingsOverlay 的 handleClose
  // （deps [guardedNav, onClose]）跟着换 ⇒ useImperativeHandle 每次都重写 ref，
  // 「这个 ref 稳不稳」从此只能靠推理、不成立。提成 useCallback 让身份随渲染稳定；
  // 行为零变化（拿到的仍是最新闭包，useCallback + useImperativeHandle 本就如此）。
  const handleSettingsOverlayClose = useCallback(() => {
    setSettingsOpen(false);
    notifyAgentConfigChanged();
  }, [notifyAgentConfigChanged]);

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
      if (action === 'import') {
        setImportFormTarget(target);
        return;
      }
      if (action === 'export') {
        // 导出类型直达：文件行单文件另存、目录/空白行 ZIP 子树，由编排函数分流，
        // 这里不判类型也不弹确认（导出无库写入，无覆盖风险）。
        try {
          const status = await exportWorkspaceTarget(
            scopeRequestFromTarget(target, projectId, workspaceSessionId),
            target,
          );
          if (status === 'saved') {
            // 文案按分流来源走：文件行导的是单文件、目录/空白行导的是 ZIP 子树，
            // 共用一句「已导出」用户分辨不出落盘的是什么。
            showToast(
              exportFilePathForTarget(target) == null ? '已导出 ZIP' : '已导出文件',
            );
          }
        } catch (err) {
          showToast(err instanceof Error ? err.message : '导出失败');
        }
        return;
      }
      showToast('未知操作');
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

  // 「导入」弹窗选定的形式分流：zip / 角色卡进既有确认链路（状态形态与确认处理一行未改），
  // 单文件走「选择文件 → 批量 ingest」两段式编排，needs_confirm 时才再弹覆盖确认。
  // 外层 in-flight 闸（importFormBusyRef）防同一次选择被重复提交——单文件分支会弹系统
  // 选择框，重复进入必然重复导入。
  const handleImportFormSelect = useCallback(
    async (target: WorkspaceContextTarget, form: ImportForm) => {
      if (importFormBusyRef.current) {
        return;
      }
      importFormBusyRef.current = true;
      try {
        const directoryPath = zipDirectoryPathForTarget(target);
        if (directoryPath == null) {
          return;
        }
        if (form === 'zip') {
          setWorkspaceConfirm({ kind: 'import-zip', target, directoryPath });
          return;
        }
        if (form === 'card') {
          setWorkspaceConfirm({
            kind: 'import-character-card',
            target,
            directoryPath,
          });
          return;
        }

        try {
          const result = await startSingleFileImport(
            scopeRequestFromTarget(target, projectId, workspaceSessionId),
            directoryPath,
          );
          if (result.status === 'cancelled') {
            // 用户在系统文件框点了取消：静默返回，不打扰。
            return;
          }
          if (result.status === 'needs-confirm') {
            setWorkspaceConfirm({
              kind: 'ingest-file',
              target,
              targetDir: directoryPath,
              hostPaths: result.hostPaths,
              conflictCount: result.conflictCount,
            });
            return;
          }
          notifyWorkspaceMutated();
          showBatchIngestAppliedToast(result.report, result.skippedBinary);
        } catch (err) {
          showToast(err instanceof Error ? err.message : '导入失败');
        }
      } finally {
        importFormBusyRef.current = false;
      }
    },
    [projectId, workspaceSessionId, notifyWorkspaceMutated],
  );

  const handleIngestFileConfirm = useCallback(async () => {
    const confirm = workspaceConfirm;
    if (!confirm || confirm.kind !== 'ingest-file') {
      return;
    }
    if (ingestFileBusyRef.current) {
      return;
    }
    ingestFileBusyRef.current = true;
    setIngestFileBusy(true);
    try {
      const applied = await confirmSingleFileImport(
        scopeRequestFromTarget(confirm.target, projectId, workspaceSessionId),
        confirm.targetDir,
        confirm.hostPaths,
      );
      notifyWorkspaceMutated();
      showBatchIngestAppliedToast(applied.report, applied.skippedBinary);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导入失败');
    } finally {
      ingestFileBusyRef.current = false;
      setIngestFileBusy(false);
      // 确认期间弹窗保持打开（busy「处理中」真能渲染出来，用户看得见导入在跑），
      // 跑完再关；提前关掉的话 busy 态永远渲染不到，防重入就只剩 ref 一道。
      setWorkspaceConfirm(null);
    }
  }, [workspaceConfirm, projectId, workspaceSessionId, notifyWorkspaceMutated]);

  return (
    <>
      <div id="app">
        <AppChrome
          columnLayout={columnLayout}
          settingsOpen={settingsOpen}
          onToggleSettings={() => {
            if (settingsOpen) {
              settingsOverlayRef.current?.requestClose();
              return;
            }
            // 打开路径不过守卫：打开不卸载任何 view。
            setSettingsOpen(true);
          }}
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
          ref={settingsOverlayRef}
          open={settingsOpen}
          onClose={handleSettingsOverlayClose}
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

      <ToolResultViewerModal />

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
        validate={(raw) => {
          const check = validateVfsEntryName(raw);
          return check.ok ? null : check.reason;
        }}
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
            ? characterCardImportConfirmMessage(workspaceConfirm.directoryPath)
            : ''
        }
        danger
        onConfirm={handleWorkspaceConfirm}
        onCancel={() => setWorkspaceConfirm(null)}
      />

      <ConfirmModal
        open={workspaceConfirm?.kind === 'ingest-file'}
        title="覆盖确认"
        message={
          workspaceConfirm?.kind === 'ingest-file'
            ? batchIngestOverwriteMessage(workspaceConfirm.conflictCount)
            : ''
        }
        confirmLabel="覆盖"
        danger
        busy={ingestFileBusy}
        onConfirm={handleIngestFileConfirm}
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

      <ImportFormModal
        open={importFormTarget != null}
        target={importFormTarget}
        projectId={projectId}
        sessionId={workspaceSessionId}
        onClose={() => setImportFormTarget(null)}
        onSelect={(form) => {
          const target = importFormTarget;
          setImportFormTarget(null);
          if (!target) {
            return;
          }
          void handleImportFormSelect(target, form);
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
