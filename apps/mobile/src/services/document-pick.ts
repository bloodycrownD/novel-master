/**
 * 文档选择器通用封装。
 *
 * 用户取消在两端形态不同：iOS 上 pick() 直接 reject
 * （OPERATION_CANCELED，message 为英文 "user canceled..."），
 * Android 上 resolve 空数组。这里统一归一为返回 null，
 * 并弹中文 toast「已取消」，避免英文报错漏到调用方的 catch 里。
 */
import {errorCodes, isErrorWithCode, pick, type DocumentPickerOptions, type DocumentPickerResponse} from '@react-native-documents/picker';
import {AppToast} from './app-toast';

export namespace DocumentPick {
  /** 判定文档选择/保存错误是否为用户主动取消（iOS reject 形态）。 */
  export function isUserCancelled(error: unknown): boolean {
    return isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED;
  }

  /** 单选文档；用户取消返回 null（并提示「已取消」），其余错误原样抛出。 */
  export async function pickSingle(options: Pick<DocumentPickerOptions, 'type'>): Promise<DocumentPickerResponse | null> {
    let file: DocumentPickerResponse | undefined;
    try {
      [file] = await pick({type: options.type, allowMultiSelection: false});
    } catch (error) {
      if (isUserCancelled(error)) {
        AppToast.show('已取消');
        return null;
      }
      throw error;
    }
    if (file == null) {
      AppToast.show('已取消');
      return null;
    }
    return file;
  }
}
