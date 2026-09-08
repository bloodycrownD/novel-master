/**
 * 智能排序规则列表的长按拖拽调序纯逻辑（spec smart-filename-sort Step 15）。
 *
 * 拖拽交互由 SmartSortRulesScreen 的 PanResponder 自研手势驱动
 * （D8 约束：不引第三方拖拽库、不新增 GestureHandlerRootView——
 * RNGH 2.31 的 GestureDetector 无 RootView 祖先时 DEV 直接抛错，
 * 故改用 RN 内置响应系统 + reanimated 位移）。
 *
 * 这里只放可单测的坐标/重排计算，不依赖 React/RN 运行时。
 */

/**
 * 列表行卡片的外部底边距（card-styles.ts 的 card.marginBottom，单源为 12）。
 * 行包装 View 的实测 height 会包含这段 gap，边界换算时需要扣除。
 */
export const DRAG_ROW_GAP = 12;

/** 手柄长按到进入拖拽态的时长门槛（毫秒）。 */
export const DRAG_LONG_PRESS_MS = 300;

/** 长按等待期内允许的最大竖向位移（px），超出视为滑动、放弃拖拽。 */
export const DRAG_ACTIVATE_SLOP = 12;

/**
 * 行布局实测值：相对 FlatList 内容坐标的顶部 y 与含 gap 的总高度。
 */
export interface DragRowLayout {
  y: number;
  height: number;
}

/**
 * 计算插入位索引 t ∈ [0, count]：拖拽行中心 contentY 最近的行间边界。
 *
 * 语义：t 表示「插入到新序列的第 t 位」，线画在第 t 行上方（t = count 画在末尾）。
 * 行间边界取上一行卡片底部与下一行卡片顶部的中点（即 gap 中间）；
 * 布局缺失（极端虚拟化场景）时退化为按已知行的平均步长均分。
 */
export function computeInsertIndex(
  centerContentY: number,
  layouts: ReadonlyArray<DragRowLayout | undefined>,
  count: number,
): number {
  if (count <= 0) {
    return 0;
  }
  const boundaries = computeBoundaries(layouts, count);
  let best = 0;
  let bestDist = Math.abs(boundaries[0] - centerContentY);
  for (let k = 1; k <= count; k++) {
    const dist = Math.abs(boundaries[k] - centerContentY);
    if (dist < bestDist) {
      best = k;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * 按插入位语义重排行数组，返回新数组；t 与原位等价（t === from 或 from + 1）时
 * 原样返回入参引用，供调用方跳过无变化的提交。
 */
export function reorderRows<T>(
  rows: readonly T[],
  from: number,
  insertIndex: number,
): T[] {
  if (
    rows.length <= 1 ||
    from < 0 ||
    from >= rows.length ||
    insertIndex < 0 ||
    insertIndex > rows.length ||
    insertIndex === from ||
    insertIndex === from + 1
  ) {
    // 原位等价/非法索引：返回原引用供调用方跳过提交；断言仅为匹配可变返回类型。
    return rows as T[];
  }
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(insertIndex > from ? insertIndex - 1 : insertIndex, 0, moved);
  return next;
}

function computeBoundaries(
  layouts: ReadonlyArray<DragRowLayout | undefined>,
  count: number,
): number[] {
  const boundaries: number[] = new Array(count + 1).fill(0);
  boundaries[0] = 0;
  let complete = true;
  for (let k = 1; k <= count; k++) {
    const prev = layouts[k - 1];
    if (prev == null) {
      complete = false;
      break;
    }
    if (k < count) {
      const cur = layouts[k];
      if (cur == null) {
        complete = false;
        break;
      }
      // gap 中点：上一行卡片底（总高扣 gap）与本行卡片顶的中点。
      boundaries[k] = (prev.y + prev.height - DRAG_ROW_GAP + cur.y) / 2;
    } else {
      boundaries[count] = prev.y + prev.height - DRAG_ROW_GAP;
    }
  }
  if (complete) {
    return boundaries;
  }
  // 布局不全（虚拟化或初次布局未完成）：按已知行平均步长均分兜底。
  const step = avgRowStep(layouts);
  for (let k = 0; k <= count; k++) {
    boundaries[k] = k * step;
  }
  return boundaries;
}

/** 布局全缺时的兜底行步长（px，行卡片含 gap 总高的典型值）。 */
export const FALLBACK_ROW_STEP = 96;

/**
 * 已知行平均步长（含 gap 的总高度均值），无任何已知布局时退回 FALLBACK_ROW_STEP。
 * computeBoundaries 的兜底均分与 fallbackRowCenter 共用此步长，保证边界与中心同源。
 */
function avgRowStep(layouts: ReadonlyArray<DragRowLayout | undefined>): number {
  const known = layouts.filter((l): l is DragRowLayout => l != null);
  return known.length > 0
    ? known.reduce((sum, l) => sum + l.height, 0) / known.length
    : FALLBACK_ROW_STEP;
}

/**
 * 布局缺失行的兜底行中心：from 行原点 + 半步长 + 拖拽位移 dy。
 *
 * 步长与 computeBoundaries 的兜底均分同源（avgRowStep），行高或布局变化时
 * 两边同步漂移；屏幕侧不再自带 96 硬编码副本。
 */
export function fallbackRowCenter(
  from: number,
  dy: number,
  layouts: ReadonlyArray<DragRowLayout | undefined> = [],
): number {
  const step = avgRowStep(layouts);
  return from * step + step / 2 + dy;
}
