/**
 * 内置引擎徽标：`duckduckgo` 无 set/not set 二态（无凭据可配），用主题色
 * 胶囊标「内置」，尺寸/形状与 ApiKeyStatusTag 协调、仅换主题色。
 *
 * 原定义在 SearchEnginesScreen（详情页反向 import 列表屏），随搜索配置页
 * 动态化抽成独立组件：列表行与详情页只读卡共用。
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {ThemeTokens} from '@/theme/tokens';

export function BuiltinTag({tokens}: {tokens: ThemeTokens}) {
  return (
    <View style={[styles.tag, {backgroundColor: `${tokens.primary}1A`}]}>
      <Text style={[styles.tagText, {color: tokens.primary}]}>内置</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    alignSelf: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
