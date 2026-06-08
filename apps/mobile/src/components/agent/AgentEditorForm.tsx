/**
 * Agent definition editor: name, model pin, maxSteps, prompt blocks.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Alert, Pressable, StyleSheet, Switch, Text, View} from 'react-native';
import type {AgentDefinition, PromptBlock, PromptBlockRole} from '@novel-master/core';
import {
  ROLE_OPTIONS,
  TOOL_MODE_OPTIONS,
  blockTypeLabel,
  buildAgentDefinitionFromForm,
  buildToolsPolicy,
  formSnapshotJson,
  stripRemovedPromptBlocks,
  toolsFromDefinition,
  type ToolsMode,
} from '@novel-master/config-forms/agent';
import {
  formatApplicationModelId,
  parseApplicationModelId,
  registerVfsTools,
  ToolRegistry,
} from '@novel-master/core';
import {FormField} from '../form/FormField';
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

export function AgentEditorForm({agentId, onDirtyChange, onSaved}: Props) {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const [name, setName] = useState('');
  const [maxSteps, setMaxSteps] = useState('20');
  const [modelEnabled, setModelEnabled] = useState(false);
  const [providerId, setProviderId] = useState('');
  const [vendorModelId, setVendorModelId] = useState('');
  const [prompts, setPrompts] = useState<PromptBlock[]>([]);
  const [providers, setProviders] = useState<
    Array<{id: string; label: string; protocol: string}>
  >([]);
  const [savedModels, setSavedModels] = useState<
    Awaited<ReturnType<typeof runtime.providerModels.savedList>>
  >([]);
  const [savedBaseline, setSavedBaseline] = useState<string | null>(null);
  const [addBlockVisible, setAddBlockVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toolsMode, setToolsMode] = useState<ToolsMode>('default');
  const [toolsList, setToolsList] = useState('');

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
        toolsList,
        prompts,
      }),
    [
      name,
      maxSteps,
      modelEnabled,
      providerId,
      vendorModelId,
      toolsMode,
      toolsList,
      prompts,
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
        label: p.displayName?.trim() || p.id,
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
    setName(def.name);
    setMaxSteps(String(def.runtime?.maxSteps ?? 20));
    const {prompts: loadedPrompts, removed: removedAbstract} =
      stripRemovedPromptBlocks(def.prompts);
    if (loadedPrompts.length === 0) {
      throw new Error('Agent 至少需要一个 Prompt 块');
    }
    setPrompts(loadedPrompts);
    if (removedAbstract > 0) {
      showToast('已移除已废弃的摘要块（abstract）');
    }
    const toolsWire = toolsFromDefinition(def);
    setToolsMode(toolsWire.mode);
    setToolsList(toolsWire.listText);
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
        toolsList: toolsWire.listText,
        prompts: loadedPrompts,
      }),
    );
  }, [agentId, runtime, loadProviders, loadSavedModels, showToast]);

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
      toolsList,
      prompts,
    });
    if (!built.ok) {
      showToast(built.message);
      return;
    }
    const def = built.definition;
    setSaving(true);
    try {
      const probe = new ToolRegistry();
      registerVfsTools(probe);
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

  const updateBlock = (index: number, patch: Partial<PromptBlock>) => {
    setPrompts(prev =>
      prev.map((block, i) =>
        i === index ? ({...block, ...patch} as PromptBlock) : block,
      ),
    );
  };

  const moveBlock = (index: number, dir: -1 | 1) => {
    setPrompts(prev => {
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

  const deleteBlock = (index: number) => {
    if (prompts.length <= 1) {
      showToast('至少保留一个 Prompt 块');
      return;
    }
    setPrompts(prev => prev.filter((_, i) => i !== index));
  };

  const addBlock = (kind: 'text' | 'chat') => {
    if (kind === 'text') {
      setPrompts(prev => [
        ...prev,
        {
          name: `block-${prev.length + 1}`,
          type: 'text',
          role: 'system',
          content: '',
        },
      ]);
    } else {
      setPrompts(prev => [...prev, {name: 'history', type: 'chat'}]);
    }
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
            <FormTextInput
              tokens={tokens}
              value={name}
              onChangeText={setName}
            />
          </FormField>
        </FormSectionCard>

        <FormSectionCard
          title="模型"
          tokens={tokens}
          rightAction={
            <View style={styles.switchRow}>
              <Text style={{color: tokens.textSecondary, fontSize: 13}}>
                专属模型
              </Text>
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
              label={toolsMode === 'allow' ? '白名单工具名' : '黑名单工具名'}
              tokens={tokens}
              hint="逗号分隔，如 read, grep">
              <FormTextInput
                tokens={tokens}
                value={toolsList}
                onChangeText={setToolsList}
                placeholder="read, grep"
                multiline
              />
            </FormField>
          ) : (
            <Text style={[styles.hint, {color: tokens.textSecondary}]}>
              未配置时使用全部 10 个文件工具（read、write、replace、delete、glob、grep、list、mkdir、move、copy）。
            </Text>
          )}
        </FormSectionCard>

        <FormSectionCard
          title="Prompt 块"
          tokens={tokens}
          rightAction={
            <Pressable onPress={() => setAddBlockVisible(true)}>
              <Text style={{color: tokens.primary, fontWeight: '600'}}>
                添加
              </Text>
            </Pressable>
          }>
          <View style={styles.blockList}>
            {prompts.map((block, index) => (
              <View
                // WHY: stable key — block.name in key remounts TextInput on each keystroke (Android keyboard blur).
                key={`prompt-block-${index}`}
                style={[
                  styles.blockCard,
                  {
                    backgroundColor: tokens.surface,
                    borderColor: tokens.border,
                  },
                ]}>
                <View style={styles.blockHeader}>
                  <View
                    style={[
                      styles.typeBadge,
                      {backgroundColor: `${tokens.primary}1A`},
                    ]}>
                    <Text
                      style={[styles.typeBadgeText, {color: tokens.primary}]}>
                      {blockTypeLabel(block.type)}
                    </Text>
                  </View>
                  <Text
                    style={[styles.blockName, {color: tokens.text}]}
                    numberOfLines={1}>
                    {block.name}
                  </Text>
                  <View style={styles.blockActions}>
                    {index > 0 ? (
                      <Pressable
                        style={[
                          styles.actionBtn,
                          {
                            borderColor: tokens.border,
                            backgroundColor: tokens.surface,
                          },
                        ]}
                        onPress={() => moveBlock(index, -1)}>
                        <Text style={{color: tokens.textSecondary}}>↑</Text>
                      </Pressable>
                    ) : null}
                    {index < prompts.length - 1 ? (
                      <Pressable
                        style={[
                          styles.actionBtn,
                          {
                            borderColor: tokens.border,
                            backgroundColor: tokens.surface,
                          },
                        ]}
                        onPress={() => moveBlock(index, 1)}>
                        <Text style={{color: tokens.textSecondary}}>↓</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      style={[
                        styles.actionBtn,
                        {
                          borderColor: tokens.border,
                          backgroundColor: tokens.surface,
                        },
                      ]}
                      onPress={() => deleteBlock(index)}>
                      <Text style={{color: tokens.danger}}>×</Text>
                    </Pressable>
                  </View>
                </View>
                <FormField label="名称" tokens={tokens}>
                  <FormTextInput
                    tokens={tokens}
                    value={block.name}
                    onChangeText={v => updateBlock(index, {name: v})}
                  />
                </FormField>
                {block.type === 'text' ? (
                  <>
                    <FormField label="角色" tokens={tokens}>
                      <FormSelectField
                        tokens={tokens}
                        value={block.role}
                        onChange={role =>
                          updateBlock(index, {
                            type: 'text',
                            role: role as PromptBlockRole,
                          })
                        }
                        options={ROLE_OPTIONS}
                        sheetTitle="选择角色"
                      />
                    </FormField>
                    <Text
                      style={[styles.fieldHint, {color: tokens.textSecondary}]}>
                      仅 system 文本块会合并进 LLM system；会话历史请用 chat 块。
                    </Text>
                    <FormField label="内容" tokens={tokens}>
                      <PromptMacroTextInput
                        tokens={tokens}
                        value={block.content}
                        onChangeText={v =>
                          updateBlock(index, {type: 'text', content: v})
                        }
                        placeholder="输入 system 提示词…"
                      />
                    </FormField>
                  </>
                ) : null}
                {block.type === 'chat' ? (
                  <Text style={[styles.fieldHint, {color: tokens.textSecondary}]}>
                    chat 块将会话消息注入模型上下文，通常放在 prompt 列表末尾。
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </FormSectionCard>
      </ScreenFormLayout>
      <BottomSheetMenu
        visible={addBlockVisible}
        items={[
          {label: '文本块', action: 'text'},
          {label: '会话块', action: 'chat'},
        ]}
        onClose={() => setAddBlockVisible(false)}
        onSelect={action => {
          if (action === 'text' || action === 'chat') {
            addBlock(action);
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
  blockList: {gap: 12},
  blockCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
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
