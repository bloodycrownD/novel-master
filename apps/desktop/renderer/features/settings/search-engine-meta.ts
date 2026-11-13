/**
 * 搜索引擎展示元数据：本模块只保留**出厂副本**的展示文案键（label / desc）与
 * 新建页哨兵；id 清单（六预置 + 自定义实例 + DDG）与各引擎实时状态一律来自
 * `readConfig()` 派生的配置 DTO（`SearchConfigDto.engines`）。预置展示名双端
 * 统一口径（拍板 5）：读模型 `name` 优先，本表 label 仅未知 id / 读模型缺名
 * 时兜底——列表页（SearchEnginesView）与详情页（SearchEngineDetailView）
 * 按此取值，desc（行副标题）无读模型来源、恒用本表静态文案。
 *
 * i18n-1：label / desc 译文不在模块 import 期求值（settingsTranslator 接动态
 * locale 后模块常量会永久冻结），改为 `engineMeta(id)` 在调用点求值。
 */
import type { SettingsMessageKey } from "@shared/logic/settings-i18n";
import { settingsTranslator } from "../../i18n/settings";

/** 展示文案键表（静态骨架；译文经 engineMeta 在调用点求值）。 */
const ENGINE_META_KEYS: Readonly<Record<string, { readonly labelKey: SettingsMessageKey; readonly descKey: SettingsMessageKey }>> = {
  // desc 为行副标题（计费/部署形态一句话），与 mobile 同构口径，勿漂移
  bocha: { labelKey: "settings.search.meta.label.bocha", descKey: "settings.search.meta.hint.metered_zh" },
  tavily: { labelKey: "settings.search.meta.label.tavily", descKey: "settings.search.meta.hint.metered_intl" },
  brave: { labelKey: "settings.search.meta.label.brave", descKey: "settings.search.meta.hint.metered_intl" },
  searxng: { labelKey: "settings.search.meta.label.searxng", descKey: "settings.search.meta.hint.self_hosted_free" },
  deepseek: { labelKey: "settings.search.meta.label.deepseek", descKey: "settings.search.meta.hint.metered_zh" },
  zhipu: { labelKey: "settings.search.meta.label.zhipu", descKey: "settings.search.meta.hint.metered_zh" },
  duckduckgo: { labelKey: "settings.search.meta.label.duckduckgo", descKey: "settings.search.meta.hint.builtin_free" },
};

/** 引擎展示元数据（label + desc 译文；未知 id / 缺参返回 undefined）。 */
export function engineMeta(engineId: string | undefined): { readonly label: string; readonly desc: string } | undefined {
  const keys = engineId == null ? undefined : ENGINE_META_KEYS[engineId];
  return keys == null ? undefined : { label: settingsTranslator({ key: keys.labelKey }), desc: settingsTranslator({ key: keys.descKey }) };
}

/**
 * 新建自定义引擎的哨兵值：Detail 页复用 `searchEngineDetail` viewId，
 * 以 `navState.editingEngineId === NEW_ENGINE_SENTINEL` 进入 create 模式
 * （不新增 viewId，`settings-nav.ts` / overlay stub 零改动）。
 */
export const NEW_ENGINE_SENTINEL = "__new__";

/** 展示名静态兜底（拍板 5：调用方先取读模型 `name`，仅未知 id / 读模型缺名落到本函数；本表未收录的 id 返回空串）。 */
export function engineLabel(engineId: string | undefined): string {
  return engineId == null ? "" : engineMeta(engineId)?.label ?? "";
}
