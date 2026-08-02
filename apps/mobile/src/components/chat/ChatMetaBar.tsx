/**
 * Agent name + model label under conversation header (prototype chat-meta).
 *
 * 右侧附「详情」按钮：点击跳转会话详情页（承载原 SessionActionsDrawer 五项）。
 * `agentLocked` 现涵盖三种来源：project-custom 锁，session-bind / global 不锁。
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {ChatAgentMeta} from '@/services/chat-agent-meta';
import {useTheme} from '@/theme/ThemeProvider';

type Props = {
  meta: ChatAgentMeta;
  /** 点击右侧「详情」区域回调，通常 navigate 到 SessionDetail。 */
  onOpenDetail?: () => void;
};

export function ChatMetaBar({meta, onOpenDetail}: Props) {
  const {tokens} = useTheme();
  const showTokens = meta.tokenLabel.length > 0;
  // project-custom 时 agent 被项目截断（锁）；session-bind 是会话级绑定，可切。
  const agentLocked = meta.source === 'project-custom';
  return (
    <Pressable
      style={styles.bar}
      onPress={onOpenDetail}
      disabled={onOpenDetail == null}
      accessibilityLabel="会话详情">
      <View style={styles.agentCol}>
        <Text style={[styles.fieldLabel, {color: tokens.textSecondary}]}>
          Agent
        </Text>
        <Text
          style={[
            styles.agent,
            {color: tokens.text},
            agentLocked && styles.agentLocked,
          ]}
          numberOfLines={1}>
          {meta.agentName}
        </Text>
      </View>
      <View style={styles.metaRight}>
        <Text
          style={[styles.model, {color: tokens.textSecondary}]}
          numberOfLines={1}>
          {meta.modelLabel}
        </Text>
        {showTokens ? (
          <Text
            style={[styles.tokens, {color: tokens.textTertiary}]}
            numberOfLines={1}>
            {meta.tokenLabel}
          </Text>
        ) : null}
        {onOpenDetail ? (
          <Text style={[styles.detailHint, {color: tokens.primary}]}>
            详情 ⌄
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  agentCol: {flex: 1, minWidth: 0, gap: 2},
  fieldLabel: {fontSize: 11, fontWeight: '600', letterSpacing: 0.02},
  agent: {fontSize: 14, fontWeight: '600'},
  agentLocked: {opacity: 0.92},
  metaRight: {
    alignItems: 'flex-end',
    flexShrink: 1,
    // 收窄为 50%，给「详情」提示留出位置，避免长模型名挤掉按钮。
    maxWidth: '50%',
    gap: 2,
  },
  model: {fontSize: 14, fontWeight: '600'},
  tokens: {fontSize: 12},
  detailHint: {fontSize: 12, fontWeight: '600', marginTop: 2},
});
