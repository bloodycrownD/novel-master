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

import {
  PRESET_ENGINE_TEMPLATES,
  type SearchEngineTemplate,
} from '@novel-master/core';

/** 预置引擎显示名（列表行标题 / 详情页标题共用）。 */
export const ENGINE_LABELS: Readonly<Record<string, string>> = {
  bocha: 'Bocha',
  tavily: 'Tavily',
  brave: 'Brave',
  searxng: 'SearXNG',
  deepseek: 'DeepSeek',
  zhipu: '智谱',
  duckduckgo: 'DuckDuckGo',
};

/** 预置引擎行副标题（计费/部署口径一句话）；自定义实例用 {@link CUSTOM_ENGINE_HINT}。 */
export const ENGINE_HINTS: Readonly<Record<string, string>> = {
  bocha: '按量计费 · 中文检索',
  tavily: '按量计费 · 国际',
  brave: '按量计费 · 国际',
  searxng: '自托管 · 免费',
  deepseek: '按量计费 · 中文检索',
  zhipu: '按量计费 · 中文检索',
  duckduckgo: '内置 · 免费',
};

/** 自定义实例行副标题（无出厂文案）。 */
export const CUSTOM_ENGINE_HINT = '自定义模板';

/** 出厂模板只读索引视图。 */
type PresetTemplateTable = Readonly<Record<string, SearchEngineTemplate>>;

/** 出厂模板查表（预置 id 命中；自定义实例 / DDG 返回 undefined）。 */
export const PRESET_TEMPLATES: PresetTemplateTable = PRESET_ENGINE_TEMPLATES;

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
