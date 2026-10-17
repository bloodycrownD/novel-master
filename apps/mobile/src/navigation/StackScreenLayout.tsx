/**
 * Stack screen layout with {@link AppHeader} and back navigation.
 */
import React, {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {AppHeader} from '@/components/chrome/AppHeader';
import {useTheme} from '@/theme/ThemeProvider';
import type {HeaderPageKey} from './header-config';

type Props = {
  pageKey: HeaderPageKey;
  children: ReactNode;
};

export function StackScreenLayout({pageKey, children}: Props) {
  const navigation = useNavigation();
  const route = useRoute();
  const {tokens} = useTheme();

  return (
    /* 屏根不透明底（fix-E 防御）：转场 alpha 混合若剥到屏根，露的也是主题色，
       不再穿透到窗口浅色背景（双保险，与 RootNavigator 的 navHost 外衬同口径）。 */
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <AppHeader
        pageKey={pageKey}
        ownerRouteKey={route.key}
        onBack={() => navigation.goBack()}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});
