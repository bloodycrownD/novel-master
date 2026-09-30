/**
 * 手输 `$` 技能 typeahead：最多 5 条；按名称 / 描述模糊匹配。
 * 点选插入完整 `$技能名` token（形态对齐 AtPathTypeahead）。
 */
import React from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import type {EffectiveSkill} from '@novel-master/core/skills';
import {useTheme} from '@/theme/ThemeProvider';
import {TypeaheadList, typeaheadItemStyle} from './TypeaheadList';

// 候选过滤已抽到纯 .ts（随 dock WebView 化要入 web bundle），本文件 re-export
// 以保持既有消费方（ChatComposer / PromptEditorScreen 等）的 import 路径不变。
export {filterSkillTypeaheadCandidates} from './skill-typeahead-filter';

export type SkillTypeaheadProps = {
  open: boolean;
  candidates: readonly EffectiveSkill[];
  onSelect: (name: string) => void;
};

export function SkillTypeahead({
  open,
  candidates,
  onSelect,
}: SkillTypeaheadProps) {
  const {tokens} = useTheme();
  if (!open || candidates.length === 0) {
    return null;
  }
  return (
    <TypeaheadList accessibilityLabel="技能建议">
      {candidates.map(skill => (
        <Pressable
          key={skill.name}
          testID={`skill-typeahead-${skill.name}`}
          style={[typeaheadItemStyle, styles.item]}
          onPress={() => onSelect(skill.name)}
        >
          <Text style={{color: tokens.text, flexShrink: 1}} numberOfLines={1}>
            $ {skill.name}
          </Text>
          <Text
            style={[styles.tag, {color: tokens.textSecondary}]}
            numberOfLines={1}
          >
            {skill.disabled
              ? '已关闭'
              : skill.domain === 'global'
              ? '全局'
              : skill.overridden
              ? '项目 · 覆盖全局'
              : '项目'}
          </Text>
        </Pressable>
      ))}
    </TypeaheadList>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tag: {fontSize: 11, flexShrink: 0},
});
