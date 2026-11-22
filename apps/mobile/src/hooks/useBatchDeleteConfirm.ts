/**
 * 列表屏批量删除确认链路（screens/C-1）：Alert 确认 → 逐条删除 → onDone。
 *
 * - 逐条顺序删除，中途失败（`Result.err` 或 reject）即中断并 toast「删除失败」；
 *   已删的不回滚（部分成功语义，与 useChatTabScope.handleDeleteProjects 一致），
 *   onDone 不执行。
 * - 全部成功才调 onDone（退出批量模式 + reload 等），由各屏注入。
 */
import {useCallback} from 'react';
import {Alert} from 'react-native';
import type {Result} from '@novel-master/core/errors';
import {AppError} from '@novel-master/core/errors';
import {coreT} from '../i18n/core';
import {AppToast} from '../services/app-toast';
import {ToastMessage} from '../errors/toast-message';

interface BatchDeleteConfirmOptions<T> {
    title: string;
    /** 确认弹窗正文；入参为本次待删条目（文案可按条目数/名称分化）。 */
    message: (items: readonly T[]) => string;
    /** 逐条删除；已知失败走 `Result.err`（错误通道迁移四期），未知异常仍 reject。 */
    deleteOne: (item: T) => Promise<Result<void, AppError>>;
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
                {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
                {
                    text: coreT({key: "ui.common.delete"}),
                    style: 'destructive',
                    onPress: () => {
                        (async () => {
                            for (const item of items) {
                                const outcome = await deleteOne(item);
                                if (!outcome.ok) {
                                    AppToast.show(ToastMessage.toast(coreT({key: "ui.common.delete_failed"}), outcome.error));
                                    return;
                                }
                            }
                            await onDone();
                        })().catch(err => AppToast.show(ToastMessage.toast(coreT({key: "ui.common.delete_failed"}), err)));
                    },
                },
            ]);
        },
        [title, message, deleteOne, onDone],
    );
}
