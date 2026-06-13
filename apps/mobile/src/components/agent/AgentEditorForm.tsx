/**
 * Agent definition editor: name, model pin, maxSteps, three-region prompt layout.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Alert, Pressable, StyleSheet, Switch, Text, View} from 'react-native';
import type {
  AgentDefinition,
  DynamicPromptBlock,
  PersistPromptBlock,
  PersistTextPromptBlock,
} from '@novel-master/core';
import {
  ROLE_OPTIONS,
  TOOL_MODE_OPTIONS,
  PROMPT_REGION_LABELS,
  WORKTREE_BLOCK_LABEL,
  addPersistWorktreeBlock,
  blockTypeLabel,
  buildAgentDefinitionFromForm,
  countFormPromptSources,
  createDefaultDynamicTextBlock,
  createDefaultPersistTextBlock,
  definitionToForm,
  deletePersistTextBlock,
  formSnapshotJson,
  joinPersistBlocksForLayout,
  mapPersistTextBlocks,
  movePersistTextBlock,
  removePersistWorktreeBlock,
  splitPersistBlocksForEditor,
  toolsSelectionFromDefinition,
  isDynamicBlockPersistent,
  withDynamicBlockPersistence,
  type ToolsMode,
} from '@novel-master/core/config-forms/agent';
import {
  formatApplicationModelId,
  parseApplicationModelId,
  registerBuiltinTools,
  ToolRegistry,
} from '@novel-master/core';
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

type Props = {
  agentId: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
};

type AddMenuTarget = 'persist' | 'dynamic';

export function AgentEditorForm({agentId, onDirtyChange, onSaved}: Props) {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const [name, setName] = useState('');
  const [maxSteps, setMaxSteps] = useState('20');
  const [modelEnabled, setModelEnabled] = useState(false);
  const [providerId, setProviderId] = useState('');
  const [vendorModelId, setVendorModelId] = useState('');
  const [systemEnabled, setSystemEnabled] = useState(false);
  const [systemContent, setSystemContent] = useState('');
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
  const [addBlockTarget, setAddBlockTarget] = useState<AddMenuTarget>('persist');
  const [saving, setSaving] = useState(false);
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
    const def = await runtime.agentRegistry.get(agentId);
    const promptForm = definitionToForm(def);
    setName(def.name);
    setMaxSteps(String(def.runtime?.maxSteps ?? 20));
    setSystemEnabled(promptForm.systemEnabled);
    setSystemContent(promptForm.systemContent);
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
  }, [agentId, runtime, loadProviders, loadSavedModels]);

  useEffect(() => {
    loadAgent().catch(err => showToast(toastMessage('加载失败', err)));
  }, [loadAgent, showToast]);

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

  const {textBlocks: persistTextBlocks, worktree: persistWorktree} = useMemo(
    () => splitPersistBlocksForEditor(persist),
    [persist],
  );

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
    const remaining = countFormPromptSources(
      {systemEnabled, systemContent, persist, dynamic},
      {excludePersistTextIndex: textIndex},
    );
    if (remaining < 1) {
      showToast('至少保留一个 Prompt 块');
      return;
    }
    setPersist(prev => deletePersistTextBlock(prev, textIndex));
  };

  const deleteDynamic = (index: number) => {
    const remaining = countFormPromptSources(
      {systemEnabled, systemContent, persist, dynamic},
      {excludeDynamicIndex: index},
    );
    if (remaining < 1) {
      showToast('至少保留一个 Prompt 块');
      return;
    }
    setDynamic(prev => prev.filter((_, i) => i !== index));
  };

  const addPersistTextBlock = () => {
    setPersist(prev => {
      const {textBlocks, worktree} = splitPersistBlocksForEditor(prev);
      return joinPersistBlocksForLayout(
        [...textBlocks, createDefaultPersistTextBlock(textBlocks.length)],
        worktree,
      );
    });
    setAddBlockVisible(false);
  };

  const addPersistWorktree = () => {
    setPersist(prev => addPersistWorktreeBlock(prev));
    setAddBlockVisible(false);
  };

  const removePersistWorktree = () => {
    const remaining = countFormPromptSources(
      {systemEnabled, systemContent, persist, dynamic},
      {excludeWorktree: true},
    );
    if (remaining < 1) {
      showToast('至少保留一个 Prompt 块');
      return;
    }
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
            label="最大步数 maxSteps"
            tokens={tokens}
            hint="每轮 run 的模型往返上限；省略时 Core 默认 20。">
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

        <FormSectionCard title="Prompt 布局" tokens={tokens}>
          <Text style={[styles.hint, {color: tokens.textSecondary}]}>
            {PROMPT_REGION_LABELS.layoutOrderPrefixShort}
            {PROMPT_REGION_LABELS.layoutOrder}。
          </Text>

          <View
            style={[
              styles.blockCard,
              {backgroundColor: tokens.surface, borderColor: tokens.border},
            ]}>
            <View style={styles.blockHeader}>
              <View style={[styles.typeBadge, {backgroundColor: `${tokens.primary}1A`}]}>
                <Text style={[styles.typeBadgeText, {color: tokens.primary}]}>
                  {PROMPT_REGION_LABELS.system}
                </Text>
              </View>
              <Text style={[styles.blockName, {color: tokens.text}]} numberOfLines={1}>
                {PROMPT_REGION_LABELS.apiSystemField}
              </Text>
              <Switch
                value={systemEnabled}
                onValueChange={setSystemEnabled}
                trackColor={{false: tokens.border, true: tokens.primary}}
              />
            </View>
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

          <View style={styles.sectionHead}>
            <Text style={[styles.sectionLabel, {color: tokens.text}]}>
              {PROMPT_REGION_LABELS.persistBlocks}
            </Text>
            <Pressable
              onPress={() => {
                setAddBlockTarget('persist');
                setAddBlockVisible(true);
              }}>
              <Text style={{color: tokens.primary, fontWeight: '600'}}>添加</Text>
            </Pressable>
          </View>
          <View style={styles.blockList}>
            {persistTextBlocks.map((block, index) => (
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
                    persistTextBlocks.length,
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
                          i === index ? {...b, name: v} : b,
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
                          i === index ? {...b, content: v} : b,
                        ),
                      )
                    }
                    multiline
                  />
                </FormField>
              </View>
            ))}
          </View>

          {persistWorktree != null ? (
            <View
              style={[
                styles.blockCard,
                styles.readonlyCard,
                {backgroundColor: tokens.surface, borderColor: tokens.border},
              ]}>
              <View style={styles.blockHeader}>
                <View style={[styles.typeBadge, {backgroundColor: `${tokens.primary}1A`}]}>
                  <Text style={[styles.typeBadgeText, {color: tokens.primary}]}>
                    {WORKTREE_BLOCK_LABEL}
                  </Text>
                </View>
                <Text style={[styles.blockName, {color: tokens.text}]} numberOfLines={1}>
                  {WORKTREE_BLOCK_LABEL}
                </Text>
              </View>
              <Text style={[styles.fieldHint, {color: tokens.textSecondary}]}>
                运行时注入 materialize 后的会话工作树，不可配置、不可排序。
              </Text>
            </View>
          ) : null}

          <View
            style={[
              styles.blockCard,
              styles.readonlyCard,
              {backgroundColor: tokens.surface, borderColor: tokens.border},
            ]}>
            <View style={styles.blockHeader}>
              <View style={[styles.typeBadge, {backgroundColor: `${tokens.primary}1A`}]}>
                <Text style={[styles.typeBadgeText, {color: tokens.primary}]}>
                  {PROMPT_REGION_LABELS.chat}
                </Text>
              </View>
              <Text style={[styles.blockName, {color: tokens.text}]} numberOfLines={1}>
                {PROMPT_REGION_LABELS.chat}
              </Text>
            </View>
            <Text style={[styles.fieldHint, {color: tokens.textSecondary}]}>
              运行时注入可见会话消息，不可配置。
            </Text>
          </View>

          <View style={styles.sectionHead}>
            <Text style={[styles.sectionLabel, {color: tokens.text}]}>
              {PROMPT_REGION_LABELS.dynamicBlocks}
            </Text>
            <Pressable
              onPress={() => {
                setAddBlockTarget('dynamic');
                setAddBlockVisible(true);
              }}>
              <Text style={{color: tokens.primary, fontWeight: '600'}}>添加</Text>
            </Pressable>
          </View>
          <View style={styles.blockList}>
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
        </FormSectionCard>
      </ScreenFormLayout>
      <BottomSheetMenu
        visible={addBlockVisible}
        items={
          addBlockTarget === 'dynamic'
            ? [{label: '文本块', action: 'dynamic-text'}]
            : [
                {label: '文本块', action: 'persist-text'},
                ...(persistWorktree
                  ? [{label: '移除工作树', action: 'persist-worktree-remove'}]
                  : [{label: WORKTREE_BLOCK_LABEL, action: 'persist-worktree-add'}]),
              ]
        }
        onClose={() => setAddBlockVisible(false)}
        onSelect={action => {
          if (action === 'persist-text') {
            addPersistTextBlock();
          } else if (action === 'persist-worktree-add') {
            addPersistWorktree();
          } else if (action === 'persist-worktree-remove') {
            removePersistWorktree();
          } else if (action === 'dynamic-text') {
            addDynamicBlock();
          }
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  hint: {fontSize: 13, lineHeight: 18},
  fieldHint: {fontSize: 12, lineHeight: 16, marginTop: -2},
  switchRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  yamlActions: {flexDirection: 'row', alignItems: 'center', gap: 16},
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  sectionLabel: {fontSize: 14, fontWeight: '600'},
  blockList: {gap: 12},
  blockCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  readonlyCard: {opacity: 0.85},
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
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
  blockActions: {flexDirection: 'row', gap: 4},
  actionBtn: {
    width: 28,
    height: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
