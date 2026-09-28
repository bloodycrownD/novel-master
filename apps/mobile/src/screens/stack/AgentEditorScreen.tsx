/**
 * Full-screen agent editor (stack route).
 */
import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {DEFAULT_SUBAGENT_DEFINITION} from '@novel-master/core/agent';
import {AgentEditorForm} from '@/components/agent/AgentEditorForm';
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

  // 内置 general sentinel：registry 无此实体（不落库），渲染与其他 agent 同构的
  // 完整编辑器表单，但整体只读——数据由出厂定义常量直填（不走 registry 拉取），
  // 全部控件禁用灰显、无保存栏；dirty 恒为 false，不触发未保存守卫。
  if (agentId === 'general') {
    return (
      <View style={[styles.root, {backgroundColor: tokens.background}]}>
        <AgentEditorForm
          agentId={agentId}
          readOnly
          initialDefinition={DEFAULT_SUBAGENT_DEFINITION}
        />
      </View>
    );
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
