/**
 * 列表屏共用样式四件套（screens/C-1）：root / listContent / loader / empty。
 * 各屏的局部差异样式（分组头、错误卡片、行样式等）仍留在自己的样式表里；
 * listContent 与默认不同的屏（如带分组间距的）也继续用自己的。
 */
import {StyleSheet} from 'react-native';

export const listScreenStyles = StyleSheet.create({
  root: {flex: 1},
  listContent: {paddingBottom: 24},
  loader: {marginTop: 32},
  empty: {textAlign: 'center', padding: 32},
});
