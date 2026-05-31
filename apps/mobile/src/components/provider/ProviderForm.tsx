/**
 * Shared provider create/edit form (§14 M6).
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import type {LlmProtocolKind} from '@novel-master/core';
import {FormChipGroup} from '../form/FormChipGroup';
import {FormField} from '../form/FormField';
import {FormSectionCard} from '../form/FormSectionCard';
import {FormTextInput} from '../form/FormTextInput';
import {ScreenFormLayout} from '../form/ScreenFormLayout';
import {StickyFormFooter} from '../form/StickyFormFooter';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';

const PROTOCOLS: LlmProtocolKind[] = ['openai', 'anthropic', 'gemini'];

export type ProviderFormValues = {
  id: string;
  protocol: LlmProtocolKind;
  baseUrl: string;
  displayName: string;
  defaultModelId: string;
  apiKey: string;
  headersJson: string;
};

export const EMPTY_PROVIDER_FORM: ProviderFormValues = {
  id: '',
  protocol: 'openai',
  baseUrl: '',
  displayName: '',
  defaultModelId: '',
  apiKey: '',
  headersJson: '',
};

type Props = {
  mode: 'create' | 'edit';
  initial?: Partial<ProviderFormValues>;
  isBuiltin?: boolean;
  apiKeyStatus?: 'set' | 'not set';
  saving?: boolean;
  onSubmit: (values: ProviderFormValues) => Promise<void>;
};

function parseHeadersJson(raw: string): Record<string, string> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Headers 必须是 JSON 对象');
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new Error(`Header ${key} 必须是字符串`);
    }
    out[key] = value;
  }
  return out;
}

export function providerFormToCreateInput(values: ProviderFormValues) {
  const id = values.id.trim();
  const baseUrl = values.baseUrl.trim();
  if (!id || !baseUrl) {
    throw new Error('请填写 providerId 与 baseUrl');
  }
  return {
    id,
    protocol: values.protocol,
    baseUrl,
    displayName: values.displayName.trim() || undefined,
    defaultModelId: values.defaultModelId.trim() || undefined,
    apiKey: values.apiKey.trim() || undefined,
    headers: parseHeadersJson(values.headersJson),
  };
}

export function providerFormToEditPatch(values: ProviderFormValues) {
  const patch: {
    protocol?: LlmProtocolKind;
    baseUrl?: string;
    displayName?: string | null;
    defaultModelId?: string | null;
    apiKey?: string;
    headers?: Record<string, string>;
  } = {};
  const baseUrl = values.baseUrl.trim();
  if (baseUrl) {
    patch.baseUrl = baseUrl;
  }
  patch.displayName = values.displayName.trim() || null;
  patch.defaultModelId = values.defaultModelId.trim() || null;
  const apiKey = values.apiKey.trim();
  if (apiKey) {
    patch.apiKey = apiKey;
  }
  const headers = parseHeadersJson(values.headersJson);
  if (headers) {
    patch.headers = headers;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error('请至少修改一项');
  }
  return patch;
}

export function ProviderForm({
  mode,
  initial,
  isBuiltin = false,
  apiKeyStatus,
  saving = false,
  onSubmit,
}: Props) {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const [values, setValues] = useState<ProviderFormValues>({
    ...EMPTY_PROVIDER_FORM,
    ...initial,
  });

  useEffect(() => {
    setValues({...EMPTY_PROVIDER_FORM, ...initial});
  }, [initial]);

  const patch = useCallback(
    (next: Partial<ProviderFormValues>) => {
      setValues(prev => ({...prev, ...next}));
    },
    [],
  );

  const canSave = useMemo(() => {
    if (mode === 'create') {
      return values.id.trim().length > 0 && values.baseUrl.trim().length > 0;
    }
    return true;
  }, [mode, values.baseUrl, values.id]);

  const handleSave = async () => {
    try {
      await onSubmit(values);
    } catch (error) {
      showToast(toastMessage('保存失败', error));
    }
  };

  const protocolOptions = PROTOCOLS.map(p => ({
    value: p,
    label: p,
    disabled: mode === 'edit' && isBuiltin,
  }));

  return (
    <ScreenFormLayout
      tokens={tokens}
      footer={
        saving ? (
          <View style={styles.savingFooter}>
            <ActivityIndicator color={tokens.primary} />
          </View>
        ) : (
          <StickyFormFooter
            tokens={tokens}
            label={mode === 'create' ? '创建' : '保存'}
            disabled={!canSave}
            onPress={() => handleSave().catch(() => undefined)}
          />
        )
      }>
      <FormSectionCard title="连接" tokens={tokens}>
        {mode === 'create' ? (
          <FormField label="Provider ID" tokens={tokens}>
            <FormTextInput
              tokens={tokens}
              value={values.id}
              onChangeText={text => patch({id: text})}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="例如 my-openai"
            />
          </FormField>
        ) : (
          <Text style={[styles.readonlyId, {color: tokens.text}]}>
            ID: {values.id}
          </Text>
        )}
        <FormField label="协议" tokens={tokens}>
          <FormChipGroup
            tokens={tokens}
            value={values.protocol}
            onChange={p => patch({protocol: p})}
            options={protocolOptions}
          />
        </FormField>
        <FormField label="Base URL" tokens={tokens}>
          <FormTextInput
            tokens={tokens}
            value={values.baseUrl}
            onChangeText={text => patch({baseUrl: text})}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="https://api.example.com/v1"
          />
        </FormField>
        <FormField label="显示名称" tokens={tokens} hint="可选">
          <FormTextInput
            tokens={tokens}
            value={values.displayName}
            onChangeText={text => patch({displayName: text})}
            placeholder="可选"
          />
        </FormField>
        <FormField label="默认模型 ID" tokens={tokens} hint="可选">
          <FormTextInput
            tokens={tokens}
            value={values.defaultModelId}
            onChangeText={text => patch({defaultModelId: text})}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="provider/vendorModelId"
          />
        </FormField>
      </FormSectionCard>

      <FormSectionCard title="认证" tokens={tokens}>
        <FormField
          label="API Key"
          tokens={tokens}
          hint={
            mode === 'edit' && apiKeyStatus
              ? `当前：${apiKeyStatus}；留空则不修改`
              : '可选，写入 SKSP 安全存储'
          }>
          <FormTextInput
            tokens={tokens}
            value={values.apiKey}
            onChangeText={text => patch({apiKey: text})}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </FormField>
      </FormSectionCard>

      <FormSectionCard title="高级" tokens={tokens}>
        <FormField label="Headers JSON" tokens={tokens} hint="可选，JSON 对象">
          <FormTextInput
            tokens={tokens}
            value={values.headersJson}
            onChangeText={text => patch({headersJson: text})}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            placeholder='{"X-Custom":"value"}'
          />
        </FormField>
      </FormSectionCard>
    </ScreenFormLayout>
  );
}

const styles = StyleSheet.create({
  readonlyId: {fontSize: 16, fontWeight: '600'},
  savingFooter: {padding: 16, alignItems: 'center'},
});
