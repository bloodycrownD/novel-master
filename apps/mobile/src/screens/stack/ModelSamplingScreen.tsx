/**
 * 单模型设置：内部预算（上下文、计数）与生成参数（采样、思考）。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {
  parseApplicationModelId,
  savedModelContextWindowTokens,
  savedModelSampling,
  savedModelThinking,
  savedModelTokenCounterMode,
  TOKEN_COUNTER_MODE_SELECT_OPTIONS,
  type LlmProtocolKind,
  type ModelSamplingParams,
  type TokenizerOverride,
} from '@novel-master/core/provider';
import {FormField} from '../../components/form/FormField';
import {FormSelectField} from '../../components/form/FormSelectField';
import {FormSectionCard} from '../../components/form/FormSectionCard';
import {FormSwitchRow} from '../../components/form/FormSwitchRow';
import {FormTextInput} from '../../components/form/FormTextInput';
import {ScreenFormLayout} from '../../components/form/ScreenFormLayout';
import {StickyFormFooter} from '../../components/form/StickyFormFooter';
import {SamplingForm} from '../../components/provider/SamplingForm';
import {resolveModelShortLabel} from '../../provider/model-display-label';
import {useRuntime} from '../../hooks/useRuntime';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';

type SamplingRoute = RouteProp<RootStackParamList, 'ModelSampling'>;

function paramsEmpty(params: ModelSamplingParams | undefined): boolean {
  if (!params) {
    return true;
  }
  if (params.protocol === 'openai') {
    return Object.keys(params.openai).length === 0;
  }
  if (params.protocol === 'anthropic') {
    return Object.keys(params.anthropic).length === 0;
  }
  if (params.protocol === 'gemini') {
    return Object.keys(params.gemini).length === 0;
  }
  return true;
}

export function ModelSamplingScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation();
  const route = useRoute<SamplingRoute>();
  const applicationModelId = route.params?.applicationModelId;

  const [protocol, setProtocol] = useState<LlmProtocolKind>('openai');
  const [params, setParams] = useState<ModelSamplingParams | undefined>();
  const [contextWindowTokens, setContextWindowTokens] = useState('');
  const [tokenCounterMode, setTokenCounterMode] =
    useState<TokenizerOverride>('auto');
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [modelSubtitle, setModelSubtitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    if (!applicationModelId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const {providerId} = parseApplicationModelId(applicationModelId);
      const provider = await runtime.providers.get(providerId);
      setProtocol(provider.protocol);
      try {
        const short = await resolveModelShortLabel(runtime, applicationModelId);
        setModelSubtitle(`${short}\n${applicationModelId}`);
      } catch {
        setModelSubtitle(applicationModelId);
      }
      const saved = await runtime.providerModels.getSaved(applicationModelId);
      if (saved) {
        setContextWindowTokens(
          String(savedModelContextWindowTokens(saved.settings)),
        );
        setTokenCounterMode(savedModelTokenCounterMode(saved.settings));
        const sampling = savedModelSampling(saved.settings);
        const stored =
          sampling.enabled && sampling.params != null
            ? sampling.params
            : undefined;
        setParams(stored);
        setThinkingEnabled(savedModelThinking(saved.settings).enabled);
      }
    } catch (error) {
      showToast(toastMessage('加载失败', error));
    } finally {
      setLoading(false);
    }
  }, [runtime, applicationModelId, showToast]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (!applicationModelId) {
      showToast(toastMessage('错误', '缺少 applicationModelId'));
      navigation.goBack();
    }
  }, [applicationModelId, navigation, showToast]);

  const handleSave = async () => {
    if (!applicationModelId) {
      return;
    }
    const {providerId, vendorModelId} =
      parseApplicationModelId(applicationModelId);
    const contextWindow = Number(contextWindowTokens);
    if (!Number.isInteger(contextWindow) || contextWindow <= 0) {
      showToast('上下文上限须为正整数');
      return;
    }
    setSaving(true);
    try {
      const sampling =
        paramsEmpty(params) || !params
          ? {enabled: false as const}
          : {enabled: true as const, params};
      await runtime.providerModels.updateSettings(providerId, vendorModelId, {
        contextWindowTokens: contextWindow,
        sampling,
        tokenCounterMode,
        thinking: {enabled: thinkingEnabled},
      });
      showToast('已保存模型设置');
      navigation.goBack();
    } catch (error) {
      showToast(toastMessage('保存失败', error));
    } finally {
      setSaving(false);
    }
  };

  const handleResetSamplingDefaults = async () => {
    if (!applicationModelId) {
      return;
    }
    const {providerId, vendorModelId} =
      parseApplicationModelId(applicationModelId);
    setResetting(true);
    try {
      const updated = await runtime.providerModels.resetContextWindowToDefault(
        providerId,
        vendorModelId,
      );
      await runtime.providerModels.updateSettings(providerId, vendorModelId, {
        sampling: {enabled: false},
      });
      setContextWindowTokens(
        String(savedModelContextWindowTokens(updated.settings)),
      );
      setParams(undefined);
      showToast('已恢复默认采样参数');
    } catch (error) {
      showToast(toastMessage('恢复失败', error));
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return <ActivityIndicator style={{marginTop: 32}} />;
  }

  const sectionHint = modelSubtitle
    ? `${modelSubtitle}\n\n展示协议推荐默认值；保存后以本页为准。`
    : '展示协议推荐默认值；保存后以本页为准。';

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
        title="内部预算"
        tokens={tokens}
        hint="上下文窗口与 token 计数方式，不直接映射 HTTP 生成 body。">
        <FormField label="上下文上限 (tokens)" tokens={tokens}>
          <FormTextInput
            tokens={tokens}
            value={contextWindowTokens}
            onChangeText={setContextWindowTokens}
            keyboardType="number-pad"
          />
        </FormField>
        <FormField
          label="计数方式"
          tokens={tokens}
          hint="自动按模型名匹配分词器族；保存后以本页为准。">
          <FormSelectField
            tokens={tokens}
            value={tokenCounterMode}
            onChange={v => setTokenCounterMode(v as TokenizerOverride)}
            options={TOKEN_COUNTER_MODE_SELECT_OPTIONS}
            sheetTitle="Token 计数器"
            placeholder="auto"
          />
        </FormField>
      </FormSectionCard>

      <FormSectionCard
        title="生成参数"
        tokens={tokens}
        hint={sectionHint}
        rightAction={
          <Pressable
            disabled={resetting}
            style={[styles.resetLink, resetting ? styles.resetDisabled : null]}
            onPress={() =>
              handleResetSamplingDefaults().catch(() => undefined)
            }>
            <Text style={[styles.resetLinkText, {color: tokens.primary}]}>
              {resetting ? '恢复中…' : '恢复默认'}
            </Text>
          </Pressable>
        }>
        <SamplingForm
          tokens={tokens}
          protocol={protocol}
          params={params}
          onChange={setParams}
        />
        <FormSwitchRow
          label="思考"
          tokens={tokens}
          value={thinkingEnabled}
          onValueChange={setThinkingEnabled}
        />
      </FormSectionCard>
    </ScreenFormLayout>
  );
}

const styles = StyleSheet.create({
  resetLink: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  resetDisabled: {
    opacity: 0.5,
  },
  resetLinkText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
