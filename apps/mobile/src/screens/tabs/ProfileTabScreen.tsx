/**
 * Profile tab: menu items navigate to stack screens.
 */
import React, {useCallback, useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {AgentPickerModal} from '../../components/agent/AgentPickerModal';
import {ModelPickerModal} from '../../components/provider/ModelPickerModal';
import {AppHeader} from '../../components/chrome/AppHeader';
import {ListSectionTitle} from '../../components/ui/ListSectionTitle';
import {ProfileMenuItem} from '../../components/ui/ProfileMenuItem';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
import {useRuntime} from '../../hooks/useRuntime';
import {resolveModelDisplayLabel} from '../../provider/model-display-label';
import {resolveCurrentAgentDisplayLabel} from '../../services/agent-display-label';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const WORKSPACE_MODEL_MENU = {
  icon: '🤖',
  label: '当前大模型',
} as const;

const WORKSPACE_AGENT_MENU = {
  icon: '🧠',
  label: '当前智能体',
} as const;

const WORKSPACE_GLOBAL_MENU = {
  icon: '🌐',
  label: '全局工作区',
  route: 'GlobalTemplate',
} as const;

const CONFIG_MENU: Array<{icon: string; label: string; route: keyof RootStackParamList}> =
  [
    {icon: '🤖', label: '智能体配置', route: 'AgentsSettings'},
    {icon: '🔌', label: '服务商配置', route: 'Providers'},
    {icon: '💬', label: '聊天配置', route: 'ChatConfig'},
    {icon: '💾', label: '存储配置', route: 'StorageConfig'},
    {icon: '🗜️', label: '压缩配置', route: 'CompactionConditions'},
    {icon: '⚡', label: '事件配置', route: 'EventsConfig'},
    {icon: '🛡️', label: '正则配置', route: 'RegexGroups'},
  ];

export function ProfileTabScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const [modelLabel, setModelLabel] = useState('—');
  const [agentLabel, setAgentLabel] = useState('—');
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [agentPickerVisible, setAgentPickerVisible] = useState(false);

  const dismissAllOverlays = useCallback(() => {
    setModelPickerVisible(false);
    setAgentPickerVisible(false);
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

  useFocusEffect(
    useCallback(() => {
      refreshModelLabel().catch(() => setModelLabel('—'));
      refreshAgentLabel().catch(() => setAgentLabel('—'));
    }, [refreshModelLabel, refreshAgentLabel]),
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
          icon={WORKSPACE_GLOBAL_MENU.icon}
          label={WORKSPACE_GLOBAL_MENU.label}
          tokens={tokens}
          onPress={() => navigateTo(WORKSPACE_GLOBAL_MENU.route)}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  scroll: {flex: 1},
  scrollContent: {paddingBottom: 24},
});
