/**
 * Agent definition editor: name, model pin, maxSteps, three-region prompt layout.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Alert, Pressable, StyleSheet, Switch, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import { type AgentDefinition } from "@novel-master/core/agent";

import { type DynamicPromptBlock, type PersistPromptBlock, type PersistTextPromptBlock } from "@novel-master/core/prompt";
import {
  ROLE_OPTIONS,
  TOOL_MODE_OPTIONS,
  PROMPT_REGION_LABELS,
  WORKTREE_BLOCK_LABEL,
  WORKTREE_BLOCK_HINT,
  addPersistWorktreeBlock,
  blockTypeLabel,
  buildAgentDefinitionFromForm,
  createDefaultDynamicTextBlock,
  createDefaultPersistTextBlock,
  definitionToForm,
  formSnapshotJson,
  mapPersistTextBlocks,
  movePersistBlock,
  removePersistWorktreeBlock,
  splitPersistBlocksForEditor,
  toolsSelectionFromDefinition,
  updatePersistWorktreeRole,
  isDynamicBlockPersistent,
  withDynamicBlockPersistence,
  type ToolsMode,
} from '@novel-master/core/config-forms/agent';
import {
  STORED_CONFIG_LABELS,
  assessAgentDefinitionWire,
  buildDefaultAgentDefinitionPreservingName,
  storedConfigInvalidReason,
  type StoredConfigInvalidCode,
} from '@novel-master/core/config-forms/stored-config-validity';
import { registerBuiltinTools, ToolRegistry } from "@novel-master/core";

import { formatApplicationModelId, parseApplicationModelId } from "@novel-master/core/provider";
import {ToolPolicyPicker} from './ToolPolicyPicker';
import {FormField} from '../form/FormField';
import {FormSwitchRow} from '../form/FormSwitchRow';
import {FormSectionCard} from '../form/FormSectionCard';
import {FormSelectField} from '../form/FormSelectField';
import {FormTextInput} from '../form/FormTextInput';
import {PromptMacroTextInput} from './PromptMacroTextInput';
import {ScreenFormLayout} from '../form/ScreenFormLayout';
import {StickyFormFooter} from '../form/StickyFormFooter';
import {BottomSheetMenu} from '../sheet/BottomSheetMenu';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {exportAgentYaml, importAgentYaml} from '../../services/agent-yaml.service';
import type {RootStackParamList} from '../../navigation/types';

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
    typeof (raw as {name: unknown}).name === 'string'
  ) {
    const trimmed = (raw as {name: string}).name.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return agentId;
}

type Props = {
  agentId: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
};

export function AgentEditorForm({agentId, onDirtyChange, onSaved}: Props) {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const navigation = useNavigation<StackNav>();
  const runtime = useRuntime();
  const [name, setName] = useState('');
  const [maxSteps, setMaxSteps] = useState('20');
  const [modelEnabled, setModelEnabled] = useState(false);
  const [providerId, setProviderId] = useState('');
  const [vendorModelId, setVendorModelId] = useState('');
  const [systemEnabled, setSystemEnabled] = useState(false);
  const [systemContent, setSystemContent] = useState('');
  const [persistEnabled, setPersistEnabled] = useState(false);
  const [dynamicEnabled, setDynamicEnabled] = useState(false);
  const [persist, setPersist] = useState<PersistPromptBlock[]>([]);
  const [dynamic, setDynamic] = useState<DynamicPromptBlock[]>([]);
  const [providers, setProviders] = useState<
    Array<{id: string; label: string; protocol: string}>
  >([]);
  const [savedModels, setSavedModels] = useState<
    Awaited<ReturnType<typeof runtime.providerModels.savedList>>
  >([]);
  const [savedBaseline, setSavedBaseline] = useState<string | null>(null);
  const [addBlockVisible, setAddBlockVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invalidConfig, setInvalidConfig] = useState<InvalidAgentConfig | null>(
    null,
  );
  const [recovering, setRecovering] = useState(false);
  const [toolsMode, setToolsMode] = useState<ToolsMode>('default');
  const [toolsSelected, setToolsSelected] = useState<string[]>([]);

  const dismissAllOverlays = useCallback(() => {
    setAddBlockVisible(false);
  }, []);

  useDismissOverlaysOnBlur(dismissAllOverlays);

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
        label: p.id,
        protocol: p.protocol,
      })),
    );
    return list;
  }, [runtime]);

  const loadSavedModels = useCallback(
    async (pid: string) => {
      const saved = await runtime.providerModels.savedList(pid);
      setSavedModels(saved);
      return saved;
    },
    [runtime],
  );

  const loadAgent = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setInvalidConfig(null);
    try {
      const raw = await runtime.agentRegistry.getRawWire(agentId);
      if (raw === null) {
        setLoadError(`未找到 Agent：${agentId}`);
        return;
      }
      const health = assessAgentDefinitionWire(raw);
      if (health.status === 'invalid') {
        setInvalidConfig({code: health.code, message: health.message});
        return;
      }
      const def = health.value;
    const promptForm = definitionToForm(def);
    setName(def.name);
    setMaxSteps(String(def.runtime?.maxSteps ?? 20));
    setSystemEnabled(promptForm.systemEnabled);
    setSystemContent(promptForm.systemContent);
    setPersistEnabled(promptForm.persistEnabled);
    setDynamicEnabled(promptForm.dynamicEnabled);
    setPersist([...promptForm.persist]);
    setDynamic([...promptForm.dynamic]);

    const toolsWire = toolsSelectionFromDefinition(def);
    setToolsMode(toolsWire.mode);
    setToolsSelected([...toolsWire.selected]);
    const providerList = await loadProviders();
    if (def.model) {
      setModelEnabled(true);
      try {
        const parsed = parseApplicationModelId(def.model);
        setProviderId(parsed.providerId);
        await loadSavedModels(parsed.providerId);
        setVendorModelId(parsed.vendorModelId);
      } catch {
        setModelEnabled(false);
      }
    } else {
      setModelEnabled(false);
      const workspaceId = await runtime.state.getCurrentModelId();
      if (workspaceId) {
        try {
          const parsed = parseApplicationModelId(workspaceId);
          setProviderId(parsed.providerId);
          await loadSavedModels(parsed.providerId);
          setVendorModelId(parsed.vendorModelId);
        } catch {
          /* ignore */
        }
      } else if (providerList.length > 0) {
        setProviderId(providerList[0].id);
        const saved = await loadSavedModels(providerList[0].id);
        if (saved.length > 0) {
          setVendorModelId(saved[0].vendorModelId);
        }
      }
    }
    const modelEnabled = Boolean(def.model);
    let baselineProviderId = '';
    let baselineVendorModelId = '';
    if (modelEnabled && def.model) {
      try {
        const parsed = parseApplicationModelId(def.model);
        baselineProviderId = parsed.providerId;
        baselineVendorModelId = parsed.vendorModelId;
      } catch {
        /* treat as no dedicated model */
      }
    }
    setSavedBaseline(
      formSnapshotJson({
        name: def.name,
        maxSteps: String(def.runtime?.maxSteps ?? 20),
        modelEnabled,
        providerId: baselineProviderId,
        vendorModelId: baselineVendorModelId,
        toolsMode: toolsWire.mode,
        toolsSelected: [...toolsWire.selected],
        ...promptForm,
        persist: [...promptForm.persist],
      }),
    );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [agentId, runtime, loadProviders, loadSavedModels]);

  useEffect(() => {
    loadAgent().catch(err => showToast(toastMessage('加载失败', err)));
  }, [loadAgent, showToast]);

  const handleDeleteBrokenAgent = useCallback(() => {
    Alert.alert('删除 Agent', `确定删除 ${agentId}？`, [
      {text: '取消', style: 'cancel'},
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
  }, [agentId, navigation, runtime, showToast]);

  const handleOverwriteDefault = useCallback(() => {
    Alert.alert(
      '覆盖为默认模板',
      '将用默认 prompts 与运行时覆盖当前配置，并保留 Agent ID 与显示名称。是否继续？',
      [
        {text: '取消', style: 'cancel'},
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
  }, [agentId, loadAgent, runtime, showToast]);

  const preferredModelId = modelEnabled
    ? formatApplicationModelId(providerId, vendorModelId)
    : undefined;

  const handleSave = async () => {
    const built = buildAgentDefinitionFromForm({
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
    if (!built.ok) {
      showToast(built.message);
      return;
    }
    const def = built.definition;
    setSaving(true);
    try {
      const probe = new ToolRegistry();
      registerBuiltinTools(probe);
      await runtime.agentRegistry.upsert(agentId, def, {
        registeredToolNames: probe.list(),
      });
      setSavedBaseline(snapshot);
      onSaved?.();
      showToast('已保存 Agent 配置');
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
    Alert.alert('导入 YAML', '将覆盖当前 Agent 配置，是否继续？', [
      {text: '取消', style: 'cancel'},
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

  const {blocks: persistBlocks, worktree: persistWorktree} = useMemo(
    () => splitPersistBlocksForEditor(persist),
    [persist],
  );

  const movePersist = (index: number, dir: -1 | 1) => {
    setPersist(prev => movePersistBlock(prev, index, dir));
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

  const deletePersist = (index: number) => {
    setPersist(prev => {
      const {blocks} = splitPersistBlocksForEditor(prev);
      return blocks.filter((_, i) => i !== index);
    });
  };

  const persistTextIndex = (persistIndex: number) =>
    persistBlocks.slice(0, persistIndex).filter(b => b.type === 'text').length;

  const deleteDynamic = (index: number) => {
    setDynamic(prev => prev.filter((_, i) => i !== index));
  };

  const addPersistTextBlock = () => {
    setPersist(prev => {
      const {blocks} = splitPersistBlocksForEditor(prev);
      const textCount = blocks.filter(block => block.type === 'text').length;
      return [...blocks, createDefaultPersistTextBlock(textCount)];
    });
    setAddBlockVisible(false);
  };

  const addPersistWorktree = () => {
    setPersist(prev => addPersistWorktreeBlock(prev));
    setAddBlockVisible(false);
  };

  const removePersistWorktree = () => {
    setPersist(prev => removePersistWorktreeBlock(prev));
    setAddBlockVisible(false);
  };

  const addDynamicBlock = () => {
    setDynamic(prev => [...prev, createDefaultDynamicTextBlock(prev.length)]);
    setAddBlockVisible(false);
  };

  const handleProviderChange = async (pid: string) => {
    setProviderId(pid);
    const saved = await loadSavedModels(pid);
    setVendorModelId(saved[0]?.vendorModelId ?? '');
  };

  const providerSelectOptions = providers.map(p => ({
    value: p.id,
    label: p.label,
  }));
  const modelSelectOptions = savedModels.map(m => ({
    value: m.vendorModelId,
    label: m.displayName?.trim() || m.vendorModelId,
  }));

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <Text style={{color: tokens.textSecondary}}>加载中…</Text>
      </View>
    );
  }

  if (loadError != null || invalidConfig != null) {
    const title =
      invalidConfig != null
        ? STORED_CONFIG_LABELS.invalidTitle
        : '加载失败';
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
            {borderColor: tokens.border, backgroundColor: tokens.surface},
          ]}>
          <Text style={[styles.invalidTitle, {color: tokens.text}]}>{title}</Text>
          <Text style={[styles.invalidReason, {color: tokens.textSecondary}]}>
            {reason}
          </Text>
          {detail.length > 0 ? (
            <Text style={[styles.invalidDetail, {color: tokens.textTertiary}]}>
              {detail}
            </Text>
          ) : null}
          <View style={styles.invalidActions}>
            <Pressable
              disabled={recovering}
              onPress={() => navigation.goBack()}>
              <Text style={{color: tokens.primary, fontSize: 14, fontWeight: '600'}}>
                {STORED_CONFIG_LABELS.agentBack}
              </Text>
            </Pressable>
            {invalidConfig != null ? (
              <Pressable
                disabled={recovering}
                onPress={handleOverwriteDefault}>
                <Text style={{color: tokens.primary, fontSize: 14, fontWeight: '600'}}>
                  {STORED_CONFIG_LABELS.agentOverwriteDefault}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              disabled={recovering}
              onPress={handleDeleteBrokenAgent}>
              <Text style={{color: tokens.danger, fontSize: 14, fontWeight: '600'}}>
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
    persist: PROMPT_REGION_LABELS.persistBlocks,
    chat: PROMPT_REGION_LABELS.chatBlocks ?? '会话区',
    dynamic: PROMPT_REGION_LABELS.dynamicBlocks,
  };

  /** 工作树块菜单/徽章文案；旧 core 包可能仍为 worktree / 权威块。 */
  const worktreeBlockLabel =
    WORKTREE_BLOCK_LABEL === '工作树' ? WORKTREE_BLOCK_LABEL : '工作树';

  const renderPromptSectionHead = (
    label: string,
    opts?: {
      onAdd?: () => void;
      switchValue?: boolean;
      onSwitchChange?: (value: boolean) => void;
    },
  ) => (
    <View style={styles.sectionHead}>
      <Text style={[styles.sectionLabel, {color: tokens.text}]}>{label}</Text>
      <View style={styles.sectionHeadActions}>
        {opts?.onAdd != null ? (
          <Pressable onPress={opts.onAdd}>
            <Text style={{color: tokens.primary, fontWeight: '600'}}>添加</Text>
          </Pressable>
        ) : null}
        {opts?.switchValue !== undefined && opts.onSwitchChange != null ? (
          <Switch
            value={opts.switchValue}
            onValueChange={opts.onSwitchChange}
            trackColor={{false: tokens.border, true: tokens.primary}}
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
          style={[styles.actionBtn, {borderColor: tokens.border, backgroundColor: tokens.surface}]}
          onPress={() => onMove(index, -1)}>
          <Text style={{color: tokens.textSecondary}}>↑</Text>
        </Pressable>
      ) : null}
      {index < total - 1 ? (
        <Pressable
          style={[styles.actionBtn, {borderColor: tokens.border, backgroundColor: tokens.surface}]}
          onPress={() => onMove(index, 1)}>
          <Text style={{color: tokens.textSecondary}}>↓</Text>
        </Pressable>
      ) : null}
      <Pressable
        style={[styles.actionBtn, {borderColor: tokens.border, backgroundColor: tokens.surface}]}
        onPress={() => onDelete(index)}>
        <Text style={{color: tokens.danger}}>×</Text>
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
        }>
        <FormSectionCard title="基本信息" tokens={tokens}>
          <View style={styles.yamlActions}>
            <Pressable onPress={() => handleImportYaml()}>
              <Text style={{color: tokens.primary, fontWeight: '600'}}>导入 YAML</Text>
            </Pressable>
            <Pressable onPress={() => handleExportYaml().catch(() => undefined)}>
              <Text style={{color: tokens.primary, fontWeight: '600'}}>导出 YAML</Text>
            </Pressable>
          </View>
          <FormField label="名称" tokens={tokens}>
            <FormTextInput tokens={tokens} value={name} onChangeText={setName} />
          </FormField>
        </FormSectionCard>

        <FormSectionCard
          title="模型"
          tokens={tokens}
          rightAction={
            <View style={styles.switchRow}>
              <Text style={{color: tokens.textSecondary, fontSize: 13}}>专属模型</Text>
              <Switch
                value={modelEnabled}
                onValueChange={setModelEnabled}
                trackColor={{false: tokens.border, true: tokens.primary}}
              />
            </View>
          }>
          {!modelEnabled ? (
            <Text style={[styles.hint, {color: tokens.textSecondary}]}>
              未启用时跟随工作区当前模型（会话操作抽屉 / 我的）。
            </Text>
          ) : (
            <>
              <FormField label="服务商" tokens={tokens}>
                <FormSelectField
                  tokens={tokens}
                  value={providerId}
                  onChange={handleProviderChange}
                  options={providerSelectOptions}
                  sheetTitle="选择服务商"
                  placeholder="选择服务商"
                  emptyLabel="请先在「服务商」页添加"
                />
              </FormField>
              <FormField label="模型" tokens={tokens}>
                <FormSelectField
                  tokens={tokens}
                  value={vendorModelId}
                  onChange={setVendorModelId}
                  options={modelSelectOptions}
                  sheetTitle="选择模型"
                  placeholder="选择模型"
                  emptyLabel={
                    providerId ? '该服务商下暂无已保存模型' : '请先选择服务商'
                  }
                  disabled={!providerId}
                />
              </FormField>
              <Text style={[styles.hint, {color: tokens.textSecondary}]}>
                model: {preferredModelId ?? '—'}
              </Text>
            </>
          )}
        </FormSectionCard>

        <FormSectionCard title="运行时" tokens={tokens}>
          <FormField
            label={PROMPT_REGION_LABELS.maxStepsLabel}
            tokens={tokens}
            hint={PROMPT_REGION_LABELS.maxStepsHint}>
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
              tokens={tokens}>
              <ToolPolicyPicker
                tokens={tokens}
                selected={toolsSelected}
                onChange={setToolsSelected}
              />
            </FormField>
          ) : (
            <Text style={[styles.hint, {color: tokens.textSecondary}]}>
              未配置时使用全部内置工具（7 个）：read、write、edit、fs、glob、grep、chat_grep。
            </Text>
          )}
        </FormSectionCard>

        <FormSectionCard title={PROMPT_REGION_LABELS.layoutTitle} tokens={tokens}>
          {renderPromptSectionHead(promptSectionLabels.system, {
            switchValue: systemEnabled,
            onSwitchChange: setSystemEnabled,
          })}
          <View
            style={[
              styles.blockCard,
              {backgroundColor: tokens.surface, borderColor: tokens.border},
            ]}>
            {systemEnabled ? (
              <FormField label={PROMPT_REGION_LABELS.systemContent} tokens={tokens}>
                <FormTextInput
                  tokens={tokens}
                  value={systemContent}
                  onChangeText={setSystemContent}
                  multiline
                  placeholder={PROMPT_REGION_LABELS.systemPlaceholderShort}
                />
              </FormField>
            ) : (
              <Text style={[styles.fieldHint, {color: tokens.textSecondary}]}>
                {PROMPT_REGION_LABELS.systemDisabledHint}
              </Text>
            )}
          </View>

          {renderPromptSectionHead(promptSectionLabels.persist, {
            switchValue: persistEnabled,
            onSwitchChange: setPersistEnabled,
            ...(persistEnabled ? {onAdd: () => setAddBlockVisible(true)} : {}),
          })}
          <View
            style={[
              styles.blockCard,
              {backgroundColor: tokens.surface, borderColor: tokens.border},
            ]}>
            {persistEnabled ? (
              <View style={styles.blockList}>
            {persistBlocks.length === 0 ? (
              <Text style={[styles.emptyHint, {color: tokens.textSecondary, borderColor: tokens.borderLight}]}>
                {PROMPT_REGION_LABELS.emptyPersistHint}
              </Text>
            ) : null}
            {persistBlocks.map((block, index) => {
              if (block.type === 'worktree') {
                return (
                  <View
                    key={`persist-worktree-${index}`}
                    style={[
                      styles.blockCard,
                      {backgroundColor: tokens.surface, borderColor: tokens.border},
                    ]}>
                    <View style={styles.blockHeader}>
                      <View style={[styles.typeBadge, {backgroundColor: `${tokens.primary}1A`}]}>
                        <Text style={[styles.typeBadgeText, {color: tokens.primary}]}>
                          {worktreeBlockLabel}
                        </Text>
                      </View>
                      <View style={styles.blockHeaderSpacer} />
                      {renderBlockActions(
                        index,
                        persistBlocks.length,
                        movePersist,
                        deletePersist,
                      )}
                    </View>
                    <FormField label="角色" tokens={tokens}>
                      <FormSelectField
                        tokens={tokens}
                        value={block.role ?? 'user'}
                        onChange={role =>
                          setPersist(prev =>
                            updatePersistWorktreeRole(prev, role as 'user' | 'assistant'),
                          )
                        }
                        options={ROLE_OPTIONS}
                        sheetTitle="选择角色"
                      />
                    </FormField>
                    <Text style={[styles.fieldHint, {color: tokens.textSecondary}]}>
                      {WORKTREE_BLOCK_HINT}
                    </Text>
                  </View>
                );
              }

              const textIndex = persistTextIndex(index);
              return (
                <View
                  key={`persist-block-${index}`}
                  style={[
                    styles.blockCard,
                    {backgroundColor: tokens.surface, borderColor: tokens.border},
                  ]}>
                  <View style={styles.blockHeader}>
                    <View style={[styles.typeBadge, {backgroundColor: `${tokens.primary}1A`}]}>
                      <Text style={[styles.typeBadgeText, {color: tokens.primary}]}>
                        {blockTypeLabel(block.type)}
                      </Text>
                    </View>
                    <Text style={[styles.blockName, {color: tokens.text}]} numberOfLines={1}>
                      {block.name}
                    </Text>
                    {renderBlockActions(
                      index,
                      persistBlocks.length,
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
                            i === textIndex ? {...b, name: v} : b,
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
                            i === textIndex
                              ? {...b, role: role as PersistTextPromptBlock['role']}
                              : b,
                          ),
                        )
                      }
                      options={ROLE_OPTIONS}
                      sheetTitle="选择角色"
                    />
                  </FormField>
                  <Text style={[styles.fieldHint, {color: tokens.textSecondary}]}>
                    {PROMPT_REGION_LABELS.persistRegionHint}
                  </Text>
                  <FormField label="内容" tokens={tokens}>
                    <FormTextInput
                      tokens={tokens}
                      value={block.content}
                      onChangeText={v =>
                        setPersist(prev =>
                          mapPersistTextBlocks(prev, (b, i) =>
                            i === textIndex ? {...b, content: v} : b,
                          ),
                        )
                      }
                      multiline
                    />
                  </FormField>
                </View>
              );
            })}
              </View>
            ) : (
              <Text style={[styles.fieldHint, {color: tokens.textSecondary}]}>
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
            ]}>
            <View style={styles.chatSlotHeader}>
              <View
                style={[
                  styles.chatSlotTag,
                  {backgroundColor: `${tokens.primary}18`},
                ]}>
                <Text style={[styles.chatSlotTagText, {color: tokens.primary}]}>
                  {PROMPT_REGION_LABELS.chatTag}
                </Text>
              </View>
              <View
                style={[
                  styles.readonlyPill,
                  {
                    backgroundColor: tokens.surface,
                    borderColor: tokens.borderLight,
                  },
                ]}>
                <Text style={[styles.readonlyPillText, {color: tokens.textSecondary}]}>
                  只读
                </Text>
              </View>
            </View>
            <Text style={[styles.chatSlotTitle, {color: tokens.text}]}>
              {PROMPT_REGION_LABELS.chat}
            </Text>
            <Text style={[styles.chatSlotHint, {color: tokens.textSecondary}]}>
              {PROMPT_REGION_LABELS.chatReadonlyHint}
            </Text>
          </View>

          {renderPromptSectionHead(promptSectionLabels.dynamic, {
            switchValue: dynamicEnabled,
            onSwitchChange: setDynamicEnabled,
            ...(dynamicEnabled ? {onAdd: addDynamicBlock} : {}),
          })}
          <View
            style={[
              styles.blockCard,
              {backgroundColor: tokens.surface, borderColor: tokens.border},
            ]}>
            {dynamicEnabled ? (
              <View style={styles.blockList}>
            {dynamic.length === 0 ? (
              <Text style={[styles.emptyHint, {color: tokens.textSecondary, borderColor: tokens.borderLight}]}>
                {PROMPT_REGION_LABELS.emptyDynamicHint}
              </Text>
            ) : null}
            {dynamic.map((block, index) => (
              <View
                key={`dynamic-block-${index}`}
                style={[
                  styles.blockCard,
                  {backgroundColor: tokens.surface, borderColor: tokens.border},
                ]}>
                <View style={styles.blockHeader}>
                  <View style={[styles.typeBadge, {backgroundColor: `${tokens.primary}1A`}]}>
                    <Text style={[styles.typeBadgeText, {color: tokens.primary}]}>
                      {blockTypeLabel(block.type)}
                    </Text>
                  </View>
                  <Text style={[styles.blockName, {color: tokens.text}]} numberOfLines={1}>
                    {block.name}
                  </Text>
                  {renderBlockActions(index, dynamic.length, moveDynamic, deleteDynamic)}
                </View>
                <FormField label="名称" tokens={tokens}>
                  <FormTextInput
                    tokens={tokens}
                    value={block.name}
                    onChangeText={v =>
                      setDynamic(prev =>
                        prev.map((b, i) => (i === index ? {...b, name: v} : b)),
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
                            ? {...b, role: role as DynamicPromptBlock['role']}
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
                        i === index ? withDynamicBlockPersistence(b, persistent) : b,
                      ),
                    )
                  }
                />
                {!isDynamicBlockPersistent(block) ? (
                  <Text style={[styles.fieldHint, {color: tokens.textSecondary}]}>
                    {PROMPT_REGION_LABELS.dynamicLifecycleOnceHint}
                  </Text>
                ) : null}
                <FormField label="内容" tokens={tokens}>
                  <PromptMacroTextInput
                    tokens={tokens}
                    value={block.content}
                    onChangeText={v =>
                      setDynamic(prev =>
                        prev.map((b, i) => (i === index ? {...b, content: v} : b)),
                      )
                    }
                    placeholder="支持 $time、$week_cn、$filetree…"
                  />
                </FormField>
              </View>
            ))}
              </View>
            ) : (
              <Text style={[styles.fieldHint, {color: tokens.textSecondary}]}>
                {PROMPT_REGION_LABELS.dynamicDisabledHint}
              </Text>
            )}
          </View>
        </FormSectionCard>
      </ScreenFormLayout>
      <BottomSheetMenu
        visible={addBlockVisible}
        items={[
          {label: '文本块', action: 'persist-text'},
          ...(persistWorktree
            ? [{label: `移除${worktreeBlockLabel}`, action: 'persist-worktree-remove'}]
            : [{label: worktreeBlockLabel, action: 'persist-worktree-add'}]),
        ]}
        onClose={() => setAddBlockVisible(false)}
        onSelect={action => {
          if (action === 'persist-text') {
            addPersistTextBlock();
          } else if (action === 'persist-worktree-add') {
            addPersistWorktree();
          } else if (action === 'persist-worktree-remove') {
            removePersistWorktree();
          }
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loadingWrap: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24},
  invalidWrap: {flex: 1, padding: 16, justifyContent: 'center'},
  invalidCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    gap: 10,
  },
  invalidTitle: {fontSize: 15, fontWeight: '600', lineHeight: 21},
  invalidReason: {fontSize: 13, lineHeight: 19},
  invalidDetail: {fontSize: 11, lineHeight: 16},
  invalidActions: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginTop: 4},
  hint: {fontSize: 13, lineHeight: 18},
  fieldHint: {fontSize: 12, lineHeight: 16, marginTop: -2},
  switchRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  yamlActions: {flexDirection: 'row', alignItems: 'center', gap: 16},
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
  blockList: {gap: 12},
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
  readonlyPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: StyleSheet.hairlineWidth,
  },
  readonlyPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  chatSlotTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  chatSlotHint: {
    fontSize: 13,
    lineHeight: 20,
  },
  readonlyCard: {opacity: 0.85},
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
  blockHeaderSpacer: {flex: 1},
  blockActions: {flexDirection: 'row', gap: 4},
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
