/**
 * Per-model sampling profile CRUD (modelSamplingProfiles KKV).
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {LlmProtocolKind, ModelSamplingParams} from '@novel-master/core';
import {
  mergeSamplingWithDefaults,
  parseApplicationModelId,
} from '@novel-master/core';
import {FormSectionCard} from '../../components/form/FormSectionCard';
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
  const [modelSubtitle, setModelSubtitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
      const profile =
        await runtime.modelSamplingProfiles.getProfile(applicationModelId);
      const stored =
        profile?.enabled && profile.params != null ? profile.params : undefined;
      setParams(mergeSamplingWithDefaults(provider.protocol, stored));
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
    setSaving(true);
    try {
      if (paramsEmpty(params)) {
        await runtime.modelSamplingProfiles.clearProfile(applicationModelId);
      } else if (params) {
        await runtime.modelSamplingProfiles.setProfile(applicationModelId, {
          schemaVersion: 1,
          enabled: true,
          params,
        });
      }
      showToast('已保存采样配置');
      navigation.goBack();
    } catch (error) {
      showToast(toastMessage('保存失败', error));
    } finally {
      setSaving(false);
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
      <FormSectionCard title="采样参数" tokens={tokens} hint={sectionHint}>
        <SamplingForm
          tokens={tokens}
          protocol={protocol}
          params={params}
          onChange={setParams}
        />
      </FormSectionCard>
    </ScreenFormLayout>
  );
}
