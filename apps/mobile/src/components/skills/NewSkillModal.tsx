/**
 * 新建技能弹窗：技能名 + 描述 + 存储域分段（全局 / 项目）+ 所属项目下拉。
 *
 * 创建 = 向目标域写仅含 SKILL.md 的新目录（front matter 自动填
 * name/description）；「创建并编辑」成功后由父组件跳技能详情页。
 */
import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import {KeyboardAvoidingView} from 'react-native-keyboard-controller';
import type {ChatProject} from '@novel-master/core/chat';
import {
  validateSkillName,
  type SkillDomain,
} from '@novel-master/core/skills';
import {AppModal} from '@/components/ui/AppModal';
import {BottomSheetMenu} from '@/components/sheet/BottomSheetMenu';
import {SegmentedControl} from '@/components/ui/SegmentedControl';
import {buildNewSkillDoc} from './skill-ui';
import {useAndroidModalKeyboardAvoid} from '@/hooks/useAndroidModalKeyboardAvoid';
import {useRuntime} from '@/hooks/useRuntime';
import {useTheme} from '@/theme/ThemeProvider';

export type NewSkillTarget = {
  domain: SkillDomain;
  name: string;
  projectId?: string;
};

type Props = {
  visible: boolean;
  /** 打开时预选的域（面板默认 project，管理页按当前 tab 预选）。 */
  defaultDomain: SkillDomain;
  /** 预选项目（选项目域时的默认所属项目）。 */
  defaultProjectId?: string;
  onClose: () => void;
  /** 创建成功（writeSkillFile 已落盘）；父组件负责跳详情与刷新。 */
  onCreated: (target: NewSkillTarget) => void;
};

export function NewSkillModal({
  visible,
  defaultDomain,
  defaultProjectId,
  onClose,
  onCreated,
}: Props) {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [domain, setDomain] = useState<SkillDomain>(defaultDomain);
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [projectId, setProjectId] = useState<string | undefined>(
    defaultProjectId,
  );
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // 底部 sheet 键盘避让：Android 在 panel 上挂 translateY（fraction=1 整个键盘高度，
  // 照 DirectoryRuleSheet 先例）；iOS 走 KeyboardAvoidingView padding 分支。
  const panelAvoidStyle = useAndroidModalKeyboardAvoid(1);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setName('');
    setDescription('');
    setDomain(defaultDomain);
    setProjectId(defaultProjectId);
    setError(undefined);
  }, [visible, defaultDomain, defaultProjectId]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const list = await runtime.projects.list();
        if (!cancelled) {
          setProjects(list);
          // 无预选项目时默认第一个，避免「项目域但无 projectId」的空态
          setProjectId(prev =>
            prev != null && list.some(p => p.id === prev)
              ? prev
              : list[0]?.id,
          );
        }
      } catch {
        if (!cancelled) {
          setProjects([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, runtime]);

  const selectedProject = useMemo(
    () => projects.find(p => p.id === projectId),
    [projects, projectId],
  );

  const nameIssue = name.length > 0 ? validateSkillName(name) : null;
  const descriptionIssue =
    description.length === 0 ? '描述不能为空（进入索引，供模型判断是否使用）' : null;
  const projectIssue =
    domain === 'project' && projectId == null ? '请选择所属项目' : null;
  const canSubmit =
    name.length > 0 &&
    description.length > 0 &&
    nameIssue == null &&
    projectIssue == null &&
    !creating;

  const handleCreate = async () => {
    if (!canSubmit) {
      return;
    }
    setCreating(true);
    setError(undefined);
    try {
      // 域内查重：同名技能已存在时拒绝（整包覆盖语义只在复制/提升链路，新建不覆盖）
      const existing = await runtime
        .skills()
        .listSkills(domain === 'global' ? 'global' : {projectId: projectId!});
      if (existing.some(s => s.name === name)) {
        setError(`目标域已存在同名技能「${name}」`);
        return;
      }
      await runtime.skills().writeSkillFile(
        domain,
        name,
        'SKILL.md',
        buildNewSkillDoc(name, description),
        domain === 'project' ? projectId : undefined,
      );
      onCreated({
        domain,
        name,
        ...(domain === 'project' && projectId != null ? {projectId} : {}),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const sheetContent = (
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <Animated.View
        style={[
          styles.panel,
          {backgroundColor: tokens.surface},
          Platform.OS === 'android' ? panelAvoidStyle : undefined,
        ]}>
        <Text style={[styles.title, {color: tokens.text}]}>新建技能</Text>
        <ScrollView
          style={styles.form}
          contentContainerStyle={styles.formContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Text
            style={[styles.label, {color: tokens.textSecondary}]}
            testID="new-skill-name-label">
            技能名（即目录名，创建后不可改）
          </Text>
          <TextInput
            testID="new-skill-name-input"
            style={[
              styles.input,
              {
                color: tokens.text,
                borderColor: nameIssue ? tokens.danger : tokens.border,
                backgroundColor: tokens.background,
              },
            ]}
            value={name}
            onChangeText={setName}
            placeholder="如 worldbuilding-checker"
            placeholderTextColor={tokens.textSecondary}
            autoCorrect={false}
          />
          {nameIssue ? (
            <Text style={[styles.error, {color: tokens.danger}]}>{nameIssue}</Text>
          ) : null}
          <Text style={[styles.label, {color: tokens.textSecondary}]}>描述</Text>
          <TextInput
            testID="new-skill-description-input"
            style={[
              styles.input,
              styles.descriptionInput,
              {
                color: tokens.text,
                borderColor:
                  description.length > 0 && descriptionIssue
                    ? tokens.danger
                    : tokens.border,
                backgroundColor: tokens.background,
              },
            ]}
            value={description}
            onChangeText={setDescription}
            placeholder="进入技能索引，模型据此决定是否使用"
            placeholderTextColor={tokens.textSecondary}
            multiline
          />
          <Text style={[styles.label, {color: tokens.textSecondary}]}>存储域</Text>
          <SegmentedControl
            options={[
              {value: 'global', label: '全局'},
              {value: 'project', label: '项目'},
            ]}
            value={domain}
            onChange={setDomain}
            tokens={tokens}
          />
          {domain === 'project' ? (
            <Pressable
              testID="new-skill-project-picker"
              style={[styles.projectPicker, {borderColor: tokens.border}]}
              onPress={() => setProjectMenuOpen(true)}>
              <Text style={{color: tokens.text, flex: 1}} numberOfLines={1}>
                {selectedProject ? selectedProject.name : '选择所属项目'}
              </Text>
              <Text style={{color: tokens.textSecondary}}>▾</Text>
            </Pressable>
          ) : null}
          {error ? (
            <Text style={[styles.error, {color: tokens.danger}]}>{error}</Text>
          ) : null}
        </ScrollView>
        <View style={styles.foot}>
          <Pressable onPress={onClose} style={styles.footBtn}>
            <Text style={{color: tokens.textSecondary}}>取消</Text>
          </Pressable>
          <Pressable
            testID="new-skill-submit"
            style={[
              styles.footBtn,
              {backgroundColor: canSubmit ? tokens.primary : tokens.border},
            ]}
            disabled={!canSubmit}
            onPress={() => handleCreate().catch(() => undefined)}>
            {creating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={{color: '#fff', fontWeight: '600'}}>创建并编辑</Text>
            )}
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );

  return (
    <AppModal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView behavior="padding" style={styles.avoidingRoot}>
          {sheetContent}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.avoidingRoot}>{sheetContent}</View>
      )}
      <BottomSheetMenu
        visible={projectMenuOpen}
        title="选择所属项目"
        items={projects.map(p => ({label: p.name, action: p.id}))}
        onSelect={action => setProjectId(action)}
        onClose={() => setProjectMenuOpen(false)}
      />
    </AppModal>
  );
}

const styles = StyleSheet.create({
  avoidingRoot: {flex: 1},
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  panel: {
    maxHeight: '85%',
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: 8,
  },
  form: {flexGrow: 0},
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
    textAlignVertical: 'top',
  },
  projectPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
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
