/**
 * Stack screen: agent registry list and create (replaces Agents tab).
 */
import React from 'react';
import {StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {AgentList} from '@/components/agent/AgentList';
import {useToast} from '@/components/chrome/ToastHost';
import {ToastMessage} from '@/errors/toast-message';
import {useRuntime} from '@/hooks/useRuntime';
import type {RootStackParamList} from '@/navigation/types';
import {AgentCreate} from '@/services/agent-create';
import {useTheme} from '@/theme/ThemeProvider';
import {coreT} from '@/i18n/core';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function AgentsSettingsScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      {/* 新建默认作用域随 tab 落库：主 tab → primary、子 tab → subagent。 */}
      <AgentList
        onCreate={tab => {
          const mode = tab === 'primary' ? 'primary' : 'subagent';
          void AgentCreate.createBlank(runtime, undefined, mode).then(created => {
            if (!created.ok) {
              showToast(ToastMessage.toast(coreT({key: "ui.common.create_failed"}), created.error));
              return;
            }
            navigation.navigate('AgentEditor', {agentId: created.value});
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});
