/**
 * Agent definition editor: name, model pin, maxSteps, three-region prompt layout.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { type AgentDefinition } from '@novel-master/core/agent';

import {
  type DynamicPromptBlock,
  type PersistPromptBlock,
  type PersistTextPromptBlock,
} from '@novel-master/core/prompt';
import {
  DEFAULT_SKILLS_INDEX_PREFIX,
  ROLE_OPTIONS,
  TOOL_MODE_OPTIONS,
  MODE_OPTIONS,
  PROMPT_REGION_LABELS,
  WORKPLACE_BLOCK_LABEL,
  WORKPLACE_BLOCK_HINT,
  WORKPLACE_ASSISTANT_TEXT_LABEL,
  blockTypeLabel,
  buildAgentDefinitionFromForm,
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
  withWorkplaceToggle,
  type ToolsMode,
  type AgentMode,
} from '@novel-master/core/config-forms/agent';
import {
  STORED_CONFIG_LABELS,
  assessAgentDefinitionWire,
  buildDefaultAgentDefinitionPreservingName,
  storedConfigInvalidReason,
  type StoredConfigInvalidCode,
} from '@novel-master/core/config-forms/stored-config-validity';
import { registerBuiltinTools, ToolRegistry } from '@novel-master/core';

import { formatSavedModelDisplayName } from '@novel-master/core/provider';
import { ToolPolicyPicker } from './ToolPolicyPicker';
import { FormField } from '../form/FormField';
import { FormSwitchRow } from '../form/FormSwitchRow';
import { FormSectionCard } from '../form/FormSectionCard';
import { FormSelectField } from '../form/FormSelectField';
import { FormTextInput } from '../form/FormTextInput';
import { PromptMacroTextInput } from './PromptMacroTextInput';
import { ScreenFormLayout } from '../form/ScreenFormLayout';
import { StickyFormFooter } from '../form/StickyFormFooter';
import { useRuntime } from '../../hooks/useRuntime';
import { useTheme } from '../../theme/ThemeProvider';
import { useToast } from '../chrome/ToastHost';
import { toastMessage } from '../../errors/toast-message';
import {
  exportAgentYaml,
  importAgentYaml,
} from '../../services/agent-yaml.service';
import type { RootStackParamList } from '../../navigation/types';

type StackNav = NativeStackNavigationProp<RootStackParamList>;

type InvalidAgentConfig = {
  code: StoredConfigInvalidCode;
  message: string;
};

function agentDisplayNameFromWire(raw: unknown, agentId: string): string {
  if (
    raw != null &&
    typeof raw === 'object' &&
    'name' in raw &&
    typeof (raw as { name: unknown }).name === 'string'
  ) {
    const trimmed = (raw as { name: string }).name.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return agentId;
}

type Props = {
  agentId: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void | Promise<void>;
};

// 自定义附加信息输入框文案（core 未导出，UI 层自管）。
const CUSTOM_ATTACH_TEXT_LABEL = '附加信息内容';

export function AgentEditorForm(props: Props) {
  const { onDirtyChange, onSaved, agentId } = props;
  const { tokens } = useTheme();
  const { showToast } = useToast();
  const navigation = useNavigation<StackNav>();
  const runtime = useRuntime();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<AgentMode>('all');
  const [maxSteps, setMaxSteps] = useState('20');
  const [modelEnabled, setModelEnabled] = useState(false);
  const [providerId, setProviderId] = useState('');
  const [savedModelId, setSavedModelId] = useState('');

  const [systemEnabled, setSystemEnabled] = useState(false);
  const [systemContent, setSystemContent] = useState('');
  const [persistEnabled, setPersistEnabled] = useState(false);
  const [dynamicEnabled, setDynamicEnabled] = useState(false);
  const [workplaceEnabled, setWorkplaceEnabled] = useState(false);
  const [workplaceAssistantText, setWorkplaceAssistantText] = useState('');
  const [customAttachEnabled, setCustomAttachEnabled] = useState(false);
  const [customAttachText, setCustomAttachText] = useState('');
  // 技能能力总开关（缺省开）：关 = 不注入技能索引且不注册 skill 工具。
  const [skillsEnabled, setSkillsEnabled] = useState(true);
  // 技能索引前缀语（索引段首行，缺省默认文案）。
  const [skillsPrefixText, setSkillsPrefixText] = useState(
    DEFAULT_SKILLS_INDEX_PREFIX,
  );
  // 人类可读的 agent 描述（对应域 description，多行文本）。
  const [description, setDescription] = useState('');
  const [persist, setPersist] = useState<PersistPromptBlock[]>([]);
  const [dynamic, setDynamic] = useState<DynamicPromptBlock[]>([]);
  const [providers, setProviders] = useState<
    Array<{ id: string; label: string; protocol: string }>
  >([]);
  const [savedModels, setSavedModels] = useState<
    Awaited<ReturnType<typeof runtime.providerModels.savedList>>
  >([]);
  const [savedBaseline, setSavedBaseline] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invalidConfig, setInvalidConfig] = useState<InvalidAgentConfig | null>(
    null,
  );
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [toolsMode, setToolsMode] = useState<ToolsMode>('default');
  const [toolsSelected, setToolsSelected] = useState<string[]>([]);

  const snapshot = useMemo(
    () =>
      formSnapshotJson({
        name,
        mode,
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
        workplaceEnabled,
        workplaceAssistantText,
        customAttachEnabled,
        customAttachText,
        description,
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
      workplaceEnabled,
      workplaceAssistantText,
      customAttachEnabled,
      customAttachText,
      description,
      persist,
      dynamic,
    ],
  );

  useEffect(() => {
    if (savedBaseline == null) {
      onDirtyChange?.(false);
      return;
    }
    onDirtyChange?.(snapshot !== savedBaseline);
  }, [snapshot, savedBaseline, onDirtyChange]);

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
      setName(def.name);
      setMode(def.mode ?? 'all');
      setMaxSteps(String(def.runtime?.maxSteps ?? 20));
      setSystemEnabled(promptForm.systemEnabled);
      setSystemContent(promptForm.systemContent);
      setPersistEnabled(promptForm.persistEnabled);
      setDynamicEnabled(promptForm.dynamicEnabled);
      setWorkplaceEnabled(promptForm.workplaceEnabled);
      setWorkplaceAssistantText(promptForm.workplaceAssistantText);
      setCustomAttachEnabled(promptForm.customAttachEnabled ?? false);
      setCustomAttachText(promptForm.customAttachText ?? '');
      setSkillsEnabled(promptForm.skillsEnabled ?? true);
      setSkillsPrefixText(
        promptForm.skillsPrefixText ?? DEFAULT_SKILLS_INDEX_PREFIX,
      );
      setDescription(promptForm.description ?? '');
      setPersist([...promptForm.persist]);
      setDynamic([...promptForm.dynamic]);

      const toolsWire = toolsSelectionFromDefinition(def);
      setToolsMode(toolsWire.mode);
      setToolsSelected([...toolsWire.selected]);
      // 扁平化：一次性加载全服务商 savedModels，下拉直接选模型，不再二级联动。
      await loadProviders();
      const allModels = await loadAllSavedModels();
      const modelEnabledWire = Boolean(def.model);
      setModelEnabled(modelEnabledWire);
      let baselineProviderId = '';
      let baselineSavedModelId = '';
      if (modelEnabledWire && def.model) {
        const saved = allModels.find(m => m.id === def.model);
        if (saved) {
          setProviderId(saved.providerId);
          setSavedModelId(saved.id);
          baselineProviderId = saved.providerId;
          baselineSavedModelId = def.model;
        } else {
          setSavedModelId('');
        }
      } else {
        // 跟随聊天模型：下拉停在「默认(跟随)」，不预填具体模型。
        setSavedModelId('');
      }
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
    [loadProviders, loadAllSavedModels, runtime],
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
        setInvalidConfig({ code: health.code, message: health.message });
        return;
      }
      await populateFormFromDefinition(health.value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [
    agentId,
    populateFormFromDefinition,
    runtime,
  ]);

  useEffect(() => {
    loadAgent().catch(err => showToast(toastMessage('加载失败', err)));
  }, [loadAgent, showToast]);

  const handleDeleteBrokenAgent = useCallback(() => {
    Alert.alert('删除 Agent', `删除 Agent「${displayName ?? agentId}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              const ids = await runtime.agentRegistry.listAgentIds();
              if (ids.length <= 1) {
                showToast('至少保留一个 Agent');
                return;
              }
              await runtime.agentRegistry.delete(agentId);
              navigation.goBack();
            } catch (error) {
              showToast(toastMessage('删除失败', error));
            }
          })();
        },
      },
    ]);
  }, [agentId, displayName, navigation, runtime, showToast]);

  const handleOverwriteDefault = useCallback(() => {
    Alert.alert(
      '覆盖为默认模板',
      '将用默认 prompts 与运行时覆盖当前配置，并保留 Agent ID 与显示名称。是否继续？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '覆盖并保存',
          onPress: () => {
            void (async () => {
              setRecovering(true);
              try {
                const raw = await runtime.agentRegistry.getRawWire(agentId);
                const displayName = agentDisplayNameFromWire(raw, agentId);
                const def = buildDefaultAgentDefinitionPreservingName(
                  displayName.trim() || agentId,
                );
                const probe = new ToolRegistry();
                registerBuiltinTools(probe);
                await runtime.agentRegistry.upsert(agentId, def, {
                  registeredToolNames: probe.list(),
                });
                await loadAgent();
                await onSaved?.();
                showToast('已用默认模板覆盖并保存');
              } catch (error) {
                showToast(toastMessage('覆盖默认失败', error));
              } finally {
                setRecovering(false);
              }
            })();
          },
        },
      ],
    );
  }, [
    agentId,
    loadAgent,
    onSaved,
    runtime,
    showToast,
  ]);



  const handleSave = async () => {
    const built = buildAgentDefinitionFromForm({
      name,
      mode,
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
    let def = built.definition;
    if (modelEnabled) {
      if (!savedModelId) {
        showToast('请选择专属模型');
        return;
      }
      def = { ...def, model: savedModelId };
    }
    setSaving(true);
    try {
      const probe = new ToolRegistry();
      registerBuiltinTools(probe);
      await runtime.agentRegistry.upsert(agentId, def, {
        registeredToolNames: probe.list(),
      });
      setSavedBaseline(snapshot);
      await onSaved?.();
      showToast('已保存智能体配置');
    } catch (error) {
      showToast(toastMessage('保存失败', error));
    } finally {
      setSaving(false);
    }
  };

  const handleExportYaml = useCallback(async () => {
    try {
      const result = await exportAgentYaml(runtime, agentId);
      if (result === 'saved') {
        showToast('已导出 Agent YAML');
      }
    } catch (error) {
      showToast(toastMessage('导出 YAML 失败', error));
    }
  }, [runtime, agentId, showToast]);

  const handleImportYaml = useCallback(() => {
    Alert.alert('导入 YAML', '将覆盖当前智能体配置，是否继续？', [
      { text: '取消', style: 'cancel' },
      {
        text: '导入',
        onPress: () => {
          void (async () => {
            try {
              await importAgentYaml(runtime, agentId);
              await loadAgent();
              showToast('已导入 Agent YAML');
            } catch (error) {
              showToast(toastMessage('导入 YAML 失败', error));
            }
          })();
        },
      },
    ]);
  }, [runtime, agentId, loadAgent, showToast]);

  const promptRegionForm = () => ({
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
    persist,
    dynamic,
  });

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
      const tmp = next[target];
      next[target] = next[index];
      next[index] = tmp;
      return next;
    });
  };

  const deletePersist = (textIndex: number) => {
    const nextPersist = deletePersistTextBlock(persist, textIndex);
    const nextForm = { ...promptRegionForm(), persist: nextPersist };
    if (!hasAnyPromptRegionEnabled(promptRegionForm())) {
      setPersist(nextPersist);
      return;
    }
    if (countFormPromptSources(nextForm) < 1) {
      showToast('至少保留一个 Prompt 块');
      return;
    }
    setPersist(nextPersist);
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
  const handleModelSelect = (id: string) => {
    if (id === '') {
      setModelEnabled(false);
      setSavedModelId('');
      return;
    }
    setModelEnabled(true);
    setSavedModelId(id);
    const selected = savedModels.find(m => m.id === id);
    setProviderId(selected?.providerId ?? '');
  };

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

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <Text style={{ color: tokens.textSecondary }}>加载中…</Text>
      </View>
    );
  }

  if (loadError != null || invalidConfig != null) {
    const title =
      invalidConfig != null ? STORED_CONFIG_LABELS.invalidTitle : '加载失败';
    const reason =
      invalidConfig != null
        ? storedConfigInvalidReason(invalidConfig.code)
        : loadError ?? '';
    const detail = invalidConfig?.message ?? '';
    return (
      <View style={styles.invalidWrap}>
        <View
          style={[
            styles.invalidCard,
            { borderColor: tokens.border, backgroundColor: tokens.surface },
          ]}
        >
          <Text style={[styles.invalidTitle, { color: tokens.text }]}>
            {title}
          </Text>
          <Text style={[styles.invalidReason, { color: tokens.textSecondary }]}>
            {reason}
          </Text>
          {typeof __DEV__ !== 'undefined' && __DEV__ && detail.length > 0 ? (
            <Text
              style={[styles.invalidDetail, { color: tokens.textTertiary }]}
            >
              {detail}
            </Text>
          ) : null}
          <View style={styles.invalidActions}>
            <Pressable
              disabled={recovering}
              onPress={() => navigation.goBack()}
            >
              <Text
                style={{
                  color: tokens.primary,
                  fontSize: 14,
                  fontWeight: '600',
                }}
              >
                {STORED_CONFIG_LABELS.agentBack}
              </Text>
            </Pressable>
            {invalidConfig != null ? (
              <Pressable disabled={recovering} onPress={handleOverwriteDefault}>
                <Text
                  style={{
                    color: tokens.primary,
                    fontSize: 14,
                    fontWeight: '600',
                  }}
                >
                  {STORED_CONFIG_LABELS.agentOverwriteDefault}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              disabled={recovering}
              onPress={handleDeleteBrokenAgent}
            >
              <Text
                style={{
                  color: tokens.danger,
                  fontSize: 14,
                  fontWeight: '600',
                }}
              >
                {STORED_CONFIG_LABELS.agentDelete}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  /** 四区小标题；旧 core 包缺键时用本地兜底，避免标题空白。 */
  const promptSectionLabels = {
    system: PROMPT_REGION_LABELS.systemBlocks ?? '系统区',
    skills: PROMPT_REGION_LABELS.skillsBlocks ?? '技能索引区',
    persist: PROMPT_REGION_LABELS.persistBlocks,
    chat: PROMPT_REGION_LABELS.chatBlocks ?? '会话区',
    dynamic: PROMPT_REGION_LABELS.dynamicBlocks,
  };

  const renderPromptSectionHead = (
    label: string,
    opts?: {
      onAdd?: () => void;
      switchValue?: boolean;
      onSwitchChange?: (value: boolean) => void;
    },
  ) => (
    <View style={styles.sectionHead}>
      <Text style={[styles.sectionLabel, { color: tokens.text }]}>{label}</Text>
      <View style={styles.sectionHeadActions}>
        {opts?.onAdd != null ? (
          <Pressable onPress={opts.onAdd}>
            <Text style={{ color: tokens.primary, fontWeight: '600' }}>
              添加
            </Text>
          </Pressable>
        ) : null}
        {opts?.switchValue !== undefined && opts.onSwitchChange != null ? (
          <Switch
            value={opts.switchValue}
            onValueChange={opts.onSwitchChange}
            trackColor={{ false: tokens.border, true: tokens.primary }}
          />
        ) : null}
      </View>
    </View>
  );

  const renderBlockActions = (
    index: number,
    total: number,
    onMove: (i: number, d: -1 | 1) => void,
    onDelete: (i: number) => void,
  ) => (
    <View style={styles.blockActions}>
      {index > 0 ? (
        <Pressable
          style={[
            styles.actionBtn,
            { borderColor: tokens.border, backgroundColor: tokens.surface },
          ]}
          onPress={() => onMove(index, -1)}
        >
          <Text style={{ color: tokens.textSecondary }}>↑</Text>
        </Pressable>
      ) : null}
      {index < total - 1 ? (
        <Pressable
          style={[
            styles.actionBtn,
            { borderColor: tokens.border, backgroundColor: tokens.surface },
          ]}
          onPress={() => onMove(index, 1)}
        >
          <Text style={{ color: tokens.textSecondary }}>↓</Text>
        </Pressable>
      ) : null}
      <Pressable
        style={[
          styles.actionBtn,
          { borderColor: tokens.border, backgroundColor: tokens.surface },
        ]}
        onPress={() => onDelete(index)}
      >
        <Text style={{ color: tokens.danger }}>×</Text>
      </Pressable>
    </View>
  );

  return (
    <>
      <ScreenFormLayout
        tokens={tokens}
        footer={
          <StickyFormFooter
            tokens={tokens}
            label="保存"
            loading={saving}
            onPress={() => handleSave().catch(() => undefined)}
          />
        }
      >
        <FormSectionCard title="基本信息" tokens={tokens}>
          <View style={styles.yamlActions}>
            <Pressable onPress={() => handleImportYaml()}>
              <Text style={{ color: tokens.primary, fontWeight: '600' }}>
                导入 YAML
              </Text>
            </Pressable>
            <Pressable
              onPress={() => handleExportYaml().catch(() => undefined)}
            >
              <Text style={{ color: tokens.primary, fontWeight: '600' }}>
                导出 YAML
              </Text>
            </Pressable>
          </View>
          <FormField label="名称" tokens={tokens}>
            <FormTextInput
              tokens={tokens}
              value={name}
              onChangeText={setName}
            />
          </FormField>
          <FormField label="作用域" tokens={tokens}>
            <FormSelectField
              tokens={tokens}
              value={mode}
              onChange={value => setMode(value as AgentMode)}
              options={MODE_OPTIONS}
              sheetTitle="选择作用域"
            />
          </FormField>
          <FormField
            label="描述"
            tokens={tokens}
            hint="向 task 工具说明这个智能体擅长什么，可留空。"
          >
            <FormTextInput
              tokens={tokens}
              value={description}
              onChangeText={setDescription}
              multiline
              placeholder="例如：擅长检索代码库、写测试。"
            />
          </FormField>
        </FormSectionCard>

        <FormSectionCard title="模型" tokens={tokens}>
          <FormField
            label="专属模型"
            tokens={tokens}
            hint="默认(跟随) 表示使用会话操作抽屉 / 我的里设置的当前模型。"
          >
            <FormSelectField
              tokens={tokens}
              value={modelEnabled ? savedModelId : ''}
              onChange={handleModelSelect}
              options={modelSelectOptions}
              sheetTitle="选择专属模型"
              placeholder="默认(跟随)"
              emptyLabel="请先在「服务商」页添加模型"
            />
          </FormField>
        </FormSectionCard>

        <FormSectionCard title="运行时" tokens={tokens}>
          <FormField
            label={PROMPT_REGION_LABELS.maxStepsLabel}
            tokens={tokens}
            hint={PROMPT_REGION_LABELS.maxStepsHint}
          >
            <FormTextInput
              tokens={tokens}
              value={maxSteps}
              onChangeText={setMaxSteps}
              keyboardType="number-pad"
            />
          </FormField>
        </FormSectionCard>

        <FormSectionCard title="工具策略" tokens={tokens}>
          <FormField label="模式" tokens={tokens}>
            <FormSelectField
              tokens={tokens}
              value={toolsMode}
              onChange={value => setToolsMode(value as ToolsMode)}
              options={TOOL_MODE_OPTIONS}
              sheetTitle="工具名单模式"
            />
          </FormField>
          {toolsMode !== 'default' ? (
            <FormField
              label={toolsMode === 'allow' ? '白名单工具' : '黑名单工具'}
              tokens={tokens}
            >
              <ToolPolicyPicker
                tokens={tokens}
                selected={toolsSelected}
                onChange={setToolsSelected}
              />
            </FormField>
          ) : (
            <Text style={[styles.hint, { color: tokens.textSecondary }]}>
              未配置时使用全部内置工具（8
              个）：task、read、write、edit、fs、glob、grep、skill。
            </Text>
          )}
        </FormSectionCard>

        <FormSectionCard
          title={PROMPT_REGION_LABELS.layoutTitle}
          tokens={tokens}
        >
          {renderPromptSectionHead(promptSectionLabels.system, {
            switchValue: systemEnabled,
            onSwitchChange: setSystemEnabled,
          })}
          <View
            style={[
              styles.blockCard,
              { backgroundColor: tokens.surface, borderColor: tokens.border },
            ]}
          >
            {systemEnabled ? (
              <FormField
                label={PROMPT_REGION_LABELS.systemContent}
                tokens={tokens}
              >
                <FormTextInput
                  tokens={tokens}
                  value={systemContent}
                  onChangeText={setSystemContent}
                  multiline
                  placeholder={PROMPT_REGION_LABELS.systemPlaceholderShort}
                />
              </FormField>
            ) : (
              <Text style={[styles.fieldHint, { color: tokens.textSecondary }]}>
                {PROMPT_REGION_LABELS.systemDisabledHint}
              </Text>
            )}
          </View>

          {/* 技能索引占位卡：运行时自动注入，无开关无输入框，不可配置 */}
          {renderPromptSectionHead(promptSectionLabels.skills)}
          <View
            style={[
              styles.chatSlotCard,
              {
                backgroundColor: tokens.background,
                borderColor: tokens.borderLight,
                borderLeftColor: tokens.primary,
              },
            ]}
          >
            <View style={styles.chatSlotHeader}>
              <View
                style={[
                  styles.chatSlotTag,
                  {backgroundColor: `${tokens.primary}18`},
                ]}
              >
                <Text
                  style={[styles.chatSlotTagText, {color: tokens.primary}]}
                >
                  {PROMPT_REGION_LABELS.skillsTag}
                </Text>
              </View>
              <Switch
                value={skillsEnabled}
                onValueChange={setSkillsEnabled}
                trackColor={{false: tokens.border, true: tokens.primary}}
              />
            </View>
            {skillsEnabled ? (
              <>
                <Text
                  style={[styles.chatSlotHint, {color: tokens.textSecondary}]}
                >
                  {PROMPT_REGION_LABELS.skillsReadonlyHint}
                </Text>
                <TextInput
                  testID="agent-skills-prefix-input"
                  style={[
                    styles.skillsPrefixInput,
                    {color: tokens.text, borderColor: tokens.border},
                  ]}
                  value={skillsPrefixText}
                  onChangeText={setSkillsPrefixText}
                  placeholder="索引前缀语（首行）"
                  placeholderTextColor={tokens.textSecondary}
                  multiline
                />
              </>
            ) : null}
          </View>

          {renderPromptSectionHead(WORKPLACE_BLOCK_LABEL)}
          <View
            style={[
              styles.blockCard,
              { backgroundColor: tokens.surface, borderColor: tokens.border },
            ]}
          >
            <View style={styles.blockHeader}>
              <View
                style={[
                  styles.typeBadge,
                  { backgroundColor: `${tokens.primary}1A` },
                ]}
              >
                <Text style={[styles.typeBadgeText, { color: tokens.primary }]}>
                  {WORKPLACE_BLOCK_LABEL}
                </Text>
              </View>
              <View style={styles.blockHeaderSpacer} />
              <Switch
                value={workplaceEnabled}
                onValueChange={next => {
                  const patched = withWorkplaceToggle(
                    next,
                    workplaceAssistantText,
                  );
                  setWorkplaceEnabled(patched.workplaceEnabled);
                  setWorkplaceAssistantText(patched.workplaceAssistantText);
                }}
                trackColor={{ false: tokens.border, true: tokens.primary }}
              />
            </View>
            {workplaceEnabled ? (
              <>
                <Text
                  style={[styles.fieldHint, { color: tokens.textSecondary }]}
                >
                  {WORKPLACE_BLOCK_HINT}
                </Text>
                <FormField
                  label={WORKPLACE_ASSISTANT_TEXT_LABEL}
                  tokens={tokens}
                >
                  <FormTextInput
                    tokens={tokens}
                    value={workplaceAssistantText}
                    onChangeText={setWorkplaceAssistantText}
                    multiline
                    placeholder={WORKPLACE_ASSISTANT_TEXT_LABEL}
                  />
                </FormField>
              </>
            ) : (
              <Text style={[styles.fieldHint, { color: tokens.textSecondary }]}>
                关闭时不注入项目文件树。
              </Text>
            )}
          </View>

          {renderPromptSectionHead(promptSectionLabels.persist, {
            switchValue: persistEnabled,
            onSwitchChange: setPersistEnabled,
            ...(persistEnabled ? { onAdd: addPersistTextBlock } : {}),
          })}
          <View
            style={[
              styles.blockCard,
              { backgroundColor: tokens.surface, borderColor: tokens.border },
            ]}
          >
            {persistEnabled ? (
              <View style={styles.blockList}>
                {persist.filter(
                  (b): b is PersistTextPromptBlock => b.type === 'text',
                ).length === 0 ? (
                  <Text
                    style={[
                      styles.emptyHint,
                      {
                        color: tokens.textSecondary,
                        borderColor: tokens.borderLight,
                      },
                    ]}
                  >
                    {PROMPT_REGION_LABELS.emptyPersistHint}
                  </Text>
                ) : null}
                {persist
                  .filter(
                    (b): b is PersistTextPromptBlock => b.type === 'text',
                  )
                  .map((block, index, textBlocks) => (
                  <View
                    key={`persist-block-${index}`}
                    style={[
                      styles.blockCard,
                      {
                        backgroundColor: tokens.surface,
                        borderColor: tokens.border,
                      },
                    ]}
                  >
                    <View style={styles.blockHeader}>
                      <View
                        style={[
                          styles.typeBadge,
                          { backgroundColor: `${tokens.primary}1A` },
                        ]}
                      >
                        <Text
                          style={[
                            styles.typeBadgeText,
                            { color: tokens.primary },
                          ]}
                        >
                          {blockTypeLabel(block.type)}
                        </Text>
                      </View>
                      <Text
                        style={[styles.blockName, { color: tokens.text }]}
                        numberOfLines={1}
                      >
                        {block.name}
                      </Text>
                      {renderBlockActions(
                        index,
                        textBlocks.length,
                        movePersist,
                        deletePersist,
                      )}
                    </View>
                    <FormField label="名称" tokens={tokens}>
                      <FormTextInput
                        tokens={tokens}
                        value={block.name}
                        onChangeText={v =>
                          setPersist(prev =>
                            mapPersistTextBlocks(prev, (b, i) =>
                              i === index ? { ...b, name: v } : b,
                            ),
                          )
                        }
                      />
                    </FormField>
                    <FormField label="角色" tokens={tokens}>
                      <FormSelectField
                        tokens={tokens}
                        value={block.role}
                        onChange={role =>
                          setPersist(prev =>
                            mapPersistTextBlocks(prev, (b, i) =>
                              i === index
                                ? {
                                    ...b,
                                    role: role as PersistTextPromptBlock['role'],
                                  }
                                : b,
                            ),
                          )
                        }
                        options={ROLE_OPTIONS}
                        sheetTitle="选择角色"
                      />
                    </FormField>
                    <Text
                      style={[
                        styles.fieldHint,
                        { color: tokens.textSecondary },
                      ]}
                    >
                      {PROMPT_REGION_LABELS.persistRegionHint}
                    </Text>
                    <FormField label="内容" tokens={tokens}>
                      <FormTextInput
                        tokens={tokens}
                        value={block.content}
                        onChangeText={v =>
                          setPersist(prev =>
                            mapPersistTextBlocks(prev, (b, i) =>
                              i === index ? { ...b, content: v } : b,
                            ),
                          )
                        }
                        multiline
                      />
                    </FormField>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[styles.fieldHint, { color: tokens.textSecondary }]}>
                {PROMPT_REGION_LABELS.persistDisabledHint}
              </Text>
            )}
          </View>

          {renderPromptSectionHead(promptSectionLabels.chat)}
          <View
            style={[
              styles.chatSlotCard,
              {
                backgroundColor: tokens.background,
                borderColor: tokens.borderLight,
                borderLeftColor: tokens.primary,
              },
            ]}
          >
            <View style={styles.chatSlotHeader}>
              <View
                style={[
                  styles.chatSlotTag,
                  { backgroundColor: `${tokens.primary}18` },
                ]}
              >
                <Text
                  style={[styles.chatSlotTagText, { color: tokens.primary }]}
                >
                  {PROMPT_REGION_LABELS.chatTag}
                </Text>
              </View>
              <Switch
                value={customAttachEnabled}
                onValueChange={next => setCustomAttachEnabled(next)}
                trackColor={{ false: tokens.border, true: tokens.primary }}
              />
            </View>
            <Text
              style={[styles.chatSlotHint, { color: tokens.textSecondary }]}
            >
              用户聊天历史，开启后可给每次输入附加额外内容
            </Text>
            {customAttachEnabled ? (
              <FormField label={CUSTOM_ATTACH_TEXT_LABEL} tokens={tokens}>
                <PromptMacroTextInput
                  tokens={tokens}
                  value={customAttachText}
                  onChangeText={setCustomAttachText}
                  placeholder="支持 $time、$week_cn、$filetree…"
                />
              </FormField>
            ) : null}
          </View>

          {renderPromptSectionHead(promptSectionLabels.dynamic, {
            switchValue: dynamicEnabled,
            onSwitchChange: setDynamicEnabled,
            ...(dynamicEnabled ? { onAdd: addDynamicBlock } : {}),
          })}
          <View
            style={[
              styles.blockCard,
              { backgroundColor: tokens.surface, borderColor: tokens.border },
            ]}
          >
            {dynamicEnabled ? (
              <View style={styles.blockList}>
                {dynamic.length === 0 ? (
                  <Text
                    style={[
                      styles.emptyHint,
                      {
                        color: tokens.textSecondary,
                        borderColor: tokens.borderLight,
                      },
                    ]}
                  >
                    {PROMPT_REGION_LABELS.emptyDynamicHint}
                  </Text>
                ) : null}
                {dynamic.map((block, index) => (
                  <View
                    key={`dynamic-block-${index}`}
                    style={[
                      styles.blockCard,
                      {
                        backgroundColor: tokens.surface,
                        borderColor: tokens.border,
                      },
                    ]}
                  >
                    <View style={styles.blockHeader}>
                      <View
                        style={[
                          styles.typeBadge,
                          { backgroundColor: `${tokens.primary}1A` },
                        ]}
                      >
                        <Text
                          style={[
                            styles.typeBadgeText,
                            { color: tokens.primary },
                          ]}
                        >
                          {blockTypeLabel(block.type)}
                        </Text>
                      </View>
                      <Text
                        style={[styles.blockName, { color: tokens.text }]}
                        numberOfLines={1}
                      >
                        {block.name}
                      </Text>
                      {renderBlockActions(
                        index,
                        dynamic.length,
                        moveDynamic,
                        deleteDynamic,
                      )}
                    </View>
                    <FormField label="名称" tokens={tokens}>
                      <FormTextInput
                        tokens={tokens}
                        value={block.name}
                        onChangeText={v =>
                          setDynamic(prev =>
                            prev.map((b, i) =>
                              i === index ? { ...b, name: v } : b,
                            ),
                          )
                        }
                      />
                    </FormField>
                    <FormField label="角色" tokens={tokens}>
                      <FormSelectField
                        tokens={tokens}
                        value={block.role}
                        onChange={role =>
                          setDynamic(prev =>
                            prev.map((b, i) =>
                              i === index
                                ? {
                                    ...b,
                                    role: role as DynamicPromptBlock['role'],
                                  }
                                : b,
                            ),
                          )
                        }
                        options={ROLE_OPTIONS}
                        sheetTitle="选择角色"
                      />
                    </FormField>
                    <FormSwitchRow
                      label="常驻"
                      tokens={tokens}
                      value={isDynamicBlockPersistent(block)}
                      onValueChange={persistent =>
                        setDynamic(prev =>
                          prev.map((b, i) =>
                            i === index
                              ? withDynamicBlockPersistence(b, persistent)
                              : b,
                          ),
                        )
                      }
                    />
                    {!isDynamicBlockPersistent(block) ? (
                      <Text
                        style={[
                          styles.fieldHint,
                          { color: tokens.textSecondary },
                        ]}
                      >
                        {PROMPT_REGION_LABELS.dynamicLifecycleOnceHint}
                      </Text>
                    ) : null}
                    <FormField label="内容" tokens={tokens}>
                      <PromptMacroTextInput
                        tokens={tokens}
                        value={block.content}
                        onChangeText={v =>
                          setDynamic(prev =>
                            prev.map((b, i) =>
                              i === index ? { ...b, content: v } : b,
                            ),
                          )
                        }
                        placeholder="支持 $time、$week_cn、$filetree…"
                      />
                    </FormField>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[styles.fieldHint, { color: tokens.textSecondary }]}>
                {PROMPT_REGION_LABELS.dynamicDisabledHint}
              </Text>
            )}
          </View>
        </FormSectionCard>
      </ScreenFormLayout>
    </>
  );
}

const styles = StyleSheet.create({
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  invalidWrap: { flex: 1, padding: 16, justifyContent: 'center' },
  invalidCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    gap: 10,
  },
  invalidTitle: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  invalidReason: { fontSize: 13, lineHeight: 19 },
  invalidDetail: { fontSize: 11, lineHeight: 16 },
  invalidActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 16,
    marginTop: 4,
  },
  hint: { fontSize: 13, lineHeight: 18 },
  fieldHint: { fontSize: 12, lineHeight: 16, marginTop: -2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  yamlActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 8,
    paddingTop: 2,
    gap: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  sectionHeadActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  blockList: { gap: 12 },
  blockCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  chatSlotCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  chatSlotHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  chatSlotTag: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chatSlotTagText: {
    fontSize: 12,
    fontWeight: '700',
  },
  skillsPrefixInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 60,
    maxHeight: 120,
    textAlignVertical: 'top',
  },
  chatSlotHint: {
    fontSize: 13,
    lineHeight: 20,
  },
  readonlyCard: { opacity: 0.85 },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    gap: 8,
    marginBottom: 2,
  },
  typeBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  blockName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  blockHeaderSpacer: { flex: 1 },
  blockActions: { flexDirection: 'row', gap: 4 },
  emptyHint: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  actionBtn: {
    width: 28,
    height: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
