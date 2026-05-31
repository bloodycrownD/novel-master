/**
 * Profile tab: menu items navigate to stack screens.
 */
import React, {useCallback, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {ModelPickerModal} from '../../components/provider/ModelPickerModal';
import {AppHeader} from '../../components/chrome/AppHeader';
import {useRuntime} from '../../hooks/useRuntime';
import {resolveModelDisplayLabel} from '../../provider/model-display-label';
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
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const [modelLabel, setModelLabel] = useState('—');
  const [pickerVisible, setPickerVisible] = useState(false);

  const refreshModelLabel = useCallback(async () => {
    const currentId = await runtime.state.getCurrentModelId();
    if (!currentId) {
      setModelLabel('—');
      return;
    }
    try {
      setModelLabel(await resolveModelDisplayLabel(runtime, currentId));
    } catch {
      setModelLabel(currentId);
    }
  }, [runtime]);

  useFocusEffect(
    useCallback(() => {
      refreshModelLabel().catch(() => setModelLabel('—'));
    }, [refreshModelLabel]),
  );

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <AppHeader pageKey="profile" />
      <Pressable
        style={[styles.row, {borderBottomColor: tokens.border}]}
        onPress={() => setPickerVisible(true)}>
        <Text style={styles.menuIcon}>🤖</Text>
        <Text style={[styles.menuLabel, {color: tokens.text}]}>当前模型</Text>
        <Text style={[styles.menuValue, {color: tokens.textSecondary}]}>
          {modelLabel}
        </Text>
        <Text style={{color: tokens.textSecondary}}>›</Text>
      </Pressable>
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
          <Text style={[styles.menuLabel, {color: tokens.text, flex: 1}]}>
            {item.label}
          </Text>
          <Text style={{color: tokens.textSecondary}}>›</Text>
        </Pressable>
      ))}
      <ModelPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelected={() => refreshModelLabel().catch(() => undefined)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  menuIcon: {fontSize: 18},
  menuLabel: {fontSize: 16},
  menuValue: {flex: 1, textAlign: 'right', fontSize: 14},
});
