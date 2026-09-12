/**
 * 搜索配置列表页（修订轮两级结构）：按 engineOrder 顺序列出全部引擎（ENGINE_IDS） +
 * 配置状态标签；行菜单上移/下移调整串行链优先级（首位上移/末位下移
 * 禁用，照 ProvidersScreen 的 BottomSheetMenu 先例）；点击行进详情页。
 *
 * 读写经 `runtime.searchConfig`（core `createSearchConfigStore` 装配）：
 * 对外状态只显 configured 标签，不回显 key 明文。列表页不留长说明文案，
 * 引擎优先级 / 自动降级 / 密钥安全三段使用说明收进标题栏「?」帮助弹窗。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {EngineId} from '@novel-master/core';
import {ApiKeyStatusTag} from '@/components/provider/ApiKeyStatusTag';
import {BottomSheetMenu} from '@/components/sheet/BottomSheetMenu';
import {ConfigListCard} from '@/components/ui/ConfigListCard';
import {HelpIcon} from '@/components/icons/TabIcons';
import {ModalShell} from '@/components/ui/ModalShell';
import {useDismissOverlaysOnBlur} from '@/hooks/useDismissOverlaysOnBlur';
import {useFocusListReload} from '@/hooks/useFocusListReload';
import {useRuntime} from '@/hooks/useRuntime';
import {useStackOverrideSetter} from '@/navigation/HeaderContext';
import type {RootStackParamList} from '@/navigation/types';
import {listScreenStyles} from '../shared/list-screen-styles';
import {useTheme} from '@/theme/ThemeProvider';
import type {ThemeTokens} from '@/theme/tokens';
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
  duckduckgo: 'DuckDuckGo',
};

/** 行副标题短语（计费/部署口径）；详情页表单卡片 hint 用独立短文案。 */
export const ENGINE_HINTS: Record<EngineId, string> = {
  bocha: '按量计费 · 中文检索',
  tavily: '按量计费 · 国际',
  brave: '按量计费 · 国际',
  searxng: '自托管 · 免费',
  duckduckgo: '内置',
};

/** 内置引擎徽标：duckduckgo 无 set/not set 二态（恒可用），用主题色
 * 胶囊标「内置」，尺寸/形状与 ApiKeyStatusTag 协调、仅换主题色。 */
export function BuiltinTag({tokens}: {tokens: ThemeTokens}) {
  return (
    <View style={[styles.builtinTag, {backgroundColor: `${tokens.primary}1A`}]}>
      <Text style={[styles.builtinTagText, {color: tokens.primary}]}>内置</Text>
    </View>
  );
}

/** 帮助弹窗一段说明：小标题 + 一句话。 */
function HelpSection({
  title,
  body,
  tokens,
}: {
  title: string;
  body: string;
  tokens: {text: string; textSecondary: string};
}) {
  return (
    <View style={styles.helpSection}>
      <Text style={[styles.helpSectionTitle, {color: tokens.text}]}>{title}</Text>
      <Text style={[styles.helpSectionBody, {color: tokens.textSecondary}]}>
        {body}
      </Text>
    </View>
  );
}

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
  // 屏级 override：自动带 ownerRouteKey，转场期间不泄漏到相邻屏 header。
  const setStackOverride = useStackOverrideSetter();
  /** 行菜单当前指向的引擎（undefined = 收起）。 */
  const [menuEngineId, setMenuEngineId] = useState<EngineId | undefined>();
  /** 排序写库进行中（互斥连点）。 */
  const [moving, setMoving] = useState(false);
  /** 使用说明弹窗开关（标题栏「?」按钮）。 */
  const [helpVisible, setHelpVisible] = useState(false);

  const dismissAllOverlays = useCallback(() => {
    setMenuEngineId(undefined);
    setHelpVisible(false);
  }, []);

  useDismissOverlaysOnBlur(dismissAllOverlays);

  // 标题栏菜单位换「?」帮助按钮（AppHeader 经 stackOverride 消费
  // menuIcon/onMenu，见 ProviderDetailScreen 标题 override 同一链路）。
  // 用 useFocusEffect 而非 useEffect：进入详情页再返回时，详情页的 cleanup
  // 会清空 header 覆盖，列表页须在重新聚焦时重设，否则「?」按钮丢失。
  useFocusEffect(
    useCallback(() => {
      setStackOverride({
        title: '搜索配置',
        showMenu: true,
        menuIcon: <HelpIcon color={tokens.text} />,
        onMenu: () => setHelpVisible(true),
      });
      return () => setStackOverride(undefined);
    }, [setStackOverride, tokens.text]),
  );

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
                item.engineId === 'duckduckgo' ? (
                  <BuiltinTag tokens={tokens} />
                ) : (
                  <ApiKeyStatusTag
                    status={item.configured ? 'set' : 'not set'}
                    tokens={tokens}
                  />
                )
              }
              onMenuPress={() => setMenuEngineId(item.engineId)}
            />
          )}
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
      {/* 使用说明弹窗：三段短文案（优先级 / 降级 / 密钥安全），无输入不避键盘。 */}
      <ModalShell
        visible={helpVisible}
        onClose={() => setHelpVisible(false)}
        variant="center"
        animationType="fade"
        panelStyle={styles.helpPanel}
      >
        <Text style={[styles.helpTitle, {color: tokens.text}]}>使用说明</Text>
        <HelpSection
          tokens={tokens}
          title="引擎优先级"
          body="列表顺序即搜索时尝试引擎的顺序，第一位为默认引擎；行菜单可上移/下移调整。未配置任何引擎时由内置 DuckDuckGo 免费兜底（无需密钥）。"
        />
        <HelpSection
          tokens={tokens}
          title="自动降级"
          body="请求失败（如密钥失效、超时）时自动尝试下一个已配置引擎，直到成功。"
        />
        <HelpSection
          tokens={tokens}
          title="密钥安全"
          body="API key 仅存本机安全密钥库，不进入会话记录，不随云同步上传。"
        />
        <Pressable
          onPress={() => setHelpVisible(false)}
          style={[
            styles.helpCloseRow,
            {borderTopColor: tokens.border},
          ]}
        >
          <Text style={{color: tokens.primary, fontWeight: '600'}}>知道了</Text>
        </Pressable>
      </ModalShell>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {alignItems: 'center', gap: 12, padding: 24},
  error: {textAlign: 'center', lineHeight: 20},
  helpPanel: {
    borderRadius: 16,
    width: '100%',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  helpTitle: {fontSize: 17, fontWeight: '600', marginBottom: 14},
  helpSection: {marginBottom: 12},
  helpSectionTitle: {fontSize: 14, fontWeight: '600', marginBottom: 2},
  helpSectionBody: {fontSize: 13, lineHeight: 19},
  helpCloseRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 2,
    paddingVertical: 10,
    alignItems: 'center',
  },
  builtinTag: {
    alignSelf: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  builtinTagText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
