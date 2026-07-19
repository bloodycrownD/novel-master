/**
 * MainTabs 底栏样式：供 RootNavigator screenOptions 与对话态恢复共用。
 */
import {Platform, StyleSheet, type ViewStyle} from 'react-native';
import type {ThemeTokens} from '../theme/tokens';

export type TabBarInsets = {
  bottom: number;
};

/** 与 RootNavigator 初始 tabBarStyle 等价的完整底栏样式。 */
export function buildMainTabBarStyle(
  tokens: Pick<
    ThemeTokens,
    'tabBarBackground' | 'borderLight'
  >,
  insets: TabBarInsets,
): ViewStyle {
  return {
    backgroundColor: tokens.tabBarBackground,
    borderTopColor: tokens.borderLight,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    paddingBottom: Math.max(8, insets.bottom),
    height: 56 + insets.bottom,
    ...Platform.select({
      android: {elevation: 8},
      ios: {
        shadowColor: '#000',
        shadowOffset: {width: 0, height: -2},
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
    }),
  };
}

/** 对话态隐藏底栏；会话列表态恢复完整样式。 */
export function resolveChatTabBarStyle(
  chatSubview: 'sessions' | 'conversation',
  tokens: Pick<ThemeTokens, 'tabBarBackground' | 'borderLight'>,
  insets: TabBarInsets,
): ViewStyle {
  if (chatSubview === 'conversation') {
    return {display: 'none'};
  }
  return buildMainTabBarStyle(tokens, insets);
}
