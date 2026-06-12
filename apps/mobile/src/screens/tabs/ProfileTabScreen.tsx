/**
 * Profile tab: menu items navigate to stack screens.
 */
import React, {useCallback, useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {AgentPickerModal} from '../../components/agent/AgentPickerModal';
import {ModelPickerModal} from '../../components/provider/ModelPickerModal';
import {RegexGroupPickerModal} from '../../components/regex/RegexGroupPickerModal';
import {AppHeader} from '../../components/chrome/AppHeader';
import {ListSectionTitle} from '../../components/ui/ListSectionTitle';
import {ProfileMenuItem} from '../../components/ui/ProfileMenuItem';
import {ProfileSwitchItem} from '../../components/ui/ProfileSwitchItem';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
import {useRuntime} from '../../hooks/useRuntime';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {
  readChatRichTextEnabled,
  writeChatRichTextEnabled,
} from '../../storage/chat-rich-text-pref';
import {resolveModelDisplayLabel} from '../../provider/model-display-label';
import {resolveCurrentAgentDisplayLabel} from '../../services/agent-display-label';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const WORKSPACE_MODEL_MENU = {
  icon: '🤖',
  label: '当前模型',
} as const;

const WORKSPACE_AGENT_MENU = {
  icon: '🧠',
  label: '当前 agent',
} as const;

const WORKSPACE_REGEX_GROUP_MENU = {
  icon: '🛡️',
  label: '当前正则组',
} as const;

const CONFIG_MENU: Array<{icon: string; label: string; route: keyof RootStackParamList}> =
  [
    {icon: '🤖', label: 'agent管理', route: 'AgentsSettings'},
    {icon: '🔌', label: '服务商管理', route: 'Providers'},
    {icon: '💾', label: '存储配置', route: 'StorageConfig'},
    {icon: '🗜️', label: '压缩条件', route: 'CompactionConditions'},
    {icon: '⚡', label: '事件配置', route: 'EventsConfig'},
    {icon: '🛡️', label: '正则配置', route: 'RegexGroups'},
    {icon: '🌐', label: '全局工作区', route: 'GlobalTemplate'},
  ];

export function ProfileTabScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const {appUi} = useNovelMaster();
  const navigation = useNavigation<Nav>();
  const [modelLabel, setModelLabel] = useState('—');
  const [agentLabel, setAgentLabel] = useState('—');
  const [regexGroupLabel, setRegexGroupLabel] = useState('不启用');
  const [llmStreamEnabled, setLlmStreamEnabled] = useState(true);
  const [sessionFsVersionCheck, setSessionFsVersionCheck] = useState(true);
  const [chatRichTextEnabled, setChatRichTextEnabled] = useState(false);
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [agentPickerVisible, setAgentPickerVisible] = useState(false);
  const [regexGroupPickerVisible, setRegexGroupPickerVisible] =
    useState(false);

  const dismissAllOverlays = useCallback(() => {
    setModelPickerVisible(false);
    setAgentPickerVisible(false);
    setRegexGroupPickerVisible(false);
  }, []);

  useDismissOverlaysOnBlur(dismissAllOverlays);

  const refreshAgentLabel = useCallback(async () => {
    try {
      setAgentLabel(await resolveCurrentAgentDisplayLabel(runtime));
    } catch {
      setAgentLabel('—');
    }
  }, [runtime]);

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

  const refreshRegexGroupLabel = useCallback(async () => {
    const currentId = await runtime.state.getCurrentRegexGroupId();
    if (!currentId) {
      setRegexGroupLabel('不启用');
      return;
    }
    try {
      const group = await runtime.regexConfig.getGroup(currentId);
      setRegexGroupLabel(group.displayName?.trim() || group.groupId);
    } catch {
      setRegexGroupLabel('不启用');
    }
  }, [runtime]);

  const refreshStreamPref = useCallback(async () => {
    setLlmStreamEnabled(await runtime.preferences.getLlmStreamEnabled());
  }, [runtime]);

  const refreshSessionFsVersionCheckPref = useCallback(async () => {
    setSessionFsVersionCheck(
      await runtime.preferences.getSessionFsVersionCheck(),
    );
  }, [runtime]);

  const refreshChatRichTextPref = useCallback(async () => {
    if (appUi == null) {
      return;
    }
    setChatRichTextEnabled(await readChatRichTextEnabled(appUi));
  }, [appUi]);

  useFocusEffect(
    useCallback(() => {
      refreshModelLabel().catch(() => setModelLabel('—'));
      refreshAgentLabel().catch(() => setAgentLabel('—'));
      refreshRegexGroupLabel().catch(() => setRegexGroupLabel('不启用'));
      refreshStreamPref().catch(() => undefined);
      refreshSessionFsVersionCheckPref().catch(() => undefined);
      refreshChatRichTextPref().catch(() => undefined);
    }, [
      refreshModelLabel,
      refreshAgentLabel,
      refreshRegexGroupLabel,
      refreshStreamPref,
      refreshSessionFsVersionCheckPref,
      refreshChatRichTextPref,
    ]),
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
          icon={WORKSPACE_MODEL_MENU.icon}
          label={WORKSPACE_MODEL_MENU.label}
          value={modelLabel}
          tokens={tokens}
          onPress={() => setModelPickerVisible(true)}
        />
        <ProfileMenuItem
          icon={WORKSPACE_AGENT_MENU.icon}
          label={WORKSPACE_AGENT_MENU.label}
          value={agentLabel}
          tokens={tokens}
          onPress={() => setAgentPickerVisible(true)}
        />
        <ProfileMenuItem
          icon={WORKSPACE_REGEX_GROUP_MENU.icon}
          label={WORKSPACE_REGEX_GROUP_MENU.label}
          value={regexGroupLabel}
          tokens={tokens}
          onPress={() => setRegexGroupPickerVisible(true)}
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
            runtime.preferences
              .setLlmStreamEnabled(enabled)
              .catch(() => undefined);
          }}
        />
        <ProfileSwitchItem
          icon="🛡️"
          label="Session FS 版本校验"
          subtitle={
            sessionFsVersionCheck
              ? '写入时校验 VFS 版本号（推荐）'
              : '写入时跳过版本冲突检查'
          }
          value={sessionFsVersionCheck}
          tokens={tokens}
          onValueChange={enabled => {
            setSessionFsVersionCheck(enabled);
            runtime.preferences
              .setSessionFsVersionCheck(enabled)
              .catch(() => undefined);
          }}
        />
        <ProfileSwitchItem
          icon="📝"
          label="富文本消息"
          subtitle={
            chatRichTextEnabled
              ? '用户与助手消息解析 Markdown/HTML'
              : '聊天消息显示为纯文本'
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
        <ListSectionTitle title="应用" tokens={tokens} />
        <ProfileMenuItem
          icon="ℹ️"
          label="关于 Novel Master"
          tokens={tokens}
          onPress={() => navigateTo('About')}
        />
      </ScrollView>
      <ModelPickerModal
        visible={modelPickerVisible}
        onClose={() => setModelPickerVisible(false)}
        onSelected={() => refreshModelLabel().catch(() => undefined)}
      />
      <AgentPickerModal
        visible={agentPickerVisible}
        onClose={() => setAgentPickerVisible(false)}
        onSelected={() => refreshAgentLabel().catch(() => undefined)}
      />
      <RegexGroupPickerModal
        visible={regexGroupPickerVisible}
        onClose={() => setRegexGroupPickerVisible(false)}
        onSelected={() => refreshRegexGroupLabel().catch(() => undefined)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  scroll: {flex: 1},
  scrollContent: {paddingBottom: 24},
});
