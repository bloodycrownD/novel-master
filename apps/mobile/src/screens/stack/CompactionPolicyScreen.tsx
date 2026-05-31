/**
 * Global compaction policy editor (compactionPolicy store).
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Alert, Text} from 'react-native';
import type {CompactionPolicy} from '@novel-master/core';
import {FormChipGroup} from '../../components/form/FormChipGroup';
import {FormField} from '../../components/form/FormField';
import {FormSectionCard} from '../../components/form/FormSectionCard';
import {FormSwitchRow} from '../../components/form/FormSwitchRow';
import {FormTextInput} from '../../components/form/FormTextInput';
import {ScreenFormLayout} from '../../components/form/ScreenFormLayout';
import {StickyFormFooter} from '../../components/form/StickyFormFooter';
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
    return <ActivityIndicator style={{marginTop: 32}} />;
  }

  const agentChipOptions = agentOptions.map(id => ({value: id, label: id}));

  return (
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
      <FormSectionCard
        title="全局压缩"
        tokens={tokens}
        hint="全应用单条策略；启用后按触发条件（OR）自动压缩上下文。">
        <FormSwitchRow
          label="启用压缩"
          tokens={tokens}
          value={enabled}
          onValueChange={setEnabled}
        />
      </FormSectionCard>

      {enabled ? (
        <>
          <FormSectionCard title="触发条件" tokens={tokens}>
            <FormField label="Token 阈值" tokens={tokens} hint="与消息条数阈值为 OR 关系">
              <FormTextInput
                tokens={tokens}
                value={tokenThreshold}
                onChangeText={setTokenThreshold}
                keyboardType="number-pad"
                placeholder="如 12000"
              />
            </FormField>
            <FormField label="消息条数阈值" tokens={tokens}>
              <FormTextInput
                tokens={tokens}
                value={floorThreshold}
                onChangeText={setFloorThreshold}
                keyboardType="number-pad"
                placeholder="如 20"
              />
            </FormField>
            <FormField label="保留最近 N 条" tokens={tokens}>
              <FormTextInput
                tokens={tokens}
                value={keepLastN}
                onChangeText={setKeepLastN}
                keyboardType="number-pad"
              />
            </FormField>
          </FormSectionCard>

          <FormSectionCard title="摘要" tokens={tokens}>
            <FormField label="摘要方式" tokens={tokens}>
              <FormChipGroup
                tokens={tokens}
                value={abstractType}
                onChange={setAbstractType}
                options={[
                  {value: 'agent', label: 'Agent 生成'},
                  {value: 'text', label: '静态文本'},
                ]}
              />
            </FormField>
            {abstractType === 'agent' ? (
              <>
                <FormField label="摘要 Agent" tokens={tokens}>
                  <FormChipGroup
                    tokens={tokens}
                    value={agentId}
                    onChange={setAgentId}
                    options={
                      agentChipOptions.length > 0
                        ? agentChipOptions
                        : [{value: 'agent-writer', label: 'agent-writer'}]
                    }
                  />
                </FormField>
                <FormField label="摘要指令 instruction" tokens={tokens}>
                  <FormTextInput
                    tokens={tokens}
                    value={instruction}
                    onChangeText={setInstruction}
                    multiline
                    placeholder="Summarize the following conversation history concisely:"
                  />
                </FormField>
              </>
            ) : (
              <FormField label="摘要模板 content" tokens={tokens}>
                <FormTextInput
                  tokens={tokens}
                  value={abstractContent}
                  onChangeText={setAbstractContent}
                  multiline
                  placeholder="支持宏"
                />
              </FormField>
            )}
          </FormSectionCard>
        </>
      ) : null}
    </ScreenFormLayout>
  );
}
