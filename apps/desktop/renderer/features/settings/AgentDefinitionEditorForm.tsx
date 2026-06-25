/**
 * Agent 定义编辑表单（复用 config-forms/agent，供全局 Agent 与项目专属配置共用）。
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
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
  WORKTREE_BLOCK_LABEL,
  WORKTREE_BLOCK_HINT,
  addPersistWorktreeBlock,
  blockTypeLabel,
  buildAgentDefinitionFromForm,
  countEffectiveFormPromptSources,
  createDefaultDynamicTextBlock,
  createDefaultPersistTextBlock,
  definitionToForm,
  deletePersistTextBlock,
  formatApplicationModelId,
  formSnapshotJson,
  hasAnyPromptRegionEnabled,
  mapPersistTextBlocks,
  movePersistBlock,
  parseApplicationModelId,
  removePersistWorktreeBlock,
  splitPersistBlocksForEditor,
  updatePersistWorktreeRole,
  toolsSelectionFromDefinition,
  isDynamicBlockPersistent,
  withDynamicBlockPersistence,
  type ToolsMode,
} from "@novel-master/core/config-forms/agent";
import { ToolPolicyPicker } from "./ToolPolicyPicker";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { showToast } from "@/components/ui/show-toast";
import { Switch } from "@/components/ui/Switch";
import { handleMultilineSubmitKeyDown } from "@/utils/textarea-enter-shortcuts";
import { ipcProviderModelsSavedList, ipcProvidersList } from "@/ipc/client";
import { SettingsField, SettingsSection } from "./settings-ui";

const DYNAMIC_MACROS = [
  { label: "$time", token: "{{$time}}" },
  { label: "$week_cn", token: "{{$week_cn}}" },
  { label: "$filetree", token: "{{$filetree}}" },
] as const;

type AddMenuTarget = "persist" | null;

export type AgentDefinitionBuildResult =
  | { readonly ok: true; readonly definition: AgentDefinition }
  | { readonly ok: false; readonly message: string };

/** {@link AgentDefinitionEditorForm} 暴露给父组件的操作。 */
export type AgentDefinitionEditorFormHandle = {
  buildDefinition(): AgentDefinitionBuildResult;
  isDirty(): boolean;
  markSaved(): void;
};

export type AgentDefinitionEditorFormProps = {
  /** 初始 Agent 定义；配合 resetKey 在外部变更时重置表单。 */
  definition: AgentDefinition;
  resetKey?: string | number;
  disabled?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  /** Ctrl+Enter 提交快捷键回调。 */
  onSubmitShortcut?: () => void;
};

function insertAtCursor(
  value: string,
  insert: string,
  textarea: HTMLTextAreaElement | null,
): string {
  if (textarea == null) {
    return value + insert;
  }
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  return value.slice(0, start) + insert + value.slice(end);
}

function applyDefinitionToFormState(
  def: AgentDefinition,
  loadSavedModels: (providerId: string) => Promise<void>,
  setters: {
    setName: (v: string) => void;
    setMaxSteps: (v: string) => void;
    setSystemEnabled: (v: boolean) => void;
    setSystemContent: (v: string) => void;
    setPersistEnabled: (v: boolean) => void;
    setDynamicEnabled: (v: boolean) => void;
    setPersist: (v: PersistPromptBlock[]) => void;
    setDynamic: (v: DynamicPromptBlock[]) => void;
    setToolsMode: (v: ToolsMode) => void;
    setToolsSelected: (v: string[]) => void;
    setModelEnabled: (v: boolean) => void;
    setProviderId: (v: string) => void;
    setVendorModelId: (v: string) => void;
    setSavedBaseline: (v: string) => void;
  },
  providerRows: Array<{ id: string; label: string }>,
): void {
  const promptForm = definitionToForm(def);
  setters.setName(def.name ?? "");
  setters.setMaxSteps(String(def.runtime?.maxSteps ?? 20));
  setters.setSystemEnabled(promptForm.systemEnabled);
  setters.setSystemContent(promptForm.systemContent);
  setters.setPersistEnabled(promptForm.persistEnabled);
  setters.setDynamicEnabled(promptForm.dynamicEnabled);
  setters.setPersist([...promptForm.persist]);
  setters.setDynamic([...promptForm.dynamic]);

  const toolsWire = toolsSelectionFromDefinition(def);
  setters.setToolsMode(toolsWire.mode);
  setters.setToolsSelected([...toolsWire.selected]);

  let baselineProviderId = "";
  let baselineVendorModelId = "";
  let modelOn = false;
  if (def.model) {
    try {
      const parsed = parseApplicationModelId(def.model);
      modelOn = true;
      setters.setModelEnabled(true);
      setters.setProviderId(parsed.providerId);
      baselineProviderId = parsed.providerId;
      baselineVendorModelId = parsed.vendorModelId;
      setters.setVendorModelId(parsed.vendorModelId);
      void loadSavedModels(parsed.providerId);
    } catch {
      setters.setModelEnabled(false);
    }
  } else {
    setters.setModelEnabled(false);
    if (providerRows.length > 0) {
      setters.setProviderId(providerRows[0]!.id);
      void loadSavedModels(providerRows[0]!.id);
    }
  }

  setters.setSavedBaseline(
    formSnapshotJson({
      name: def.name ?? "",
      maxSteps: String(def.runtime?.maxSteps ?? 20),
      modelEnabled: modelOn,
      providerId: baselineProviderId,
      vendorModelId: baselineVendorModelId,
      toolsMode: toolsWire.mode,
      toolsSelected: [...toolsWire.selected],
      ...promptForm,
      persist: [...promptForm.persist],
    }),
  );
}

export const AgentDefinitionEditorForm = forwardRef<
  AgentDefinitionEditorFormHandle,
  AgentDefinitionEditorFormProps
>(function AgentDefinitionEditorForm(
  { definition, resetKey, disabled = false, onDirtyChange, onSubmitShortcut },
  ref,
) {
  const [name, setName] = useState("");
  const [maxSteps, setMaxSteps] = useState("20");
  const [modelEnabled, setModelEnabled] = useState(false);
  const [providerId, setProviderId] = useState("");
  const [vendorModelId, setVendorModelId] = useState("");
  const [systemEnabled, setSystemEnabled] = useState(false);
  const [systemContent, setSystemContent] = useState("");
  const [persistEnabled, setPersistEnabled] = useState(false);
  const [dynamicEnabled, setDynamicEnabled] = useState(false);
  const [persist, setPersist] = useState<PersistPromptBlock[]>([]);
  const [dynamic, setDynamic] = useState<DynamicPromptBlock[]>([]);
  const [toolsMode, setToolsMode] = useState<ToolsMode>("default");
  const [toolsSelected, setToolsSelected] = useState<string[]>([]);
  const [providers, setProviders] = useState<Array<{ id: string; label: string }>>([]);
  const [savedModels, setSavedModels] = useState<
    Array<{ vendorModelId: string; displayName: string }>
  >([]);
  const [savedBaseline, setSavedBaseline] = useState<string | null>(null);
  const [addBlockMenu, setAddBlockMenu] = useState<{
    x: number;
    y: number;
    target: AddMenuTarget;
  } | null>(null);
  const dynamicTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [dynamicInsertIndex, setDynamicInsertIndex] = useState<number | null>(null);

  const snapshot = useMemo(
    () =>
      formSnapshotJson({
        name,
        maxSteps,
        modelEnabled,
        providerId,
        vendorModelId,
        toolsMode,
        toolsSelected,
        systemEnabled,
        systemContent,
        persistEnabled,
        dynamicEnabled,
        persist,
        dynamic,
      }),
    [
      name,
      maxSteps,
      modelEnabled,
      providerId,
      vendorModelId,
      toolsMode,
      toolsSelected,
      systemEnabled,
      systemContent,
      persistEnabled,
      dynamicEnabled,
      persist,
      dynamic,
    ],
  );

  const loadSavedModels = useCallback(async (pid: string) => {
    const res = await ipcProviderModelsSavedList({ providerId: pid });
    if (res.ok) {
      setSavedModels(
        res.data.map((m) => ({
          vendorModelId: m.vendorModelId,
          displayName: m.displayName?.trim() || m.vendorModelId,
        })),
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const providerRes = await ipcProvidersList();
      if (cancelled) {
        return;
      }
      const providerRows = providerRes.ok
        ? providerRes.data.map((p) => ({
            id: p.id,
            label: p.displayName?.trim() || p.id,
          }))
        : [];
      setProviders(providerRows);
      applyDefinitionToFormState(
        definition,
        loadSavedModels,
        {
          setName,
          setMaxSteps,
          setSystemEnabled,
          setSystemContent,
          setPersistEnabled,
          setDynamicEnabled,
          setPersist,
          setDynamic,
          setToolsMode,
          setToolsSelected,
          setModelEnabled,
          setProviderId,
          setVendorModelId,
          setSavedBaseline,
        },
        providerRows,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [definition, resetKey, loadSavedModels]);

  const dirty = savedBaseline != null && snapshot !== savedBaseline;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const buildDefinition = useCallback((): AgentDefinitionBuildResult => {
    return buildAgentDefinitionFromForm({
      name,
      maxSteps,
      modelEnabled,
      providerId,
      vendorModelId,
      toolsMode,
      toolsSelected,
      systemEnabled,
      systemContent,
      persistEnabled,
      dynamicEnabled,
      persist,
      dynamic,
    });
  }, [
    name,
    maxSteps,
    modelEnabled,
    providerId,
    vendorModelId,
    toolsMode,
    toolsSelected,
    systemEnabled,
    systemContent,
    persistEnabled,
    dynamicEnabled,
    persist,
    dynamic,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      buildDefinition,
      isDirty: () => dirty,
      markSaved: () => setSavedBaseline(snapshot),
    }),
    [buildDefinition, dirty, snapshot],
  );

  const preferredModelId =
    modelEnabled && providerId && vendorModelId
      ? formatApplicationModelId(providerId, vendorModelId)
      : undefined;

  const { blocks: persistBlocks, worktree: persistWorktree } = useMemo(
    () => splitPersistBlocksForEditor(persist),
    [persist],
  );

  const movePersist = (blockIndex: number, dir: -1 | 1) => {
    setPersist((prev) => movePersistBlock(prev, blockIndex, dir));
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
    persist,
    dynamic,
  });

  const guardPromptBlockDeletion = (
    nextForm: ReturnType<typeof promptRegionForm>,
    proceed: () => void,
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
    guardPromptBlockDeletion({ ...promptRegionForm(), persist: nextPersist }, () =>
      setPersist(nextPersist),
    );
  };

  const deleteDynamic = (index: number) => {
    const nextDynamic = dynamic.filter((_, i) => i !== index);
    guardPromptBlockDeletion({ ...promptRegionForm(), dynamic: nextDynamic }, () =>
      setDynamic(nextDynamic),
    );
  };

  const addPersistTextBlock = () => {
    setPersist((prev) => {
      const { blocks } = splitPersistBlocksForEditor(prev);
      const textCount = blocks.filter((block) => block.type === "text").length;
      return [...blocks, createDefaultPersistTextBlock(textCount)];
    });
    setAddBlockMenu(null);
  };

  const addPersistWorktree = () => {
    setPersist((prev) => addPersistWorktreeBlock(prev));
    setAddBlockMenu(null);
  };

  const removePersistWorktree = () => {
    const nextPersist = removePersistWorktreeBlock(persist);
    guardPromptBlockDeletion({ ...promptRegionForm(), persist: nextPersist }, () => {
      setPersist(nextPersist);
      setAddBlockMenu(null);
    });
  };

  const addDynamicBlock = () => {
    setDynamic((prev) => [...prev, createDefaultDynamicTextBlock(prev.length)]);
    setAddBlockMenu(null);
  };

  const handleProviderChange = async (pid: string) => {
    setProviderId(pid);
    const res = await ipcProviderModelsSavedList({ providerId: pid });
    if (res.ok && res.data.length > 0) {
      setVendorModelId(res.data[0]!.vendorModelId);
      setSavedModels(
        res.data.map((m) => ({
          vendorModelId: m.vendorModelId,
          displayName: m.displayName?.trim() || m.vendorModelId,
        })),
      );
    } else {
      setVendorModelId("");
      setSavedModels([]);
    }
  };

  const handlePromptTextareaKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    handleMultilineSubmitKeyDown(e, () => onSubmitShortcut?.(), { disabled });
  };

  const renderBlockActions = (
    index: number,
    total: number,
    onMove: (i: number, d: -1 | 1) => void,
    onDelete: (i: number) => void,
  ) => (
    <div className="config-block-card__actions">
      {index > 0 ? (
        <button
          type="button"
          className="icon-btn"
          disabled={disabled}
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
          disabled={disabled}
          onClick={() => onMove(index, 1)}
          aria-label="下移"
        >
          ↓
        </button>
      ) : null}
      <button
        type="button"
        className="icon-btn"
        disabled={disabled}
        onClick={() => onDelete(index)}
        aria-label="删除"
      >
        ×
      </button>
    </div>
  );

  return (
    <>
      <SettingsSection title="基本信息">
        <SettingsField label="名称">
          <input
            type="text"
            value={name}
            disabled={disabled}
            onChange={(e) => setName(e.target.value)}
          />
        </SettingsField>
      </SettingsSection>

      <SettingsSection title="模型">
        <div className="settings-row settings-row--switch">
          <span className="settings-row__label">专属模型</span>
          <Switch
            checked={modelEnabled}
            disabled={disabled}
            onChange={setModelEnabled}
            aria-label="专属模型"
          />
        </div>
        {!modelEnabled ? (
          <p className="settings-hint">未启用时跟随工作区当前模型（会话操作抽屉 / 我的）。</p>
        ) : (
          <>
            <SettingsField label="服务商">
              <select
                value={providerId}
                disabled={disabled}
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
                value={vendorModelId}
                disabled={disabled || !providerId}
                onChange={(e) => setVendorModelId(e.target.value)}
              >
                {savedModels.map((m) => (
                  <option key={m.vendorModelId} value={m.vendorModelId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </SettingsField>
            <p className="settings-hint">model: {preferredModelId ?? "—"}</p>
          </>
        )}
      </SettingsSection>

      <SettingsSection title="运行时">
        <SettingsField label={PROMPT_REGION_LABELS.maxStepsLabel}>
          <input
            type="number"
            min={1}
            value={maxSteps}
            disabled={disabled}
            onChange={(e) => setMaxSteps(e.target.value)}
          />
        </SettingsField>
        <p className="settings-hint">{PROMPT_REGION_LABELS.maxStepsHint}</p>
      </SettingsSection>

      <SettingsSection title="工具策略">
        <SettingsField label="模式">
          <select
            value={toolsMode}
            disabled={disabled}
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
          <SettingsField label={toolsMode === "allow" ? "白名单工具" : "黑名单工具"}>
            <ToolPolicyPicker selected={toolsSelected} onChange={setToolsSelected} />
          </SettingsField>
        ) : (
          <p className="settings-hint">
            未配置时使用全部内置工具（7 个）：read、write、edit、fs、glob、grep、chat_grep。
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
            <span className="config-block-card__badge">{PROMPT_REGION_LABELS.system}</span>
            <span className="config-block-card__meta">{PROMPT_REGION_LABELS.systemPromptTitle}</span>
            <Switch
              checked={systemEnabled}
              disabled={disabled}
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
                  disabled={disabled}
                  onChange={(e) => setSystemContent(e.target.value)}
                  onKeyDown={handlePromptTextareaKeyDown}
                  placeholder={PROMPT_REGION_LABELS.systemPlaceholder}
                />
              </SettingsField>
            ) : (
              <p className="config-block-card__hint">{PROMPT_REGION_LABELS.systemDisabledHint}</p>
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
            <span className="config-block-card__badge">{PROMPT_REGION_LABELS.persistBlocks}</span>
            <Switch
              checked={persistEnabled}
              disabled={disabled}
              onChange={setPersistEnabled}
              aria-label={PROMPT_REGION_LABELS.enablePersist}
            />
          </div>
          <div className="config-block-card__body">
            {persistEnabled ? (
              <>
                <div className="config-block-card__section-head">
                  <span className="config-block-card__section-label">块列表</span>
                  <button
                    type="button"
                    className="settings-link-btn"
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setAddBlockMenu({
                        x: Math.max(8, rect.right - 140),
                        y: Math.max(8, rect.bottom + 4),
                        target: "persist",
                      });
                    }}
                  >
                    添加
                  </button>
                </div>
                <div
                  className={
                    persistBlocks.length === 0
                      ? "config-block-list config-block-list--empty"
                      : "config-block-list"
                  }
                >
                  {persistBlocks.length === 0 ? (
                    <p className="config-block-card__empty-hint">
                      {PROMPT_REGION_LABELS.emptyPersistHint}
                    </p>
                  ) : null}
                  {persistBlocks.map((block, index) => {
                    if (block.type === "worktree") {
                      return (
                        <div
                          key={`persist-wt-${index}`}
                          className="config-block-card config-block-card--prompt"
                        >
                          <div className="config-block-card__header">
                            <span className="config-block-card__badge">
                              {blockTypeLabel(block.type)}
                            </span>
                            {renderBlockActions(
                              index,
                              persistBlocks.length,
                              movePersist,
                              () => removePersistWorktree(),
                            )}
                          </div>
                          <div className="config-block-card__body">
                            <SettingsField label="角色">
                              <select
                                value={block.role ?? "user"}
                                disabled={disabled}
                                onChange={(e) =>
                                  setPersist((prev) =>
                                    updatePersistWorktreeRole(
                                      prev,
                                      e.target.value as "user" | "assistant",
                                    ),
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
                            <p className="config-block-card__hint">{WORKTREE_BLOCK_HINT}</p>
                          </div>
                        </div>
                      );
                    }

                    const textIndex = persistBlocks
                      .slice(0, index)
                      .filter((item) => item.type === "text").length;

                    return (
                      <div
                        key={`persist-${index}`}
                        className="config-block-card config-block-card--prompt"
                      >
                        <div className="config-block-card__header">
                          <span className="config-block-card__badge">
                            {blockTypeLabel(block.type)}
                          </span>
                          <span className="config-block-card__meta">{block.name}</span>
                          {renderBlockActions(
                            index,
                            persistBlocks.length,
                            movePersist,
                            () => deletePersist(textIndex),
                          )}
                        </div>
                        <div className="config-block-card__body">
                          <SettingsField label="名称">
                            <input
                              value={block.name}
                              disabled={disabled}
                              onChange={(e) =>
                                setPersist((prev) =>
                                  mapPersistTextBlocks(prev, (b, i) =>
                                    i === textIndex ? { ...b, name: e.target.value } : b,
                                  ),
                                )
                              }
                            />
                          </SettingsField>
                          <SettingsField label="角色">
                            <select
                              value={block.role}
                              disabled={disabled}
                              onChange={(e) =>
                                setPersist((prev) =>
                                  mapPersistTextBlocks(prev, (b, i) =>
                                    i === textIndex
                                      ? {
                                          ...b,
                                          role: e.target.value as PersistTextPromptBlock["role"],
                                        }
                                      : b,
                                  ),
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
                              disabled={disabled}
                              onChange={(e) =>
                                setPersist((prev) =>
                                  mapPersistTextBlocks(prev, (b, i) =>
                                    i === textIndex ? { ...b, content: e.target.value } : b,
                                  ),
                                )
                              }
                            />
                          </SettingsField>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="config-block-card__hint">{PROMPT_REGION_LABELS.persistDisabledHint}</p>
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
            <span className="config-block-card__badge">{PROMPT_REGION_LABELS.chatTag}</span>
            <span className="config-block-card__readonly-pill">只读</span>
          </div>
          <div className="config-block-card__body">
            <p className="config-block-card__meta config-block-card__meta--chat-title">
              {PROMPT_REGION_LABELS.chat}
            </p>
            <p className="config-block-card__hint">{PROMPT_REGION_LABELS.chatReadonlyHint}</p>
          </div>
        </div>

        <div className="config-block-card__section-head">
          <span className="config-block-card__section-label">
            {PROMPT_REGION_LABELS.dynamicBlocks}
          </span>
        </div>
        <div className="config-block-card config-block-card--prompt">
          <div className="config-block-card__header">
            <span className="config-block-card__badge">{PROMPT_REGION_LABELS.dynamicBlocks}</span>
            <Switch
              checked={dynamicEnabled}
              disabled={disabled}
              onChange={setDynamicEnabled}
              aria-label={PROMPT_REGION_LABELS.enableDynamic}
            />
          </div>
          <div className="config-block-card__body">
            {dynamicEnabled ? (
              <>
                <div className="config-block-card__section-head">
                  <span className="config-block-card__section-label">块列表</span>
                  <button
                    type="button"
                    className="settings-link-btn"
                    disabled={disabled}
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
                        <span className="config-block-card__meta">{block.name}</span>
                        {renderBlockActions(index, dynamic.length, moveDynamic, deleteDynamic)}
                      </div>
                      <div className="config-block-card__body">
                        <SettingsField label="名称">
                          <input
                            value={block.name}
                            disabled={disabled}
                            onChange={(e) =>
                              setDynamic((prev) =>
                                prev.map((b, i) =>
                                  i === index ? { ...b, name: e.target.value } : b,
                                ),
                              )
                            }
                          />
                        </SettingsField>
                        <SettingsField label="角色">
                          <select
                            value={block.role}
                            disabled={disabled}
                            onChange={(e) =>
                              setDynamic((prev) =>
                                prev.map((b, i) =>
                                  i === index
                                    ? {
                                        ...b,
                                        role: e.target.value as DynamicPromptBlock["role"],
                                      }
                                    : b,
                                ),
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
                          <span className="config-block-card__switch-label">常驻</span>
                          <Switch
                            checked={isDynamicBlockPersistent(block)}
                            disabled={disabled}
                            onChange={(persistent) =>
                              setDynamic((prev) =>
                                prev.map((b, i) =>
                                  i === index ? withDynamicBlockPersistence(b, persistent) : b,
                                ),
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
                          <textarea
                            ref={dynamicInsertIndex === index ? dynamicTextareaRef : undefined}
                            rows={4}
                            value={block.content}
                            disabled={disabled}
                            onFocus={() => setDynamicInsertIndex(index)}
                            onKeyDown={handlePromptTextareaKeyDown}
                            onChange={(e) =>
                              setDynamic((prev) =>
                                prev.map((b, i) =>
                                  i === index ? { ...b, content: e.target.value } : b,
                                ),
                              )
                            }
                          />
                        </SettingsField>
                        <div className="config-dep-chips">
                          <span className="config-block-card__hint">宏：</span>
                          {DYNAMIC_MACROS.map((macro) => (
                            <button
                              key={macro.token}
                              type="button"
                              className="config-dep-chip"
                              disabled={disabled}
                              onClick={() => {
                                setDynamicInsertIndex(index);
                                setDynamic((prev) =>
                                  prev.map((b, i) =>
                                    i === index
                                      ? {
                                          ...b,
                                          content: insertAtCursor(
                                            b.content,
                                            macro.token,
                                            dynamicInsertIndex === index
                                              ? dynamicTextareaRef.current
                                              : null,
                                          ),
                                        }
                                      : b,
                                  ),
                                );
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
              <p className="config-block-card__hint">{PROMPT_REGION_LABELS.dynamicDisabledHint}</p>
            )}
          </div>
        </div>
      </SettingsSection>

      <ContextMenu
        open={addBlockMenu != null}
        x={addBlockMenu?.x ?? 0}
        y={addBlockMenu?.y ?? 0}
        items={[
          { label: "文本块", action: "persist-text" },
          ...(persistWorktree
            ? [{ label: `移除${WORKTREE_BLOCK_LABEL}`, action: "persist-worktree-remove" }]
            : [{ label: WORKTREE_BLOCK_LABEL, action: "persist-worktree-add" }]),
        ]}
        onSelect={(action) => {
          if (action === "persist-text") addPersistTextBlock();
          else if (action === "persist-worktree-add") addPersistWorktree();
          else if (action === "persist-worktree-remove") removePersistWorktree();
        }}
        onClose={() => setAddBlockMenu(null)}
      />
    </>
  );
});
