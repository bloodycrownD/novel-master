/**
 * 数据统计页（Mobile）：Token 用量与缓存命中率。
 *
 * screens/C-4 拆分：本文件保留全部状态与数据链路（筛选、刷新、分页、
 * 钻取），展示层拆到 `token-usage/` 目录——
 * - `StatsFilterBar`：时间范围 + 模型筛选（含两个弹层）；
 * - `SummaryTab`（含 SummaryTile/TodayCard）：五指标卡 + 今日卡 + 分模型列表；
 * - `DetailTab`：按天 StackedBars + 24 小时钻取；
 * - `RequestsTab`：请求流水分页列表；
 * - `format.ts`：纯函数（hitRate/formatHitRate/isCustomRangeValid 等）。
 *
 * - 「汇总 / 明细 / 流水」三页签（SegmentedControl）；筛选栏置顶，页签
 *   共享——切换页签不触发重查，筛选状态跨页签保留；
 * - 模型筛选（listModels 只返回非 NULL 模型名，「其他模型」选项由 UI 侧补上，
 *   对应 NULL + 非当前配置历史模型的归并口径）；
 * - 刷新单通道（useFocusEffect 依赖 reload，mobile/B-2）：主查询带请求
 *   序号守卫（cross/B-1），旧响应后到整体丢弃；失败落 loadError 常驻
 *   错误条且不渲染 0 兜底卡片（mobile/C-orch-2）；空态区分库全空
 *   （冷启动引导）与范围内无数据（提示 + 保留今日卡，mobile/A-1）；
 * - 流水页 dirty 标记随筛选变化置位，页签激活时拉取首页；失败也清脏
 *   标记避免无限重试（MF-1）。
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {
  UsageStatsBucket,
  UsageStatsFilter,
  UsageStatsModelRow,
  UsageStatsRequestRow,
  UsageStatsSummary,
} from '@novel-master/core/chat';
import {SegmentedControl} from '../../components/ui/SegmentedControl';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';
import type {PageTab, RangeKind} from './token-usage/format';
import {isCustomRangeValid} from './token-usage/format';
import {styles} from './token-usage/styles';
import {StatsFilterBar} from './token-usage/StatsFilterBar';
import {SummaryTab, TodayCard} from './token-usage/SummaryTab';
import {DetailTab} from './token-usage/DetailTab';
import {RequestsTab} from './token-usage/RequestsTab';

export function TokenUsageStatsScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();

  const [rangeKind, setRangeKind] = useState<RangeKind>('last7');
  const [customFrom, setCustomFrom] = useState<Date | null>(null);
  const [customTo, setCustomTo] = useState<Date | null>(null);
  const [rangeSheetVisible, setRangeSheetVisible] = useState(false);
  const [pageTab, setPageTab] = useState<PageTab>('summary');
  const [modelFilter, setModelFilter] = useState<string | null | undefined>(
    undefined,
  );
  const [models, setModels] = useState<string[]>([]);
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [summary, setSummary] = useState<UsageStatsSummary | null>(null);
  const [dailyBuckets, setDailyBuckets] = useState<UsageStatsBucket[]>([]);
  const [modelRows, setModelRows] = useState<UsageStatsModelRow[]>([]);
  // 请求流水（分页）：dirty 标记随筛选变化置位，流水页激活时拉取第一页
  const [reqRows, setReqRows] = useState<UsageStatsRequestRow[]>([]);
  const [reqTotal, setReqTotal] = useState(0);
  const [reqPage, setReqPage] = useState(0);
  const [reqLoading, setReqLoading] = useState(false);
  const reqDirtyRef = useRef(true);
  const reqSeqRef = useRef(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [hourlyBuckets, setHourlyBuckets] = useState<UsageStatsBucket[] | null>(
    null,
  );
  // 长按详情：记录当前长按检视的柱 key（daily/hourly 共用；详情以图下方
  // 固定行呈现而非浮层，规避长按与横向滚动的手势冲突）。
  const [inspectedKey, setInspectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // 首查失败/最近一轮失败的常驻错误文案（mobile/C-orch-2）：成功后清除；
  // 失败且无旧数据时内容区整体让位给错误条，不渲染 0 兜底卡片。
  const [loadError, setLoadError] = useState<string | null>(null);
  // 主查询请求序号（cross/B-1）：快速切筛选时旧响应可能后到，落地前校验
  // 序号，过期响应（含报错与 loading 复位）整体丢弃，不覆盖新一轮数据。
  const reloadSeqRef = useRef(0);

  const filter = useMemo<UsageStatsFilter>(() => {
    // 自定义区间：from 为所选日 0 点，to 取结束日次日 0 点（含结束日全天，
    // 与 last7/last30 的「覆盖到本地明日 0 点」口径一致）。
    if (rangeKind === 'custom' && customFrom && customTo) {
      return {
        range: {
          kind: 'custom',
          fromMs: customFrom.getTime(),
          // 日历加法取次日 0 点：固定毫秒加法在 DST 切换日会差 1 小时。
          toMs: new Date(
            customTo.getFullYear(),
            customTo.getMonth(),
            customTo.getDate() + 1,
          ).getTime(),
        },
        model: modelFilter,
      };
    }
    return {range: {kind: rangeKind}, model: modelFilter};
  }, [rangeKind, customFrom, customTo, modelFilter]);

  // 页签切换只切换展示，不参与 filter/reload 依赖——筛选跨页签保留、不重查。
  const reload = useCallback(async () => {
    const seq = ++reloadSeqRef.current;
    setLoading(true);
    try {
      const usage = runtime.usageStats;
      const [nextSummary, nextBuckets, nextRows] = await Promise.all([
        usage.getSummary(filter),
        usage.getDailyBuckets(filter),
        usage.getModelBreakdown(filter),
      ]);
      if (seq !== reloadSeqRef.current) {
        return; // 过期响应：新一轮查询已在途，丢弃本轮结果。
      }
      setSummary(nextSummary);
      setDailyBuckets(nextBuckets);
      setModelRows(nextRows);
      setSelectedDay(null);
      setHourlyBuckets(null);
      setLoadError(null);
      // 流水页数据随筛选变化标脏，切回/停留在流水页时重拉第一页
      reqDirtyRef.current = true;
    } catch (err) {
      if (seq !== reloadSeqRef.current) {
        return; // 过期请求的报错不覆盖新一轮状态。
      }
      const message = toastMessage('加载统计失败', err);
      setLoadError(message);
      showToast(message);
    } finally {
      if (seq === reloadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [runtime, filter, showToast]);

  // 刷新单通道（mobile/B-2）：只挂 useFocusEffect（依赖 reload），不再并挂
  // useEffect——挂载由首焦覆盖，筛选变化由 reload 引用刷新驱动，避免双通道
  // 重复三连查询放大 cross/B-1 竞态窗口（与 StorageConfigScreen 惯例一致）。
  useFocusEffect(
    useCallback(() => {
      reload().catch(() => undefined);
    }, [reload]),
  );

  // 流水页分页加载：页签激活且数据标脏时拉第一页；翻页/点页码按页号取整页替换。
  const PAGE_SIZE = 10;
  const loadRequests = useCallback(
    async (page: number) => {
      const seq = ++reqSeqRef.current;
      setReqLoading(true);
      try {
        const result = await runtime.usageStats.listRequestUsage(filter, {
          offset: page * PAGE_SIZE,
          limit: PAGE_SIZE,
        });
        if (seq !== reqSeqRef.current) {
          return;
        }
        setReqRows([...result.rows]);
        setReqTotal(result.total);
        setReqPage(page);
        reqDirtyRef.current = false;
      } catch (err) {
        if (seq === reqSeqRef.current) {
          // 失败也要清脏标记：否则 reqLoading 复位会再次触发 effect，
          // 条件仍满足导致无限重试；重试交给用户切页签/改筛选触发（MF-1）。
          reqDirtyRef.current = false;
          showToast(toastMessage('加载流水失败', err));
        }
      } finally {
        if (seq === reqSeqRef.current) {
          setReqLoading(false);
        }
      }
    },
    [runtime, filter, showToast],
  );

  useEffect(() => {
    if (pageTab === 'requests' && reqDirtyRef.current && !reqLoading) {
      loadRequests(0).catch(() => undefined);
    }
  }, [pageTab, reqLoading, loadRequests]);

  // 模型选项：listModels 只返回非 NULL 模型名，「其他模型」选项由 UI 侧补上
  //（DEV-1，spec T-S5/AC-11；语义 = NULL + 非当前配置历史模型归并）。
  const reloadModels = useCallback(async () => {
    try {
      setModels(await runtime.usageStats.listModels());
    } catch {
      setModels([]);
    }
  }, [runtime]);

  useFocusEffect(
    useCallback(() => {
      reloadModels().catch(() => undefined);
    }, [reloadModels]),
  );

  // 选中天后加载 24 小时桶（只应用模型筛选，时间由天本身界定）。
  useEffect(() => {
    if (selectedDay == null) {
      setHourlyBuckets(null);
      return;
    }
    let cancelled = false;
    runtime.usageStats
      .getHourlyBuckets(selectedDay, filter)
      .then(buckets => {
        if (!cancelled) {
          setHourlyBuckets(buckets);
        }
      })
      .catch(err => {
        if (!cancelled) {
          showToast(toastMessage('加载小时分布失败', err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDay, filter, runtime, showToast]);

  const onRangeKindChange = (value: RangeKind) => {
    if (value === 'custom') {
      // 打开区间选择 sheet；确认成功后才切换到 custom（取消则保持原范围）。
      setRangeSheetVisible(true);
      return;
    }
    setRangeKind(value);
  };

  const onRangeConfirm = (from: Date, to: Date) => {
    if (!isCustomRangeValid(from, to)) {
      showToast('自定义区间最长 366 天');
      return;
    }
    setCustomFrom(from);
    setCustomTo(to);
    setRangeKind('custom');
    setRangeSheetVisible(false);
  };

  const modelFilterLabel =
    modelFilter === undefined
      ? '全部模型'
      : modelFilter === null
      ? '其他模型'
      : modelFilter;

  const rangeLabel =
    rangeKind === 'custom' && customFrom && customTo
      ? `${customFrom.getMonth() + 1}/${customFrom.getDate()} — ${
          customTo.getMonth() + 1
        }/${customTo.getDate()}`
      : rangeKind === 'last30'
      ? '近 30 天'
      : '近 7 天';

  // 空态区分（mobile/A-1）：库全空（listModels 为空且已落地一轮查询）显示
  // 冷启动引导；范围内无数据提示「该区间无数据」并保留今日卡。summary 非空
  // 条件避免首查在途时闪现空态。
  const libraryEmpty = models.length === 0 && summary != null;
  const rangeEmpty =
    summary != null && summary.calls === 0 && summary.totalTokens === 0;

  return (
    <ScrollView
      style={[styles.scroll, {backgroundColor: tokens.background}]}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      {/* 筛选栏置顶：时间范围 + 模型筛选，页签共享（状态由本层持有）。 */}
      <StatsFilterBar
        rangeKind={rangeKind}
        onRangeKindChange={onRangeKindChange}
        modelFilterLabel={modelFilterLabel}
        modelFilter={modelFilter}
        models={models}
        onSelectModelFilter={setModelFilter}
        rangeSheetVisible={rangeSheetVisible}
        onCloseRangeSheet={() => setRangeSheetVisible(false)}
        onConfirmRange={onRangeConfirm}
        modelPickerVisible={modelPickerVisible}
        onOpenModelPicker={() => setModelPickerVisible(true)}
        onCloseModelPicker={() => setModelPickerVisible(false)}
        tokens={tokens}
      />
      <SegmentedControl
        options={[
          {
            value: 'summary' as PageTab,
            label: '汇总',
            testID: 'stats-tab-summary',
          },
          {
            value: 'detail' as PageTab,
            label: '明细',
            testID: 'stats-tab-detail',
          },
          {
            value: 'requests' as PageTab,
            label: '流水',
            testID: 'stats-tab-requests',
          },
        ]}
        value={pageTab}
        onChange={setPageTab}
        tokens={tokens}
      />
      {loading ? <ActivityIndicator style={styles.loader} /> : null}
      {/* 常驻错误条（mobile/C-orch-2）：失败保留旧数据；首查失败无旧数据时
          内容区整体让位，不再渲染一排 0 值卡片。 */}
      {loadError != null ? (
        <View
          testID="load-error"
          style={[styles.errorBar, {borderColor: tokens.danger}]}
        >
          <Text style={{color: tokens.danger}}>{loadError}</Text>
        </View>
      ) : null}
      {loadError != null && summary == null ? null : libraryEmpty ? (
        <View style={styles.empty} testID="empty-cold-start">
          <Text style={[styles.emptyText, {color: tokens.textSecondary}]}>
            Token
            用量自记录功能上线起开始积累，发起对话后这里会展示统计；缓存命中率数据自本版本起开始记录；速率与首字延迟数据自本版本起开始积累。
          </Text>
        </View>
      ) : rangeEmpty ? (
        <View style={styles.empty} testID="empty-range">
          <Text style={[styles.emptyText, {color: tokens.textSecondary}]}>
            该区间无数据
          </Text>
          {/* 今日卡独立于筛选：范围空态下保留渲染。 */}
          <TodayCard summary={summary} tokens={tokens} />
        </View>
      ) : pageTab === 'requests' ? (
        <RequestsTab
          reqRows={reqRows}
          reqTotal={reqTotal}
          reqPage={reqPage}
          reqLoading={reqLoading}
          reqDirty={reqDirtyRef.current}
          onLoadRequests={loadRequests}
          tokens={tokens}
        />
      ) : pageTab === 'summary' ? (
        <SummaryTab
          summary={summary}
          modelRows={modelRows}
          rangeLabel={rangeLabel}
          tokens={tokens}
        />
      ) : (
        <DetailTab
          dailyBuckets={dailyBuckets}
          hourlyBuckets={hourlyBuckets}
          selectedDay={selectedDay}
          inspectedKey={inspectedKey}
          onSelectDay={setSelectedDay}
          onSetInspectedKey={setInspectedKey}
          tokens={tokens}
        />
      )}
    </ScrollView>
  );
}
