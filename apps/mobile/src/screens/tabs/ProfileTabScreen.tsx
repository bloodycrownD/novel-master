/**
 * Profile tab: menu items navigate to stack screens.
 */
import React, {useCallback, useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {ModelPickerModal} from '../../components/provider/ModelPickerModal';
import {AppHeader} from '../../components/chrome/AppHeader';
import {ListSectionTitle} from '../../components/ui/ListSectionTitle';
import {ProfileMenuItem} from '../../components/ui/ProfileMenuItem';
import {ProfileSwitchItem} from '../../components/ui/ProfileSwitchItem';
import {useRuntime} from '../../hooks/useRuntime';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {
  readChatRichTextEnabled,
  writeChatRichTextEnabled,
} from '../../storage/chat-rich-text-pref';
import {
  readLlmStreamEnabled,
  writeLlmStreamEnabled,
} from '../../storage/llm-stream-pref';
import {resolveModelDisplayLabel} from '../../provider/model-display-label';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const WORKSPACE_MENU = {
  icon: '🤖',
  label: '当前模型',
} as const;

const CONFIG_MENU: Array<{icon: string; label: string; route: keyof RootStackParamList}> =
  [
    {icon: '🔌', label: '服务商管理', route: 'Providers'},
    {icon: '🗜️', label: '压缩策略', route: 'CompactionPolicy'},
    {icon: '🛡️', label: '正则配置', route: 'RegexGroups'},
    {icon: '🌐', label: '全局模板', route: 'GlobalTemplate'},
  ];

export function ProfileTabScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const {appUi} = useNovelMaster();
  const navigation = useNavigation<Nav>();
  const [modelLabel, setModelLabel] = useState('—');
  const [llmStreamEnabled, setLlmStreamEnabled] = useState(true);
  const [chatRichTextEnabled, setChatRichTextEnabled] = useState(false);
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

  const refreshStreamPref = useCallback(async () => {
    if (appUi == null) {
      return;
    }
    setLlmStreamEnabled(await readLlmStreamEnabled(appUi));
  }, [appUi]);

  const refreshChatRichTextPref = useCallback(async () => {
    if (appUi == null) {
      return;
    }
    setChatRichTextEnabled(await readChatRichTextEnabled(appUi));
  }, [appUi]);

  useFocusEffect(
    useCallback(() => {
      refreshModelLabel().catch(() => setModelLabel('—'));
      refreshStreamPref().catch(() => undefined);
      refreshChatRichTextPref().catch(() => undefined);
    }, [refreshModelLabel, refreshStreamPref, refreshChatRichTextPref]),
  );

  const navigateTo = (route: keyof RootStackParamList) => {
    const parent = navigation.getParent();
    if (parent) {
      parent.navigate(route);
    }
  };

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <AppHeader pageKey="profile" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        <ListSectionTitle title="工作区" tokens={tokens} />
        <ProfileMenuItem
          icon={WORKSPACE_MENU.icon}
          label={WORKSPACE_MENU.label}
          value={modelLabel}
          tokens={tokens}
          onPress={() => setPickerVisible(true)}
        />
        <ProfileSwitchItem
          icon="⚡"
          label="流式输出"
          subtitle={
            llmStreamEnabled
              ? '边生成边显示（推荐）'
              : '完成后一次性显示回复'
          }
          value={llmStreamEnabled}
          tokens={tokens}
          onValueChange={enabled => {
            setLlmStreamEnabled(enabled);
            if (appUi) {
              writeLlmStreamEnabled(appUi, enabled).catch(() => undefined);
            }
          }}
        />
        <ProfileSwitchItem
          icon="📝"
          label="富文本消息"
          subtitle={
            chatRichTextEnabled
              ? '助手回复解析 Markdown/HTML'
              : '助手回复显示为纯文本'
          }
          value={chatRichTextEnabled}
          tokens={tokens}
          onValueChange={enabled => {
            setChatRichTextEnabled(enabled);
            if (appUi) {
              writeChatRichTextEnabled(appUi, enabled).catch(() => undefined);
            }
          }}
        />
        <ListSectionTitle title="配置" tokens={tokens} />
        {CONFIG_MENU.map(item => (
          <ProfileMenuItem
            key={item.route}
            icon={item.icon}
            label={item.label}
            tokens={tokens}
            onPress={() => navigateTo(item.route)}
          />
        ))}
      </ScrollView>
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
  scroll: {flex: 1},
  scrollContent: {paddingBottom: 24},
});
