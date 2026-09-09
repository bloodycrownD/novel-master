/**
 * 搜索配置列表页（修订轮两级结构）：按 engineOrder 顺序列出四引擎 +
 * 配置状态标签；行菜单上移/下移调整串行链优先级（首位上移/末位下移
 * 禁用，照 ProvidersScreen 的 BottomSheetMenu 先例）；点击行进详情页。
 *
 * 读写经 `runtime.searchConfig`（core `createSearchConfigStore` 装配）：
 * 对外状态只显 configured 标签，不回显 key 明文；列表顺序即 search
 * 工具的串行降级链优先级。
 */
import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {EngineId} from '@novel-master/core';
import {ApiKeyStatusTag} from '@/components/provider/ApiKeyStatusTag';
import {BottomSheetMenu} from '@/components/sheet/BottomSheetMenu';
import {ConfigListCard} from '@/components/ui/ConfigListCard';
import {useDismissOverlaysOnBlur} from '@/hooks/useDismissOverlaysOnBlur';
import {useFocusListReload} from '@/hooks/useFocusListReload';
import {useRuntime} from '@/hooks/useRuntime';
import type {RootStackParamList} from '@/navigation/types';
import {listScreenStyles} from '../shared/list-screen-styles';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {toastMessage} from '@/errors/toast-message';
import {
  readSearchEngineConfig,
  setSearchEngineOrder,
} from '@/services/search-config.store';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** 引擎显示名（行标题 / 详情页标题共用）。 */
export const ENGINE_LABELS: Record<EngineId, string> = {
  bocha: 'Bocha',
  tavily: 'Tavily',
  brave: 'Brave',
  searxng: 'SearXNG',
};

/** 行副标题（引擎口径说明；详情页表单卡片 hint 共用）。 */
export const ENGINE_HINTS: Record<EngineId, string> = {
  bocha: '博查搜索 API，按量计费',
  tavily: 'Tavily Search API',
  brave: 'Brave Search API',
  searxng: '自托管元搜索引擎实例，无需 API key',
};

/** 列表行数据：engineOrder 序 + 单引擎配置状态。 */
interface SearchEngineRow {
  engineId: EngineId;
  configured: boolean;
}

const EMPTY_ROWS: SearchEngineRow[] = [];

export function SearchEnginesScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  /** 行菜单当前指向的引擎（undefined = 收起）。 */
  const [menuEngineId, setMenuEngineId] = useState<EngineId | undefined>();
  /** 排序写库进行中（互斥连点）。 */
  const [moving, setMoving] = useState(false);

  const dismissAllOverlays = useCallback(() => {
    setMenuEngineId(undefined);
  }, []);

  useDismissOverlaysOnBlur(dismissAllOverlays);

  const {rows, loading, error, reload} = useFocusListReload({
    fetcher: useCallback(async () => {
      const config = await readSearchEngineConfig(runtime);
      return config.engineOrder.map(engineId => ({
        engineId,
        configured: config.engines[engineId].configured,
      }));
    }, [runtime]),
    fallbackValue: EMPTY_ROWS,
  });

  /** 上移（delta=-1）/ 下移（delta=+1）：交换相邻位后整单写库并重读。 */
  const moveEngine = useCallback(
    async (engineId: EngineId, delta: -1 | 1) => {
      if (moving) {
        return;
      }
      const order = rows.map(row => row.engineId);
      const index = order.indexOf(engineId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= order.length) {
        return;
      }
      [order[index], order[target]] = [order[target], order[index]];
      setMoving(true);
      try {
        await setSearchEngineOrder(runtime, order);
        // 重读刷新：engineOrder 与 configured 状态以库内新值为准。
        await reload({silent: true});
      } catch (cause) {
        showToast(toastMessage('调整顺序失败', cause));
      } finally {
        setMoving(false);
      }
    },
    [moving, rows, runtime, reload, showToast],
  );

  // 菜单项禁用态：首位上移 / 末位下移不可点（置灰保留，照 ProvidersScreen 先例）。
  const menuIndex =
    menuEngineId != null
      ? rows.findIndex(row => row.engineId === menuEngineId)
      : -1;

  return (
    <View style={[listScreenStyles.root, {backgroundColor: tokens.background}]}>
      {loading && rows.length === 0 ? (
        <ActivityIndicator style={listScreenStyles.loader} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.error, {color: tokens.danger}]}>{error}</Text>
          <Pressable onPress={() => void reload()}>
            <Text style={{color: tokens.primary, fontWeight: '600'}}>重试</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.engineId}
          contentContainerStyle={listScreenStyles.listContent}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} />
          }
          renderItem={({item}) => (
            <ConfigListCard
              tokens={tokens}
              onPress={() =>
                navigation.navigate('SearchEngineDetail', {
                  engineId: item.engineId,
                })
              }
              title={ENGINE_LABELS[item.engineId]}
              subtitle={ENGINE_HINTS[item.engineId]}
              trailingMeta={
                <ApiKeyStatusTag
                  status={item.configured ? 'set' : 'not set'}
                  tokens={tokens}
                />
              }
              onMenuPress={() => setMenuEngineId(item.engineId)}
            />
          )}
          ListFooterComponent={
            <Text style={[styles.note, {color: tokens.textTertiary}]}>
              列表顺序即 search
              工具的引擎优先级：请求失败时按序降级到下一个已配置引擎。API key
              只保存在本机密钥库，不进入会话记录，也不会随云同步上传。
            </Text>
          }
        />
      )}
      <BottomSheetMenu
        visible={menuEngineId != null}
        title={menuEngineId != null ? ENGINE_LABELS[menuEngineId] : undefined}
        items={[
          {label: '上移', action: 'up', disabled: menuIndex <= 0},
          {
            label: '下移',
            action: 'down',
            disabled: menuIndex < 0 || menuIndex >= rows.length - 1,
          },
        ]}
        onClose={() => setMenuEngineId(undefined)}
        onSelect={action => {
          const engineId = menuEngineId;
          setMenuEngineId(undefined);
          if (engineId == null) {
            return;
          }
          if (action === 'up') {
            moveEngine(engineId, -1).catch(() => undefined);
          } else if (action === 'down') {
            moveEngine(engineId, 1).catch(() => undefined);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {alignItems: 'center', gap: 12, padding: 24},
  error: {textAlign: 'center', lineHeight: 20},
  note: {fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 8},
});
