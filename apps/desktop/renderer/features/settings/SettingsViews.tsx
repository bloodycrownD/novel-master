import { useCallback, useEffect, useState } from "react";
import { parseApplicationModelId } from "@novel-master/core";
import type { AgentDefinition } from "@novel-master/core";
import { Button } from "../../components/ui/Button";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { TextPromptModal } from "../../components/ui/TextPromptModal";
import { showToast } from "../../components/ui/toast";
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
  ipcCompactionConditionsGet,
  ipcCompactionConditionsSet,
  ipcEventsExportYaml,
  ipcEventsGetConfig,
  ipcEventsImportYaml,
  ipcEventsSetConfig,
  ipcProviderModelsDeleteSaved,
  ipcProviderModelsFetch,
  ipcProviderModelsGetSaved,
  ipcProviderModelsResetContextWindow,
  ipcProviderModelsSavedList,
  ipcProviderModelsSave,
  ipcProviderModelsSuggestList,
  ipcProviderModelsUpdateSettings,
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
  ipcRegexUpdateRule,
  rebootstrap,
} from "../../ipc/client";
import { WorkspaceTree } from "../workspace/WorkspaceTree";
import type { SettingsNavState } from "./settings-nav";
import {
  SettingsActionSection,
  SettingsField,
  SettingsFormSection,
  SettingsListItem,
  SettingsListSection,
  SettingsPanel,
  SettingsStatus,
  SettingsSwitchRow,
} from "./settings-ui";
import {
  parseOptionalDepthInput,
  previewRegexRule,
  validateRegexRuleDraft,
  type RegexRuleDraftFields,
} from "../../services/regex-test.service";

type Nav = {
  push: (viewId: string) => void;
  navState: SettingsNavState;
};

export function DataManagementView() {
  const { retry } = useNovelMaster();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const [confirmImport, setConfirmImport] = useState(false);

  const runExport = async () => {
    setBusy(true);
    setStatus(undefined);
    try {
      const res = await ipcBackupExport();
      if (res.ok) {
        setStatus(res.data === "saved" ? "已导出数据库" : "已取消");
      } else {
        setStatus(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    setConfirmImport(false);
    setBusy(true);
    setStatus(undefined);
    try {
      const res = await ipcBackupImport();
      if (res.ok) {
        if (res.data === "imported") {
          await rebootstrap();
          retry();
          setStatus("已导入并重新加载");
        } else {
          setStatus("已取消");
        }
      } else {
        setStatus(res.error.message);
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
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void runExport()}>
            导出数据库
          </button>
        }
      />
      <SettingsActionSection
        title="导入"
        desc="用备份文件完全替换当前数据库，操作不可撤销。"
        action={
          <Button variant="primary" disabled={busy} onClick={() => setConfirmImport(true)}>
            导入数据库
          </Button>
        }
      />
      <SettingsStatus message={status} />
      <ConfirmModal
        open={confirmImport}
        title="确认导入"
        message="导入将完全替换当前数据库，确定继续？"
        danger
        busy={busy}
        onConfirm={() => void runImport()}
        onCancel={() => !busy && setConfirmImport(false)}
      />
    </SettingsPanel>
  );
}

export function AgentsSettingsView({ nav }: { nav: Nav }) {
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
  const [deleteConfirm, setDeleteConfirm] = useState<{
    agentId: string;
    name: string;
  } | null>(null);

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
      setDeleteConfirm({ agentId: row.agentId, name: row.name });
    }
  };

  const confirmDeleteAgent = async () => {
    const target = deleteConfirm;
    setDeleteConfirm(null);
    if (!target) {
      return;
    }
    const currentRes = await ipcAgentResolveCurrent();
    await ipcAgentRegistryDelete({ agentId: target.agentId });
    if (currentRes.ok && currentRes.data.agentId === target.agentId) {
      const remaining = rows
        .map((r) => r.agentId)
        .filter((id) => id !== target.agentId);
      if (remaining.length > 0) {
        await ipcAgentSetCurrent({ agentId: remaining[0]! });
      }
    }
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
          <button type="button" className="btn-primary" onClick={() => void createAgent()}>
            新建 Agent
          </button>
        }
      >
        {loading ? <p className="settings-hint">加载中…</p> : null}
        {rows.map((row) => (
          <SettingsListItem
            key={row.agentId}
            title={row.name}
            meta={row.agentId}
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
        message={`删除 Agent「${deleteConfirm?.name ?? ""}」？`}
        danger
        onConfirm={() => void confirmDeleteAgent()}
        onCancel={() => setDeleteConfirm(null)}
      />
    </SettingsPanel>
  );
}

export function AgentEditorView({ nav }: { nav: Nav }) {
  const agentId = nav.navState.editingAgentId;
  const [name, setName] = useState("");
  const [maxSteps, setMaxSteps] = useState("20");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [status, setStatus] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    ipcAgentRegistryGet({ agentId })
      .then((res) => {
        if (!res.ok) return;
        const def = res.data as AgentDefinition;
        setName(def.name ?? "");
        setMaxSteps(String(def.runtime?.maxSteps ?? 20));
        const system = def.prompts?.find(
          (p) => p.type === "text" && p.role === "system",
        );
        setSystemPrompt(system && "content" in system ? system.content : "");
      })
      .finally(() => setLoading(false));
  }, [agentId]);

  if (!agentId) {
    return <p className="settings-hint">缺少 agentId</p>;
  }

  const save = async () => {
    const res = await ipcAgentRegistryGet({ agentId });
    if (!res.ok) return;
    const prev = res.data as AgentDefinition;
    const prompts = [...(prev.prompts ?? [])];
    const idx = prompts.findIndex((p) => p.type === "text" && p.role === "system");
    const systemBlock = {
      name: "system",
      type: "text" as const,
      role: "system" as const,
      content: systemPrompt,
    };
    if (idx >= 0) prompts[idx] = systemBlock;
    else prompts.unshift(systemBlock);

    const next: AgentDefinition = {
      ...prev,
      name: name.trim() || agentId,
      runtime: { ...prev.runtime, maxSteps: Number(maxSteps) || 20 },
      prompts,
    };
    const saveRes = await ipcAgentRegistryUpsert({ agentId, definition: next });
    setStatus(saveRes.ok ? "已保存" : saveRes.error.message);
  };

  return (
    <SettingsPanel>
      {loading ? <p className="settings-hint">加载中…</p> : null}
      <SettingsFormSection
        title="Agent 配置"
        desc={`编辑 ${agentId}`}
        footer={
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn-primary" onClick={() => void save()}>
              保存
            </button>
            <button
              type="button"
              onClick={() =>
                void ipcAgentYamlExport({ agentId }).then((r) =>
                  setStatus(r.ok ? (r.data === "saved" ? "已导出 YAML" : "已取消") : r.error.message),
                )
              }
            >
              导出 YAML
            </button>
            <button
              type="button"
              onClick={() =>
                void ipcAgentYamlImport({ agentId }).then((r) => {
                  if (r.ok && r.data === "imported") window.location.reload();
                  else if (r.ok) setStatus("已取消");
                  else setStatus(r.error.message);
                })
              }
            >
              导入 YAML
            </button>
          </div>
        }
      >
        <SettingsField label="名称">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </SettingsField>
        <SettingsField label="最大步数">
          <input type="number" value={maxSteps} onChange={(e) => setMaxSteps(e.target.value)} />
        </SettingsField>
        <SettingsField label="System 提示词">
          <textarea rows={6} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
        </SettingsField>
      </SettingsFormSection>
      <SettingsStatus message={status} />
    </SettingsPanel>
  );
}

export function ProvidersView({ nav }: { nav: Nav }) {
  const [rows, setRows] = useState<
    Array<{ id: string; displayName: string | null; savedCount: number; apiKeyStatus: string }>
  >([]);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    providerId: string;
    label: string;
  } | null>(null);

  const reload = useCallback(async () => {
    const res = await ipcProvidersList();
    if (res.ok) setRows([...res.data]);
  }, []);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  return (
    <SettingsPanel>
      <SettingsListSection
        header={
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              nav.navState.editingProviderId = undefined;
              nav.push("providerCreate");
            }}
          >
            新建服务商
          </button>
        }
      >
        {rows.map((p) => (
          <SettingsListItem
            key={p.id}
            title={p.displayName?.trim() || p.id}
            meta={`${p.savedCount} 个模型 · apiKey: ${p.apiKeyStatus}`}
            onClick={() => {
              nav.navState.editingProviderId = p.id;
              nav.push("providerDetail");
            }}
            onMenu={() => {
              setDeleteConfirm({
                providerId: p.id,
                label: p.displayName ?? p.id,
              });
            }}
          />
        ))}
      </SettingsListSection>
      <ConfirmModal
        open={deleteConfirm != null}
        title="删除服务商"
        message={`删除服务商「${deleteConfirm?.label ?? ""}」？`}
        danger
        onConfirm={() => {
          const target = deleteConfirm;
          setDeleteConfirm(null);
          if (target) {
            void ipcProvidersDelete({ providerId: target.providerId }).then(() => reload());
          }
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
  const [status, setStatus] = useState<string | undefined>();

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
          setStatus(res.error.message);
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
        setStatus(res.ok ? "已保存" : res.error.message);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SettingsPanel>
      <SettingsFormSection
        title={mode === "create" ? "新建服务商" : "编辑服务商"}
        desc={mode === "edit" ? `apiKey: ${apiKeyStatus}` : "API Key 将通过 SKSP 安全存储"}
        footer={
          <button type="button" className="btn-primary" onClick={() => void submit()}>
            {mode === "create" ? "创建" : "保存"}
          </button>
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
      <SettingsStatus message={status} />
    </SettingsPanel>
  );
}

export function ProviderDetailView({ nav }: { nav: Nav }) {
  const providerId = nav.navState.editingProviderId;
  const [models, setModels] = useState<Array<{ vendorModelId: string; displayName: string; applicationModelId: string }>>([]);
  const [suggestions, setSuggestions] = useState<Array<{ vendorModelId: string; displayName: string }>>([]);
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState<string | undefined>();

  const reload = useCallback(async () => {
    if (!providerId) return;
    const res = await ipcProviderModelsSavedList({ providerId });
    if (res.ok) setModels([...res.data]);
  }, [providerId]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  if (!providerId) return <p className="settings-hint">缺少 providerId</p>;

  const fetchModels = async () => {
    setFetching(true);
    try {
      const res = await ipcProviderModelsFetch({ providerId });
      if (!res.ok) {
        setStatus(res.error.message);
        return;
      }
      const sug = await ipcProviderModelsSuggestList({ providerId });
      if (sug.ok) setSuggestions(sug.data.map((m) => ({ vendorModelId: m.vendorModelId, displayName: m.displayName })));
    } finally {
      setFetching(false);
    }
  };

  return (
    <SettingsPanel>
      <SettingsListSection
        header={
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn-primary" disabled={fetching} onClick={() => void fetchModels()}>
              {fetching ? "拉取中…" : "拉取模型"}
            </button>
            <Button variant="secondary" onClick={() => nav.push("providerEdit")}>
              编辑服务商
            </Button>
          </div>
        }
      >
        {models.map((m) => (
          <SettingsListItem
            key={m.vendorModelId}
            title={m.displayName || m.vendorModelId}
            meta={m.applicationModelId}
            onClick={() => {
              nav.navState.editingVendorModelId = m.vendorModelId;
              nav.navState.editingApplicationModelId = m.applicationModelId;
              nav.push("modelSampling");
            }}
            onMenu={() => {
              void ipcProviderModelsDeleteSaved({ providerId, vendorModelId: m.vendorModelId }).then(() => reload());
            }}
          />
        ))}
      </SettingsListSection>
      {suggestions.length > 0 ? (
        <SettingsListSection header={<span className="settings-hint">建议模型（点击保存）</span>}>
          {suggestions.map((s) => (
            <SettingsListItem
              key={s.vendorModelId}
              title={s.displayName || s.vendorModelId}
              onClick={() =>
                void ipcProviderModelsSave({ providerId, vendorModelId: s.vendorModelId, displayName: s.displayName }).then(
                  () => reload(),
                )
              }
            />
          ))}
        </SettingsListSection>
      ) : null}
      <SettingsStatus message={status} />
    </SettingsPanel>
  );
}

export function ModelSamplingView({ nav }: { nav: Nav }) {
  const applicationModelId = nav.navState.editingApplicationModelId;
  const [contextWindow, setContextWindow] = useState("");
  const [temperature, setTemperature] = useState("");
  const [status, setStatus] = useState<string | undefined>();

  useEffect(() => {
    if (!applicationModelId) return;
    ipcProviderModelsGetSaved({ applicationModelId }).then((res) => {
      if (!res.ok || !res.data) return;
      const saved = res.data as {
        settings: {
          contextWindowTokens: number;
          sampling?: { enabled: boolean; params?: { protocol: string; openai?: { temperature?: number } } };
        };
      };
      setContextWindow(String(saved.settings.contextWindowTokens));
      const temp = saved.settings.sampling?.params?.openai?.temperature;
      setTemperature(temp != null ? String(temp) : "");
    });
  }, [applicationModelId]);

  if (!applicationModelId) return <p className="settings-hint">缺少模型</p>;

  const save = async () => {
    const { providerId, vendorModelId } = parseApplicationModelId(applicationModelId);
    const cw = Number(contextWindow);
    if (!Number.isInteger(cw) || cw <= 0) {
      setStatus("上下文上限须为正整数");
      return;
    }
    const temp = temperature.trim() ? Number(temperature) : undefined;
    const sampling =
      temp == null
        ? { enabled: false as const }
        : {
            enabled: true as const,
            params: { protocol: "openai" as const, openai: { temperature: temp } },
          };
    const res = await ipcProviderModelsUpdateSettings({
      providerId,
      vendorModelId,
      contextWindowTokens: cw,
      tokenCounterMode: "auto",
      sampling,
    });
    setStatus(res.ok ? "已保存" : res.error.message);
  };

  return (
    <SettingsPanel>
      <SettingsFormSection
        title="采样配置"
        desc={applicationModelId}
        footer={
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn-primary" onClick={() => void save()}>
              保存
            </button>
            <button
              type="button"
              onClick={() => {
                const { providerId, vendorModelId } = parseApplicationModelId(applicationModelId);
                void ipcProviderModelsResetContextWindow({ providerId, vendorModelId }).then((r) => {
                  if (r.ok && r.data) {
                    const saved = r.data as { settings: { contextWindowTokens: number } };
                    setContextWindow(String(saved.settings.contextWindowTokens));
                    setTemperature("");
                    setStatus("已恢复默认");
                  }
                });
              }}
            >
              恢复默认
            </button>
          </div>
        }
      >
        <SettingsField label="上下文 Token 上限">
          <input type="number" value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} />
        </SettingsField>
        <SettingsField label="温度 (OpenAI)">
          <input type="number" step="0.1" min="0" max="2" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
        </SettingsField>
      </SettingsFormSection>
      <SettingsStatus message={status} />
    </SettingsPanel>
  );
}

export function CompactionConditionsView() {
  const [enabled, setEnabled] = useState(false);
  const [tokenRatio, setTokenRatio] = useState("0.8");
  const [visibleFloor, setVisibleFloor] = useState("20");
  const [status, setStatus] = useState<string | undefined>();

  useEffect(() => {
    ipcCompactionConditionsGet().then((res) => {
      if (!res.ok || !res.data) return;
      setEnabled(res.data.enabled);
      setTokenRatio(res.data.tokenRatio != null ? String(res.data.tokenRatio) : "");
      setVisibleFloor(res.data.visibleFloor != null ? String(res.data.visibleFloor) : "");
    });
  }, []);

  const save = async () => {
    const res = await ipcCompactionConditionsSet({
      conditions: {
        schemaVersion: 3,
        enabled,
        ...(tokenRatio.trim() ? { tokenRatio: Number(tokenRatio) } : {}),
        ...(visibleFloor.trim() ? { visibleFloor: Number(visibleFloor) } : {}),
      },
    });
    setStatus(res.ok ? "已保存" : res.error.message);
  };

  return (
    <SettingsPanel>
      <SettingsFormSection
        title="压缩条件"
        desc="达到阈值时触发会话压缩。"
        footer={
          <button type="button" className="btn-primary" onClick={() => void save()}>
            保存
          </button>
        }
      >
        <SettingsSwitchRow
          label="启用自动压缩"
          checked={enabled}
          onChange={setEnabled}
        />
        {enabled ? (
          <>
            <SettingsField label="Token 比例">
              <input type="number" step="0.01" min="0.01" max="1" value={tokenRatio} onChange={(e) => setTokenRatio(e.target.value)} />
            </SettingsField>
            <SettingsField label="可见条数阈值">
              <input type="number" min="0" value={visibleFloor} onChange={(e) => setVisibleFloor(e.target.value)} />
            </SettingsField>
          </>
        ) : null}
      </SettingsFormSection>
      <SettingsStatus message={status} />
    </SettingsPanel>
  );
}

export function EventsConfigView() {
  const [jsonText, setJsonText] = useState("{}");
  const [status, setStatus] = useState<string | undefined>();

  useEffect(() => {
    ipcEventsGetConfig().then((res) => {
      if (res.ok) setJsonText(JSON.stringify(res.data, null, 2));
    });
  }, []);

  const save = async () => {
    try {
      const config = JSON.parse(jsonText);
      const res = await ipcEventsSetConfig({ config });
      setStatus(res.ok ? "已保存" : res.error.message);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "JSON 无效");
    }
  };

  return (
    <SettingsPanel>
      <SettingsFormSection
        title="事件配置"
        desc="编辑 events.config JSON；也可用 YAML 导入导出。"
        footer={
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn-primary" onClick={() => void save()}>
              保存
            </button>
            <button
              type="button"
              onClick={() =>
                void ipcEventsExportYaml().then((r) =>
                  setStatus(r.ok ? (r.data === "saved" ? "已导出 YAML" : "已取消") : r.error.message),
                )
              }
            >
              导出 YAML
            </button>
            <button
              type="button"
              onClick={() =>
                void ipcEventsImportYaml().then((r) => {
                  if (r.ok && r.data === "imported") {
                    ipcEventsGetConfig().then((cfg) => {
                      if (cfg.ok) setJsonText(JSON.stringify(cfg.data, null, 2));
                    });
                    setStatus("已导入 YAML");
                  } else if (r.ok) setStatus("已取消");
                  else setStatus(r.error.message);
                })
              }
            >
              导入 YAML
            </button>
          </div>
        }
      >
        <textarea rows={16} value={jsonText} onChange={(e) => setJsonText(e.target.value)} style={{ width: "100%", fontFamily: "monospace" }} />
      </SettingsFormSection>
      <SettingsStatus message={status} />
    </SettingsPanel>
  );
}

export function RegexGroupsView({ nav }: { nav: Nav }) {
  const [rows, setRows] = useState<Array<{ groupId: string; displayName: string | null; ruleCount: number }>>([]);
  const [newId, setNewId] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await ipcRegexListGroups();
    if (res.ok) setRows([...res.data]);
  }, []);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  const createGroup = async () => {
    const groupId = newId.trim() || `group-${Date.now()}`;
    await ipcRegexCreateGroup({ groupId });
    setNewId("");
    await reload();
  };

  return (
    <SettingsPanel>
      <SettingsListSection
        header={
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input placeholder="groupId" value={newId} onChange={(e) => setNewId(e.target.value)} />
            <button type="button" className="btn-primary" onClick={() => void createGroup()}>
              新建组
            </button>
          </div>
        }
      >
        {rows.map((g) => (
          <SettingsListItem
            key={g.groupId}
            title={g.displayName?.trim() || g.groupId}
            meta={`${g.ruleCount} 条规则`}
            onClick={() => {
              nav.navState.editingRegexGroupId = g.groupId;
              nav.push("regexRules");
            }}
            onMenu={() => {
              setDeleteConfirm(g.groupId);
            }}
          />
        ))}
      </SettingsListSection>
      <ConfirmModal
        open={deleteConfirm != null}
        title="删除正则组"
        message={`删除正则组「${deleteConfirm ?? ""}」？`}
        danger
        onConfirm={() => {
          const groupId = deleteConfirm;
          setDeleteConfirm(null);
          if (groupId) {
            void ipcRegexDeleteGroup({ groupId }).then(() => reload());
          }
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
    if (res.ok) setRules(res.data.map((r) => ({ ruleId: r.ruleId, name: r.name })));
  }, [groupId]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  if (!groupId) return <p className="settings-hint">缺少 groupId</p>;

  return (
    <SettingsPanel>
      <SettingsListSection
        header={
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              nav.navState.editingRegexRuleId = undefined;
              nav.push("regexRuleEditor");
            }}
          >
            新建规则
          </button>
        }
      >
        {rules.map((r) => (
          <SettingsListItem
            key={r.ruleId}
            title={r.name}
            onClick={() => {
              nav.navState.editingRegexRuleId = r.ruleId;
              nav.push("regexRuleEditor");
            }}
            onMenu={() => {
              void ipcRegexDeleteRule({ groupId, ruleId: r.ruleId }).then(() => reload());
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
  const [status, setStatus] = useState<string | undefined>();

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
    const fields = fieldsForSave();
    const valid = validateRegexRuleDraft(fields);
    if (!valid.ok) {
      setStatus(valid.message);
      return;
    }
    if (ruleId) {
      const res = await ipcRegexUpdateRule({ groupId, ruleId, patch: fields });
      setStatus(res.ok ? "已保存" : res.error.message);
    } else {
      const res = await ipcRegexCreateRule({ groupId, rule: fields });
      if (res.ok) {
        nav.navState.editingRegexRuleId = res.data.ruleId;
        setStatus("已创建");
      } else {
        setStatus(res.error.message);
      }
    }
  };

  return (
    <SettingsPanel>
      <SettingsFormSection
        title="正则规则"
        desc={ruleId ?? "新规则"}
        footer={
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn-primary" onClick={() => void save()}>
              保存
            </button>
            <button type="button" onClick={runPreview}>
              测试预览
            </button>
          </div>
        }
      >
        <SettingsField label="名称">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </SettingsField>
        <SettingsField label="模式">
          <input value={draft.pattern} onChange={(e) => setDraft({ ...draft, pattern: e.target.value })} />
        </SettingsField>
        <SettingsField label="Flags">
          <input value={draft.flags} onChange={(e) => setDraft({ ...draft, flags: e.target.value })} />
        </SettingsField>
        <SettingsSwitchRow label="启用" checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} />
        <SettingsSwitchRow label="作用 user" checked={draft.scopeUser} onChange={(v) => setDraft({ ...draft, scopeUser: v })} />
        <SettingsSwitchRow label="作用 assistant" checked={draft.scopeAssistant} onChange={(v) => setDraft({ ...draft, scopeAssistant: v })} />
        <SettingsSwitchRow label="llmReplace" checked={llmOn} onChange={setLlmOn} />
        {llmOn ? (
          <SettingsField label="llmReplace">
            <input value={draft.llmReplace ?? ""} onChange={(e) => setDraft({ ...draft, llmReplace: e.target.value })} />
          </SettingsField>
        ) : null}
        <SettingsSwitchRow label="displayReplace" checked={displayOn} onChange={setDisplayOn} />
        {displayOn ? (
          <SettingsField label="displayReplace">
            <input value={draft.displayReplace ?? ""} onChange={(e) => setDraft({ ...draft, displayReplace: e.target.value })} />
          </SettingsField>
        ) : null}
        <SettingsField label="startDepth">
          <input
            value={draft.startDepth ?? ""}
            onChange={(e) => setDraft({ ...draft, startDepth: parseOptionalDepthInput(e.target.value) })}
          />
        </SettingsField>
        <SettingsField label="endDepth">
          <input
            value={draft.endDepth ?? ""}
            onChange={(e) => setDraft({ ...draft, endDepth: parseOptionalDepthInput(e.target.value) })}
          />
        </SettingsField>
        <SettingsField label="测试文本">
          <input value={testText} onChange={(e) => setTestText(e.target.value)} />
        </SettingsField>
        {preview ? <pre className="settings-hint">{preview}</pre> : null}
      </SettingsFormSection>
      <SettingsStatus message={status} />
    </SettingsPanel>
  );
}

export function GlobalTemplateView() {
  const [refreshToken, setRefreshToken] = useState(0);
  return (
    <SettingsPanel>
      <section className="settings-section">
        <h3 className="settings-section__title">全局模板文件</h3>
        <p className="settings-section__desc">
          全应用共享；项目可通过「从上级同步」拉取此处工作区内容。
        </p>
      </section>
      <div id="settings-global-tree" className="settings-embedded-tree">
        <WorkspaceTree
          panelScope="global"
          refreshToken={refreshToken}
          onOpenContextMenu={() => undefined}
          onBlankContextMenu={() => undefined}
        />
      </div>
    </SettingsPanel>
  );
}
