import { useCallback, useEffect, useState } from "react";
export { AgentEditorView } from "./AgentEditorView";


export { ModelSamplingView } from "./ModelSamplingView";
import { AddModelModal } from "./AddModelModal";
import { FetchModelsModal } from "./FetchModelsModal";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
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
  ipcRegexCreateGroup,
  ipcRegexCreateRule,
  ipcRegexDeleteGroup,
  ipcRegexDeleteRule,
  ipcRegexGetRule,
  ipcRegexListGroups,
  ipcRegexListRules,
  ipcRegexUpdateGroup,
  ipcRegexUpdateRule,
} from "@/ipc/client";
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
  SettingsSection,
} from "./settings-ui";
import {
  AGENT_LIST_LABELS,
  storedConfigInvalidReason,
} from "@shared/logic/config-forms-stored-config-validity";
import type { AgentRegistryListItemDto } from "@shared/ipc-types";

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
    });
  }, [mode, providerId]);

  const submit = async () => {
    try {
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
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </SettingsField>
        <SettingsField label="服务商名称">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
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
