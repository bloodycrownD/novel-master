/**
 * 列表屏批量删除确认链路（screens/C-1）：Alert 确认 → 逐条删除 → onDone。
 *
 * - 逐条顺序删除，中途抛错即中断并 toast「删除失败」；已删的不回滚
 *  （部分成功语义，与 useChatTabScope.handleDeleteProjects 一致），onDone 不执行。
 * - 全部成功才调 onDone（退出批量模式 + reload 等），由各屏注入。
 */
import {useCallback} from 'react';
import {Alert} from 'react-native';
import {showAppToast} from '../services/app-toast';
import {toastMessage} from '../errors/toast-message';

export interface BatchDeleteConfirmOptions<T> {
  title: string;
  /** 确认弹窗正文；入参为本次待删条目（文案可按条目数/名称分化）。 */
  message: (items: readonly T[]) => string;
  /** 逐条删除；中途抛错即中断并 toast。 */
  deleteOne: (item: T) => Promise<void>;
  /** 全部删除成功后回调（退出批量模式 + reload 等）。 */
  onDone: () => void | Promise<void>;
}

export function useBatchDeleteConfirm<T>({
  title,
  message,
  deleteOne,
  onDone,
}: BatchDeleteConfirmOptions<T>) {
  return useCallback(
    (items: readonly T[]) => {
      if (items.length === 0) {
        return;
      }
      Alert.alert(title, message(items), [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            (async () => {
              for (const item of items) {
                await deleteOne(item);
              }
              await onDone();
            })().catch(err => showAppToast(toastMessage('删除失败', err)));
          },
        },
      ]);
    },
    [title, message, deleteOne, onDone],
  );
}
