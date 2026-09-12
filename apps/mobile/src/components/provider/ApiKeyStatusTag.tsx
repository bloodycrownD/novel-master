/**
 * 服务商 API Key 连接状态色块标签。
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {API_KEY_STATUS_LABELS} from '@novel-master/core/config-forms/shared';
import type {ThemeTokens} from '@/theme/tokens';

type Props = {
  status: 'set' | 'not set';
  tokens: ThemeTokens;
};

export function ApiKeyStatusTag({status, tokens}: Props) {
  const connected = status === 'set';
  return (
    <View
      style={[
        styles.tag,
        {
          backgroundColor: connected
            ? `${tokens.success}1A`
            : `${tokens.textSecondary}1A`,
        },
      ]}
    >
      <Text
        style={[
          styles.tagText,
          // 未连接态文字用主文字色：灰底胶囊已提供弱化感，文字保持高对比可读
          {color: connected ? tokens.success : tokens.text},
        ]}
      >
        {connected ? API_KEY_STATUS_LABELS.set : API_KEY_STATUS_LABELS.notSet}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    alignSelf: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
