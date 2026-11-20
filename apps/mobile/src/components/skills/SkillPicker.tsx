/**
 * 技能引用选择器（`$` 按钮）：当前项目合并视图的平铺单选弹层。
 *
 * - 非层级浏览器：effectiveSkills 已合并同名（只显示项目副本），直接平铺；
 * - 无效技能不出现（显式引用也要有可读的 SKILL.md 才有意义）；
 * - 已关闭技能可选但标注「已关闭」——显式引用优先于项目负清单；
 * - 骨架（加载/错误重试/空态/列表）由 PickerListModal 承担。
 */
import {AppError, Result} from '@novel-master/core/errors';
import React, {useCallback} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {EffectiveSkill} from '@novel-master/core/skills';
import {SkillUi} from '@/components/skills/skill-ui';
import {
  PickerListModal,
  type PickerListLoadResult,
} from '@/components/ui/PickerListModal';
import {useRuntime} from '@/hooks/useRuntime';
import {useTheme} from '@/theme/ThemeProvider';
import {coreT} from '@/i18n/core';

type SkillPickerProps = {
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
    Result<PickerListLoadResult<EffectiveSkill>, AppError>
  > => {
    const list = await runtime.skills().effectiveSkills(projectId);
    if (!list.ok) return Result.err(list.error);
    return Result.ok({rows: list.value.filter(s => s.valid)});
  }, [runtime, projectId]);

  return (
    <PickerListModal
      visible={visible}
      title={coreT({key: "ui.chat.reference_skills"})}
      subtitle={coreT({key: "ui.skills.pick_hint_mobile"})}
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
                  color: SkillUi.domainBadgeColor(item.domain, tokens),
                  borderColor: tokens.border,
                },
              ]}
            >
              {SkillUi.domainBadgeLabel(item.domain, item.overridden)}
            </Text>
            {item.disabled ? (
              <Text
                style={[
                  styles.badge,
                  {color: tokens.textSecondary, borderColor: tokens.border},
                ]}
              >
                {coreT({key: "ui.skills.disabled_tag"})}
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
        accessibilityLabel: coreT({key: "ui.skills.pick_ref_aria", params: {name: item.name}}),
        opacity: item.disabled ? 0.55 : undefined,
      })}
      onPick={item => {
        onConfirm(item.name);
        onClose();
      }}
      emptyText={coreT({key: "ui.skills.pick_empty_project"})}
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
