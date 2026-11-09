/**
 * 转录渲染层文案（spec §2.2.8 / C30）。
 *
 * 宿主经 `init.labels` 下发 core i18n catalog 的 4 个 `label.transcript.*` 文案；
 * 缺省（旧宿主 / 未下发）回退本文件的默认中文常量。纯常量 + 纯类型，零依赖。
 */

/** 渲染层文案四元组（与宿主 `TranscriptLabels` 同形）。 */
export type TranscriptLabels = {
  /** 生成中（等待首字 / 流式进行中指示条）。 */
  generating: string;
  /** 思考过程（thinking 折叠标题）。 */
  thinking: string;
  /** 暂无消息（空态）。 */
  empty: string;
  /** 加载更早消息（顶部分页按钮）。 */
  loadOlder: string;
};

/** 默认文案（老宿主 / `init.labels` 缺省兜底；当前中文常量）。 */
export const DEFAULT_LABELS: TranscriptLabels = {
  generating: '生成中',
  thinking: '思考过程',
  empty: '暂无消息',
  loadOlder: '加载更早消息',
};

/** 单键最小占位：缺键/非字符串一律回退默认。 */
function labelOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

// nm-style: keep-public — web 侧 labels 缺省回退唯一入口（旧宿主/init 缺省兼容）；
// 内联会把四键默认文案回退埋进 bridge 的 init 分支，测试也无法直测回退表。
/**
 * 下发载荷 → 渲染层文案（C30）：只校验四个键都是非空字符串，非法/缺省回退
 * 默认中文；不认识的字段忽略（旧宿主多下发的键天然兼容）。
 */
export function resolveLabels(payload: unknown): TranscriptLabels {
  const p = (payload ?? {}) as Partial<Record<keyof TranscriptLabels, unknown>>;
  return {
    generating: labelOr(p.generating, DEFAULT_LABELS.generating),
    thinking: labelOr(p.thinking, DEFAULT_LABELS.thinking),
    empty: labelOr(p.empty, DEFAULT_LABELS.empty),
    loadOlder: labelOr(p.loadOlder, DEFAULT_LABELS.loadOlder),
  };
}
