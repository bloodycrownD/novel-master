/**
 * 搜索引擎展示元数据：本模块只保留**出厂副本**的展示文案（label / desc）与
 * 新建页哨兵；id 清单（六预置 + 自定义实例 + DDG）与各引擎实时状态一律来自
 * `readConfig()` 派生的配置 DTO（`SearchConfigDto.engines`）。预置展示名双端
 * 统一口径（拍板 5）：读模型 `name` 优先，本表 label 仅未知 id / 读模型缺名
 * 时兜底——列表页（SearchEnginesView）与详情页（SearchEngineDetailView）
 * 按此取值，desc（行副标题）无读模型来源、恒用本表静态文案。
 */
import { settingsTranslator } from "../../i18n/settings";

export const ENGINE_META: Readonly<Record<string, { readonly label: string; readonly desc: string }>> = {
  // desc 为行副标题（计费/部署形态一句话），与 mobile 同构口径，勿漂移
  bocha: {
    label: settingsTranslator({ key: "settings.search.meta.label.bocha" }),
    desc: settingsTranslator({ key: "settings.search.meta.hint.metered_zh" }),
  },
  tavily: {
    label: settingsTranslator({ key: "settings.search.meta.label.tavily" }),
    desc: settingsTranslator({ key: "settings.search.meta.hint.metered_intl" }),
  },
  brave: {
    label: settingsTranslator({ key: "settings.search.meta.label.brave" }),
    desc: settingsTranslator({ key: "settings.search.meta.hint.metered_intl" }),
  },
  searxng: {
    label: settingsTranslator({ key: "settings.search.meta.label.searxng" }),
    desc: settingsTranslator({ key: "settings.search.meta.hint.self_hosted_free" }),
  },
  deepseek: {
    label: settingsTranslator({ key: "settings.search.meta.label.deepseek" }),
    desc: settingsTranslator({ key: "settings.search.meta.hint.metered_zh" }),
  },
  zhipu: {
    label: settingsTranslator({ key: "settings.search.meta.label.zhipu" }),
    desc: settingsTranslator({ key: "settings.search.meta.hint.metered_zh" }),
  },
  duckduckgo: {
    label: settingsTranslator({ key: "settings.search.meta.label.duckduckgo" }),
    desc: settingsTranslator({ key: "settings.search.meta.hint.builtin_free" }),
  },
};

/**
 * 新建自定义引擎的哨兵值：Detail 页复用 `searchEngineDetail` viewId，
 * 以 `navState.editingEngineId === NEW_ENGINE_SENTINEL` 进入 create 模式
 * （不新增 viewId，`settings-nav.ts` / overlay stub 零改动）。
 */
export const NEW_ENGINE_SENTINEL = "__new__";

/** 展示名静态兜底（拍板 5：调用方先取读模型 `name`，仅未知 id / 读模型缺名落到本函数；本表未收录的 id 返回空串）。 */
export function engineLabel(engineId: string | undefined): string {
  return engineId == null ? "" : ENGINE_META[engineId]?.label ?? "";
}
