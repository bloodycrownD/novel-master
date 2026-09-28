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
  /** 禁用态（只读详情）：上移/下移/删除均禁点并灰显。 */
  disabled?: boolean;
};

export function PromptBlockActions({
  index,
  total,
  tokens,
  onMove,
  onDelete,
  disabled = false,
}: Props) {
  const btnStyle = (extra?: object) => [
    styles.actionBtn,
    {
      borderColor: tokens.border,
      backgroundColor: tokens.surface,
    },
    extra,
    disabled ? styles.actionDisabled : null,
  ];
  return (
    <View style={styles.blockActions}>
      {index > 0 ? (
        <Pressable disabled={disabled} style={btnStyle()} onPress={() => onMove(index, -1)}>
          <Text style={{color: tokens.textSecondary}}>↑</Text>
        </Pressable>
      ) : null}
      {index < total - 1 ? (
        <Pressable disabled={disabled} style={btnStyle()} onPress={() => onMove(index, 1)}>
          <Text style={{color: tokens.textSecondary}}>↓</Text>
        </Pressable>
      ) : null}
      <Pressable disabled={disabled} style={btnStyle()} onPress={() => onDelete(index)}>
        <Text style={{color: tokens.danger}}>×</Text>
      </Pressable>
    </View>
  );
}
