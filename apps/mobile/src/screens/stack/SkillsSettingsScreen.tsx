/**
 * 设置·技能管理页：双 tab（全局默认在前 / 项目在后按所有项目分组）。
 *
 * - 管理页是全局语境：项目 tab 展示**所有项目**的项目技能（分组头项目名）。
 * - 批量：useBatchSelection + BatchCheckbox 先例，两个 tab 各自独立，
 *   切 tab 自动退出批量模式；删除文案区分「影响所有项目」/「仅该项目生效」。
 * - 行 ⋮ 菜单：编辑 / 删除；全局域加「复制到项目」，项目域加
 *   「复制到其他项目」「提升为全局」（目标同名整包覆盖，提升前确认）。
 * - D5：全局 tab「被项目副本覆盖」灰标签按「任意项目存在同名副本」判定；
 *   tab hint 注明该全局版仅对无副本的项目生效。
 */
import React, {useCallback, useMemo, useState} from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {ChatProject} from '@novel-master/core/chat';
import type {SkillDomain, SkillListItem} from '@novel-master/core/skills';
import type {VfsScope} from '@novel-master/core/vfs';
import {BatchCheckbox} from '@/components/batch/BatchCheckbox';
import {ManageHeader} from '@/components/batch/ManageHeader';
import {BottomSheetMenu, type SheetMenuItem} from '@/components/sheet/BottomSheetMenu';
import {NewSkillModal} from '@/components/skills/NewSkillModal';
import {PrimaryButton, SecondaryButton} from '@/components/ui/PrototypeButtons';
import {exportVfsZip, importVfsZip} from '@/services/vfs-zip.service';
import {SegmentedControl} from '@/components/ui/SegmentedControl';
import {useBatchSelection} from '@/hooks/useBatchSelection';
import {useRuntime} from '@/hooks/useRuntime';
import type {RootStackParamList} from '@/navigation/types';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {toastMessage} from '@/errors/toast-message';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** 行定位（⋮ 菜单 / 删除 / 跳详情共用）。 */
type SkillRow = {
  domain: SkillDomain;
  name: string;
  projectId?: string;
  projectName?: string;
  item: SkillListItem;
};

type MenuTarget = SkillRow | undefined;

const GLOBAL_TAB_HINT =
  '全局技能对所有项目生效。若任意项目存在同名副本，该项目优先使用副本——该全局版仅对无副本的项目生效。';
const PROJECT_TAB_HINT =
  '项目技能仅所属项目生效，同名时覆盖全局版。按所有项目分组展示全部项目技能。';

export function SkillsSettingsScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();

  const [tab, setTab] = useState<'global' | 'project'>('global');
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [globalSkills, setGlobalSkills] = useState<SkillListItem[]>([]);
  const [projectSkills, setProjectSkills] = useState<SkillRow[]>([]);
  const batch = useBatchSelection();
  const [menuTarget, setMenuTarget] = useState<MenuTarget>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  /** 跨项目复制的目标项目选择弹层。 */
  const [copyContext, setCopyContext] = useState<
    | {kind: 'crossProjectCopy'; skill: SkillRow}
    | undefined
  >(undefined);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [projectList, globalList] = await Promise.all([
        runtime.projects.list(),
        runtime.skills().listSkills('global'),
      ]);
      const perProject = await Promise.all(
        projectList.map(async p => {
          const list = await runtime.skills().listSkills({projectId: p.id});
          return list.map(
            (item): SkillRow => ({
              domain: 'project',
              name: item.name,
              projectId: p.id,
              projectName: p.name,
              item,
            }),
          );
        }),
      );
      setProjects(projectList);
      setGlobalSkills(globalList);
      setProjectSkills(perProject.flat());
    } catch (error) {
      showToast(toastMessage('加载技能失败', error));
    } finally {
      setLoading(false);
    }
  }, [runtime, showToast]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => undefined);
    }, [reload]),
  );

  /** 任意项目存在同名副本（D5：不按「当前项目」判定）。 */
  const overriddenGlobalNames = useMemo(() => {
    const names = new Set(projectSkills.map(s => s.name));
    return names;
  }, [projectSkills]);

  const globalRows = useMemo<SkillRow[]>(
    () =>
      globalSkills.map(item => ({
        domain: 'global' as const,
        name: item.name,
        item,
      })),
    [globalSkills],
  );

  const rows = tab === 'global' ? globalRows : projectSkills;

  const switchTab = (next: 'global' | 'project') => {
    setTab(next);
    batch.exit();
  };

  const rowKey = (row: SkillRow) =>
    row.domain === 'global' ? `global:${row.name}` : `${row.projectId}:${row.name}`;

  const openDetail = (row: SkillRow) => {
    navigation.navigate('SkillDetail', {
      domain: row.domain,
      name: row.name,
      ...(row.domain === 'project' && row.projectId != null
        ? {projectId: row.projectId}
        : {}),
    });
  };

  const confirmDeleteRows = (targets: SkillRow[]) => {
    if (targets.length === 0) {
      return;
    }
    const anyGlobal = targets.some(t => t.domain === 'global');
    const scopeHint = anyGlobal
      ? '全局技能删除后影响所有项目'
      : targets.length === 1 && targets[0]!.projectName
        ? `该技能仅在该项目（${targets[0]!.projectName}）生效`
        : '项目技能仅所属项目生效';
    const names = targets.map(t => t.name).join('、');
    Alert.alert(
      '删除技能',
      `${scopeHint}。确定删除${targets.length > 1 ? `选中的 ${targets.length} 个技能` : `「${names}」`}？删除会清理整目录与对应禁用记录。`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                for (const t of targets) {
                  await runtime.skills().deleteSkill({
                    domain: t.domain,
                    name: t.name,
                    ...(t.domain === 'project' && t.projectId != null
                      ? {projectId: t.projectId}
                      : {}),
                  });
                }
                batch.exit();
                showToast('已删除');
                await reload();
              } catch (error) {
                showToast(toastMessage('删除失败', error));
              }
            })();
          },
        },
      ],
    );
  };

  const confirmPromote = (skill: SkillRow) => {
    const hasConflict = globalSkills.some(g => g.name === skill.name);
    const run = async () => {
      try {
        await runtime
          .skills()
          .copySkill(
            {domain: 'project', projectId: skill.projectId!, name: skill.name},
            {domain: 'global', name: skill.name},
          );
        showToast('已提升为全局');
        await reload();
      } catch (error) {
        showToast(toastMessage('提升失败', error));
      }
    };
    if (!hasConflict) {
      void run();
      return;
    }
    Alert.alert(
      '覆盖全局技能',
      `全局域已存在同名技能「${skill.name}」，提升将整包覆盖全局版（影响所有使用全局版的项目）。是否继续？`,
      [
        {text: '取消', style: 'cancel'},
        {text: '覆盖提升', style: 'destructive', onPress: () => void run()},
      ],
    );
  };

  const runCopy = async (skill: SkillRow, targetProjectId: string) => {
    try {
      await runtime.skills().copySkill(
        {
          domain: skill.domain,
          name: skill.name,
          ...(skill.domain === 'project' && skill.projectId != null
            ? {projectId: skill.projectId}
            : {}),
        },
        {domain: 'project', projectId: targetProjectId, name: skill.name},
      );
      showToast('已复制');
      await reload();
    } catch (error) {
      showToast(toastMessage('复制失败', error));
    }
  };

  // ── 单个技能的导入导出（zip 根 = 该技能目录 /meta/skills/{name}）──

  const zipScopeFor = (skill: SkillRow): VfsScope =>
    skill.domain === 'global'
      ? {kind: 'global'}
      : {kind: 'project', projectId: skill.projectId!};

  const runSkillZipExport = async (skill: SkillRow) => {
    if (zipBusy) {
      return;
    }
    setZipBusy(true);
    try {
      const result = await exportVfsZip(runtime, zipScopeFor(skill), {
        directoryPath: `/meta/skills/${skill.name}`,
      });
      if (result === 'saved') {
        showToast('ZIP 已保存到所选位置');
      }
    } catch (error) {
      showToast(toastMessage('导出失败', error));
    } finally {
      setZipBusy(false);
    }
  };

  const runSkillZipImport = (skill: SkillRow) => {
    if (zipBusy) {
      return;
    }
    Alert.alert(
      `导入到技能 ${skill.name}`,
      `ZIP 内的文件将合并到该技能目录下，同名文件会被覆盖，是否继续？`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '导入',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setZipBusy(true);
              try {
                await importVfsZip(runtime, zipScopeFor(skill), {
                  confirmed: true,
                  directoryPath: `/meta/skills/${skill.name}`,
                });
                showToast('ZIP 导入完成');
                await reload();
              } catch (error) {
                showToast(toastMessage('导入失败', error));
              } finally {
                setZipBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  const menuItems: SheetMenuItem[] = useMemo(() => {
    if (menuTarget == null) {
      return [];
    }
    const items: SheetMenuItem[] = [
      {label: '编辑', action: 'edit'},
      {label: '导出 ZIP', action: 'export-zip'},
      {label: '导入 ZIP', action: 'import-zip'},
      {label: '删除', action: 'delete', danger: true},
    ];
    if (menuTarget.domain !== 'global') {
      items.splice(3, 0, {label: '复制到其他项目…', action: 'crossProjectCopy'});
      items.splice(4, 0, {label: '提升为全局', action: 'promote'});
    }
    return items;
  }, [menuTarget]);

  const handleMenuSelect = (action: string) => {
    const target = menuTarget;
    setMenuTarget(undefined);
    if (target == null) {
      return;
    }
    switch (action) {
      case 'edit':
        openDetail(target);
        break;
      case 'export-zip':
        runSkillZipExport(target).catch(() => undefined);
        break;
      case 'import-zip':
        runSkillZipImport(target);
        break;
      case 'delete':
        confirmDeleteRows([target]);
        break;
      case 'crossProjectCopy':
        setCopyContext({kind: 'crossProjectCopy', skill: target});
        break;
      case 'promote':
        confirmPromote(target);
        break;
      default:
        break;
    }
  };

  // 复制目标项目列表：跨项目复制排除源项目
  const copyTargetProjects = useMemo(() => {
    if (copyContext == null) {
      return [];
    }
    return projects.filter(p => p.id !== copyContext.skill.projectId);
  }, [copyContext, projects]);

  const renderRow = (row: SkillRow) => {
    const selected = batch.isSelected(rowKey(row));
    const overridden =
      row.domain === 'global' && overriddenGlobalNames.has(row.name);
    return (
      <Pressable
        testID={`skills-settings-row-${row.name}`}
        style={[
          styles.row,
          {backgroundColor: tokens.surface, borderColor: tokens.borderLight},
        ]}
        onPress={() => {
          if (batch.active) {
            batch.toggle(rowKey(row));
          } else {
            openDetail(row);
          }
        }}>
        {batch.active ? (
          <BatchCheckbox
            checked={selected}
            onToggle={() => batch.toggle(rowKey(row))}
          />
        ) : null}
        <View style={styles.rowBody}>
          <View style={styles.titleRow}>
            <Text
              style={[styles.name, {color: tokens.text}]}
              numberOfLines={1}>
              {row.name}
            </Text>
            {overridden ? (
              <Text
                style={[styles.overrideTag, {color: tokens.textTertiary}]}
                numberOfLines={1}>
                被项目副本覆盖
              </Text>
            ) : null}
            {!row.item.valid ? (
              <Text
                style={[styles.invalidTag, {color: tokens.danger}]}
                numberOfLines={1}>
                无效 · {row.item.invalidReason ?? 'front matter 不合法'}
              </Text>
            ) : null}
          </View>
          {row.item.description ? (
            <Text
              style={[styles.description, {color: tokens.textSecondary}]}
              numberOfLines={1}>
              {row.item.description}
            </Text>
          ) : null}
        </View>
        {batch.active ? null : (
          <Pressable
            testID={`skills-settings-menu-${row.name}`}
            hitSlop={8}
            onPress={() => setMenuTarget(row)}
            accessibilityLabel={`技能 ${row.name} 更多操作`}>
            <Text style={[styles.moreGlyph, {color: tokens.textSecondary}]}>
              ⋮
            </Text>
          </Pressable>
        )}
      </Pressable>
    );
  };

  // 项目 tab 的分组展示：项目名分组头 + 该项目技能行
  const groupedData = useMemo(() => {
    if (tab !== 'project') {
      return rows.map(row => ({kind: 'row' as const, row}));
    }
    const out: Array<
      {kind: 'header'; project: ChatProject} | {kind: 'row'; row: SkillRow}
    > = [];
    for (const project of projects) {
      const projectRows = rows.filter(r => r.projectId === project.id);
      if (projectRows.length === 0) {
        continue;
      }
      out.push({kind: 'header', project});
      out.push(...projectRows.map(row => ({kind: 'row' as const, row})));
    }
    return out;
  }, [tab, rows, projects]);

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <ManageHeader
        title="技能管理"
        batchMode={batch.active}
        selectedCount={batch.selectedCount}
        onEnterBatch={batch.enter}
        onCancelBatch={batch.exit}
        onDelete={() =>
          confirmDeleteRows(
            rows.filter(r => batch.isSelected(rowKey(r))),
          )
        }
        hint="选择要删除的技能"
        normalActions={
          <PrimaryButton
            label="新建"
            tokens={tokens}
            onPress={() => setCreateOpen(true)}
          />
        }
      />
      <SegmentedControl
        options={[
          {
            value: 'global',
            label: `全局技能（${globalRows.length}）`,
            testID: 'skills-settings-tab-global',
          },
          {
            value: 'project',
            label: `项目技能（${projectSkills.length}）`,
            testID: 'skills-settings-tab-project',
          },
        ]}
        value={tab}
        onChange={switchTab}
        tokens={tokens}
      />
      <Text style={[styles.tabHint, {color: tokens.textSecondary}]}>
        {tab === 'global' ? GLOBAL_TAB_HINT : PROJECT_TAB_HINT}
      </Text>
      <FlatList
        data={groupedData}
        keyExtractor={(entry, index) =>
          entry.kind === 'header'
            ? `header:${entry.project.id}`
            : rowKey(entry.row) + `:${index}`
        }
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyText, {color: tokens.textSecondary}]}>
              {tab === 'global'
                ? '暂无全局技能。新建全局技能后所有项目可用。'
                : '暂无项目技能。项目技能仅所属项目生效，同名时覆盖全局版。'}
            </Text>
            <SecondaryButton
              label="新建技能"
              tokens={tokens}
              onPress={() => setCreateOpen(true)}
            />
          </View>
        }
        renderItem={({item}) =>
          item.kind === 'header' ? (
            <Text
              style={[styles.groupHeader, {color: tokens.textSecondary}]}
              testID={`skills-settings-group-${item.project.name}`}>
              {item.project.name}
            </Text>
          ) : (
            renderRow(item.row)
          )
        }
      />
      <BottomSheetMenu
        visible={menuTarget != null}
        title={menuTarget ? `技能 ${menuTarget.name}` : undefined}
        items={menuItems}
        onSelect={handleMenuSelect}
        onClose={() => setMenuTarget(undefined)}
      />
      <BottomSheetMenu
        visible={copyContext != null}
        title="复制到其他项目"
        items={copyTargetProjects.map(p => ({label: p.name, action: p.id}))}
        onSelect={action => {
          const ctx = copyContext;
          setCopyContext(undefined);
          if (ctx != null) {
            void runCopy(ctx.skill, action);
          }
        }}
        onClose={() => setCopyContext(undefined)}
      />
      <NewSkillModal
        visible={createOpen}
        domain={tab === 'global' ? 'global' : 'project'}
        onClose={() => setCreateOpen(false)}
        onCreated={target => {
          showToast('已创建');
          navigation.navigate('SkillDetail', {
            domain: target.domain,
            name: target.name,
            ...(target.projectId != null ? {projectId: target.projectId} : {}),
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  tabHint: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 12,
    lineHeight: 16,
  },
  listContent: {paddingHorizontal: 12, paddingBottom: 24, gap: 8},
  groupHeader: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
    paddingHorizontal: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowBody: {flex: 1, gap: 4},
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  name: {fontSize: 15, fontWeight: '600'},
  overrideTag: {fontSize: 11},
  invalidTag: {fontSize: 11, flexShrink: 1},
  description: {fontSize: 13, lineHeight: 18},
  moreGlyph: {fontSize: 18, paddingHorizontal: 6},
  empty: {padding: 32, gap: 16, alignItems: 'center'},
  emptyText: {fontSize: 13, lineHeight: 20, textAlign: 'center'},
});
