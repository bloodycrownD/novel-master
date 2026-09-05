/**
 * 数据统计页（Mobile）：Token 用量与缓存命中率。
 *
 * screens/C-4 拆分：本文件保留全部状态与数据链路（筛选、刷新、分页、
 * 钻取），展示层拆到 `token-usage/` 目录——
 * - `StatsFilterBar`：时间范围（今天/近 7 天/近 30 天/自定义）+ 模型
 *   筛选（含两个弹层）；
 * - `SummaryTab`（含 SummaryTile）：五指标卡 + 服务商×模型饼图；
 * - `DetailTab`：按天 StackedBars + 24 小时钻取（今天模式直出小时图）；
 * - `RequestsTab`：请求流水分页列表（与汇总/图表同窗口，模型/服务商
 *   筛选叠加，需求①勘误后）；
 * - `format.ts`：纯函数（hitRate/formatHitRate/resolveRangeDays 等）。
 *
 * - 「汇总 / 图表 / 流水」三页签（SegmentedControl）；筛选栏置顶，页签
 *   共享——切换页签不触发重查，筛选状态跨页签保留；
 * - 模型筛选（CR-2 方案 A）：配置组合选项之外，「{服务商} · 其他模型」与
 *   「未记录服务商」（provider_id IS NULL 的合并行，模型在不在配置集均归此）
 *   两类归并选项由 UI 侧补上，保证存量历史行都有选项可筛；
 * - 刷新单通道（useFocusEffect 依赖 reload，mobile/B-2）：主查询带请求
 *   序号守卫（cross/B-1），旧响应后到整体丢弃；失败落 loadError 常驻
 *   错误条且不渲染 0 兑底卡片（mobile/C-orch-2）；空态区分库全空
 *   （冷启动引导，拦全部页签）与范围内无数据（提示，mobile/A-1——范围
 *   空态拦全部页签：流水随时间窗口，需求①勘误后）；
 * - 流水跟随时间（需求①勘误后）：流水查询用含 range 的完整 filter
 *   （模型/服务商筛选叠加），时间或组合筛选变化均置流水脏标记并重拉
 *   （P1-2 勘误后不再豁免时间维度）；页签激活时拉取首页；失败也清脏
 *   标记避免无限重试（MF-1）。
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, ScrollView, Text, View} from 'react-native';
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
import type {
  PageTab,
  ProviderModelFilterValue,
  ProviderModelOption,
  RangeKind,
} from './token-usage/format';
import {
  isCustomRangeValid,
  resolveRangeDays,
  toLocalDayKey,
} from './token-usage/format';
import {styles} from './token-usage/styles';
import {StatsFilterBar} from './token-usage/StatsFilterBar';
import {SummaryTab} from './token-usage/SummaryTab';
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
  const [comboFilter, setComboFilter] =
    useState<ProviderModelFilterValue>(undefined);
  const [combos, setCombos] = useState<ProviderModelOption[]>([]);
  // providerId → 展示名（服务商已删除时缺失，展示层兑底「未知服务商」）。
  const [providerLabels, setProviderLabels] = useState<Record<string, string>>(
    {},
  );
  // 全量服务商（含未配置模型者，按展示名排序）：StatsFilterBar 据此生成
  // 每服务商的「{服务商} · 其他模型」归并选项。
  const [providers, setProviders] = useState<
    ReadonlyArray<{id: string; label: string}>
  >([]);
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [summary, setSummary] = useState<UsageStatsSummary | null>(null);
  const [dailyBuckets, setDailyBuckets] = useState<UsageStatsBucket[]>([]);
  const [modelRows, setModelRows] = useState<UsageStatsModelRow[]>([]);
  // 请求流水（分页）：dirty 标记随完整筛选（时间+组合）变化置位，流水页
  // 激活时拉取第一页
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

  // 服务商×模型筛选（provider 维度：provider_id 写入时快照，服务商改名/删除
  // 不回写历史行，解析不到展示名时归「未知服务商」）。对象三形态（配置组合 /
  // 服务商其他模型 / 未记录服务商）见 ProviderModelFilterValue，这里拆成
  // core UsageStatsFilter 的 model/providerId 两字段。
  const comboModel = comboFilter === undefined ? undefined : comboFilter.model;
  const comboProviderId =
    comboFilter === undefined ? undefined : comboFilter.providerId;
  // 主查询 filter：时间区间由 RangeKind 在应用层算出自然日闭区间
  // （resolveRangeDays：today={D,D}、last7={D-6,D}、last30={D-29,D}、
  // custom 由 MonthRangePickerSheet 结果产日期字符串），日偏移均为
  // 日历加法（DST 安全）。
  const filter = useMemo<UsageStatsFilter>(() => {
    return {
      range: resolveRangeDays(rangeKind, customFrom, customTo),
      model: comboModel,
      providerId: comboProviderId,
    };
  }, [rangeKind, customFrom, customTo, comboModel, comboProviderId]);

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
      // today 模式补选今天（P1-1）：补选必须写进本成功分支而非独立
      // effect——这里是重置 selectedDay 的唯一时机，独立 effect 的补选
      // 会被后到的成功回调抹掉（双端同构）；其余范围重置 null。
      setSelectedDay(rangeKind === 'today' ? toLocalDayKey(Date.now()) : null);
      setHourlyBuckets(null);
      setLoadError(null);
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
  }, [runtime, filter, rangeKind, showToast]);

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
        // 流水跟随时间（需求①勘误后）：查询用含 range 的完整 filter——
        // 与汇总/图表同窗口，模型/服务商筛选叠加。
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

  // 流水脏标记（P1-2·勘误后）：随完整 filter 变化置位——时间或模型/服务
  // 商组合筛选任一变化都置脏（首挂载一次与 useRef(true) 初始值同效），
  // 不再豁免时间维度。置位后若正停在流水页，由下方流水 effect 响应
  // loadRequests（依赖含 range 的 filter）引用变化重拉首页；在其他页签
  // 则等切回流水页时拉取。
  useEffect(() => {
    reqDirtyRef.current = true;
  }, [filter]);

  useEffect(() => {
    if (pageTab === 'requests' && reqDirtyRef.current && !reqLoading) {
      loadRequests(0).catch(() => undefined);
    }
  }, [pageTab, reqLoading, loadRequests]);

  // 服务商×模型选项：配置侧生成（providers.list + 逐服务商 savedModelRepo
  // .listByProvider）；「{服务商} · 其他模型」与「未记录服务商」两类
  // 归并选项由 UI 侧补上（语义见 ProviderModelFilterValue，覆盖存量行）。
  const reloadModels = useCallback(async () => {
    try {
      const providerList = await runtime.providers.list();
      const labels: Record<string, string> = {};
      const providerEntries: Array<{id: string; label: string}> = [];
      const options: ProviderModelOption[] = [];
      for (const p of providerList) {
        labels[p.id] = p.displayName;
        providerEntries.push({id: p.id, label: p.displayName});
        const saved = await runtime.savedModelRepo.listByProvider(p.id);
        for (const m of saved) {
          options.push({
            providerId: p.id,
            providerLabel: p.displayName,
            model: m.vendorModelId,
          });
        }
      }
      setProviderLabels(labels);
      setProviders(
        providerEntries.sort((a, b) => a.label.localeCompare(b.label)),
      );
      setCombos(
        options.sort(
          (a, b) =>
            a.providerLabel.localeCompare(b.providerLabel) ||
            a.model.localeCompare(b.model),
        ),
      );
    } catch {
      setCombos([]);
      setProviderLabels({});
      setProviders([]);
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
    // 跨度不设上限（PRD 明确不与查询成本耦合）；仅保 from ≤ to 兑底护栏
    //（sheet 点选自动排序，正常路径恒满足）。
    if (!isCustomRangeValid(from, to)) {
      showToast('自定义区间起始日不能晚于结束日');
      return;
    }
    setCustomFrom(from);
    setCustomTo(to);
    setRangeKind('custom');
    setRangeSheetVisible(false);
  };

  const providerLabelOf = (id: string) => providerLabels[id] ?? '未知服务商';
  const modelFilterLabel =
    comboFilter === undefined
      ? '全部模型'
      : comboFilter.providerId === null
      ? '未记录服务商'
      : comboFilter.model === null
      ? `${providerLabelOf(comboFilter.providerId)} · 其他模型`
      : `${providerLabelOf(comboFilter.providerId)} · ${comboFilter.model}`;

  const rangeLabel =
    rangeKind === 'custom' && customFrom && customTo
      ? `${customFrom.getMonth() + 1}/${customFrom.getDate()} — ${
          customTo.getMonth() + 1
        }/${customTo.getDate()}`
      : rangeKind === 'today'
      ? '今天'
      : rangeKind === 'last30'
      ? '近 30 天'
      : '近 7 天';

  // 空态区分（mobile/A-1）：库全空（listModels 为空且已落地一轮查询）显示
  // 冷启动引导，拦全部页签（流水同样无数据可翻）；范围内无数据提示
  // 「该区间无数据」，同样拦全部页签——流水随时间窗口（需求①勘误后），
  // 窗口空（库非空）时与其他页签统一显示区间空态。summary 非空条件避免
  // 首查在途时闪现空态。
  const libraryEmpty = combos.length === 0 && summary != null;
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
        comboFilter={comboFilter}
        combos={combos}
        providers={providers}
        onSelectComboFilter={setComboFilter}
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
            label: '图表',
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
        // 范围空态覆盖全部页签（需求①勘误后）：流水同样随时间窗口，
        // 窗口空（库非空）时与其他页签统一显示区间空态。
        <View style={styles.empty} testID="empty-range">
          <Text style={[styles.emptyText, {color: tokens.textSecondary}]}>
            该区间无数据
          </Text>
        </View>
      ) : pageTab === 'summary' ? (
        <SummaryTab
          summary={summary}
          modelRows={modelRows}
          providerLabels={providerLabels}
          rangeLabel={rangeLabel}
          tokens={tokens}
        />
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
      ) : (
        <DetailTab
          dailyBuckets={dailyBuckets}
          hourlyBuckets={hourlyBuckets}
          selectedDay={selectedDay}
          inspectedKey={inspectedKey}
          onSelectDay={setSelectedDay}
          onSetInspectedKey={setInspectedKey}
          tokens={tokens}
          todayMode={rangeKind === 'today'}
        />
      )}
    </ScrollView>
  );
}
