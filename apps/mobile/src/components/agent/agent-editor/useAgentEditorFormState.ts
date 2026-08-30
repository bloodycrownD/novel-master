/**
 * AgentEditorForm 的状态容器（comp-rest/C-3 拆分）：
 * - 原先 20 个表单字段 useState 收敛为单个 form state 对象，
 *   formSnapshotJson 直接收这个对象，不再逐字段拼入参；
 * - providers/savedModels 装载、保存基线（savedBaseline）、加载与损坏配置
 *   状态、persist/dynamic 块级编辑操作都在这里；
 * - 组件层只保留 Alert/导航/toast 编排与渲染。
 * 行为零变化：dirty 仍为渲染期同步派生（savedBaseline vs snapshot）。
 */
import {useCallback, useMemo, useState} from 'react';
import {type AgentDefinition} from '@novel-master/core/agent';
import type {
  DynamicPromptBlock,
  PersistPromptBlock,
} from '@novel-master/core/prompt';
import {
  DEFAULT_SKILLS_INDEX_PREFIX,
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
  type AgentEditorFormInput,
} from '@novel-master/core/config-forms/agent';
import {
  assessAgentDefinitionWire,
  type StoredConfigInvalidCode,
} from '@novel-master/core/config-forms/stored-config-validity';
import {formatSavedModelDisplayName} from '@novel-master/core/provider';

import {useRuntime} from '../../../hooks/useRuntime';

type MobileRuntime = ReturnType<typeof useRuntime>;

/** savedList 返回数组的元素类型（扁平化后「专属模型」下拉的数据源）。 */
export type SavedModelEntry = Awaited<
  ReturnType<MobileRuntime['providerModels']['savedList']>
>[number];

export type SavedProviderOption = {
  id: string;
  label: string;
  protocol: string;
};

export type InvalidAgentConfig = {
  code: StoredConfigInvalidCode;
  message: string;
};

/** 表单全量状态：AgentEditorFormInput 的可变数组、必有字段版本（制控输入直接用）。 */
export type AgentEditorFormState = Omit<
  AgentEditorFormInput,
  'persist' | 'dynamic' | 'customAttachEnabled' | 'customAttachText' | 'skillsEnabled' | 'skillsPrefixText' | 'description'
> & {
  customAttachEnabled: boolean;
  customAttachText: string;
  skillsEnabled: boolean;
  skillsPrefixText: string;
  description: string;
  persist: PersistPromptBlock[];
  dynamic: DynamicPromptBlock[];
};

/** patch 入参：不含 persist/dynamic（这两个走函数式 setPersist/setDynamic）。 */
export type AgentEditorFormPatch = Partial<
  Omit<AgentEditorFormInput, 'persist' | 'dynamic'>
>;

function createInitialFormState(): AgentEditorFormState {
  return {
    name: '',
    mode: 'all',
    maxSteps: '20',
    modelEnabled: false,
    providerId: '',
    savedModelId: '',
    toolsMode: 'default',
    toolsSelected: [],
    systemEnabled: false,
    systemContent: '',
    persistEnabled: false,
    dynamicEnabled: false,
    workplaceEnabled: false,
    workplaceAssistantText: '',
    customAttachEnabled: false,
    customAttachText: '',
    // 技能能力总开关（缺省开）：关 = 不注入技能索引且不注册 skill 工具。
    skillsEnabled: true,
    // 技能索引前缀语（索引段首行，缺省默认文案）。
    skillsPrefixText: DEFAULT_SKILLS_INDEX_PREFIX,
    // 人类可读的 agent 描述（对应域 description，多行文本）。
    description: '',
    persist: [],
    dynamic: [],
  };
}

export function agentDisplayNameFromWire(
  raw: unknown,
  agentId: string,
): string {
  if (
    raw != null &&
    typeof raw === 'object' &&
    'name' in raw &&
    typeof (raw as {name: unknown}).name === 'string'
  ) {
    const trimmed = (raw as {name: string}).name.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return agentId;
}

export function useAgentEditorFormState(
  agentId: string,
  runtime: MobileRuntime,
  showToast: (message: string) => void,
) {
  const [form, setForm] = useState<AgentEditorFormState>(createInitialFormState);
  const [providers, setProviders] = useState<SavedProviderOption[]>([]);
  const [savedModels, setSavedModels] = useState<SavedModelEntry[]>([]);
  const [savedBaseline, setSavedBaseline] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invalidConfig, setInvalidConfig] = useState<InvalidAgentConfig | null>(
    null,
  );
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);

  /** 单字段/少字段补丁更新（受控输入用，等价于原先的独立 setter）。 */
  const patch = useCallback((partial: AgentEditorFormPatch) => {
    setForm(prev => ({...prev, ...partial}));
  }, []);

  /**
   * persist 块的函数式更新：更新返回同引用时保持 form 引用不变，
   * 维持原先 setState 同引用 bail-out 的渲染语义。
   */
  const setPersist = useCallback(
    (apply: (prev: PersistPromptBlock[]) => PersistPromptBlock[]) => {
      setForm(prev => {
        const next = apply(prev.persist);
        return next === prev.persist ? prev : {...prev, persist: next};
      });
    },
    [],
  );

  const setDynamic = useCallback(
    (apply: (prev: DynamicPromptBlock[]) => DynamicPromptBlock[]) => {
      setForm(prev => {
        const next = apply(prev.dynamic);
        return next === prev.dynamic ? prev : {...prev, dynamic: next};
      });
    },
    [],
  );

  // formSnapshotJson 只收一个 state 对象；mode 等全部字段纳入依赖
  // （原实现依赖数组漏了 mode，收敛后顺带修正）。
  const snapshot = useMemo(() => formSnapshotJson(form), [form]);

  // 渲染期同步派生：与 snapshot 同帧计算，外部「有未保存的更改」标记不依赖
  // effect 时序（全屏保存回填、表单保存后均与内容同帧刷新）；effect 仅向
  // 外层同步 useUnsavedGuard 需要的脏状态。
  const isDirty = savedBaseline != null && snapshot !== savedBaseline;

  const loadProviders = useCallback(async () => {
    const list = await runtime.providers.list();
    setProviders(
      list.map(p => ({
        id: p.id,
        label: p.displayName,
        protocol: p.protocol,
      })),
    );
    return list;
  }, [runtime]);

  // 扁平化：聚合所有服务商下的 savedModels，供「专属模型」下拉直接选。
  // 替代旧的「服务商二级联动」UI——模型 label 已含服务商前缀，无需单独选服务商。
  const loadAllSavedModels = useCallback(async () => {
    const providerList = await runtime.providers.list();
    const all = await Promise.all(
      providerList.map(p => runtime.providerModels.savedList(p.id)),
    );
    const flat = all.flat();
    setSavedModels(flat);
    return flat;
  }, [runtime]);

  const populateFormFromDefinition = useCallback(
    async (def: AgentDefinition) => {
      const promptForm = definitionToForm(def);
      const toolsWire = toolsSelectionFromDefinition(def);
      setForm(prev => ({
        ...prev,
        name: def.name,
        mode: def.mode ?? 'all',
        maxSteps: String(def.runtime?.maxSteps ?? 20),
        systemEnabled: promptForm.systemEnabled,
        systemContent: promptForm.systemContent,
        persistEnabled: promptForm.persistEnabled,
        dynamicEnabled: promptForm.dynamicEnabled,
        workplaceEnabled: promptForm.workplaceEnabled,
        workplaceAssistantText: promptForm.workplaceAssistantText,
        customAttachEnabled: promptForm.customAttachEnabled ?? false,
        customAttachText: promptForm.customAttachText ?? '',
        skillsEnabled: promptForm.skillsEnabled ?? true,
        skillsPrefixText:
          promptForm.skillsPrefixText ?? DEFAULT_SKILLS_INDEX_PREFIX,
        description: promptForm.description ?? '',
        persist: [...promptForm.persist],
        dynamic: [...promptForm.dynamic],
        toolsMode: toolsWire.mode,
        toolsSelected: [...toolsWire.selected],
      }));
      // 扁平化：一次性加载全服务商 savedModels，下拉直接选模型，不再二级联动。
      await loadProviders();
      const allModels = await loadAllSavedModels();
      const modelEnabledWire = Boolean(def.model);
      let baselineProviderId = '';
      let baselineSavedModelId = '';
      if (modelEnabledWire && def.model) {
        const saved = allModels.find(m => m.id === def.model);
        if (saved) {
          baselineProviderId = saved.providerId;
          baselineSavedModelId = def.model;
        }
      }
      // 跟随聊天模型时下拉停在「默认(跟随)」，不预填具体模型。
      setForm(prev => ({
        ...prev,
        modelEnabled: modelEnabledWire,
        providerId: baselineProviderId,
        savedModelId: baselineSavedModelId,
      }));
      setSavedBaseline(
        formSnapshotJson({
          name: def.name,
          maxSteps: String(def.runtime?.maxSteps ?? 20),
          modelEnabled: modelEnabledWire,
          providerId: baselineProviderId,
          savedModelId: baselineSavedModelId,
          toolsMode: toolsWire.mode,
          toolsSelected: [...toolsWire.selected],
          ...promptForm,
          persist: [...promptForm.persist],
        }),
      );
    },
    [loadProviders, loadAllSavedModels],
  );

  const loadAgent = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setInvalidConfig(null);
    setDisplayName(null);
    try {
      const raw = await runtime.agentRegistry.getRawWire(agentId);
      if (raw === null) {
        setLoadError(`未找到 Agent：${agentId}`);
        return;
      }
      const health = assessAgentDefinitionWire(raw);
      if (health.status === 'invalid') {
        setDisplayName(agentDisplayNameFromWire(raw, agentId));
        setInvalidConfig({code: health.code, message: health.message});
        return;
      }
      await populateFormFromDefinition(health.value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [agentId, populateFormFromDefinition, runtime]);

  /** 当前渲染帧的三区表单切片（persist 删除守卫用）。 */
  const promptRegionForm = () => ({
    systemEnabled: form.systemEnabled,
    systemContent: form.systemContent,
    persistEnabled: form.persistEnabled,
    dynamicEnabled: form.dynamicEnabled,
    workplaceEnabled: form.workplaceEnabled,
    workplaceAssistantText: form.workplaceAssistantText,
    customAttachEnabled: form.customAttachEnabled,
    customAttachText: form.customAttachText,
    skillsEnabled: form.skillsEnabled,
    skillsPrefixText: form.skillsPrefixText,
    persist: form.persist,
    dynamic: form.dynamic,
  });

  // 块级操作保持拆分前的普通函数形态（每帧重建，闭包读当前渲染帧的 form）。
  const movePersist = (textIndex: number, dir: -1 | 1) => {
    setPersist(prev => movePersistTextBlock(prev, textIndex, dir));
  };

  const moveDynamic = (index: number, dir: -1 | 1) => {
    setDynamic(prev => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) {
        return prev;
      }
      const tmp = next[target]!;
      next[target] = next[index]!;
      next[index] = tmp;
      return next;
    });
  };

  const deletePersist = (textIndex: number) => {
    const nextPersist = deletePersistTextBlock(form.persist, textIndex);
    const nextForm = {...promptRegionForm(), persist: nextPersist};
    if (!hasAnyPromptRegionEnabled(promptRegionForm())) {
      setPersist(() => nextPersist);
      return;
    }
    if (countFormPromptSources(nextForm) < 1) {
      showToast('至少保留一个 Prompt 块');
      return;
    }
    setPersist(() => nextPersist);
  };

  const deleteDynamic = (index: number) => {
    setDynamic(prev => prev.filter((_, i) => i !== index));
  };

  const addPersistTextBlock = () => {
    setPersist(prev => [...prev, createDefaultPersistTextBlock(prev.length)]);
  };

  const addDynamicBlock = () => {
    setDynamic(prev => [...prev, createDefaultDynamicTextBlock(prev.length)]);
  };

  // 扁平化后只有一个下拉：选「默认(跟随)」或某个具体模型。
  // 空串代表默认(跟随)——与 def.model 缺省语义对齐（buildAgentDefinitionFromForm
  // 只看 modelEnabled + savedModelId，core 零改动）。
  const handleModelSelect = useCallback(
    (id: string) => {
      if (id === '') {
        patch({modelEnabled: false, savedModelId: ''});
        return;
      }
      const selected = savedModels.find(m => m.id === id);
      patch({
        modelEnabled: true,
        savedModelId: id,
        providerId: selected?.providerId ?? '',
      });
    },
    [patch, savedModels],
  );

  // 重复计数与 ModelPickerModal 同口径：按 providerId+modelName 统计。
  // 不能只按 modelName 全局计数——同一模型名挂在两个服务商下时各算一条，
  // 否则会误判重复、每行都露出与模型名相同的 vendorModelId 副标题，
  // 看起来像一行展示了两个模型 id。
  const modelNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const model of savedModels) {
      const key = `${model.providerId}\0${model.modelName}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [savedModels]);
  // 下拉选项：「默认(跟随)」恒在首位，后面是全服务商已保存模型（label 含服务商前缀，
  // 按字母排序与工作区模型下拉一致）。
  const modelSelectOptions = useMemo(() => {
    const modelOptions = savedModels
      .map(m => ({
        value: m.id,
        label: formatSavedModelDisplayName(
          providers.find(p => p.id === m.providerId)?.label ?? '未知服务商',
          m.modelName,
        ),
        subtitle:
          (modelNameCounts.get(`${m.providerId}\0${m.modelName}`) ?? 0) > 1
            ? m.vendorModelId
            : undefined,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{value: '', label: '默认(跟随)'}, ...modelOptions];
  }, [savedModels, providers, modelNameCounts]);

  return {
    // 表单值（单对象）与更新入口
    form,
    patch,
    setPersist,
    setDynamic,
    // 块级操作
    movePersist,
    moveDynamic,
    deletePersist,
    deleteDynamic,
    addPersistTextBlock,
    addDynamicBlock,
    // 模型下拉
    handleModelSelect,
    modelSelectOptions,
    savedModels,
    providers,
    // dirty 链路
    snapshot,
    isDirty,
    savedBaseline,
    setSavedBaseline,
    // 加载与保存状态
    loadAgent,
    loading,
    loadError,
    invalidConfig,
    displayName,
    recovering,
    setRecovering,
    saving,
    setSaving,
  };
}

export type AgentEditorFormStateApi = ReturnType<
  typeof useAgentEditorFormState
>;
