/**
 * 搜索引擎展示元数据（出厂副本）：label / desc 文案与 desktop
 * `renderer/features/settings/search-engine-meta.ts` 同构口径，双端勿漂移。
 *
 * 引擎实例 id 清单**不在本模块静态维护**——动态清单（六预置 ∪ `duckduckgo` ∪
 * 自定义实例）与各引擎实时状态一律来自 `readConfig()` 派生配置读模型；
 * 本模块只提供预置引擎的展示名/行副标题兜底与出厂模板查表，列表页与
 * 详情页共用（详情页不再反向 import 列表屏）。
 *
 * 译文一律调用期求值（ui-copy/i18n-1）：模块顶层只静态维护 key 表，经
 * settingsTranslator 在每次调用时取译，接动态 locale 后不冻结在 import 期。
 *
 * @module screens/stack/search-engine-meta
 */

import {PRESET_ENGINE_TEMPLATES, type SearchEngineTemplate} from '@novel-master/core';
import type {SettingsMessageKey} from '@novel-master/core/settings';
import {settingsTranslator} from '@/i18n/settings';

/** 预置引擎显示名 key 表（调用期经 settingsTranslator 求值，不冻结译文）。 */
const ENGINE_LABEL_KEYS: Readonly<Record<string, SettingsMessageKey>> = {
  bocha: 'settings.search.meta.label.bocha',
  tavily: 'settings.search.meta.label.tavily',
  brave: 'settings.search.meta.label.brave',
  searxng: 'settings.search.meta.label.searxng',
  deepseek: 'settings.search.meta.label.deepseek',
  zhipu: 'settings.search.meta.label.zhipu',
  duckduckgo: 'settings.search.meta.label.duckduckgo',
};

/** 预置引擎行副标题 key 表（计费/部署口径一句话）；未收录 id 回落 {@link CUSTOM_ENGINE_HINT_KEY}。 */
const ENGINE_HINT_KEYS: Readonly<Record<string, SettingsMessageKey>> = {
  bocha: 'settings.search.meta.hint.metered_zh',
  tavily: 'settings.search.meta.hint.metered_intl',
  brave: 'settings.search.meta.hint.metered_intl',
  searxng: 'settings.search.meta.hint.self_hosted_free',
  deepseek: 'settings.search.meta.hint.metered_zh',
  zhipu: 'settings.search.meta.hint.metered_zh',
  duckduckgo: 'settings.search.meta.hint.builtin_free',
};

/** 自定义实例行副标题 key（无出厂文案，按实例 id 动态渲染的行共用）。 */
const CUSTOM_ENGINE_HINT_KEY: SettingsMessageKey = 'settings.search.meta.hint.custom_template.mobile';

/** 出厂模板查表（按动态 id 索引的只读视图；预置 id 命中，自定义实例 / DDG 返回 undefined）。 */
// prettier-ignore
export const PRESET_TEMPLATES: Readonly<Record<string, SearchEngineTemplate>> = PRESET_ENGINE_TEMPLATES;

/**
 * 行副标题：预置 id 查出厂文案，未收录（自定义实例等）回落自定义模板口径。
 *
 * nm-style: keep-local — 唯一调用点在 SearchEnginesScreen 行渲染内；内联会迫使
 * 模块私有的 `ENGINE_HINT_KEYS` / `CUSTOM_ENGINE_HINT_KEY` 提升为导出，反而扩大
 * 导出面，故保留为单调用点函数。
 */
export function engineHint(engineId: string): string {
  const key = ENGINE_HINT_KEYS[engineId] ?? CUSTOM_ENGINE_HINT_KEY;
  return settingsTranslator({key});
}

/**
 * 展示名：读模型 name 优先（拍板 5，双端同口径——desktop 同款）；静态表
 * {@link ENGINE_LABEL_KEYS} 仅未知 id / 读模型缺名时兜底，未收录的 id 返回 id 本身。
 */
export function engineTitle(engineId: string, modelName?: string): string {
  const name = modelName?.trim();
  if (name != null && name.length > 0) {
    return name;
  }
  const labelKey = ENGINE_LABEL_KEYS[engineId];
  return labelKey == null ? engineId : settingsTranslator({key: labelKey});
}
