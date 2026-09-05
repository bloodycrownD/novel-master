import {StyleSheet} from 'react-native';

/**
 * 数据统计页共享样式（screens/C-4 拆分自主文件）。
 * 页签子组件与主屏共用一份 StyleSheet，避免多份拷贝漂移。
 */
export const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  loader: {
    marginVertical: 8,
  },
  errorBar: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  empty: {
    padding: 20,
    gap: 8,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  modelFilterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 12,
    marginVertical: 8,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    flexGrow: 1,
    flexBasis: '47%',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  tileWide: {
    flexBasis: '100%',
    marginTop: 10,
  },
  tileThird: {
    flexBasis: '31%',
  },
  tileThirdRow: {
    marginTop: 10,
  },
  chartCard: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  reqRow: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
    gap: 4,
  },
  reqRowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  reqRowDetail: {
    fontSize: 12,
    lineHeight: 17,
  },
  reqPager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  reqPagerBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  reqPagerLabel: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  reqPageNum: {
    minWidth: 30,
    minHeight: 28,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  reqPageGap: {
    fontSize: 12,
    lineHeight: 18,
  },
  tileLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  tileValue: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  todayCard: {
    gap: 8,
  },
  todayRow: {
    flexDirection: 'row',
    gap: 10,
  },
  todayMetric: {
    flex: 1,
    gap: 4,
  },
  dayDetail: {
    marginTop: 16,
    gap: 8,
  },
  dayDetailTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  dayDetailSummary: {
    fontSize: 12,
  },
  /* 长按详情固定行：图下方常驻展示，不用浮层（规避手势冲突） */
  inspectRow: {
    marginTop: 6,
  },
  inspectText: {
    fontSize: 12,
    lineHeight: 18,
  },
  modelRow: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
    marginBottom: 8,
  },
  modelRowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  modelRowDetail: {
    fontSize: 13,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  pickerSheet: {
    maxHeight: 420,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  // 选项列表区：在 maxHeight 内占据剩余空间并可滚动；paddingBottom 移到
  // 列表内容上，避免列表滚到底时被面板底部 padding 挡住最后一项。
  pickerList: {
    flexGrow: 1,
  },
  pickerListContent: {
    paddingBottom: 24,
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
});
