/**
 * Agents tab: registry list + create new agent.
 */
import React from 'react';
import {Alert, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {AgentList} from '../../components/agent/AgentList';
import {AppHeader} from '../../components/chrome/AppHeader';
import {useRuntime} from '../../hooks/useRuntime';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function AgentsTabScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();

  const handleCreate = async () => {
    const id = `agent-${Date.now()}`;
    try {
      await runtime.agentRegistry.upsert(id, {
        name: 'new-agent',
        runtime: {maxSteps: 20},
        prompts: [
          {name: 'system', type: 'text', role: 'system', content: ''},
          {name: 'history', type: 'chat'},
        ],
      });
      navigation.navigate('AgentEditor', {agentId: id});
    } catch (error) {
      Alert.alert(
        '创建失败',
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <AppHeader pageKey="agents" />
      <AgentList onCreate={() => handleCreate().catch(() => undefined)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});
