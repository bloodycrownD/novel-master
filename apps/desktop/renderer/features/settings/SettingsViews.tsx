import { useCallback, useEffect, useState } from "react";
import type { AgentDefinition } from "@novel-master/core";
export { AgentEditorView } from "./AgentEditorView";
export { EventsConfigView } from "./EventsConfigView";
export { ModelSamplingView } from "./ModelSamplingView";
import { AddModelModal } from "./AddModelModal";
import { FetchModelsModal } from "./FetchModelsModal";
import { Button } from "../../components/ui/Button";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { ManageHeader } from "../../components/batch/ManageHeader";
import { TextPromptModal } from "../../components/ui/TextPromptModal";
import { showToast } from "../../components/ui/show-toast";
import { toastSettingsError, toastSettingsSuccess } from "../../utils/settings-feedback";
import { useBatchSelection } from "../../hooks/useBatchSelection";
import { useNovelMaster } from "../../providers/NovelMasterProvider";
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
  ipcEventsExportYaml,
  ipcEventsGetConfig,
  ipcEventsImportYaml,
  ipcEventsSetConfig,
  ipcProviderModelsDeleteSaved,
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
} from "../../ipc/client";
import type { SettingsNavState } from "./settings-nav";
import {
  SettingsActionSection,
  SettingsField,
  SettingsFormSection,
  SettingsListEmpty,
  SettingsListItem,
  SettingsListSection,
  SettingsPanel,
  SettingsSection,
  SettingsSwitchRow,
} from "./settings-ui";
import { deriveRegexGroupId } from "../../utils/regex-group-id";
import {
  parseOptionalDepthInput,
  previewRegexRule,
  regexRuleForIpc,
  validateRegexRuleDraft,
  type RegexRuleDraftFields,
} from "../../services/regex-test.service";

type Nav = {
  push: (viewId: string) => void;
  pop: () => void;
  navState: SettingsNavState;
};

export function DataManagementView() {
  const { retry } = useNovelMaster();
  const [busy, setBusy] = useState(false);
  const [confirmImport, setConfirmImport] = useState(false);

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
      <SettingsActionSection
        title="导出"
        desc="将当前数据库导出为 .nmbackup 文件，可与 mobile 互通。"
        action={
          <Button variant="primary" disabled={busy} onClick={() => void runExport()}>
            导出数据库
          </Button>
        }
      />
      <SettingsActionSection
        title="导入"
        desc="用备份文件完全替换当前数据库。本机服务商与 API Key 将保留，备份中的服务商配置不会导入。操作不可撤销。"
        action={
          <Button variant="primary" disabled={busy} onClick={() => setConfirmImport(true)}>
            导入数据库
          </Button>
        }
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
  const [rows, setRows] = useState<Array<{ agentId: string; name: string }>>([]);
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

  const createAgent = async () => {
    const res = await ipcAgentRegistryCreateBlank();
    if (res.ok) {
      nav.navState.editingAgentId = res.data.agentId;
      nav.push("agentEditor");
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
        return;
      }
      const copyId = `agent-${Date.now()}`;
      const def = getRes.data as AgentDefinition;
      const saveRes = await ipcAgentRegistryUpsert({
        agentId: copyId,
        definition: { ...def, name: `${def.name ?? row.name}-copy` },
      });
      if (saveRes.ok) {
        nav.navState.editingAgentId = copyId;
        nav.push("agentEditor");
        await reload();
      }
      return;
    }
    if (action === "delete") {
      if (rows.length <= 1) {
        showToast("至少保留一个 Agent");
        return;
      }
      setDeleteConfirm({ kind: "single", agentId: row.agentId, name: row.name });
      return;
    }
    if (action === "edit") {
      nav.navState.editingAgentId = row.agentId;
      nav.push("agentEditor");
    }
  };

  const confirmDeleteAgents = async (agentIds: readonly string[]) => {
    if (rows.length - agentIds.length < 1) {
      showToast("至少保留一个 Agent");
      return;
    }
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
      return;
    }
    const def = getRes.data as AgentDefinition;
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
            title="Agent"
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
            meta={row.agentId}
            batchMode={batch.active}
            selected={batch.isSelected(row.agentId)}
            onToggleSelect={() => batch.toggle(row.agentId)}
            onClick={() => {
              nav.navState.editingAgentId = row.agentId;
              nav.push("agentEditor");
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
            meta={`${p.savedCount} 个模型 · apiKey: ${p.apiKeyStatus}`}
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
        desc={mode === "edit" ? `apiKey: ${apiKeyStatus}` : "API Key 将通过 SKSP 安全存储"}
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
          <textarea rows={4} value={headersJson} onChange={(e) => setHeadersJson(e.target.value)} />
        </SettingsField>
      </SettingsFormSection>
    </SettingsPanel>
  );
}

export function ProviderDetailView({ nav }: { nav: Nav }) {
  const batch = useBatchSelection();
  const providerId = nav.navState.editingProviderId;
  const [models, setModels] = useState<Array<{ vendorModelId: string; displayName: string; applicationModelId: string }>>([]);
  const [modelMenu, setModelMenu] = useState<{
    vendorModelId: string;
    x: number;
    y: number;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<
    | { kind: "single"; vendorModelId: string; label: string }
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

  const deleteModels = async (vendorModelIds: readonly string[]) => {
    for (const vendorModelId of vendorModelIds) {
      const res = await ipcProviderModelsDeleteSaved({ providerId, vendorModelId });
      if (!res.ok) {
        toastSettingsError(res.error.message);
        return;
      }
    }
    batch.exit();
    toastSettingsSuccess(
      vendorModelIds.length > 1
        ? `已删除 ${vendorModelIds.length} 个模型`
        : "已删除模型",
    );
    await reload();
  };

  const openModelEditor = (vendorModelId: string, applicationModelId: string) => {
    nav.navState.editingVendorModelId = vendorModelId;
    nav.navState.editingApplicationModelId = applicationModelId;
    nav.push("modelSampling");
  };

  const handleModelMenuSelect = (action: string) => {
    const menu = modelMenu;
    setModelMenu(null);
    if (!menu) {
      return;
    }
    const model = models.find((m) => m.vendorModelId === menu.vendorModelId);
    if (!model) {
      return;
    }
    if (action === "edit") {
      openModelEditor(model.vendorModelId, model.applicationModelId);
      return;
    }
    if (action === "delete") {
      setDeleteConfirm({
        kind: "single",
        vendorModelId: model.vendorModelId,
        label: model.displayName || model.vendorModelId,
      });
    }
  };

  const handleAddModel = async (vendorModelId: string, displayName?: string) => {
    const res = await ipcProviderModelsSave({
      providerId,
      vendorModelId,
      displayName,
    });
    if (!res.ok) {
      toastSettingsError(res.error.message);
      return;
    }
    showToast("已添加模型");
    await reload();
  };

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
            key={m.vendorModelId}
            title={m.displayName || m.vendorModelId}
            meta={m.applicationModelId}
            batchMode={batch.active}
            selected={batch.isSelected(m.vendorModelId)}
            onToggleSelect={() => batch.toggle(m.vendorModelId)}
            onClick={() => openModelEditor(m.vendorModelId, m.applicationModelId)}
            onMenu={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setModelMenu({
                vendorModelId: m.vendorModelId,
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
          { label: "删除", action: "delete", danger: true },
        ]}
        onSelect={(action) => handleModelMenuSelect(action)}
        onClose={() => setModelMenu(null)}
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
          void deleteModels([target.vendorModelId]);
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
  const [preview, setPreview] = useState("");

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

  const runPreview = () => {
    const result = previewRegexRule(testText, fieldsForSave(), {
      text: testText,
      channel: "display",
      depthFromTail: 0,
      role: draft.scopeAssistant && !draft.scopeUser ? "assistant" : "user",
    });
    if (result.ok) setPreview(result.text);
    else setPreview(result.message);
  };

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
            <Button variant="secondary" onClick={runPreview}>
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
            <SettingsField label="起始深度">
              <input
                value={draft.startDepth ?? ""}
                placeholder="0"
                inputMode="numeric"
                onChange={(e) => setDraft({ ...draft, startDepth: parseOptionalDepthInput(e.target.value) })}
              />
            </SettingsField>
            <SettingsField label="结束深度">
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
          <p className="settings-hint">保存前可本地试跑，当前按「显示」通道、深度 0 预览。</p>
          <SettingsField label="样例文本">
            <input value={testText} onChange={(e) => setTestText(e.target.value)} />
          </SettingsField>
          {preview ? <pre className="settings-preview-box">{preview}</pre> : null}
        </SettingsSection>
      </SettingsFormSection>
    </SettingsPanel>
  );
}
