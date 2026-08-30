/**
 * 设置·技能管理页：双 tab（全局默认在前 / 项目在后按所有项目分组）。
 *
 * - 管理页是全局语境：项目 tab 展示**所有项目**的项目技能（分组头项目名）。
 * - 批量：useBatchSelection + BatchCheckbox 先例，两个 tab 各自独立，
 *   切 tab 自动退出批量模式；删除文案区分「影响所有项目」/「仅该项目生效」。
 * - 行 ⋮ 菜单：导出 ZIP / 删除；点行即进技能详情编辑。ZIP 导入
 *   并入新建弹窗（导入即预填，创建时整包落盘）。
 *   跨域复制（复制到其他项目 / 提升为全局）已按需求移除：使用频率低，
 *   且技能域无 checkpoint 版本管理，破坏性跨域操作收归 UI 确认链路之外。
 * - D5：全局 tab「被项目副本覆盖」灰标签按「任意项目存在同名副本」判定；
 *   tab hint 注明该全局版仅对无副本的项目生效。
 */
import React, {useCallback, useMemo, useState} from 'react';
import {FlatList, Pressable, RefreshControl, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {ChatProject} from '@novel-master/core/chat';
import type {SkillDomain, SkillListItem} from '@novel-master/core/skills';
import type {VfsScope} from '@novel-master/core/vfs';
import {BatchCheckbox} from '@/components/batch/BatchCheckbox';
import {ManageHeader} from '@/components/batch/ManageHeader';
import {BottomSheetMenu, type SheetMenuItem} from '@/components/sheet/BottomSheetMenu';
import {NewSkillModal} from '@/components/skills/NewSkillModal';
import {PrimaryButton, SecondaryButton} from '@/components/ui/Buttons';
import {exportVfsZip} from '@/services/vfs-zip.service';
import {SegmentedControl} from '@/components/ui/SegmentedControl';
import {useBatchDeleteConfirm} from '@/hooks/useBatchDeleteConfirm';
import {useBatchSelection} from '@/hooks/useBatchSelection';
import {useFocusListReload} from '@/hooks/useFocusListReload';
import {useRuntime} from '@/hooks/useRuntime';
import type {RootStackParamList} from '@/navigation/types';
import {listScreenStyles} from '@/screens/shared/list-screen-styles';
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

/** useFocusListReload 的行集：一个屏要同时维护三份列表，打包成一个 payload。 */
interface SkillsPayload {
  projects: ChatProject[];
  globalSkills: SkillListItem[];
  projectSkills: SkillRow[];
}

const EMPTY_PAYLOAD: SkillsPayload = {
  projects: [],
  globalSkills: [],
  projectSkills: [],
};

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
  const batch = useBatchSelection();
  const [menuTarget, setMenuTarget] = useState<MenuTarget>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);

  // loading/reload + 聚焦重载走共用 hook；本屏要同时维护三份列表，
  // fetcher 返回打包后的 payload；加载失败 toast（保持原语义，rows 不动）。
  const {
    rows: payload,
    loading,
    reload,
  } = useFocusListReload<SkillsPayload>({
    fetcher: useCallback(async () => {
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
      return {
        projects: projectList,
        globalSkills: globalList,
        projectSkills: perProject.flat(),
      };
    }, [runtime]),
    fallbackValue: EMPTY_PAYLOAD,
    onError: useCallback(
      (cause: unknown) => {
        showToast(toastMessage('加载技能失败', cause));
      },
      [showToast],
    ),
  });
  const {projects, globalSkills, projectSkills} = payload;

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

  const confirmDeleteRows = useBatchDeleteConfirm<SkillRow>({
    title: '删除技能',
    message: targets => {
      const anyGlobal = targets.some(t => t.domain === 'global');
      const scopeHint = anyGlobal
        ? '全局技能删除后影响所有项目'
        : targets.length === 1 && targets[0]!.projectName
          ? `该技能仅在该项目（${targets[0]!.projectName}）生效`
          : '项目技能仅所属项目生效';
      const names = targets.map(t => t.name).join('、');
      return `${scopeHint}。确定删除${targets.length > 1 ? `选中的 ${targets.length} 个技能` : `「${names}」`}？删除会清理整目录与对应禁用记录。`;
    },
    deleteOne: useCallback(
      async (t: SkillRow) => {
        await runtime.skills().deleteSkill({
          domain: t.domain,
          name: t.name,
          ...(t.domain === 'project' && t.projectId != null
            ? {projectId: t.projectId}
            : {}),
        });
      },
      [runtime],
    ),
    onDone: async () => {
      batch.exit();
      showToast('已删除');
      await reload();
    },
  });

  const zipScopeFor = (skill: SkillRow): VfsScope =>
    skill.domain === 'global'
      ? {kind: 'global-meta'}
      : {kind: 'project-meta', projectId: skill.projectId!};

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

  const menuItems: SheetMenuItem[] = useMemo(() => {
    if (menuTarget == null) {
      return [];
    }
    const items: SheetMenuItem[] = [
      {label: '导出 ZIP', action: 'export-zip'},
      {label: '删除', action: 'delete', danger: true},
    ];
    return items;
  }, [menuTarget]);

  const handleMenuSelect = (action: string) => {
    const target = menuTarget;
    setMenuTarget(undefined);
    if (target == null) {
      return;
    }
    switch (action) {
      case 'export-zip':
        runSkillZipExport(target).catch(() => undefined);
        break;
      case 'delete':
        confirmDeleteRows([target]);
        break;
      default:
        break;
    }
  };

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
    <View style={[listScreenStyles.root, {backgroundColor: tokens.background}]}>
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
            label: '全局技能',
            testID: 'skills-settings-tab-global',
          },
          {
            value: 'project',
            label: '项目技能',
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
