/**
 * 新建技能弹窗：手进模板或从 ZIP 导入预填。存储域由调用方拍板（管理页跟
 * 当前 tab，会话面板固定当前项目域），弹窗内不再切换，避免项目下拉
 * 出现/消失引发布局跳动。
 *
 * 导入 = 选 zip（本产品导出格式：根即技能目录）→ 预填 name/description
 * （可改）→ 创建时 zip 内全部文件落入新技能目录，SKILL.md 的 front
 * matter 以表单最终值为准重写（表单未改则不重写）。手进创建 = 向目标
 * 域写仅含 SKILL.md 的新目录。
 */
import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {ChatProject} from '@novel-master/core/chat';
import {
  previewSkillZip,
  validateSkillName,
  type SkillDomain,
  type SkillZipPreview,
} from '@novel-master/core/skills';
import {createVfsZipIoService, type VfsScope} from '@novel-master/core/vfs';
import {ModalShell} from '@/components/ui/ModalShell';
import {BottomSheetMenu} from '@/components/sheet/BottomSheetMenu';
import {buildNewSkillDoc, yamlScalar} from './skill-ui';
import {pickZipFileBytes} from '@/services/vfs-zip.service';
import {useRuntime} from '@/hooks/useRuntime';
import {useTheme} from '@/theme/ThemeProvider';

export type NewSkillTarget = {
  domain: SkillDomain;
  name: string;
  projectId?: string;
};

type Props = {
  visible: boolean;
  /** 存储域（固定）：管理页跟当前 tab，会话面板固定当前项目域。 */
  domain: SkillDomain;
  /** 预选项目（选项目域时的默认所属项目，传入则不再显示下拉）。 */
  defaultProjectId?: string;
  onClose: () => void;
  /** 创建成功（zip 导入或模板创建已落盘）；父组件负责跳详情与刷新。 */
  onCreated: (target: NewSkillTarget) => void;
};

/** 导入态：zip 字节（创建时落盘）+ 预检结果（预填与 front matter 重写判定）。 */
type ImportedSkill = {
  readonly bytes: Uint8Array;
  readonly preview: SkillZipPreview;
};

/**
 * 以表单最终值为准重写 SKILL.md front matter（保留其余键与正文）。
 * 无 front matter 块时前置补一个；值用 YAML 双引号标量，含冒号/换行不出错。
 */
function withFrontMatterValues(
  source: string,
  name: string,
  description: string,
): string {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const fmLine = (key: string, value: string) => `${key}: ${yamlScalar(value)}`;
  if (match == null) {
    return `---\n${fmLine('name', name)}\n${fmLine(
      'description',
      description,
    )}\n---\n\n${source}`;
  }
  let fm = match[1]!;
  const values: ReadonlyArray<[string, string]> = [
    ['name', name],
    ['description', description],
  ];
  for (const [key, value] of values) {
    const re = new RegExp(`^${key}:.*$`, 'm');
    fm = re.test(fm)
      ? fm.replace(re, fmLine(key, value))
      : `${fm}\n${fmLine(key, value)}`;
  }
  return source.replace(match[0], `---\n${fm}\n---\n`);
}

export function NewSkillModal({
  visible,
  domain,
  defaultProjectId,
  onClose,
  onCreated,
}: Props) {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [projectId, setProjectId] = useState<string | undefined>(
    defaultProjectId,
  );
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<ImportedSkill | null>(null);
  const [error, setError] = useState<string | undefined>();
  // 底部高面板 + 技能名/描述输入：键盘避让用 ModalShell 的 adaptive 策略
  //（上移 + maxHeight 收缩，面板高度随键盘收紧）；iOS 走 KAV padding 分支。

  useEffect(() => {
    if (!visible) {
      return;
    }
    setName('');
    setDescription('');
    setProjectId(defaultProjectId);
    setImported(null);
    setError(undefined);
  }, [visible, defaultProjectId]);

  // 项目下拉仅在「项目域且调用方未锁定项目」（管理页项目 tab）时需要。
  const needsProjectPicker = domain === 'project' && defaultProjectId == null;

  useEffect(() => {
    if (!visible || !needsProjectPicker) {
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
            prev != null && list.some(p => p.id === prev) ? prev : list[0]?.id,
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
  }, [visible, runtime, needsProjectPicker]);

  const selectedProject = useMemo(
    () => projects.find(p => p.id === projectId),
    [projects, projectId],
  );

  const nameIssue = name.length > 0 ? validateSkillName(name) : null;
  const descriptionIssue =
    description.length === 0
      ? '描述不能为空（进入索引，供模型判断是否使用）'
      : null;
  const projectIssue =
    domain === 'project' && projectId == null ? '请选择所属项目' : null;
  const canSubmit =
    name.length > 0 &&
    description.length > 0 &&
    nameIssue == null &&
    projectIssue == null &&
    !creating;

  /** 选 zip → 预检 → 预填 name/description（可改）；取消选择不动表单。 */
  const handleImport = async () => {
    if (importing) {
      return;
    }
    setImporting(true);
    setError(undefined);
    try {
      const bytes = await pickZipFileBytes();
      if (bytes == null) {
        return;
      }
      const preview = previewSkillZip(bytes);
      if (preview.skillMd == null) {
        setError('ZIP 根目录缺少 SKILL.md（导出格式：zip 根即技能目录）');
        return;
      }
      setImported({bytes, preview});
      setName(preview.name ?? '');
      setDescription(preview.description ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

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
      if (imported != null) {
        // ZIP 是第二条新建通道（不经 writeSkillFile 的 D2② 门）：落盘前
        // 先过保留名校验，拒绝时不落盘（CR D-1）。SkillError 的中文
        // message 由 catch 分支冒泡展示。
        await runtime
          .skills()
          .assertSkillNameNotReservedForCreate(
            domain,
            name,
            domain === 'project' ? projectId : undefined,
          );
        // 导入创建：zip 内全部文件落入新技能目录（目录新建为空，无覆盖风险），
        // 表单值与 zip 元数据不一致时重写 SKILL.md front matter（保留正文）。
        // 技能已重定位到独立 meta 域，导入 scope 取 meta 域。
        const scope: VfsScope =
          domain === 'global'
            ? {kind: 'global-meta'}
            : {kind: 'project-meta', projectId: projectId!};
        const zipSvc = createVfsZipIoService(runtime.conn);
        await zipSvc.import(scope, imported.bytes, {
          confirmed: true,
          directoryPath: `/meta/skills/${name}`,
        });
        if (
          imported.preview.name !== name ||
          imported.preview.description !== description
        ) {
          // 重写目标是刚导入落盘的 SKILL.md（已存在文件），不带版本会被
          // VFS 乐观锁拒绝（CONFLICT）：先 read 拿版本再写入（对齐 desktop）。
          const read = await runtime
            .skills()
            .readSkillFile(
              domain,
              name,
              'SKILL.md',
              domain === 'project' ? projectId : undefined,
            );
          await runtime
            .skills()
            .writeSkillFile(
              domain,
              name,
              'SKILL.md',
              withFrontMatterValues(
                imported.preview.skillMd!,
                name,
                description,
              ),
              domain === 'project' ? projectId : undefined,
              {expectedVersion: read.version},
            );
        }
      } else {
        await runtime
          .skills()
          .writeSkillFile(
            domain,
            name,
            'SKILL.md',
            buildNewSkillDoc(name, description),
            domain === 'project' ? projectId : undefined,
          );
      }
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
    <>
      <Text style={[styles.title, {color: tokens.text}]}>新建技能</Text>
      {imported != null ? (
        <View style={styles.importRow}>
          <Text
            style={{color: tokens.textSecondary, flex: 1}}
            numberOfLines={1}
          >
            已导入 ZIP · {imported.preview.fileCount} 个文件（创建后全部带入）
          </Text>
          <Pressable
            testID="new-skill-import-clear"
            onPress={() => setImported(null)}
            hitSlop={8}
          >
            <Text style={{color: tokens.primary}}>移除</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          testID="new-skill-import-btn"
          style={[styles.importBtn, {borderColor: tokens.border}]}
          disabled={importing}
          onPress={() => handleImport().catch(() => undefined)}
        >
          {importing ? (
            <ActivityIndicator size="small" color={tokens.primary} />
          ) : (
            <Text style={{color: tokens.primary}}>从 ZIP 导入…</Text>
          )}
        </Pressable>
      )}
      <ScrollView
        style={styles.form}
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text
          style={[styles.label, {color: tokens.textSecondary}]}
          testID="new-skill-name-label"
        >
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
          <Text style={[styles.error, {color: tokens.danger}]}>
            {nameIssue}
          </Text>
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
        {needsProjectPicker ? (
          <>
            <Text style={[styles.label, {color: tokens.textSecondary}]}>
              所属项目
            </Text>
            <Pressable
              testID="new-skill-project-picker"
              style={[styles.projectPicker, {borderColor: tokens.border}]}
              onPress={() => setProjectMenuOpen(true)}
            >
              <Text style={{color: tokens.text, flex: 1}} numberOfLines={1}>
                {selectedProject ? selectedProject.name : '选择所属项目'}
              </Text>
              <Text style={{color: tokens.textSecondary}}>▾</Text>
            </Pressable>
          </>
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
          onPress={() => handleCreate().catch(() => undefined)}
        >
          {creating ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={{color: '#fff', fontWeight: '600'}}>创建</Text>
          )}
        </Pressable>
      </View>
    </>
  );

  return (
    <>
      <ModalShell
        visible={visible}
        onClose={onClose}
        variant="bottom"
        animationType="slide"
        keyboardAvoid={{kind: 'adaptive', maxHeightRatio: 0.85}}
        panelStyle={styles.panel}
      >
        {sheetContent}
      </ModalShell>
      <BottomSheetMenu
        visible={projectMenuOpen}
        title="选择所属项目"
        items={projects.map(p => ({label: p.name, action: p.id}))}
        onSelect={action => setProjectId(action)}
        onClose={() => setProjectMenuOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  panel: {
    // maxHeight（含键盘收缩）由 ModalShell 的 adaptive 策略管
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: 8,
  },
  // flexGrow:0 防止表单区反向撑开面板；flexShrink:1 在内容超高时收缩内部滚动，
  // 保住标题与底部按钮的可见性。
  form: {flexGrow: 0, flexShrink: 1},
  formContent: {gap: 8},
  title: {fontSize: 18, fontWeight: '600'},
  importBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
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
    // 多行输入限高：防止超长描述把输入框撑到占据整个面板
    maxHeight: 140,
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
