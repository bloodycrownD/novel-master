/**
 * 搜索引擎详情页（两级结构第二级）：按引擎类别三分支 + create 模式。
 *
 * - duckduckgo：内置代码引擎，只读说明卡（无凭据可配）；
 * - 预置引擎：key（模板需 `{{apiKey}}` 时）/ baseUrl（模板需 `{{baseUrl}}`
 *   时）表单 + 测试搜索 + 模板表单（全平铺，可恢复默认）；
 * - 自定义实例：key（含「密钥注入方式」快捷写入 Headers）/ baseUrl +
 *   测试搜索 + 全量模板表单 + 删除；
 * - create 模式（无 route 参数）：curl 导入粘贴域 + 凭据 + 全量模板表单。
 *
 * 模板表单照 FormField/FormTextInput 骨架（v2 透传口径：响应侧零映射配置，
 * 字段止于 defaultBody/paramHint），保存前统一走 core 的
 * `validateSearchEngineTemplate`；测试默认走 store 的 `testEngine` 草稿直测
 * （不落库），例外同 desktop 拍板 1：预置引擎已有覆盖且表单与出厂逐字段相等
 * （key/baseUrl 草稿也为空）时省略 draft 只传 engineId，测生效配置。失败
 * descriptor 经 `coreT`（toast 通道同款翻译入口）译后展示。保存/清除/恢复默认
 * 的回读走静默分支（不闪全屏 loading）。已知 id 判定查 `readConfig()` 动态
 * 清单（预置 ∪ DDG ∪ 自定义实例）。
 * 凭证安全口径同列表页：只显配置状态标签，不回显 key 明文。
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
import {
  parseCurlCommand,
  validateSearchEngineTemplate,
  type SearchConfigPublic,
  type SearchEngineTemplate,
} from '@novel-master/core';
import {ApiKeyStatusTag} from '@/components/provider/ApiKeyStatusTag';
import {BuiltinTag} from '@/components/provider/BuiltinTag';
import {FormChipGroup, type ChipOption} from '@/components/form/FormChipGroup';
import {FormField} from '@/components/form/FormField';
import {FormSectionCard} from '@/components/form/FormSectionCard';
import {FormTextInput} from '@/components/form/FormTextInput';
import {ScreenFormLayout} from '@/components/form/ScreenFormLayout';
import {StickyFormFooter} from '@/components/form/StickyFormFooter';
import {SecondaryButton} from '@/components/ui/Buttons';
import {ModalShell} from '@/components/ui/ModalShell';
import {useRuntime} from '@/hooks/useRuntime';
import {useStackOverrideSetter} from '@/navigation/HeaderContext';
import type {RootStackParamList} from '@/navigation/types';
import {useTheme} from '@/theme/ThemeProvider';
import type {ThemeTokens} from '@/theme/tokens';
import {useToast} from '@/components/chrome/ToastHost';
import {toastMessage} from '@/errors/toast-message';
import {coreT} from '@/i18n/core';
import {getSearchConfigStore} from '@/services/search-config.store';
import {
  CUSTOM_ENGINE_HINT,
  ENGINE_HINTS,
  ENGINE_LABELS,
  PRESET_TEMPLATES,
  engineTitle,
} from './search-engine-meta';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type DetailRoute = RouteProp<RootStackParamList, 'SearchEngineDetail'>;

/** 模板表单草稿：文本字段原样保存，提交前再解析/校验（headers 为 JSON 文本）。 */
interface TemplateDraft {
  name: string;
  method: 'GET' | 'POST';
  url: string;
  headersText: string;
  defaultBodyText: string;
  paramHint: string;
}

// FIX-25：create 模式预填基线与 desktop EMPTY_FORM 逐字段对齐（POST + JSON 请求
// 头/体的常见形态 + defaultBody 出厂示例），首次保存不再被「url 必填」校验整单
// 拦下，只需补显示名与请求 URL。
const PREFILL_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

/** create 模式预填的 defaultBody 出厂示例（占位符整值字符串，执行时转数字）。 */
const PREFILL_BODY = {query: '{{query}}', count: '{{count}}'};

const EMPTY_DRAFT: TemplateDraft = {
  name: '',
  method: 'POST',
  url: '',
  headersText: JSON.stringify(PREFILL_HEADERS, null, 2),
  defaultBodyText: JSON.stringify(PREFILL_BODY, null, 2),
  paramHint: '',
};

const METHOD_OPTIONS: ReadonlyArray<ChipOption<'GET' | 'POST'>> = [
  {value: 'GET', label: 'GET'},
  {value: 'POST', label: 'POST'},
];

/** 预置覆盖按差异提交时比较的模板字段（与 SearchEngineTemplate 字段一一对应）。 */
const TEMPLATE_FIELDS: readonly (keyof SearchEngineTemplate)[] = [
  'name',
  'method',
  'url',
  'headers',
  'defaultBody',
  'paramHint',
];

/** 密钥注入方式（自定义实例快捷写入 Headers；`none` = 清掉已知鉴权头）。 */
type AuthMode = 'bearer' | 'x-api-key' | 'subscription' | 'none';

const AUTH_MODES: ReadonlyArray<{
  mode: AuthMode;
  header?: string;
  label: string;
  value: string;
}> = [
  {
    mode: 'bearer',
    header: 'Authorization',
    label: 'Authorization: Bearer',
    value: 'Bearer {{apiKey}}',
  },
  {
    mode: 'x-api-key',
    // FIX-19：与 desktop 注入选项同字面 X-API-Key（旧数据可能是 X-API-KEY 等
    // 大小写变体，识别 / 清除一律大小写不敏感，见 authHeaderKeyOf）。
    header: 'X-API-Key',
    label: 'X-API-Key',
    value: '{{apiKey}}',
  },
  {
    mode: 'subscription',
    header: 'X-Subscription-Token',
    label: 'X-Subscription-Token',
    value: '{{apiKey}}',
  },
  {mode: 'none', label: '不使用密钥', value: ''},
];

const HEADERS_INVALID_HINT = 'Headers 须为 JSON 对象，且每个值为字符串';
const TEMPLATE_INVALID_KEY = 'error.tool.search_template_invalid';

/** 在途写操作（互斥：同刻只允许一个；null = 空闲）。 */
type WriteOp = 'save' | 'clear' | 'reset' | 'delete';

const WRITE_FAIL_MESSAGES: Record<WriteOp, string> = {
  save: '保存失败',
  clear: '清除失败',
  reset: '恢复默认失败',
  delete: '删除失败',
};

/** headers 对象形状（readHeaders 出口 / 鉴权头匹配共用）。 */
type HeaderMap = Record<string, string>;

/** headers 文本 → 对象；非 JSON 对象或存在非字符串值返回 null（由调用方提示）。 */
function readHeaders(raw: string): HeaderMap | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const headers: HeaderMap = {};
    for (const [headerName, headerValue] of Object.entries(parsed)) {
      if (typeof headerValue !== 'string') {
        return null;
      }
      headers[headerName] = headerValue;
    }
    return headers;
  } catch {
    return null;
  }
}

/** 已知鉴权头在 headers 里的实际键名（大小写不敏感）；不存在返回 undefined。 */
function authHeaderKeyOf(headers: HeaderMap, key: string): string | undefined {
  const lowered = key.toLowerCase();
  return Object.keys(headers).find(name => name.toLowerCase() === lowered);
}

/** 模板表单字段（预置 / 自定义 / create 模式共用同一套输入骨架，全平铺）。 */
function TemplateFields({
  draft,
  onPatch,
  tokens,
}: {
  draft: TemplateDraft;
  onPatch: (patch: Partial<TemplateDraft>) => void;
  tokens: ThemeTokens;
}) {
  return (
    <>
      <FormField
        label="显示名"
        tokens={tokens}
        hint="列表行标题与工具描述中的引擎名"
      >
        <FormTextInput
          tokens={tokens}
          value={draft.name}
          onChangeText={text => onPatch({name: text})}
          placeholder="如 我的搜索"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </FormField>
      <FormField label="请求方法" tokens={tokens}>
        <FormChipGroup
          tokens={tokens}
          options={METHOD_OPTIONS}
          value={draft.method}
          onChange={method => onPatch({method})}
        />
      </FormField>
      <FormField
        label="请求 URL"
        tokens={tokens}
        hint="支持 {{query}}（URL 内自动百分号编码）/ {{count}} / {{apiKey}} / {{baseUrl}} 占位符"
      >
        <FormTextInput
          tokens={tokens}
          value={draft.url}
          onChangeText={text => onPatch({url: text})}
          placeholder="https://api.example.com/search"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </FormField>
      <FormField
        label="请求头 Headers（JSON）"
        tokens={tokens}
        hint='值为字符串，可内插占位符（如 "Authorization": "Bearer {{apiKey}}"）'
      >
        <FormTextInput
          tokens={tokens}
          value={draft.headersText}
          onChangeText={text => onPatch({headersText: text})}
          placeholder='{"Accept": "application/json"}'
          multiline
          autoCapitalize="none"
          autoCorrect={false}
        />
      </FormField>
      <FormField
        label="请求体 defaultBody（POST，可选）"
        tokens={tokens}
        // FIX-26：与 desktop 定稿逐字同步——裸形态易误读为可写整值，强调带引号。
        hint='可选：留空则由 agent 调用时传参；占位符写在字符串值里，整数字段写 "{{count}}"（带引号），执行时自动转为数字'
      >
        <FormTextInput
          tokens={tokens}
          value={draft.defaultBodyText}
          onChangeText={text => onPatch({defaultBodyText: text})}
          placeholder='{"query": "{{query}}", "count": "{{count}}"}'
          multiline
          autoCapitalize="none"
          autoCorrect={false}
        />
      </FormField>
      <FormField
        label="参数说明 paramHint"
        tokens={tokens}
        hint="≤500 字符；拼进工具描述，告诉模型本引擎可经 params 透传哪些原生参数"
      >
        <FormTextInput
          tokens={tokens}
          value={draft.paramHint}
          onChangeText={text => onPatch({paramHint: text})}
          placeholder="可经 params 透传 xxx 等原生字段；同名参数覆盖模板默认值"
          multiline
          autoCapitalize="none"
          autoCorrect={false}
        />
      </FormField>
    </>
  );
}

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
  /** 测试搜索关键词与结果（ok=成功预览，否则失败文案；失败红色展示 FIX-27）。 */
  const [testQuery, setTestQuery] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    {ok: boolean; text: string} | undefined
  >();
  /** create 模式的 curl 粘贴域。 */
  const [curlText, setCurlText] = useState('');

  const entry = config?.engines.find(item => item.id === engineId);
  const isCreate = engineId == null;
  const isCustom = entry?.isCustom === true;
  let title = '新建自定义引擎';
  if (engineId != null) {
    // FIX-23：读模型 name 优先（拍板 5），静态表仅未加载 / 未知 id 兜底。
    title = engineTitle(engineId, entry?.name);
  }
  let configured = entry != null;
  if (entry?.needsKey === true) {
    configured = entry.hasKey;
  } else if (entry?.needsBaseUrl === true) {
    configured = entry.baseUrl != null;
  }
  const draftText = `${draft.url}\n${draft.headersText}\n${draft.defaultBodyText}`;
  const draftNeedsKey = draftText.includes('{{apiKey}}');
  const draftNeedsBaseUrl = draftText.includes('{{baseUrl}}');
  const headersForAuth = readHeaders(draft.headersText);
  let authMode: AuthMode | null = null;
  if (headersForAuth != null) {
    authMode = 'none';
    for (const option of AUTH_MODES) {
      // FIX-19：大小写不敏感识别（跨端编辑的 X-API-KEY 旧写法也能命中模式）。
      if (option.header == null) {
        continue;
      }
      const headerKey = authHeaderKeyOf(headersForAuth, option.header);
      if (headersForAuth[headerKey ?? '']?.includes('{{apiKey}}') === true) {
        authMode = option.mode;
        break;
      }
    }
  }

  // 详情页标题用引擎名（自定义实例回落到配置读模型 name）。
  const syncHeader = useCallback(() => {
    setStackOverride({title});
    return () => setStackOverride(undefined);
  }, [setStackOverride, title]);
  useFocusEffect(syncHeader);

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
          setDraft({
            name: template.name,
            method: template.method,
            url: template.url,
            headersText: JSON.stringify(template.headers, null, 2),
            defaultBodyText: template.defaultBody ?? '',
            paramHint: template.paramHint,
          });
        }
        setBaseUrlDraft(engine?.baseUrl ?? '');
        setApiKeyDraft('');
        setTestResult(undefined);
      } catch (cause) {
        if (!silent) {
          showToast(toastMessage('加载搜索配置失败', cause));
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
      showToast(`未找到搜索引擎：${engineId}`);
      navigation.goBack();
    }
  }, [config, engineId, entry, navigation, showToast]);

  const patchDraft = (patch: Partial<TemplateDraft>) => {
    setDraft(current => ({...current, ...patch}));
  };

  /** 草稿 → 校验通过的模板；headers JSON 非法 / 校验失败时 toast 并返回 undefined。 */
  const validatedTemplate = (): SearchEngineTemplate | undefined => {
    const headers = readHeaders(draft.headersText);
    if (headers == null) {
      showToast(HEADERS_INVALID_HINT);
      return undefined;
    }
    const validated = validateSearchEngineTemplate({
      name: draft.name,
      method: draft.method,
      url: draft.url,
      headers,
      ...(draft.defaultBodyText.trim().length > 0
        ? {defaultBody: draft.defaultBodyText.trim()}
        : {}),
      paramHint: draft.paramHint,
    });
    if (!validated.ok) {
      const err = validated.error;
      const invalidKey = err.messageKey == null;
      const params = invalidKey ? {reason: err.message} : err.messageParams;
      const key = invalidKey ? TEMPLATE_INVALID_KEY : err.messageKey;
      showToast(coreT({key, params}));
      return undefined;
    }
    return validated.value;
  };

  // nm-style: keep-local — 保存分流 create/自定义/预置三分支，共享 writeOp 互斥态、
  // key/baseUrl 草稿与失败回读；内联进 footer 按钮会拆散互斥与回读状态机
  const handleSave = async () => {
    if (writeOp != null || testing) {
      return;
    }
    const template = validatedTemplate();
    if (template == null) {
      return;
    }
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
        showToast('已创建自定义引擎');
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
          showToast('请输入 API Key（留空不会修改已保存的密钥）');
          return;
        }
        // 预置覆盖按差异提交：只写入与出厂模板不同的字段，未改字段保留既有覆盖
        // （高级编辑显示出厂模板，见卡片提示；与 desktop 同一语义）。
        const preset = PRESET_TEMPLATES[engineId];
        if (preset != null) {
          const patch: Partial<SearchEngineTemplate> = {};
          for (const field of TEMPLATE_FIELDS) {
            if (
              JSON.stringify(preset[field]) !== JSON.stringify(template[field])
            ) {
              Object.assign(patch, {[field]: template[field]});
            }
          }
          if (Object.keys(patch).length > 0) {
            await searchStore.updatePresetOverride(engineId, patch);
          }
        }
        if (keyDraft.length > 0) {
          await searchStore.saveEngineKey(engineId, keyDraft);
        }
        if (draftNeedsBaseUrl) {
          await searchStore.setEngineBaseUrl(engineId, baseUrl);
        }
      }
      showToast('配置已保存');
      await load({silent: true});
    } catch (cause) {
      showToast(toastMessage('保存失败', cause));
      // 回读让状态标签立即反映已生效部分（与列表页同一兜底口径）；静默回读
      // 不闪全屏 loading（FIX-24），失败时保存失败的 toast 已在，不再叠加。
      await load({silent: true});
    } finally {
      setWriteOp(null);
    }
  };

  // nm-style: keep-local — 草稿直测共享 testing 互斥态与 testResult 回填
  // （成功拼预览块/失败译文案双分支），内联进按钮会拆散测试状态机
  const handleTest = async () => {
    if (writeOp != null || testing) {
      return;
    }
    const query = testQuery.trim();
    if (query.length === 0) {
      showToast('请输入测试关键词');
      return;
    }
    const template = validatedTemplate();
    if (template == null) {
      return;
    }
    const key = apiKeyDraft.trim();
    const url = baseUrlDraft.trim();
    setTesting(true);
    setTestResult(undefined);
    try {
      const testDraft = {
        template,
        ...(key.length > 0 ? {apiKey: key} : {}),
        ...(url.length > 0 ? {baseUrl: url} : {}),
      };
      // 拍板 1（FIX-1）：预置引擎已有覆盖且表单与出厂模板逐字段相等（key/baseUrl
      // 草稿也为空）→ 省略 draft 只传 engineId，core 走「覆盖合并 + SKSP 现读」
      // 测生效配置；表单有改动或凭据草稿非空仍草稿直测。判定与 desktop 同规则。
      const preset = engineId != null ? PRESET_TEMPLATES[engineId] : undefined;
      // 表单模板与出厂逐字段 JSON 等价（undefined 字段两侧同为 undefined）；
      // 判定链拆成单行中间变量（save 的差异提交同款比较口径）。
      let sameAs = false;
      if (preset != null) {
        sameAs = true;
        for (const field of TEMPLATE_FIELDS) {
          if (
            JSON.stringify(preset[field]) !== JSON.stringify(template[field])
          ) {
            sameAs = false;
            break;
          }
        }
      }
      const overrides = config?.presetOverrides;
      const overrideOn = engineId != null && overrides?.[engineId] === true;
      const isPreset = entry != null && entry.isCustom !== true;
      const noKey = key.length === 0;
      const noUrlDraft = !draftNeedsBaseUrl || url.length === 0;
      const noDrafts = noKey && noUrlDraft;
      const testEffective = isPreset && overrideOn && sameAs && noDrafts;
      const req = {
        ...(engineId == null ? {} : {engineId}),
        ...(testEffective ? {} : {draft: testDraft}),
        query,
      };
      const outcome = await searchStore.testEngine(req);
      if (outcome.ok) {
        // TestEngineSuccess v2 形状（spec v2 §5）：共 N 条（数组可解析时）+
        // 前 2 条 JSON 预览 + 截断标记；不再渲染 title/url 人类列表。
        const lines = [
          ...(outcome.value.resultCount == null
            ? []
            : [`共 ${outcome.value.resultCount} 条`]),
          outcome.value.preview,
          ...(outcome.value.truncated ? ['（预览已截断）'] : []),
        ];
        setTestResult({ok: true, text: lines.join('\n')});
      } else {
        setTestResult({
          ok: false,
          text: `测试失败：${coreT(outcome.error.message)}`,
        });
      }
    } catch (cause) {
      showToast(toastMessage('测试失败', cause));
    } finally {
      setTesting(false);
    }
  };

  /** 短写操作互斥模板：任一写操作在途即忽略；失败 toast 按操作映射，复位交 finally。 */
  const runWrite = async (op: WriteOp, go: (id: string) => Promise<void>) => {
    if (engineId == null || writeOp != null || testing) {
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
    return (
      <View style={[styles.centered, {backgroundColor: tokens.background}]} />
    );
  }

  // 内置代码引擎：只读说明卡，无输入框、无保存 footer。
  if (engineId === 'duckduckgo') {
    return (
      <ScreenFormLayout tokens={tokens}>
        <FormSectionCard
          tokens={tokens}
          title={ENGINE_LABELS.duckduckgo}
          hint={ENGINE_HINTS.duckduckgo}
          rightAction={<BuiltinTag tokens={tokens} />}
        >
          <Text style={[styles.hintText, {color: tokens.textSecondary}]}>
            内置代码引擎，无需 API Key，开箱即用；在列表页可开关与调整优先级，
            关闭后不参与搜索。
          </Text>
        </FormSectionCard>
      </ScreenFormLayout>
    );
  }

  const keyField = (
    <FormField
      label="API Key"
      tokens={tokens}
      hint={
        entry?.hasKey === true
          ? '已保存；留空则保留原密钥'
          : '保存时写入本机密钥库'
      }
    >
      <FormTextInput
        tokens={tokens}
        value={apiKeyDraft}
        onChangeText={setApiKeyDraft}
        placeholder={entry?.hasKey === true ? '留空保留已存密钥' : ''}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
    </FormField>
  );
  const baseUrlField = (
    <FormField
      label="实例地址 Base URL"
      tokens={tokens}
      hint="含 http(s)://；留空保存即清除"
    >
      <FormTextInput
        tokens={tokens}
        value={baseUrlDraft}
        onChangeText={setBaseUrlDraft}
        placeholder="https://search.example.com"
        autoCapitalize="none"
        autoCorrect={false}
      />
    </FormField>
  );
  let authModeField: React.ReactNode = null;
  if (authMode != null) {
    authModeField = (
      <FormField
        label="密钥注入方式"
        tokens={tokens}
        hint="快捷写入 Headers；也可直接在模板 Headers 里手写占位符"
      >
        <FormChipGroup
          tokens={tokens}
          options={AUTH_MODES.map(option => ({
            value: option.mode,
            label: option.label,
          }))}
          value={authMode}
          onChange={mode => {
            const headers = readHeaders(draft.headersText);
            if (headers == null) {
              showToast(HEADERS_INVALID_HINT);
              return;
            }
            for (const option of AUTH_MODES) {
              // FIX-19：切换注入方式先按大小写不敏感清掉全部已知鉴权头旧键
              // （X-API-KEY 等历史变体一并清除），再写入选中头，避免双头残留。
              if (option.header == null) {
                continue;
              }
              const existing = authHeaderKeyOf(headers, option.header);
              if (existing != null) {
                delete headers[existing];
              }
            }
            const chosen = AUTH_MODES.find(item => item.mode === mode);
            if (chosen?.header != null) {
              headers[chosen.header] = chosen.value;
            }
            patchDraft({headersText: JSON.stringify(headers, null, 2)});
          }}
        />
      </FormField>
    );
  }
  const templateCard = (
    <FormSectionCard
      tokens={tokens}
      title="引擎模板"
      hint="模板决定请求形状；保存前会校验合法性并拦截明文密钥"
    >
      <TemplateFields draft={draft} onPatch={patchDraft} tokens={tokens} />
    </FormSectionCard>
  );
  const testCard = (
    <FormSectionCard
      tokens={tokens}
      title="测试搜索"
      hint="草稿直测，不落库；会真实请求引擎接口，可能消耗引擎配额"
    >
      <FormField label="测试关键词" tokens={tokens}>
        <FormTextInput
          tokens={tokens}
          value={testQuery}
          onChangeText={setTestQuery}
          placeholder="如 人工智能"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </FormField>
      <SecondaryButton
        tokens={tokens}
        fullWidth
        label={testing ? '测试中…' : '测试搜索'}
        onPress={() => {
          handleTest().catch(() => undefined);
        }}
        disabled={writeOp != null || testing}
      />
      {testResult == null ? null : (
        <Text
          style={[
            styles.testResult,
            // FIX-27：失败文案用错误红（列表屏 error 同款 token），与成功说明区分。
            {color: testResult.ok ? tokens.textSecondary : tokens.danger},
          ]}
        >
          {testResult.text}
        </Text>
      )}
    </FormSectionCard>
  );

  return (
    <ScreenFormLayout
      tokens={tokens}
      footer={
        <StickyFormFooter
          tokens={tokens}
          label={isCreate ? '创建引擎' : '保存配置'}
          onPress={() => {
            handleSave().catch(() => undefined);
          }}
          loading={writeOp === 'save'}
          disabled={writeOp != null || testing}
        />
      }
    >
      {isCreate ? (
        <FormSectionCard
          tokens={tokens}
          title="从 curl 导入"
          hint="粘贴 curl 命令自动预填请求方法 / URL / Headers / defaultBody；疑似密钥替换为 {{apiKey}} 占位符，保存时写入密钥库"
        >
          <FormTextInput
            tokens={tokens}
            value={curlText}
            onChangeText={setCurlText}
            placeholder="curl -X POST https://api.example.com/search -H 'Authorization: Bearer ...' -d '{...}'"
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <SecondaryButton
            tokens={tokens}
            fullWidth
            label="解析并预填"
            onPress={() => {
              const parsed = parseCurlCommand(curlText);
              if (!parsed.ok) {
                const reason = coreT(parsed.error.message);
                showToast(toastMessage('导入失败', reason));
                return;
              }
              const imported = parsed.value;
              patchDraft({
                method: imported.method,
                url: imported.url,
                headersText: JSON.stringify(imported.headers, null, 2),
                ...(imported.defaultBody == null
                  ? {}
                  : {defaultBodyText: imported.defaultBody}),
              });
              if (imported.apiKey != null) {
                setApiKeyDraft(imported.apiKey);
              }
              showToast('已解析 curl 命令，请补全显示名后保存');
            }}
            disabled={curlText.trim().length === 0 || writeOp != null}
          />
        </FormSectionCard>
      ) : null}
      <FormSectionCard
        tokens={tokens}
        title={isCreate ? '凭据（可选）' : title}
        hint={
          isCreate
            ? '密钥 / 实例地址按模板占位符取用；留空可稍后再配'
            : ENGINE_HINTS[engineId] ?? CUSTOM_ENGINE_HINT
        }
        rightAction={
          isCreate ? undefined : (
            <ApiKeyStatusTag
              status={configured ? 'set' : 'not set'}
              tokens={tokens}
            />
          )
        }
      >
        {isCreate || isCustom || draftNeedsKey ? keyField : null}
        {isCreate || isCustom ? authModeField : null}
        {draftNeedsBaseUrl ? baseUrlField : null}
        {isCreate || entry?.hasKey !== true ? null : (
          <SecondaryButton
            tokens={tokens}
            fullWidth
            label={writeOp === 'clear' ? '清除中…' : '清除已存密钥'}
            onPress={() => {
              void runWrite('clear', async id => {
                await searchStore.clearEngineKey(id);
                showToast(`已清除 ${title} API Key`);
                await load({silent: true});
              });
            }}
            disabled={writeOp != null || testing}
          />
        )}
      </FormSectionCard>
      {testCard}
      {isCreate || isCustom ? (
        templateCard
      ) : (
        <FormSectionCard
          tokens={tokens}
          title="引擎模板"
          hint="修改请求形状；保存后作为本机覆盖，可随时恢复默认"
        >
          {config?.presetOverrides[engineId] === true ? (
            <Text style={[styles.hintText, {color: tokens.textSecondary}]}>
              该引擎已有自定义覆盖；表单显示出厂模板，保存时只提交你修改过的字段，
              未改字段保留既有覆盖。
            </Text>
          ) : null}
          <TemplateFields draft={draft} onPatch={patchDraft} tokens={tokens} />
          {engineId != null && config?.presetOverrides[engineId] === true ? (
            <SecondaryButton
              tokens={tokens}
              fullWidth
              label="恢复默认模板"
              onPress={() => {
                void runWrite('reset', async id => {
                  await searchStore.resetPresetOverride(id);
                  showToast('已恢复默认模板');
                  await load({silent: true});
                });
              }}
              disabled={writeOp != null || testing}
            />
          ) : null}
        </FormSectionCard>
      )}
      {isCustom ? (
        <FormSectionCard
          tokens={tokens}
          title="删除引擎"
          hint="删除后模板配置与已存密钥一并清除，不可恢复"
        >
          <SecondaryButton
            tokens={tokens}
            fullWidth
            label={writeOp === 'delete' ? '删除中…' : '删除此自定义引擎'}
            onPress={() => setConfirmDelete(true)}
            disabled={writeOp != null || testing}
          />
        </FormSectionCard>
      ) : null}
      {/* 删除确认：删除即清模板 / 密钥 / 排序项，二次确认。 */}
      <ModalShell
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        variant="center"
        animationType="fade"
        panelStyle={styles.confirmPanel}
      >
        <Text style={[styles.confirmTitle, {color: tokens.text}]}>
          删除自定义引擎
        </Text>
        <Text style={[styles.confirmBody, {color: tokens.textSecondary}]}>
          {`「${title}」的模板配置与已存密钥会一并清除，此操作不可撤销。`}
        </Text>
        <View style={styles.confirmActions}>
          <View style={styles.confirmAction}>
            <SecondaryButton
              tokens={tokens}
              fullWidth
              label="取消"
              onPress={() => setConfirmDelete(false)}
              disabled={writeOp === 'delete'}
            />
          </View>
          <View style={styles.confirmAction}>
            <SecondaryButton
              tokens={tokens}
              fullWidth
              label={writeOp === 'delete' ? '删除中…' : '删除'}
              onPress={() => {
                void runWrite('delete', async id => {
                  await searchStore.deleteCustomEngine(id);
                  showToast('已删除自定义引擎');
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
  testResult: {fontSize: 13, lineHeight: 19},
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
