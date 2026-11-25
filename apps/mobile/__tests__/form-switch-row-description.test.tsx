/**
 * FormSwitchRow 的描述折叠：`descriptionLines` 限定行数（超出尾部省略），点描述文字
 * 展开 / 收起全文；不传时保持全文展示且不可点击（既有消费方行为不变）。
 */
import React from 'react';
import {Text} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {describe, expect, it} from '@jest/globals';

import {FormSwitchRow} from '@/components/form/FormSwitchRow';
import type {ThemeTokens} from '@/theme/tokens';

const tokens: ThemeTokens = {
    background: '#fff',
} as unknown as ThemeTokens;

const LONG = '联网搜索，返回标题、摘要与链接。支持指定站点与时间范围，结果按相关度排序，分页参数请参考工具 schema。';

function render(descriptionLines?: number) {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
        renderer = TestRenderer.create(<FormSwitchRow label="web_search" tokens={tokens} value={true} onValueChange={() => undefined} description={LONG} descriptionLines={descriptionLines} />);
    });
    const description = renderer.root.findAllByType(Text).find(node => node.props.children === LONG)!;
    const pressable = renderer.root.findAll(node => node.props.accessibilityRole === 'button')[0];
    return {renderer, description, pressable};
}

describe('FormSwitchRow 描述折叠', () => {
    it('设置 descriptionLines 时描述限行，点击展开后取消限行，再点收起', () => {
        const {description, pressable} = render(2);
        expect(description.props.numberOfLines).toBe(2);
        expect(pressable.props.accessibilityState.expanded).toBe(false);

        act(() => void pressable.props.onPress());
        expect(description.props.numberOfLines).toBeUndefined();
        expect(pressable.props.accessibilityState.expanded).toBe(true);

        act(() => void pressable.props.onPress());
        expect(description.props.numberOfLines).toBe(2);
    });

    it('不设 descriptionLines 时描述全文展示且没有可点击区域', () => {
        const {renderer, description} = render(undefined);
        expect(description.props.numberOfLines).toBeUndefined();
        expect(renderer.root.findAll(node => node.props.accessibilityRole === 'button')).toHaveLength(0);
    });

    it('没有描述时不渲染描述文字', () => {
        let renderer!: TestRenderer.ReactTestRenderer;
        act(() => {
            renderer = TestRenderer.create(<FormSwitchRow label="tool" tokens={tokens} value={false} onValueChange={() => undefined} descriptionLines={2} />);
        });
        expect(renderer.root.findAllByType(Text).map(node => node.props.children)).toEqual(['tool']);
    });
});
