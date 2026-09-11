/**
 * 搜索引擎展示元数据：id 清单以 core `ENGINE_IDS` 为单一真源（经
 * @shared/logic/search-engines 再导出），此处只挂展示文案，列表页
 * （SearchEnginesView）与详情页（SearchEngineDetailView）共用，
 * 不再各自维护副本。
 */
import {
  ENGINE_IDS,
  KEY_ENGINE_IDS,
  type EngineId,
  type KeyEngineId,
} from "@shared/logic/search-engines";

export const ENGINE_META: Record<EngineId, { label: string; desc: string }> = {
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
  duckduckgo: {
    label: "DuckDuckGo",
    desc: "内置",
  },
};

/** navState 携带的 engineId 收窄守卫（非法值兜底回列表页视觉态）。 */
export function isEngineId(value: string | undefined): value is EngineId {
  return value != null && (ENGINE_IDS as readonly string[]).includes(value);
}

/** key 引擎判定（id 清单以 core KEY_ENGINE_IDS 为真源）。 */
export function isKeyEngineId(
  engineId: EngineId,
): engineId is KeyEngineId {
  return (KEY_ENGINE_IDS as readonly EngineId[]).includes(engineId);
}

/** 展示名兜底（navState 脏值时也不炸，标题回退到通用文案）。 */
export function engineLabel(engineId: string | undefined): string {
  return isEngineId(engineId) ? ENGINE_META[engineId].label : "";
}
