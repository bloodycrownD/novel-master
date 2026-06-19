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
  return (
    <View style={[styles.bar, {borderBottomColor: tokens.border}]}>
      <Text style={[styles.agent, {color: tokens.text}]} numberOfLines={1}>
        {meta.agentName}
      </Text>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  agent: {fontSize: 14, fontWeight: '600', flex: 1},
  metaRight: {
    alignItems: 'flex-end',
    flexShrink: 1,
    maxWidth: '58%',
    gap: 2,
  },
  model: {fontSize: 13},
  tokens: {fontSize: 12},
});
