/**
 * 单模型设置：内部预算（上下文、计数）与生成参数（采样、思考）。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {type LlmProtocolKind} from '@novel-master/core/llm-protocol';
import {
  SavedModelSettings,
  THINKING_LEVEL_SELECT_OPTIONS,
  TOKEN_COUNTER_MODE_SELECT_OPTIONS,
  type ModelSamplingParams,
  type ThinkingLevel,
} from '@novel-master/core/provider';
import {type TokenizerOverride} from '@novel-master/core/tokenizer';
import {FormField} from '@/components/form/FormField';
import {FormSelectField} from '@/components/form/FormSelectField';
import {FormSectionCard} from '@/components/form/FormSectionCard';
import {FormTextInput} from '@/components/form/FormTextInput';
import {SegmentedControl} from '@/components/ui/SegmentedControl';
import {ScreenFormLayout} from '@/components/form/ScreenFormLayout';
import {StickyFormFooter} from '@/components/form/StickyFormFooter';
import {SamplingForm} from '@/components/provider/SamplingForm';
import {useRuntime} from '@/hooks/useRuntime';
import type {RootStackParamList} from '@/navigation/types';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {ToastMessage} from '@/errors/toast-message';
import {coreT} from '@/i18n/core';

type SamplingRoute = RouteProp<RootStackParamList, 'ModelSampling'>;

/** 生成参数区副标题：仅当 modelName 与 vendorModelId 不同时展示双行。 */
function buildModelSubtitle(modelName: string, vendorModelId: string): string {
  const name = modelName.trim();
  const vendor = vendorModelId.trim();
  if (!name) {
    return '';
  }
  if (!vendor || name === vendor) {
    return '';
  }
  return `${name}\n${vendor}`;
}

export function ModelSamplingScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation();
  const route = useRoute<SamplingRoute>();
  const savedModelId = route.params?.savedModelId;

  const [protocol, setProtocol] = useState<LlmProtocolKind>('openai');
  const [params, setParams] = useState<ModelSamplingParams | undefined>();
  const [contextWindowTokens, setContextWindowTokens] = useState('');
  const [tokenCounterMode, setTokenCounterMode] = useState<TokenizerOverride>('auto');
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('off');
  const [modelName, setModelName] = useState('');
  const [vendorModelId, setVendorModelId] = useState('');
  const [initialModelName, setInitialModelName] = useState('');
  const [modelSubtitle, setModelSubtitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    if (!savedModelId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const got = await runtime.providerModels.getSavedById(savedModelId);
      if (!got.ok) throw got.error;
      const saved = got.value;
      if (saved == null) {
        showToast(ToastMessage.toast(coreT({key: "ui.common.load_failed"}), coreT({key: "ui.sampling.model_missing"})));
        return;
      }
      const gotProvider = await runtime.providers.get(saved.providerId);
      if (!gotProvider.ok) throw gotProvider.error;
      const provider = gotProvider.value;
      setProtocol(provider.protocol);
      setModelName(saved.modelName);
      setInitialModelName(saved.modelName);
      setVendorModelId(saved.vendorModelId);
      setModelSubtitle(buildModelSubtitle(saved.modelName, saved.vendorModelId));
      setContextWindowTokens(String(SavedModelSettings.contextWindowTokens(saved.settings)));
      setTokenCounterMode(SavedModelSettings.tokenCounterMode(saved.settings));
      const sampling = SavedModelSettings.sampling(saved.settings);
      const stored = sampling.enabled && sampling.params != null ? sampling.params : undefined;
      setParams(stored);
      setThinkingLevel(SavedModelSettings.thinkingLevel(saved.settings));
    } catch (error) {
      showToast(ToastMessage.toast(coreT({key: "ui.common.load_failed"}), error));
    } finally {
      setLoading(false);
    }
  }, [runtime, savedModelId, showToast]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (!savedModelId) {
      showToast(ToastMessage.toast(coreT({key: "ui.common.error"}), coreT({key: "ui.sampling.saved_model_id_missing"})));
      navigation.goBack();
    }
  }, [savedModelId, navigation, showToast]);

  const handleSave = async () => {
    if (!savedModelId) {
      return;
    }
    const trimmedName = modelName.trim();
    if (!trimmedName) {
      showToast(coreT({key: "ui.sampling.name_required"}));
      return;
    }
    const contextWindow = Number(contextWindowTokens);
    if (!Number.isInteger(contextWindow) || contextWindow <= 0) {
      showToast(coreT({key: "ui.sampling.context_limit_positive"}));
      return;
    }
    setSaving(true);
    try {
      if (trimmedName !== initialModelName.trim()) {
        const updated = await runtime.providerModels.editSaved(savedModelId, trimmedName);
        if (!updated.ok) throw updated.error;
        setInitialModelName(updated.value.modelName);
        setModelName(updated.value.modelName);
        setModelSubtitle(buildModelSubtitle(updated.value.modelName, updated.value.vendorModelId));
      }
      let paramsAreEmpty = true;
      if (params != null) {
        if (params.protocol === 'openai') paramsAreEmpty = Object.keys(params.openai).length === 0;
        else if (params.protocol === 'anthropic') paramsAreEmpty = Object.keys(params.anthropic).length === 0;
        else if (params.protocol === 'gemini') paramsAreEmpty = Object.keys(params.gemini).length === 0;
      }
      const sampling = paramsAreEmpty ? {enabled: false as const} : {enabled: true as const, params};
      const settingsPatch = {contextWindowTokens: contextWindow, sampling, tokenCounterMode, thinkingLevel};
      const stored = await runtime.providerModels.updateSettings(savedModelId, settingsPatch);
      if (!stored.ok) throw stored.error;
      showToast('已保存模型设置');
      navigation.goBack();
    } catch (error) {
      showToast(ToastMessage.toast(coreT({key: "ui.common.save_failed"}), error));
    } finally {
      setSaving(false);
    }
  };

  const handleResetSamplingDefaults = async () => {
    if (!savedModelId) {
      return;
    }
    setResetting(true);
    try {
      const updated = await runtime.providerModels.resetContextWindowToDefault(savedModelId);
      if (!updated.ok) throw updated.error;
      const cleared = await runtime.providerModels.updateSettings(savedModelId, {sampling: {enabled: false}});
      if (!cleared.ok) throw cleared.error;
      setContextWindowTokens(String(SavedModelSettings.contextWindowTokens(updated.value.settings)));
      setParams(undefined);
      showToast('已恢复默认采样参数');
    } catch (error) {
      showToast(ToastMessage.toast(coreT({key: "ui.common.restore_failed"}), error));
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return <ActivityIndicator style={{marginTop: 32}} />;
  }

  const sectionHint = modelSubtitle ? `${modelSubtitle}\n\n${coreT({key: "ui.sampling.section_hint_plain"})}` : coreT({key: "ui.sampling.section_hint_plain"});

  return (
    <ScreenFormLayout tokens={tokens} footer={<StickyFormFooter tokens={tokens} label={coreT({key: "ui.common.save"})} loading={saving} onPress={() => handleSave().catch(() => undefined)} />}>
      <FormSectionCard title={coreT({key: "ui.common.model"})} tokens={tokens}>
        <FormField label={coreT({key: "ui.common.model_name"})} tokens={tokens}>
          <FormTextInput tokens={tokens} value={modelName} onChangeText={setModelName} placeholder={coreT({key: "ui.common.model_name"})} />
        </FormField>
        {vendorModelId ? <Text style={[styles.vendorHint, {color: tokens.textSecondary}]}>{coreT({key: "ui.sampling.vendor_id_line", params: {id: vendorModelId}})}</Text> : null}
      </FormSectionCard>

      <FormSectionCard title={coreT({key: "ui.sampling.internal_budget_section"})} tokens={tokens} hint={coreT({key: "ui.sampling.internal_budget_hint"})}>
        <FormField label={coreT({key: "ui.sampling.context_limit_label"})} tokens={tokens}>
          <FormTextInput tokens={tokens} value={contextWindowTokens} onChangeText={setContextWindowTokens} keyboardType="number-pad" />
        </FormField>
        <FormField label={coreT({key: "ui.sampling.counting_method_label"})} tokens={tokens} hint={coreT({key: "ui.sampling.counter_autos_hint"})}>
          <FormSelectField
            tokens={tokens}
            value={tokenCounterMode}
            onChange={v => setTokenCounterMode(v as TokenizerOverride)}
            options={TOKEN_COUNTER_MODE_SELECT_OPTIONS.map(o => ({...o, label: coreT(o.label)}))}
            sheetTitle={coreT({key: "ui.sampling.token_counter_label"})}
            placeholder="auto"
          />
        </FormField>
      </FormSectionCard>

      <FormSectionCard
        title={coreT({key: "ui.sampling.generation_section"})}
        tokens={tokens}
        hint={sectionHint}
        rightAction={
          <Pressable disabled={resetting} style={[styles.resetLink, resetting ? styles.resetDisabled : null]} onPress={() => handleResetSamplingDefaults().catch(() => undefined)}>
            <Text style={[styles.resetLinkText, {color: tokens.primary}]}>{resetting ? coreT({key: "ui.common.restoring"}) : coreT({key: "ui.common.reset_default"})}</Text>
          </Pressable>
        }
      >
        <SamplingForm tokens={tokens} protocol={protocol} params={params} onChange={setParams} />
        <FormField label={coreT({key: "ui.sampling.thinking_effort_label"})} tokens={tokens}>
          <SegmentedControl tokens={tokens} value={thinkingLevel} options={THINKING_LEVEL_SELECT_OPTIONS.map(o => ({...o, label: coreT(o.label)}))} onChange={setThinkingLevel} />
        </FormField>
      </FormSectionCard>
    </ScreenFormLayout>
  );
}

const styles = StyleSheet.create({
  vendorHint: {
    fontSize: 13,
    marginTop: 4,
  },
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
