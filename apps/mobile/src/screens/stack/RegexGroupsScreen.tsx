/**
 * 正则配置：当前选用状态卡 + 全部正则组列表卡。
 */
import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RegexGroup} from '@novel-master/core';
import {BatchCheckbox} from '../../components/batch/BatchCheckbox';
import {RegexGroupPickerModal} from '../../components/regex/RegexGroupPickerModal';
import {BottomSheetMenu} from '../../components/sheet/BottomSheetMenu';
import {ConfigListCard} from '../../components/ui/ConfigListCard';
import {ListSectionTitle} from '../../components/ui/ListSectionTitle';
import {PrimaryButton} from '../../components/ui/PrototypeButtons';
import {TextPromptModal} from '../../components/ui/TextPromptModal';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
import {useRuntime} from '../../hooks/useRuntime';
import type {RootStackParamList} from '../../navigation/types';
import {deriveRegexGroupId} from '../../utils/regex-group-id';
import {useTheme} from '../../theme/ThemeProvider';
import type {ThemeTokens} from '../../theme/tokens';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface GroupRow extends RegexGroup {
  ruleCount: number;
  isCurrent: boolean;
}

function groupTitle(group: RegexGroup): string {
  return group.displayName?.trim() || group.groupId;
}

function RegexLeadingIcon({tokens}: {tokens: {primary: string}}) {
  return (
    <View style={[styles.leadingIcon, {backgroundColor: `${tokens.primary}1A`}]}>
      <Text style={styles.leadingEmoji}>🛡️</Text>
    </View>
  );
}

type GroupPanelRowProps = {
  item: GroupRow;
  tokens: ThemeTokens;
  batchActive: boolean;
  selected: boolean;
  isLast: boolean;
  onPress: () => void;
  onMenuPress?: () => void;
};

function GroupPanelRow({
  item,
  tokens,
  batchActive,
  selected,
  isLast,
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
          borderBottomColor: tokens.borderLight,
          borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
          opacity: pressed ? 0.92 : 1,
        },
      ]}>
      {batchActive ? (
        <BatchCheckbox
          checked={selected}
          onToggle={onPress}
        />
      ) : (
        <RegexLeadingIcon tokens={tokens} />
      )}
      <View style={styles.panelRowInfo}>
        <Text style={[styles.panelRowTitle, {color: tokens.text}]} numberOfLines={1}>
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
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
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

  const reload = useCallback(async () => {
    setLoading(true);
    try {
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
      setRows(enriched);
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => setRows([]));
    }, [reload]),
  );

  const confirmBatchDelete = () => {
    const ids = Array.from(batch.selectedIds);
    if (ids.length === 0) {
      return;
    }
    Alert.alert('删除正则组', `确定删除选中的 ${ids.length} 个正则组？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          (async () => {
            for (const groupId of ids) {
              await runtime.regexConfig.deleteGroup(groupId);
            }
            batch.exit();
            await reload();
          })().catch(err =>
            showToast(toastMessage('删除失败', err)),
          );
        },
      },
    ]);
  };

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

  const renderListPanelToolbar = () => {
    if (batch.active) {
      return (
        <View
          style={[
            styles.panelToolbar,
            {borderBottomColor: tokens.borderLight},
          ]}>
          <Pressable onPress={batch.exit}>
            <Text style={[styles.batchAction, {color: tokens.text}]}>取消</Text>
          </Pressable>
          <Text style={{color: tokens.textSecondary, fontSize: 14}}>
            已选 {batch.selectedCount} 项
          </Text>
          <Pressable
            onPress={confirmBatchDelete}
            disabled={batch.selectedCount === 0}>
            <Text
              style={{
                color:
                  batch.selectedCount > 0
                    ? tokens.danger
                    : tokens.textTertiary,
                fontSize: 15,
                fontWeight: '600',
              }}>
              删除
            </Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View
        style={[
          styles.panelToolbar,
          {borderBottomColor: tokens.borderLight},
        ]}>
        <Text style={[styles.sectionLabel, {color: tokens.text}]}>
          全部正则组
        </Text>
        <View style={styles.sectionActions}>
          <Pressable onPress={batch.enter} hitSlop={8}>
            <Text style={[styles.linkAction, {color: tokens.textSecondary}]}>
              管理
            </Text>
          </Pressable>
          <PrimaryButton
            label="添加"
            tokens={tokens}
            onPress={() => setCreateVisible(true)}
          />
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} />
        }>
        <ListSectionTitle title="当前" tokens={tokens} />
        <ConfigListCard
          tokens={tokens}
          onPress={() => setRegexGroupPickerVisible(true)}
          leading={<RegexLeadingIcon tokens={tokens} />}
          title="当前正则组"
          subtitle={currentSubtitle}
          showChevron
        />

        <View
          style={[
            styles.listPanel,
            {
              backgroundColor: tokens.surfaceElevated,
              borderColor: tokens.borderLight,
            },
          ]}>
          {renderListPanelToolbar()}
          {batch.active ? (
            <Text style={[styles.batchHint, {color: tokens.textSecondary}]}>
              选择要删除的正则组
            </Text>
          ) : null}
          {loading && rows.length === 0 ? (
            <ActivityIndicator
              style={styles.panelLoader}
              color={tokens.primary}
            />
          ) : rows.length === 0 ? (
            <Text style={[styles.panelEmpty, {color: tokens.textSecondary}]}>
              暂无正则组，点击「添加」创建。
            </Text>
          ) : (
            rows.map((item, index) => (
              <GroupPanelRow
                key={item.groupId}
                item={item}
                tokens={tokens}
                batchActive={batch.active}
                selected={batch.isSelected(item.groupId)}
                isLast={index === rows.length - 1}
                onPress={() => {
                  if (batch.active) {
                    batch.toggle(item.groupId);
                  } else {
                    navigation.navigate('RegexRules', {groupId: item.groupId});
                  }
                }}
                onMenuPress={
                  batch.active
                    ? undefined
                    : () => setMenuGroupId(item.groupId)
                }
              />
            ))
          )}
        </View>
      </ScrollView>
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
        onConfirm={async name => {
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
        onConfirm={async name => {
          if (editGroupId == null) {
            return;
          }
          await runtime.regexConfig.updateGroup(editGroupId, {
            displayName: name,
          });
          await reload();
          showToast('已更新名称');
        }}
      />
      <RegexGroupPickerModal
        visible={regexGroupPickerVisible}
        onClose={() => setRegexGroupPickerVisible(false)}
        onSelected={() => reload().catch(() => undefined)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  scrollContent: {paddingTop: 4, paddingBottom: 24},
  leadingIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leadingEmoji: {fontSize: 18},
  listPanel: {
    marginHorizontal: 5,
    marginTop: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  panelToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  sectionLabel: {fontSize: 12, fontWeight: '700'},
  sectionActions: {flexDirection: 'row', alignItems: 'center', gap: 10},
  linkAction: {fontSize: 14, fontWeight: '600'},
  batchAction: {fontSize: 15, fontWeight: '600'},
  batchHint: {
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  panelLoader: {paddingVertical: 28},
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
