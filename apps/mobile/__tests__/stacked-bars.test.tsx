/**
 * StackedBars 柱子无障碍属性测试（cr-fix mobile/J-2）。
 *
 * - 可点选柱子（有 onSelect）：accessibilityRole="button"，label 为
 *   「日期 · 输入 X · 输出 Y · 调用 N 次」，与 desktop 侧 bucketTooltip
 *   文案口径一致（token 数走 formatTokenCount）；
 * - 无 onSelect 的柱子（如按小时图）：不可激活故不标 button，label 仍含
 *   输入/输出；calls 缺省时不拼「调用」段。
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

/** 触发根节点 onLayout 设定容器宽度（模拟测量完成）。 */
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

/** 找 barsRow：style 含 minWidth 的行容器（柱子总宽的父级）。 */
function findBarsRow(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAll(
    node => styleValue(node.props.style, 'minWidth') !== undefined,
  )[0];
}

describe('StackedBars 居中与网格（T-MB1/2/3）', () => {
  it('barsRow 含 justifyContent: center 且 minWidth: containerWidth 保留（T-MB1 贴左根因）', () => {
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

  it('网格层渲染刻度线与顶部 max 标注（T-MB1 配套）', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <StackedBars
          data={[
            {key: 'a', primary: 1200, secondary: 300},
            {key: 'b', primary: 0},
          ]}
          tokens={tokens}
        />,
      );
    });
    const lines = [
      ...new Set(
        tree.root
          .findAll(
            node =>
              typeof node.props.testID === 'string' &&
              node.props.testID.startsWith('grid-line-'),
          )
          .map(node => node.props.testID as string),
      ),
    ];
    // findAll 同时命中组件层与 host 层，按 testID 去重后应为 2 条
    expect(lines).toEqual(['grid-line-1', 'grid-line-2']);
    const maxLabel = tree.root.findAll(
      node => node.props.testID === 'grid-max-label',
    )[0];
    expect(maxLabel).toBeTruthy();
    expect(nodeTextOf(maxLabel)).toBe('1.5K');
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
