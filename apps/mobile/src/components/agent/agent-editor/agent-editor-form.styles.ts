/**
 * AgentEditorForm 拆分出的样式表（comp-rest/C-3）：
 * 内容原样搬自 AgentEditorForm.tsx 底部，未做任何数值调整。
 */
import {StyleSheet} from 'react-native';

export const styles = StyleSheet.create({
  unsavedWrap: {marginHorizontal: 5, paddingTop: 8},
  unsaved: {fontSize: 14, fontWeight: '600'},
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  invalidWrap: {flex: 1, padding: 16, justifyContent: 'center'},
  invalidCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    gap: 10,
  },
  invalidTitle: {fontSize: 15, fontWeight: '600', lineHeight: 21},
  invalidReason: {fontSize: 13, lineHeight: 19},
  invalidDetail: {fontSize: 11, lineHeight: 16},
  invalidActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 16,
    marginTop: 4,
  },
  hint: {fontSize: 13, lineHeight: 18},
  fieldHint: {fontSize: 12, lineHeight: 16, marginTop: -2},
  switchRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  yamlActions: {flexDirection: 'row', alignItems: 'center', gap: 16},
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 8,
    paddingTop: 2,
    gap: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  sectionHeadActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  blockList: {gap: 12},
  blockCard: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },

  chatSlotHint: {
    fontSize: 13,
    lineHeight: 20,
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    gap: 8,
    marginBottom: 2,
  },
  blockName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  blockHeaderSpacer: {flex: 1},
  blockActions: {flexDirection: 'row', gap: 4},
  emptyHint: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  actionBtn: {
    width: 28,
    height: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
