/**
 * Global compaction conditions editor (auto-trigger only).
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Text} from 'react-native';
import type {CompactionConditions} from '@novel-master/core';
import {FormField} from '../../components/form/FormField';
import {FormSectionCard} from '../../components/form/FormSectionCard';
import {FormSwitchRow} from '../../components/form/FormSwitchRow';
import {FormTextInput} from '../../components/form/FormTextInput';
import {ScreenFormLayout} from '../../components/form/ScreenFormLayout';
import {StickyFormFooter} from '../../components/form/StickyFormFooter';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';

const DEFAULT_CONDITIONS: CompactionConditions = {
  schemaVersion: 3,
  enabled: false,
  tokenRatio: 0.8,
  visibleFloor: 20,
};

export function CompactionConditionsScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [tokenRatio, setTokenRatio] = useState('0.8');
  const [visibleFloor, setVisibleFloor] = useState('20');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const stored = await runtime.compactionConditions.getConditions();
      const c = stored ?? DEFAULT_CONDITIONS;
      setEnabled(c.enabled);
      setTokenRatio(c.tokenRatio != null ? String(c.tokenRatio) : '');
      setVisibleFloor(
        c.visibleFloor != null ? String(c.visibleFloor) : '',
      );
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const collect = (): CompactionConditions | null => {
    const ratio = tokenRatio.trim() ? Number(tokenRatio) : undefined;
    const floor = visibleFloor.trim() ? Number(visibleFloor) : undefined;
    if (enabled && ratio == null && floor == null) {
      showToast('启用时至少填写 token 比例或可见条数阈值');
      return null;
    }
    return {
      schemaVersion: 3,
      enabled,
      ...(ratio != null ? {tokenRatio: ratio} : {}),
      ...(floor != null ? {visibleFloor: floor} : {}),
    };
  };

  const handleSave = async () => {
    const conditions = collect();
    if (!conditions) {
      return;
    }
    setSaving(true);
    try {
      await runtime.compactionConditions.setConditions(conditions);
      showToast('已保存压缩条件');
    } catch (error) {
      showToast(toastMessage('保存失败', error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <ActivityIndicator style={{marginTop: 32}} />;
  }

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
        title="压缩条件"
        tokens={tokens}
        hint="满足任一条件时自动发出压缩事件；具体 hide/刷新宏见「事件配置」。">
        <FormSwitchRow
          label="启用自动压缩"
          tokens={tokens}
          value={enabled}
          onValueChange={setEnabled}
        />
      </FormSectionCard>

      {enabled ? (
        <FormSectionCard title="触发条件（OR）" tokens={tokens}>
          <FormField
            label="Token 比例"
            tokens={tokens}
            hint="基于当前模型上下文上限 × 比例">
            <FormTextInput
              tokens={tokens}
              value={tokenRatio}
              onChangeText={setTokenRatio}
              keyboardType="decimal-pad"
              placeholder="0.8"
            />
          </FormField>
          <FormField
            label="可见条数阈值 visible-floor"
            tokens={tokens}
            hint="可见条数 > 该值时满足">
            <FormTextInput
              tokens={tokens}
              value={visibleFloor}
              onChangeText={setVisibleFloor}
              keyboardType="number-pad"
              placeholder="20"
            />
          </FormField>
        </FormSectionCard>
      ) : (
        <Text style={{color: tokens.textSecondary, paddingHorizontal: 16}}>
          关闭时仅可手动在对话中「压缩」。
        </Text>
      )}
    </ScreenFormLayout>
  );
}
