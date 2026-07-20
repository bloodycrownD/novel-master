import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { type AgentDefinition } from "@novel-master/core/agent";

import {
  type DynamicPromptBlock,
  type PersistPromptBlock,
  type PersistTextPromptBlock,
} from "@novel-master/core/prompt";
import {
  ROLE_OPTIONS,
  TOOL_MODE_OPTIONS,
  PROMPT_REGION_LABELS,
  WORKPLACE_BLOCK_LABEL,
  WORKPLACE_BLOCK_HINT,
  blockTypeLabel,
  buildAgentDefinitionFromForm,
  countEffectiveFormPromptSources,
  countFormPromptSources,
  createDefaultDynamicTextBlock,
  createDefaultPersistTextBlock,
  definitionToForm,
  deletePersistTextBlock,
  formSnapshotJson,
  hasAnyPromptRegionEnabled,
  mapPersistTextBlocks,
  movePersistTextBlock,
  toolsSelectionFromDefinition,
  isDynamicBlockPersistent,
  withDynamicBlockPersistence,
  type ToolsMode,
} from "@novel-master/core/config-forms/agent";
import { ToolPolicyPicker } from "./ToolPolicyPicker";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { showToast } from "@/components/ui/show-toast";
import {
  toastSettingsError,
  toastSettingsSuccess,
} from "@/utils/settings-feedback";
import {
  ipcAgentRegistryDelete,
  ipcAgentRegistryGet,
  ipcAgentRegistryUpsert,
  ipcAgentYamlExport,
  ipcAgentYamlImport,
  ipcProviderModelsGetSaved,
  ipcProviderModelsSavedList,
  ipcProvidersList,
} from "@/ipc/client";
import {
  assessAgentDefinitionWire,
  buildDefaultAgentDefinitionPreservingName,
  STORED_CONFIG_LABELS,
  storedConfigInvalidReason,
  type StoredConfigHealth,
} from "@novel-master/core/config-forms/stored-config-validity";
import type { SettingsNavHandle } from "./settings-nav";
import {
  SettingsField,
  SettingsFormSection,
  SettingsPanel,
  SettingsSection,
} from "./settings-ui";
import { Switch } from "@/components/ui/Switch";
import { handleMultilineSubmitKeyDown } from "@/utils/textarea-enter-shortcuts";
import { PromptMacroTextarea } from "./PromptMacroTextarea";
import {
  PROMPT_INSERTABLE_MACROS,
  insertTextAtSelection,
} from "./prompt-macro-input";
import type { RefObject } from "react";

/** 非当前编辑块共用的空 ref（芯片插入只针对聚焦块）。 */
const inactiveDynamicTextareaRef: RefObject<HTMLTextAreaElement | null> = {
  current: null,
};

type Nav = SettingsNavHandle;

/** 从 wire 尽力读取显示名称。 */
function readAgentNameFromWire(raw: unknown, fallback: string): string {
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const name = (raw as Record<string, unknown>).name;
    if (typeof name === "string") {
      const trimmed = name.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return fallback;
}

export function AgentEditorView({ nav }: { nav: Nav }) {
  const agentId = nav.navState.editingAgentId;
  const [name, setName] = useState("");
  const [maxSteps, setMaxSteps] = useState("20");
  const [modelEnabled, setModelEnabled] = useState(false);
  const [providerId, setProviderId] = useState("");
  const [savedModelId, setSavedModelId] = useState("");
  const [systemEnabled, setSystemEnabled] = useState(false);
  const [systemContent, setSystemContent] = useState("");
  const [persistEnabled, setPersistEnabled] = useState(false);
  const [dynamicEnabled, setDynamicEnabled] = useState(false);
  const [workplace, setWorkplace] = useState(false);
  const [persist, setPersist] = useState<PersistPromptBlock[]>([]);
  const [dynamic, setDynamic] = useState<DynamicPromptBlock[]>([]);
  const [toolsMode, setToolsMode] = useState<ToolsMode>("default");
  const [toolsSelected, setToolsSelected] = useState<string[]>([]);
  const [providers, setProviders] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [savedModels, setSavedModels] = useState<
    Array<{ id: string; vendorModelId: string; displayName: string }>
  >([]);
  const [savedBaseline, setSavedBaseline] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invalidHealth, setInvalidHealth] = useState<Extract<
    StoredConfigHealth<AgentDefinition>,
    { status: "invalid" }
  > | null>(null);
  const [storedWire, setStoredWire] = useState<unknown | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmImport, setConfirmImport] = useState(false);
  const dynamicTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [dynamicInsertIndex, setDynamicInsertIndex] = useState<number | null>(
    null
  );

  const snapshot = useMemo(
    () =>
      formSnapshotJson({
        name,
        maxSteps,
        modelEnabled,
        providerId,
        savedModelId: savedModelId,
        toolsMode,
        toolsSelected,
        systemEnabled,
        systemContent,
        persistEnabled,
        dynamicEnabled,
        workplace,
        persist,
        dynamic,
      }),
    [
      name,
      maxSteps,
      modelEnabled,
      providerId,
      savedModelId,
      toolsMode,
      toolsSelected,
      systemEnabled,
      systemContent,
      persistEnabled,
      dynamicEnabled,
      workplace,
      persist,
      dynamic,
    ]
  );

  const loadSavedModels = useCallback(async (pid: string) => {
    const res = await ipcProviderModelsSavedList({ providerId: pid });
    if (res.ok) {
      setSavedModels(
        res.data.map((m) => ({
          id: m.id,
          vendorModelId: m.vendorModelId,
          displayName: m.displayName?.trim() || m.vendorModelId,
        }))
      );
    }
  }, []);

  const resolveSavedModelPin = useCallback(
    async (modelPin: string | undefined) => {
      if (modelPin == null || modelPin === "") {
        return { modelOn: false, providerId: "", savedModelId: "" };
      }
      const res = await ipcProviderModelsGetSaved({ savedModelId: modelPin });
      if (res.ok && res.data != null) {
        return {
          modelOn: true,
          providerId: res.data.providerId,
          savedModelId: modelPin,
        };
      }
      return { modelOn: false, providerId: "", savedModelId: "" };
    },
    []
  );

  const loadAgent = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setLoadError(null);
    setInvalidHealth(null);
    setStoredWire(null);
    try {
      const [agentRes, providerRes] = await Promise.all([
        ipcAgentRegistryGet({ agentId }),
        ipcProvidersList(),
      ]);
      if (!agentRes.ok) {
        setLoadError(agentRes.error.message);
        return;
      }
      setStoredWire(agentRes.data.wire);
      const health = assessAgentDefinitionWire(agentRes.data.wire);
      if (health.status === "invalid") {
        setInvalidHealth(health);
        return;
      }
      const def = health.value;
      const promptForm = definitionToForm(def);
      setName(def.name ?? "");
      setMaxSteps(String(def.runtime?.maxSteps ?? 20));
      setSystemEnabled(promptForm.systemEnabled);
      setSystemContent(promptForm.systemContent);
      setPersistEnabled(promptForm.persistEnabled);
      setDynamicEnabled(promptForm.dynamicEnabled);
      setWorkplace(promptForm.workplace);
      setPersist([...promptForm.persist]);
      setDynamic([...promptForm.dynamic]);

      const toolsWire = toolsSelectionFromDefinition(def);
      setToolsMode(toolsWire.mode);
      setToolsSelected([...toolsWire.selected]);

      const providerRows = providerRes.ok
        ? providerRes.data.map((p) => ({
            id: p.id,
            label: p.displayName?.trim() || p.id,
          }))
        : [];
      setProviders(providerRows);

      let baselineProviderId = "";
      let baselineSavedModelId = "";
      let modelOn = false;
      const resolved = await resolveSavedModelPin(def.model);
      modelOn = resolved.modelOn;
      if (modelOn) {
        setModelEnabled(true);
        setProviderId(resolved.providerId);
        baselineProviderId = resolved.providerId;
        baselineSavedModelId = resolved.savedModelId;
        setSavedModelId(resolved.savedModelId);
        await loadSavedModels(resolved.providerId);
      } else {
        setModelEnabled(false);
        if (providerRows.length > 0) {
          setProviderId(providerRows[0]!.id);
          await loadSavedModels(providerRows[0]!.id);
        }
      }

      setSavedBaseline(
        formSnapshotJson({
          name: def.name ?? "",
          maxSteps: String(def.runtime?.maxSteps ?? 20),
          modelEnabled: modelOn,
          providerId: baselineProviderId,
          savedModelId: baselineSavedModelId,
          toolsMode: toolsWire.mode,
          toolsSelected: [...toolsWire.selected],
          ...promptForm,
          persist: [...promptForm.persist],
        })
      );
    } finally {
      setLoading(false);
    }
  }, [agentId, loadSavedModels, resolveSavedModelPin]);

  useEffect(() => {
    void loadAgent();
  }, [loadAgent]);

  const displayName = name.trim() || "未命名 Agent";

  useEffect(() => {
    if (!agentId || invalidHealth != null || loadError != null) return;
    nav.navState.editingAgentDisplayName = displayName;
    nav.setAgentEditorTitle?.(displayName);
  }, [agentId, invalidHealth, loadError, displayName, nav]);

  if (!agentId) {
    return <p className="settings-hint">缺少 agentId</p>;
  }

  const handleDeleteBrokenAgent = async () => {
    const res = await ipcAgentRegistryDelete({ agentId });
    if (res.ok) {
      toastSettingsSuccess("已删除 Agent");
      nav.pop();
    } else {
      toastSettingsError(res.error.message);
    }
  };

  const handleOverwriteWithDefault = async () => {
    const wire = storedWire;
    if (wire == null) {
      return;
    }
    const preservedName = readAgentNameFromWire(wire, agentId);
    const def = buildDefaultAgentDefinitionPreservingName(
      preservedName || agentId
    );
    setSaving(true);
    try {
      const saveRes = await ipcAgentRegistryUpsert({
        agentId,
        definition: def,
      });
      if (saveRes.ok) {
        toastSettingsSuccess("已用默认模板覆盖并保存");
        await loadAgent();
      } else {
        toastSettingsError(saveRes.error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  if (invalidHealth != null) {
    return (
      <SettingsPanel>
        <div className="settings-error-panel">
          <p className="settings-error-panel__title">
            {STORED_CONFIG_LABELS.invalidTitle}
          </p>
          <p className="settings-error-panel__message">
            {storedConfigInvalidReason(invalidHealth.code)}
          </p>
          <p className="settings-error-panel__message settings-error-panel__message--subtle">
            {invalidHealth.message}
          </p>
          <div className="settings-error-panel__actions">
            <Button variant="secondary" onClick={() => nav.pop()}>
              {STORED_CONFIG_LABELS.agentBack}
            </Button>
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => void handleOverwriteWithDefault()}
            >
              {STORED_CONFIG_LABELS.agentOverwriteDefault}
            </Button>
            <Button
              variant="danger"
              onClick={() => void handleDeleteBrokenAgent()}
            >
              {STORED_CONFIG_LABELS.agentDelete}
            </Button>
          </div>
        </div>
      </SettingsPanel>
    );
  }

  if (loadError != null) {
    return (
      <SettingsPanel>
        <div className="settings-error-panel">
          <p className="settings-error-panel__title">无法加载 Agent 配置</p>
          <p className="settings-error-panel__message">{loadError}</p>
          <div className="settings-error-panel__actions">
            <Button variant="secondary" onClick={() => nav.pop()}>
              返回列表
            </Button>
            <Button
              variant="danger"
              onClick={() => void handleDeleteBrokenAgent()}
            >
              删除 Agent
            </Button>
          </div>
        </div>
      </SettingsPanel>
    );
  }

  const modelHint =
    savedModels.find((m) => m.id === savedModelId)?.displayName ??
    savedModelId ??
    "—";

  const save = async () => {
    const built = buildAgentDefinitionFromForm({
      name,
      maxSteps,
      modelEnabled: false,
      providerId: "",
      savedModelId: "",
      toolsMode,
      toolsSelected,
      systemEnabled,
      systemContent,
      persistEnabled,
      dynamicEnabled,
      workplace,
      persist,
      dynamic,
    });
    if (!built.ok) {
      showToast(built.message);
      return;
    }
    const definition: AgentDefinition = { ...built.definition };
    if (modelEnabled && savedModelId) {
      definition.model = savedModelId;
    } else {
      delete definition.model;
    }
    setSaving(true);
    try {
      const saveRes = await ipcAgentRegistryUpsert({
        agentId,
        definition,
      });
      if (saveRes.ok) {
        setSavedBaseline(snapshot);
        toastSettingsSuccess("已保存 Agent 配置");
      } else {
        toastSettingsError(saveRes.error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const movePersist = (textIndex: number, dir: -1 | 1) => {
    setPersist((prev) => movePersistTextBlock(prev, textIndex, dir));
  };

  const moveDynamic = (index: number, dir: -1 | 1) => {
    setDynamic((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      const tmp = next[target]!;
      next[target] = next[index]!;
      next[index] = tmp;
      return next;
    });
  };

  const promptRegionForm = () => ({
    systemEnabled,
    systemContent,
    persistEnabled,
    dynamicEnabled,
    workplace,
    persist,
    dynamic,
  });

  /** 删除 Prompt 块前校验：三区全关则放行，否则删除后须至少保留一个有效来源。 */
  const guardPromptBlockDeletion = (
    nextForm: ReturnType<typeof promptRegionForm>,
    proceed: () => void
  ) => {
    if (!hasAnyPromptRegionEnabled(promptRegionForm())) {
      proceed();
      return;
    }
    if (countEffectiveFormPromptSources(nextForm) < 1) {
      showToast("至少保留一个 Prompt 块");
      return;
    }
    proceed();
  };

  const deletePersist = (textIndex: number) => {
    const nextPersist = deletePersistTextBlock(persist, textIndex);
    const nextForm = { ...promptRegionForm(), persist: nextPersist };
    if (!hasAnyPromptRegionEnabled(promptRegionForm())) {
      setPersist(nextPersist);
      return;
    }
    if (countFormPromptSources(nextForm) < 1) {
      showToast("至少保留一个 Prompt 块");
      return;
    }
    setPersist(nextPersist);
  };

  const deleteDynamic = (index: number) => {
    const nextDynamic = dynamic.filter((_, i) => i !== index);
    guardPromptBlockDeletion(
      { ...promptRegionForm(), dynamic: nextDynamic },
      () => setDynamic(nextDynamic)
    );
  };

  const addPersistTextBlock = () => {
    setPersist((prev) => [
      ...prev,
      createDefaultPersistTextBlock(prev.length),
    ]);
  };

  const addDynamicBlock = () => {
    setDynamic((prev) => [...prev, createDefaultDynamicTextBlock(prev.length)]);
  };

  const handleProviderChange = async (pid: string) => {
    setProviderId(pid);
    const res = await ipcProviderModelsSavedList({ providerId: pid });
    if (res.ok && res.data.length > 0) {
      setSavedModelId(res.data[0]!.id);
      setSavedModels(
        res.data.map((m) => ({
          id: m.id,
          vendorModelId: m.vendorModelId,
          displayName: m.displayName?.trim() || m.vendorModelId,
        }))
      );
    } else {
      setSavedModelId("");
      setSavedModels([]);
    }
  };

  const dirty = savedBaseline != null && snapshot !== savedBaseline;

  const handlePromptTextareaKeyDown = (
    e: ReactKeyboardEvent<HTMLTextAreaElement>
  ) => {
    handleMultilineSubmitKeyDown(e, () => void save(), { disabled: saving });
  };

  const renderBlockActions = (
    index: number,
    total: number,
    onMove: (i: number, d: -1 | 1) => void,
    onDelete: (i: number) => void
  ) => (
    <div className="config-block-card__actions">
      {index > 0 ? (
        <button
          type="button"
          className="icon-btn"
          onClick={() => onMove(index, -1)}
          aria-label="上移"
        >
          ↑
        </button>
      ) : null}
      {index < total - 1 ? (
        <button
          type="button"
          className="icon-btn"
          onClick={() => onMove(index, 1)}
          aria-label="下移"
        >
          ↓
        </button>
      ) : null}
      <button
        type="button"
        className="icon-btn"
        onClick={() => onDelete(index)}
        aria-label="删除"
      >
        ×
      </button>
    </div>
  );

  return (
    <SettingsPanel>
      {loading ? <p className="settings-hint">加载中…</p> : null}
      <SettingsFormSection
        title="Agent 配置"
        desc={`编辑 ${displayName}${dirty ? " · 未保存" : ""}`}
        toolbar={
          <div className="settings-yaml-links">
            <Button variant="secondary" onClick={() => setConfirmImport(true)}>
              导入 YAML
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                void ipcAgentYamlExport({ agentId }).then((r) => {
                  if (r.ok && r.data === "saved")
                    showToast("已导出 Agent YAML");
                  else if (!r.ok) showToast(r.error.message);
                })
              }
            >
              导出 YAML
            </Button>
          </div>
        }
        footer={
          <Button
            variant="primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        }
      >
        <SettingsSection title="基本信息">
          <SettingsField label="名称">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </SettingsField>
        </SettingsSection>

        <SettingsSection title="模型">
          <SettingsField label="专属模型" row>
            <Switch
              checked={modelEnabled}
              onChange={setModelEnabled}
              aria-label="专属模型"
            />
          </SettingsField>
          {!modelEnabled ? (
            <p className="settings-hint settings-hint--compact">
              未启用时跟随工作区当前模型（会话操作抽屉 / 我的）。
            </p>
          ) : (
            <>
              <SettingsField label="服务商">
                <select
                  value={providerId}
                  onChange={(e) => void handleProviderChange(e.target.value)}
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </SettingsField>
              <SettingsField label="模型">
                <select
                  value={savedModelId}
                  onChange={(e) => setSavedModelId(e.target.value)}
                  disabled={!providerId}
                >
                  {savedModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </SettingsField>
              <p className="settings-hint">model: {modelHint}</p>
            </>
          )}
        </SettingsSection>

        <SettingsSection title="运行时">
          <SettingsField label={PROMPT_REGION_LABELS.maxStepsLabel}>
            <input
              type="number"
              min={1}
              value={maxSteps}
              onChange={(e) => setMaxSteps(e.target.value)}
            />
          </SettingsField>
          <p className="settings-hint">{PROMPT_REGION_LABELS.maxStepsHint}</p>
        </SettingsSection>

        <SettingsSection title="工具策略">
          <SettingsField label="模式">
            <select
              value={toolsMode}
              onChange={(e) => setToolsMode(e.target.value as ToolsMode)}
            >
              {TOOL_MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SettingsField>
          {toolsMode !== "default" ? (
            <SettingsField
              label={toolsMode === "allow" ? "白名单工具" : "黑名单工具"}
            >
              <ToolPolicyPicker
                selected={toolsSelected}
                onChange={setToolsSelected}
              />
            </SettingsField>
          ) : (
            <p className="settings-hint">
              未配置时使用全部内置工具（6
              个）：read、write、edit、fs、glob、grep。
            </p>
          )}
        </SettingsSection>

        <SettingsSection title={PROMPT_REGION_LABELS.layoutTitle}>
          <div className="config-block-card__section-head">
            <span className="config-block-card__section-label">
              {PROMPT_REGION_LABELS.systemBlocks}
            </span>
          </div>
          <div className="config-block-card config-block-card--prompt">
            <div className="config-block-card__header">
              <span className="config-block-card__badge">
                {PROMPT_REGION_LABELS.system}
              </span>
              <span className="config-block-card__meta">
                {PROMPT_REGION_LABELS.systemPromptTitle}
              </span>
              <Switch
                checked={systemEnabled}
                onChange={setSystemEnabled}
                aria-label={PROMPT_REGION_LABELS.enableSystem}
              />
            </div>
            <div className="config-block-card__body">
              {systemEnabled ? (
                <SettingsField label={PROMPT_REGION_LABELS.systemContent}>
                  <textarea
                    rows={4}
                    value={systemContent}
                    onChange={(e) => setSystemContent(e.target.value)}
                    onKeyDown={handlePromptTextareaKeyDown}
                    placeholder={PROMPT_REGION_LABELS.systemPlaceholder}
                  />
                </SettingsField>
              ) : (
                <p className="config-block-card__hint">
                  {PROMPT_REGION_LABELS.systemDisabledHint}
                </p>
              )}
            </div>
          </div>

          <div className="config-block-card__section-head">
            <span className="config-block-card__section-label">
              {WORKPLACE_BLOCK_LABEL}
            </span>
          </div>
          <div className="config-block-card config-block-card--prompt">
            <div className="config-block-card__header">
              <span className="config-block-card__badge">
                {WORKPLACE_BLOCK_LABEL}
              </span>
              <Switch
                checked={workplace}
                onChange={setWorkplace}
                aria-label={WORKPLACE_BLOCK_LABEL}
              />
            </div>
            <div className="config-block-card__body">
              {workplace ? (
                <p className="config-block-card__hint">{WORKPLACE_BLOCK_HINT}</p>
              ) : (
                <p className="config-block-card__hint">
                  关闭时不注入项目文件树。
                </p>
              )}
            </div>
          </div>

          <div className="config-block-card__section-head">
            <span className="config-block-card__section-label">
              {PROMPT_REGION_LABELS.persistBlocks}
            </span>
          </div>
          <div className="config-block-card config-block-card--prompt">
            <div className="config-block-card__header">
              <span className="config-block-card__badge">
                {PROMPT_REGION_LABELS.persistBlocks}
              </span>
              <Switch
                checked={persistEnabled}
                onChange={setPersistEnabled}
                aria-label={PROMPT_REGION_LABELS.enablePersist}
              />
            </div>
            <div className="config-block-card__body">
              {persistEnabled ? (
                <>
                  <div className="config-block-card__section-head">
                    <span className="config-block-card__section-label">
                      块列表
                    </span>
                    <button
                      type="button"
                      className="settings-link-btn"
                      onClick={() => addPersistTextBlock()}
                    >
                      添加
                    </button>
                  </div>
                  <div
                    className={
                      persist.length === 0
                        ? "config-block-list config-block-list--empty"
                        : "config-block-list"
                    }
                  >
                    {persist.filter(
                      (b): b is PersistTextPromptBlock => b.type === "text"
                    ).length === 0 ? (
                      <p className="config-block-card__empty-hint">
                        {PROMPT_REGION_LABELS.emptyPersistHint}
                      </p>
                    ) : null}
                    {persist
                      .filter(
                        (b): b is PersistTextPromptBlock => b.type === "text"
                      )
                      .map((block, index, textBlocks) => (
                      <div
                        key={`persist-${index}`}
                        className="config-block-card config-block-card--prompt"
                      >
                        <div className="config-block-card__header">
                          <span className="config-block-card__badge">
                            {blockTypeLabel(block.type)}
                          </span>
                          <span className="config-block-card__meta">
                            {block.name}
                          </span>
                          {renderBlockActions(
                            index,
                            textBlocks.length,
                            movePersist,
                            deletePersist
                          )}
                        </div>
                        <div className="config-block-card__body">
                          <SettingsField label="名称">
                            <input
                              value={block.name}
                              onChange={(e) =>
                                setPersist((prev) =>
                                  mapPersistTextBlocks(prev, (b, i) =>
                                    i === index
                                      ? { ...b, name: e.target.value }
                                      : b
                                  )
                                )
                              }
                            />
                          </SettingsField>
                          <SettingsField label="角色">
                            <select
                              value={block.role}
                              onChange={(e) =>
                                setPersist((prev) =>
                                  mapPersistTextBlocks(prev, (b, i) =>
                                    i === index
                                      ? {
                                          ...b,
                                          role: e.target
                                            .value as PersistTextPromptBlock["role"],
                                        }
                                      : b
                                  )
                                )
                              }
                            >
                              {ROLE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </SettingsField>
                          <p className="config-block-card__hint">
                            {PROMPT_REGION_LABELS.persistRegionHint}
                          </p>
                          <SettingsField label="内容">
                            <textarea
                              rows={4}
                              value={block.content}
                              onChange={(e) =>
                                setPersist((prev) =>
                                  mapPersistTextBlocks(prev, (b, i) =>
                                    i === index
                                      ? { ...b, content: e.target.value }
                                      : b
                                  )
                                )
                              }
                            />
                          </SettingsField>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="config-block-card__hint">
                  {PROMPT_REGION_LABELS.persistDisabledHint}
                </p>
              )}
            </div>
          </div>

          <div className="config-block-card__section-head">
            <span className="config-block-card__section-label">
              {PROMPT_REGION_LABELS.chatBlocks}
            </span>
          </div>
          <div className="config-block-card config-block-card--prompt config-block-card--chat-slot">
            <div className="config-block-card__header config-block-card__header--chat-slot">
              <span className="config-block-card__badge">
                {PROMPT_REGION_LABELS.chatTag}
              </span>
              <span className="config-block-card__readonly-pill">只读</span>
            </div>
            <div className="config-block-card__body">
              <p className="config-block-card__meta config-block-card__meta--chat-title">
                {PROMPT_REGION_LABELS.chat}
              </p>
              <p className="config-block-card__hint">
                {PROMPT_REGION_LABELS.chatReadonlyHint}
              </p>
            </div>
          </div>

          <div className="config-block-card__section-head">
            <span className="config-block-card__section-label">
              {PROMPT_REGION_LABELS.dynamicBlocks}
            </span>
          </div>
          <div className="config-block-card config-block-card--prompt">
            <div className="config-block-card__header">
              <span className="config-block-card__badge">
                {PROMPT_REGION_LABELS.dynamicBlocks}
              </span>
              <Switch
                checked={dynamicEnabled}
                onChange={setDynamicEnabled}
                aria-label={PROMPT_REGION_LABELS.enableDynamic}
              />
            </div>
            <div className="config-block-card__body">
              {dynamicEnabled ? (
                <>
                  <div className="config-block-card__section-head">
                    <span className="config-block-card__section-label">
                      块列表
                    </span>
                    <button
                      type="button"
                      className="settings-link-btn"
                      onClick={() => addDynamicBlock()}
                    >
                      添加
                    </button>
                  </div>
                  <div
                    className={
                      dynamic.length === 0
                        ? "config-block-list config-block-list--empty"
                        : "config-block-list"
                    }
                  >
                    {dynamic.length === 0 ? (
                      <p className="config-block-card__empty-hint">
                        {PROMPT_REGION_LABELS.emptyDynamicHint}
                      </p>
                    ) : null}
                    {dynamic.map((block, index) => (
                      <div
                        key={`dynamic-${index}`}
                        className="config-block-card config-block-card--prompt"
                      >
                        <div className="config-block-card__header">
                          <span className="config-block-card__badge">
                            {blockTypeLabel(block.type)}
                          </span>
                          <span className="config-block-card__meta">
                            {block.name}
                          </span>
                          {renderBlockActions(
                            index,
                            dynamic.length,
                            moveDynamic,
                            deleteDynamic
                          )}
                        </div>
                        <div className="config-block-card__body">
                          <SettingsField label="名称">
                            <input
                              value={block.name}
                              onChange={(e) =>
                                setDynamic((prev) =>
                                  prev.map((b, i) =>
                                    i === index
                                      ? { ...b, name: e.target.value }
                                      : b
                                  )
                                )
                              }
                            />
                          </SettingsField>
                          <SettingsField label="角色">
                            <select
                              value={block.role}
                              onChange={(e) =>
                                setDynamic((prev) =>
                                  prev.map((b, i) =>
                                    i === index
                                      ? {
                                          ...b,
                                          role: e.target
                                            .value as DynamicPromptBlock["role"],
                                        }
                                      : b
                                  )
                                )
                              }
                            >
                              {ROLE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </SettingsField>
                          <div className="config-block-card__switch-row">
                            <span className="config-block-card__switch-label">
                              常驻
                            </span>
                            <Switch
                              checked={isDynamicBlockPersistent(block)}
                              onChange={(persistent) =>
                                setDynamic((prev) =>
                                  prev.map((b, i) =>
                                    i === index
                                      ? withDynamicBlockPersistence(
                                          b,
                                          persistent
                                        )
                                      : b
                                  )
                                )
                              }
                              aria-label="常驻"
                            />
                          </div>
                          {!isDynamicBlockPersistent(block) ? (
                            <p className="config-block-card__hint config-block-card__hint--subtle config-block-card__switch-hint">
                              {PROMPT_REGION_LABELS.dynamicLifecycleOnceHint}
                            </p>
                          ) : null}
                          <SettingsField label="内容">
                            <PromptMacroTextarea
                              textareaRef={
                                dynamicInsertIndex === index
                                  ? dynamicTextareaRef
                                  : inactiveDynamicTextareaRef
                              }
                              rows={4}
                              value={block.content}
                              onFocus={() => setDynamicInsertIndex(index)}
                              onKeyDown={handlePromptTextareaKeyDown}
                              onChange={(content) =>
                                setDynamic((prev) =>
                                  prev.map((b, i) =>
                                    i === index ? { ...b, content } : b
                                  )
                                )
                              }
                            />
                          </SettingsField>
                          <div className="config-dep-chips">
                            <span className="config-block-card__hint">
                              宏：
                            </span>
                            {PROMPT_INSERTABLE_MACROS.map((macro) => (
                              <button
                                key={macro.token}
                                type="button"
                                className="config-dep-chip"
                                onClick={() => {
                                  setDynamicInsertIndex(index);
                                  const ta =
                                    dynamicInsertIndex === index
                                      ? dynamicTextareaRef.current
                                      : null;
                                  const selection =
                                    ta != null
                                      ? {
                                          start:
                                            ta.selectionStart ??
                                            block.content.length,
                                          end:
                                            ta.selectionEnd ??
                                            block.content.length,
                                        }
                                      : {
                                          start: block.content.length,
                                          end: block.content.length,
                                        };
                                  const { next, selection: nextSel } =
                                    insertTextAtSelection(
                                      block.content,
                                      selection,
                                      macro.token
                                    );
                                  setDynamic((prev) =>
                                    prev.map((b, i) =>
                                      i === index ? { ...b, content: next } : b
                                    )
                                  );
                                  requestAnimationFrame(() => {
                                    const el = dynamicTextareaRef.current;
                                    if (el != null) {
                                      el.focus();
                                      el.setSelectionRange(
                                        nextSel.start,
                                        nextSel.end
                                      );
                                    }
                                  });
                                }}
                              >
                                {macro.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="config-block-card__hint">
                  {PROMPT_REGION_LABELS.dynamicDisabledHint}
                </p>
              )}
            </div>
          </div>
        </SettingsSection>
      </SettingsFormSection>
      <ConfirmModal
        open={confirmImport}
        title="导入 YAML"
        message="将覆盖当前 Agent 配置，是否继续？"
        onConfirm={() => {
          setConfirmImport(false);
          void ipcAgentYamlImport({ agentId }).then((r) => {
            if (r.ok && r.data === "imported") {
              void loadAgent();
              showToast("已导入 Agent YAML");
            } else if (!r.ok) {
              showToast(r.error.message);
            }
          });
        }}
        onCancel={() => setConfirmImport(false)}
      />
    </SettingsPanel>
  );
}
