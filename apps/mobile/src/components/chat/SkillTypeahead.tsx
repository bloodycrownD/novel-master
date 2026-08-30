/**
 * 手输 `$` 技能 typeahead：最多 5 条；按名称 / 描述模糊匹配。
 * 点选插入完整 `$技能名` token（形态对齐 AtPathTypeahead）。
 */
import React from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import type {EffectiveSkill} from '@novel-master/core/skills';
import {useTheme} from '@/theme/ThemeProvider';
import {TypeaheadList, typeaheadItemStyle} from './TypeaheadList';

/** 候选过滤：仅有效技能；名称 / 描述模糊匹配，最多 `limit` 条（默认 5）。 */
export function filterSkillTypeaheadCandidates(
  skills: readonly EffectiveSkill[],
  query: string,
  limit = 5,
): EffectiveSkill[] {
  const q = query.trim().toLowerCase();
  const out: EffectiveSkill[] = [];
  for (const skill of skills) {
    if (!skill.valid) {
      continue;
    }
    const nameLower = skill.name.toLowerCase();
    const descLower = skill.description?.toLowerCase() ?? '';
    if (q === '' || nameLower.includes(q) || descLower.includes(q)) {
      out.push(skill);
      if (out.length >= limit) {
        break;
      }
    }
  }
  return out;
}

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
