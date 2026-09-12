import { useCallback, useEffect, useRef, useState } from "react";
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
import { toastSettingsError, toastSettingsSuccess } from "@/utils/settings-feedback";
import { handleMultilineSubmitKeyDown } from "@/utils/textarea-enter-shortcuts";
import { useBatchSelection } from "@/hooks/useBatchSelection";
import { useNovelMaster } from "@/providers/NovelMasterProvider";
import {
  ipcAgentRegistryCreateBlank,
  ipcAgentRegistryDelete,
  ipcAgentRegistryGet,
  ipcAgentRegistryList,
  ipcAgentRegistryUpsert,
  ipcAgentResolveCurrent,
  ipcAgentSetCurrent,
  ipcAgentYamlExport,
  ipcAgentYamlImport,
  ipcBackupExport,
  ipcBackupImport,
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
  ipcSmartSortRuleCreate,
  ipcSmartSortRuleDelete,
  ipcSmartSortRuleDeleteBatch,
  ipcSmartSortRuleList,
  ipcSmartSortRuleMove,
  ipcSmartSortRulePreview,
  ipcSmartSortRuleReorder,
  ipcSmartSortRuleResetDefaults,
  ipcSmartSortRuleSetEnabled,
  ipcSmartSortRuleSetEnabledBatch,
  ipcSmartSortRuleUpdate,
  ipcSmartSortRuleYamlExport,
  ipcSmartSortRuleYamlImport,
} from "@/ipc/client";
import {
  formatPatternInput,
  parsePatternInput,
} from "@novel-master/core/smart-sort-rule";
import type { SettingsNavHandle } from "./settings-nav";
import {
  SettingsActionSection,
  SettingsField,
  SettingsFormSection,
  SettingsStatus,
  SettingsSwitchRow,
  SettingsListEmpty,
  SettingsListItem,
  SettingsListSection,
  ApiKeyStatusTag,
  SettingsPanel,
} from "./settings-ui";
import {
  AGENT_LIST_LABELS,
  storedConfigInvalidReason,
} from "@shared/logic/config-forms-stored-config-validity";
import type {
  AgentRegistryListItemDto,
  SmartSortRuleDto,
  SmartSortRuleMoveRequest,
  SmartSortRulePreviewDraftDto,
  SmartSortRulePreviewResultDto,
} from "@shared/ipc-types";

type Nav = SettingsNavHandle;

/** 列表 meta 中截断失效说明。 */
function truncateInvalidMessage(message: string, max = 80): string {
  return message.length <= max ? message : `${message.slice(0, max)}…`;
}

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
};

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

  const reloadStatus = useCallback(async () => {
    const res = await ipcCloudSyncGetLocalStatus();
    if (res.ok) {
      setStatus(res.data);
    }
  }, []);

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

  useEffect(() => {
    void reloadConfig();
    void reloadStatus();
  }, [reloadConfig, reloadStatus]);

  /** 轮询同步状态，使 Agent 运行中等标志与 main 进程一致 */
  useEffect(() => {
    const timer = window.setInterval(() => {
      void reloadStatus();
    }, 2000);
    return () => {
      window.clearInterval(timer);
    };
  }, [reloadStatus]);

  const controlsDisabled =
    busy || status?.syncBusy === true || status?.agentActive === true;

  const saveConfig = async () => {
    setBusy(true);
    try {
      const res = await ipcCloudSyncSetConfig({
        endpoint: endpoint.trim(),
        bucket: bucket.trim(),
        region: region.trim(),
        pathPrefix: pathPrefix.trim(),
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim() || undefined,
        forcePathStyle,
        deviceLabel: deviceLabel.trim() || undefined,
      });
      if (res.ok) {
        toastSettingsSuccess("云同步配置已保存");
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

  const testConnection = async () => {
    setBusy(true);
    try {
      const saveRes = await ipcCloudSyncSetConfig({
        endpoint: endpoint.trim(),
        bucket: bucket.trim(),
        region: region.trim(),
        pathPrefix: pathPrefix.trim(),
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim() || undefined,
        forcePathStyle,
        deviceLabel: deviceLabel.trim() || undefined,
      });
      if (!saveRes.ok) {
        toastSettingsError(saveRes.error.message);
        return;
      }
      const res = await ipcCloudSyncTestConnection();
      if (res.ok) {
        toastSettingsSuccess("连接成功");
        await reloadConfig();
      } else {
        toastSettingsError(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const runPull = async () => {
    setConfirmPull(false);
    setBusy(true);
    try {
      const res = await ipcCloudSyncPull();
      if (res.ok) {
        retry({ skipRebootstrap: true });
        toastSettingsSuccess(`已拉取云端数据（rev ${res.data.rev}）`);
        await reloadStatus();
      } else if (res.error.code === "ALREADY_UP_TO_DATE") {
        showToast(res.error.message);
        await reloadStatus();
      } else {
        toastSettingsError(res.error.message);
        await reloadStatus();
      }
    } finally {
      setBusy(false);
    }
  };

  const runPush = async (forceOverwriteRemote = false) => {
    setConfirmPushOverwrite(false);
    setBusy(true);
    try {
      const res = await ipcCloudSyncPush(
        forceOverwriteRemote ? { forceOverwriteRemote: true } : undefined,
      );
      if (res.ok) {
        toastSettingsSuccess(`已推送到云端（rev ${res.data.rev}）`);
        await reloadStatus();
      } else if (res.error.code === "NEED_PULL_FIRST") {
        setConfirmPushOverwrite(true);
      } else {
        toastSettingsError(res.error.message);
        await reloadStatus();
      }
    } finally {
      setBusy(false);
    }
  };

  const runExport = async () => {
    setBusy(true);
    try {
      const res = await ipcBackupExport();
      if (res.ok) {
        toastSettingsSuccess(
          res.data === "saved" ? "已导出数据库" : "已取消",
        );
      } else {
        toastSettingsError(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    setConfirmImport(false);
    setBusy(true);
    try {
      const res = await ipcBackupImport();
      if (res.ok) {
        if (res.data === "imported") {
          retry({ skipRebootstrap: true });
          toastSettingsSuccess("已导入并重新加载");
        } else {
          toastSettingsSuccess("已取消");
        }
      } else {
        toastSettingsError(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsPanel>
      <SettingsFormSection
        title="云同步"
        desc="通过 S3 兼容对象存储在 Desktop 与 Mobile 之间同步数据库快照。Secret Key 经 SKSP 加密存储。"
      >
        <SettingsSwitchRow
          label="启用云同步"
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
                  placeholder="可留空（MinIO）"
                />
              </SettingsField>
              <SettingsField label="路径前缀">
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
            <SettingsField label="设备名称（可选）">
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
                测试连接
              </Button>
              <Button
                variant="primary"
                disabled={controlsDisabled || configLoading}
                onClick={() => void saveConfig()}
              >
                保存配置
              </Button>
            </div>

            <div className="config-block-card config-block-card--sync">
              <div className="config-block-card__header">
                <span className="config-block-card__section-label">同步状态</span>
              </div>
              <div className="config-block-card__body">
                <p className="config-block-card__hint config-block-card__hint--subtle">
                  {status?.agentActive
                    ? "Agent 运行中，同步操作已禁用。"
                    : "显示本机与云端的 rev 对齐情况；须先保存配置后再拉取/推送。"}
                </p>
                {status?.suggestsPull ? (
                  <SettingsStatus
                    error="云端有更新，建议先拉取后再推送。"
                    inline
                  />
                ) : null}
                <SettingsStatus
                  message={
                    status == null
                      ? "加载中…"
                      : [
                          `云端 rev：${status.remoteRev ?? "—"}`,
                          `本机已同步 rev：${status.lastSyncedRev}`,
                          status.lastPullAt
                            ? `上次拉取：${new Date(status.lastPullAt).toLocaleString()}`
                            : null,
                          status.lastPushAt
                            ? `上次推送：${new Date(status.lastPushAt).toLocaleString()}`
                            : null,
                          status.lastPullResult
                            ? `拉取结果：${status.lastPullResult}`
                            : null,
                          status.lastPushResult
                            ? `推送结果：${status.lastPushResult}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                  }
                />
                <div className="settings-form-actions settings-form-actions--solo">
                  <Button
                    variant="secondary"
                    disabled={controlsDisabled || !status?.configured}
                    onClick={() => setConfirmPull(true)}
                  >
                    从云端拉取
                  </Button>
                  <Button
                    variant="primary"
                    disabled={controlsDisabled || !status?.configured}
                    onClick={() => void runPush()}
                  >
                    推送到云端
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </SettingsFormSection>

      <SettingsActionSection
        title="导出"
        desc="将当前数据库导出为 .nmbackup 文件，可与 mobile 互通。"
        action={
          <Button variant="primary" disabled={controlsDisabled} onClick={() => void runExport()}>
            导出数据库
          </Button>
        }
      />
      <SettingsActionSection
        title="导入"
        desc="用备份文件完全替换当前数据库。本机服务商与 API Key 将保留，备份中的服务商配置不会导入。操作不可撤销。"
        action={
          <Button variant="primary" disabled={controlsDisabled} onClick={() => setConfirmImport(true)}>
            导入数据库
          </Button>
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
        confirmLabel="仍要覆盖云端"
        cancelLabel="先拉取"
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
        title="确认导入"
        message="导入将完全替换当前数据库；本机服务商与 API Key 将保留，备份中的服务商配置不会导入。确定继续？"
        danger
        busy={busy}
        onConfirm={() => void runImport()}
        onCancel={() => !busy && setConfirmImport(false)}
      />
    </SettingsPanel>
  );
}

export function AgentsSettingsView({ nav }: { nav: Nav }) {
  const batch = useBatchSelection();
  const [rows, setRows] = useState<AgentRegistryListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentMenu, setAgentMenu] = useState<{
    agentId: string;
    x: number;
    y: number;
  } | null>(null);
  const [renamePrompt, setRenamePrompt] = useState<{
    agentId: string;
    initialName: string;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<
    | { kind: "single"; agentId: string; name: string }
    | { kind: "batch"; count: number }
    | null
  >(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ipcAgentRegistryList();
      if (res.ok) setRows([...res.data]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  const openAgentEditor = (agentId: string, displayName?: string) => {
    nav.navState.editingAgentId = agentId;
    nav.navState.editingAgentDisplayName = displayName;
    nav.setAgentEditorTitle?.(displayName);
    nav.push("agentEditor");
  };

  const createAgent = async () => {
    const res = await ipcAgentRegistryCreateBlank();
    if (res.ok) {
      openAgentEditor(res.data.agentId);
      await reload();
    }
  };

  const handleAgentMenuSelect = async (action: string) => {
    const menu = agentMenu;
    setAgentMenu(null);
    if (!menu) {
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
      const saveRes = await ipcAgentRegistryUpsert({
        agentId: copyId,
        definition: { ...def, name: `${def.name ?? row.name}-copy` },
      });
      if (saveRes.ok) {
        const copyName = `${def.name ?? row.name}-copy`;
        openAgentEditor(copyId, copyName);
        await reload();
      }
      return;
    }
    if (action === "delete") {
      setDeleteConfirm({ kind: "single", agentId: row.agentId, name: row.name });
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
      const remaining = rows
        .map((r) => r.agentId)
        .filter((id) => !agentIds.includes(id));
      if (remaining.length > 0) {
        await ipcAgentSetCurrent({ agentId: remaining[0]! });
      }
    }
    batch.exit();
    toastSettingsSuccess(
      agentIds.length > 1 ? `已删除 ${agentIds.length} 个 Agent` : "已删除 Agent",
    );
    await reload();
  };

  const confirmDeleteAgent = async () => {
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
    const def = getRes.data.value;
    await ipcAgentRegistryUpsert({
      agentId: prompt.agentId,
      definition: { ...def, name },
    });
    await reload();
  };

  return (
    <SettingsPanel>
      <SettingsListSection
        header={
          <ManageHeader
            title="智能体配置"
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
            hint="选择要删除的 Agent"
            normalActions={
              <button type="button" className="list-manage-header__btn list-manage-header__btn--primary" onClick={() => void createAgent()}>
                新建 Agent
              </button>
            }
          />
        }
      >
        {loading ? <SettingsListEmpty>加载中…</SettingsListEmpty> : null}
        {!loading && rows.length === 0 ? (
          <SettingsListEmpty>暂无 Agent，点击上方按钮创建。</SettingsListEmpty>
        ) : null}
        {rows.map((row) => (
          <SettingsListItem
            key={row.agentId}
            title={row.name}
            meta={
              row.invalid != null ? (
                <span className="settings-list-item__meta-row">
                  <span className="settings-tag settings-tag--warn">
                    {AGENT_LIST_LABELS.configInvalid}
                  </span>
                  <span
                    className="settings-list-item__meta-error"
                    title={row.invalid.message}
                  >
                    {truncateInvalidMessage(
                      storedConfigInvalidReason(row.invalid.code),
                    )}
                  </span>
                </span>
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
        items={[
          { label: "编辑", action: "edit" },
          { label: "重命名", action: "rename" },
          { label: "复制", action: "duplicate" },
          { label: "删除", action: "delete", danger: true },
        ]}
        onSelect={(action) => void handleAgentMenuSelect(action)}
        onClose={() => setAgentMenu(null)}
      />
      <TextPromptModal
        open={renamePrompt != null}
        title="重命名 Agent"
        initialValue={renamePrompt?.initialName ?? ""}
        onClose={() => setRenamePrompt(null)}
        onConfirm={handleRename}
      />
      <ConfirmModal
        open={deleteConfirm != null}
        title="删除 Agent"
        message={
          deleteConfirm?.kind === "batch"
            ? `确定删除选中的 ${deleteConfirm.count} 个 Agent？`
            : `删除 Agent「${deleteConfirm?.kind === "single" ? deleteConfirm.name : ""}」？`
        }
        danger
        onConfirm={() => void confirmDeleteAgent()}
        onCancel={() => setDeleteConfirm(null)}
      />
    </SettingsPanel>
  );
}

export function ProvidersView({ nav }: { nav: Nav }) {
  const batch = useBatchSelection();
  const [rows, setRows] = useState<
    Array<{ id: string; displayName: string; savedCount: number; apiKeyStatus: string }>
  >([]);
  const [providerMenu, setProviderMenu] = useState<{
    providerId: string;
    x: number;
    y: number;
  } | null>(null);
  const [renamePrompt, setRenamePrompt] = useState<{
    providerId: string;
    initialName: string;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<
    | { kind: "single"; providerId: string; label: string }
    | { kind: "batch"; count: number }
    | null
  >(null);

  const reload = useCallback(async () => {
    const res = await ipcProvidersList();
    if (res.ok) setRows([...res.data]);
  }, []);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  const deleteProviders = async (providerIds: readonly string[]) => {
    for (const providerId of providerIds) {
      const res = await ipcProvidersDelete({ providerId });
      if (!res.ok) {
        toastSettingsError(res.error.message);
        return;
      }
    }
    batch.exit();
    toastSettingsSuccess(
      providerIds.length > 1
        ? `已删除 ${providerIds.length} 个服务商`
        : "已删除服务商",
    );
    await reload();
  };

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
    const res = await ipcProvidersEdit({
      providerId: prompt.providerId,
      displayName: trimmed,
    });
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
            title="服务商"
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
            hint="选择要删除的服务商"
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
          <SettingsListEmpty>暂无服务商，点击上方按钮添加。</SettingsListEmpty>
        ) : null}
        {rows.map((p) => (
          <SettingsListItem
            key={p.id}
            title={p.displayName}
            meta={
              <>
                {`${p.savedCount} 个模型 · `}
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
          { label: "重命名", action: "rename" },
          { label: "删除", action: "delete", danger: true },
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
        title="删除服务商"
        message={
          deleteConfirm?.kind === "batch"
            ? `确定删除选中的 ${deleteConfirm.count} 个服务商？`
            : `删除服务商「${deleteConfirm?.kind === "single" ? deleteConfirm.label : ""}」？`
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

export function ProviderFormView({
  nav,
  mode,
}: {
  nav: Nav;
  mode: "create" | "edit";
}) {
  const providerId = nav.navState.editingProviderId;
  const [protocol, setProtocol] = useState<"openai" | "anthropic" | "gemini">("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [headersJson, setHeadersJson] = useState("");
  const [bodyParamsJson, setBodyParamsJson] = useState("");
  const [isBuiltin, setIsBuiltin] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState("not set");

  useEffect(() => {
    if (mode !== "edit" || !providerId) return;
    ipcProvidersGet({ providerId }).then((res) => {
      if (!res.ok) return;
      setProtocol(res.data.protocol as typeof protocol);
      setBaseUrl(res.data.baseUrl);
      setDisplayName(res.data.displayName);
      setIsBuiltin(res.data.isBuiltin);
      setApiKeyStatus(res.data.apiKeyStatus);
      setHeadersJson(
        Object.keys(res.data.headers).length
          ? JSON.stringify(res.data.headers, null, 2)
          : "",
      );
      setBodyParamsJson(
        Object.keys(res.data.bodyParams ?? {}).length
          ? JSON.stringify(res.data.bodyParams, null, 2)
          : "",
      );
    });
  }, [mode, providerId]);

  const submit = async () => {
    try {
      // 自定义参数：必须是 JSON 对象（值任意 JSON）；解析失败拖 toast 阻止保存
      const parseBodyParams = (raw: string): Record<string, unknown> | undefined => {
        const trimmed = raw.trim();
        if (!trimmed) return undefined;
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("自定义参数必须是 JSON 对象");
        }
        return parsed as Record<string, unknown>;
      };
      if (mode === "create") {
        const name = displayName.trim();
        if (!name) {
          toastSettingsError("请填写服务商名称");
          return;
        }
        const res = await ipcProvidersCreate({
          protocol,
          baseUrl: baseUrl.trim(),
          displayName: name,
          apiKey: apiKey.trim(),
          headers: headersJson.trim() ? JSON.parse(headersJson) : undefined,
          bodyParams: parseBodyParams(bodyParamsJson),
        });
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
        // 空文本保存 = 显式清空自定义参数（区别于 headers 的「空文本不修改」）
        patch.bodyParams = parseBodyParams(bodyParamsJson) ?? {};
        if (!isBuiltin) patch.protocol = protocol;
        const res = await ipcProvidersEdit({ providerId, ...patch });
        if (res.ok) {
          toastSettingsSuccess("已保存");
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
        title={mode === "create" ? "新建服务商" : "编辑服务商"}
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
            {mode === "create" ? "创建" : "保存"}
          </Button>
        }
      >
        <SettingsField label="协议">
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
        <SettingsField label="服务商名称">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </SettingsField>
        <SettingsField label={mode === "edit" ? "新 API Key（留空则不修改）" : "API Key"}>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
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
        <SettingsField label="自定义参数（JSON 对象，原样合并进请求体顶层，可覆盖标准字段）">
          <textarea
            rows={4}
            value={bodyParamsJson}
            onChange={(e) => setBodyParamsJson(e.target.value)}
            onKeyDown={(e) => {
              handleMultilineSubmitKeyDown(e, () => void submit());
            }}
            placeholder='{"tool_stream": true}，清空并保存即移除全部自定义参数'
          />
        </SettingsField>
      </SettingsFormSection>
    </SettingsPanel>
  );
}

export function ProviderDetailView({ nav }: { nav: Nav }) {
  type ProviderTab = "config" | "models";
  // 默认「模型管理」（高频），与服务商配置 tab 并列；点服务商行进来后可直接切到「服务商配置」改连接信息。
  const [activeTab, setActiveTab] = useState<ProviderTab>("config");
  const batch = useBatchSelection();
  const providerId = nav.navState.editingProviderId;
  const [models, setModels] = useState<
    Array<{ id: string; vendorModelId: string; modelName: string; displayName: string }>
  >([]);
  const [modelMenu, setModelMenu] = useState<{
    savedModelId: string;
    x: number;
    y: number;
  } | null>(null);
  const [renamePrompt, setRenamePrompt] = useState<{
    savedModelId: string;
    initialName: string;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<
    | { kind: "single"; savedModelId: string; label: string }
    | { kind: "batch"; count: number }
    | null
  >(null);
  const [fetchModalOpen, setFetchModalOpen] = useState(false);
  const [addModelOpen, setAddModelOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!providerId) return;
    const res = await ipcProviderModelsSavedList({ providerId });
    if (res.ok) setModels([...res.data]);
  }, [providerId]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  if (!providerId) return <p className="settings-hint">缺少 providerId</p>;

  const deleteModels = async (savedModelIds: readonly string[]) => {
    for (const savedModelId of savedModelIds) {
      const res = await ipcProviderModelsDeleteSaved({ savedModelId, providerId });
      if (!res.ok) {
        toastSettingsError(res.error.message);
        return;
      }
    }
    batch.exit();
    toastSettingsSuccess(
      savedModelIds.length > 1
        ? `已删除 ${savedModelIds.length} 个模型`
        : "已删除模型",
    );
    await reload();
  };

  const openModelEditor = (savedModelId: string) => {
    nav.navState.editingSavedModelId = savedModelId;
    nav.push("modelSampling");
  };

  const handleRename = async (name: string) => {
    const target = renamePrompt;
    setRenamePrompt(null);
    if (!target) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      toastSettingsError("模型名称不能为空");
      return;
    }
    const res = await ipcProviderModelsEditSaved({
      savedModelId: target.savedModelId,
      modelName: trimmed,
    });
    if (!res.ok) {
      toastSettingsError(res.error.message);
      return;
    }
    toastSettingsSuccess("已更新模型名称");
    await reload();
  };

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

  const handleAddModel = async (vendorModelId: string, modelName?: string) => {
    const res = await ipcProviderModelsSave({
      providerId,
      vendorModelId,
      modelName,
    });
    if (!res.ok) {
      toastSettingsError(res.error.message);
      return;
    }
    showToast("已添加模型");
    await reload();
  };

  const duplicateVendorCount = models.reduce<Record<string, number>>((acc, m) => {
    acc[m.vendorModelId] = (acc[m.vendorModelId] ?? 0) + 1;
    return acc;
  }, {});

  const allModelsSelected =
    models.length > 0 && models.every((m) => batch.selectedIds.has(m.id));

  return (
    <div className="provider-detail">
      <div className="provider-detail__tabs">
        <SegmentedControl<ProviderTab>
          value={activeTab}
          onChange={setActiveTab}
          aria-label="服务商详情 tab"
          options={[
            { value: "config", label: "服务商配置" },
            { value: "models", label: "模型管理" },
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
            title="已保存模型"
            batchMode={batch.active}
            selectedCount={batch.selectedCount}
            onEnterBatch={batch.enter}
            onCancelBatch={batch.exit}
            allSelected={allModelsSelected}
            onSelectAll={() =>
              batch.selectRange(allModelsSelected ? [] : models.map((m) => m.id))
            }
            onDelete={() => {
              if (batch.selectedCount === 0) {
                return;
              }
              setDeleteConfirm({ kind: "batch", count: batch.selectedCount });
            }}
            hint="选择要删除的模型"
            normalActions={
              <>
                <button
                  type="button"
                  className="list-manage-header__btn"
                  onClick={() => setFetchModalOpen(true)}
                >
                  拉取模型
                </button>
                <button
                  type="button"
                  className="list-manage-header__btn list-manage-header__btn--primary"
                  onClick={() => setAddModelOpen(true)}
                >
                  添加
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
          showToast("已添加模型");
          await reload();
        }}
        onError={(message) => toastSettingsError(message)}
      />
      <AddModelModal
        open={addModelOpen}
        onClose={() => setAddModelOpen(false)}
        onConfirm={handleAddModel}
      />
      <ContextMenu
        open={modelMenu != null}
        x={modelMenu?.x ?? 0}
        y={modelMenu?.y ?? 0}
        items={[
          { label: "编辑", action: "edit" },
          { label: "重命名", action: "rename" },
          { label: "删除", action: "delete", danger: true },
        ]}
        onSelect={(action) => handleModelMenuSelect(action)}
        onClose={() => setModelMenu(null)}
      />
      <TextPromptModal
        open={renamePrompt != null}
        title="重命名模型"
        initialValue={renamePrompt?.initialName ?? ""}
        onClose={() => setRenamePrompt(null)}
        onConfirm={handleRename}
      />
      <ConfirmModal
        open={deleteConfirm != null}
        title="删除模型"
        message={
          deleteConfirm?.kind === "batch"
            ? `确定删除选中的 ${deleteConfirm.count} 个模型？`
            : `删除模型「${deleteConfirm?.kind === "single" ? deleteConfirm.label : ""}」？`
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

export function SmartSortRulesView({ nav }: { nav: Nav }) {
  const batch = useBatchSelection();
  const [rules, setRules] = useState<SmartSortRuleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ruleMenu, setRuleMenu] = useState<{
    ruleId: string;
    x: number;
    y: number;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<
    | { kind: "single"; ruleId: string; label: string }
    | { kind: "batch"; count: number }
    | null
  >(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [importConfirm, setImportConfirm] = useState(false);
  const [dragRuleId, setDragRuleId] = useState<string | null>(null);
  const [dragOverRuleId, setDragOverRuleId] = useState<string | null>(null);

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

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  const openEditor = (ruleId?: string) => {
    nav.navState.editingSmartSortRuleId = ruleId;
    nav.push("smartSortRuleEditor");
  };

  const toggleEnabled = async (rule: SmartSortRuleDto, next: boolean) => {
    const res = await ipcSmartSortRuleSetEnabled({
      ruleId: rule.ruleId,
      enabled: next,
    });
    if (!res.ok) {
      toastSettingsError(res.error.message);
      return;
    }
    const updated = res.data;
    setRules((prev) =>
      prev.map((r) => (r.ruleId === updated.ruleId ? updated : r)),
    );
  };

  const moveRule = async (
    ruleId: string,
    to: SmartSortRuleMoveRequest["to"],
  ) => {
    const res = await ipcSmartSortRuleMove({ ruleId, to });
    if (!res.ok) {
      toastSettingsError(res.error.message);
      return;
    }
    setRules([...res.data]);
  };

  const runDeleteRules = async (ruleIds: readonly string[]) => {
    const res =
      ruleIds.length === 1
        ? await ipcSmartSortRuleDelete({ ruleId: ruleIds[0]! })
        : await ipcSmartSortRuleDeleteBatch({ ruleIds });
    if (!res.ok) {
      toastSettingsError(res.error.message);
      return;
    }
    batch.exit();
    toastSettingsSuccess(
      ruleIds.length > 1 ? `已删除 ${ruleIds.length} 条规则` : "已删除规则",
    );
    await reload();
  };

  const runBatchSetEnabled = async (enabled: boolean) => {
    if (batch.selectedCount === 0) {
      return;
    }
    const res = await ipcSmartSortRuleSetEnabledBatch({
      ruleIds: [...batch.selectedIds],
      enabled,
    });
    if (!res.ok) {
      toastSettingsError(res.error.message);
      return;
    }
    toastSettingsSuccess(enabled ? "已启用所选规则" : "已禁用所选规则");
    await reload();
  };

  const runExportYaml = async () => {
    setBusy(true);
    try {
      const res = await ipcSmartSortRuleYamlExport();
      if (res.ok) {
        toastSettingsSuccess(res.data === "saved" ? "已导出规则 YAML" : "已取消");
      } else {
        toastSettingsError(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const runImportYaml = async () => {
    setImportConfirm(false);
    setBusy(true);
    try {
      const res = await ipcSmartSortRuleYamlImport();
      if (res.ok) {
        if (res.data === "imported") {
          batch.exit();
          toastSettingsSuccess("已导入并替换全部规则");
          await reload();
        } else {
          toastSettingsSuccess("已取消");
        }
      } else {
        toastSettingsError(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const runResetDefaults = async () => {
    setResetConfirm(false);
    setBusy(true);
    try {
      const res = await ipcSmartSortRuleResetDefaults();
      if (res.ok) {
        toastSettingsSuccess("已恢复默认规则");
        await reload();
      } else {
        toastSettingsError(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

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

  const menuRule = ruleMenu
    ? rules.find((r) => r.ruleId === ruleMenu.ruleId)
    : null;
  const menuItems =
    menuRule != null && isBuiltinSmartSortRule(menuRule.ruleId)
      ? [] // 内置规则仅可禁用不可删除（spec D3），隐藏删除项
      : [{ label: "删除", action: "delete", danger: true }];
  const allSelected =
    rules.length > 0 && rules.every((r) => batch.selectedIds.has(r.ruleId));

  return (
    <SettingsPanel>
      <SettingsListSection
        header={
          <ManageHeader
            title="智能排序"
            batchMode={batch.active}
            selectedCount={batch.selectedCount}
            onEnterBatch={batch.enter}
            onCancelBatch={batch.exit}
            allSelected={allSelected}
            onSelectAll={() =>
              batch.selectRange(
                allSelected ? [] : rules.map((r) => r.ruleId),
              )
            }
            onDelete={() => {
              if (batch.selectedCount === 0) {
                return;
              }
              if ([...batch.selectedIds].some(isBuiltinSmartSortRule)) {
                toastSettingsError("内置规则不可删除，仅可禁用");
                return;
              }
              setDeleteConfirm({ kind: "batch", count: batch.selectedCount });
            }}
            actions={
              batch.active
                ? [
                    {
                      label: "启用",
                      onClick: () => void runBatchSetEnabled(true),
                    },
                    {
                      label: "禁用",
                      onClick: () => void runBatchSetEnabled(false),
                    },
                  ]
                : undefined
            }
            hint="内置规则仅可禁用不可删除"
            normalActions={
              <>
                <button
                  type="button"
                  className="list-manage-header__btn"
                  disabled={busy}
                  onClick={() => setImportConfirm(true)}
                >
                  导入 YAML
                </button>
                <button
                  type="button"
                  className="list-manage-header__btn"
                  disabled={busy}
                  onClick={() => void runExportYaml()}
                >
                  导出 YAML
                </button>
                <button
                  type="button"
                  className="list-manage-header__btn"
                  disabled={busy}
                  onClick={() => setResetConfirm(true)}
                >
                  恢复默认
                </button>
                <button
                  type="button"
                  className="list-manage-header__btn list-manage-header__btn--primary"
                  onClick={() => openEditor()}
                >
                  新建规则
                </button>
              </>
            }
          />
        }
      >
        <p className="settings-hint">
          目录选「智能排序」时按本列表从上到下逐条尝试，首条命中规则的捕获组提取序号；可拖拽或用行菜单调整优先级。
        </p>
        {loading ? <SettingsListEmpty>加载中…</SettingsListEmpty> : null}
        {!loading && rules.length === 0 ? (
          <SettingsListEmpty>
            {loadFailed
              ? "加载失败，请重试。"
              : "暂无规则，点击上方按钮创建。"}
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
                      已禁用
                    </span>
                  ) : null}
                </span>
                {rule.example ? (
                  <span className="settings-row__desc">{rule.example}</span>
                ) : null}
              </span>
            </button>
            {!batch.active ? (
              <div className="smart-sort-rule__switch">
                <Switch
                  checked={rule.enabled}
                  onChange={(next) => void toggleEnabled(rule, next)}
                  aria-label={`启用 ${rule.name}`}
                />
              </div>
            ) : null}
            {!batch.active ? (
              <button
                type="button"
                className="settings-list-item__menu-btn"
                aria-label="更多"
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
          { label: "编辑", action: "edit" },
          { label: "置顶", action: "move-top" },
          { label: "上移", action: "move-up" },
          { label: "下移", action: "move-down" },
          { label: "置底", action: "move-bottom" },
          ...menuItems,
        ]}
        onSelect={(action) => handleMenuSelect(action)}
        onClose={() => setRuleMenu(null)}
      />
      <ConfirmModal
        open={deleteConfirm != null}
        title="删除规则"
        message={
          deleteConfirm?.kind === "batch"
            ? `确定删除选中的 ${deleteConfirm.count} 条规则？`
            : `删除规则「${deleteConfirm?.kind === "single" ? deleteConfirm.label : ""}」？`
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
        title="导入 YAML"
        message="导入将清空并替换当前全部规则（含内置规则），确定继续？"
        danger
        onConfirm={() => void runImportYaml()}
        onCancel={() => setImportConfirm(false)}
      />
      <ConfirmModal
        open={resetConfirm}
        title="恢复默认规则"
        message="将删除并重灌全部内置规则（自定义规则不受影响），确定继续？"
        onConfirm={() => void runResetDefaults()}
        onCancel={() => setResetConfirm(false)}
      />
    </SettingsPanel>
  );
}

/** 正则输入支持 /pattern/flags 字面量风格（core parsePatternInput 单源，
 * 与 mobile 同源）：输入框绑定原始文本 patternInput，解析结果同步进
 * draft.pattern/flags，预览/保存均消费解析值；无独立 flags UI。 */
const SMART_SORT_PREVIEW_SAMPLE =
  "第一章 开端\n第2章\n第十一章\n001、序章\nChapter 3";

type SmartSortRuleDraft = {
  name: string;
  /** 正则输入框原始文本（可能是 /pattern/flags 字面量风格）。 */
  patternInput: string;
  /** parsePatternInput(patternInput) 的解析结果（预览/保存消费）。 */
  pattern: string;
  flags: string;
  example: string;
  enabled: boolean;
};

const DEFAULT_SMART_SORT_DRAFT: SmartSortRuleDraft = {
  name: "",
  patternInput: "",
  pattern: "",
  flags: "",
  example: "",
  enabled: true,
};

/** 输入框文本同步解析为 pattern/flags（非法字面量自动当裸 pattern）。 */
function applySmartSortPatternInput(
  draft: SmartSortRuleDraft,
  text: string,
): SmartSortRuleDraft {
  return { ...draft, patternInput: text, ...parsePatternInput(text) };
}

/** 本地即时正则校验（用解析后的 pattern/flags；捕获组等严格校验仍走 service）。 */
function localSmartSortRegexError(
  draft: SmartSortRuleDraft,
): string | null {
  if (!draft.pattern) {
    return null;
  }
  try {
    new RegExp(draft.pattern, draft.flags);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * 预览规则集：库内启用规则 + 本草稿（编辑就位替换、新建置顶参与）。
 * draftRules 传入时 service 只用该集合（不叠库内规则），故须整表组装。
 */
function composePreviewDraftRules(
  allRules: readonly SmartSortRuleDto[],
  ruleId: string | undefined,
  draft: SmartSortRuleDraft,
): SmartSortRulePreviewDraftDto[] {
  const draftRule: SmartSortRulePreviewDraftDto = {
    ruleId: ruleId ?? "draft",
    name: draft.name.trim() || "（未命名草稿）",
    pattern: draft.pattern,
    flags: draft.flags,
  };
  const base: SmartSortRulePreviewDraftDto[] = [];
  for (const rule of allRules) {
    if (ruleId != null && rule.ruleId === ruleId) {
      base.push(draftRule);
    } else if (rule.enabled) {
      base.push({
        ruleId: rule.ruleId,
        name: rule.name,
        pattern: rule.pattern,
        flags: rule.flags,
      });
    }
  }
  if (ruleId == null) {
    return [draftRule, ...base];
  }
  return base;
}

export function SmartSortRuleEditorView({ nav }: { nav: Nav }) {
  // ruleId 经本地 state 镜像 navState：规则缺失回退新建时 setRuleId(undefined)
  // 才能让本组件感知（直接改 navState 不触发渲染，desktop/B-2）。
  const [ruleId, setRuleId] = useState<string | undefined>(
    nav.navState.editingSmartSortRuleId,
  );
  const [draft, setDraft] = useState<SmartSortRuleDraft>(
    DEFAULT_SMART_SORT_DRAFT,
  );
  const [allRules, setAllRules] = useState<SmartSortRuleDto[]>([]);
  const [testNames, setTestNames] = useState(SMART_SORT_PREVIEW_SAMPLE);
  const [preview, setPreview] = useState<SmartSortRulePreviewResultDto | null>(
    null,
  );
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    ipcSmartSortRuleList().then((res) => {
      if (!res.ok) {
        return;
      }
      setAllRules([...res.data]);
      if (ruleId) {
        const rule = res.data.find((r) => r.ruleId === ruleId);
        if (rule) {
          setDraft({
            name: rule.name,
            // 回显：pattern+flags 拼回 /pattern/flags 字面量风格（flags 空则裸
            // pattern），再解析回同一 pattern/flags（core 单测保障 round-trip）。
            patternInput: formatPatternInput(rule.pattern, rule.flags),
            pattern: rule.pattern,
            flags: rule.flags,
            example: rule.example ?? "",
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
  }, [ruleId, nav]);

  const regexError = localSmartSortRegexError(draft);

  const runPreview = useCallback(async () => {
    const names = testNames
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (names.length === 0) {
      setPreview(null);
      setPreviewError("请输入至少一行文件名");
      return;
    }
    const localError = localSmartSortRegexError(draft);
    if (localError != null) {
      setPreview(null);
      setPreviewError(`正则无效：${localError}`);
      return;
    }
    const res = await ipcSmartSortRulePreview({
      names,
      draftRules: composePreviewDraftRules(allRules, ruleId, draft),
    });
    if (res.ok) {
      setPreview(res.data);
      setPreviewError(null);
    } else {
      setPreview(null);
      setPreviewError(res.error.message);
    }
  }, [testNames, draft, allRules, ruleId]);

  /** 规则列表加载完成后自动试跑一次，与正则编辑器即时预览体验对齐。 */
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (autoRanRef.current || allRules.length === 0) {
      return;
    }
    autoRanRef.current = true;
    void runPreview();
  }, [allRules, runPreview]);

  const save = async () => {
    const example = draft.example.trim() || null;
    // 保存前以 trim 后的输入重新解析（避免尾随空白把字面量拆成裸 pattern）。
    const parsed = parsePatternInput(draft.patternInput.trim());
    const payload = {
      name: draft.name,
      pattern: parsed.pattern,
      flags: parsed.flags,
      example,
      enabled: draft.enabled,
    };
    if (ruleId) {
      const res = await ipcSmartSortRuleUpdate({
        ruleId,
        patch: payload,
      });
      if (res.ok) {
        toastSettingsSuccess("已保存");
        nav.pop();
      } else {
        toastSettingsError(res.error.message);
      }
      return;
    }
    const res = await ipcSmartSortRuleCreate(payload);
    if (res.ok) {
      toastSettingsSuccess("已创建");
      nav.pop();
    } else {
      toastSettingsError(res.error.message);
    }
  };

  const previewNameById = new Map(
    composePreviewDraftRules(allRules, ruleId, draft).map((r) => [
      r.ruleId,
      r.name,
    ]),
  );
  const previewText =
    preview == null
      ? ""
      : [
          ...preview.lines.map((line) => {
            const ruleName =
              line.matchedRuleId != null
                ? previewNameById.get(line.matchedRuleId) ??
                  line.matchedRuleId
                : null;
            const nums =
              line.nums == null ? "—" : `[${line.nums.join(", ")}]`;
            return `${line.name}\t${ruleName ?? "—"}\t${nums}`;
          }),
          "",
          "排序后（升序）：",
          ...preview.sortedNames.map((name, i) => `${i + 1}. ${name}`),
        ].join("\n");

  const ruleDesc = draft.name.trim() || (ruleId ? "未命名规则" : "新规则");

  return (
    <SettingsPanel>
      <SettingsFormSection
        title="排序规则"
        desc={ruleDesc}
        footer={
          <>
            <Button variant="secondary" onClick={() => void runPreview()}>
              测试预览
            </Button>
            <Button variant="primary" onClick={() => void save()}>
              保存
            </Button>
          </>
        }
      >
        <SettingsSection title="基本信息">
          <SettingsField label="名称">
            <input
              value={draft.name}
              placeholder="如 中文卷章复合"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </SettingsField>
          <SettingsField label="正则表达式">
            <textarea
              rows={2}
              value={draft.patternInput}
              placeholder="如 /第([0-9〇零一二两三四五六七八九十百千]+)章/i"
              spellCheck={false}
              onChange={(e) =>
                setDraft(applySmartSortPatternInput(draft, e.target.value))
              }
            />
          </SettingsField>
          {regexError != null ? (
            <SettingsStatus error={`正则无效：${regexError}`} inline />
          ) : null}
          <p className="settings-hint">
            支持 /正则/flags 格式，如 /第(\d+)章/i；正则须含至少一个捕获组，命中时全部捕获组须可解析为数值（中文数字自动转换），否则尝试下一条规则。
          </p>
          <SettingsField label="示例">
            <input
              value={draft.example}
              placeholder="如 第十二章 风起"
              onChange={(e) => setDraft({ ...draft, example: e.target.value })}
            />
          </SettingsField>
          <SettingsSwitchRow
            label="启用规则"
            checked={draft.enabled}
            onChange={(v) => setDraft({ ...draft, enabled: v })}
          />
        </SettingsSection>

        <SettingsSection title="测试预览">
          <p className="settings-hint">
            每行一个文件名；按当前优先级列表试跑（本草稿规则参与匹配），输出逐行命中规则与序号、以及排序后顺序。
          </p>
          <SettingsField label="示例文件名">
            <textarea
              rows={5}
              value={testNames}
              onChange={(e) => setTestNames(e.target.value)}
            />
          </SettingsField>
          <pre
            className={`settings-preview-box${
              previewError != null ? " settings-preview-box--error" : ""
            }`}
          >
            {previewError ??
              (previewText || "输入文件名后点击「测试预览」。")}
          </pre>
        </SettingsSection>
      </SettingsFormSection>
    </SettingsPanel>
  );
}
