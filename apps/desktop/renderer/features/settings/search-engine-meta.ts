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
  bocha: {
    label: "Bocha",
    desc: "博查 AI 搜索（api.bochaai.com），需 API Key。",
  },
  tavily: {
    label: "Tavily",
    desc: "Tavily 搜索（tavily.com），需 API Key。",
  },
  brave: {
    label: "Brave",
    desc: "Brave 搜索（search.brave.com），需 API Key。",
  },
  searxng: {
    label: "SearXNG",
    desc: "自托管元搜索实例，无需 API Key，填实例地址即可。",
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
