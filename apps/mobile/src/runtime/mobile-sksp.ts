/**
 * 移动端 SKSP 驱动平台选择（当前仅 Android 提供原生加密存储驱动）。
 */
import {Platform} from 'react-native';

export const MobileSksp = {
  driverName: (platform: string = Platform.OS): 'android' => {
    if (platform === 'android') {
      return 'android';
    }
    // nm-throw: keep — 平台边界：仅 Android 提供原生加密存储驱动（OS 能力差异）
    throw new Error(`当前平台（${platform}）暂不支持加密存储驱动`);
  },
} as const;
