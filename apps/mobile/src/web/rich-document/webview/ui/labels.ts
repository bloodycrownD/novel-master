/**
 * rich-document 渲染层文案（p27 R6 波 3-1 第二桥，镜像 chat-transcript C30 形态）。
 *
 * 宿主经 `init.labels` 下发 core i18n catalog 的 `ui.*` 文案 map；缺省（旧宿主 /
 * 未下发）回退本文件的默认中文常量。纯常量 + 纯类型，零渲染依赖。
 */

import {OVER_LIMIT_HINT} from '../runtime/document-model';

/** 渲染层文案（与宿主 `RichDocumentLabels` 同形）。 */
export type RichDocumentLabels = {
  /** ui.* 域文案 map（dotted key → 文案；值可含 {param} 模板，由消费方插值）。 */
  ui: Readonly<Record<string, string>>;
};

/** mermaid 全屏关闭按钮（两管线共享 portal；老宿主兜底，宿主下发逐键覆盖）。 */
const MERMAID_CLOSE_FALLBACK = '关闭';

/** ui.* 域缺省文案（老宿主 / `init.labels.ui` 缺省兜底；与 core catalog zh 逐字一致）。 */
export const DEFAULT_RICH_DOCUMENT_UI_LABELS: Readonly<Record<string, string>> = {
  // document-model 的旧宿主常量即缺省值（波 3-2 接线后消费方改走 labels）。
  'ui.rich_document.over_limit_hint': OVER_LIMIT_HINT,
  'ui.common.close': MERMAID_CLOSE_FALLBACK,
};

/** 默认文案（老宿主 / `init.labels` 缺省兜底；当前中文常量）。 */
export const DEFAULT_RICH_DOCUMENT_LABELS: RichDocumentLabels = {
  ui: DEFAULT_RICH_DOCUMENT_UI_LABELS,
};

export namespace Labels {
  /** 单键最小占位：缺键/非字符串一律回退默认。 */
  function labelOr(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.length > 0 ? value : fallback;
  }

  // nm-style: keep-public — web 侧 labels 缺省回退唯一入口（旧宿主/init 缺省兼容）；
  // 内联会把默认文案回退埋进 bridge 的 init 分支，测试也无法直测回退表。
  /**
   * 下发载荷 → 渲染层文案：ui map 逐键过滤非空字符串后覆盖
   * `DEFAULT_RICH_DOCUMENT_UI_LABELS` 兜底；非法/缺省回退默认中文；不认识的
   * 字段忽略（旧宿主多下发的键天然兼容）。
   */
  export function resolve(payload: unknown): RichDocumentLabels {
    const p = (payload ?? {}) as Partial<Record<'ui', unknown>>;
    const rawUi = typeof p.ui === 'object' && p.ui !== null && !Array.isArray(p.ui) ? (p.ui as Record<string, unknown>) : {};
    const uiLabels: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawUi)) {
      if (typeof value === 'string' && value.length > 0) uiLabels[key] = value;
    }
    return {
      ui: {...DEFAULT_RICH_DOCUMENT_UI_LABELS, ...uiLabels},
    };
  }
}
