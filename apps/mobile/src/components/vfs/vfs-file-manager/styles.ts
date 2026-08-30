/**
 * VfsFileManager 列表区样式（弹窗样式随各弹窗子组件拆出）。
 */
import {StyleSheet, type ViewStyle} from 'react-native';

export const vfsFileManagerStyles = StyleSheet.create({
  root: {flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navGroup: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8},
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  iconBtnDisabled: {opacity: 0.4},
  path: {flex: 1, fontFamily: 'monospace', fontSize: 13},
  toolbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  batchCheckCol: {
    width: 28,
    paddingLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  item: {flex: 1, flexDirection: 'row', alignItems: 'center', padding: 12},
  kind: {fontSize: 18, marginRight: 8},
  textBlock: {flex: 1, minWidth: 0},
  badge: {borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2},
  menuBtn: {paddingHorizontal: 12, paddingVertical: 8},
  empty: {textAlign: 'center', marginTop: 32},
});

/** VFS 批量栏沿用原 VfsBatchHeader 的间距（padding 12/10），以样式 prop 吸收差异。 */
export const vfsBatchHeaderWrapStyle: ViewStyle = {
  paddingHorizontal: 12,
  paddingVertical: 10,
};
