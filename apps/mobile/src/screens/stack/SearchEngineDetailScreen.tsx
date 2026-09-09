/**
 * 搜索引擎详情页（修订轮两级结构）：单引擎表单——key 引擎
 * （bocha/tavily/brave）密码框留空不改 + 清除入口；searxng 编辑自托管
 * 实例 baseUrl（空串保存即清除）。无默认引擎控件（优先级由列表屏排序）。
 *
 * 凭证安全口径与列表屏一致：只显 configured 标签，不回显 key 明文。
 * 表单校验仅非空 / URL 形状（含 userinfo 禁入），无连通性测试；保存
 * 失败 catch 内 toast 后回读（部分提交已生效时标签立即反映，与
 * desktop 93f534ea 口径对齐）。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {EngineId} from '@novel-master/core';
import {ApiKeyStatusTag} from '@/components/provider/ApiKeyStatusTag';
import {FormField} from '@/components/form/FormField';
import {FormSectionCard} from '@/components/form/FormSectionCard';
import {FormTextInput} from '@/components/form/FormTextInput';
import {ScreenFormLayout} from '@/components/form/ScreenFormLayout';
import {StickyFormFooter} from '@/components/form/StickyFormFooter';
import {SecondaryButton} from '@/components/ui/Buttons';
import {useRuntime} from '@/hooks/useRuntime';
import {useHeaderContext} from '@/navigation/HeaderContext';
import type {RootStackParamList} from '@/navigation/types';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {toastMessage} from '@/errors/toast-message';
import {
  getSearchConfigStore,
  readSearchEngineConfig,
} from '@/services/search-config.store';
import {ENGINE_HINTS, ENGINE_LABELS} from './SearchEnginesScreen';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type DetailRoute = RouteProp<RootStackParamList, 'SearchEngineDetail'>;

/** URL 形状预检：与 core normalizeSearxngBaseUrl 同规则（http/https、禁 userinfo）。 */
function isValidHttpBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** route 参数防御：类型系统之外（深链/外部 navigate）可能拿到任意值。 */
function isKnownEngineId(value: unknown): value is EngineId {
  return typeof value === 'string' && value in ENGINE_LABELS;
}

export function SearchEngineDetailScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  const {setStackOverride} = useHeaderContext();

  const engineId = route.params?.engineId;
  const knownEngine = isKnownEngineId(engineId);
  const isSearxng = knownEngine && engineId === 'searxng';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** 正在清除 key（互斥保存；仅 key 引擎）。 */
  const [clearing, setClearing] = useState(false);
  const [configured, setConfigured] = useState(false);
  /** key 引擎草稿（留空 = 不改已存密钥；回读后清空）。 */
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  /** searxng baseUrl 草稿（非密钥字段直接回显编辑；空串保存即清除）。 */
  const [baseUrlDraft, setBaseUrlDraft] = useState('');

  // 详情页标题用引擎名（静态映射，无需等异步数据）。
  useFocusEffect(
    useCallback(() => {
      setStackOverride(
        knownEngine ? {title: ENGINE_LABELS[engineId]} : undefined,
      );
      return () => setStackOverride(undefined);
    }, [knownEngine, engineId, setStackOverride]),
  );

  const load = useCallback(async () => {
    if (!knownEngine) {
      return;
    }
    setLoading(true);
    try {
      const config = await readSearchEngineConfig(runtime);
      setConfigured(config.engines[engineId].configured);
      setBaseUrlDraft(config.searxngBaseUrl);
      setApiKeyDraft('');
    } catch (error) {
      showToast(toastMessage('加载搜索配置失败', error));
    } finally {
      setLoading(false);
    }
  }, [knownEngine, engineId, runtime, showToast]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  // 参数缺失/非法：提示后退回列表，不渲染表单。
  useEffect(() => {
    if (!knownEngine) {
      showToast('缺少引擎参数');
      navigation.goBack();
    }
  }, [knownEngine, navigation, showToast]);

  const handleSave = async () => {
    if (!knownEngine || saving || clearing) {
      return;
    }
    const store = getSearchConfigStore(runtime);
    setSaving(true);
    try {
      if (isSearxng) {
        const baseUrl = baseUrlDraft.trim();
        if (baseUrl.length > 0 && !isValidHttpBaseUrl(baseUrl)) {
          showToast('实例地址无效：仅支持 http/https，且不允许携带用户名密码');
          return;
        }
        await store.setSearxngBaseUrl(baseUrl);
      } else {
        // key 引擎留空 = 不改（密钥不回显，无 diff 可比）。
        const draft = apiKeyDraft.trim();
        if (draft.length > 0) {
          await store.saveEngineKey(engineId, draft);
        }
      }
      showToast('配置已保存');
      await load();
    } catch (error) {
      showToast(toastMessage('保存失败', error));
      // 回读让状态标签立即反映已生效部分（保存链路失败后状态与真值对齐的兜底口径）。
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    if (!knownEngine || isSearxng || saving || clearing) {
      return;
    }
    setClearing(true);
    try {
      await getSearchConfigStore(runtime).clearEngineKey(engineId);
      showToast(`已清除 ${ENGINE_LABELS[engineId]} API Key`);
      await load();
    } catch (error) {
      showToast(toastMessage('清除失败', error));
    } finally {
      setClearing(false);
    }
  };

  if (!knownEngine) {
    return (
      <View style={[styles.centered, {backgroundColor: tokens.background}]} />
    );
  }

  if (loading) {
    return (
      <View style={[styles.centered, {backgroundColor: tokens.background}]}>
        <ActivityIndicator color={tokens.primary} />
      </View>
    );
  }

  return (
    <ScreenFormLayout
      tokens={tokens}
      footer={
        <StickyFormFooter
          tokens={tokens}
          label="保存配置"
          onPress={() => {
            handleSave().catch(() => undefined);
          }}
          loading={saving}
          disabled={clearing}
        />
      }
    >
      <FormSectionCard
        tokens={tokens}
        title={ENGINE_LABELS[engineId]}
        hint={ENGINE_HINTS[engineId]}
        rightAction={
          <ApiKeyStatusTag
            status={configured ? 'set' : 'not set'}
            tokens={tokens}
          />
        }
      >
        {isSearxng ? (
          <FormField
            label="实例地址 Base URL"
            tokens={tokens}
            hint="含 http(s)://，如 https://searxng.example.com；留空保存即清除"
          >
            <FormTextInput
              tokens={tokens}
              value={baseUrlDraft}
              onChangeText={setBaseUrlDraft}
              placeholder="https://searxng.example.com"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </FormField>
        ) : (
          <>
            <FormField
              label="API Key"
              tokens={tokens}
              hint={
                configured ? '已保存；留空则保留原密钥' : '保存时写入本机密钥库'
              }
            >
              <FormTextInput
                tokens={tokens}
                value={apiKeyDraft}
                onChangeText={setApiKeyDraft}
                placeholder={configured ? '留空保留已存密钥' : ''}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </FormField>
            {configured ? (
              <SecondaryButton
                tokens={tokens}
                fullWidth
                label={clearing ? '清除中…' : '清除已存密钥'}
                onPress={() => {
                  handleClearKey().catch(() => undefined);
                }}
                disabled={saving || clearing}
              />
            ) : null}
          </>
        )}
      </FormSectionCard>

      {isSearxng ? null : (
        <Text style={[styles.note, {color: tokens.textTertiary}]}>
          API key 只保存在本机密钥库，不进入会话记录，也不会随云同步上传。
        </Text>
      )}
    </ScreenFormLayout>
  );
}

const styles = StyleSheet.create({
  centered: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  note: {fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 8},
});
