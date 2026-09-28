/**
 * Stack screen: agent registry list and create (replaces Agents tab).
 */
import React from 'react';
import {StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {AgentSettingsTab} from '@novel-master/core/config-forms/agent';
import {AgentList} from '@/components/agent/AgentList';
import {useToast} from '@/components/chrome/ToastHost';
import {toastMessage} from '@/errors/toast-message';
import {useRuntime} from '@/hooks/useRuntime';
import type {RootStackParamList} from '@/navigation/types';
import {createBlankAgent} from '@/services/agent-create';
import {useTheme} from '@/theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function AgentsSettingsScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();

  // 新建默认作用域随 tab 落库：主 tab → primary、子 tab → subagent。
  const handleCreate = async (tab: AgentSettingsTab) => {
    try {
      const id = await createBlankAgent(
        runtime,
        undefined,
        tab === 'primary' ? 'primary' : 'subagent',
      );
      navigation.navigate('AgentEditor', {agentId: id});
    } catch (error) {
      showToast(toastMessage('创建失败', error));
    }
  };

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <AgentList onCreate={tab => handleCreate(tab).catch(() => undefined)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});
