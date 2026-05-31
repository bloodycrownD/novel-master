/**
 * Global compaction policy editor (compactionPolicy store).
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {CompactionPolicy} from '@novel-master/core';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';

const DEFAULT_POLICY: CompactionPolicy = {
  enabled: false,
  trigger: {tokenThreshold: 12000, floorThreshold: 20},
  action: {
    keepLastN: 6,
    abstract: {type: 'agent', agentId: 'agent-writer'},
  },
};

export function CompactionPolicyScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [tokenThreshold, setTokenThreshold] = useState('');
  const [floorThreshold, setFloorThreshold] = useState('');
  const [keepLastN, setKeepLastN] = useState('6');
  const [abstractType, setAbstractType] = useState<'agent' | 'text'>('agent');
  const [agentId, setAgentId] = useState('agent-writer');
  const [instruction, setInstruction] = useState('');
  const [abstractContent, setAbstractContent] = useState('');
  const [agentOptions, setAgentOptions] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ids = await runtime.agentRegistry.listAgentIds();
      setAgentOptions([...ids]);
      const stored = await runtime.compactionPolicy.getPolicy();
      const policy = stored ?? DEFAULT_POLICY;
      setEnabled(policy.enabled);
      setTokenThreshold(
        policy.trigger.tokenThreshold != null
          ? String(policy.trigger.tokenThreshold)
          : '',
      );
      setFloorThreshold(
        policy.trigger.floorThreshold != null
          ? String(policy.trigger.floorThreshold)
          : '',
      );
      setKeepLastN(String(policy.action.keepLastN));
      const abstract = policy.action.abstract;
      if (abstract.type === 'text') {
        setAbstractType('text');
        setAbstractContent(abstract.content);
      } else {
        setAbstractType('agent');
        setAgentId(abstract.agentId);
        setInstruction(abstract.instruction ?? '');
      }
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const collectPolicy = (): CompactionPolicy | null => {
    const token = tokenThreshold.trim() ? Number(tokenThreshold) : undefined;
    const floor = floorThreshold.trim() ? Number(floorThreshold) : undefined;
    if (enabled && token == null && floor == null) {
      Alert.alert('压缩触发条件至少填一项');
      return null;
    }
    const keep = Number(keepLastN) || 6;
    const abstract =
      abstractType === 'text'
        ? {type: 'text' as const, content: abstractContent}
        : {
            type: 'agent' as const,
            agentId: agentId || agentOptions[0] || 'agent-writer',
            ...(instruction.trim() ? {instruction: instruction.trim()} : {}),
          };
    const trigger =
      token != null || floor != null
        ? {
            ...(token != null ? {tokenThreshold: token} : {}),
            ...(floor != null ? {floorThreshold: floor} : {}),
          }
        : DEFAULT_POLICY.trigger;
    return {
      enabled,
      trigger,
      action: {keepLastN: keep, abstract},
    };
  };

  const handleSave = async () => {
    const policy = collectPolicy();
    if (!policy) {
      return;
    }
    setSaving(true);
    try {
      await runtime.compactionPolicy.setPolicy(policy);
      Alert.alert('已保存全局压缩策略');
    } catch (error) {
      Alert.alert(
        '保存失败',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.sectionTitle, {color: tokens.text}]}>
          全局压缩策略
        </Text>
        <View style={styles.switchRow}>
          <Text style={{color: tokens.text}}>启用压缩</Text>
          <Switch
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{false: tokens.border, true: tokens.primary}}
          />
        </View>
        {enabled ? (
          <>
            <Text style={[styles.hint, {color: tokens.textSecondary}]}>
              全应用单条策略；触发条件为 OR（token 估计或消息条数）。
            </Text>
            <Text style={[styles.label, {color: tokens.textSecondary}]}>
              Token 阈值
            </Text>
            <TextInput
              style={[
                styles.input,
                {color: tokens.text, borderColor: tokens.border},
              ]}
              value={tokenThreshold}
              onChangeText={setTokenThreshold}
              keyboardType="number-pad"
              placeholder="如 12000"
              placeholderTextColor={tokens.textSecondary}
            />
            <Text style={[styles.label, {color: tokens.textSecondary}]}>
              消息条数阈值
            </Text>
            <TextInput
              style={[
                styles.input,
                {color: tokens.text, borderColor: tokens.border},
              ]}
              value={floorThreshold}
              onChangeText={setFloorThreshold}
              keyboardType="number-pad"
              placeholder="如 20"
              placeholderTextColor={tokens.textSecondary}
            />
            <Text style={[styles.label, {color: tokens.textSecondary}]}>
              保留最近 N 条
            </Text>
            <TextInput
              style={[
                styles.input,
                {color: tokens.text, borderColor: tokens.border},
              ]}
              value={keepLastN}
              onChangeText={setKeepLastN}
              keyboardType="number-pad"
            />
            <Text style={[styles.label, {color: tokens.textSecondary}]}>
              摘要方式
            </Text>
            <View style={styles.chips}>
              {(['agent', 'text'] as const).map(type => (
                <Pressable
                  key={type}
                  style={[
                    styles.chip,
                    {
                      borderColor: tokens.border,
                      backgroundColor:
                        abstractType === type ? tokens.primary : tokens.surface,
                    },
                  ]}
                  onPress={() => setAbstractType(type)}>
                  <Text
                    style={{
                      color: abstractType === type ? '#fff' : tokens.text,
                    }}>
                    {type === 'agent' ? 'Agent 生成' : '静态文本'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {abstractType === 'agent' ? (
              <>
                <Text style={[styles.label, {color: tokens.textSecondary}]}>
                  摘要 Agent
                </Text>
                <View style={styles.chips}>
                  {agentOptions.map(id => (
                    <Pressable
                      key={id}
                      style={[
                        styles.chip,
                        {
                          borderColor: tokens.border,
                          backgroundColor:
                            agentId === id ? tokens.primary : tokens.surface,
                        },
                      ]}
                      onPress={() => setAgentId(id)}>
                      <Text
                        style={{
                          color: agentId === id ? '#fff' : tokens.text,
                        }}>
                        {id}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={[styles.label, {color: tokens.textSecondary}]}>
                  摘要指令 instruction
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    styles.textArea,
                    {color: tokens.text, borderColor: tokens.border},
                  ]}
                  value={instruction}
                  onChangeText={setInstruction}
                  multiline
                  placeholder="Summarize the following conversation history concisely:"
                  placeholderTextColor={tokens.textSecondary}
                />
              </>
            ) : (
              <>
                <Text style={[styles.label, {color: tokens.textSecondary}]}>
                  摘要模板 content
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    styles.textArea,
                    {color: tokens.text, borderColor: tokens.border},
                  ]}
                  value={abstractContent}
                  onChangeText={setAbstractContent}
                  multiline
                  placeholder="支持宏"
                  placeholderTextColor={tokens.textSecondary}
                />
              </>
            )}
          </>
        ) : null}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  loader: {marginTop: 32},
  scroll: {padding: 16, gap: 8},
  sectionTitle: {fontSize: 18, fontWeight: '600'},
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  label: {fontSize: 13, marginTop: 8},
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  textArea: {minHeight: 72, textAlignVertical: 'top'},
  hint: {fontSize: 12},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4},
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  footer: {padding: 12, borderTopWidth: StyleSheet.hairlineWidth},
  saveBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  saveBtnText: {color: '#fff', fontWeight: '600', fontSize: 16},
});
