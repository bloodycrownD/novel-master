/**
 * 智能排序规则列表拖拽调序的纯逻辑测试（spec smart-filename-sort Step 15）。
 * 只测坐标换算与数组重排（smart-sort-drag.ts），手势/渲染留真机验收（T-DT2）。
 */
import {
  DRAG_ROW_GAP,
  computeInsertIndex,
  reorderRows,
} from '../src/screens/stack/smart-sort-drag';

describe('computeInsertIndex', () => {
  // 等高三行：布局含 12px 底部 gap，卡高 88、行间边界在 gap 中点。
  const layouts = [
    {y: 0, height: 100},
    {y: 100, height: 100},
    {y: 200, height: 100},
  ];

  test('静止未拖（中心在原位）→ 原位 from', () => {
    const center = 0 + (100 - DRAG_ROW_GAP) / 2; // 44
    expect(computeInsertIndex(center, layouts, 3)).toBe(0);
  });

  test('下行半行内 → from+1（原位等价，不画线）', () => {
    expect(computeInsertIndex(94, layouts, 3)).toBe(1);
    expect(computeInsertIndex(95, layouts, 3)).toBe(1);
  });

  test('拖过一行 → 换位（t=2）', () => {
    expect(computeInsertIndex(145, layouts, 3)).toBe(2);
  });

  test('顶部/底部越界钳制到 [0, count]', () => {
    expect(computeInsertIndex(-100, layouts, 3)).toBe(0);
    expect(computeInsertIndex(500, layouts, 3)).toBe(3);
  });

  test('不等高行按实测布局取最近边界', () => {
    const mixed = [
      {y: 0, height: 120},
      {y: 120, height: 80},
    ];
    // 边界：[0, 120-6=114, 188]；第一行中心 54 → 距 0（54）与 114（60）→ 0。
    expect(computeInsertIndex(54, mixed, 2)).toBe(0);
    // 中心 115 → 距 114 最近 → 1。
    expect(computeInsertIndex(115, mixed, 2)).toBe(1);
  });

  test('布局缺失时退化均分兜底', () => {
    const partial = [{y: 0, height: 96}, undefined, undefined];
    // 兜底边界 [0, 96, 192, 288]：中心 97 → 1；中心 193 → 2。
    expect(computeInsertIndex(97, partial, 3)).toBe(1);
    expect(computeInsertIndex(193, partial, 3)).toBe(2);
  });

  test('空列表返回 0', () => {
    expect(computeInsertIndex(0, [], 0)).toBe(0);
  });
});

describe('reorderRows', () => {
  const rows = ['A', 'B', 'C', 'D'];

  test('向下移动：from=0, t=2 → [B, A, C, D]', () => {
    expect(reorderRows(rows, 0, 2)).toEqual(['B', 'A', 'C', 'D']);
  });

  test('向上移动：from=3, t=0 → [D, A, B, C]', () => {
    expect(reorderRows(rows, 3, 0)).toEqual(['D', 'A', 'B', 'C']);
  });

  test('原位等价（t=from / t=from+1）返回原引用，不触发提交', () => {
    expect(reorderRows(rows, 1, 1)).toBe(rows);
    expect(reorderRows(rows, 1, 2)).toBe(rows);
  });

  test('非法索引返回原引用', () => {
    expect(reorderRows(rows, -1, 0)).toBe(rows);
    expect(reorderRows(rows, 4, 0)).toBe(rows);
    expect(reorderRows(rows, 0, 5)).toBe(rows);
  });

  test('单元素/空数组返回原引用', () => {
    expect(reorderRows(['A'], 0, 1)).toEqual(['A']);
    expect(reorderRows([] as string[], 0, 0)).toEqual([]);
  });
});
