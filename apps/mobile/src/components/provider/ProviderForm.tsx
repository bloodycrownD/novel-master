/**
 * Shared provider create/edit form (§14 M6).
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {type LlmProtocolKind} from '@novel-master/core/provider';
import {FormChipGroup} from '@/components/form/FormChipGroup';
import {FormField} from '@/components/form/FormField';
import {FormSectionCard} from '@/components/form/FormSectionCard';
import {FormTextInput} from '@/components/form/FormTextInput';
import {ApiKeyStatusTag} from './ApiKeyStatusTag';
import {ScreenFormLayout} from '@/components/form/ScreenFormLayout';
import {StickyFormFooter} from '@/components/form/StickyFormFooter';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {toastMessage} from '@/errors/toast-message';

const PROTOCOLS: LlmProtocolKind[] = ['openai', 'anthropic', 'gemini'];

export type ProviderFormValues = {
  displayName: string;
  protocol: LlmProtocolKind;
  baseUrl: string;
  apiKey: string;
  headersJson: string;
  bodyParamsJson: string;
};

export const EMPTY_PROVIDER_FORM: ProviderFormValues = {
  displayName: '',
  protocol: 'openai',
  baseUrl: '',
  apiKey: '',
  headersJson: '',
  bodyParamsJson: '',
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
  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (typeof value !== 'string') {
      throw new Error(`Header ${key} 必须是字符串`);
    }
    out[key] = value;
  }
  return out;
}

/**
 * 自定义参数：必须是 JSON 对象，值任意 JSON（boolean/number/嵌套对象均可）。
 * 空文本返回显式空对象（保存即可清空，区别于 headers 的「空文本不修改」）。
 */
export function parseBodyParamsJson(
  raw: string,
): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('自定义参数必须是 JSON 对象');
  }
  return parsed as Record<string, unknown>;
}

export function providerFormToCreateInput(values: ProviderFormValues) {
  const displayName = values.displayName.trim();
  const baseUrl = values.baseUrl.trim();
  const apiKey = values.apiKey.trim();
  if (!displayName || !baseUrl) {
    throw new Error('请填写服务商名称与 baseUrl');
  }
  if (!apiKey) {
    throw new Error('请填写 API Key');
  }
  return {
    protocol: values.protocol,
    baseUrl,
    displayName,
    apiKey,
    headers: parseHeadersJson(values.headersJson),
    bodyParams: parseBodyParamsJson(values.bodyParamsJson),
  };
}

export function providerFormToEditPatch(values: ProviderFormValues) {
  const patch: {
    protocol?: LlmProtocolKind;
    baseUrl?: string;
    displayName?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    bodyParams?: Record<string, unknown>;
  } = {};
  const displayName = values.displayName.trim();
  if (displayName) {
    patch.displayName = displayName;
  }
  const baseUrl = values.baseUrl.trim();
  if (baseUrl) {
    patch.baseUrl = baseUrl;
  }
  const apiKey = values.apiKey.trim();
  if (apiKey) {
    patch.apiKey = apiKey;
  }
  const headers = parseHeadersJson(values.headersJson);
  if (headers) {
    patch.headers = headers;
  }
  // 自定义参数始终显式提交：空文本 → {}（清空），非空 → 解析对象；
  // 非法输入由 parseBodyParamsJson 抛中文错误阻断保存。
  patch.bodyParams = parseBodyParamsJson(values.bodyParamsJson);
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

  const patch = useCallback((next: Partial<ProviderFormValues>) => {
    setValues(prev => ({...prev, ...next}));
  }, []);

  const canSave = useMemo(() => {
    if (mode === 'create') {
      return (
        values.displayName.trim().length > 0 &&
        values.baseUrl.trim().length > 0 &&
        values.apiKey.trim().length > 0
      );
    }
    return values.displayName.trim().length > 0;
  }, [mode, values.apiKey, values.baseUrl, values.displayName]);

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
      }
    >
      <FormSectionCard title="连接" tokens={tokens}>
        <FormField label="服务商名称" tokens={tokens}>
          <FormTextInput
            tokens={tokens}
            value={values.displayName}
            onChangeText={text => patch({displayName: text})}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="例如 智谱"
          />
        </FormField>
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
      </FormSectionCard>

      <FormSectionCard title="认证" tokens={tokens}>
        {mode === 'edit' && apiKeyStatus != null ? (
          <View style={styles.statusRow}>
            <Text style={[styles.statusLabel, {color: tokens.textSecondary}]}>
              当前状态
            </Text>
            <ApiKeyStatusTag status={apiKeyStatus} tokens={tokens} />
          </View>
        ) : null}
        <FormField
          label="API Key"
          tokens={tokens}
          hint={mode === 'edit' ? '留空则不修改' : '必填，写入 SKSP 安全存储'}
        >
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
        <FormField
          label="自定义参数"
          tokens={tokens}
          hint="JSON 对象，原样合并进请求体顶层（可覆盖标准字段）；清空保存即移除"
        >
          <FormTextInput
            tokens={tokens}
            value={values.bodyParamsJson}
            onChangeText={text => patch({bodyParamsJson: text})}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            placeholder='{"tool_stream": true}'
          />
        </FormField>
      </FormSectionCard>
    </ScreenFormLayout>
  );
}

const styles = StyleSheet.create({
  savingFooter: {padding: 16, alignItems: 'center'},
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  statusLabel: {fontSize: 13},
});
