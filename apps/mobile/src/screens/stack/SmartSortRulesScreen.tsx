/**
 * Smart sort rule management: list + toggle + reorder + batch + YAML I/O
 * (spec smart-filename-sort Step 13) + long-press drag reorder (Step 15).
 *
 * 拖拽为自研手势（D8：不引第三方拖拽库、不新增 GestureHandlerRootView）——
 * RNGH 2.31 的 GestureDetector 无 RootView 祖先时 DEV 直接抛错，
 * 故用 RN 内置响应系统：手柄 View onTouchStart 记按压时刻，
 * PanResponder.onMoveShouldSetPanResponder 在按住 ≥ DRAG_LONG_PRESS_MS 且位移
 * 未超 slop 时接管手势，reanimated shared value 驱动行位移跟随。
 */
import React, {useCallback, useMemo, useRef, useState, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  PanResponder,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  isBuiltinSmartSortRuleId,
  type SmartSortRule,
} from '@novel-master/core/smart-sort-rule';
import {BatchCheckbox} from '@/components/batch/BatchCheckbox';
import {ManageHeader} from '@/components/batch/ManageHeader';
import {BottomSheetMenu} from '@/components/sheet/BottomSheetMenu';
import {ConfigListCard} from '@/components/ui/ConfigListCard';
import {PrimaryButton, SecondaryButton} from '@/components/ui/Buttons';
import {useBatchDeleteConfirm} from '@/hooks/useBatchDeleteConfirm';
import {useBatchSelection} from '@/hooks/useBatchSelection';
import {useFocusListReload} from '@/hooks/useFocusListReload';
import {useRuntime} from '@/hooks/useRuntime';
import type {RootStackParamList} from '@/navigation/types';
import {listScreenStyles} from '../shared/list-screen-styles';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {toastMessage} from '@/errors/toast-message';
import {
  exportSmartSortRuleYaml,
  importSmartSortRuleYaml,
} from '@/services/smart-sort-rule-yaml.service';
import {
  DRAG_ACTIVATE_SLOP,
  DRAG_LONG_PRESS_MS,
  DRAG_ROW_GAP,
  computeInsertIndex,
  reorderRows,
  type DragRowLayout,
} from './smart-sort-drag';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SmartSortRulesScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const batch = useBatchSelection();
  /** 行 ⋮ 菜单锚定的规则。 */
  const [menuRule, setMenuRule] = useState<SmartSortRule | null>(null);
  /** 顶栏「更多」菜单（导入/导出/恢复默认）。 */
  const [moreMenuVisible, setMoreMenuVisible] = useState(false);

  const {rows, loading, reload, setRows} = useFocusListReload<SmartSortRule[]>({
    fetcher: useCallback(async () => {
      const list = await runtime.smartSortRule.listRules();
      return [...list].sort((a, b) => a.sortOrder - b.sortOrder);
    }, [runtime]),
    fallbackValue: EMPTY_RULES,
    onError: useCallback(
      (cause: unknown) => {
        showToast(toastMessage('加载失败', cause));
      },
      [showToast],
    ),
  });

  const createRule = () => {
    navigation.navigate('SmartSortRuleEditor', {});
  };

  // ---- 行内操作（⋮ 菜单） ----

  const moveRule = useCallback(
    async (ruleId: string, to: 'up' | 'down' | 'top' | 'bottom') => {
      try {
        await runtime.smartSortRule.moveRule(ruleId, to);
        await reload({silent: true});
      } catch (error) {
        showToast(toastMessage('调整失败', error));
      }
    },
    [runtime, reload, showToast],
  );

  const deleteRuleWithConfirm = useCallback(
    (rule: SmartSortRule) => {
      Alert.alert('删除规则', `确定删除「${rule.name}」？`, [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            (async () => {
              await runtime.smartSortRule.deleteRule(rule.ruleId);
              await reload({silent: true});
            })().catch(error =>
              showToast(toastMessage('删除失败', error)),
            );
          },
        },
      ]);
    },
    [runtime, reload, showToast],
  );

  const handleRowMenuSelect = useCallback(
    (action: string) => {
      const rule = menuRule;
      setMenuRule(null);
      if (!rule) {
        return;
      }
      switch (action) {
        case 'edit':
          navigation.navigate('SmartSortRuleEditor', {ruleId: rule.ruleId});
          break;
        case 'top':
        case 'up':
        case 'down':
        case 'bottom':
          void moveRule(rule.ruleId, action);
          break;
        case 'delete':
          deleteRuleWithConfirm(rule);
          break;
        default:
          break;
      }
    },
    [menuRule, navigation, moveRule, deleteRuleWithConfirm],
  );

  // ---- 长按拖拽调序（Step 15） ----

  /** 每行实测布局（含 gap 的总高），拖拽插入位换算用。 */
  const rowLayoutsRef = useRef(new Map<string, DragRowLayout>());
  const transY = useSharedValue(0);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** 当前插入位（-1 = 无拖拽）；语义见 computeInsertIndex。 */
  const [dragInsert, setDragInsert] = useState(-1);
  /** dragInsert 的 ref 镜：release 与最后一次 move 同帧时 state 闭包可能滞后。 */
  const dragInsertRef = useRef(-1);
  const dragFrom =
    draggingId != null
      ? rows.findIndex(r => r.ruleId === draggingId)
      : -1;

  const resetDrag = useCallback(() => {
    setDraggingId(null);
    setDragInsert(-1);
    dragInsertRef.current = -1;
    transY.value = 0;
  }, [transY]);

  const handleDragActivate = useCallback((ruleId: string) => {
    setDraggingId(ruleId);
    setDragInsert(-1);
    dragInsertRef.current = -1;
  }, []);

  const handleDragMove = useCallback(
    (ruleId: string, dy: number) => {
      transY.value = dy;
      const from = rows.findIndex(r => r.ruleId === ruleId);
      if (from < 0) {
        return;
      }
      const layout = rowLayoutsRef.current.get(ruleId);
      const center = layout
        ? layout.y + (layout.height - DRAG_ROW_GAP) / 2 + dy
        : from * 96 + 48 + dy;
      const t = computeInsertIndex(
        center,
        rows.map(r => rowLayoutsRef.current.get(r.ruleId)),
        rows.length,
      );
      setDragInsert(prev => (prev === t ? prev : t));
      dragInsertRef.current = t;
    },
    [rows, transY],
  );

  const handleDragRelease = useCallback(
    (ruleId: string) => {
      const from = rows.findIndex(r => r.ruleId === ruleId);
      const insert = dragInsertRef.current;
      if (from >= 0 && insert >= 0) {
        const next = reorderRows(rows, from, insert);
        if (next !== rows) {
          const prevRows = rows;
          setRows(next);
          runtime.smartSortRule
            .reorderRules(next.map(r => r.ruleId))
            .then(() => reload({silent: true}))
            .catch(error => {
              // 提交失败回滚到拖拽前顺序。
              setRows(prevRows);
              showToast(toastMessage('调整失败', error));
            });
        }
      }
      resetDrag();
    },
    [rows, runtime, reload, setRows, showToast, resetDrag],
  );

  // ---- 行内启停（乐观更新，失败回滚） ----

  const toggleEnabled = useCallback(
    (rule: SmartSortRule, next: boolean) => {
      setRows(prev =>
        prev.map(r => (r.ruleId === rule.ruleId ? {...r, enabled: next} : r)),
      );
      runtime.smartSortRule
        .setEnabled(rule.ruleId, next)
        .catch(error => {
          setRows(prev =>
            prev.map(r =>
              r.ruleId === rule.ruleId ? {...r, enabled: rule.enabled} : r,
            ),
          );
          showToast(toastMessage('操作失败', error));
        });
    },
    [runtime, setRows, showToast],
  );

  // ---- 批量 ----

  const confirmBatchDelete = useBatchDeleteConfirm<string>({
    title: '删除规则',
    message: ids => `确定删除选中的 ${ids.length} 条规则？`,
    deleteOne: useCallback(
      async (ruleId: string) => {
        // builtin- 由 service 整体拒绝；这里逐条走 deleteRule 保持部分成功语义。
        await runtime.smartSortRule.deleteRule(ruleId);
      },
      [runtime],
    ),
    onDone: async () => {
      batch.exit();
      await reload();
    },
  });

  const runBatchDelete = useCallback(() => {
    const ids = Array.from(batch.selectedIds);
    if (ids.some(id => isBuiltinSmartSortRuleId(id))) {
      showToast('内置规则不可删除，请取消勾选后再删除');
      return;
    }
    confirmBatchDelete(ids);
  }, [batch.selectedIds, confirmBatchDelete, showToast]);

  const runBatchSetEnabled = useCallback(
    (enabled: boolean) => {
      const ids = Array.from(batch.selectedIds);
      if (ids.length === 0) {
        return;
      }
      runtime.smartSortRule
        .setEnabledBatch(ids, enabled)
        .then(async () => {
          await reload({silent: true});
        })
        .catch(error => {
          showToast(toastMessage('操作失败', error));
        });
    },
    [batch.selectedIds, runtime, reload, showToast],
  );

  // ---- YAML 导入导出 / 恢复默认 ----

  const handleMoreSelect = useCallback(
    (action: string) => {
      setMoreMenuVisible(false);
      switch (action) {
        case 'import':
          Alert.alert(
            '导入规则',
            '导入将替换全部现有规则（含内置规则的启停状态），确定继续？',
            [
              {text: '取消', style: 'cancel'},
              {
                text: '导入',
                onPress: () => {
                  importSmartSortRuleYaml(runtime)
                    .then(async count => {
                      if (count == null) {
                        return;
                      }
                      await reload({silent: true});
                      showToast(`已导入 ${count} 条规则`);
                    })
                    .catch(error =>
                      showToast(toastMessage('导入失败', error)),
                    );
                },
              },
            ],
          );
          break;
        case 'export':
          exportSmartSortRuleYaml(runtime)
            .then(result => {
              if (result === 'saved') {
                showToast('已导出规则');
              }
            })
            .catch(error => showToast(toastMessage('导出失败', error)));
          break;
        case 'reset':
          Alert.alert(
            '恢复默认',
            '将重灌全部内置规则（含删除后重建、恢复启用），用户自建规则不受影响。',
            [
              {text: '取消', style: 'cancel'},
              {
                text: '恢复',
                onPress: () => {
                  runtime.smartSortRule
                    .resetDefaults()
                    .then(async () => {
                      await reload({silent: true});
                      showToast('已恢复默认规则');
                    })
                    .catch(error =>
                      showToast(toastMessage('恢复失败', error)),
                    );
                },
              },
            ],
          );
          break;
        default:
          break;
      }
    },
    [runtime, reload, showToast],
  );

  const rowMenuItems = menuRule
    ? [
        {label: '编辑', action: 'edit'},
        {label: '置顶', action: 'top'},
        {label: '上移', action: 'up'},
        {label: '下移', action: 'down'},
        {label: '置底', action: 'bottom'},
        // 内置规则仅可禁用不可删除（spec D3）。
        ...(isBuiltinSmartSortRuleId(menuRule.ruleId)
          ? []
          : [{label: '删除', action: 'delete', danger: true}]),
      ]
    : [];

  return (
    <View style={[listScreenStyles.root, {backgroundColor: tokens.background}]}>
      <ManageHeader
        title="智能排序规则"
        batchMode={batch.active}
        selectedCount={batch.selectedCount}
        onEnterBatch={batch.enter}
        onCancelBatch={batch.exit}
        onDelete={runBatchDelete}
        onSelectAll={
          rows.length > 0
            ? () => batch.selectRange(rows.map(r => r.ruleId))
            : undefined
        }
        allSelected={
          rows.length > 0 && batch.selectedCount === rows.length
        }
        actions={[
          {label: '启用', onPress: () => runBatchSetEnabled(true)},
          {label: '禁用', onPress: () => runBatchSetEnabled(false)},
        ]}
        hint="选择要操作的规则；内置规则不可删除"
        normalActions={
          <View style={styles.headerActions}>
            <SecondaryButton
              label="更多"
              tokens={tokens}
              onPress={() => setMoreMenuVisible(true)}
            />
            <PrimaryButton label="新建" tokens={tokens} onPress={createRule} />
          </View>
        }
      />
      {loading && rows.length === 0 ? (
        <ActivityIndicator style={listScreenStyles.loader} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.ruleId}
          contentContainerStyle={listScreenStyles.listContent}
          // 拖拽中禁滚动：拖拽行坐标系基于内容布局，避免拖拽中列表滚动导致漂移。
          scrollEnabled={draggingId == null}
          // 首屏全量布局，保证插入位换算的行坐标表完整（规则列表规模小）。
          initialNumToRender={24}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void reload()}
            />
          }
          ListEmptyComponent={
            <Text
              style={[listScreenStyles.empty, {color: tokens.textSecondary}]}
            >
              暂无规则，点击「新建」创建。
            </Text>
          }
          ListFooterComponent={
            draggingId != null &&
            dragInsert === rows.length &&
            dragInsert !== dragFrom &&
            dragInsert !== dragFrom + 1 ? (
              <InsertLine color={tokens.primary} />
            ) : null
          }
          renderItem={({item, index}) => {
            const isDragging = item.ruleId === draggingId;
            const showInsertLine =
              draggingId != null &&
              item.ruleId !== draggingId &&
              dragInsert === index &&
              dragInsert !== dragFrom &&
              dragInsert !== dragFrom + 1;
            return (
              <DragTranslate
                active={isDragging}
                transY={transY}
                style={isDragging ? styles.draggingWrapper : undefined}
                onLayout={e => {
                  rowLayoutsRef.current.set(item.ruleId, {
                    y: e.nativeEvent.layout.y,
                    height: e.nativeEvent.layout.height,
                  });
                }}
              >
                {showInsertLine ? <InsertLine color={tokens.primary} /> : null}
                <ConfigListCard
                  tokens={tokens}
                  selected={batch.isSelected(item.ruleId)}
                  onPress={() => {
                    if (batch.active) {
                      batch.toggle(item.ruleId);
                    } else {
                      navigation.navigate('SmartSortRuleEditor', {
                        ruleId: item.ruleId,
                      });
                    }
                  }}
                  leading={
                    batch.active ? (
                      <BatchCheckbox
                        checked={batch.isSelected(item.ruleId)}
                        onToggle={() => batch.toggle(item.ruleId)}
                      />
                    ) : (
                      <View style={styles.leadingRow}>
                        <DragHandle
                          enabled={rows.length > 1 && draggingId == null}
                          active={isDragging}
                          color={tokens.textTertiary}
                          activeColor={tokens.primary}
                          onActivate={() => handleDragActivate(item.ruleId)}
                          onMove={dy => handleDragMove(item.ruleId, dy)}
                          onRelease={() => handleDragRelease(item.ruleId)}
                          onCancel={resetDrag}
                        />
                        <Switch
                          value={item.enabled}
                          onValueChange={next => toggleEnabled(item, next)}
                          trackColor={{false: tokens.border, true: tokens.primary}}
                        />
                      </View>
                    )
                  }
                  title={item.name}
                  subtitle={`${isBuiltinSmartSortRuleId(item.ruleId) ? '内置 · ' : ''}${
                    item.example ?? '—'
                  }`}
                  onMenuPress={
                    batch.active ? undefined : () => setMenuRule(item)
                  }
                  showChevron={!batch.active}
                  style={isDragging ? styles.dragLift : undefined}
                />
              </DragTranslate>
            );
          }}
        />
      )}
      <BottomSheetMenu
        visible={menuRule != null}
        title={menuRule?.name}
        items={rowMenuItems}
        onSelect={handleRowMenuSelect}
        onClose={() => setMenuRule(null)}
      />
      <BottomSheetMenu
        visible={moreMenuVisible}
        title="规则库"
        items={[
          {label: '导入 YAML', action: 'import'},
          {label: '导出 YAML', action: 'export'},
          {label: '恢复默认', action: 'reset'},
        ]}
        onSelect={handleMoreSelect}
        onClose={() => setMoreMenuVisible(false)}
      />
    </View>
  );
}

const EMPTY_RULES: SmartSortRule[] = [];

/** 拖拽手柄：长按 ≥ DRAG_LONG_PRESS_MS 后接管手势进入拖拽。 */
function DragHandle({
  enabled,
  active,
  color,
  activeColor,
  onActivate,
  onMove,
  onRelease,
  onCancel,
}: {
  enabled: boolean;
  active: boolean;
  color: string;
  activeColor: string;
  onActivate: () => void;
  onMove: (dy: number) => void;
  onRelease: () => void;
  onCancel: () => void;
}) {
  // PanResponder 建一次；回调与开关经 ref 转发，避免拖拽中重建丢手势。
  const cbsRef = useRef({onActivate, onMove, onRelease, onCancel});
  cbsRef.current = {onActivate, onMove, onRelease, onCancel};
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  /** 手柄按下时刻（onTouchStart 记录，非 responder 状态也能收到）。 */
  const pressStartRef = useRef(0);
  /** 接管手势时的累计 dy，后续位移相对此值归零。 */
  const startDyRef = useRef(0);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_e, gs) => {
          if (!enabledRef.current || pressStartRef.current <= 0) {
            return false;
          }
          const heldMs = Date.now() - pressStartRef.current;
          return (
            heldMs >= DRAG_LONG_PRESS_MS && Math.abs(gs.dy) < DRAG_ACTIVATE_SLOP
          );
        },
        onPanResponderGrant: (_e, gs) => {
          startDyRef.current = gs.dy;
          cbsRef.current.onActivate();
        },
        onPanResponderMove: (_e, gs) => {
          cbsRef.current.onMove(gs.dy - startDyRef.current);
        },
        onPanResponderRelease: () => {
          cbsRef.current.onRelease();
        },
        // 被系统/父容器抢走（如来电）时不提交，复位拖拽态。
        onPanResponderTerminate: () => {
          cbsRef.current.onCancel();
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [],
  );

  const barColor = active ? activeColor : color;
  return (
    <View
      {...panResponder.panHandlers}
      onTouchStart={() => {
        pressStartRef.current = Date.now();
      }}
      onTouchEnd={() => {
        pressStartRef.current = 0;
      }}
      onTouchCancel={() => {
        pressStartRef.current = 0;
      }}
      style={styles.dragHandleHit}
      accessibilityLabel="拖拽排序手柄"
      accessibilityRole="button"
    >
      <View
        style={[
          styles.dragHandleBars,
          !enabled && styles.dragHandleDisabled,
        ]}
      >
        {[0, 1, 2].map(i => (
          <View
            key={i}
            style={[styles.dragHandleBar, {backgroundColor: barColor}]}
          />
        ))}
      </View>
    </View>
  );
}

/** 行包装：拖拽行 translateY 跟随（UI 线程），并上报实测布局。 */
function DragTranslate({
  active,
  transY,
  onLayout,
  style,
  children,
}: {
  active: boolean;
  transY: SharedValue<number>;
  onLayout: (e: LayoutChangeEvent) => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: active ? [{translateY: transY.value}] : [],
  }));
  return (
    <Animated.View onLayout={onLayout} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}

/** 插入位指示线：悬浮在目标行上方的 gap 区，不占布局高度。 */
function InsertLine({color}: {color: string}) {
  return (
    <View style={[styles.insertLine, {backgroundColor: color}]} />
  );
}

const styles = StyleSheet.create({
  headerActions: {flexDirection: 'row', alignItems: 'center', gap: 8},
  leadingRow: {flexDirection: 'row', alignItems: 'center', gap: 4},
  draggingWrapper: {zIndex: 10, elevation: 8},
  dragLift: {
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  insertLine: {
    position: 'absolute',
    top: -7.5,
    left: 10,
    right: 10,
    height: 3,
    borderRadius: 2,
  },
  dragHandleHit: {
    width: 28,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragHandleBars: {gap: 3, alignItems: 'center'},
  dragHandleBar: {width: 14, height: 3, borderRadius: 1.5},
  dragHandleDisabled: {opacity: 0.3},
});
