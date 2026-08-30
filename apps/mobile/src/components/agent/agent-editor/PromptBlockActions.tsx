/**
 * prompt 块卡头部的上移/下移/删除操作行（comp-rest/C-3 自 AgentEditorForm 拆出），
 * persist 与 dynamic 两个区块共用。
 */
import React from 'react';
import {Pressable, Text, View} from 'react-native';

import {styles} from './agent-editor-form.styles';
import {type AgentEditorTokens} from './agent-editor-types';

type Props = {
  index: number;
  total: number;
  tokens: AgentEditorTokens;
  onMove: (i: number, d: -1 | 1) => void;
  onDelete: (i: number) => void;
};

export function PromptBlockActions({
  index,
  total,
  tokens,
  onMove,
  onDelete,
}: Props) {
  return (
    <View style={styles.blockActions}>
      {index > 0 ? (
        <Pressable
          style={[
            styles.actionBtn,
            {borderColor: tokens.border, backgroundColor: tokens.surface},
          ]}
          onPress={() => onMove(index, -1)}
        >
          <Text style={{color: tokens.textSecondary}}>↑</Text>
        </Pressable>
      ) : null}
      {index < total - 1 ? (
        <Pressable
          style={[
            styles.actionBtn,
            {borderColor: tokens.border, backgroundColor: tokens.surface},
          ]}
          onPress={() => onMove(index, 1)}
        >
          <Text style={{color: tokens.textSecondary}}>↓</Text>
        </Pressable>
      ) : null}
      <Pressable
        style={[
          styles.actionBtn,
          {borderColor: tokens.border, backgroundColor: tokens.surface},
        ]}
        onPress={() => onDelete(index)}
      >
        <Text style={{color: tokens.danger}}>×</Text>
      </Pressable>
    </View>
  );
}
