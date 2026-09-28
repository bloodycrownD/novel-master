/**
 * 内置 general 子智能体的只读详情（AgentEditor 的 general sentinel 分支）。
 *
 * 数据来自 core 的 DEFAULT_SUBAGENT_DEFINITION（运行时虚拟注入），
 * registry 中并无对应实体（get("general") 为 AGENT_NOT_FOUND），故这里
 * 只做只读呈现：无表单、无保存、无 dirty 上报。
 */
import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {DEFAULT_SUBAGENT_DEFINITION} from '@novel-master/core/agent';
import {MODE_OPTIONS} from '@novel-master/core/config-forms/agent';
import {useTheme} from '../../theme/ThemeProvider';

/** 只读字段行：小标签 + 正文（缺省显示「—」）。 */
function DetailField({
  label,
  value,
  tokens,
  multiline,
}: {
  label: string;
  value?: string;
  tokens: {
    text: string;
    textSecondary: string;
    borderLight: string;
    background: string;
  };
  multiline?: boolean;
}) {
  return (
    <View style={[styles.field, {borderColor: tokens.borderLight}]}>
      <Text style={[styles.fieldLabel, {color: tokens.textSecondary}]}>
        {label}
      </Text>
      <Text
        style={[styles.fieldValue, {color: tokens.text}]}
        numberOfLines={multiline ? undefined : 1}
      >
        {value && value.trim().length > 0 ? value : '—'}
      </Text>
    </View>
  );
}

export function BuiltinAgentDetail() {
  const {tokens} = useTheme();
  const def = DEFAULT_SUBAGENT_DEFINITION;
  // 作用域文案复用编辑表单的 MODE_OPTIONS（单源），缺省按 all 解释。
  const modeLabel =
    MODE_OPTIONS.find(option => option.value === (def.mode ?? 'all'))?.label ??
    (def.mode ?? 'all');

  return (
    <ScrollView
      style={[styles.root, {backgroundColor: tokens.background}]}
      contentContainerStyle={styles.content}
    >
      <View style={[styles.banner, {backgroundColor: `${tokens.primary}1A`}]}>
        <Text style={[styles.bannerText, {color: tokens.primary}]}>
          内置智能体，不可编辑
        </Text>
      </View>
      <View
        style={[
          styles.card,
          {
            backgroundColor: tokens.surfaceElevated,
            borderColor: tokens.borderLight,
          },
        ]}
      >
        <DetailField label="名称" value={def.name} tokens={tokens} />
        <DetailField label="描述" value={def.description} tokens={tokens} />
        <DetailField label="作用域" value={modeLabel} tokens={tokens} />
        <DetailField
          label="系统提示词"
          value={def.prompts.system}
          tokens={tokens}
          multiline
        />
        <DetailField
          label="助手确认语（常驻工作区）"
          value={def.prompts.workplace}
          tokens={tokens}
          multiline
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {padding: 12, gap: 12},
  banner: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  bannerText: {fontSize: 13, fontWeight: '600'},
  card: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  field: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  fieldLabel: {fontSize: 12},
  fieldValue: {fontSize: 14, lineHeight: 20},
});
