/**
 * 正则配置：当前选用状态卡 + 全部正则组列表卡。
 *
 * C-12：批量工具栏换用 ManageHeader（与其余列表屏同轨），
 * 「当前正则组」卡片放 FlatList 的 ListHeaderComponent。
 */
import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {type RegexGroup} from '@novel-master/core/regex';
import {BatchCheckbox} from '../../components/batch/BatchCheckbox';
import {ManageHeader} from '../../components/batch/ManageHeader';
import {RegexGroupPickerModal} from '../../components/regex/RegexGroupPickerModal';
import {BottomSheetMenu} from '../../components/sheet/BottomSheetMenu';
import {ConfigListCard} from '../../components/ui/ConfigListCard';
import {ListSectionTitle} from '../../components/ui/ListSectionTitle';
import {PrimaryButton} from '../../components/ui/PrototypeButtons';
import {TextPromptModal} from '../../components/ui/TextPromptModal';
import {useBatchDeleteConfirm} from '../../hooks/useBatchDeleteConfirm';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
import {useFocusListReload} from '../../hooks/useFocusListReload';
import {useRuntime} from '../../hooks/useRuntime';
import type {RootStackParamList} from '../../navigation/types';
import {deriveRegexGroupId} from '@novel-master/core/format';
import {useTheme} from '../../theme/ThemeProvider';
import type {ThemeTokens} from '../../theme/tokens';
import {listScreenStyles} from '../shared/list-screen-styles';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface GroupRow extends RegexGroup {
  ruleCount: number;
  isCurrent: boolean;
}

const EMPTY_ROWS: GroupRow[] = [];

function groupTitle(group: RegexGroup): string {
  return group.displayName?.trim() || group.groupId;
}

function RegexLeadingIcon({tokens}: {tokens: {primary: string}}) {
  return (
    <View
      style={[styles.leadingIcon, {backgroundColor: `${tokens.primary}1A`}]}>
      <Text style={styles.leadingEmoji}>🛡️</Text>
    </View>
  );
}

type GroupPanelRowProps = {
  item: GroupRow;
  tokens: ThemeTokens;
  batchActive: boolean;
  selected: boolean;
  onPress: () => void;
  onMenuPress?: () => void;
};

function GroupPanelRow({
  item,
  tokens,
  batchActive,
  selected,
  onPress,
  onMenuPress,
}: GroupPanelRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({pressed}) => [
        styles.panelRow,
        {
          backgroundColor: selected ? `${tokens.primary}12` : 'transparent',
          opacity: pressed ? 0.92 : 1,
        },
      ]}>
      {batchActive ? (
        <BatchCheckbox checked={selected} onToggle={onPress} />
      ) : (
        <RegexLeadingIcon tokens={tokens} />
      )}
      <View style={styles.panelRowInfo}>
        <Text
          style={[styles.panelRowTitle, {color: tokens.text}]}
          numberOfLines={1}>
          {groupTitle(item)}
        </Text>
        <Text style={[styles.panelRowSubtitle, {color: tokens.textSecondary}]}>
          {item.ruleCount} 条规则
        </Text>
      </View>
      {item.isCurrent && !batchActive ? (
        <View style={[styles.badge, {backgroundColor: tokens.primary}]}>
          <Text style={styles.badgeText}>当前</Text>
        </View>
      ) : null}
      {onMenuPress != null ? (
        <Pressable
          hitSlop={8}
          onPress={e => {
            e.stopPropagation?.();
            onMenuPress();
          }}>
          <Text style={[styles.menuDots, {color: tokens.textSecondary}]}>⋮</Text>
        </Pressable>
      ) : null}
      {!batchActive ? (
        <Text style={[styles.chevron, {color: tokens.textTertiary}]}>›</Text>
      ) : null}
    </Pressable>
  );
}

export function RegexGroupsScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const [menuGroupId, setMenuGroupId] = useState<string | undefined>();
  const [createVisible, setCreateVisible] = useState(false);
  const [editGroupId, setEditGroupId] = useState<string | undefined>();
  const [currentRegexLabel, setCurrentRegexLabel] = useState('不启用');
  const [regexGroupPickerVisible, setRegexGroupPickerVisible] = useState(false);
  const batch = useBatchSelection();

  const dismissAllOverlays = useCallback(() => {
    setMenuGroupId(undefined);
    setCreateVisible(false);
    setEditGroupId(undefined);
    setRegexGroupPickerVisible(false);
  }, []);

  useDismissOverlaysOnBlur(dismissAllOverlays);

  // rows/loading/reload + 聚焦重载走共用 hook；fetcher 抛错进 error 态（配重试）。
  const {rows, loading, error, reload} = useFocusListReload<GroupRow[]>({
    fetcher: useCallback(async () => {
      const groups = await runtime.regexConfig.listGroups();
      const currentId = await runtime.state.getCurrentRegexGroupId();
      if (!currentId) {
        setCurrentRegexLabel('不启用');
      } else {
        try {
          const current = await runtime.regexConfig.getGroup(currentId);
          setCurrentRegexLabel(
            current.displayName?.trim() || current.groupId,
          );
        } catch {
          setCurrentRegexLabel('不启用');
        }
      }
      const enriched: GroupRow[] = [];
      for (const group of groups) {
        const rules = await runtime.regexConfig.listRules(group.groupId);
        enriched.push({
          ...group,
          ruleCount: rules.length,
          isCurrent: currentId === group.groupId,
        });
      }
      return enriched;
    }, [runtime]),
    fallbackValue: EMPTY_ROWS,
  });

  const confirmBatchDelete = useBatchDeleteConfirm<string>({
    title: '删除正则组',
    message: ids => `确定删除选中的 ${ids.length} 个正则组？`,
    deleteOne: useCallback(
      async (groupId: string) => {
        await runtime.regexConfig.deleteGroup(groupId);
      },
      [runtime],
    ),
    onDone: async () => {
      batch.exit();
      await reload();
    },
  });

  const deleteGroup = async (groupId: string) => {
    const row = rows.find(g => g.groupId === groupId);
    const title = row != null ? groupTitle(row) : groupId;
    Alert.alert('删除正则组', `确定删除「${title}」？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          (async () => {
            await runtime.regexConfig.deleteGroup(groupId);
            await reload();
          })().catch(err =>
            showToast(toastMessage('删除失败', err)),
          );
        },
      },
    ]);
  };

  const editInitialName =
    editGroupId != null
      ? (rows.find(g => g.groupId === editGroupId)?.displayName ??
        groupTitle(rows.find(g => g.groupId === editGroupId)!))
      : '';

  const currentSubtitle =
    currentRegexLabel === '不启用'
      ? '未选择规则组，消息不做正则过滤'
      : `已选用「${currentRegexLabel}」`;

  return (
    <View style={[listScreenStyles.root, {backgroundColor: tokens.background}]}>
      <ManageHeader
        title="全部正则组"
        batchMode={batch.active}
        selectedCount={batch.selectedCount}
        onEnterBatch={batch.enter}
        onCancelBatch={batch.exit}
        onDelete={() => confirmBatchDelete(Array.from(batch.selectedIds))}
        hint="选择要删除的正则组"
        normalActions={
          <PrimaryButton
            label="添加"
            tokens={tokens}
            onPress={() => setCreateVisible(true)}
          />
        }
      />
      {loading && rows.length === 0 ? (
        <ActivityIndicator
          style={styles.panelLoader}
          color={tokens.primary}
        />
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.error, {color: tokens.danger}]}>{error}</Text>
          <Pressable onPress={() => void reload()}>
            <Text style={{color: tokens.primary, fontWeight: '600'}}>
              重试
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.groupId}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={() => void reload()} />
          }
          ListHeaderComponent={
            <View>
              <ListSectionTitle title="当前" tokens={tokens} />
              <ConfigListCard
                tokens={tokens}
                onPress={() => setRegexGroupPickerVisible(true)}
                leading={<RegexLeadingIcon tokens={tokens} />}
                title="当前正则组"
                subtitle={currentSubtitle}
                showChevron
              />
            </View>
          }
          ListEmptyComponent={
            <Text style={[styles.panelEmpty, {color: tokens.textSecondary}]}>
              暂无正则组，点击「添加」创建。
            </Text>
          }
          renderItem={({item}) => (
            <View
              style={[
                styles.rowCard,
                {
                  backgroundColor: tokens.surfaceElevated,
                  borderColor: tokens.borderLight,
                },
              ]}>
              <GroupPanelRow
                item={item}
                tokens={tokens}
                batchActive={batch.active}
                selected={batch.isSelected(item.groupId)}
                onPress={() => {
                  if (batch.active) {
                    batch.toggle(item.groupId);
                  } else {
                    navigation.navigate('RegexRules', {groupId: item.groupId});
                  }
                }}
                onMenuPress={
                  batch.active ? undefined : () => setMenuGroupId(item.groupId)
                }
              />
            </View>
          )}
        />
      )}
      <BottomSheetMenu
        visible={menuGroupId != null}
        items={[
          {label: '编辑名称', action: 'edit'},
          {label: '删除', action: 'delete', danger: true},
        ]}
        onClose={() => setMenuGroupId(undefined)}
        onSelect={action => {
          const id = menuGroupId;
          setMenuGroupId(undefined);
          if (!id) {
            return;
          }
          if (action === 'edit') {
            setEditGroupId(id);
          } else if (action === 'delete') {
            deleteGroup(id).catch(() => undefined);
          }
        }}
      />
      <TextPromptModal
        visible={createVisible}
        title="新建正则组"
        label="名称"
        placeholder="如 对话清洗"
        confirmLabel="创建"
        onClose={() => setCreateVisible(false)}
        onConfirm={async values => {
          const name = values[0];
          const taken = new Set(rows.map(r => r.groupId));
          const groupId = deriveRegexGroupId(name, taken);
          await runtime.regexConfig.createGroup({
            groupId,
            displayName: name,
          });
          await reload();
          showToast('已添加正则组');
        }}
      />
      <TextPromptModal
        visible={editGroupId != null}
        title="编辑名称"
        label="名称"
        placeholder="正则组名称"
        initialValue={editInitialName}
        confirmLabel="保存"
        onClose={() => setEditGroupId(undefined)}
        onConfirm={async values => {
          if (editGroupId == null) {
            return;
          }
          await runtime.regexConfig.updateGroup(editGroupId, {
            displayName: values[0],
          });
          await reload();
          showToast('已更新名称');
        }}
      />
      <RegexGroupPickerModal
        visible={regexGroupPickerVisible}
        onClose={() => setRegexGroupPickerVisible(false)}
        onSelected={() => void reload()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: {paddingTop: 4, paddingBottom: 24},
  leadingIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leadingEmoji: {fontSize: 18},
  rowCard: {
    marginTop: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  panelLoader: {paddingVertical: 28},
  center: {alignItems: 'center', gap: 12, padding: 24},
  error: {textAlign: 'center', lineHeight: 20},
  panelEmpty: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  panelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  panelRowInfo: {flex: 1, minWidth: 0, gap: 4},
  panelRowTitle: {fontSize: 16, fontWeight: '600'},
  panelRowSubtitle: {fontSize: 13, lineHeight: 18},
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {color: '#FFFFFF', fontSize: 12, fontWeight: '600'},
  menuDots: {fontSize: 18, paddingHorizontal: 4},
  chevron: {fontSize: 22, fontWeight: '300'},
});
