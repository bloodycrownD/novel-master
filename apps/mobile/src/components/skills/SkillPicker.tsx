/**
 * 技能引用选择器（`$` 按钮）：当前项目合并视图的平铺单选弹层。
 *
 * - 非层级浏览器：effectiveSkills 已合并同名（只显示项目副本），直接平铺；
 * - 无效技能不出现（显式引用也要有可读的 SKILL.md 才有意义）；
 * - 已关闭技能可选但标注「已关闭」——显式引用优先于项目负清单；
 * - 骨架（加载/错误重试/空态/列表）由 PickerListModal 承担。
 */
import React, {useCallback} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {EffectiveSkill} from '@novel-master/core/skills';
import {
  skillDomainBadgeColor,
  skillDomainBadgeLabel,
} from '@/components/skills/skill-ui';
import {
  PickerListModal,
  type PickerListLoadResult,
} from '@/components/ui/PickerListModal';
import {useRuntime} from '@/hooks/useRuntime';
import {useTheme} from '@/theme/ThemeProvider';

export type SkillPickerProps = {
  visible: boolean;
  projectId: string;
  onClose: () => void;
  /** 单选后回抛技能名，由调用方插 `$技能名` token。 */
  onConfirm: (skillName: string) => void;
};

export function SkillPicker({
  visible,
  projectId,
  onClose,
  onConfirm,
}: SkillPickerProps) {
  const {tokens} = useTheme();
  const runtime = useRuntime();

  const load = useCallback(async (): Promise<
    PickerListLoadResult<EffectiveSkill>
  > => {
    const list = await runtime.skills().effectiveSkills(projectId);
    return {rows: list.filter(s => s.valid)};
  }, [runtime, projectId]);

  return (
    <PickerListModal
      visible={visible}
      title="引用技能"
      subtitle="单选插入 $技能名；已关闭技能显式引用后仍生效"
      load={load}
      keyExtractor={item => item.name}
      renderRow={item => (
        <View style={styles.rowBody}>
          <View style={styles.titleRow}>
            <Text
              style={{color: tokens.text, fontSize: 15, fontWeight: '600'}}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            <Text
              style={[
                styles.badge,
                {
                  color: skillDomainBadgeColor(item.domain, tokens),
                  borderColor: tokens.border,
                },
              ]}
            >
              {skillDomainBadgeLabel(item.domain, item.overridden)}
            </Text>
            {item.disabled ? (
              <Text
                style={[
                  styles.badge,
                  {color: tokens.textSecondary, borderColor: tokens.border},
                ]}
              >
                已关闭
              </Text>
            ) : null}
          </View>
          {item.description ? (
            <Text
              style={{color: tokens.textSecondary, fontSize: 13}}
              numberOfLines={2}
            >
              {item.description}
            </Text>
          ) : null}
        </View>
      )}
      getRowProps={item => ({
        testID: `skill-picker-row-${item.name}`,
        accessibilityLabel: `引用技能 ${item.name}`,
        opacity: item.disabled ? 0.55 : undefined,
      })}
      onPick={item => {
        onConfirm(item.name);
        onClose();
      }}
      emptyText="当前项目暂无可用技能"
      onClose={onClose}
      // 还原旧面板观感（cr-fix-spec ui-parity P2-4）：maxHeight 80%、圆角 16、取消色主文字色。
      sheetStyle={styles.sheetOverride}
      cancelColor={tokens.text}
    />
  );
}

const styles = StyleSheet.create({
  // 覆盖 PickerListModal 默认 sheet（70%/圆角 12），还原旧 SkillPicker 观感。
  sheetOverride: {
    maxHeight: '80%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  rowBody: {flex: 1, gap: 4},
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  badge: {
    fontSize: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
});
