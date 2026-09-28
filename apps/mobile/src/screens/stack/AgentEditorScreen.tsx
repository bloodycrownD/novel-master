/**
 * Full-screen agent editor (stack route).
 */
import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {AgentEditorForm} from '@/components/agent/AgentEditorForm';
import {BuiltinAgentDetail} from '@/components/agent/BuiltinAgentDetail';
import {useUnsavedGuard} from '@/hooks/useUnsavedGuard';
import type {RootStackParamList} from '@/navigation/types';
import {useTheme} from '@/theme/ThemeProvider';

type EditorRoute = RouteProp<RootStackParamList, 'AgentEditor'>;

export function AgentEditorScreen() {
  const {tokens} = useTheme();
  const route = useRoute<EditorRoute>();
  const agentId = route.params?.agentId;
  // 「有未保存的更改」标记由 AgentEditorForm 随 snapshot 同帧渲染（下放展示层）；
  // 这里的 dirty 仅驱动返回确认（useUnsavedGuard）。
  const [dirty, setDirty] = useState(false);

  useUnsavedGuard(dirty);

  if (!agentId) {
    return (
      <View style={[styles.root, {backgroundColor: tokens.background}]}>
        <Text style={{color: tokens.textSecondary, padding: 16}}>
          缺少 agentId
        </Text>
      </View>
    );
  }

  // 内置 general sentinel：registry 无此实体（get 为 AGENT_NOT_FOUND），
  // 渲染只读详情，不走 AgentEditorForm（无保存、无 dirty 上报）。
  if (agentId === 'general') {
    return <BuiltinAgentDetail />;
  }

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <AgentEditorForm
        agentId={agentId}
        onDirtyChange={setDirty}
        onSaved={() => setDirty(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});
