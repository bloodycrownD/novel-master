/**
 * 搜索引擎展示元数据：本模块只保留**出厂副本**的展示文案（label / desc）与
 * 新建页哨兵；id 清单（六预置 + 自定义实例 + DDG）与各引擎实时状态一律来自
 * `readConfig()` 派生的配置 DTO（`SearchConfigDto.engines`），列表页
 * （SearchEnginesView）与详情页（SearchEngineDetailView）共用本表做展示名兜底。
 */
export const ENGINE_META: Readonly<Record<string, { readonly label: string; readonly desc: string }>> = {
  // desc 为行副标题（计费/部署形态一句话），与 mobile 同构口径，勿漂移
  bocha: {
    label: "Bocha",
    desc: "按量计费 · 中文检索",
  },
  tavily: {
    label: "Tavily",
    desc: "按量计费 · 国际",
  },
  brave: {
    label: "Brave",
    desc: "按量计费 · 国际",
  },
  searxng: {
    label: "SearXNG",
    desc: "自托管 · 免费",
  },
  deepseek: {
    label: "DeepSeek",
    desc: "按量计费 · 中文检索",
  },
  zhipu: {
    label: "智谱",
    desc: "按量计费 · 中文检索",
  },
  duckduckgo: {
    label: "DuckDuckGo",
    desc: "内置 · 免费",
  },
};

/**
 * 新建自定义引擎的哨兵值：Detail 页复用 `searchEngineDetail` viewId，
 * 以 `navState.editingEngineId === NEW_ENGINE_SENTINEL` 进入 create 模式
 * （不新增 viewId，`settings-nav.ts` / overlay stub 零改动）。
 */
export const NEW_ENGINE_SENTINEL = "__new__";

/** 展示名兜底（自定义实例 / 哨兵等本表未收录的 id 返回空串，调用方用动态清单 name 兜底）。 */
export function engineLabel(engineId: string | undefined): string {
  return engineId == null ? "" : (ENGINE_META[engineId]?.label ?? "");
}
