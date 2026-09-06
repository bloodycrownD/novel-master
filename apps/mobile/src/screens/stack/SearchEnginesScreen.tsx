/**
 * AI 搜索引擎配置页：四引擎凭证卡片 + 默认引擎选择。
 *
 * 读写经 `runtime.searchConfig`（core `createSearchConfigStore` 装配）：
 * bocha / tavily / brave 填 API key（留空 = 保留已存密钥），searxng 填
 * 自托管实例 baseUrl（留空保存即清除）；对外状态只显 configured 标签，
 * 不回显 key 明文。表单校验仅非空 / URL 形状，无连通性测试。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import type {EngineId, KeyEngineId} from '@novel-master/core';
import {ApiKeyStatusTag} from '@/components/provider/ApiKeyStatusTag';
import {
  FormChipGroup,
  type ChipOption,
} from '@/components/form/FormChipGroup';
import {FormField} from '@/components/form/FormField';
import {FormSectionCard} from '@/components/form/FormSectionCard';
import {FormTextInput} from '@/components/form/FormTextInput';
import {ScreenFormLayout} from '@/components/form/ScreenFormLayout';
import {StickyFormFooter} from '@/components/form/StickyFormFooter';
import {SecondaryButton} from '@/components/ui/Buttons';
import {useRuntime} from '@/hooks/useRuntime';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {toastMessage} from '@/errors/toast-message';
import {
  getSearchConfigStore,
  SEARCH_KEY_ENGINE_IDS,
} from '@/services/search-config.store';

/** 引擎显示名（卡片标题 / chip 共用）。 */
const ENGINE_LABELS: Record<EngineId, string> = {
  bocha: 'Bocha',
  tavily: 'Tavily',
  brave: 'Brave',
  searxng: 'SearXNG',
};

/** key 引擎卡片副标题（申请入口口径）。 */
const ENGINE_HINTS: Record<KeyEngineId, string> = {
  bocha: '博查搜索 API，按量计费',
  tavily: 'Tavily Search API',
  brave: 'Brave Search API',
};

/** 默认引擎 chip 的「自动」哨兵值：保存时映射为 setDefaultEngine(null)（解析链按顺序回落）。 */
const DEFAULT_ENGINE_AUTO = 'auto' as const;
type DefaultEngineChoice = typeof DEFAULT_ENGINE_AUTO | EngineId;

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

export function SearchEnginesScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** 正在清除 key 的引擎（互斥保存；null = 空闲）。 */
  const [clearingEngine, setClearingEngine] = useState<KeyEngineId | null>(
    null,
  );
  const [configured, setConfigured] = useState<Record<EngineId, boolean>>({
    bocha: false,
    tavily: false,
    brave: false,
    searxng: false,
  });
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<KeyEngineId, string>>(
    {bocha: '', tavily: '', brave: ''},
  );
  const [searxngBaseUrl, setSearxngBaseUrl] = useState('');
  const [defaultEngine, setDefaultEngine] = useState<DefaultEngineChoice>(
    DEFAULT_ENGINE_AUTO,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const config = await getSearchConfigStore(runtime).readConfig();
      setConfigured({
        bocha: config.engines.bocha.configured,
        tavily: config.engines.tavily.configured,
        brave: config.engines.brave.configured,
        searxng: config.engines.searxng.configured,
      });
      setSearxngBaseUrl(config.searxngBaseUrl);
      setDefaultEngine(config.defaultEngine ?? DEFAULT_ENGINE_AUTO);
      setApiKeyDrafts({bocha: '', tavily: '', brave: ''});
    } catch (error) {
      showToast(toastMessage('加载搜索配置失败', error));
    } finally {
      setLoading(false);
    }
  }, [runtime, showToast]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const patchDraft = (engineId: KeyEngineId, value: string) => {
    setApiKeyDrafts(prev => ({...prev, [engineId]: value}));
  };

  const handleSave = async () => {
    if (saving || clearingEngine != null) {
      return;
    }
    const baseUrl = searxngBaseUrl.trim();
    if (baseUrl.length > 0 && !isValidHttpBaseUrl(baseUrl)) {
      showToast('实例地址无效：仅支持 http/https，且不允许携带用户名密码');
      return;
    }
    setSaving(true);
    try {
      const store = getSearchConfigStore(runtime);
      // key 引擎留空 = 不改（密钥不回显，无 diff 可比）。
      for (const engineId of SEARCH_KEY_ENGINE_IDS) {
        const draft = apiKeyDrafts[engineId].trim();
        if (draft.length > 0) {
          await store.saveEngineKey(engineId, draft);
        }
      }
      // searxng baseUrl 非密钥字段直接回显编辑：空串 = 清除。
      await store.setSearxngBaseUrl(baseUrl);
      await store.setDefaultEngine(
        defaultEngine === DEFAULT_ENGINE_AUTO ? null : defaultEngine,
      );
      showToast('配置已保存');
      await load();
    } catch (error) {
      showToast(toastMessage('保存失败', error));
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async (engineId: KeyEngineId) => {
    if (saving || clearingEngine != null) {
      return;
    }
    setClearingEngine(engineId);
    try {
      await getSearchConfigStore(runtime).clearEngineKey(engineId);
      showToast(`已清除 ${ENGINE_LABELS[engineId]} API Key`);
      await load();
    } catch (error) {
      showToast(toastMessage('清除失败', error));
    } finally {
      setClearingEngine(null);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centered, {backgroundColor: tokens.background}]}>
        <ActivityIndicator color={tokens.primary} />
      </View>
    );
  }

  // 默认引擎候选：仅列 configured=true 引擎（与解析链同口径）；当前默认
  // 指向已清除凭证的引擎时保留该项展示（disabled），可改选其它或「自动」。
  const engineChoiceOptions: Array<ChipOption<DefaultEngineChoice>> = [
    {value: DEFAULT_ENGINE_AUTO, label: '自动'},
    ...(Object.keys(ENGINE_LABELS) as EngineId[])
      .filter(
        engineId => configured[engineId] || defaultEngine === engineId,
      )
      .map(engineId => ({
        value: engineId as DefaultEngineChoice,
        label: ENGINE_LABELS[engineId],
        disabled: !configured[engineId],
      })),
  ];

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
          disabled={clearingEngine != null}
        />
      }
    >
      {SEARCH_KEY_ENGINE_IDS.map(engineId => (
        <FormSectionCard
          key={engineId}
          tokens={tokens}
          title={ENGINE_LABELS[engineId]}
          hint={ENGINE_HINTS[engineId]}
          rightAction={
            <ApiKeyStatusTag
              status={configured[engineId] ? 'set' : 'not set'}
              tokens={tokens}
            />
          }
        >
          <FormField
            label="API Key"
            tokens={tokens}
            hint={
              configured[engineId] ? '已保存；留空则保留原密钥' : '保存时写入本机密钥库'
            }
          >
            <FormTextInput
              tokens={tokens}
              value={apiKeyDrafts[engineId]}
              onChangeText={text => patchDraft(engineId, text)}
              placeholder={configured[engineId] ? '留空保留已存密钥' : ''}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </FormField>
          {configured[engineId] ? (
            <SecondaryButton
              tokens={tokens}
              fullWidth
              label={
                clearingEngine === engineId ? '清除中…' : '清除已存密钥'
              }
              onPress={() => {
                handleClearKey(engineId).catch(() => undefined);
              }}
              disabled={saving || clearingEngine != null}
            />
          ) : null}
        </FormSectionCard>
      ))}

      <FormSectionCard
        tokens={tokens}
        title={ENGINE_LABELS.searxng}
        hint="自托管元搜索引擎实例，无需 API key"
        rightAction={
          <ApiKeyStatusTag
            status={configured.searxng ? 'set' : 'not set'}
            tokens={tokens}
          />
        }
      >
        <FormField
          label="实例地址 Base URL"
          tokens={tokens}
          hint="含 http(s)://，如 https://searxng.example.com；留空保存即清除"
        >
          <FormTextInput
            tokens={tokens}
            value={searxngBaseUrl}
            onChangeText={setSearxngBaseUrl}
            placeholder="https://searxng.example.com"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </FormField>
      </FormSectionCard>

      <FormSectionCard
        tokens={tokens}
        title="默认引擎"
        hint="search 工具未显式指定引擎时使用；「自动」按 Bocha → Tavily → Brave → SearXNG 顺序取第一个已配置引擎"
      >
        <FormField label="引擎" tokens={tokens}>
          <FormChipGroup
            tokens={tokens}
            options={engineChoiceOptions}
            value={defaultEngine}
            onChange={setDefaultEngine}
          />
        </FormField>
      </FormSectionCard>

      <Text style={[styles.note, {color: tokens.textTertiary}]}>
        API key 只保存在本机密钥库，不进入会话记录，也不会随云同步上传。
        未配置任何引擎时，search 工具将返回配置指引。
      </Text>
    </ScreenFormLayout>
  );
}

const styles = StyleSheet.create({
  centered: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  note: {fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 8},
});
