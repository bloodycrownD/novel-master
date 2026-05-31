/**
 * Agent definition editor: name, model pin, maxSteps, prompt blocks.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {AgentDefinition, PromptBlock} from '@novel-master/core';
import {
  formatApplicationModelId,
  parseApplicationModelId,
} from '@novel-master/core';
import {BottomSheetMenu} from '../sheet/BottomSheetMenu';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  agentId: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
};

const ROLES = ['system', 'user', 'assistant'] as const;

function blockTypeLabel(type: PromptBlock['type']): string {
  if (type === 'text') {
    return '文本';
  }
  if (type === 'abstract') {
    return '摘要';
  }
  return '会话';
}

export function AgentEditorForm({agentId, onDirtyChange, onSaved}: Props) {
  const {tokens} = useTheme();
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
  const [savedBaseline, setSavedBaseline] = useState('');
  const [addBlockVisible, setAddBlockVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const snapshot = useMemo(
    () =>
      JSON.stringify({
        name,
        maxSteps,
        modelEnabled,
        providerId,
        vendorModelId,
        prompts,
      }),
    [name, maxSteps, modelEnabled, providerId, vendorModelId, prompts],
  );

  useEffect(() => {
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
    setPrompts([...def.prompts]);
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
    setSavedBaseline(
      JSON.stringify({
        name: def.name,
        maxSteps: String(def.runtime?.maxSteps ?? 20),
        modelEnabled: Boolean(def.model),
        providerId: def.model
          ? parseApplicationModelId(def.model).providerId
          : providerList[0]?.id ?? '',
        vendorModelId: def.model
          ? parseApplicationModelId(def.model).vendorModelId
          : '',
        prompts: [...def.prompts],
      }),
    );
  }, [agentId, runtime, loadProviders, loadSavedModels]);

  useEffect(() => {
    loadAgent().catch(err =>
      Alert.alert(
        '加载失败',
        err instanceof Error ? err.message : String(err),
      ),
    );
  }, [loadAgent]);

  const preferredModelId = modelEnabled
    ? formatApplicationModelId(providerId, vendorModelId)
    : undefined;

  const buildDefinition = (): AgentDefinition | null => {
    if (!name.trim()) {
      Alert.alert('请填写 Agent 名称');
      return null;
    }
    if (prompts.length === 0) {
      Alert.alert('至少保留一个 Prompt 块');
      return null;
    }
    const steps = Number(maxSteps);
    const def: AgentDefinition = {
      name: name.trim(),
      prompts,
      ...(Number.isFinite(steps) && steps > 0
        ? {runtime: {maxSteps: steps}}
        : {}),
      ...(modelEnabled && providerId && vendorModelId
        ? {
            model: formatApplicationModelId(providerId, vendorModelId),
          }
        : {}),
    };
    return def;
  };

  const handleSave = async () => {
    const def = buildDefinition();
    if (!def) {
      return;
    }
    setSaving(true);
    try {
      await runtime.agentRegistry.upsert(agentId, def);
      setSavedBaseline(snapshot);
      onSaved?.();
      Alert.alert('已保存 Agent 配置');
    } catch (error) {
      Alert.alert(
        '保存失败',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSaving(false);
    }
  };

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
      Alert.alert('至少保留一个 Prompt 块');
      return;
    }
    setPrompts(prev => prev.filter((_, i) => i !== index));
  };

  const addBlock = (kind: 'text' | 'abstract' | 'chat') => {
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
    } else if (kind === 'abstract') {
      setPrompts(prev => [
        ...prev,
        {
          name: 'abstract',
          type: 'abstract',
          content: '压缩后的内容如下：\n{{.abstract}}',
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

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.sectionTitle, {color: tokens.text}]}>
          基本信息
        </Text>
        <Text style={[styles.label, {color: tokens.textSecondary}]}>名称</Text>
        <TextInput
          style={[styles.input, {color: tokens.text, borderColor: tokens.border}]}
          value={name}
          onChangeText={setName}
        />

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, {color: tokens.text}]}>模型</Text>
          <View style={styles.switchRow}>
            <Text style={{color: tokens.textSecondary}}>专属模型</Text>
            <Switch
              value={modelEnabled}
              onValueChange={setModelEnabled}
              trackColor={{false: tokens.border, true: tokens.primary}}
            />
          </View>
        </View>
        {!modelEnabled ? (
          <Text style={[styles.hint, {color: tokens.textSecondary}]}>
            未启用时跟随工作区当前模型（会话操作抽屉 / 我的）。
          </Text>
        ) : (
          <>
            <Text style={[styles.label, {color: tokens.textSecondary}]}>
              服务商
            </Text>
            <View style={styles.chips}>
              {providers.map(p => (
                <Pressable
                  key={p.id}
                  style={[
                    styles.chip,
                    {
                      borderColor: tokens.border,
                      backgroundColor:
                        p.id === providerId ? tokens.primary : tokens.surface,
                    },
                  ]}
                  onPress={() => handleProviderChange(p.id)}>
                  <Text
                    style={{
                      color: p.id === providerId ? '#fff' : tokens.text,
                    }}>
                    {p.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.label, {color: tokens.textSecondary}]}>
              模型
            </Text>
            <View style={styles.chips}>
              {savedModels.map(m => (
                <Pressable
                  key={m.vendorModelId}
                  style={[
                    styles.chip,
                    {
                      borderColor: tokens.border,
                      backgroundColor:
                        m.vendorModelId === vendorModelId
                          ? tokens.primary
                          : tokens.surface,
                    },
                  ]}
                  onPress={() => setVendorModelId(m.vendorModelId)}>
                  <Text
                    style={{
                      color:
                        m.vendorModelId === vendorModelId
                          ? '#fff'
                          : tokens.text,
                    }}>
                    {m.displayName?.trim() || m.vendorModelId}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.hint, {color: tokens.textSecondary}]}>
              model: {preferredModelId ?? '—'}
            </Text>
          </>
        )}

        <Text style={[styles.sectionTitle, {color: tokens.text}]}>运行时</Text>
        <Text style={[styles.label, {color: tokens.textSecondary}]}>
          最大步数 maxSteps
        </Text>
        <TextInput
          style={[styles.input, {color: tokens.text, borderColor: tokens.border}]}
          value={maxSteps}
          onChangeText={setMaxSteps}
          keyboardType="number-pad"
        />
        <Text style={[styles.hint, {color: tokens.textSecondary}]}>
          每轮 run 的模型往返上限；省略时 Core 默认 20。
        </Text>

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, {color: tokens.text}]}>
            Prompt 块
          </Text>
          <Pressable onPress={() => setAddBlockVisible(true)}>
            <Text style={{color: tokens.primary}}>添加</Text>
          </Pressable>
        </View>
        {prompts.map((block, index) => (
          <View
            key={`${block.name}-${index}`}
            style={[styles.blockCard, {borderColor: tokens.border}]}>
            <View style={styles.blockHeader}>
              <Text style={{color: tokens.primary, fontWeight: '600'}}>
                {blockTypeLabel(block.type)}
              </Text>
              <View style={styles.blockActions}>
                {index > 0 ? (
                  <Pressable onPress={() => moveBlock(index, -1)}>
                    <Text style={{color: tokens.textSecondary}}>↑</Text>
                  </Pressable>
                ) : null}
                {index < prompts.length - 1 ? (
                  <Pressable onPress={() => moveBlock(index, 1)}>
                    <Text style={{color: tokens.textSecondary}}>↓</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => deleteBlock(index)}>
                  <Text style={{color: tokens.danger}}>×</Text>
                </Pressable>
              </View>
            </View>
            <Text style={[styles.label, {color: tokens.textSecondary}]}>
              名称
            </Text>
            <TextInput
              style={[
                styles.input,
                {color: tokens.text, borderColor: tokens.border},
              ]}
              value={block.name}
              onChangeText={v => updateBlock(index, {name: v})}
            />
            {block.type === 'text' ? (
              <>
                <Text style={[styles.label, {color: tokens.textSecondary}]}>
                  角色
                </Text>
                <View style={styles.chips}>
                  {ROLES.map(role => (
                    <Pressable
                      key={role}
                      style={[
                        styles.chip,
                        {
                          borderColor: tokens.border,
                          backgroundColor:
                            block.role === role
                              ? tokens.primary
                              : tokens.surface,
                        },
                      ]}
                      onPress={() =>
                        updateBlock(index, {type: 'text', role})
                      }>
                      <Text
                        style={{
                          color: block.role === role ? '#fff' : tokens.text,
                        }}>
                        {role}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={[styles.label, {color: tokens.textSecondary}]}>
                  内容
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    styles.textArea,
                    {color: tokens.text, borderColor: tokens.border},
                  ]}
                  value={block.content}
                  onChangeText={v =>
                    updateBlock(index, {type: 'text', content: v})
                  }
                  multiline
                />
              </>
            ) : null}
            {block.type === 'abstract' ? (
              <>
                <Text style={[styles.label, {color: tokens.textSecondary}]}>
                  内容
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    styles.textArea,
                    {color: tokens.text, borderColor: tokens.border},
                  ]}
                  value={block.content}
                  onChangeText={v =>
                    updateBlock(index, {type: 'abstract', content: v})
                  }
                  multiline
                />
              </>
            ) : null}
            {block.type === 'chat' ? (
              <Text style={[styles.hint, {color: tokens.textSecondary}]}>
                chat 块将会话消息注入模型上下文，通常放在 prompt 列表末尾。
              </Text>
            ) : null}
          </View>
        ))}

        <Text style={[styles.sectionTitle, {color: tokens.text}]}>工具</Text>
        <Text style={[styles.hint, {color: tokens.textSecondary}]}>
          VFS 工具（read / write / list 等）由运行时全局注册，当前 Agent
          配置不可 per-agent 开关。
        </Text>
      </ScrollView>
      <View style={[styles.footer, {borderTopColor: tokens.border}]}>
        <Pressable
          style={[styles.saveBtn, {backgroundColor: tokens.primary}]}
          onPress={() => handleSave().catch(() => undefined)}
          disabled={saving}>
          <Text style={styles.saveBtnText}>
            {saving ? '保存中…' : '保存'}
          </Text>
        </Pressable>
      </View>
      <BottomSheetMenu
        visible={addBlockVisible}
        items={[
          {label: '文本块 text', action: 'text'},
          {label: '摘要块 abstract', action: 'abstract'},
          {label: '会话块 chat', action: 'chat'},
        ]}
        onClose={() => setAddBlockVisible(false)}
        onSelect={action => {
          if (action === 'text' || action === 'abstract' || action === 'chat') {
            addBlock(action);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  scroll: {padding: 16, gap: 8, paddingBottom: 32},
  sectionTitle: {fontSize: 17, fontWeight: '600', marginTop: 12},
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  label: {fontSize: 13, marginTop: 4},
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  textArea: {minHeight: 80, textAlignVertical: 'top'},
  hint: {fontSize: 12, marginTop: 4},
  switchRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4},
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  blockCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    gap: 4,
  },
  blockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  blockActions: {flexDirection: 'row', gap: 12},
  footer: {
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  saveBtnText: {color: '#fff', fontWeight: '600', fontSize: 16},
});
