/**
 * Per-model sampling profile CRUD (modelSamplingProfiles KKV).
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {LlmProtocolKind, ModelSamplingParams} from '@novel-master/core';
import {parseApplicationModelId} from '@novel-master/core';
import {SamplingForm} from '../../components/provider/SamplingForm';
import {useRuntime} from '../../hooks/useRuntime';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

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
  const runtime = useRuntime();
  const navigation = useNavigation();
  const route = useRoute<SamplingRoute>();
  const applicationModelId = route.params?.applicationModelId;

  const [protocol, setProtocol] = useState<LlmProtocolKind>('openai');
  const [params, setParams] = useState<ModelSamplingParams | undefined>();
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
      const profile =
        await runtime.modelSamplingProfiles.getProfile(applicationModelId);
      setParams(profile?.params);
    } catch (error) {
      Alert.alert(
        '加载失败',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setLoading(false);
    }
  }, [runtime, applicationModelId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (!applicationModelId) {
      Alert.alert('错误', '缺少 applicationModelId', [
        {text: '返回', onPress: () => navigation.goBack()},
      ]);
    }
  }, [applicationModelId, navigation]);

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
      Alert.alert('已保存采样配置');
      navigation.goBack();
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
          采样参数
        </Text>
        <Text style={[styles.idHint, {color: tokens.textSecondary}]}>
          {applicationModelId}
        </Text>
        <SamplingForm protocol={protocol} params={params} onChange={setParams} />
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
  scroll: {padding: 16, gap: 12},
  sectionTitle: {fontSize: 18, fontWeight: '600'},
  idHint: {fontSize: 13, marginBottom: 8},
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
