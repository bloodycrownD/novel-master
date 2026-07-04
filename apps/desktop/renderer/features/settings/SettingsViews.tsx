import { useCallback, useEffect, useState } from "react";
export { AgentEditorView } from "./AgentEditorView";
export { EventsConfigView } from "./EventsConfigView";
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
  ipcEventsExportYaml,
  ipcEventsGetConfig,
  ipcEventsImportYaml,
  ipcEventsSetConfig,
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
import { deriveRegexGroupId } from "@/utils/regex-group-id";
import {
  parseOptionalDepthInput,
  previewRegexReplacementOnly,
  regexRuleForIpc,
  validateRegexRuleDraft,
  type RegexChannel,
  type RegexRuleDraftFields,
} from "@/services/regex-test.service";
import { REGEX_UI_LABELS } from "@novel-master/core/config-forms/shared";
import {
  AGENT_LIST_LABELS,
  assessAgentDefinitionWire,
  storedConfigInvalidReason,
} from "@novel-master/core/config-forms/stored-config-validity";
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
      const health = assessAgentDefinitionWire(getRes.data.wire);
      if (health.status !== "valid") {
        toastSettingsError("配置已失效，请先修复后再复制");
        return;
      }
      const copyId = `agent-${Date.now()}`;
      const def = health.value;
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
    const health = assessAgentDefinitionWire(getRes.data.wire);
    if (health.status !== "valid") {
      toastSettingsError("配置已失效，请先修复后再重命名");
      return;
    }
    const def = health.value;
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
    Array<{ id: string; displayName: string | null; savedCount: number; apiKeyStatus: string }>
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
        initialName: row.displayName?.trim() || row.id,
      });
      return;
    }
    if (action === "edit") {
      nav.navState.editingProviderId = row.id;
      nav.push("providerEdit");
      return;
    }
    if (action === "delete") {
      setDeleteConfirm({
        kind: "single",
        providerId: row.id,
        label: row.displayName?.trim() || row.id,
      });
    }
  };

  const handleProviderRename = async (name: string) => {
    const prompt = renamePrompt;
    setRenamePrompt(null);
    if (!prompt) {
      return;
    }
    const res = await ipcProvidersEdit({
      providerId: prompt.providerId,
      displayName: name.trim() || null,
    });
    if (!res.ok) {
      showToast(res.error.message);
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
            title={p.displayName?.trim() || p.id}
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
          { label: "编辑", action: "edit" },
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
  const [id, setId] = useState("");
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
      setId(res.data.id);
      setProtocol(res.data.protocol as typeof protocol);
      setBaseUrl(res.data.baseUrl);
      setDisplayName(res.data.displayName ?? "");
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
        const res = await ipcProvidersCreate({
          id: id.trim(),
          protocol,
          baseUrl: baseUrl.trim(),
          displayName: displayName.trim() || undefined,
          apiKey: apiKey.trim(),
          headers: headersJson.trim() ? JSON.parse(headersJson) : undefined,
        });
        if (!res.ok) {
          toastSettingsError(res.error.message);
          return;
        }
        nav.navState.editingProviderId = id.trim();
        nav.push("providerDetail");
      } else if (providerId) {
        const patch: Record<string, unknown> = {};
        if (baseUrl.trim()) patch.baseUrl = baseUrl.trim();
        patch.displayName = displayName.trim() || null;
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
        {mode === "create" ? (
          <SettingsField label="Provider ID">
            <input value={id} onChange={(e) => setId(e.target.value)} />
          </SettingsField>
        ) : null}
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
        <SettingsField label="显示名称">
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

  return (
    <SettingsPanel>
      <SettingsListSection
        header={
          <ManageHeader
            title="已保存模型"
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
  );
}

export function RegexGroupsView({ nav }: { nav: Nav }) {
  const [rows, setRows] = useState<Array<{ groupId: string; displayName: string | null; ruleCount: number }>>([]);
  const [createPromptOpen, setCreatePromptOpen] = useState(false);
  const [groupMenu, setGroupMenu] = useState<{
    groupId: string;
    x: number;
    y: number;
  } | null>(null);
  const [renamePrompt, setRenamePrompt] = useState<{
    groupId: string;
    initialName: string;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    groupId: string;
    label: string;
  } | null>(null);

  const reload = useCallback(async () => {
    const res = await ipcRegexListGroups();
    if (!res.ok) {
      toastSettingsError(res.error.message);
      return;
    }
    setRows([...res.data]);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createGroup = async (displayName: string) => {
    const taken = new Set(rows.map((r) => r.groupId));
    const groupId = deriveRegexGroupId(displayName, taken);
    const res = await ipcRegexCreateGroup({ groupId, displayName });
    if (!res.ok) {
      toastSettingsError(res.error.message);
      throw new Error(res.error.message);
    }
    toastSettingsSuccess("已添加正则组");
    await reload();
  };

  const handleGroupMenuSelect = (action: string) => {
    const menu = groupMenu;
    setGroupMenu(null);
    if (!menu) {
      return;
    }
    const row = rows.find((r) => r.groupId === menu.groupId);
    if (!row) {
      return;
    }
    if (action === "rename") {
      setRenamePrompt({
        groupId: row.groupId,
        initialName: row.displayName?.trim() || row.groupId,
      });
      return;
    }
    if (action === "delete") {
      setDeleteConfirm({
        groupId: row.groupId,
        label: row.displayName?.trim() || row.groupId,
      });
    }
  };

  const handleGroupRename = async (name: string) => {
    const prompt = renamePrompt;
    setRenamePrompt(null);
    if (!prompt) {
      return;
    }
    const res = await ipcRegexUpdateGroup({
      groupId: prompt.groupId,
      displayName: name.trim() || null,
    });
    if (!res.ok) {
      showToast(res.error.message);
      return;
    }
    showToast("已重命名");
    await reload();
  };

  return (
    <SettingsPanel>
      <SettingsListSection
        header={
          <button
            type="button"
            className="list-manage-header__btn list-manage-header__btn--primary"
            onClick={() => setCreatePromptOpen(true)}
          >
            新建组
          </button>
        }
      >
        {rows.length === 0 ? (
          <SettingsListEmpty>暂无正则组，点击上方按钮创建。</SettingsListEmpty>
        ) : null}
        {rows.map((g) => (
          <SettingsListItem
            key={g.groupId}
            title={g.displayName?.trim() || g.groupId}
            meta={`${g.ruleCount} 条规则 · ${g.groupId}`}
            onClick={() => {
              nav.navState.editingRegexGroupId = g.groupId;
              nav.push("regexRules");
            }}
            onMenu={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setGroupMenu({
                groupId: g.groupId,
                x: Math.max(8, rect.left),
                y: Math.max(8, rect.bottom + 4),
              });
            }}
          />
        ))}
      </SettingsListSection>
      <ContextMenu
        open={groupMenu != null}
        x={groupMenu?.x ?? 0}
        y={groupMenu?.y ?? 0}
        items={[
          { label: "重命名", action: "rename" },
          { label: "删除", action: "delete", danger: true },
        ]}
        onSelect={(action) => handleGroupMenuSelect(action)}
        onClose={() => setGroupMenu(null)}
      />
      <TextPromptModal
        open={renamePrompt != null}
        title="重命名正则组"
        label="组名称"
        initialValue={renamePrompt?.initialName ?? ""}
        onClose={() => setRenamePrompt(null)}
        onConfirm={handleGroupRename}
      />
      <TextPromptModal
        open={createPromptOpen}
        title="新建正则组"
        label="组名称"
        placeholder="如 对话清洗"
        confirmLabel="创建"
        onClose={() => setCreatePromptOpen(false)}
        onConfirm={createGroup}
      />
      <ConfirmModal
        open={deleteConfirm != null}
        title="删除正则组"
        message={`删除正则组「${deleteConfirm?.label ?? ""}」？`}
        danger
        onConfirm={() => {
          const target = deleteConfirm;
          setDeleteConfirm(null);
          if (!target) {
            return;
          }
          void (async () => {
            const res = await ipcRegexDeleteGroup({ groupId: target.groupId });
            if (!res.ok) {
              toastSettingsError(res.error.message);
              return;
            }
            toastSettingsSuccess("已删除正则组");
            await reload();
          })();
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </SettingsPanel>
  );
}

export function RegexRulesView({ nav }: { nav: Nav }) {
  const groupId = nav.navState.editingRegexGroupId;
  const [rules, setRules] = useState<Array<{ ruleId: string; name: string }>>([]);

  const reload = useCallback(async () => {
    if (!groupId) return;
    const res = await ipcRegexListRules({ groupId });
    if (!res.ok) {
      toastSettingsError(res.error.message);
      return;
    }
    setRules(res.data.map((r) => ({ ruleId: r.ruleId, name: r.name })));
  }, [groupId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!groupId) return <p className="settings-hint">缺少 groupId</p>;

  return (
    <SettingsPanel>
      <SettingsListSection
        header={
          <button
            type="button"
            className="list-manage-header__btn list-manage-header__btn--primary"
            onClick={() => {
              nav.navState.editingRegexRuleId = undefined;
              nav.push("regexRuleEditor");
            }}
          >
            新建规则
          </button>
        }
      >
        {rules.length === 0 ? (
          <SettingsListEmpty>暂无规则，点击上方按钮创建。</SettingsListEmpty>
        ) : null}
        {rules.map((r) => (
          <SettingsListItem
            key={r.ruleId}
            title={r.name}
            onClick={() => {
              nav.navState.editingRegexRuleId = r.ruleId;
              nav.push("regexRuleEditor");
            }}
            onMenu={() => {
              void (async () => {
                const res = await ipcRegexDeleteRule({ groupId, ruleId: r.ruleId });
                if (!res.ok) {
                  toastSettingsError(res.error.message);
                  return;
                }
                toastSettingsSuccess("已删除规则");
                await reload();
              })();
            }}
          />
        ))}
      </SettingsListSection>
    </SettingsPanel>
  );
}

const DEFAULT_REGEX_DRAFT: RegexRuleDraftFields = {
  name: "",
  pattern: "",
  flags: "gim",
  enabled: true,
  llmReplace: null,
  displayReplace: null,
  startDepth: 0,
  endDepth: null,
  scopeUser: true,
  scopeAssistant: true,
};

export function RegexRuleEditorView({ nav }: { nav: Nav }) {
  const groupId = nav.navState.editingRegexGroupId;
  const ruleId = nav.navState.editingRegexRuleId;
  const [draft, setDraft] = useState<RegexRuleDraftFields>(DEFAULT_REGEX_DRAFT);
  const [llmOn, setLlmOn] = useState(false);
  const [displayOn, setDisplayOn] = useState(false);
  const [testText, setTestText] = useState("mysecret@email.com");
  const [testChannel, setTestChannel] = useState<RegexChannel>("display");
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    if (!groupId || !ruleId) return;
    ipcRegexGetRule({ groupId, ruleId }).then((res) => {
      if (!res.ok) return;
      const r = res.data;
      setDraft({
        name: r.name,
        pattern: r.pattern,
        flags: r.flags,
        enabled: r.enabled,
        llmReplace: r.llmReplace,
        displayReplace: r.displayReplace,
        startDepth: r.startDepth,
        endDepth: r.endDepth,
        scopeUser: r.scopeUser,
        scopeAssistant: r.scopeAssistant,
      });
      setLlmOn(r.llmReplace != null && r.llmReplace !== "");
      setDisplayOn(r.displayReplace != null && r.displayReplace !== "");
    });
  }, [groupId, ruleId]);

  if (!groupId) return <p className="settings-hint">缺少 groupId</p>;

  const fieldsForSave = (): RegexRuleDraftFields => ({
    ...draft,
    llmReplace: llmOn ? draft.llmReplace ?? "" : null,
    displayReplace: displayOn ? draft.displayReplace ?? "" : null,
  });

  const updatePreview = useCallback(() => {
    const result = previewRegexReplacementOnly(testText, fieldsForSave(), testChannel);
    if (result.ok) {
      setPreview(result.text);
      setPreviewError(false);
    } else {
      setPreview(result.message);
      setPreviewError(true);
    }
  }, [testText, testChannel, draft, llmOn, displayOn]);

  useEffect(() => {
    updatePreview();
  }, [updatePreview]);

  const save = async () => {
    const fields = regexRuleForIpc(fieldsForSave());
    const valid = validateRegexRuleDraft(fieldsForSave());
    if (!valid.ok) {
      toastSettingsError(valid.message);
      return;
    }
    if (ruleId) {
      const res = await ipcRegexUpdateRule({ groupId, ruleId, patch: fields });
      if (res.ok) {
        toastSettingsSuccess("已保存");
      } else {
        toastSettingsError(res.error.message);
      }
    } else {
      const res = await ipcRegexCreateRule({ groupId, rule: fields });
      if (res.ok) {
        toastSettingsSuccess("已创建");
        nav.navState.editingRegexRuleId = res.data.ruleId;
        nav.pop();
      } else {
        toastSettingsError(res.error.message);
      }
    }
  };

  const ruleDesc = draft.name.trim() || (ruleId ? "未命名规则" : "新规则");

  return (
    <SettingsPanel>
      <SettingsFormSection
        title="正则规则"
        desc={ruleDesc}
        footer={
          <>
            <Button variant="secondary" onClick={updatePreview}>
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
              placeholder="如 隐藏邮箱"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </SettingsField>
          <SettingsField label="正则表达式">
            <input
              value={draft.pattern}
              placeholder="如 [a-z]+@[a-z]+\\.[a-z]+"
              onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
            />
          </SettingsField>
          <SettingsField label="标志">
            <input
              value={draft.flags}
              placeholder="gim"
              onChange={(e) => setDraft({ ...draft, flags: e.target.value })}
            />
          </SettingsField>
          <p className="settings-hint">常用 gim：全局、忽略大小写、多行。</p>
          <SettingsSwitchRow label="启用规则" checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} />
        </SettingsSection>

        <SettingsSection title="深度范围">
          <p className="settings-hint">自最新消息起计数；0 表示最新一条，留空表示该侧无界。</p>
          <div className="settings-field-grid">
            <SettingsField label={REGEX_UI_LABELS.startDepth}>
              <input
                value={draft.startDepth ?? ""}
                placeholder="0"
                inputMode="numeric"
                onChange={(e) => setDraft({ ...draft, startDepth: parseOptionalDepthInput(e.target.value) })}
              />
            </SettingsField>
            <SettingsField label={REGEX_UI_LABELS.endDepth}>
              <input
                value={draft.endDepth ?? ""}
                placeholder="留空表示无界"
                inputMode="numeric"
                onChange={(e) => setDraft({ ...draft, endDepth: parseOptionalDepthInput(e.target.value) })}
              />
            </SettingsField>
          </div>
        </SettingsSection>

        <SettingsSection title="作用范围">
          <p className="settings-hint">按消息角色生效，至少选择一项。</p>
          <SettingsSwitchRow label="用户消息" checked={draft.scopeUser} onChange={(v) => setDraft({ ...draft, scopeUser: v })} />
          <SettingsSwitchRow label="助手消息" checked={draft.scopeAssistant} onChange={(v) => setDraft({ ...draft, scopeAssistant: v })} />
        </SettingsSection>

        <SettingsSection title="提示词替换">
          <SettingsSwitchRow label="改写送入模型的文本" checked={llmOn} onChange={setLlmOn} />
          {llmOn ? (
            <SettingsField label="替换为">
              <input
                value={draft.llmReplace ?? ""}
                placeholder="如 [redacted]"
                onChange={(e) => setDraft({ ...draft, llmReplace: e.target.value })}
              />
            </SettingsField>
          ) : (
            <p className="settings-hint">关闭时不改写 LLM 通道文本。</p>
          )}
        </SettingsSection>

        <SettingsSection title="显示替换">
          <SettingsSwitchRow label="改写界面展示文本" checked={displayOn} onChange={setDisplayOn} />
          {displayOn ? (
            <SettingsField label="替换为">
              <input
                value={draft.displayReplace ?? ""}
                placeholder="如 ***"
                onChange={(e) => setDraft({ ...draft, displayReplace: e.target.value })}
              />
            </SettingsField>
          ) : (
            <p className="settings-hint">关闭时不改写界面展示文本。</p>
          )}
        </SettingsSection>

        <SettingsSection title="测试预览">
          <p className="settings-hint">对样例文本应用所选通道的替换规则；保存前可本地试跑。</p>
          <SettingsField label="样例文本">
            <input value={testText} onChange={(e) => setTestText(e.target.value)} />
          </SettingsField>
          <SettingsField label="预览通道">
            <SegmentedControl
              value={testChannel}
              options={[
                { value: "display", label: REGEX_UI_LABELS.displayChannel },
                { value: "llm", label: REGEX_UI_LABELS.promptChannel },
              ]}
              onChange={setTestChannel}
              aria-label="预览通道"
            />
          </SettingsField>
          <pre
            className={`settings-preview-box${previewError ? " settings-preview-box--error" : ""}`}
          >
            {preview}
          </pre>
        </SettingsSection>
      </SettingsFormSection>
    </SettingsPanel>
  );
}
