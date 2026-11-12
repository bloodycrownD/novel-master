/**
 * 搜索配置列表页：全部已知引擎（六预置 + 自定义实例 + DDG）按
 * `readConfig().engines` 动态渲染 + 行内启用开关 + 行菜单（上移/下移/
 * 删除自定义实例）+ 底部「新建自定义引擎」入口；点击行进详情页。
 *
 * 读写直接经 `getSearchConfigStore(runtime)`（core `createSearchConfigStore`
 * 装配）：对外状态只读配置读模型，不回显 key 明文。列表页不留长说明文案，
 * 开关语义 / 串行降级 / 模板说明 / 测试消耗配额 / 密钥安全收进标题栏
 * 「?」帮助弹窗。
 */
import React, {useCallback, useRef, useState} from 'react';
import {ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Switch, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {SearchConfigPublic} from '@novel-master/core';
import {ApiKeyStatusTag} from '@/components/provider/ApiKeyStatusTag';
import {BuiltinTag} from '@/components/provider/BuiltinTag';
import {BottomSheetMenu} from '@/components/sheet/BottomSheetMenu';
import {ConfigListCard} from '@/components/ui/ConfigListCard';
import {HelpIcon} from '@/components/icons/TabIcons';
import {ModalShell} from '@/components/ui/ModalShell';
import {SecondaryButton} from '@/components/ui/Buttons';
import {useDismissOverlaysOnBlur} from '@/hooks/useDismissOverlaysOnBlur';
import {useFocusListReload} from '@/hooks/useFocusListReload';
import {useRuntime} from '@/hooks/useRuntime';
import {useStackOverrideSetter} from '@/navigation/HeaderContext';
import type {RootStackParamList} from '@/navigation/types';
import {listScreenStyles} from '../shared/list-screen-styles';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {toastMessage} from '@/errors/toast-message';
import {getSearchConfigStore} from '@/services/search-config.store';
import {CUSTOM_ENGINE_HINT, ENGINE_HINTS, engineTitle} from './search-engine-meta';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type SearchEngineEntry = SearchConfigPublic['engines'][number];

/** 帮助弹窗一段说明：小标题 + 一句话。 */
function HelpSection({title, body, tokens}: {title: string; body: string; tokens: {text: string; textSecondary: string}}) {
  return (
    <View style={styles.helpSection}>
      <Text style={[styles.helpSectionTitle, {color: tokens.text}]}>{title}</Text>
      <Text style={[styles.helpSectionBody, {color: tokens.textSecondary}]}>{body}</Text>
    </View>
  );
}

const EMPTY_ROWS: readonly SearchEngineEntry[] = [];

export function SearchEnginesScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const searchStore = getSearchConfigStore(runtime);
  const navigation = useNavigation<Nav>();
  // 屏级 override：自动带 ownerRouteKey，转场期间不泄漏到相邻屏 header。
  const setStackOverride = useStackOverrideSetter();
  /** 行菜单当前指向的引擎（undefined = 收起）。 */
  const [menuEngineId, setMenuEngineId] = useState<string | undefined>();
  /** 排序写库进行中（互斥连点）。 */
  const [moving, setMoving] = useState(false);
  /** 开关写库进行中的引擎 id（互斥连点；用 ref 避免整表 disabled 态闪烁）。 */
  const togglingRef = useRef<string | undefined>(undefined);
  /** 待确认删除的自定义实例（undefined = 弹窗收起）。 */
  const [pendingDelete, setPendingDelete] = useState<string | undefined>();
  /** 删除写库进行中。 */
  const [deleting, setDeleting] = useState(false);
  /** 使用说明弹窗开关（标题栏「?」按钮）。 */
  const [helpVisible, setHelpVisible] = useState(false);

  const dismissAllOverlays = useCallback(() => {
    setMenuEngineId(undefined);
    setPendingDelete(undefined);
    setHelpVisible(false);
  }, []);

  useDismissOverlaysOnBlur(dismissAllOverlays);

  // 标题栏菜单位换「?」帮助按钮（AppHeader 经 stackOverride 消费
  // menuIcon/onMenu，见 ProviderDetailScreen 标题 override 同一链路）。
  // 用 useFocusEffect 而非 useEffect：进入详情页再返回时，详情页的 cleanup
  // 会清空 header 覆盖，列表页须在重新聚焦时重设，否则「?」按钮丢失。
  const syncHeaderOverride = useCallback(() => {
    setStackOverride({
      title: '搜索配置',
      showMenu: true,
      menuIcon: <HelpIcon color={tokens.text} />,
      onMenu: () => setHelpVisible(true),
    });
    return () => setStackOverride(undefined);
  }, [setStackOverride, tokens.text]);
  useFocusEffect(syncHeaderOverride);

  const {rows, loading, error, reload, setRows} = useFocusListReload({
    fetcher: useCallback(async () => (await searchStore.readConfig()).engines, [searchStore]),
    fallbackValue: EMPTY_ROWS,
  });

  // nm-style: keep-local — 行开关乐观翻转 + 失败回滚同一行数据，togglingRef
  // 互斥在途；内联进 renderItem 会拆散回滚不变量
  const setEnabled = async (engineId: string, on: boolean) => {
    if (togglingRef.current != null) {
      return;
    }
    togglingRef.current = engineId;
    setRows(current => current.map(row => (row.id === engineId ? {...row, enabled: on} : row)));
    try {
      await searchStore.setEnabled(engineId, on);
    } catch (cause) {
      setRows(current => current.map(row => (row.id === engineId ? {...row, enabled: !on} : row)));
      showToast(toastMessage('切换启用状态失败', cause));
    } finally {
      togglingRef.current = undefined;
    }
  };

  /** 上移（delta=-1）/ 下移（delta=+1）：交换相邻位后整单写库并重读。 */
  const moveEngine = async (engineId: string, delta: -1 | 1) => {
    if (moving) {
      return;
    }
    const order = rows.map(row => row.id);
    const index = order.indexOf(engineId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) {
      return;
    }
    [order[index], order[target]] = [order[target], order[index]];
    setMoving(true);
    try {
      await searchStore.setEngineOrder(order);
      // 重读刷新：顺序与各引擎状态以库内新值为准。
      await reload({silent: true});
    } catch (cause) {
      showToast(toastMessage('调整顺序失败', cause));
    } finally {
      setMoving(false);
    }
  };

  const menuRow = rows.find(row => row.id === menuEngineId);
  const menuIndex = menuRow == null ? -1 : rows.indexOf(menuRow);
  const deleteRow = rows.find(row => row.id === pendingDelete);
  // 删除确认文案提前拼好：模板串含 CJK 长文案，内联进 JSX 会被 prettier 拆行。
  let deleteNotice = '';
  if (pendingDelete != null) {
    // FIX-23：读模型 name 优先（拍板 5），静态表仅未知 id 兜底。
    const label = engineTitle(pendingDelete, deleteRow?.name);
    deleteNotice = `「${label}」的模板配置与已存密钥会一并清除，此操作不可撤销。`;
  }

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
          keyExtractor={item => item.id}
          contentContainerStyle={listScreenStyles.listContent}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
          renderItem={({item}) => {
            const hint = ENGINE_HINTS[item.id] ?? CUSTOM_ENGINE_HINT;
            // 开关本身已表达启停态，副标题只说「还缺什么才能用」。
            const issues = [...(item.needsKey && !item.hasKey ? ['未配置密钥'] : []), ...(item.needsBaseUrl ? ['未配置实例地址'] : [])];
            return (
              <ConfigListCard
                tokens={tokens}
                // DDG 是内置兜底引擎（无模板、无凭据、参数说明出厂固定），没有详情页：点击无反应。
                onPress={() => {
                  if (item.id === 'duckduckgo') {
                    return;
                  }
                  navigation.navigate('SearchEngineDetail', {
                    engineId: item.id,
                  });
                }}
                title={engineTitle(item.id, item.name)}
                subtitle={issues.length === 0 ? hint : `${hint} · ${issues.join(' · ')}`}
                trailingMeta={
                  <View style={styles.rowMeta}>
                    {item.id === 'duckduckgo' ? (
                      <BuiltinTag tokens={tokens} />
                    ) : item.needsKey ? (
                      <ApiKeyStatusTag status={item.hasKey ? 'set' : 'not set'} tokens={tokens} />
                    ) : item.needsBaseUrl ? (
                      <ApiKeyStatusTag status={item.baseUrl == null ? 'not set' : 'set'} tokens={tokens} />
                    ) : null}
                    <Switch
                      value={item.enabled}
                      onValueChange={next => {
                        setEnabled(item.id, next).catch(() => undefined);
                      }}
                      disabled={deleting}
                      trackColor={{false: tokens.border, true: tokens.primary}}
                    />
                  </View>
                }
                onMenuPress={() => setMenuEngineId(item.id)}
              />
            );
          }}
        />
      )}
      <View style={[styles.createBar, {borderTopColor: tokens.borderLight}]}>
        <SecondaryButton tokens={tokens} fullWidth label="新建自定义引擎" onPress={() => navigation.navigate('SearchEngineDetail')} disabled={deleting} />
      </View>
      <BottomSheetMenu
        visible={menuEngineId != null}
        title={menuRow && engineTitle(menuRow.id, menuRow.name)}
        items={[
          {label: '上移', action: 'up', disabled: menuIndex <= 0 || moving},
          {
            label: '下移',
            action: 'down',
            disabled: menuIndex < 0 || menuIndex >= rows.length - 1 || moving,
          },
          ...(menuRow?.isCustom === true
            ? [
                {
                  label: '删除',
                  action: 'delete',
                  danger: true,
                  disabled: moving || deleting,
                },
              ]
            : []),
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
          } else if (action === 'delete') {
            setPendingDelete(engineId);
          }
        }}
      />
      {/* 删除确认：自定义实例的模板 / 密钥 / 排序项一并清除，不可撤销。 */}
      <ModalShell visible={pendingDelete != null} onClose={() => setPendingDelete(undefined)} variant="center" animationType="fade" panelStyle={styles.helpPanel}>
        <Text style={[styles.helpTitle, {color: tokens.text}]}>删除自定义引擎</Text>
        <Text style={[styles.confirmBody, {color: tokens.textSecondary}]}>{deleteNotice}</Text>
        <View style={styles.confirmActions}>
          <View style={styles.confirmAction}>
            <SecondaryButton tokens={tokens} fullWidth label="取消" onPress={() => setPendingDelete(undefined)} disabled={deleting} />
          </View>
          <View style={styles.confirmAction}>
            <SecondaryButton
              tokens={tokens}
              fullWidth
              label={deleting ? '删除中…' : '删除'}
              onPress={async () => {
                if (pendingDelete == null || deleting) {
                  return;
                }
                setDeleting(true);
                try {
                  // core 同步 prune orderV2 / enabledEngines / baseUrl / SKSP ref。
                  await searchStore.deleteCustomEngine(pendingDelete);
                  showToast('已删除自定义引擎');
                  setPendingDelete(undefined);
                  await reload({silent: true});
                } catch (cause) {
                  showToast(toastMessage('删除失败', cause));
                } finally {
                  setDeleting(false);
                }
              }}
              disabled={deleting}
            />
          </View>
        </View>
      </ModalShell>
      {/* 使用说明弹窗：开关 / 优先级 / 模板 / 测试配额 / 密钥安全，无输入不避键盘。 */}
      <ModalShell visible={helpVisible} onClose={() => setHelpVisible(false)} variant="center" animationType="fade" panelStyle={styles.helpPanel}>
        <Text style={[styles.helpTitle, {color: tokens.text}]}>使用说明</Text>
        <HelpSection tokens={tokens} title="启用开关" body="只有打开开关的引擎参与搜索；默认仅内置 DuckDuckGo 启用。关闭全部引擎后搜索会返回提示，不会偷偷兜底。" />
        <HelpSection tokens={tokens} title="引擎优先级" body="列表顺序即搜索时尝试引擎的顺序；请求失败（如密钥失效、超时）自动尝试下一个已启用且配置完整的引擎。" />
        <HelpSection
          tokens={tokens}
          title="模板与自定义引擎"
          body={
            '预置引擎的请求模板可在详情页编辑并恢复默认；也可新建自定义引擎，用模板描述任意搜索 API。请求参数由 agent 调用时自行传（GET 自动拼查询串 / POST 并入请求体）；API Key 只在发送瞬间从本机密钥库注入，配置里只出现 {{apiKey}} 占位符。'
          }
        />
        <HelpSection tokens={tokens} title="密钥安全" body="API key 仅存本机安全密钥库，不进入会话记录，不随云同步上传。" />
        <Pressable onPress={() => setHelpVisible(false)} style={[styles.helpCloseRow, {borderTopColor: tokens.border}]}>
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
  rowMeta: {flexDirection: 'row', alignItems: 'center', gap: 8},
  createBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  confirmBody: {fontSize: 14, lineHeight: 21, marginBottom: 8},
  confirmActions: {flexDirection: 'row', gap: 12},
  confirmAction: {flex: 1},
});
