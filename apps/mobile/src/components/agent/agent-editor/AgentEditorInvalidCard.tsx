/**
 * Agent 加载失败 / 配置损坏的恢复卡（comp-rest/C-3 自 AgentEditorForm 拆出）：
 * 返回 / 覆盖默认 / 删除三个动作的语义保持原样。
 */
import React from 'react';
import {Pressable, Text, View} from 'react-native';

import {STORED_CONFIG_LABELS} from '@novel-master/core/config-forms/stored-config-validity';

import {styles} from './agent-editor-form.styles';
import {type AgentEditorTokens} from './agent-editor-types';

type Props = {
  tokens: AgentEditorTokens;
  title: string;
  reason: string;
  detail: string;
  recovering: boolean;
  onBack: () => void;
  /** 仅配置损坏时提供（加载失败不显示覆盖入口）。 */
  onOverwriteDefault?: () => void;
  onDelete: () => void;
};

export function AgentEditorInvalidCard({
  tokens,
  title,
  reason,
  detail,
  recovering,
  onBack,
  onOverwriteDefault,
  onDelete,
}: Props) {
  return (
    <View style={styles.invalidWrap}>
      <View
        style={[
          styles.invalidCard,
          {borderColor: tokens.border, backgroundColor: tokens.surface},
        ]}>
        <Text style={[styles.invalidTitle, {color: tokens.text}]}>{title}</Text>
        <Text style={[styles.invalidReason, {color: tokens.textSecondary}]}>
          {reason}
        </Text>
        {typeof __DEV__ !== 'undefined' && __DEV__ && detail.length > 0 ? (
          <Text style={[styles.invalidDetail, {color: tokens.textTertiary}]}>
            {detail}
          </Text>
        ) : null}
        <View style={styles.invalidActions}>
          <Pressable disabled={recovering} onPress={onBack}>
            <Text
              style={{
                color: tokens.primary,
                fontSize: 14,
                fontWeight: '600',
              }}>
              {STORED_CONFIG_LABELS.agentBack}
            </Text>
          </Pressable>
          {onOverwriteDefault != null ? (
            <Pressable disabled={recovering} onPress={onOverwriteDefault}>
              <Text
                style={{
                  color: tokens.primary,
                  fontSize: 14,
                  fontWeight: '600',
                }}>
                {STORED_CONFIG_LABELS.agentOverwriteDefault}
              </Text>
            </Pressable>
          ) : null}
          <Pressable disabled={recovering} onPress={onDelete}>
            <Text
              style={{
                color: tokens.danger,
                fontSize: 14,
                fontWeight: '600',
              }}>
              {STORED_CONFIG_LABELS.agentDelete}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
