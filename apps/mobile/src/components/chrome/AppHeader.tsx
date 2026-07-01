/**
 * App chrome header: back, title, menu (☰), theme toggle.
 */
import React, {useMemo} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {BackIcon, MenuIcon, MoonIcon, SunIcon} from '../icons/TabIcons';
import {PAGE_HEADER_CONFIG} from '../../navigation/header-config';
import {useHeaderContext} from '../../navigation/HeaderContext';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  pageKey: keyof typeof PAGE_HEADER_CONFIG;
  onBack?: () => void;
  onMenu?: () => void;
};

export function AppHeader({pageKey, onBack, onMenu}: Props) {
  const insets = useSafeAreaInsets();
  const {tokens, mode, toggleMode} = useTheme();
  const {chat, stackOverride} = useHeaderContext();

  const resolved = useMemo(() => {
    const base = PAGE_HEADER_CONFIG[pageKey];
    if (stackOverride && pageKey !== 'chat') {
      return {
        title: stackOverride.title ?? base.title,
        showBack: stackOverride.showBack ?? base.showBack,
        showMenu: stackOverride.showMenu ?? false,
        onBack: stackOverride.onBack ?? onBack,
        onMenu: stackOverride.onMenu ?? onMenu,
      };
    }
    if (pageKey === 'chat') {
      let title = base.title;
      let showBack = false;
      if (chat.chatSubview === 'conversation') {
        title = chat.sessionTitle ?? '会话';
        showBack = true;
      } else if (chat.sessionListPanel === 'template') {
        title = '项目工作区';
      } else if (
        chat.chatSubview === 'sessions' &&
        chat.sessionListPanel === 'sessions'
      ) {
        title = chat.projectName ?? base.title;
      }
      return {
        title,
        showBack,
        showMenu: true,
        onBack: chat.onBackFromConversation ?? onBack,
        onMenu: chat.onOpenDrawer ?? onMenu,
      };
    }
    return {
      title: base.title,
      showBack: base.showBack,
      showMenu: false,
      onBack,
      onMenu,
    };
  }, [pageKey, chat, stackOverride, onBack, onMenu]);

  const menuLabel =
    pageKey === 'chat' && chat.chatSubview === 'conversation'
      ? '会话操作'
      : '项目列表';

  return (
    <View
      style={[
        styles.bar,
        {
          paddingTop: insets.top,
          backgroundColor: tokens.headerBackground,
          borderBottomColor: tokens.border,
        },
      ]}>
      <View style={styles.row}>
        {resolved.showBack ? (
          <Pressable onPress={resolved.onBack} style={styles.iconBtn}>
            <BackIcon color={tokens.primary} />
          </Pressable>
        ) : (
          <View style={styles.iconPlaceholder} />
        )}
        <Text
          style={[styles.title, {color: tokens.text}]}
          numberOfLines={1}
          accessibilityRole="header">
          {resolved.title}
        </Text>
        <Pressable onPress={() => toggleMode()} style={styles.iconBtn}>
          {mode === 'dark' ? (
            <SunIcon color={tokens.text} />
          ) : (
            <MoonIcon color={tokens.text} />
          )}
        </Pressable>
        {resolved.showMenu ? (
          <Pressable
            onPress={resolved.onMenu}
            style={styles.iconBtn}
            accessibilityLabel={menuLabel}>
            <MenuIcon color={tokens.text} />
          </Pressable>
        ) : (
          <View style={styles.iconPlaceholder} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {borderBottomWidth: StyleSheet.hairlineWidth},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 10,
    minHeight: 48,
  },
  title: {flex: 1, fontSize: 18, fontWeight: '600', textAlign: 'center'},
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  iconPlaceholder: {width: 40},
});
