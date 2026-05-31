/**
 * Shared provider create/edit form (§14 M6).
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {LlmProtocolKind} from '@novel-master/core';
import {useTheme} from '../../theme/ThemeProvider';

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
      Alert.alert(
        '保存失败',
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {mode === 'create' ? (
          <>
            <Text style={[styles.label, {color: tokens.textSecondary}]}>
              Provider ID
            </Text>
            <TextInput
              style={[
                styles.input,
                {color: tokens.text, borderColor: tokens.border},
              ]}
              value={values.id}
              onChangeText={text => patch({id: text})}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="例如 my-openai"
              placeholderTextColor={tokens.textSecondary}
            />
          </>
        ) : (
          <Text style={[styles.readonlyId, {color: tokens.text}]}>
            ID: {values.id}
          </Text>
        )}

        <Text style={[styles.label, {color: tokens.textSecondary}]}>协议</Text>
        <View style={styles.chips}>
          {PROTOCOLS.map(protocol => {
            const active = values.protocol === protocol;
            const disabled = mode === 'edit' && isBuiltin;
            return (
              <Pressable
                key={protocol}
                disabled={disabled}
                style={[
                  styles.chip,
                  {
                    borderColor: tokens.border,
                    backgroundColor: active ? tokens.primary : tokens.surface,
                    opacity: disabled && !active ? 0.5 : 1,
                  },
                ]}
                onPress={() => patch({protocol})}>
                <Text style={{color: active ? '#fff' : tokens.text}}>
                  {protocol}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.label, {color: tokens.textSecondary}]}>
          Base URL
        </Text>
        <TextInput
          style={[
            styles.input,
            {color: tokens.text, borderColor: tokens.border},
          ]}
          value={values.baseUrl}
          onChangeText={text => patch({baseUrl: text})}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://api.example.com/v1"
          placeholderTextColor={tokens.textSecondary}
        />

        <Text style={[styles.label, {color: tokens.textSecondary}]}>
          显示名称（可选）
        </Text>
        <TextInput
          style={[
            styles.input,
            {color: tokens.text, borderColor: tokens.border},
          ]}
          value={values.displayName}
          onChangeText={text => patch({displayName: text})}
          placeholder="可选"
          placeholderTextColor={tokens.textSecondary}
        />

        <Text style={[styles.label, {color: tokens.textSecondary}]}>
          默认模型 ID（可选）
        </Text>
        <TextInput
          style={[
            styles.input,
            {color: tokens.text, borderColor: tokens.border},
          ]}
          value={values.defaultModelId}
          onChangeText={text => patch({defaultModelId: text})}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="provider/vendorModelId"
          placeholderTextColor={tokens.textSecondary}
        />

        <Text style={[styles.label, {color: tokens.textSecondary}]}>
          API Key
          {mode === 'edit' && apiKeyStatus ? `（当前：${apiKeyStatus}）` : ''}
        </Text>
        <TextInput
          style={[
            styles.input,
            {color: tokens.text, borderColor: tokens.border},
          ]}
          value={values.apiKey}
          onChangeText={text => patch({apiKey: text})}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder={
            mode === 'edit' ? '留空则不修改' : '可选，写入 SKSP 安全存储'
          }
          placeholderTextColor={tokens.textSecondary}
        />

        <Text style={[styles.label, {color: tokens.textSecondary}]}>
          Headers JSON（可选）
        </Text>
        <TextInput
          style={[
            styles.input,
            styles.multiline,
            {color: tokens.text, borderColor: tokens.border},
          ]}
          value={values.headersJson}
          onChangeText={text => patch({headersJson: text})}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          placeholder='{"X-Custom":"value"}'
          placeholderTextColor={tokens.textSecondary}
        />
      </ScrollView>

      <Pressable
        style={[
          styles.saveBtn,
          {
            backgroundColor: canSave ? tokens.primary : tokens.border,
          },
        ]}
        disabled={!canSave || saving}
        onPress={() => handleSave().catch(() => undefined)}>
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveBtnText}>
            {mode === 'create' ? '创建' : '保存'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  scroll: {padding: 16, gap: 8, paddingBottom: 24},
  label: {fontSize: 13, marginTop: 8},
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  multiline: {minHeight: 72, textAlignVertical: 'top'},
  readonlyId: {fontSize: 16, fontWeight: '600', marginBottom: 4},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  saveBtn: {
    margin: 16,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnText: {color: '#fff', fontWeight: '600', fontSize: 16},
});
