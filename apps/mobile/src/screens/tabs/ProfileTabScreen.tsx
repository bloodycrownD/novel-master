/**
 * Profile tab: menu items navigate to stack screens.
 */
import React, {useCallback, useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {AgentPickerModal} from '@/components/agent/AgentPickerModal';
import {ModelPickerModal} from '@/components/provider/ModelPickerModal';
import {AppHeader} from '@/components/chrome/AppHeader';
import {ListSectionTitle} from '@/components/ui/ListSectionTitle';
import {ProfileMenuItem} from '@/components/profile/ProfileMenuItem';
import {useDismissOverlaysOnBlur} from '@/hooks/useDismissOverlaysOnBlur';
import {useRuntime} from '@/hooks/useRuntime';
import {ModelDisplayLabel} from '@/services/model-display-label';
import {AgentDisplayLabel} from '@/services/agent-display-label';
import type {RootStackParamList} from '@/navigation/types';
import {useTheme} from '@/theme/ThemeProvider';
import {coreT} from '@/i18n/core';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const WORKSPACE_MODEL_MENU = {
  icon: '🤖',
  label: coreT({key: "ui.session.current_model"}),
} as const;

const WORKSPACE_AGENT_MENU = {
  icon: '🧠',
  label: coreT({key: "ui.session.current_agent"}),
} as const;

const WORKSPACE_GLOBAL_MENU = {
  icon: '🌐',
  label: coreT({key: "ui.nav.file_browser"}),
  route: 'GlobalTemplate',
} as const;

const CONFIG_MENU: Array<{
  icon: string;
  label: string;
  route: keyof RootStackParamList;
}> = [
  {icon: '🤖', label: coreT({key: "ui.nav.agent_settings"}), route: 'AgentsSettings'},
  {icon: '🔌', label: coreT({key: "ui.nav.providers"}), route: 'Providers'},
  {icon: '🔍', label: coreT({key: "ui.nav.search_engines"}), route: 'SearchEngines'},
  {icon: '🧩', label: coreT({key: "ui.nav.skills_manage"}), route: 'SkillsSettings'},
  {icon: '💬', label: '聊天配置', route: 'ChatConfig'},
  {icon: '💾', label: coreT({key: "ui.nav.storage"}), route: 'StorageConfig'},
  {icon: '📊', label: coreT({key: "ui.nav.token_stats"}), route: 'TokenUsageStats'},
  {icon: '🔢', label: coreT({key: "ui.nav.settings_smart_sort"}), route: 'SmartSortRules'},
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
      setAgentLabel(await AgentDisplayLabel.resolveCurrent(runtime));
    } catch {
      setAgentLabel('—');
    }
  }, [runtime]);

  const refreshModelLabel = useCallback(async () => {
    const currentModel = await runtime.state.getCurrentModelId();
    // 读取失败回退占位（错误通道迁移四期：与焦点 .catch 同款收场）。
    if (!currentModel.ok) {
      setModelLabel('—');
      return;
    }
    const currentId = currentModel.value;
    if (!currentId) {
      setModelLabel('—');
      return;
    }
    try {
      const label = await ModelDisplayLabel.resolve(runtime, currentId);
      setModelLabel(label.ok ? label.value : currentId);
    } catch {
      setModelLabel(currentId);
    }
  }, [runtime]);

  const onScreenFocus = useCallback(() => {
    refreshModelLabel().catch(() => setModelLabel('—'));
    refreshAgentLabel().catch(() => setAgentLabel('—'));
  }, [refreshModelLabel, refreshAgentLabel]);
  useFocusEffect(onScreenFocus);

  const navigateTo = (route: keyof RootStackParamList) => {
    const parent = navigation.getParent();
    if (parent) {
      parent.navigate(route as string);
    }
  };

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <AppHeader pageKey="profile" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <ListSectionTitle title={coreT({key: "ui.nav.workspace"})} tokens={tokens} />
        <ProfileMenuItem icon={WORKSPACE_MODEL_MENU.icon} label={WORKSPACE_MODEL_MENU.label} value={modelLabel} tokens={tokens} onPress={() => setModelPickerVisible(true)} />
        <ProfileMenuItem icon={WORKSPACE_AGENT_MENU.icon} label={WORKSPACE_AGENT_MENU.label} value={agentLabel} tokens={tokens} onPress={() => setAgentPickerVisible(true)} />
        <ProfileMenuItem icon={WORKSPACE_GLOBAL_MENU.icon} label={WORKSPACE_GLOBAL_MENU.label} tokens={tokens} onPress={() => navigateTo(WORKSPACE_GLOBAL_MENU.route)} />
        <ListSectionTitle title={coreT({key: "ui.nav.profile_config"})} tokens={tokens} />
        {CONFIG_MENU.map(item => (
          <ProfileMenuItem key={item.route} icon={item.icon} label={item.label} tokens={tokens} onPress={() => navigateTo(item.route)} />
        ))}
        <ListSectionTitle title={coreT({key: "ui.nav.settings_app"})} tokens={tokens} />
        <ProfileMenuItem icon="ℹ️" label={coreT({key: "ui.nav.about"})} tokens={tokens} onPress={() => navigateTo('About')} />
      </ScrollView>
      <ModelPickerModal visible={modelPickerVisible} onClose={() => setModelPickerVisible(false)} onSelected={() => refreshModelLabel().catch(() => undefined)} />
      <AgentPickerModal visible={agentPickerVisible} onClose={() => setAgentPickerVisible(false)} onSelected={() => refreshAgentLabel().catch(() => undefined)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  scroll: {flex: 1},
  scrollContent: {paddingBottom: 24},
});
