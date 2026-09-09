/**
 * 编辑技能信息弹窗（重命名 + 描述编辑同一提交）。
 *
 * - 提交走 runtime skills updateSkillInfo（core 单事务：目录迁移 +
 *   front matter 同步 + 负清单迁移）；仅提交真正变更的字段。
 * - global 域内置技能名称框只读（core 侧 BUILTIN_SKILL_RENAME 双保险）；
 *   仅改描述对内置技能放行。
 * - invalid 技能入口由调用方禁用（core 侧跳过 front matter 重写双保险），
 *   本组件不处理 invalid 态。
 */
import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  BUILTIN_SKILL_NAMES,
  validateSkillName,
  type SkillDomain,
} from '@novel-master/core/skills';
import {ModalShell} from '@/components/ui/ModalShell';
import {useRuntime} from '@/hooks/useRuntime';
import {useTheme} from '@/theme/ThemeProvider';

/** 待编辑技能定位（跳详情同构）。 */
export type SkillInfoTarget = {
  domain: SkillDomain;
  name: string;
  projectId?: string;
};

type Props = {
  visible: boolean;
  /** 待编辑技能（含域定位）。 */
  target: SkillInfoTarget;
  currentDescription: string | null;
  onClose: () => void;
  /** 保存成功；参数为最新技能名（可能已改名，调用方刷新导航状态）。 */
  onSaved: (name: string) => void;
};

export function SkillInfoEditModal({
  visible,
  target,
  currentDescription,
  onClose,
  onSaved,
}: Props) {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const [name, setName] = useState(target.name);
  const [description, setDescription] = useState(currentDescription ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // 每次打开以当前值重置（技能切换/描述外部变更都跟随）
  useEffect(() => {
    if (!visible) {
      return;
    }
    setName(target.name);
    setDescription(currentDescription ?? '');
    setError(undefined);
  }, [visible, target.name, currentDescription]);

  if (!visible) {
    return null;
  }

  const builtin =
    target.domain === 'global' && BUILTIN_SKILL_NAMES.has(target.name);
  const nameChanged = !builtin && name !== target.name;
  const descChanged = description !== (currentDescription ?? '');
  const nameIssue =
    nameChanged && name.length > 0 ? validateSkillName(name) : null;
  const canSubmit =
    (nameChanged || descChanged) &&
    nameIssue == null &&
    name.length > 0 &&
    !saving;

  const handleSave = async () => {
    if (!canSubmit) {
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await runtime.skills().updateSkillInfo(
        {
          domain: target.domain,
          name: target.name,
          ...(target.domain === 'project' && target.projectId != null
            ? {projectId: target.projectId}
            : {}),
        },
        {
          ...(nameChanged ? {newName: name} : {}),
          ...(descChanged ? {description} : {}),
        },
      );
      onSaved(nameChanged ? name : target.name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      visible={visible}
      onClose={onClose}
      variant="bottom"
      animationType="slide"
      keyboardAvoid={{kind: 'adaptive', maxHeightRatio: 0.85}}
      panelStyle={styles.panel}
    >
      <Text style={[styles.title, {color: tokens.text}]}>编辑信息</Text>
      <ScrollView
        style={styles.form}
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.label, {color: tokens.textSecondary}]}>
          {builtin ? '技能名（内置技能不可改名）' : '技能名'}
        </Text>
        <TextInput
          testID="skill-info-name-input"
          style={[
            styles.input,
            {
              color: builtin ? tokens.textSecondary : tokens.text,
              borderColor: nameIssue ? tokens.danger : tokens.border,
              backgroundColor: tokens.background,
            },
          ]}
          value={name}
          onChangeText={setName}
          editable={!builtin}
          autoCorrect={false}
        />
        {nameIssue ? (
          <Text style={[styles.error, {color: tokens.danger}]}>{nameIssue}</Text>
        ) : null}
        <Text style={[styles.label, {color: tokens.textSecondary}]}>描述</Text>
        <TextInput
          testID="skill-info-description-input"
          style={[
            styles.input,
            styles.descriptionInput,
            {color: tokens.text, borderColor: tokens.border, backgroundColor: tokens.background},
          ]}
          value={description}
          onChangeText={setDescription}
          placeholder="进入技能索引，模型据此决定是否使用"
          placeholderTextColor={tokens.textSecondary}
          multiline
        />
        {error ? (
          <Text style={[styles.error, {color: tokens.danger}]}>{error}</Text>
        ) : null}
      </ScrollView>
      <View style={styles.foot}>
        <Pressable onPress={onClose} style={styles.footBtn}>
          <Text style={{color: tokens.textSecondary}}>取消</Text>
        </Pressable>
        <Pressable
          testID="skill-info-submit"
          style={[
            styles.footBtn,
            {backgroundColor: canSubmit ? tokens.primary : tokens.border},
          ]}
          disabled={!canSubmit}
          onPress={() => handleSave().catch(() => undefined)}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={{color: '#fff', fontWeight: '600'}}>保存</Text>
          )}
        </Pressable>
      </View>
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: 8,
  },
  form: {flexGrow: 0, flexShrink: 1},
  formContent: {gap: 8},
  title: {fontSize: 18, fontWeight: '600'},
  label: {fontSize: 13, marginTop: 4},
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  descriptionInput: {
    minHeight: 72,
    maxHeight: 140,
    textAlignVertical: 'top',
  },
  error: {fontSize: 12, lineHeight: 16},
  foot: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  footBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 88,
    alignItems: 'center',
  },
});
