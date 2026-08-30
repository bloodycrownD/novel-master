/**
 * prompt 布局卡内四区的小标题行（comp-rest/C-3 自 AgentEditorForm 拆出）：
 * 左侧区名 + 右侧「添加」/开关，内容原样搬运。
 */
import React from 'react';
import {Pressable, Switch, Text, View} from 'react-native';

import {styles} from './agent-editor-form.styles';
import {type AgentEditorTokens} from './agent-editor-types';

type Props = {
  label: string;
  tokens: AgentEditorTokens;
  onAdd?: () => void;
  switchValue?: boolean;
  onSwitchChange?: (value: boolean) => void;
};

export function PromptSectionHead({
  label,
  tokens,
  onAdd,
  switchValue,
  onSwitchChange,
}: Props) {
  return (
    <View style={styles.sectionHead}>
      <Text style={[styles.sectionLabel, {color: tokens.text}]}>{label}</Text>
      <View style={styles.sectionHeadActions}>
        {onAdd != null ? (
          <Pressable onPress={onAdd}>
            <Text style={{color: tokens.primary, fontWeight: '600'}}>添加</Text>
          </Pressable>
        ) : null}
        {switchValue !== undefined && onSwitchChange != null ? (
          <Switch
            value={switchValue}
            onValueChange={onSwitchChange}
            trackColor={{false: tokens.border, true: tokens.primary}}
          />
        ) : null}
      </View>
    </View>
  );
}
