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
import { describe, expect, it, jest } from '@jest/globals';
import TestRenderer, { act } from 'react-test-renderer';
import { StackedBars } from '../src/components/charts/StackedBars';
import type { ThemeTokens } from '../src/theme/tokens';

const tokens = {
  primary: '#007aff',
  textSecondary: '#666',
} as unknown as ThemeTokens;

function findBarCol(root: ReactTestRenderer.ReactTestInstance, key: string) {
  return root.findAll(node => node.props.testID === `bar-col-${key}`)[0];
}

describe('StackedBars 无障碍属性', () => {
  it('可点选柱子标 button，label 与 desktop bucketTooltip 同口径', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <StackedBars
          data={[
            { key: '2026-08-24', primary: 1200, secondary: 300, calls: 6 },
          ]}
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
          data={[{ key: '13', primary: 40 }]}
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
