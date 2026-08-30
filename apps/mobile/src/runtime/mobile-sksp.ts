/**
 * 移动端 SKSP 驱动平台选择（当前仅 Android 提供原生加密存储驱动）。
 */
import {Platform} from 'react-native';

export function mobileSkspDriverName(platform: string = Platform.OS): 'android' {
  if (platform === 'android') {
    return 'android';
  }
  throw new Error(`当前平台（${platform}）暂不支持加密存储驱动`);
}
