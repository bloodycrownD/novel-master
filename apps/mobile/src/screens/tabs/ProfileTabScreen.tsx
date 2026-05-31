/**
 * Profile tab: menu items navigate to stack screens.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {AppHeader} from '../../components/chrome/AppHeader';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const MENU: Array<{label: string; route: keyof RootStackParamList}> = [
  {label: '服务商管理', route: 'Providers'},
  {label: '压缩策略', route: 'CompactionPolicy'},
  {label: '正则配置', route: 'RegexGroups'},
  {label: '全局模板', route: 'GlobalTemplate'},
  {label: '扩展设置', route: 'Settings'},
  {label: '开发调试', route: 'DevMenu'},
];

export function ProfileTabScreen() {
  const {tokens} = useTheme();
  const navigation = useNavigation<Nav>();

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <AppHeader pageKey="profile" />
      {MENU.map(item => (
        <Pressable
          key={item.route}
          style={[styles.row, {borderBottomColor: tokens.border}]}
          onPress={() => {
            const parent = navigation.getParent();
            if (parent) {
              parent.navigate(item.route);
            }
          }}>
          <Text style={{color: tokens.text}}>{item.label}</Text>
          <Text style={{color: tokens.textSecondary}}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
