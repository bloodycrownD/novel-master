/**
 * 卡片基础样式单源（cr-fix-spec comp-rest/C-7）：
 * radius16 / padding16 / margin(5,12) / hairline 边 / 浅阴影 / elevation2。
 * 之前在 ElevatedCard / ProfileMenuItem / ProfileSwitchItem / FormSectionCard
 * 四处逐字复制。
 */
import {StyleSheet, type TextStyle, type ViewStyle} from 'react-native';
import type {ThemeTokens} from '@/theme/tokens';

/** 卡片基础样式（无方向语义，纵向卡片如 FormSectionCard 用）。 */
export const card: ViewStyle = {
  marginHorizontal: 5,
  marginBottom: 12,
  padding: 16,
  borderRadius: 16,
  borderWidth: StyleSheet.hairlineWidth,
  shadowColor: '#000',
  shadowOffset: {width: 0, height: 1},
  shadowOpacity: 0.08,
  shadowRadius: 3,
  elevation: 2,
};

/** 横排卡片（列表行）：card + row 布局。 */
export const cardRow: ViewStyle = {
  ...card,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
};

/** 卡片表面配色（背景 + hairline 边色）。 */
export const cardSurface = (tokens: ThemeTokens): ViewStyle => ({
  backgroundColor: tokens.surfaceElevated,
  borderColor: tokens.borderLight,
});

/** 图标底座（44×44 圆角方块）。 */
export const iconWrap: ViewStyle = {
  width: 44,
  height: 44,
  borderRadius: 12,
  alignItems: 'center',
  justifyContent: 'center',
};

/** 右侧导航箭头。 */
export const chevron: TextStyle = {
  fontSize: 22,
  fontWeight: '300',
};
