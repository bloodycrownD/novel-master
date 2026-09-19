/**
 * Agent name + model label under conversation header (prototype chat-meta).
 *
 * agent / model 两段都可点：传入 onPressAgent / onPressModel 即启用 Pressable
 * 反馈（press 时降透明度）。锁定判据与 SessionDetailScreen 对齐——agent 卡
 * 仅在 meta 未加载时锁定，none 态（智能体已删）放开为待重选可点击；
 * model 卡在 none 态仍锁定（智能体没了，pin 的模型无从解析）。
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {
  isAgentLocked,
  isModelLocked,
  type ChatAgentMeta,
} from '@/services/chat-agent-meta';
import {useTheme} from '@/theme/ThemeProvider';

type Props = {
  /** 未加载（undefined）按锁定/占位渲染，不出「已删待重选」语义。 */
  meta: ChatAgentMeta | undefined;
  onPressAgent?: () => void;
  onPressModel?: () => void;
};

export function ChatMetaBar({meta, onPressAgent, onPressModel}: Props) {
  const {tokens} = useTheme();
  // 未加载窗口的字段占位：'—' / 空标签；锁定判据仍走 helper（undefined → 锁）。
  const agentName = meta?.agentName ?? '—';
  const modelLabel = meta?.modelLabel ?? '—';
  const tokenLabel = meta?.tokenLabel ?? '';
  const showTokens = tokenLabel.length > 0;
  // 锁定判据统一收口到 chat-agent-meta 的 helper：agent 卡仅 meta 未加载时锁
  // （none 态放开待重选）；model 卡在 none / agent-pin 态锁定。
  const agentLocked = isAgentLocked(meta);
  const modelLocked = isModelLocked(meta);
  return (
    <View style={[styles.bar, {borderBottomColor: tokens.border}]}>
      <Pressable
        disabled={!onPressAgent}
        onPress={onPressAgent}
        accessibilityRole="button"
        accessibilityLabel={`切换智能体，当前 ${agentName}`}
        accessibilityState={{disabled: agentLocked}}
        style={({pressed}) => [styles.agentCol, pressed && styles.pressed]}
      >
        <Text style={[styles.fieldLabel, {color: tokens.textSecondary}]}>
          Agent
        </Text>
        <Text
          style={[
            styles.agent,
            {color: tokens.text},
            agentLocked && styles.agentLocked,
          ]}
          numberOfLines={1}
        >
          {agentName}
        </Text>
      </Pressable>
      <Pressable
        disabled={!onPressModel}
        onPress={onPressModel}
        accessibilityRole="button"
        accessibilityLabel={`切换模型，当前 ${modelLabel}`}
        accessibilityState={{disabled: modelLocked}}
        style={({pressed}) => [styles.metaRight, pressed && styles.pressed]}
      >
        <Text
          style={[
            styles.model,
            {color: tokens.textSecondary},
            modelLocked && styles.agentLocked,
          ]}
          numberOfLines={1}
        >
          {modelLabel}
        </Text>
        {showTokens ? (
          <Text
            style={[styles.tokens, {color: tokens.textTertiary}]}
            numberOfLines={1}
          >
            {tokenLabel}
          </Text>
        ) : null}
      </Pressable>
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
  pressed: {opacity: 0.5},
  metaRight: {
    alignItems: 'flex-end',
    flexShrink: 1,
    maxWidth: '58%',
    gap: 2,
  },
  model: {fontSize: 14, fontWeight: '600'},
  tokens: {fontSize: 12},
});
