/**
 * Agent name + model label under conversation header (prototype chat-meta).
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {ChatAgentMeta} from '@/services/chat-agent-meta';
import {useTheme} from '@/theme/ThemeProvider';

type Props = {
  meta: ChatAgentMeta;
};

export function ChatMetaBar({meta}: Props) {
  const {tokens} = useTheme();
  const showTokens = meta.tokenLabel.length > 0;
  const agentLocked = meta.source === 'project-custom';
  return (
    <View style={[styles.bar, {borderBottomColor: tokens.border}]}>
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
        <Text style={[styles.fieldLabel, {color: tokens.textSecondary}]}>
          模型
        </Text>
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
      </View>
    </View>
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
    maxWidth: '58%',
    gap: 2,
  },
  model: {fontSize: 14, fontWeight: '600'},
  tokens: {fontSize: 12},
});
