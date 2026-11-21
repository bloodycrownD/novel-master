import { useCallback, useEffect, useRef, useState } from "react";
import { coreT } from "@shared/logic/core-i18n";
import { Text } from "@shared/logic/common";
export { AgentEditorView } from "./AgentEditorView";

export { ModelSamplingView } from "./ModelSamplingView";
import { AddModelModal } from "./AddModelModal";
import { FetchModelsModal } from "./FetchModelsModal";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import { BatchCheckbox } from "@/components/batch/BatchCheckbox";
import { ManageHeader } from "@/components/batch/ManageHeader";
import { TextPromptModal } from "@/components/ui/TextPromptModal";
import { showToast } from "@/components/ui/show-toast";
import { toastSettingsError } from "@/utils/settings-feedback";
import { toastSettingsSuccess } from "@/utils/settings-feedback";
import { AppError, Result } from "@shared/logic/errors";
// 取消终态判定与调用方同源（invoke-registry）：IPC_ABORTED 不弹错误 toast。
import { isIpcAborted } from "@/ipc/client";
import { handleMultilineSubmitKeyDown } from "@/utils/textarea-enter-shortcuts";
import { useBatchSelection } from "@/hooks/useBatchSelection";
import { useNovelMaster } from "@/providers/NovelMasterProvider";
import { settingsTranslator } from "@/i18n/settings";
import {
  ipcAgentRegistryCreateBlank,
  ipcAgentRegistryDelete,
  ipcAgentRegistryGet,
  ipcAgentRegistryList,
  ipcAgentRegistryUpdate,
  ipcAgentRegistryUpsert,
  ipcAgentResolveCurrent,
  ipcAgentSetCurrent,
  ipcAgentYamlExport,
  ipcAgentYamlImport,
  ipcBackupExport,
  ipcBackupImport,
  ipcDbMaintenance,
  ipcDbStats,
  ipcCloudSyncGetConfig,
  ipcCloudSyncGetLocalStatus,
  ipcCloudSyncPull,
  ipcCloudSyncPush,
  ipcCloudSyncSetConfig,
  ipcCloudSyncSetEnabled,
  ipcCloudSyncTestConnection,
  ipcProviderModelsDeleteSaved,
  ipcProviderModelsEditSaved,
  ipcProviderModelsSavedList,
  ipcProviderModelsSave,
  ipcProvidersCreate,
  ipcProvidersDelete,
  ipcProvidersEdit,
  ipcProvidersGet,
  ipcProvidersList,
  ipcRunAbort,
  ipcSmartSortRuleCreate,
  ipcSmartSortRuleDelete,
  ipcSmartSortRuleDeleteBatch,
  ipcSmartSortRuleList,
  ipcSmartSortRuleMove,
  ipcSmartSortRuleMatch,
  ipcSmartSortRuleReorder,
  ipcSmartSortRuleResetDefaults,
  ipcSmartSortRuleSetEnabled,
  ipcSmartSortRuleSetEnabledBatch,
  ipcSmartSortRuleUpdate,
  ipcSmartSortRuleYamlExport,
  ipcSmartSortRuleYamlImport,
} from "@/ipc/client";
import { PatternInput } from "@shared/logic/smart-sort";
import { SmartSortHighlight } from "@shared/logic/smart-sort";
import { agentModeMatchesTab } from "@shared/config-forms/agent";
import type { AgentSettingsTab } from "@shared/config-forms/agent";
import { DEFAULT_SUBAGENT_DEFINITION } from "@shared/logic/agent";
import type { SettingsNavHandle } from "./settings-nav";
import {
  SettingsActionSection,
  SettingsField,
  SettingsFormSection,
  SettingsSection,
  SettingsStatus,
  SettingsSwitchRow,
  SettingsListEmpty,
  SettingsListItem,
  SettingsListSection,
  ApiKeyStatusTag,
  SettingsPanel,
} from "./settings-ui";
import { AGENT_LIST_LABELS } from "@shared/logic/stored-config-validity";
import { storedConfigInvalidReason as invalidReason } from "@shared/logic/stored-config-validity";
import type {
  AgentRegistryListItemDto,
  DbStatsResult,
  SmartSortCaptureKindDto,
  SmartSortRuleDto,
  SmartSortRuleMatchResultDto,
  SmartSortRuleMoveRequest,
} from "@shared/ipc-types";

type Nav = SettingsNavHandle;

type LongTaskName = "export" | "import" | "pull" | "push" | "maintenance";

type CloudSyncStatusState = {
  configured: boolean;
  lastSyncedRev: number;
  remoteRev?: number;
  lastPullAt?: string;
  lastPushAt?: string;
  lastPullResult?: string;
  lastPushResult?: string;
  suggestsPull: boolean;
  syncBusy: boolean;
  agentActive: boolean;
  maintenanceBusy: boolean;
};

/** 库体积/可回收量展示用的人类可读格式；无效值回退占位 '—'。 */
function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  const oneDecimal = Math.round(value * 10) / 10;
  const rounded = value >= 100 ? Math.round(value) : oneDecimal;
  return `${rounded} ${units[unit]}`;
}

/**
 * 存量数据迁移卡片（三行进度：版本内容/文件缓存去 base64 + 历史版本打包）
 * 已随第七轮退役整卡移除（v1.5.41：两个后台搬运任务退役，状态行与取值
 * 模块一并删除）。
 */

export function DataManagementView() {
  const { retry } = useNovelMaster();
  const [busy, setBusy] = useState(false);
  const [confirmImport, setConfirmImport] = useState(false);

  const [endpoint, setEndpoint] = useState("");
  const [bucket, setBucket] = useState("");
  const [region, setRegion] = useState("");
  const [pathPrefix, setPathPrefix] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [forcePathStyle, setForcePathStyle] = useState(true);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [hasSecretKey, setHasSecretKey] = useState(false);
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [status, setStatus] = useState<CloudSyncStatusState | null>(null);
  const [confirmPull, setConfirmPull] = useState(false);
  const [confirmPushOverwrite, setConfirmPushOverwrite] = useState(false);
  const [dbStats, setDbStats] = useState<DbStatsResult | null>(null);
  const [confirmMaintenance, setConfirmMaintenance] = useState(false);
  // 长任务取消态：activeLongTask 标记当前流程，activeRunId 是 renderer 生成并随
  // IPC 下发的 runId；cancelRequested 只用于禁用重复点击，不改变流程终态。
  const [activeLongTask, setActiveLongTask] = useState<LongTaskName | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);

  // nm-style: keep-local — useCallback 回调带 deps 且函数体多语句；prettier 强制展开，单行化会改语义
  const reloadStatus = useCallback(async () => {
    const res = await ipcCloudSyncGetLocalStatus();
    if (res.ok) {
      setStatus(res.data);
    }
  }, []);

  /** 拉取库体积与可回收量；失败保持占位 '—'（静默，不打扰用户）。 */
  // nm-style: keep-local — useCallback 回调带 deps 且函数体多语句；prettier 强制展开，单行化会改语义
  const reloadDbStats = useCallback(async () => {
    try {
      const res = await ipcDbStats();
      if (res.ok) {
        setDbStats(res.data);
      }
    } catch {
      // 统计失败时保留上次值或占位展示
    }
  }, []);

  // nm-style: keep-local — useCallback 回调带 deps 且函数体多语句；prettier 强制展开，单行化会改语义
  const reloadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const res = await ipcCloudSyncGetConfig();
      if (res.ok) {
        setEndpoint(res.data.endpoint);
        setBucket(res.data.bucket);
        setRegion(res.data.region);
        setPathPrefix(res.data.pathPrefix);
        setAccessKeyId(res.data.accessKeyId);
        setForcePathStyle(res.data.forcePathStyle);
        setDeviceLabel(res.data.deviceLabel);
        setHasSecretKey(res.data.hasSecretKey);
        setCloudSyncEnabled(res.data.enabled);
        setSecretAccessKey("");
      }
    } finally {
      setConfigLoading(false);
    }
  }, []);

  // nm-style: keep-local — effect 回调带 deps 且函数体多语句；prettier 强制展开，单行化会改语义
  useEffect(() => {
    void reloadConfig();
    void reloadStatus();
    void reloadDbStats();
  }, [reloadConfig, reloadStatus, reloadDbStats]);

  /** 轮询同步状态与库体积，使 Agent 运行中等标志与 main 进程一致 */
  // nm-style: keep-local — effect 回调带 deps 且函数体多语句；prettier 强制展开，单行化会改语义
  useEffect(() => {
    const timer = window.setInterval(() => {
      void reloadStatus();
      void reloadDbStats();
    }, 2000);
    return () => {
      window.clearInterval(timer);
    };
  }, [reloadStatus, reloadDbStats]);

  const busyFlags = [
    status?.syncBusy,
    status?.agentActive,
    status?.maintenanceBusy,
  ];
  const controlsDisabled = busy || busyFlags.some((flag) => flag === true);

  const configPayload = () => ({
    endpoint: endpoint.trim(),
    bucket: bucket.trim(),
    region: region.trim(),
    pathPrefix: pathPrefix.trim(),
    accessKeyId: accessKeyId.trim(),
    secretAccessKey: secretAccessKey.trim() || undefined,
    forcePathStyle,
    deviceLabel: deviceLabel.trim() || undefined,
  });

  // nm-style: keep-local — 四个长任务共用同一取消态机，内联到各流程会重复三份状态写入
  const beginLongTask = (task: LongTaskName, runId: string) => {
    setActiveLongTask(task);
    setActiveRunId(runId);
    setCancelRequested(false);
  };
  const endLongTask = () => {
    setActiveLongTask(null);
    setActiveRunId(null);
    setCancelRequested(false);
  };
  // nm-style: keep-local — 取消目标映射含 maintenance 的显式 no-op 分支，内联进 JSX 会漏掉守卫
  const cancelLongTask = async () => {
    if (activeLongTask == null || activeLongTask === "maintenance" || cancelRequested) {
      return;
    }
    setCancelRequested(true);
    // backup 的 key 是 `backup:<runId>`；云同步的 key 在 main 侧固定 `sync:local`
    // （pull/push 全局互斥，S3 配置无 provider 概念），因此取消 id 用 "local"。
    const syncTask = activeLongTask === "pull" || activeLongTask === "push";
    const target = syncTask ? { kind: "sync" as const, id: "local" } : { kind: "backup" as const, id: activeRunId ?? "" };
    try {
      await ipcRunAbort(target);
    } catch {
      // IPC bridge 不可用时保持既有流程终态：取消不改变业务成功/失败语义。
    } finally {
      // 导出对话框期间 key 尚未登记，首次取消会是 main 侧静默 no-op；放开禁用
      // 让用户可在对话框 resolve 后再次取消真正的拷贝段。
      setCancelRequested(false);
    }
  };

  // nm-style: keep-local — 保存流程含状态机（busy/回读双接口），内联会拆散错误分支
  const saveConfig = async () => {
    setBusy(true);
    try {
      const res = await ipcCloudSyncSetConfig(configPayload());
      if (res.ok) {
        toastSettingsSuccess(coreT({key: "ui.cloud_sync.config_saved_desktop"}));
        setSecretAccessKey("");
        setCloudSyncEnabled(true);
        await reloadConfig();
        await reloadStatus();
      } else {
        toastSettingsError(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  // nm-style: keep-local — 开关持久化要先落 UI 再回读失败态，内联会拆散 busy/回读状态机
  const setCloudSyncEnabledPersisted = async (next: boolean) => {
    setCloudSyncEnabled(next);
    setBusy(true);
    try {
      const res = await ipcCloudSyncSetEnabled(next);
      if (res.ok) {
        await reloadStatus();
      } else {
        toastSettingsError(res.error.message);
        await reloadConfig();
      }
    } finally {
      setBusy(false);
    }
  };

  // nm-style: keep-local — 测试连接含保存失败短路与 busy 状态，内联会拆散错误分支
  const testConnection = async () => {
    setBusy(true);
    try {
      const saveRes = await ipcCloudSyncSetConfig(configPayload());
      if (!saveRes.ok) {
        toastSettingsError(saveRes.error.message);
        return;
      }
      const res = await ipcCloudSyncTestConnection();
      if (res.ok) {
        toastSettingsSuccess(coreT({key: "ui.cloud_sync.connected_done"}));
        await reloadConfig();
      } else {
        toastSettingsError(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  // nm-style: keep-local — 拉取含分支状态回读与 retry，内联进 JSX 会净增 >12 行
  const runPull = async () => {
    const runId = crypto.randomUUID();
    beginLongTask("pull", runId);
    setConfirmPull(false);
    setBusy(true);
    try {
      const res = await ipcCloudSyncPull();
      if (res.ok) {
        retry({ skipRebootstrap: true });
        toastSettingsSuccess(coreT({key: "ui.cloud_sync.pulled_done", params: {rev: res.data.rev}}));
        await reloadStatus();
      } else if (res.error.code === "CLOUD_SYNC_ALREADY_UP_TO_DATE") {
        showToast(res.error.message);
        await reloadStatus();
      } else if (!isIpcAborted(res)) {
        // 取消是用户主动行为：IPC_ABORTED 静默收尾，不弹错误 toast（spec Step 14）。
        toastSettingsError(res.error.message);
        await reloadStatus();
      }
    } finally {
      setBusy(false);
      endLongTask();
    }
  };

  const runPush = async (forceOverwriteRemote = false) => {
    const runId = crypto.randomUUID();
    beginLongTask("push", runId);
    setConfirmPushOverwrite(false);
    setBusy(true);
    try {
      const res = await ipcCloudSyncPush({ runId, ...(forceOverwriteRemote ? { forceOverwriteRemote } : {}) });
      if (res.ok) {
        toastSettingsSuccess(coreT({key: "ui.cloud_sync.pushed_done", params: {rev: res.data.rev}}));
        await reloadStatus();
      } else if (res.error.code === "CLOUD_SYNC_NEED_PULL_FIRST") {
        setConfirmPushOverwrite(true);
      } else {
        // 取消是用户主动行为：IPC_ABORTED 静默收尾，不弹错误 toast（spec Step 14）。
        if (!isIpcAborted(res)) toastSettingsError(res.error.message);
        await reloadStatus();
      }
    } finally {
      setBusy(false);
      endLongTask();
    }
  };

  // nm-style: keep-local — 导出流程含 busy 状态与取消分支，内联进 JSX 会净增 >12 行
  const runExport = async () => {
    const runId = crypto.randomUUID();
    beginLongTask("export", runId);
    setBusy(true);
    try {
      const res = await ipcBackupExport({ runId });
      if (res.ok) {
        const message = res.data === "saved" ? coreT({key: "ui.storage.export_db_done_desktop"}) : coreT({key: "ui.common.cancelled"});
        toastSettingsSuccess(message);
      } else if (!isIpcAborted(res)) {
        toastSettingsError(res.error.message);
      }
    } finally {
      setBusy(false);
      endLongTask();
    }
  };

  // nm-style: keep-local — 导入流程含确认态、retry 与双分支提示，内联进 JSX 会净增 >12 行
  const runImport = async () => {
    const runId = crypto.randomUUID();
    beginLongTask("import", runId);
    setConfirmImport(false);
    setBusy(true);
    try {
      const res = await ipcBackupImport({ runId });
      if (res.ok) {
        if (res.data === "imported") {
          retry({ skipRebootstrap: true });
          toastSettingsSuccess(coreT({key: "ui.storage.imported_done"}));
        } else {
          toastSettingsSuccess(coreT({key: "ui.common.cancelled"}));
        }
      } else if (!isIpcAborted(res)) {
        toastSettingsError(res.error.message);
      }
    } finally {
      setBusy(false);
      endLongTask();
    }
  };

  // nm-style: keep-local — 清理流程含 busy/回读与长文案拼接，内联进 JSX 会净增 >12 行
  const runMaintenance = async () => {
    const runId = crypto.randomUUID();
    beginLongTask("maintenance", runId);
    setConfirmMaintenance(false);
    // better-sqlite3 同步 VACUUM 会冻住 main 事件循环，期间轮询与事件
    // 推送全部挂起——busy 必须在 invoke 发起前置位，不能依赖 main 推送。
    setBusy(true);
    try {
      const res = await ipcDbMaintenance({ runId });
      if (res.ok) {
        const before = formatStorageBytes(res.data.beforeBytes);
        const after = formatStorageBytes(res.data.afterBytes);
        const summary = coreT({key: "ui.storage.cleanup_done", params: {before, after}});
        toastSettingsSuccess(summary);
        await reloadDbStats();
      } else if (!isIpcAborted(res)) {
        toastSettingsError(res.error.message);
      }
    } finally {
      setBusy(false);
      endLongTask();
    }
  };

  const syncLines = [
    coreT({key: "ui.cloud_sync.rev_cloud_line", params: {rev: String(status?.remoteRev ?? "—")}}),
    coreT({key: "ui.cloud_sync.rev_synced_line", params: {rev: status?.lastSyncedRev}}),
    status?.lastPullAt
      ? coreT({key: "ui.cloud_sync.last_pull_line", params: {time: new Date(status.lastPullAt).toLocaleString()}})
      : null,
    status?.lastPushAt
      ? coreT({key: "ui.cloud_sync.last_push_line", params: {time: new Date(status.lastPushAt).toLocaleString()}})
      : null,
    status?.lastPullResult ? coreT({key: "ui.cloud_sync.last_pull_result", params: {result: status.lastPullResult}}) : null,
    status?.lastPushResult ? coreT({key: "ui.cloud_sync.last_push_result", params: {result: status.lastPushResult}}) : null,
  ];
  const syncText = syncLines.filter(Boolean).join(" · ");

  return (
    <SettingsPanel>
      <SettingsFormSection
        title={coreT({key: "ui.nav.cloud_sync"})}
        desc={coreT({key: "ui.cloud_sync.desc"})}
      >
        <SettingsSwitchRow
          label={coreT({key: "ui.cloud_sync.enabled_toggle"})}
          checked={cloudSyncEnabled}
          onChange={(next) => {
            if (controlsDisabled || configLoading) {
              return;
            }
            void setCloudSyncEnabledPersisted(next);
          }}
        />
        {cloudSyncEnabled ? (
          <>
            <SettingsField label="Endpoint">
              <input
                value={endpoint}
                disabled={configLoading}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://s3.example.com"
              />
            </SettingsField>
            <SettingsField label="Bucket">
              <input
                value={bucket}
                disabled={configLoading}
                onChange={(e) => setBucket(e.target.value)}
              />
            </SettingsField>
            <div className="settings-field-grid">
              <SettingsField label="Region">
                <input
                  value={region}
                  disabled={configLoading}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder={coreT({key: "ui.cloud_sync.bucket_hint"})}
                />
              </SettingsField>
              <SettingsField label={coreT({key: "ui.cloud_sync.prefix_label"})}>
                <input
                  value={pathPrefix}
                  disabled={configLoading}
                  onChange={(e) => setPathPrefix(e.target.value)}
                  placeholder="novel-master/sync/"
                />
              </SettingsField>
            </div>
            <SettingsField label="Access Key ID">
              <input
                value={accessKeyId}
                disabled={configLoading}
                onChange={(e) => setAccessKeyId(e.target.value)}
              />
            </SettingsField>
            <SettingsField
              label={
                hasSecretKey
                  ? "Secret Access Key（留空则不修改）"
                  : "Secret Access Key"
              }
            >
              <input
                type="password"
                value={secretAccessKey}
                disabled={configLoading}
                onChange={(e) => setSecretAccessKey(e.target.value)}
              />
            </SettingsField>
            <SettingsField label={coreT({key: "ui.cloud_sync.device_label"})}>
              <input
                value={deviceLabel}
                disabled={configLoading}
                onChange={(e) => setDeviceLabel(e.target.value)}
              />
            </SettingsField>
            <SettingsSwitchRow
              label="Path style（MinIO / 部分 OSS）"
              checked={forcePathStyle}
              onChange={setForcePathStyle}
            />
            <div className="settings-form-actions settings-form-actions--solo">
              <Button
                variant="secondary"
                disabled={controlsDisabled || configLoading}
                onClick={() => void testConnection()}
              >
                {coreT({key: "ui.cloud_sync.test_connection"})}
              </Button>
              <Button
                variant="primary"
                disabled={controlsDisabled || configLoading}
                onClick={() => void saveConfig()}
              >
                {coreT({key: "ui.cloud_sync.save_config"})}
              </Button>
            </div>

            <div className="config-block-card config-block-card--sync">
              <div className="config-block-card__header">
                <span className="config-block-card__section-label">
                  {coreT({key: "ui.cloud_sync.sync_status"})}
                </span>
              </div>
              <div className="config-block-card__body">
                <p className="config-block-card__hint config-block-card__hint--subtle">
                  {status?.agentActive
                    ? coreT({key: "ui.cloud_sync.agent_active_note"})
                    : coreT({key: "ui.cloud_sync.status_desc_desktop"})}
                </p>
                {status?.suggestsPull ? (
                  <SettingsStatus
                    error={coreT({key: "ui.cloud_sync.cloud_newer_hint"})}
                    inline
                  />
                ) : null}
                <SettingsStatus
                  message={status == null ? coreT({key: "ui.common.loading"}) : syncText}
                />
                <div className="settings-form-actions settings-form-actions--solo">
                  <Button
                    variant="secondary"
                    disabled={controlsDisabled || !status?.configured}
                    onClick={() => setConfirmPull(true)}
                  >
                    {coreT({key: "ui.cloud_sync.pull_title"})}
                  </Button>
                  {activeLongTask === "pull" ? (
                    <Button
                      variant="secondary"
                      className="settings-long-task-cancel"
                      disabled={cancelRequested}
                      onClick={() => void cancelLongTask()}
                    >
                      {settingsTranslator({ key: "settings.long_task.cancel" })}
                    </Button>
                  ) : null}
                  <Button
                    variant="primary"
                    disabled={controlsDisabled || !status?.configured}
                    onClick={() => void runPush()}
                  >
                    {coreT({key: "ui.cloud_sync.push_title"})}
                  </Button>
                  {activeLongTask === "push" ? (
                    <Button
                      variant="secondary"
                      className="settings-long-task-cancel"
                      disabled={cancelRequested}
                      onClick={() => void cancelLongTask()}
                    >
                      {settingsTranslator({ key: "settings.long_task.cancel" })}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </SettingsFormSection>

      <SettingsActionSection
        title={coreT({key: "ui.common.export"})}
        desc={coreT({key: "ui.storage.export_desc"})}
        action={
          <div className="settings-form-actions settings-form-actions--solo">
            <Button
              variant="primary"
              disabled={controlsDisabled}
              onClick={() => void runExport()}
            >
              {coreT({key: "ui.storage.export_db"})}
            </Button>
            {activeLongTask === "export" ? (
              <Button
                variant="secondary"
                className="settings-long-task-cancel"
                disabled={cancelRequested}
                onClick={() => void cancelLongTask()}
              >
                {settingsTranslator({ key: "settings.long_task.cancel" })}
              </Button>
            ) : null}
          </div>
        }
      />
      <SettingsActionSection
        title={coreT({key: "ui.common.import"})}
        desc={coreT({key: "ui.storage.import_desc_desktop"})}
        action={
          <div className="settings-form-actions settings-form-actions--solo">
            <Button
              variant="primary"
              disabled={controlsDisabled}
              onClick={() => setConfirmImport(true)}
            >
              {coreT({key: "ui.storage.import_db"})}
            </Button>
            {activeLongTask === "import" ? (
              <Button
                variant="secondary"
                className="settings-long-task-cancel"
                disabled={cancelRequested}
                onClick={() => void cancelLongTask()}
              >
                {settingsTranslator({ key: "settings.long_task.cancel" })}
              </Button>
            ) : null}
          </div>
        }
      />
      <SettingsActionSection
        title="数据清理"
        // desc 模板串与清理确认 message 被 settings-db-maintenance-ui.test.ts 源码正则锁死，波 3c 对齐后再迁。
        desc={`回收缓存冗余与空闲页并压缩数据库文件。当前库体积 ${
          dbStats ? formatStorageBytes(dbStats.fileBytes) : "—"
        } · 可回收约 ${
          dbStats ? formatStorageBytes(dbStats.reclaimableBytes) : "—"
        }。`}
        action={
          <div className="settings-form-actions settings-form-actions--solo">
            <Button
              variant="primary"
              disabled={controlsDisabled}
              onClick={() => setConfirmMaintenance(true)}
            >
              清理
            </Button>
            {activeLongTask === "maintenance" ? (
              <>
                <Button
                  variant="secondary"
                  className="settings-long-task-cancel"
                  disabled
                >
                  {settingsTranslator({ key: "settings.long_task.cancel" })}
                </Button>
                <span className="settings-long-task-hint">
                  {settingsTranslator({ key: "settings.long_task.maintenance_uninterruptible" })}
                </span>
              </>
            ) : null}
          </div>
        }
      />

      <ConfirmModal
        open={confirmPull}
        title="确认拉取"
        message="拉取将用云端快照替换本机数据库（本机服务商与 API Key 将保留）。确定继续？"
        danger
        busy={busy}
        onConfirm={() => void runPull()}
        onCancel={() => !busy && setConfirmPull(false)}
      />
      <ConfirmModal
        open={confirmPushOverwrite}
        title="云端较新"
        message="云端有尚未拉取的更新。可先拉取合并，或仍要覆盖云端（将丢失云端未拉取的变更）。"
        confirmLabel={coreT({key: "ui.cloud_sync.force_overwrite"})}
        cancelLabel={coreT({key: "ui.cloud_sync.pull_first"})}
        danger
        busy={busy}
        onConfirm={() => void runPush(true)}
        onCancel={() => {
          if (busy) {
            return;
          }
          setConfirmPushOverwrite(false);
          setConfirmPull(true);
        }}
      />
      <ConfirmModal
        open={confirmImport}
        title={coreT({key: "ui.storage.import_confirm_title_desktop"})}
        message={coreT({key: "ui.storage.import_confirm_desktop"})}
        danger
        busy={busy}
        onConfirm={() => void runImport()}
        onCancel={() => !busy && setConfirmImport(false)}
      />
      <ConfirmModal
        open={confirmMaintenance}
        title="确认清理"
        message="清理将回收缓存冗余并压缩数据库文件，耗时随库体积增长（大库可能数十秒），期间应用可能短暂无响应；完成后磁盘占用通常会下降。确定继续？"
        busy={busy}
        onConfirm={() => void runMaintenance()}
        onCancel={() => !busy && setConfirmMaintenance(false)}
      />
    </SettingsPanel>
  );
}

/** 内置 general 合成行 sentinel（真实 agent id 均为 `agent-<ts>` 格式，不冲突）。 */
const GENERAL_AGENT_ID = "general";

type AgentMenuState = { agentId: string; x: number; y: number } | null;
type AgentRenameState = { agentId: string; initialName: string } | null;
type AgentDeleteState =
  | { kind: "single"; agentId: string; name: string }
  | { kind: "batch"; count: number }
  | null;

export function AgentsSettingsView({ nav }: { nav: Nav }) {
  const batch = useBatchSelection();
  const [tab, setTab] = useState<AgentSettingsTab>("primary");
  const [rows, setRows] = useState<AgentRegistryListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentMenu, setAgentMenu] = useState<AgentMenuState>(null);
  const [renamePrompt, setRenamePrompt] = useState<AgentRenameState>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<AgentDeleteState>(null);

  // nm-style: keep-local — useCallback 回调带 deps 且函数体多语句；prettier 强制展开，单行化会改语义
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ipcAgentRegistryList();
      if (res.ok) setRows([...res.data]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void reload().catch(() => undefined), [reload]);

  const openAgentEditor = (agentId: string, displayName?: string) => {
    nav.navState.editingAgentId = agentId;
    nav.navState.editingAgentDisplayName = displayName;
    nav.setAgentEditorTitle?.(displayName);
    nav.push("agentEditor");
  };

  // nm-style: keep-local — 菜单分发是 52 行多分支状态机，内联会拆散菜单生命周期
  const handleAgentMenuSelect = async (action: string) => {
    const menu = agentMenu;
    setAgentMenu(null);
    if (!menu) {
      return;
    }
    // 内置 general 合成行：菜单仅「查看」，不走库表 CRUD。
    if (menu.agentId === GENERAL_AGENT_ID) {
      if (action === "view") {
        openAgentEditor(GENERAL_AGENT_ID, DEFAULT_SUBAGENT_DEFINITION.name);
      }
      return;
    }
    const row = rows.find((r) => r.agentId === menu.agentId);
    if (!row) {
      return;
    }
    if (action === "rename") {
      setRenamePrompt({ agentId: row.agentId, initialName: row.name });
      return;
    }
    if (action === "duplicate") {
      const getRes = await ipcAgentRegistryGet({ agentId: row.agentId });
      if (!getRes.ok) {
        toastSettingsError(getRes.error.message);
        return;
      }
      if (getRes.data.status !== "valid") {
        toastSettingsError("配置已失效，请先修复后再复制");
        return;
      }
      const copyId = `agent-${Date.now()}`;
      const def = getRes.data.value;
      const copyName = `${def.name ?? row.name}-copy`;
      const args = { agentId: copyId, definition: { ...def, name: copyName } };
      const saveRes = await ipcAgentRegistryUpsert(args);
      if (saveRes.ok) {
        openAgentEditor(copyId, copyName);
        await reload();
      }
      return;
    }
    if (action === "delete") {
      setDeleteConfirm({
        kind: "single",
        agentId: row.agentId,
        name: row.name,
      });
      return;
    }
    if (action === "edit") {
      openAgentEditor(row.agentId, row.name);
    }
  };

  const confirmDeleteAgents = async (agentIds: readonly string[]) => {
    const currentRes = await ipcAgentResolveCurrent();
    for (const agentId of agentIds) {
      const res = await ipcAgentRegistryDelete({ agentId });
      if (!res.ok) {
        toastSettingsError(res.error.message);
        return;
      }
    }
    if (
      currentRes.ok &&
      currentRes.data.agentId &&
      agentIds.includes(currentRes.data.agentId)
    ) {
      // 兜底切当前排除内置 general 合成行（rows 数据源本就不含它，双保险）。
      const remaining = rows
        .map((r) => r.agentId)
        .filter((id) => !agentIds.includes(id) && id !== GENERAL_AGENT_ID);
      if (remaining.length > 0) {
        await ipcAgentSetCurrent({ agentId: remaining[0]! });
      }
    }
    batch.exit();
    const count = agentIds.length;
    // 「已删除 {count} 个 Agent」键面无此键（漏键待波 3c），批量分支保留原字面量。
    const message = count > 1 ? `已删除 ${count} 个 Agent` : coreT({key: "ui.agent.deleted_done"});
    toastSettingsSuccess(message);
    await reload();
  };

  const handleRename = async (name: string) => {
    const prompt = renamePrompt;
    setRenamePrompt(null);
    if (!prompt) {
      return;
    }
    const getRes = await ipcAgentRegistryGet({ agentId: prompt.agentId });
    if (!getRes.ok) {
      toastSettingsError(getRes.error.message);
      return;
    }
    if (getRes.data.status !== "valid") {
      toastSettingsError("配置已失效，请先修复后再重命名");
      return;
    }
    await ipcAgentRegistryUpdate({
      agentId: prompt.agentId,
      patch: { name },
    });
    await reload();
  };

  // 前端过滤：mode 缺省（含 invalid 行）按 all 双边显示，口径收口 core。
  const visibleRows = rows.filter((row) => agentModeMatchesTab(row.mode, tab));
  // 子 tab 头部合成内置 general 只读行，不参与批量勾选与删除。
  const showGeneralRow = tab === "subagent";
  const generalName = DEFAULT_SUBAGENT_DEFINITION.name;

  return (
    <SettingsPanel>
      <div className="agents-manage__tabs">
        <SegmentedControl
          aria-label="智能体作用域"
          value={tab}
          options={[
            { value: "primary", label: coreT({key: "ui.agent.primary_tab"}) },
            { value: "subagent", label: coreT({key: "ui.agent.subagent_tab"}) },
          ]}
          onChange={(next) => {
            setTab(next as AgentSettingsTab);
            batch.exit();
          }}
        />
      </div>
      <ManageHeader
        title={tab === "primary" ? coreT({key: "ui.agent.primary_tab"}) : coreT({key: "ui.agent.subagent_tab"})}
        batchMode={batch.active}
        selectedCount={batch.selectedCount}
        onEnterBatch={batch.enter}
        onCancelBatch={batch.exit}
        onDelete={() => {
          if (batch.selectedCount === 0) {
            return;
          }
          setDeleteConfirm({ kind: "batch", count: batch.selectedCount });
        }}
        hint={
          tab === "primary"
            ? "主智能体直接响应用户消息；作用域为「全部」的智能体双 tab 均显示。"
            : "子智能体由主智能体委派调用；内置 general 为通用兜底，不可编辑。"
        }
        normalActions={
          <button
            type="button"
            className="list-manage-header__btn list-manage-header__btn--primary"
            onClick={async () => {
              // 新建默认作用域随 tab 落库：主 tab → primary、子 tab → subagent。
              const mode = tab === "primary" ? "primary" : "subagent";
              const res = await ipcAgentRegistryCreateBlank({ mode });
              if (res.ok) {
                openAgentEditor(res.data.agentId);
                await reload();
              }
            }}
          >
            新建 Agent
          </button>
        }
      />
      <SettingsListSection>
        {loading ? <SettingsListEmpty>{coreT({key: "ui.common.loading"})}</SettingsListEmpty> : null}
        {!loading && visibleRows.length === 0 && !showGeneralRow ? (
          <SettingsListEmpty>
            {tab === "primary"
              ? "暂无主智能体，点击上方按钮创建。"
              : "暂无子智能体，点击上方按钮创建。"}
          </SettingsListEmpty>
        ) : null}
        {showGeneralRow ? (
          <SettingsListItem
            title={generalName}
            meta={
              <span className="settings-list-item__meta-row">
                <span className="settings-tag settings-tag--primary">{coreT({key: "ui.common.builtin"})}</span>
                {/* 双端文案对齐：mobile AgentList 合成行同款 */}
                <span>{coreT({key: "ui.agent.general_note"})}</span>
              </span>
            }
            onClick={() => openAgentEditor(GENERAL_AGENT_ID, generalName)}
            onMenu={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setAgentMenu({
                agentId: GENERAL_AGENT_ID,
                x: Math.max(8, rect.left),
                y: Math.max(8, rect.bottom + 4),
              });
            }}
          />
        ) : null}
        {visibleRows.map((row) => (
          <SettingsListItem
            key={row.agentId}
            title={row.name}
            meta={
              row.invalid != null ? (
                <span className="settings-list-item__meta-row">
                  <span className="settings-tag settings-tag--warn">
                    {AGENT_LIST_LABELS.configInvalid}
                  </span>
                  {row.mode == null || row.mode === "all" ? (
                    <span className="settings-tag settings-tag--muted">
                      {coreT({key: "ui.common.all"})}
                    </span>
                  ) : null}
                  <span
                    className="settings-list-item__meta-error"
                    title={row.invalid.message}
                  >
                    {Text.truncate(invalidReason(row.invalid.code), 80)}
                  </span>
                </span>
              ) : row.mode == null || row.mode === "all" ? (
                <span className="settings-tag settings-tag--muted">{coreT({key: "ui.common.all"})}</span>
              ) : undefined
            }
            batchMode={batch.active}
            selected={batch.isSelected(row.agentId)}
            onToggleSelect={() => batch.toggle(row.agentId)}
            onClick={() => {
              openAgentEditor(row.agentId, row.name);
            }}
            onMenu={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setAgentMenu({
                agentId: row.agentId,
                x: Math.max(8, rect.left),
                y: Math.max(8, rect.bottom + 4),
              });
            }}
          />
        ))}
      </SettingsListSection>
      <ContextMenu
        open={agentMenu != null}
        x={agentMenu?.x ?? 0}
        y={agentMenu?.y ?? 0}
        items={
          agentMenu?.agentId === GENERAL_AGENT_ID
            ? [{ label: coreT({key: "ui.common.view"}), action: "view" }]
            : [
                { label: coreT({key: "ui.common.edit"}), action: "edit" },
                { label: coreT({key: "ui.common.rename"}), action: "rename" },
                { label: coreT({key: "ui.common.copy"}), action: "duplicate" },
                { label: coreT({key: "ui.common.delete"}), action: "delete", danger: true },
              ]
        }
        onSelect={(action) => void handleAgentMenuSelect(action)}
        onClose={() => setAgentMenu(null)}
      />
      <TextPromptModal
        open={renamePrompt != null}
        title={coreT({key: "ui.agent.rename_title"})}
        initialValue={renamePrompt?.initialName ?? ""}
        onClose={() => setRenamePrompt(null)}
        onConfirm={handleRename}
      />
      <ConfirmModal
        open={deleteConfirm != null}
        title={coreT({key: "ui.agent.delete_agent_title"})}
        message={
          deleteConfirm?.kind === "batch"
            ? coreT({key: "ui.agent.delete_agents_confirm_msg", params: {count: deleteConfirm.count}})
            : `删除 Agent「${
                deleteConfirm?.kind === "single" ? deleteConfirm.name : ""
              }」？`
        }
        danger
        onConfirm={async () => {
          const target = deleteConfirm;
          setDeleteConfirm(null);
          if (!target) {
            return;
          }
          if (target.kind === "batch") {
            await confirmDeleteAgents([...batch.selectedIds]);
            return;
          }
          await confirmDeleteAgents([target.agentId]);
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </SettingsPanel>
  );
}

type ProviderRow = {
  id: string;
  displayName: string;
  savedCount: number;
  apiKeyStatus: string;
};
type ProviderMenuState = { providerId: string; x: number; y: number } | null;
type ProviderRenameState = { providerId: string; initialName: string } | null;
type ProviderDeleteState =
  | { kind: "single"; providerId: string; label: string }
  | { kind: "batch"; count: number }
  | null;

export function ProvidersView({ nav }: { nav: Nav }) {
  const batch = useBatchSelection();
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [providerMenu, setProviderMenu] = useState<ProviderMenuState>(null);
  const [renamePrompt, setRenamePrompt] = useState<ProviderRenameState>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ProviderDeleteState>(null);

  // nm-style: keep-local — useCallback 回调带 deps 且函数体多语句；prettier 强制展开，单行化会改语义
  const reload = useCallback(async () => {
    const res = await ipcProvidersList();
    if (res.ok) setRows([...res.data]);
  }, []);

  useEffect(() => void reload().catch(() => undefined), [reload]);

  const deleteProviders = async (providerIds: readonly string[]) => {
    for (const providerId of providerIds) {
      const res = await ipcProvidersDelete({ providerId });
      if (!res.ok) {
        toastSettingsError(res.error.message);
        return;
      }
    }
    batch.exit();
    const count = providerIds.length;
    const message = count > 1 ? coreT({key: "ui.provider.deleted_count_done", params: {count}}) : coreT({key: "ui.provider.deleted_done"});
    toastSettingsSuccess(message);
    await reload();
  };

  // nm-style: keep-local — 菜单分发是 25 行多分支状态机，内联会拆散菜单生命周期
  const handleProviderMenuSelect = (action: string) => {
    const menu = providerMenu;
    setProviderMenu(null);
    if (!menu) {
      return;
    }
    const row = rows.find((r) => r.id === menu.providerId);
    if (!row) {
      return;
    }
    if (action === "rename") {
      setRenamePrompt({
        providerId: row.id,
        initialName: row.displayName,
      });
      return;
    }
    if (action === "delete") {
      setDeleteConfirm({
        kind: "single",
        providerId: row.id,
        label: row.displayName,
      });
    }
  };

  // nm-style: keep-local — 重命名含 prompt 快照与校验/回读流程，内联会拆散状态机
  const handleProviderRename = async (name: string) => {
    const prompt = renamePrompt;
    setRenamePrompt(null);
    if (!prompt) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      toastSettingsError("服务商名称不能为空");
      return;
    }
    const patch = { providerId: prompt.providerId, displayName: trimmed };
    const res = await ipcProvidersEdit(patch);
    if (!res.ok) {
      toastSettingsError(res.error.message);
      return;
    }
    await reload();
  };

  return (
    <SettingsPanel>
      <SettingsListSection
        header={
          <ManageHeader
            title={coreT({key: "ui.provider.title"})}
            batchMode={batch.active}
            selectedCount={batch.selectedCount}
            onEnterBatch={batch.enter}
            onCancelBatch={batch.exit}
            onDelete={() => {
              if (batch.selectedCount === 0) {
                return;
              }
              setDeleteConfirm({ kind: "batch", count: batch.selectedCount });
            }}
            hint={coreT({key: "ui.provider.delete_select_title"})}
            normalActions={
              <button
                type="button"
                className="list-manage-header__btn list-manage-header__btn--primary"
                onClick={() => {
                  nav.navState.editingProviderId = undefined;
                  nav.push("providerCreate");
                }}
              >
                新建服务商
              </button>
            }
          />
        }
      >
        {rows.length === 0 ? (
          <SettingsListEmpty>{coreT({key: "ui.provider.empty_hint_desktop"})}</SettingsListEmpty>
        ) : null}
        {rows.map((p) => (
          <SettingsListItem
            key={p.id}
            title={p.displayName}
            meta={
              <>
                {coreT({key: "ui.provider.models_meta", params: {count: p.savedCount}})}
                <ApiKeyStatusTag status={p.apiKeyStatus} />
              </>
            }
            batchMode={batch.active}
            selected={batch.isSelected(p.id)}
            onToggleSelect={() => batch.toggle(p.id)}
            onClick={() => {
              nav.navState.editingProviderId = p.id;
              nav.push("providerDetail");
            }}
            onMenu={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setProviderMenu({
                providerId: p.id,
                x: Math.max(8, rect.left),
                y: Math.max(8, rect.bottom + 4),
              });
            }}
          />
        ))}
      </SettingsListSection>
      <ContextMenu
        open={providerMenu != null}
        x={providerMenu?.x ?? 0}
        y={providerMenu?.y ?? 0}
        items={[
          { label: coreT({key: "ui.common.rename"}), action: "rename" },
          { label: coreT({key: "ui.common.delete"}), action: "delete", danger: true },
        ]}
        onSelect={(action) => handleProviderMenuSelect(action)}
        onClose={() => setProviderMenu(null)}
      />
      <TextPromptModal
        open={renamePrompt != null}
        title="重命名服务商"
        initialValue={renamePrompt?.initialName ?? ""}
        onClose={() => setRenamePrompt(null)}
        onConfirm={handleProviderRename}
      />
      <ConfirmModal
        open={deleteConfirm != null}
        title={coreT({key: "ui.provider.delete_title"})}
        message={
          deleteConfirm?.kind === "batch"
            ? coreT({key: "ui.provider.delete_batch_confirm", params: {count: deleteConfirm.count}})
            : `删除服务商「${
                deleteConfirm?.kind === "single" ? deleteConfirm.label : ""
              }」？`
        }
        danger
        onConfirm={() => {
          const target = deleteConfirm;
          setDeleteConfirm(null);
          if (!target) {
            return;
          }
          if (target.kind === "batch") {
            void deleteProviders([...batch.selectedIds]);
            return;
          }
          void deleteProviders([target.providerId]);
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </SettingsPanel>
  );
}

type ProviderProtocol = "openai" | "anthropic" | "gemini";

export function ProviderFormView({
  nav,
  mode,
}: {
  nav: Nav;
  mode: "create" | "edit";
}) {
  const providerId = nav.navState.editingProviderId;
  const [protocol, setProtocol] = useState<ProviderProtocol>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [headersJson, setHeadersJson] = useState("");
  const [bodyParamsJson, setBodyParamsJson] = useState("");
  const [isBuiltin, setIsBuiltin] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState("not set");

  // nm-style: keep-local — effect 回调带 deps 且函数体多语句；prettier 强制展开，单行化会改语义
  useEffect(() => {
    if (mode !== "edit" || !providerId) return;
    ipcProvidersGet({ providerId }).then((res) => {
      if (!res.ok) return;
      setProtocol(res.data.protocol as typeof protocol);
      setBaseUrl(res.data.baseUrl);
      setDisplayName(res.data.displayName);
      setIsBuiltin(res.data.isBuiltin);
      setApiKeyStatus(res.data.apiKeyStatus);
      const headers = res.data.headers;
      const hasHeaders = Object.keys(headers).length > 0;
      const headersText = hasHeaders ? JSON.stringify(headers, null, 2) : "";
      setHeadersJson(headersText);
      const body = res.data.bodyParams ?? {};
      const hasBody = Object.keys(body).length > 0;
      const bodyText = hasBody ? JSON.stringify(body, null, 2) : "";
      setBodyParamsJson(bodyText);
    });
  }, [mode, providerId]);

  const submit = async () => {
    try {
      // 自定义参数：必须是 JSON 对象（值任意 JSON）；校验失败本地提前 return + toast
      // （p27 R1：不再 throw 穿外层 catch——INFRA_VALIDATION_FAILED 同款码，UI toast 收口不静默）。
      const parseBodyParams = (raw: string): Result<Record<string, unknown> | undefined, AppError> => {
        const trimmed = raw.trim();
        if (!trimmed) return Result.ok(undefined);
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: "自定义参数必须是 JSON 对象" }));
        }
        return Result.ok(parsed as Record<string, unknown>);
      };
      if (mode === "create") {
        const name = displayName.trim();
        if (!name) {
          toastSettingsError("请填写服务商名称");
          return;
        }
        const body = parseBodyParams(bodyParamsJson);
        if (!body.ok) {
          toastSettingsError(body.error.message);
          return;
        }
        const payload = {
          protocol,
          baseUrl: baseUrl.trim(),
          displayName: name,
          apiKey: apiKey.trim(),
          headers: headersJson.trim() ? JSON.parse(headersJson) : undefined,
          bodyParams: body.value,
        };
        const res = await ipcProvidersCreate(payload);
        if (!res.ok) {
          toastSettingsError(res.error.message);
          return;
        }
        nav.navState.editingProviderId = res.data.providerId;
        nav.push("providerDetail");
      } else if (providerId) {
        const name = displayName.trim();
        if (!name) {
          toastSettingsError("服务商名称不能为空");
          return;
        }
        const patch: Record<string, unknown> = {};
        if (baseUrl.trim()) patch.baseUrl = baseUrl.trim();
        patch.displayName = name;
        if (apiKey.trim()) patch.apiKey = apiKey.trim();
        if (headersJson.trim()) patch.headers = JSON.parse(headersJson);
        const body = parseBodyParams(bodyParamsJson);
        if (!body.ok) {
          toastSettingsError(body.error.message);
          return;
        }
        // 空文本保存 = 显式清空自定义参数（区别于 headers 的「空文本不修改」）
        patch.bodyParams = body.value ?? {};
        if (!isBuiltin) patch.protocol = protocol;
        const res = await ipcProvidersEdit({ providerId, ...patch });
        if (res.ok) {
          toastSettingsSuccess(coreT({key: "ui.common.saved"}));
        } else {
          toastSettingsError(res.error.message);
        }
      }
    } catch (e) {
      toastSettingsError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SettingsPanel>
      <SettingsFormSection
        title={mode === "create" ? "新建服务商" : coreT({key: "ui.provider.edit_title"})}
        desc={
          mode === "edit" ? (
            <>
              API Key 状态：
              <ApiKeyStatusTag status={apiKeyStatus} />
            </>
          ) : (
            "API Key 将通过 SKSP 安全存储"
          )
        }
        footer={
          <Button variant="primary" onClick={() => void submit()}>
            {mode === "create" ? coreT({key: "ui.common.create"}) : coreT({key: "ui.common.save"})}
          </Button>
        }
      >
        <SettingsField label={coreT({key: "ui.provider.protocol_label"})}>
          <select
            value={protocol}
            disabled={isBuiltin}
            onChange={(e) => setProtocol(e.target.value as typeof protocol)}
          >
            <option value="openai">openai</option>
            <option value="anthropic">anthropic</option>
            <option value="gemini">gemini</option>
          </select>
        </SettingsField>
        <SettingsField label="Base URL">
          {/* D-4：显式补 type="text"，供 e2e input[type="text"] 选择器稳定命中 */}
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </SettingsField>
        <SettingsField label={coreT({key: "ui.provider.name_label"})}>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </SettingsField>
        <SettingsField
          label={mode === "edit" ? "新 API Key（留空则不修改）" : "API Key"}
        >
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </SettingsField>
        <SettingsField label="Headers JSON">
          <textarea
            rows={4}
            value={headersJson}
            onChange={(e) => setHeadersJson(e.target.value)}
            onKeyDown={(e) => {
              handleMultilineSubmitKeyDown(e, () => void submit());
            }}
          />
        </SettingsField>
        <SettingsField label={coreT({key: "ui.provider.custom_params_hint_desktop"})}>
          <textarea
            rows={4}
            value={bodyParamsJson}
            onChange={(e) => setBodyParamsJson(e.target.value)}
            onKeyDown={(e) => {
              handleMultilineSubmitKeyDown(e, () => void submit());
            }}
            placeholder={coreT({key: "ui.provider.custom_params_placeholder"})}
          />
        </SettingsField>
      </SettingsFormSection>
    </SettingsPanel>
  );
}

type ProviderModelRow = {
  id: string;
  vendorModelId: string;
  modelName: string;
  displayName: string;
};
type ModelMenuState = { savedModelId: string; x: number; y: number } | null;
type ModelRenameState = { savedModelId: string; initialName: string } | null;
type ModelDeleteState =
  | { kind: "single"; savedModelId: string; label: string }
  | { kind: "batch"; count: number }
  | null;

export function ProviderDetailView({ nav }: { nav: Nav }) {
  type ProviderTab = "config" | "models";
  // 默认「模型管理」（高频），与服务商配置 tab 并列；点服务商行进来后可直接切到「服务商配置」改连接信息。
  const [activeTab, setActiveTab] = useState<ProviderTab>("config");
  const batch = useBatchSelection();
  const providerId = nav.navState.editingProviderId;
  const [models, setModels] = useState<ProviderModelRow[]>([]);
  const [modelMenu, setModelMenu] = useState<ModelMenuState>(null);
  const [renamePrompt, setRenamePrompt] = useState<ModelRenameState>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ModelDeleteState>(null);
  const [fetchModalOpen, setFetchModalOpen] = useState(false);
  const [addModelOpen, setAddModelOpen] = useState(false);

  // nm-style: keep-local — useCallback 回调带 deps 且函数体多语句；prettier 强制展开，单行化会改语义
  const reload = useCallback(async () => {
    if (!providerId) return;
    const res = await ipcProviderModelsSavedList({ providerId });
    if (res.ok) setModels([...res.data]);
  }, [providerId]);

  useEffect(() => void reload().catch(() => undefined), [reload]);

  if (!providerId) return <p className="settings-hint">{coreT({key: "ui.provider.provider_id_missing"})}</p>;

  const deleteModels = async (savedModelIds: readonly string[]) => {
    for (const savedModelId of savedModelIds) {
      const args = { savedModelId, providerId };
      const res = await ipcProviderModelsDeleteSaved(args);
      if (!res.ok) {
        toastSettingsError(res.error.message);
        return;
      }
    }
    batch.exit();
    const count = savedModelIds.length;
    const message = count > 1 ? `已删除 ${count} 个模型` : "已删除模型";
    toastSettingsSuccess(message);
    await reload();
  };

  const openModelEditor = (savedModelId: string) => {
    nav.navState.editingSavedModelId = savedModelId;
    nav.push("modelSampling");
  };

  // nm-style: keep-local — 重命名含 prompt 快照与校验/回读流程，内联会拆散状态机
  const handleRename = async (name: string) => {
    const target = renamePrompt;
    setRenamePrompt(null);
    if (!target) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      toastSettingsError(coreT({key: "ui.sampling.name_required"}));
      return;
    }
    const patch = { savedModelId: target.savedModelId, modelName: trimmed };
    const res = await ipcProviderModelsEditSaved(patch);
    if (!res.ok) {
      toastSettingsError(res.error.message);
      return;
    }
    // 键面无「已更新模型名称」键（漏键待波 3c），保留原字面量。
    toastSettingsSuccess("已更新模型名称");
    await reload();
  };

  // nm-style: keep-local — 菜单分发是 29 行多分支状态机，内联会拆散菜单生命周期
  const handleModelMenuSelect = (action: string) => {
    const menu = modelMenu;
    setModelMenu(null);
    if (!menu) {
      return;
    }
    const model = models.find((m) => m.id === menu.savedModelId);
    if (!model) {
      return;
    }
    if (action === "edit") {
      openModelEditor(model.id);
      return;
    }
    if (action === "rename") {
      setRenamePrompt({
        savedModelId: model.id,
        initialName: model.modelName,
      });
      return;
    }
    if (action === "delete") {
      setDeleteConfirm({
        kind: "single",
        savedModelId: model.id,
        label: model.displayName || model.vendorModelId,
      });
    }
  };

  const duplicateVendorCount: Record<string, number> = {};
  for (const model of models) {
    const id = model.vendorModelId;
    duplicateVendorCount[id] = (duplicateVendorCount[id] ?? 0) + 1;
  }

  const everyModelSelected = models.every((m) => batch.selectedIds.has(m.id));
  const allModelsSelected = models.length > 0 && everyModelSelected;
  const modelIds = models.map((m) => m.id);

  return (
    <div className="provider-detail">
      <div className="provider-detail__tabs">
        <SegmentedControl<ProviderTab>
          value={activeTab}
          onChange={setActiveTab}
          aria-label={coreT({key: "ui.provider.detail_tab_aria"})}
          options={[
            { value: "config", label: coreT({key: "ui.nav.providers"}) },
            { value: "models", label: coreT({key: "ui.nav.model_management"}) },
          ]}
        />
      </div>
      {activeTab === "config" ? (
        <ProviderFormView nav={nav} mode="edit" />
      ) : (
        <SettingsPanel>
          <SettingsListSection
            header={
              <ManageHeader
                // 键面无「已保存模型」标题键（漏键待波 3c），保留原字面量。
                title="已保存模型"
                batchMode={batch.active}
                selectedCount={batch.selectedCount}
                onEnterBatch={batch.enter}
                onCancelBatch={batch.exit}
                allSelected={allModelsSelected}
                onSelectAll={() =>
                  batch.selectRange(allModelsSelected ? [] : modelIds)
                }
                onDelete={() => {
                  if (batch.selectedCount === 0) {
                    return;
                  }
                  setDeleteConfirm({
                    kind: "batch",
                    count: batch.selectedCount,
                  });
                }}
                hint={coreT({key: "ui.provider.delete_models_select_title"})}
                normalActions={
                  <>
                    <button
                      type="button"
                      className="list-manage-header__btn"
                      onClick={() => setFetchModalOpen(true)}
                    >
                      {coreT({key: "ui.provider.fetch_models_title"})}
                    </button>
                    <button
                      type="button"
                      className="list-manage-header__btn list-manage-header__btn--primary"
                      onClick={() => setAddModelOpen(true)}
                    >
                      {coreT({key: "ui.common.add"})}
                    </button>
                  </>
                }
              />
            }
          >
            {models.map((m) => (
              <SettingsListItem
                key={m.id}
                title={m.displayName || m.vendorModelId}
                meta={
                  duplicateVendorCount[m.vendorModelId]! > 1
                    ? m.vendorModelId
                    : m.modelName !== m.vendorModelId
                    ? m.vendorModelId
                    : undefined
                }
                batchMode={batch.active}
                selected={batch.isSelected(m.id)}
                onToggleSelect={() => batch.toggle(m.id)}
                onClick={() => openModelEditor(m.id)}
                onMenu={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setModelMenu({
                    savedModelId: m.id,
                    x: Math.max(8, rect.left),
                    y: Math.max(8, rect.bottom + 4),
                  });
                }}
              />
            ))}
          </SettingsListSection>
          <FetchModelsModal
            open={fetchModalOpen}
            providerId={providerId}
            savedVendorIds={models.map((m) => m.vendorModelId)}
            onClose={() => setFetchModalOpen(false)}
            onSaved={async () => {
              showToast(coreT({key: "ui.provider.models_added_done"}));
              await reload();
            }}
            onError={(message) => toastSettingsError(message)}
          />
          <AddModelModal
            open={addModelOpen}
            onClose={() => setAddModelOpen(false)}
            onConfirm={async (vendorModelId, modelName) => {
              const args = { providerId, vendorModelId, modelName };
              const res = await ipcProviderModelsSave(args);
              if (!res.ok) {
                toastSettingsError(res.error.message);
                return;
              }
              showToast(coreT({key: "ui.provider.models_added_done"}));
              await reload();
            }}
          />
          <ContextMenu
            open={modelMenu != null}
            x={modelMenu?.x ?? 0}
            y={modelMenu?.y ?? 0}
            items={[
              { label: coreT({key: "ui.common.edit"}), action: "edit" },
              { label: coreT({key: "ui.common.rename"}), action: "rename" },
              { label: coreT({key: "ui.common.delete"}), action: "delete", danger: true },
            ]}
            onSelect={(action) => handleModelMenuSelect(action)}
            onClose={() => setModelMenu(null)}
          />
          <TextPromptModal
            open={renamePrompt != null}
            title={coreT({key: "ui.provider.rename_model_title"})}
            initialValue={renamePrompt?.initialName ?? ""}
            onClose={() => setRenamePrompt(null)}
            onConfirm={handleRename}
          />
          <ConfirmModal
            open={deleteConfirm != null}
            title={coreT({key: "ui.provider.delete_model_title"})}
            message={
              deleteConfirm?.kind === "batch"
                ? coreT({key: "ui.provider.delete_models_confirm", params: {count: deleteConfirm.count}})
                : `删除模型「${
                    deleteConfirm?.kind === "single" ? deleteConfirm.label : ""
                  }」？`
            }
            danger
            onConfirm={() => {
              const target = deleteConfirm;
              setDeleteConfirm(null);
              if (!target) {
                return;
              }
              if (target.kind === "batch") {
                void deleteModels([...batch.selectedIds]);
                return;
              }
              void deleteModels([target.savedModelId]);
            }}
            onCancel={() => setDeleteConfirm(null)}
          />
        </SettingsPanel>
      )}
    </div>
  );
}

// ===== 智能排序规则（spec Step 11）=====

/** 内置规则固定前缀（与 core `BUILTIN_SMART_SORT_RULE_ID_PREFIX` 对齐；renderer 不依赖 core）。 */
const SMART_SORT_BUILTIN_PREFIX = "builtin-";

function isBuiltinSmartSortRule(ruleId: string): boolean {
  return ruleId.startsWith(SMART_SORT_BUILTIN_PREFIX);
}

type RuleMenuState = { ruleId: string; x: number; y: number } | null;
type RuleDeleteState =
  | { kind: "single"; ruleId: string; label: string }
  | { kind: "batch"; count: number }
  | null;
type MoveTo = SmartSortRuleMoveRequest["to"];

export function SmartSortRulesView({ nav }: { nav: Nav }) {
  const batch = useBatchSelection();
  const [rules, setRules] = useState<SmartSortRuleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ruleMenu, setRuleMenu] = useState<RuleMenuState>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<RuleDeleteState>(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [importConfirm, setImportConfirm] = useState(false);
  const [dragRuleId, setDragRuleId] = useState<string | null>(null);
  const [dragOverRuleId, setDragOverRuleId] = useState<string | null>(null);

  // nm-style: keep-local — useCallback 回调带 deps 且函数体多语句；prettier 强制展开，单行化会改语义
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ipcSmartSortRuleList();
      if (!res.ok) {
        // 加载失败不可伪装成「暂无规则」（desktop/B-1），与其它设置列表页错误惯例对齐。
        toastSettingsError(res.error.message);
        setLoadFailed(true);
        return;
      }
      setLoadFailed(false);
      setRules([...res.data]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void reload().catch(() => undefined), [reload]);

  const openEditor = (ruleId?: string) => {
    nav.navState.editingSmartSortRuleId = ruleId;
    nav.push("smartSortRuleEditor");
  };

  const moveRule = async (ruleId: string, to: MoveTo) => {
    const res = await ipcSmartSortRuleMove({ ruleId, to });
    if (!res.ok) {
      toastSettingsError(res.error.message);
      return;
    }
    setRules([...res.data]);
  };

  const runDeleteRules = async (ruleIds: readonly string[]) => {
    let res;
    if (ruleIds.length === 1) {
      res = await ipcSmartSortRuleDelete({ ruleId: ruleIds[0]! });
    } else {
      res = await ipcSmartSortRuleDeleteBatch({ ruleIds });
    }
    if (!res.ok) {
      toastSettingsError(res.error.message);
      return;
    }
    batch.exit();
    const count = ruleIds.length;
    const message = count > 1 ? coreT({key: "ui.smart_sort.delete_rules_count", params: {count}}) : coreT({key: "ui.smart_sort.delete_rules_done"});
    toastSettingsSuccess(message);
    await reload();
  };

  const runBatchSetEnabled = async (enabled: boolean) => {
    if (batch.selectedCount === 0) {
      return;
    }
    const args = { ruleIds: [...batch.selectedIds], enabled };
    const res = await ipcSmartSortRuleSetEnabledBatch(args);
    if (!res.ok) {
      toastSettingsError(res.error.message);
      return;
    }
    toastSettingsSuccess(enabled ? coreT({key: "ui.smart_sort.enable_batch_done"}) : coreT({key: "ui.smart_sort.disable_batch_done"}));
    await reload();
  };

  // nm-style: keep-local — 导出流程含 busy 状态与取消分支，内联进 JSX 会净增 >12 行
  const runExportYaml = async () => {
    setBusy(true);
    try {
      const res = await ipcSmartSortRuleYamlExport();
      if (res.ok) {
        const message = res.data === "saved" ? coreT({key: "ui.smart_sort.exported_yaml"}) : coreT({key: "ui.common.cancelled"});
        toastSettingsSuccess(message);
      } else {
        toastSettingsError(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  // nm-style: keep-local — 导入流程含确认态、batch 退出与分支提示，内联进 JSX 会净增 >12 行
  const runImportYaml = async () => {
    setImportConfirm(false);
    setBusy(true);
    try {
      const res = await ipcSmartSortRuleYamlImport();
      if (res.ok) {
        if (res.data === "imported") {
          batch.exit();
          toastSettingsSuccess(coreT({key: "ui.smart_sort.imported_all"}));
          await reload();
        } else {
          toastSettingsSuccess(coreT({key: "ui.common.cancelled"}));
        }
      } else {
        toastSettingsError(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  // nm-style: keep-local — 恢复默认含确认态与 busy/回读，内联进 JSX 会净增 >12 行
  const runResetDefaults = async () => {
    setResetConfirm(false);
    setBusy(true);
    try {
      const res = await ipcSmartSortRuleResetDefaults();
      if (res.ok) {
        toastSettingsSuccess(coreT({key: "ui.smart_sort.reset_done"}));
        await reload();
      } else {
        toastSettingsError(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  // nm-style: keep-local — 菜单分发是 38 行多分支状态机，内联会拆散菜单生命周期
  const handleMenuSelect = (action: string) => {
    const menu = ruleMenu;
    setRuleMenu(null);
    if (!menu) {
      return;
    }
    const rule = rules.find((r) => r.ruleId === menu.ruleId);
    if (!rule) {
      return;
    }
    if (action === "edit") {
      openEditor(rule.ruleId);
      return;
    }
    if (action === "move-top") {
      void moveRule(rule.ruleId, "top");
      return;
    }
    if (action === "move-up") {
      void moveRule(rule.ruleId, "up");
      return;
    }
    if (action === "move-down") {
      void moveRule(rule.ruleId, "down");
      return;
    }
    if (action === "move-bottom") {
      void moveRule(rule.ruleId, "bottom");
      return;
    }
    if (action === "delete") {
      setDeleteConfirm({
        kind: "single",
        ruleId: rule.ruleId,
        label: rule.name,
      });
    }
  };

  /**
   * HTML5 拖拽（spec D9）：源行插入到目标行之前，整表 reorder。
   * 源 id 优先读 dataTransfer（与 WorkspaceTree 惯例一致），state 闭包兜底。
   */
  // nm-style: keep-local — 拖拽含拖动态清理与下标重排，内联进 onDrop 会拆散拖拽状态机
  const handleDrop = async (e: React.DragEvent, targetRuleId: string) => {
    const sourceId = e.dataTransfer.getData("text/plain") || dragRuleId;
    setDragRuleId(null);
    setDragOverRuleId(null);
    if (!sourceId || sourceId === targetRuleId) {
      return;
    }
    const ids = rules.map((r) => r.ruleId);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetRuleId);
    if (from < 0 || to < 0) {
      return;
    }
    ids.splice(to, 0, ...ids.splice(from, 1));
    const res = await ipcSmartSortRuleReorder({ orderedIds: ids });
    if (!res.ok) {
      toastSettingsError(res.error.message);
      return;
    }
    setRules([...res.data]);
  };

  const menuRuleId = ruleMenu?.ruleId;
  const menuRule = rules.find((r) => r.ruleId === menuRuleId);
  // 内置规则仅可禁用不可删除（spec D3），隐藏删除项
  const builtin = menuRule != null && isBuiltinSmartSortRule(menuRule.ruleId);
  const deleteItem = { label: coreT({key: "ui.common.delete"}), action: "delete", danger: true };
  const menuItems = builtin ? [] : [deleteItem];
  const everySelected = rules.every((r) => batch.selectedIds.has(r.ruleId));
  const allSelected = rules.length > 0 && everySelected;

  return (
    <SettingsPanel>
      <SettingsListSection
        header={
          <ManageHeader
            title={coreT({key: "ui.nav.settings_smart_sort"})}
            batchMode={batch.active}
            selectedCount={batch.selectedCount}
            onEnterBatch={batch.enter}
            onCancelBatch={batch.exit}
            allSelected={allSelected}
            onSelectAll={() =>
              batch.selectRange(allSelected ? [] : rules.map((r) => r.ruleId))
            }
            onDelete={() => {
              if (batch.selectedCount === 0) {
                return;
              }
              if ([...batch.selectedIds].some(isBuiltinSmartSortRule)) {
                toastSettingsError(coreT({key: "ui.smart_sort.builtin_delete_block_desktop"}));
                return;
              }
              setDeleteConfirm({ kind: "batch", count: batch.selectedCount });
            }}
            actions={
              batch.active
                ? [
                    {
                      label: coreT({key: "ui.common.enable"}),
                      onClick: () => void runBatchSetEnabled(true),
                    },
                    {
                      // 键面无单独「禁用」动作键（漏键待波 3c），保留原字面量。
                      label: "禁用",
                      onClick: () => void runBatchSetEnabled(false),
                    },
                  ]
                : undefined
            }
            hint={coreT({key: "ui.smart_sort.builtin_delete_block_desktop2"})}
            normalActions={
              <>
                <button
                  type="button"
                  className="list-manage-header__btn"
                  disabled={busy}
                  onClick={() => setImportConfirm(true)}
                >
                  {coreT({key: "ui.agent.import_yaml"})}
                </button>
                <button
                  type="button"
                  className="list-manage-header__btn"
                  disabled={busy}
                  onClick={() => void runExportYaml()}
                >
                  {coreT({key: "ui.agent.export_yaml"})}
                </button>
                <button
                  type="button"
                  className="list-manage-header__btn"
                  disabled={busy}
                  onClick={() => setResetConfirm(true)}
                >
                  {coreT({key: "ui.common.reset_default"})}
                </button>
                <button
                  type="button"
                  className="list-manage-header__btn list-manage-header__btn--primary"
                  onClick={() => openEditor()}
                >
                  {/* 键面无「新建规则」按钮键（new_rule_title 是「新规则」，不同文），保留原字面量。 */}
                  新建规则
                </button>
              </>
            }
          />
        }
      >
        <p className="settings-hint">
          {coreT({key: "ui.smart_sort.list_hint_desktop"})}
        </p>
        {loading ? <SettingsListEmpty>{coreT({key: "ui.common.loading"})}</SettingsListEmpty> : null}
        {!loading && rules.length === 0 ? (
          <SettingsListEmpty>
            {loadFailed ? "加载失败，请重试。" : "暂无规则，点击上方按钮创建。"}
          </SettingsListEmpty>
        ) : null}
        {rules.map((rule) => (
          <div
            key={rule.ruleId}
            className={`settings-list-item-row${
              dragRuleId === rule.ruleId ? " is-dragging" : ""
            }${
              dragOverRuleId === rule.ruleId && dragRuleId !== rule.ruleId
                ? " is-drag-over"
                : ""
            }`}
            draggable={!batch.active}
            onDragStart={(e) => {
              setDragRuleId(rule.ruleId);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", rule.ruleId);
            }}
            onDragOver={(e) => {
              if (dragRuleId == null || dragRuleId === rule.ruleId) {
                return;
              }
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDragOverRuleId(rule.ruleId);
            }}
            onDrop={(e) => {
              e.preventDefault();
              void handleDrop(e, rule.ruleId);
            }}
            onDragEnd={() => {
              setDragRuleId(null);
              setDragOverRuleId(null);
            }}
          >
            <button
              type="button"
              className="settings-list-item"
              onClick={() => {
                if (batch.active) {
                  batch.toggle(rule.ruleId);
                  return;
                }
                openEditor(rule.ruleId);
              }}
            >
              {batch.active ? (
                <BatchCheckbox
                  checked={batch.isSelected(rule.ruleId)}
                  onToggle={() => batch.toggle(rule.ruleId)}
                />
              ) : (
                <span
                  className="smart-sort-rule__drag-handle"
                  aria-hidden="true"
                >
                  ⠿
                </span>
              )}
              <span className="settings-list-item__label">
                <span className="settings-list-item__meta-row">
                  {rule.name}
                  {isBuiltinSmartSortRule(rule.ruleId) ? (
                    <span className="settings-tag settings-tag--muted">
                      内置
                    </span>
                  ) : null}
                  {!rule.enabled ? (
                    <span className="settings-tag settings-tag--muted">
                      {coreT({key: "ui.smart_sort.disabled_tag"})}
                    </span>
                  ) : null}
                </span>
                {rule.description ? (
                  <span className="settings-row__desc">{rule.description}</span>
                ) : null}
              </span>
            </button>
            {!batch.active ? (
              <div className="smart-sort-rule__switch">
                <Switch
                  checked={rule.enabled}
                  onChange={async (next) => {
                    const args = { ruleId: rule.ruleId, enabled: next };
                    const res = await ipcSmartSortRuleSetEnabled(args);
                    if (!res.ok) {
                      toastSettingsError(res.error.message);
                      return;
                    }
                    const updated = res.data;
                    setRules((prev) =>
                      prev.map((r) =>
                        r.ruleId === updated.ruleId ? updated : r
                      )
                    );
                  }}
                  aria-label={`启用 ${rule.name}`}
                />
              </div>
            ) : null}
            {!batch.active ? (
              <button
                type="button"
                className="settings-list-item__menu-btn"
                aria-label={coreT({key: "ui.common.more"})}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setRuleMenu({
                    ruleId: rule.ruleId,
                    x: Math.max(8, rect.left),
                    y: Math.max(8, rect.bottom + 4),
                  });
                }}
              >
                ⋮
              </button>
            ) : null}
          </div>
        ))}
      </SettingsListSection>
      <ContextMenu
        open={ruleMenu != null}
        x={ruleMenu?.x ?? 0}
        y={ruleMenu?.y ?? 0}
        items={[
          { label: coreT({key: "ui.common.edit"}), action: "edit" },
          { label: coreT({key: "ui.common.move_top"}), action: "move-top" },
          { label: coreT({key: "ui.common.move_up"}), action: "move-up" },
          { label: coreT({key: "ui.common.move_down"}), action: "move-down" },
          { label: coreT({key: "ui.common.move_bottom"}), action: "move-bottom" },
          ...menuItems,
        ]}
        onSelect={(action) => handleMenuSelect(action)}
        onClose={() => setRuleMenu(null)}
      />
      <ConfirmModal
        open={deleteConfirm != null}
        title={coreT({key: "ui.smart_sort.delete_title"})}
        message={
          deleteConfirm?.kind === "batch"
            ? coreT({key: "ui.smart_sort.delete_batch_confirm", params: {count: deleteConfirm.count}})
            : `删除规则「${
                deleteConfirm?.kind === "single" ? deleteConfirm.label : ""
              }」？`
        }
        danger
        onConfirm={() => {
          const target = deleteConfirm;
          setDeleteConfirm(null);
          if (!target) {
            return;
          }
          if (target.kind === "batch") {
            void runDeleteRules([...batch.selectedIds]);
            return;
          }
          void runDeleteRules([target.ruleId]);
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
      <ConfirmModal
        open={importConfirm}
        title={coreT({key: "ui.agent.import_yaml"})}
        message={coreT({key: "ui.smart_sort.import_confirm_desktop"})}
        danger
        onConfirm={() => void runImportYaml()}
        onCancel={() => setImportConfirm(false)}
      />
      <ConfirmModal
        open={resetConfirm}
        // 键面无「恢复默认规则」标题键（reset_done 是「已恢复默认规则」，不同文），保留原字面量。
        title="恢复默认规则"
        message={coreT({key: "ui.smart_sort.reset_confirm_desktop"})}
        onConfirm={() => void runResetDefaults()}
        onCancel={() => setResetConfirm(false)}
      />
    </SettingsPanel>
  );
}

/** 正则输入支持 /pattern/flags 字面量风格（core PatternInput.parse 单源，
 * 与 mobile 同源）：输入框绑定原始文本 patternInput，解析结果同步进
 * draft.pattern/flags，测试/保存均消费解析值；无独立 flags UI。 */
type SmartSortRuleDraft = {
  name: string;
  /** 正则输入框原始文本（可能是 /pattern/flags 字面量风格）。 */
  patternInput: string;
  /** PatternInput.parse(patternInput) 的解析结果（测试/保存消费）。 */
  pattern: string;
  flags: string;
  /** 捕获数字档位（D13）：smart 捕获组提取 / fixed_min 哨兵最前 / fixed_max 沉底。 */
  captureKind: SmartSortCaptureKindDto;
  description: string;
  enabled: boolean;
};

const DEFAULT_SMART_SORT_DRAFT: SmartSortRuleDraft = {
  name: "",
  patternInput: "",
  pattern: "",
  flags: "",
  captureKind: "smart",
  description: "",
  enabled: true,
};

/** 捕获数字三档选项（D13）：顺序与任务定稿一致（智能/固定最大/固定最小）。 */
const SMART_SORT_CAPTURE_KIND_OPTIONS: ReadonlyArray<{
  value: SmartSortCaptureKindDto;
  label: string;
}> = [
  { value: "smart", label: coreT({key: "ui.smart_sort.capture_kind_smart"}) },
  { value: "fixed_max", label: coreT({key: "ui.smart_sort.capture_kind_fixed_max"}) },
  { value: "fixed_min", label: coreT({key: "ui.smart_sort.capture_kind_fixed_min"}) },
];

type MatchResultState = SmartSortRuleMatchResultDto | null;

export function SmartSortRuleEditorView({ nav }: { nav: Nav }) {
  // ruleId 经本地 state 镜像 navState：规则缺失回退新建时 setRuleId(undefined)
  // 才能让本组件感知（直接改 navState 不触发渲染，desktop/B-2）。
  const [ruleId, setRuleId] = useState(nav.navState.editingSmartSortRuleId);
  const [draft, setDraft] = useState(DEFAULT_SMART_SORT_DRAFT);
  const [testText, setTestText] = useState("");
  const [matchResult, setMatchResult] = useState<MatchResultState>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // nm-style: keep-local — 回调承载规则加载/缺失回退状态机，内联回 useEffect 会让调用参数跨行
  const loadRule = () => {
    ipcSmartSortRuleList().then((res) => {
      if (!res.ok) {
        // 加载失败不可静默伪装成「空列表 + 默认草稿」（dtcli/B-3，
        // 与列表视图 round 1 desktop/B-1 同型），出 toast 后维持新建语义。
        toastSettingsError(res.error.message);
        return;
      }
      if (ruleId) {
        const rule = res.data.find((r) => r.ruleId === ruleId);
        if (rule) {
          setDraft({
            name: rule.name,
            // 回显：pattern+flags 拼回 /pattern/flags 字面量风格（flags 空则
            // /pattern/），再解析回同一 pattern/flags（core 单测保障 round-trip）。
            patternInput: PatternInput.format(rule.pattern, rule.flags),
            pattern: rule.pattern,
            flags: rule.flags,
            captureKind: rule.captureKind,
            description: rule.description ?? "",
            enabled: rule.enabled,
          });
        } else {
          // 规则已被删除：提示并回退新建语义（save 走 create、预览草稿置顶），
          // 避免界面显示「新规则」而 save 仍按 update 必败（desktop/B-2）。
          toastSettingsError("规则不存在或已被删除");
          // navState 字段为 readonly，断言写入以同步 overlay 标题基线，不新增 TS2540 实例。
          (
            nav.navState as { editingSmartSortRuleId?: string }
          ).editingSmartSortRuleId = undefined;
          setRuleId(undefined);
        }
      }
    });
  };
  useEffect(loadRule, [ruleId, nav]);

  let regexError: string | null = null;
  if (draft.pattern) {
    try {
      new RegExp(draft.pattern, draft.flags);
    } catch (e) {
      regexError = e instanceof Error ? e.message : String(e);
    }
  }

  /** 结果只属于点击「测试」时的输入快照：任一输入（测试文本/正则/捕获档）
   *  变化即清空旧结果与错误，避免旧 matches 偏移对已编辑文本高亮错位、
   *  计数失真（dtcli/B-1，终审口径：三入口全清）。 */
  // nm-style: keep-local — useCallback 回调带 deps 且函数体多语句；prettier 强制展开，单行化会改语义
  const invalidateMatchResult = useCallback(() => {
    setMatchResult(null);
    setTestError(null);
  }, []);

  /** 正则匹配测试（fix ②：按钮手动触发，替代旧实时排序预览）。 */
  // nm-style: keep-local — 回调承载正则测试与输入快照状态机，内联回 useCallback 会让调用参数跨行
  const runMatchTestImpl = async () => {
    if (!testText.trim()) {
      setMatchResult(null);
      setTestError("请输入测试文本");
      return;
    }
    if (!draft.patternInput.trim()) {
      setMatchResult(null);
      setTestError("请先填写正则表达式");
      return;
    }
    // 与保存同口径：trim 后重新解析，避免尾随空白拆坏字面量；档位随当前
    // 捕获数字选择传入（fixed 档 tuple 显哨兵文案，D13）。
    const parsed = PatternInput.parse(draft.patternInput.trim());
    const payload = {
      pattern: parsed.pattern,
      flags: parsed.flags,
      text: testText,
      captureKind: draft.captureKind,
    };
    const res = await ipcSmartSortRuleMatch(payload);
    if (res.ok) {
      setMatchResult(res.data);
      setTestError(null);
    } else {
      setMatchResult(null);
      setTestError(res.error.message);
    }
  };
  const runMatchTestDeps = [testText, draft.patternInput, draft.captureKind];
  const runMatchTest = useCallback(runMatchTestImpl, runMatchTestDeps);

  // nm-style: keep-local — 保存流程含新建/更新分支与导航，内联进 JSX 会拆散保存状态机
  const save = async () => {
    // 与 mobile collectFields 对齐：name 本地 trim + 空名前置拦截，
    // 不把空名/纯空格发到 IPC 靠 core 兜底（dtcli/B-2）。
    const name = draft.name.trim();
    if (!name) {
      toastSettingsError("请填写规则名称");
      return;
    }
    const description = draft.description.trim() || null;
    // 保存前以 trim 后的输入重新解析（避免尾随空白把字面量拆成裸 pattern）。
    const parsed = PatternInput.parse(draft.patternInput.trim());
    const payload = {
      name,
      pattern: parsed.pattern,
      flags: parsed.flags,
      captureKind: draft.captureKind,
      description,
      enabled: draft.enabled,
    };
    if (ruleId) {
      const res = await ipcSmartSortRuleUpdate({ ruleId, patch: payload });
      if (res.ok) {
        toastSettingsSuccess(coreT({key: "ui.common.saved"}));
        nav.pop();
      } else {
        toastSettingsError(res.error.message);
      }
      return;
    }
    const res = await ipcSmartSortRuleCreate(payload);
    if (res.ok) {
      toastSettingsSuccess(coreT({key: "ui.common.created"}));
      nav.pop();
    } else {
      toastSettingsError(res.error.message);
    }
  };

  /** 结果区渲染（fix-desc-and-highlight）：按匹配偏移高亮切分原文
   *  （匹配段 --primary 变色）+ 底部匹配计数；错误/非法正则照旧文案。 */
  const matchCount = matchResult?.ok ? matchResult.matches.length : 0;
  const matches = matchResult?.ok ? matchResult.matches : null;
  const segments = matches && SmartSortHighlight.splitSegments(testText, matches);

  const ruleDesc = draft.name.trim() || (ruleId ? coreT({key: "ui.smart_sort.unnamed_rule"}) : coreT({key: "ui.smart_sort.new_rule_title"}));

  return (
    <SettingsPanel>
      <SettingsFormSection
        title={coreT({key: "ui.smart_sort.form_title"})}
        desc={ruleDesc}
        footer={
          <>
            <Button variant="secondary" onClick={() => void runMatchTest()}>
              {coreT({key: "ui.common.test"})}
            </Button>
            <Button variant="primary" onClick={() => void save()}>
              {coreT({key: "ui.common.save"})}
            </Button>
          </>
        }
      >
        <SettingsSection title={coreT({key: "ui.agent.basic_info"})}>
          <SettingsField label={coreT({key: "ui.common.name"})}>
            <input
              value={draft.name}
              placeholder={coreT({key: "ui.smart_sort.name_example_desktop"})}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </SettingsField>
          <SettingsField label={coreT({key: "ui.smart_sort.regex_label"})}>
            <textarea
              rows={2}
              value={draft.patternInput}
              placeholder={coreT({key: "ui.smart_sort.regex_example"})}
              spellCheck={false}
              onChange={(e) => {
                setDraft({
                  ...draft,
                  patternInput: e.target.value,
                  ...PatternInput.parse(e.target.value),
                });
                invalidateMatchResult();
              }}
            />
          </SettingsField>
          {regexError != null ? (
            <SettingsStatus error={`正则无效：${regexError}`} inline />
          ) : null}
          <p className="settings-hint">
            支持 /正则/flags 格式，如
            /第(\d+)章/i；智能数字档须含至少一个捕获组，命中时全部捕获组须可解析为数值（中文数字自动转换），否则尝试下一条规则；固定档命中即排最前/沉底，忽略捕获组。
          </p>
          <SettingsField
            label={coreT({key: "ui.smart_sort.capture_label"})}
            hint={
              draft.captureKind === "smart"
                ? coreT({key: "ui.smart_sort.capture_smart_hint"})
                : draft.captureKind === "fixed_min"
                ? coreT({key: "ui.smart_sort.capture_hint_before"})
                : coreT({key: "ui.smart_sort.capture_hint_after"})
            }
          >
            <select
              value={draft.captureKind}
              onChange={(e) => {
                setDraft({
                  ...draft,
                  captureKind: e.target.value as SmartSortCaptureKindDto,
                });
                invalidateMatchResult();
              }}
            >
              {SMART_SORT_CAPTURE_KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SettingsField>
          <SettingsField label={coreT({key: "ui.common.description"})}>
            <textarea
              rows={3}
              value={draft.description}
              placeholder={coreT({key: "ui.smart_sort.desc_hint"})}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </SettingsField>
          <SettingsSwitchRow
            label="启用规则"
            checked={draft.enabled}
            onChange={(v) => setDraft({ ...draft, enabled: v })}
          />
        </SettingsSection>

        <SettingsSection title={coreT({key: "ui.common.test"})}>
          <p className="settings-hint">
            {coreT({key: "ui.smart_sort.test_hint_desktop"})}
          </p>
          <SettingsField label={coreT({key: "ui.smart_sort.test_text_label"})}>
            <textarea
              rows={3}
              value={testText}
              placeholder={coreT({key: "ui.smart_sort.test_text_placeholder"})}
              onChange={(e) => {
                setTestText(e.target.value);
                invalidateMatchResult();
              }}
            />
          </SettingsField>
          <pre
            className={`settings-preview-box${
              testError != null ? " settings-preview-box--error" : ""
            }`}
          >
            {testError ??
              (segments != null ? (
                <>
                  {segments.map((seg, i) =>
                    seg.matched ? (
                      <span key={i} style={{ color: "var(--primary)" }}>
                        {seg.text}
                      </span>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    )
                  )}
                  {"\n"}
                  {/* 每处匹配的提取元组小字（D13）：匹配文本 → tuple 展示，
                      null 显「无序号」；固定档恒显哨兵文案。 */}
                  {matchResult?.ok
                    ? matchResult.matches.map((m, i) => (
                        <span
                          key={`${m.index}-${i}`}
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {/* no_match_text 键值为全角括号、源文半角，不同文保留原字面量（待 3c）。 */}
                          {`${m.text || "(空匹配)"} → ${m.tuple ?? coreT({key: "ui.smart_sort.no_tuple"})}\n`}
                        </span>
                      ))
                    : null}
                  <span style={{ color: "var(--text-secondary)" }}>
                    {matchCount > 0 ? coreT({key: "ui.smart_sort.match_count", params: {count: matchCount}}) : coreT({key: "ui.smart_sort.no_matches"})}
                  </span>
                </>
              ) : matchResult != null && !matchResult.ok ? (
                `正则无效：${matchResult.error}`
              ) : (
                "输入测试文本后点击「测试」查看匹配结果。"
              ))}
          </pre>
        </SettingsSection>
      </SettingsFormSection>
    </SettingsPanel>
  );
}
