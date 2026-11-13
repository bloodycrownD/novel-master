/**
 * 搜索引擎展示元数据（出厂副本）：label / desc 文案与 desktop
 * `renderer/features/settings/search-engine-meta.ts` 同构口径，双端勿漂移。
 *
 * 引擎实例 id 清单**不在本模块静态维护**——动态清单（六预置 ∪ `duckduckgo` ∪
 * 自定义实例）与各引擎实时状态一律来自 `readConfig()` 派生配置读模型；
 * 本模块只提供预置引擎的展示名/行副标题兜底与出厂模板查表，列表页与
 * 详情页共用（详情页不再反向 import 列表屏）。
 *
 * @module screens/stack/search-engine-meta
 */

import {PRESET_ENGINE_TEMPLATES, type SearchEngineTemplate} from '@novel-master/core';
import {settingsTranslator} from '@/i18n/settings';

/** 预置引擎显示名（列表行标题 / 详情页标题共用）。 */
export const ENGINE_LABELS: Readonly<Record<string, string>> = {
  bocha: settingsTranslator({key: 'settings.search.meta.label.bocha'}),
  tavily: settingsTranslator({key: 'settings.search.meta.label.tavily'}),
  brave: settingsTranslator({key: 'settings.search.meta.label.brave'}),
  searxng: settingsTranslator({key: 'settings.search.meta.label.searxng'}),
  deepseek: settingsTranslator({key: 'settings.search.meta.label.deepseek'}),
  zhipu: settingsTranslator({key: 'settings.search.meta.label.zhipu'}),
  duckduckgo: settingsTranslator({key: 'settings.search.meta.label.duckduckgo'}),
};

/** 预置引擎行副标题（计费/部署口径一句话）；自定义实例用 {@link CUSTOM_ENGINE_HINT}。 */
export const ENGINE_HINTS: Readonly<Record<string, string>> = {
  bocha: settingsTranslator({key: 'settings.search.meta.hint.metered_zh'}),
  tavily: settingsTranslator({key: 'settings.search.meta.hint.metered_intl'}),
  brave: settingsTranslator({key: 'settings.search.meta.hint.metered_intl'}),
  searxng: settingsTranslator({key: 'settings.search.meta.hint.self_hosted_free'}),
  deepseek: settingsTranslator({key: 'settings.search.meta.hint.metered_zh'}),
  zhipu: settingsTranslator({key: 'settings.search.meta.hint.metered_zh'}),
  duckduckgo: settingsTranslator({key: 'settings.search.meta.hint.builtin_free'}),
};

/** 自定义实例行副标题（无出厂文案）。 */
export const CUSTOM_ENGINE_HINT = settingsTranslator({key: 'settings.search.meta.hint.custom_template.mobile'});

/** 出厂模板查表（按动态 id 索引的只读视图；预置 id 命中，自定义实例 / DDG 返回 undefined）。 */
// prettier-ignore
export const PRESET_TEMPLATES: Readonly<Record<string, SearchEngineTemplate>> = PRESET_ENGINE_TEMPLATES;

/**
 * 展示名：读模型 name 优先（拍板 5，双端同口径——desktop 同款）；静态表
 * {@link ENGINE_LABELS} 仅未知 id / 读模型缺名时兜底，未收录的 id 返回 id 本身。
 */
export function engineTitle(engineId: string, modelName?: string): string {
  const name = modelName?.trim();
  if (name != null && name.length > 0) {
    return name;
  }
  return ENGINE_LABELS[engineId] ?? engineId;
}
