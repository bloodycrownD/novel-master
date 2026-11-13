/**
 * 搜索引擎详情页（两级结构第二级）：按引擎类别三分支 + create 模式。
 *
 * - duckduckgo：内置代码引擎，只读说明卡（无凭据可配）；
 * - 预置引擎：API Key（模板需 `{{apiKey}}` 时）/ baseUrl（模板需 `{{baseUrl}}`
 *   时）+ 模板表单。名称与方法为内置元数据、只读；端点 / 参数说明可改；
 * - 自定义实例：凭据 + baseUrl + 模板表单 + 删除；
 * - create 模式（无 route 参数）：凭据 + 全量模板表单。
 *
 * 模板表单照 FormField/FormTextInput 骨架（v2 透传口径：响应侧零映射配置，
 * 字段止于 paramHint；请求头不出现在表单里，保存时按「认证方式 + 请求头名称」
 * 重建认证头、出厂非认证头原样保留），保存前统一走 core 的
 * `validateSearchEngineTemplate`。保存/清除/恢复默认的回读
 * 走静默分支（不闪全屏 loading）。已知 id 判定查 `readConfig()` 动态清单
 * （预置 ∪ DDG ∪ 自定义实例）。凭证安全口径同列表页：只显配置状态标签，
 * 不回显 key 明文。
 */
import {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {validateSearchEngineTemplate, type SearchConfigPublic, type SearchEngineTemplate} from '@novel-master/core';
import {BuiltinTag} from '@/components/provider/BuiltinTag';
import {FormChipGroup, type ChipOption} from '@/components/form/FormChipGroup';
import {FormField} from '@/components/form/FormField';
import {FormSectionCard} from '@/components/form/FormSectionCard';
import {FormSelectField} from '@/components/form/FormSelectField';
import {FormTextInput} from '@/components/form/FormTextInput';
import {ScreenFormLayout} from '@/components/form/ScreenFormLayout';
import {StickyFormFooter} from '@/components/form/StickyFormFooter';
import {SecondaryButton} from '@/components/ui/Buttons';
import {ModalShell} from '@/components/ui/ModalShell';
import {useRuntime} from '@/hooks/useRuntime';
import {useStackOverrideSetter} from '@/navigation/HeaderContext';
import type {RootStackParamList} from '@/navigation/types';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {setPromptEditorOnSaved} from '@/components/agent/prompt-editor-callback';
import {toastMessage} from '@/errors/toast-message';
import {coreT} from '@/i18n/core';
import {settingsTranslator} from '@/i18n/settings';
import {getSearchConfigStore} from '@/services/search-config.store';
import {ENGINE_HINTS, ENGINE_LABELS, PRESET_TEMPLATES, engineTitle} from './search-engine-meta';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type DetailRoute = RouteProp<RootStackParamList, 'SearchEngineDetail'>;

/** 模板表单草稿：提交前再解析/校验（headers 由认证方式 + 出厂非认证头底座重建）。 */
interface TemplateDraft {
  name: string;
  method: 'GET' | 'POST';
  url: string;
  /** 非认证头底座（Content-Type / Accept 等出厂头），UI 不直接编辑。 */
  headers: Record<string, string>;
  /** 认证方式（保存时重建认证头，非认证头原样保留）。 */
  authStyle: AuthStyle;
  /** 自定义请求头名称（authStyle === 'header' 时生效）。 */
  authHeaderName: string;
  paramHint: string;
}

/** 认证方式：Bearer / 自定义请求头 / 无认证。 */
type AuthStyle = 'bearer' | 'header' | 'none';

// FIX-25：create 模式预填基线与 desktop EMPTY_FORM 对齐（POST + JSON 内容头），
// 首次保存只需补显示名与请求 URL。
const PREFILL_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

const EMPTY_DRAFT: TemplateDraft = {
  name: '',
  method: 'POST',
  url: '',
  headers: {...PREFILL_HEADERS},
  authStyle: 'bearer',
  authHeaderName: '',
  paramHint: '',
};

const METHOD_OPTIONS: ReadonlyArray<ChipOption<'GET' | 'POST'>> = [
  {value: 'GET', label: 'GET'},
  {value: 'POST', label: 'POST'},
];

/** 预置覆盖按差异提交时比较的模板字段（v3 起 UI 无请求体字段，defaultBody 不参与判定）。 */
const TEMPLATE_FIELDS: readonly (keyof SearchEngineTemplate)[] = ['name', 'method', 'url', 'headers', 'paramHint'];

/** 认证方式下拉选项（照智能体配置 FormSelectField 的形态）。 */
const AUTH_STYLE_OPTIONS: ReadonlyArray<{value: AuthStyle; label: string}> = [
  {value: 'bearer', label: 'Authorization: Bearer'},
  {value: 'header', label: settingsTranslator({key: 'settings.search.auth.style.custom_header.mobile'})},
  {value: 'none', label: settingsTranslator({key: 'settings.search.auth.style.none.mobile'})},
];

/** 在途写操作（互斥：同刻只允许一个；null = 空闲）。 */
type WriteOp = 'save' | 'clear' | 'reset' | 'delete';

const WRITE_FAIL_MESSAGES: Record<WriteOp, string> = {
  save: settingsTranslator({key: 'settings.search.toast.save_failed.mobile'}),
  clear: settingsTranslator({key: 'settings.search.toast.clear_failed.mobile'}),
  reset: settingsTranslator({key: 'settings.search.toast.reset_failed.mobile'}),
  delete: settingsTranslator({key: 'settings.search.toast.delete_failed.mobile'}),
};

export function SearchEngineDetailScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const searchStore = getSearchConfigStore(runtime);
  const navigation = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  // 屏级 override：自动带 ownerRouteKey，转场期间不泄漏到相邻屏 header。
  const setStackOverride = useStackOverrideSetter();

  /** undefined = create 模式（新建自定义引擎），区别于「参数缺失」的非法路径。 */
  const engineId = route.params?.engineId;

  const [config, setConfig] = useState<SearchConfigPublic | null>(null);
  const [loading, setLoading] = useState(true);
  /** 在途写操作（保存/清除/恢复默认/删除互斥；null = 空闲）。 */
  const [writeOp, setWriteOp] = useState<WriteOp | null>(null);
  /** 删除确认弹窗开关。 */
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_DRAFT);
  /** key 草稿（留空 = 不改已存密钥；回读后清空）。 */
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  /** baseUrl 草稿（非密钥字段直接回显编辑；空串保存即清除）。 */
  const [baseUrlDraft, setBaseUrlDraft] = useState('');

  const entry = config?.engines.find(item => item.id === engineId);
  const isCreate = engineId == null;
  const isCustom = entry?.isCustom === true;
  let title = settingsTranslator({key: 'settings.search.list.create_custom'});
  if (engineId != null) {
    // FIX-23：读模型 name 优先（拍板 5），静态表仅未加载 / 未知 id 兜底。
    title = engineTitle(engineId, entry?.name);
  }
  // prettier-ignore
  const draftNeedsBaseUrl = draft.url.includes('{{baseUrl}}') || Object.values(draft.headers).some(value => value.includes('{{baseUrl}}'));
  const draftNeedsKey = draft.authStyle !== 'none';

  // 详情页标题用引擎名（自定义实例回落到配置读模型 name）。
  const syncHeader = useCallback(() => {
    setStackOverride({title});
    return () => setStackOverride(undefined);
  }, [setStackOverride, title]);
  useFocusEffect(syncHeader);

  // 参数说明全屏编辑（照智能体配置的 PromptEditor 机制：保存才回填，取消不动）。
  // 必须与其他 hook 同层（在 loading 早退之前），否则 hook 数量变化会报错。
  const openParamHintEditor = useCallback(() => {
    setPromptEditorOnSaved((text: string) => setDraft(current => ({...current, paramHint: text})));
    navigation.push('PromptEditor', {
      title: settingsTranslator({key: 'settings.search.params.title.mobile'}),
      initialText: draft.paramHint,
    });
  }, [draft.paramHint, navigation]);

  /**
   * FIX-24：首屏加载置 loading（全屏骨架），写操作回读走 `silent`（不闪屏、
   * 不抢焦点；失败只静默放弃回读——写操作自身已 toast 过失败原因），照列表屏
   * `reload({silent})` 先例。
   */
  const load = useCallback(
    async (options?: {silent?: boolean}) => {
      const silent = options?.silent === true;
      if (!silent) {
        setLoading(true);
      }
      try {
        const nextConfig = await searchStore.readConfig();
        setConfig(nextConfig);
        const {engines, customEngines} = nextConfig;
        const engine = engines.find(item => item.id === engineId);
        if (engineId != null && engine == null) {
          return;
        }
        const custom = customEngines.find(def => def.id === engineId);
        let template: SearchEngineTemplate | undefined;
        if (engine?.isCustom === true) {
          template = custom?.template;
        } else if (engine != null && engineId != null) {
          template = PRESET_TEMPLATES[engineId];
        }
        if (template == null) {
          setDraft(EMPTY_DRAFT);
        } else {
          // 从出厂 headers 反推认证方式（含 {{apiKey}} 的键视为认证头，供表单回显）。
          let authStyle: AuthStyle = 'none';
          let authHeaderName = '';
          const headerEntries = Object.entries(template.headers);
          for (const [headerName, headerValue] of headerEntries) {
            if (!headerValue.includes('{{apiKey}}')) {
              continue;
            }
            if (headerName.toLowerCase() === 'authorization') {
              authStyle = 'bearer';
            } else {
              authStyle = 'header';
              authHeaderName = headerName;
            }
            break;
          }
          setDraft({
            name: template.name,
            method: template.method,
            url: template.url,
            headers: {...template.headers},
            authStyle,
            authHeaderName,
            paramHint: template.paramHint,
          });
        }
        setBaseUrlDraft(engine?.baseUrl ?? '');
        setApiKeyDraft('');
      } catch (cause) {
        if (!silent) {
          showToast(toastMessage(settingsTranslator({key: 'settings.search.toast.load_failed.mobile'}), cause));
        }
      } finally {
        setLoading(false);
      }
    },
    [engineId, searchStore, showToast],
  );

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  // route 参数防御：动态清单里没有该 id（深链 / 已删除实例）→ 提示后退回列表。
  // 与 load 分开：navigation 对象在测试 mock 里每次渲染换引用，放进 load 依赖会自激重载。
  useEffect(() => {
    if (engineId != null && config != null && entry == null) {
      showToast(settingsTranslator({key: 'settings.search.toast.engine_not_found.mobile', params: {name: engineId}}));
      navigation.goBack();
    }
  }, [config, engineId, entry, navigation, showToast]);

  // nm-style: keep-local — 保存分流 create/自定义/预置三分支，共享 writeOp 互斥态、
  // key/baseUrl 草稿与失败回读；内联进 footer 按钮会拆散互斥与回读状态机
  const handleSave = async () => {
    if (writeOp != null) {
      return;
    }
    // 草稿 → 校验通过的模板：先取出厂非认证头底座，再按「认证方式 + 请求头名称」
    // 重建认证头（旧认证头一律清掉），校验失败时 toast 并中止。
    const baseHeaders: Record<string, string> = {...draft.headers};
    for (const name of Object.keys(baseHeaders)) {
      if (baseHeaders[name]!.includes('{{apiKey}}')) {
        delete baseHeaders[name];
      }
    }
    const authName = draft.authHeaderName.trim();
    if (draft.authStyle === 'bearer') {
      baseHeaders['Authorization'] = 'Bearer {{apiKey}}';
    } else if (draft.authStyle === 'header' && authName.length > 0) {
      baseHeaders[authName] = '{{apiKey}}';
    }
    const validated = validateSearchEngineTemplate({
      name: draft.name,
      method: draft.method,
      url: draft.url,
      headers: baseHeaders,
      paramHint: draft.paramHint,
    });
    if (!validated.ok) {
      const err = validated.error;
      const invalidKey = err.messageKey == null;
      const params = invalidKey ? {reason: err.message} : err.messageParams;
      // prettier-ignore
      const key = invalidKey ? 'error.tool.search_template_invalid' : err.messageKey;
      showToast(coreT({key, params}));
      return;
    }
    const template = validated.value;
    const keyDraft = apiKeyDraft.trim();
    const baseUrl = baseUrlDraft.trim();
    setWriteOp('save');
    try {
      if (engineId == null) {
        // 本地实例 id：8 位 base36 随机串（core 校验 `custom:{8}` 形态并拒绝重复）。
        const rand = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
        const id = `custom:${rand}`;
        await searchStore.createCustomEngine({
          def: {
            id,
            name: template.name,
            template,
            createdAt: new Date().toISOString(),
          },
          ...(keyDraft.length > 0 ? {apiKey: keyDraft} : {}),
          ...(draftNeedsBaseUrl && baseUrl.length > 0 ? {baseUrl} : {}),
        });
        showToast(settingsTranslator({key: 'settings.search.toast.custom_engine_created.mobile'}));
        navigation.goBack();
        return;
      }
      if (entry?.isCustom === true) {
        await searchStore.updateCustomEngine(engineId, {
          template,
          ...(keyDraft.length > 0 ? {apiKey: keyDraft} : {}),
          ...(draftNeedsBaseUrl ? {baseUrl} : {}),
        });
      } else {
        if (draftNeedsKey && keyDraft.length === 0 && entry?.hasKey !== true) {
          showToast(settingsTranslator({key: 'settings.search.validation.api_key_required'}));
          return;
        }
        // 预置覆盖按差异提交：只写入与出厂模板不同的字段，未改字段保留既有覆盖
        // （高级编辑显示出厂模板，见卡片提示；与 desktop 同一语义）。
        const preset = PRESET_TEMPLATES[engineId];
        const patch: Partial<SearchEngineTemplate> = {};
        if (preset != null) {
          // headers 重建会改键序：按键值对排序后序列化比较（乱序不算差异）。
          const presetEntries = Object.entries(preset.headers).sort();
          const draftEntries = Object.entries(template.headers).sort();
          const presetHeaders = JSON.stringify(presetEntries);
          const draftHeaders = JSON.stringify(draftEntries);
          const headersSame = presetHeaders === draftHeaders;
          for (const field of TEMPLATE_FIELDS) {
            const a = JSON.stringify(preset[field]);
            const b = JSON.stringify(template[field]);
            const same = field === 'headers' ? headersSame : a === b;
            if (!same) {
              Object.assign(patch, {[field]: template[field]});
            }
          }
        }
        // ui/P2-8 对齐 desktop：baseUrl 仅在草稿与已存值不同时提交（空串 =
        // 清除，同值不写）；零写操作（patch 空 + key 草稿空 + baseUrl 同值）→
        // toast「无改动」早退，不发任何写调用也不回读（desktop 同款判定）。
        const storedBaseUrl = entry?.baseUrl ?? '';
        const baseUrlChanged = draftNeedsBaseUrl && baseUrl !== storedBaseUrl;
        if (Object.keys(patch).length === 0 && keyDraft.length === 0 && !baseUrlChanged) {
          showToast(settingsTranslator({key: 'settings.search.toast.no_changes'}));
          return;
        }
        if (Object.keys(patch).length > 0) {
          await searchStore.updatePresetOverride(engineId, patch);
        }
        if (keyDraft.length > 0) {
          await searchStore.saveEngineKey(engineId, keyDraft);
        }
        if (baseUrlChanged) {
          await searchStore.setEngineBaseUrl(engineId, baseUrl);
        }
      }
      showToast(settingsTranslator({key: 'settings.search.toast.config_saved.mobile'}));
      await load({silent: true});
    } catch (cause) {
      showToast(toastMessage(settingsTranslator({key: 'settings.search.toast.save_failed.mobile'}), cause));
      // 回读让状态标签立即反映已生效部分（与列表页同一兜底口径）；静默回读
      // 不闪全屏 loading（FIX-24），失败时保存失败的 toast 已在，不再叠加。
      await load({silent: true});
    } finally {
      setWriteOp(null);
    }
  };

  /** 短写操作互斥模板：任一写操作在途即忽略；失败 toast 按操作映射，复位交 finally。 */
  const runWrite = async (op: WriteOp, go: (id: string) => Promise<void>) => {
    if (engineId == null || writeOp != null) {
      return;
    }
    setWriteOp(op);
    try {
      await go(engineId);
    } catch (cause) {
      showToast(toastMessage(WRITE_FAIL_MESSAGES[op], cause));
    } finally {
      setWriteOp(null);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centered, {backgroundColor: tokens.background}]}>
        <ActivityIndicator color={tokens.primary} />
      </View>
    );
  }

  // 已删除/脏参数退场中：不渲染表单（load 内已提示并 goBack）。
  if (engineId != null && entry == null) {
    return <View style={[styles.centered, {backgroundColor: tokens.background}]} />;
  }

  // 内置代码引擎：只读说明卡，无输入框、无保存 footer。
  if (engineId === 'duckduckgo') {
    return (
      <ScreenFormLayout tokens={tokens}>
        <FormSectionCard tokens={tokens} title={ENGINE_LABELS.duckduckgo} hint={ENGINE_HINTS.duckduckgo} rightAction={<BuiltinTag tokens={tokens} />}>
          <Text style={[styles.hintText, {color: tokens.textSecondary}]}>{settingsTranslator({key: 'settings.search.detail.builtin_body.mobile'})}</Text>
        </FormSectionCard>
      </ScreenFormLayout>
    );
  }

  const keyField = (
    <FormField
      label="API Key"
      tokens={tokens}
      hint={entry?.hasKey === true ? settingsTranslator({key: 'settings.search.auth.key_saved_hint.mobile'}) : settingsTranslator({key: 'settings.search.auth.key_store_hint.mobile'})}
    >
      <FormTextInput
        tokens={tokens}
        value={apiKeyDraft}
        onChangeText={setApiKeyDraft}
        placeholder={entry?.hasKey === true ? settingsTranslator({key: 'settings.search.auth.key_placeholder.mobile'}) : ''}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
    </FormField>
  );
  const baseUrlField = (
    <FormField label={settingsTranslator({key: 'settings.search.auth.base_url_label.mobile'})} tokens={tokens} hint={settingsTranslator({key: 'settings.search.auth.base_url_hint.mobile'})}>
      <FormTextInput tokens={tokens} value={baseUrlDraft} onChangeText={setBaseUrlDraft} placeholder="https://search.example.com" autoCapitalize="none" autoCorrect={false} />
    </FormField>
  );
  // 内置元数据只读；SearXNG 实例地址例外可编辑。
  const nameLocked = !isCreate && !isCustom;
  const urlLocked = nameLocked && engineId !== 'searxng';
  const patchDraft = (patch: Partial<TemplateDraft>) => setDraft(current => ({...current, ...patch}));
  // 模板表单（照智能体配置分区：连接 / 认证 / 参数说明；内置引擎名称与方法只读）。
  const templateCard = (
    <>
      <FormSectionCard title={settingsTranslator({key: 'settings.search.detail.connection_section.mobile'})} tokens={tokens}>
        <FormField
          label={settingsTranslator({key: 'settings.search.detail.name_label.mobile'})}
          tokens={tokens}
          hint={nameLocked ? settingsTranslator({key: 'settings.search.detail.name_locked_hint.mobile'}) : settingsTranslator({key: 'settings.search.detail.name_hint.mobile'})}
        >
          <FormTextInput
            tokens={tokens}
            value={draft.name}
            onChangeText={text => patchDraft({name: text})}
            placeholder={settingsTranslator({key: 'settings.search.detail.name_placeholder.mobile'})}
            autoCapitalize="none"
            autoCorrect={false}
            disabled={nameLocked}
          />
        </FormField>
        <FormField label={settingsTranslator({key: 'settings.search.detail.method_label.mobile'})} tokens={tokens}>
          <FormChipGroup tokens={tokens} options={METHOD_OPTIONS} value={draft.method} onChange={method => patchDraft({method})} disabled={nameLocked} />
        </FormField>
        <FormField
          label={settingsTranslator({key: 'settings.search.detail.url_label.mobile'})}
          tokens={tokens}
          hint={urlLocked ? settingsTranslator({key: 'settings.search.detail.url_locked_hint.mobile'}) : settingsTranslator({key: 'settings.search.detail.url_hint.mobile'})}
        >
          <FormTextInput
            tokens={tokens}
            value={draft.url}
            onChangeText={text => patchDraft({url: text})}
            placeholder="https://api.example.com/search"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            submitBehavior="blurAndSubmit"
            disabled={urlLocked}
            style={styles.urlInput}
          />
        </FormField>
        {draftNeedsBaseUrl ? baseUrlField : undefined}
      </FormSectionCard>
      <FormSectionCard title={settingsTranslator({key: 'settings.search.auth.section_title.mobile'})} tokens={tokens}>
        <FormField label={settingsTranslator({key: 'settings.search.auth.style_label.mobile'})} tokens={tokens} hint={settingsTranslator({key: 'settings.search.auth.style_hint.mobile'})}>
          <FormSelectField
            tokens={tokens}
            value={draft.authStyle}
            onChange={value => patchDraft({authStyle: value as AuthStyle})}
            options={AUTH_STYLE_OPTIONS.map(option => ({
              value: option.value,
              label: option.label,
            }))}
            sheetTitle={settingsTranslator({key: 'settings.search.auth.style_picker.mobile'})}
            placeholder={settingsTranslator({key: 'settings.search.auth.style_picker.mobile'})}
            disabled={nameLocked}
          />
        </FormField>
        {draft.authStyle === 'header' ? (
          <FormField
            label={settingsTranslator({key: 'settings.search.auth.header_name_label.mobile'})}
            tokens={tokens}
            hint={settingsTranslator({key: 'settings.search.auth.header_name_hint.mobile'})}
          >
            <FormTextInput
              tokens={tokens}
              value={draft.authHeaderName}
              onChangeText={text => patchDraft({authHeaderName: text})}
              placeholder="X-API-Key"
              autoCapitalize="none"
              autoCorrect={false}
              disabled={nameLocked}
            />
          </FormField>
        ) : null}
        {isCreate || isCustom || draftNeedsKey ? keyField : null}
        {isCreate || entry?.hasKey !== true ? null : (
          <SecondaryButton
            tokens={tokens}
            fullWidth
            label={writeOp === 'clear' ? settingsTranslator({key: 'settings.search.auth.clearing'}) : settingsTranslator({key: 'settings.search.auth.clear_key.mobile'})}
            onPress={() => {
              void runWrite('clear', async id => {
                await searchStore.clearEngineKey(id);
                showToast(settingsTranslator({key: 'settings.search.toast.key_cleared.mobile', params: {name: title}}));
                await load({silent: true});
              });
            }}
            disabled={writeOp != null}
          />
        )}
      </FormSectionCard>
      <FormSectionCard title={settingsTranslator({key: 'settings.search.params.title.mobile'})} tokens={tokens}>
        {/* 照智能体配置的 ExpandablePromptInput：label 行左侧文本、右侧 ⛶ 全屏编辑入口，
            输入框独占整行（不再被按钮挤出一列）。 */}
        <View style={styles.paramHintBlock}>
          <View style={styles.paramHintHeader}>
            <Text style={[styles.fieldLabel, {color: tokens.textSecondary}]}>
              {nameLocked ? settingsTranslator({key: 'settings.search.params.title_locked.mobile'}) : settingsTranslator({key: 'settings.search.params.title.mobile'})}
            </Text>
            {nameLocked ? null : (
              <Pressable onPress={openParamHintEditor} hitSlop={8} style={styles.expandBtn}>
                <Text style={{color: tokens.textSecondary, fontSize: 20}}>⛶</Text>
              </Pressable>
            )}
          </View>
          <Text style={[styles.fieldHint, {color: tokens.textTertiary}]}>
            {nameLocked ? settingsTranslator({key: 'settings.search.params.locked_hint.mobile'}) : settingsTranslator({key: 'settings.search.params.hint.mobile'})}
          </Text>
          <FormTextInput
            tokens={tokens}
            value={draft.paramHint}
            onChangeText={text => patchDraft({paramHint: text})}
            placeholder={settingsTranslator({key: 'settings.search.params.placeholder.mobile'})}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            disabled={nameLocked}
          />
        </View>
      </FormSectionCard>
    </>
  );
  return (
    <ScreenFormLayout
      tokens={tokens}
      footer={
        <StickyFormFooter
          tokens={tokens}
          label={isCreate ? settingsTranslator({key: 'settings.search.detail.create_action.mobile'}) : settingsTranslator({key: 'settings.search.detail.save_action.mobile'})}
          onPress={() => {
            handleSave().catch(() => undefined);
          }}
          loading={writeOp === 'save'}
          disabled={writeOp != null}
        />
      }
    >
      {isCreate || isCustom ? (
        templateCard
      ) : (
        <>
          {config?.presetOverrides[engineId] === true ? (
            <FormSectionCard
              tokens={tokens}
              title={settingsTranslator({key: 'settings.search.detail.override_section.mobile'})}
              hint={settingsTranslator({key: 'settings.search.detail.override_hint.mobile'})}
            >
              <SecondaryButton
                tokens={tokens}
                fullWidth
                label={settingsTranslator({key: 'settings.search.detail.reset_action.mobile'})}
                onPress={() => {
                  void runWrite('reset', async id => {
                    await searchStore.resetPresetOverride(id);
                    showToast(settingsTranslator({key: 'settings.search.toast.reset_done.mobile'}));
                    await load({silent: true});
                  });
                }}
                disabled={writeOp != null}
              />
            </FormSectionCard>
          ) : null}
          {templateCard}
        </>
      )}
      {isCustom ? (
        <FormSectionCard tokens={tokens} title={settingsTranslator({key: 'settings.search.detail.delete_section'})} hint={settingsTranslator({key: 'settings.search.detail.delete_hint.mobile'})}>
          <SecondaryButton
            tokens={tokens}
            fullWidth
            label={writeOp === 'delete' ? settingsTranslator({key: 'settings.search.list.deleting.mobile'}) : settingsTranslator({key: 'settings.search.detail.delete_action.mobile'})}
            onPress={() => setConfirmDelete(true)}
            disabled={writeOp != null}
          />
        </FormSectionCard>
      ) : null}
      {/* 删除确认：删除即清模板 / 密钥 / 排序项，二次确认。 */}
      <ModalShell visible={confirmDelete} onClose={() => setConfirmDelete(false)} variant="center" animationType="fade" panelStyle={styles.confirmPanel}>
        <Text style={[styles.confirmTitle, {color: tokens.text}]}>{settingsTranslator({key: 'settings.search.detail.delete_title'})}</Text>
        <Text style={[styles.confirmBody, {color: tokens.textSecondary}]}>{settingsTranslator({key: 'settings.search.detail.delete_notice.mobile', params: {name: title}})}</Text>
        <View style={styles.confirmActions}>
          <View style={styles.confirmAction}>
            <SecondaryButton
              tokens={tokens}
              fullWidth
              label={settingsTranslator({key: 'settings.search.list.cancel.mobile'})}
              onPress={() => setConfirmDelete(false)}
              disabled={writeOp === 'delete'}
            />
          </View>
          <View style={styles.confirmAction}>
            <SecondaryButton
              tokens={tokens}
              fullWidth
              label={writeOp === 'delete' ? settingsTranslator({key: 'settings.search.list.deleting.mobile'}) : settingsTranslator({key: 'settings.search.list.menu.delete'})}
              onPress={() => {
                void runWrite('delete', async id => {
                  await searchStore.deleteCustomEngine(id);
                  showToast(settingsTranslator({key: 'settings.search.toast.custom_engine_deleted.mobile'}));
                  setConfirmDelete(false);
                  navigation.goBack();
                });
              }}
              disabled={writeOp === 'delete'}
            />
          </View>
        </View>
      </ModalShell>
    </ScreenFormLayout>
  );
}

const styles = StyleSheet.create({
  centered: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  hintText: {fontSize: 14, lineHeight: 21},
  // textarea：起始与单行输入框同高（44），内容折行时随行数自动长高。
  urlInput: {minHeight: 44},
  // 参数说明：label 行（右侧 ⛶ 全屏编辑）+ hint + 整行输入框，与智能体配置同构。
  paramHintBlock: {gap: 6},
  paramHintHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldLabel: {fontSize: 13, fontWeight: '500'},
  fieldHint: {fontSize: 12, lineHeight: 16},
  expandBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmPanel: {
    borderRadius: 16,
    width: '100%',
    padding: 20,
  },
  confirmTitle: {fontSize: 17, fontWeight: '600', marginBottom: 10},
  confirmBody: {fontSize: 14, lineHeight: 21, marginBottom: 14},
  confirmActions: {flexDirection: 'row', gap: 12},
  confirmAction: {flex: 1},
});
