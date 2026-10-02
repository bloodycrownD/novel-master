import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  DEFAULT_SUBAGENT_DEFINITION,
  type AgentDefinition,
} from "@shared/logic/agent";

import {
  type DynamicPromptBlock,
  type PersistPromptBlock,
  type PersistTextPromptBlock,
} from "@shared/logic/prompt";
import {
  DEFAULT_SKILLS_INDEX_PREFIX,
  ROLE_OPTIONS,
  TOOL_MODE_OPTIONS,
  MODE_OPTIONS,
  PROMPT_REGION_LABELS,
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
  withWorkplaceToggle,
  type AgentMode,
  type ToolsMode,
} from "@shared/logic/config-forms-agent";
import { AgentWorkplaceBlockCard } from "./AgentWorkplaceBlockCard";
import { PromptCollapsibleField } from "./PromptCollapsibleField";
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
  ipcProviderModelsSavedList,
  ipcProvidersList,
} from "@/ipc/client";
import {
  buildDefaultAgentDefinitionPreservingName,
  STORED_CONFIG_LABELS,
  storedConfigInvalidReason,
} from "@shared/logic/config-forms-stored-config-validity";
import type {
  AgentDefinitionPlain,
  StoredConfigHealthDto,
} from "@shared/ipc-types";
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

/** 内置 general 合成行 sentinel（与列表页同口径，不经库表读取）。 */
const GENERAL_AGENT_ID = "general";

/**
 * 「原绑定模型当前不可用」置顶项的 option value。
 * 用哨兵串而非真实 modelId：它只在列表加载不全时出现，不与任何 savedModel 撞值。
 */
const UNRESOLVED_MODEL_OPTION_VALUE = "__unresolved_original_model__";

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
  // 内置 general：复用完整编辑表单但全控件禁用（出厂常量直填，不落库）。
  const isBuiltin = agentId === GENERAL_AGENT_ID;
  const [name, setName] = useState("");
  const [maxSteps, setMaxSteps] = useState("20");
  const [modelEnabled, setModelEnabled] = useState(false);
  const [providerId, setProviderId] = useState("");
  const [savedModelId, setSavedModelId] = useState("");
  /**
   * def.model 有值、但当前模型列表里找不到它时的原串（服务商被删 / 列表加载失败）。
   * 非 null 时下拉停在置顶的「不可用」项，保存按「未被动过则保留原绑定」处理。
   */
  const [unresolvedModelId, setUnresolvedModelId] = useState<string | null>(null);
  /** 用户是否显式动过「专属模型」下拉（动过之后保存不再自动保留 unresolved 原值）。 */
  const [modelTouchedByUser, setModelTouchedByUser] = useState(false);
  const [systemEnabled, setSystemEnabled] = useState(false);
  const [systemContent, setSystemContent] = useState("");
  const [persistEnabled, setPersistEnabled] = useState(false);
  const [dynamicEnabled, setDynamicEnabled] = useState(false);
  const [workplaceEnabled, setWorkplaceEnabled] = useState(false);
  const [workplaceAssistantText, setWorkplaceAssistantText] = useState("");
  // 自定义附加信息开关 / 文本（对应域 prompts.customAttach）。
  const [customAttachEnabled, setCustomAttachEnabled] = useState(false);
  const [customAttachText, setCustomAttachText] = useState("");
  // 技能能力总开关（缺省开）：关 = 不注入技能索引且不注册 skill 工具。
  const [skillsEnabled, setSkillsEnabled] = useState(true);
  // 技能索引前缀语（索引段首行，缺省默认文案）。
  const [skillsPrefixText, setSkillsPrefixText] = useState(
    DEFAULT_SKILLS_INDEX_PREFIX
  );
  // 人类可读的 agent 描述（对应域 description，多行文本）。
  const [description, setDescription] = useState("");
  const [persist, setPersist] = useState<PersistPromptBlock[]>([]);
  const [dynamic, setDynamic] = useState<DynamicPromptBlock[]>([]);
  const [toolsMode, setToolsMode] = useState<ToolsMode>("default");
  const [mode, setMode] = useState<AgentMode>("all");
  const [toolsSelected, setToolsSelected] = useState<string[]>([]);
  const [providers, setProviders] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [savedModels, setSavedModels] = useState<
    Array<{
      id: string;
      vendorModelId: string;
      displayName: string;
      providerId: string;
    }>
  >([]);
  const [savedBaseline, setSavedBaseline] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invalidHealth, setInvalidHealth] = useState<Extract<
    StoredConfigHealthDto<AgentDefinitionPlain>,
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
        mode,
        modelEnabled,
        providerId,
        savedModelId: savedModelId,
        toolsMode,
        toolsSelected,
        systemEnabled,
        systemContent,
        persistEnabled,
        dynamicEnabled,
        workplaceEnabled,
        workplaceAssistantText,
        customAttachEnabled,
        customAttachText,
        skillsEnabled,
        skillsPrefixText,
        description,
        persist,
        dynamic,
      }),
    [
      name,
      maxSteps,
      mode,
      modelEnabled,
      providerId,
      savedModelId,
      toolsMode,
      toolsSelected,
      systemEnabled,
      systemContent,
      persistEnabled,
      dynamicEnabled,
      workplaceEnabled,
      workplaceAssistantText,
      customAttachEnabled,
      customAttachText,
      skillsEnabled,
      skillsPrefixText,
      description,
      persist,
      dynamic,
    ]
  );

  /**
   * 扁平化：一次性加载全服务商 savedModels，供「专属模型」下拉直接选。
   * 替代旧的「服务商二级联动」UI——模型 label 已含服务商前缀，无需单独选服务商。
   *
   * ⚠️ 失败不吞：单个服务商失败时它的模型整体缺席，若照旧返回空数组，
   * 调用方会把「列表没加载出来」误判成「本来就没绑定专属模型」，
   * 用户随手改个名字点保存就把原绑定从库里删掉。失败信息随返回值上抛。
   */
  const loadAllSavedModels = useCallback(
    async (
      providerRows: Array<{ id: string; label: string }>,
    ): Promise<{
      models: Array<{
        id: string;
        vendorModelId: string;
        displayName: string;
        providerId: string;
      }>;
      failedProviderIds: string[];
    }> => {
      const settled = await Promise.all(
        providerRows.map(async (p) => {
          const res = await ipcProviderModelsSavedList({ providerId: p.id });
          if (!res.ok) {
            return { providerId: p.id, models: [], failed: true as const };
          }
          return {
            providerId: p.id,
            failed: false as const,
            models: res.data.map((m) => ({
              id: m.id,
              vendorModelId: m.vendorModelId,
              displayName: m.displayName?.trim() || m.vendorModelId,
              providerId: p.id,
            })),
          };
        }),
      );
      const models = settled.flatMap((r) => r.models);
      const failedProviderIds = settled
        .filter((r) => r.failed)
        .map((r) => r.providerId);
      setSavedModels(models);
      return { models, failedProviderIds };
    },
    [],
  );

  /**
   * applyDefinition 的第二参（模型绑定形态）——刻意不加第三个位置参数：
   * 既有静态守卫逐字匹配 `applyDefinition(DEFAULT_SUBAGENT_DEFINITION, null)`。
   * - null：出厂/显式无绑定（general 出厂态、def.model 缺省）。
   * - { providerId, modelId }：解析到具体模型。
   * - { unresolved: true, rawId }：def.model 有值但当前模型列表里找不到
   *   （服务商被删 / 列表加载失败）——按「保留原绑定」处理，不得当成无绑定。
   */
  type ModelPin =
    | null
    | { providerId: string; modelId: string }
    | { unresolved: true; rawId: string };

  /** 把 def 填入全部表单 state 并落 dirty 基线（普通加载与内置 general 共用）。 */
  const applyDefinition = useCallback(
    (
      def: AgentDefinition,
      pinned: ModelPin,
    ) => {
      const promptForm = definitionToForm(def);
      setName(def.name ?? "");
      setMode(promptForm.mode);
      setMaxSteps(String(def.runtime?.maxSteps ?? 20));
      setSystemEnabled(promptForm.systemEnabled);
      setSystemContent(promptForm.systemContent);
      setPersistEnabled(promptForm.persistEnabled);
      setDynamicEnabled(promptForm.dynamicEnabled);
      setWorkplaceEnabled(promptForm.workplaceEnabled);
      setWorkplaceAssistantText(promptForm.workplaceAssistantText);
      // customAttach 从域 layout 反推开关，customAttachText 直读 prompts.customAttach。
      setCustomAttachEnabled(promptForm.customAttachEnabled);
      setCustomAttachText(promptForm.customAttachText);
      setSkillsEnabled(promptForm.skillsEnabled ?? true);
      setSkillsPrefixText(
        promptForm.skillsPrefixText ?? DEFAULT_SKILLS_INDEX_PREFIX
      );
      setDescription(promptForm.description ?? "");
      setPersist([...promptForm.persist]);
      setDynamic([...promptForm.dynamic]);

      const toolsWire = toolsSelectionFromDefinition(def);
      setToolsMode(toolsWire.mode);
      setToolsSelected([...toolsWire.selected]);

      // 无 model pin（含 general 出厂态）：下拉停在「默认(跟随)」，不预填具体模型。
      // unresolved（def.model 有值但列表里找不到）：保持「专属模型已开启」，
      // 下拉停在置顶的不可用项，保存时按未被动过则原样保留 def.model。
      const unresolvedRawId =
        pinned != null && "unresolved" in pinned ? pinned.rawId : null;
      const modelOn = pinned != null;
      setUnresolvedModelId(unresolvedRawId);
      setModelTouchedByUser(false);
      setModelEnabled(modelOn);
      setProviderId(
        pinned != null && "providerId" in pinned ? pinned.providerId : "",
      );
      setSavedModelId(
        pinned != null && "modelId" in pinned ? pinned.modelId : "",
      );

      setSavedBaseline(
        formSnapshotJson({
          name: def.name ?? "",
          maxSteps: String(def.runtime?.maxSteps ?? 20),
          modelEnabled: modelOn,
          providerId:
            pinned != null && "providerId" in pinned ? pinned.providerId : "",
          savedModelId:
            pinned != null && "modelId" in pinned ? pinned.modelId : "",
          toolsMode: toolsWire.mode,
          toolsSelected: [...toolsWire.selected],
          ...promptForm,
          persist: [...promptForm.persist],
          // 基线侧必须显式带 mode（core2 §9 B 的三处联动之一）：
          // core 的 formSnapshotJson 已把 mode 无条件纳入输出，此处不传 ⇒
          // 基线 JSON 缺 mode 键、实时快照有 mode ⇒ 打开任意智能体即显示「未保存」。
          // 放在 ...promptForm 之后：promptForm.mode 的口径与本行一致，
          // 显式写出是为了让这条联动在本文件里看得见、不会被后续重构悄悄删掉。
          mode: def.mode ?? "all",
        })
      );
    },
    [],
  );

  const loadAgent = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setLoadError(null);
    setInvalidHealth(null);
    setStoredWire(null);
    try {
      // 内置 general：sentinel 短路不经 ipcAgentRegistryGet（必 404），也不拉
      // providers/savedModels（出厂无 model pin，禁用下拉停在「默认(跟随)」）；
      // 出厂常量直填只读表单，baseline 同值 → dirty 恒 false。
      if (agentId === GENERAL_AGENT_ID) {
        applyDefinition(DEFAULT_SUBAGENT_DEFINITION, null);
        return;
      }
      const [agentRes, providerRes] = await Promise.all([
        ipcAgentRegistryGet({ agentId }),
        ipcProvidersList(),
      ]);
      if (!agentRes.ok) {
        setLoadError(agentRes.error.message);
        return;
      }
      setStoredWire(agentRes.data.wire);
      if (agentRes.data.status === "invalid") {
        setInvalidHealth(agentRes.data);
        return;
      }
      const def = agentRes.data.value as AgentDefinition;

      const providerRows = providerRes.ok
        ? providerRes.data.map((p) => ({
            id: p.id,
            label: p.displayName,
          }))
        : [];
      setProviders(providerRows);

      // 扁平化：全量加载 savedModels，下拉直接选模型。
      const { models: allModels } = await loadAllSavedModels(providerRows);
      // 三分支：无绑定 / 解析到 / 解析不到但 def.model 有值（保留原绑定，不当无绑定）。
      const pin: ModelPin =
        def.model == null
          ? null
          : (() => {
              const found = allModels.find((m) => m.id === def.model);
              return found != null
                ? { providerId: found.providerId, modelId: found.id }
                : { unresolved: true as const, rawId: def.model };
            })();
      applyDefinition(def, pin);
    } finally {
      setLoading(false);
    }
  }, [agentId, loadAllSavedModels, applyDefinition]);

  useEffect(() => {
    void loadAgent();
  }, [loadAgent]);

  const displayName = name.trim() || "未命名 Agent";

  useEffect(() => {
    if (
      !agentId ||
      agentId === GENERAL_AGENT_ID ||
      invalidHealth != null ||
      loadError != null
    ) {
      return;
    }
    nav.navState.editingAgentDisplayName = displayName;
    nav.setAgentEditorTitle?.(displayName);
  }, [agentId, invalidHealth, loadError, displayName, nav]);

  // 内置 general：标题固定为 sentinel 名（不进 dirty / 保存链路）。
  useEffect(() => {
    if (agentId === GENERAL_AGENT_ID) {
      nav.navState.editingAgentDisplayName = DEFAULT_SUBAGENT_DEFINITION.name;
      nav.setAgentEditorTitle?.(DEFAULT_SUBAGENT_DEFINITION.name);
    }
  }, [agentId, nav]);

  // dirty 上报（通用通道 nav.dirtyViews，与 SkillDetailView 同形）：
  // 挂载首跑即写入当前值（自愈异常卸载残留）、dirty 变化持续同步、
  // 卸载时清掉自己的标记。SettingsOverlay 的导航守卫读同一集合。
  //
  // ⚠️ 落点必须在下面三个早返回（!agentId / invalidHealth / loadError）之前，
  // 否则违反 hooks 规则。三种早返回态本就不该上报 dirty：那时页面上没有可编辑
  // 表单，标脏只会让「无内容可丢」的页面弹无谓的确认框。
  useEffect(() => {
    if (!agentId || invalidHealth != null || loadError != null) {
      return;
    }
    const isDirty = savedBaseline != null && snapshot !== savedBaseline;
    if (isDirty) {
      nav.dirtyViews.add("agentEditor");
    } else {
      nav.dirtyViews.delete("agentEditor");
    }
    return () => {
      nav.dirtyViews.delete("agentEditor");
    };
  }, [agentId, invalidHealth, loadError, savedBaseline, snapshot, nav]);

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
          <p className="settings-error-panel__title">无法加载智能体配置</p>
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


  const save = async () => {
    const built = buildAgentDefinitionFromForm({
      name,
      mode,
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
      workplaceEnabled,
      workplaceAssistantText,
      customAttachEnabled,
      customAttachText,
      skillsEnabled,
      skillsPrefixText,
      description,
      persist,
      dynamic,
    });
    if (!built.ok) {
      showToast(built.message);
      return;
    }
    const definition: AgentDefinition = { ...built.definition };
    if (unresolvedModelId != null && !modelTouchedByUser) {
      // 原绑定在当前列表里不可用（服务商被删 / 列表加载失败），且用户没动过下拉
      // ⇒ 保留原值，不得因为「下拉显示默认(跟随)」就把绑定从库里删掉。
      definition.model = unresolvedModelId;
    } else if (modelEnabled && savedModelId) {
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
        toastSettingsSuccess("已保存智能体配置");
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
    workplaceEnabled,
    workplaceAssistantText,
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

  // 扁平化后只有一个下拉：选「默认(跟随)」或某个具体模型。
  // 空串代表默认(跟随)——与 def.model 缺省语义对齐（buildAgentDefinitionFromForm
  // 只看 modelEnabled + savedModelId，core 零改动）。
  const handleModelSelect = (id: string) => {
    setModelTouchedByUser(true);
    if (id === "") {
      setModelEnabled(false);
      setSavedModelId("");
      // 用户显式选回「默认(跟随)」= 显式解除绑定，unresolved 提示随之消失。
      setUnresolvedModelId(null);
      return;
    }
    if (id === UNRESOLVED_MODEL_OPTION_VALUE) {
      // 停在「原绑定不可用」这一项：不清 unresolved，保存继续保留原值。
      setModelEnabled(true);
      return;
    }
    setModelEnabled(true);
    setSavedModelId(id);
    // 改绑成功即清 unresolved：unresolved 态下选一个真实模型，语义与
    // 「选回默认(跟随)」一样是「我主动改绑了」，留着会让三段式 value 的第一段
    // 把下拉重新拉回哨兵项、提示继续宣称「保存将保留原绑定」——而实际落库的是新模型，
    // 用户在 UI 上看不见自己改绑了（CR-F08 / OQ5 默认案：清掉，不拆双 state）。
    setUnresolvedModelId(null);
    const selected = savedModels.find((m) => m.id === id);
    setProviderId(selected?.providerId ?? "");
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
          disabled={isBuiltin}
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
          disabled={isBuiltin}
          onClick={() => onMove(index, 1)}
          aria-label="下移"
        >
          ↓
        </button>
      ) : null}
      <button
        type="button"
        className="icon-btn"
        disabled={isBuiltin}
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
        title="智能体配置"
        desc={
          isBuiltin
            ? "内置智能体，不可编辑——general 为出厂内置的通用子代理，运行时虚拟注入（不落库），主智能体可随时委派调用。"
            : `编辑 ${displayName}${dirty ? " · 未保存" : ""}`
        }
        toolbar={
          <div className="settings-yaml-links">
            <Button
              variant="secondary"
              disabled={isBuiltin}
              onClick={() => setConfirmImport(true)}
            >
              导入 YAML
            </Button>
            <Button
              variant="secondary"
              disabled={isBuiltin}
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
            disabled={saving || isBuiltin}
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
              disabled={isBuiltin}
              onChange={(e) => setName(e.target.value)}
            />
          </SettingsField>
          <SettingsField label="描述">
            <textarea
              rows={3}
              value={description}
              disabled={isBuiltin}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="向 task 工具说明这个智能体擅长什么，可留空。"
            />
          </SettingsField>
          <p className="settings-hint settings-hint--compact">
            用于在 task 工具中向主智能体介绍本智能体的能力。
          </p>
          <SettingsField label="作用域">
            <select
              value={mode}
              disabled={isBuiltin}
              onChange={(e) => setMode(e.target.value as AgentMode)}
            >
              {MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SettingsField>
        </SettingsSection>

        <SettingsSection title="模型">
          <SettingsField
            label="专属模型"
            hint="默认(跟随) 表示使用会话操作抽屉 / 我的里设置的当前模型。"
          >
            <select
              value={
                unresolvedModelId != null
                  ? UNRESOLVED_MODEL_OPTION_VALUE
                  : modelEnabled
                    ? savedModelId
                    : ""
              }
              disabled={isBuiltin}
              onChange={(e) => handleModelSelect(e.target.value)}
            >
              <option value="">默认(跟随)</option>
              {unresolvedModelId != null ? (
                <option value={UNRESOLVED_MODEL_OPTION_VALUE}>
                  ⚠ 原绑定模型当前不可用（{unresolvedModelId}）
                </option>
              ) : null}
              {savedModels.map((m) => {
                const providerLabel =
                  providers.find((p) => p.id === m.providerId)?.label ??
                  "未知服务商";
                return (
                  <option key={m.id} value={m.id}>
                    {providerLabel} / {m.displayName}
                  </option>
                );
              })}
            </select>
          </SettingsField>
          {unresolvedModelId != null ? (
            <p className="settings-hint settings-hint--compact">
              原绑定模型当前不可用（服务商可能已删除或模型列表加载失败），保存将保留原绑定；选择「默认(跟随)」可解除。
            </p>
          ) : null}
        </SettingsSection>

        <SettingsSection title="运行时">
          <SettingsField label={PROMPT_REGION_LABELS.maxStepsLabel}>
            <input
              type="number"
              min={1}
              value={maxSteps}
              disabled={isBuiltin}
              onChange={(e) => setMaxSteps(e.target.value)}
            />
          </SettingsField>
          <p className="settings-hint">{PROMPT_REGION_LABELS.maxStepsHint}</p>
        </SettingsSection>

        <SettingsSection title="工具策略">
          <SettingsField label="模式">
            <select
              value={toolsMode}
              disabled={isBuiltin}
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
              未配置时使用全部内置工具（11
              个）：task、read、write、edit、fs、glob、grep、skill、agent、curl、search。
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
                disabled={isBuiltin}
                aria-label={PROMPT_REGION_LABELS.enableSystem}
              />
            </div>
            <div className="config-block-card__body">
              {systemEnabled ? (
                <SettingsField label={PROMPT_REGION_LABELS.systemContent}>
                  <PromptCollapsibleField
                    value={systemContent}
                    onChange={setSystemContent}
                    disabled={isBuiltin}
                    ariaLabel={PROMPT_REGION_LABELS.systemContent}
                  >
                    <textarea
                      rows={4}
                      value={systemContent}
                      disabled={isBuiltin}
                      onChange={(e) => setSystemContent(e.target.value)}
                      onKeyDown={handlePromptTextareaKeyDown}
                      placeholder={PROMPT_REGION_LABELS.systemPlaceholder}
                    />
                  </PromptCollapsibleField>
                </SettingsField>
              ) : (
                <p className="config-block-card__hint">
                  {PROMPT_REGION_LABELS.systemDisabledHint}
                </p>
              )}
            </div>
          </div>

          {/* 技能索引占位卡：运行时自动注入；总开关关 = 不注入索引且不注册 skill 工具 */}
          <div className="config-block-card config-block-card--prompt config-block-card--chat-slot">
            <div className="config-block-card__header config-block-card__header--chat-slot">
              <span className="config-block-card__badge">
                {PROMPT_REGION_LABELS.skillsTag}
              </span>
              <Switch
                checked={skillsEnabled}
                onChange={setSkillsEnabled}
                disabled={isBuiltin}
                aria-label="开启技能注入与 skill 工具"
              />
            </div>
            {skillsEnabled ? (
              <div className="config-block-card__body">
                <p className="config-block-card__hint">
                  {PROMPT_REGION_LABELS.skillsReadonlyHint}
                </p>
                <SettingsField label="索引前缀语">
                  <PromptCollapsibleField
                    value={skillsPrefixText}
                    onChange={setSkillsPrefixText}
                    disabled={isBuiltin}
                    ariaLabel="索引前缀语"
                  >
                    <textarea
                      rows={2}
                      value={skillsPrefixText}
                      disabled={isBuiltin}
                      onChange={(e) => setSkillsPrefixText(e.target.value)}
                      placeholder={DEFAULT_SKILLS_INDEX_PREFIX}
                    />
                  </PromptCollapsibleField>
                </SettingsField>
              </div>
            ) : null}
          </div>

          <AgentWorkplaceBlockCard
            disabled={isBuiltin}
            checked={workplaceEnabled}
            onChange={(next) => {
              const patched = withWorkplaceToggle(next, workplaceAssistantText);
              setWorkplaceEnabled(patched.workplaceEnabled);
              setWorkplaceAssistantText(patched.workplaceAssistantText);
            }}
            assistantText={workplaceAssistantText}
            onAssistantTextChange={setWorkplaceAssistantText}
          />

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
                disabled={isBuiltin}
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
                      disabled={isBuiltin}
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
                              disabled={isBuiltin}
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
                              disabled={isBuiltin}
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
                            <PromptCollapsibleField
                              value={block.content}
                              onChange={(content) =>
                                setPersist((prev) =>
                                  mapPersistTextBlocks(prev, (b, i) =>
                                    i === index ? { ...b, content } : b
                                  )
                                )
                              }
                              disabled={isBuiltin}
                              ariaLabel={`常驻块 ${block.name} 内容`}
                            >
                              <textarea
                                rows={4}
                                value={block.content}
                                disabled={isBuiltin}
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
                            </PromptCollapsibleField>
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
              <Switch
                checked={customAttachEnabled}
                onChange={setCustomAttachEnabled}
                disabled={isBuiltin}
                aria-label="开启自定义附加信息"
              />
            </div>
            <div className="config-block-card__body">
              <p className="config-block-card__hint">
                用户聊天历史，开启后可给每次输入附加额外内容
              </p>
              {customAttachEnabled ? (
                <SettingsField label="附加信息文本">
                  <PromptCollapsibleField
                    value={customAttachText}
                    onChange={setCustomAttachText}
                    disabled={isBuiltin}
                    ariaLabel="附加信息文本"
                  >
                    <textarea
                      rows={4}
                      value={customAttachText}
                      disabled={isBuiltin}
                      onChange={(e) => setCustomAttachText(e.target.value)}
                      onKeyDown={handlePromptTextareaKeyDown}
                      placeholder="每条用户消息都会附带这段文本给模型"
                    />
                  </PromptCollapsibleField>
                </SettingsField>
              ) : null}
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
                disabled={isBuiltin}
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
                      disabled={isBuiltin}
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
                              disabled={isBuiltin}
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
                              disabled={isBuiltin}
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
                          <SettingsField label="内容">
                            <PromptCollapsibleField
                              value={block.content}
                              onChange={(content) =>
                                setDynamic((prev) =>
                                  prev.map((b, i) =>
                                    i === index ? { ...b, content } : b
                                  )
                                )
                              }
                              disabled={isBuiltin}
                              ariaLabel={`动态块 ${block.name} 内容`}
                            >
                              <PromptMacroTextarea
                                textareaRef={
                                  dynamicInsertIndex === index
                                    ? dynamicTextareaRef
                                    : inactiveDynamicTextareaRef
                                }
                                rows={4}
                                value={block.content}
                                disabled={isBuiltin}
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
                            </PromptCollapsibleField>
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
                                disabled={isBuiltin}
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
        message="将覆盖当前智能体配置，是否继续？"
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
