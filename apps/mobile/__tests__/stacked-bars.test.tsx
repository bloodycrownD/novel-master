/**
 * StackedBars 柱子无障碍属性与图表结构测试。
 *
 * - 无障碍（cr-fix mobile/J-2）：可点选柱子（有 onSelect）标
 *   accessibilityRole="button"，label 为「日期 · 输入 X · 输出 Y · 调用 N 次」，
 *   与 desktop 侧 bucketTooltip 文案口径一致（token 数走 formatTokenCount）；
 *   无 onSelect 的柱子（如按小时图）不可激活故不标 button，label 仍含
 *   输入/输出；calls 缺省时不拼「调用」段。
 * - 布局：柱总宽不足时居中（T-MB1）、30 柱超宽时横向滚动（T-MB2）、
 *   长按回调（T-MB3）。
 * - 纵坐标三档刻度（T-MC1/2/3，对齐 desktop 语义）：max/mid/zero 三线
 *   在滚动内容层铺满内容宽；三档刻度值在外层固定列，不随内容滚动；
 *   全零数据三档全显 0 不塔。
 */
import React from 'react';
import {describe, expect, it, jest} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {StackedBars} from '@/components/charts/StackedBars';
import type {ThemeTokens} from '@/theme/tokens';

const tokens = {
  primary: '#007aff',
  textSecondary: '#666',
} as unknown as ThemeTokens;

function findBarCol(root: ReactTestRenderer.ReactTestInstance, key: string) {
  return root.findAll(node => node.props.testID === `bar-col-${key}`)[0];
}

/** 从（可能是数组的）style 里取指定键值。 */
function styleValue(style: unknown, key: string): unknown {
  const arr = Array.isArray(style) ? style : [style];
  for (const entry of arr) {
    if (entry && typeof entry === 'object' && key in entry) {
      return (entry as Record<string, unknown>)[key];
    }
  }
  return undefined;
}

/** 拼接节点子树文本。 */
function nodeTextOf(node: ReactTestRenderer.ReactTestInstance): string {
  let out = '';
  for (const child of node.children) {
    if (typeof child === 'string') {
      out += child;
    } else {
      out += nodeTextOf(child);
    }
  }
  return out;
}

describe('StackedBars 无障碍属性', () => {
  it('可点选柱子标 button，label 与 desktop bucketTooltip 同口径', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <StackedBars
          data={[{key: '2026-08-24', primary: 1200, secondary: 300, calls: 6}]}
          onSelect={jest.fn()}
          tokens={tokens}
          formatLabel={key => key.slice(8)}
        />,
      );
    });
    const bar = findBarCol(tree.root, '2026-08-24');
    expect(bar.props.accessibilityRole).toBe('button');
    expect(bar.props.accessibilityLabel).toBe(
      '24 · 输入 1.2K · 输出 300 · 调用 6 次',
    );
  });

  it('无 onSelect 的柱子不标 button，calls 缺省时不拼调用段', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <StackedBars
          data={[{key: '13', primary: 40}]}
          tokens={tokens}
          formatLabel={key => `${Number(key)}时`}
        />,
      );
    });
    const bar = findBarCol(tree.root, '13');
    expect(bar.props.accessibilityRole).toBeUndefined();
    expect(bar.props.accessibilityLabel).toBe('13时 · 输入 40 · 输出 0');
  });
});

/** 触发滚动区 onLayout 设定绘图区宽（测量点在 ScrollView 自身，
 * 不含右侧固定刻度列——T-MB1/T-MB2 的 minWidth 语义基于该宽度）。 */
function layoutContainer(
  tree: ReactTestRenderer.ReactTestRenderer,
  width: number,
): void {
  act(() => {
    tree.root
      .findAll(node => typeof node.props.onLayout === 'function')[0]
      .props.onLayout({nativeEvent: {layout: {width}}});
  });
}

/** 收集节点全部祖先（含根）。 */
function ancestorsOf(
  node: ReactTestRenderer.ReactTestInstance,
): ReactTestRenderer.ReactTestInstance[] {
  const out: ReactTestRenderer.ReactTestInstance[] = [];
  let cur = node.parent;
  while (cur) {
    out.push(cur);
    cur = cur.parent;
  }
  return out;
}

/** 找 barsRow：style 含 minWidth 的行容器（柱子总宽的父级）。 */
function findBarsRow(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAll(
    node => styleValue(node.props.style, 'minWidth') !== undefined,
  )[0];
}

describe('StackedBars 居中与滚动（T-MB1/2/3）', () => {
  it('barsRow 含 justifyContent: center 且 minWidth: 滚动区宽保留（T-MB1 贴左根因）', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <StackedBars
          data={[
            {key: 'a', primary: 10},
            {key: 'b', primary: 20},
            {key: 'c', primary: 30},
          ]}
          tokens={tokens}
        />,
      );
    });
    // 测量点上移到 ScrollView（不含右侧刻度列）：传入 320 即滚动区宽。
    layoutContainer(tree, 320);
    const barsRow = findBarsRow(tree);
    expect(barsRow).toBeTruthy();
    expect(styleValue(barsRow.props.style, 'justifyContent')).toBe('center');
    expect(styleValue(barsRow.props.style, 'minWidth')).toBe(320);
  });

  it('柱数多到触发 MIN_BAR_WIDTH 时外层仍为横向 ScrollView（超宽滚动保留，T-MB2）', () => {
    const data = Array.from({length: 30}, (_, i) => ({
      key: `d${i}`,
      primary: 10 + i,
    }));
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<StackedBars data={data} tokens={tokens} />);
    });
    layoutContainer(tree, 300);
    // 30 柱 × min 18 + 29 间隔 × 6 = 714 > 300：内容超宽
    const scrollViews = tree.root.findAll(
      node => node.props.horizontal === true,
    );
    expect(scrollViews.length).toBeGreaterThan(0);
    // 柱宽被 MIN_BAR_WIDTH=18 撑住（超宽证据）
    const bar = tree.root.findAll(
      node =>
        typeof node.props.testID === 'string' && node.props.testID === 'bar-d0',
    )[0];
    expect(styleValue(bar.props.style, 'width')).toBe(18);
  });

  it('长按柱子触发 onLongPress 回调并携带 key（T-MB3）', () => {
    const onLongPress = jest.fn();
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <StackedBars
          data={[{key: '2026-08-24', primary: 1200, secondary: 300, calls: 6}]}
          onLongPress={onLongPress}
          tokens={tokens}
        />,
      );
    });
    const bar = findBarCol(tree.root, '2026-08-24');
    expect(typeof bar.props.onLongPress).toBe('function');
    act(() => {
      bar.props.onLongPress();
    });
    expect(onLongPress).toHaveBeenCalledWith('2026-08-24');
  });
});

describe('StackedBars 纵坐标三档刻度（T-MC1/2/3）', () => {
  /** 渲染两柱样例（max=1500：a=1200+300，b=0），返回 renderer。 */
  function renderBars(
    data: readonly {key: string; primary: number; secondary?: number}[],
  ) {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<StackedBars data={data} tokens={tokens} />);
    });
    return tree;
  }

  /** 按 testID 前缀收集去重后的节点列表（findAll 双层命中去重，取首个）。 */
  function nodesByTestIdPrefix(
    root: ReactTestRenderer.ReactTestInstance,
    prefix: string,
  ) {
    const seen = new Set<string>();
    const out: ReactTestRenderer.ReactTestInstance[] = [];
    for (const node of root.findAll(
      n =>
        typeof n.props.testID === 'string' && n.props.testID.startsWith(prefix),
    )) {
      const id = node.props.testID as string;
      if (!seen.has(id)) {
        seen.add(id);
        out.push(node);
      }
    }
    return out;
  }

  it('三档网格线与刻度值：max/mid/zero，值 1.5K/750/0（T-MC1，desktop 语义）', () => {
    const tree = renderBars([
      {key: 'a', primary: 1200, secondary: 300},
      {key: 'b', primary: 0},
    ]);
    // 三档线存在于滚动内容层（max=1500 → 1.5K / 750 / 0，刻度值复用
    // formatTokenCount）。
    const lines = nodesByTestIdPrefix(tree.root, 'grid-line-').map(
      n => n.props.testID as string,
    );
    expect(lines).toEqual(['grid-line-max', 'grid-line-mid', 'grid-line-zero']);
    // 线位：max 顶 0% / mid 中 50% / zero 基线 100%（相对 CHART_HEIGHT）。
    for (const [tier, top] of [
      ['max', '0%'],
      ['mid', '50%'],
      ['zero', '100%'],
    ] as const) {
      const line = tree.root.findAll(
        n => n.props.testID === `grid-line-${tier}`,
      )[0];
      expect(styleValue(line.props.style, 'top')).toBe(top);
    }
    // 旧右上角 max 标签已移除（被三档取代）。
    expect(tree.root.findAll(n => n.props.testID === 'grid-max-label')).toEqual(
      [],
    );
    // 三档刻度值文本。
    expect(
      nodeTextOf(
        tree.root.findAll(n => n.props.testID === 'grid-label-max')[0],
      ),
    ).toBe('1.5K');
    expect(
      nodeTextOf(
        tree.root.findAll(n => n.props.testID === 'grid-label-mid')[0],
      ),
    ).toBe('750');
    expect(
      nodeTextOf(
        tree.root.findAll(n => n.props.testID === 'grid-label-zero')[0],
      ),
    ).toBe('0');
  });

  it('刻度值列在横向 ScrollView 外、网格线在内容层内（T-MC2：值不随内容滚动）', () => {
    const tree = renderBars([{key: 'a', primary: 100}]);
    // 刻度值列的祖先链不应出现横向 ScrollView：30 天超宽滚动时刻度值
    // 恒在视口内。
    const label = tree.root.findAll(
      n => n.props.testID === 'grid-label-max',
    )[0];
    const labelInScroll = ancestorsOf(label).find(
      n => n.props.horizontal === true,
    );
    expect(labelInScroll).toBeUndefined();
    // 反证：网格线在横向 ScrollView 内容层内（随内容滚动、铺满内容宽）。
    const line = tree.root.findAll(n => n.props.testID === 'grid-line-max')[0];
    const lineInScroll = ancestorsOf(line).find(
      n => n.props.horizontal === true,
    );
    expect(lineInScroll).toBeTruthy();
  });

  it('全零数据三档全显 0 不塔（T-MC3 除零安全）', () => {
    const tree = renderBars([
      {key: 'a', primary: 0},
      {key: 'b', primary: 0, secondary: 0},
    ]);
    for (const tier of ['max', 'mid', 'zero'] as const) {
      const label = tree.root.findAll(
        n => n.props.testID === `grid-label-${tier}`,
      )[0];
      expect(label).toBeTruthy();
      expect(nodeTextOf(label)).toBe('0');
    }
  });
});
