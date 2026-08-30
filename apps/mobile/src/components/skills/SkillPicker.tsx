/**
 * 技能引用选择器（`$` 按钮）：当前项目合并视图的平铺单选弹层。
 *
 * - 非层级浏览器：effectiveSkills 已合并同名（只显示项目副本），直接平铺；
 * - 无效技能不出现（显式引用也要有可读的 SKILL.md 才有意义）；
 * - 已关闭技能可选但标注「已关闭」——显式引用优先于项目负清单；
 * - 形态对齐 FileReferencePicker 底部弹层。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {EffectiveSkill} from '@novel-master/core/skills';
import {AppModal} from '@/components/ui/AppModal';
import {skillDomainBadgeColor, skillDomainBadgeLabel} from './skill-ui';
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
  const [skills, setSkills] = useState<EffectiveSkill[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await runtime.skills().effectiveSkills(projectId);
      setSkills(list.filter(s => s.valid));
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, [runtime, projectId]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    void load();
  }, [visible, load]);

  const pick = (skill: EffectiveSkill) => {
    onConfirm(skill.name);
    onClose();
  };

  return (
    <AppModal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.panel, {backgroundColor: tokens.surface}]}>
          <Text style={[styles.title, {color: tokens.text}]}>引用技能</Text>
          <Text style={{color: tokens.textSecondary, marginBottom: 8}}>
            单选插入 `$技能名`；已关闭技能显式引用后仍生效
          </Text>
          {loading ? (
            <ActivityIndicator color={tokens.primary} />
          ) : (
            <FlatList
              data={skills}
              keyExtractor={item => item.name}
              style={styles.list}
              ListEmptyComponent={
                <Text style={{color: tokens.textSecondary}}>
                  当前项目暂无可用技能
                </Text>
              }
              renderItem={({item}) => (
                <Pressable
                  testID={`skill-picker-row-${item.name}`}
                  style={({pressed}) => [
                    styles.row,
                    {opacity: pressed ? 0.85 : item.disabled ? 0.55 : 1},
                  ]}
                  onPress={() => pick(item)}
                  accessibilityLabel={`引用技能 ${item.name}`}
                >
                  <View style={styles.rowBody}>
                    <View style={styles.titleRow}>
                      <Text
                        style={{
                          color: tokens.text,
                          fontSize: 15,
                          fontWeight: '600',
                        }}
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
                            {
                              color: tokens.textSecondary,
                              borderColor: tokens.border,
                            },
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
                </Pressable>
              )}
            />
          )}
          <View style={styles.foot}>
            <Pressable onPress={onClose} style={styles.footBtn}>
              <Text style={{color: tokens.text}}>取消</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  panel: {
    maxHeight: '80%',
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  title: {fontSize: 18, fontWeight: '600', marginBottom: 4},
  list: {maxHeight: 360},
  row: {paddingVertical: 10},
  rowBody: {gap: 4},
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
  foot: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 12,
  },
  footBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
});
