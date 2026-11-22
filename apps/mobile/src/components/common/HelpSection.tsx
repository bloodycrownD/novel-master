/**
 * 帮助弹窗的一段说明：小标题 + 正文（搜索配置 / 智能排序规则共用）。
 *
 * 两屏原先各写一份同名局部组件，正文与样式逐字相同、唯一差异是 tokens
 * 参数的形状（一个只取 text/textSecondary 子集，一个收 ThemeTokens 整体）。
 * 这里取并集形态（ThemeTokens 整体），两屏的 `useTheme()` 返回值直接透传。
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {ThemeTokens} from '@/theme/tokens';

type Props = {
    title: string;
    body: string;
    tokens: ThemeTokens;
};

export function HelpSection({title, body, tokens}: Props) {
    return (
        <View style={styles.section}>
            <Text style={[styles.title, {color: tokens.text}]}>{title}</Text>
            <Text style={[styles.body, {color: tokens.textSecondary}]}>{body}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    section: {marginBottom: 12},
    title: {fontSize: 14, fontWeight: '600', marginBottom: 2},
    body: {fontSize: 13, lineHeight: 19},
});
