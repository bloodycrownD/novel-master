/**
 * Background update check: 2s after runtime ready, first-screen result modal.
 * 薄 hook（cr-fix-spec oq12/update-check-split）：只做状态绑定与调度，
 * 检查/snooze/持久化决策在 services/update-check-flow，
 * modal 渲染在 components/update/UpdateCheckHost。
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {useNovelMaster} from '../runtime/novel-master-context';
import {toastMessage} from '../errors/toast-message';
import {
  runAutoUpdateCheckFlow,
  snoozeUpdateCheckToday,
  type UpdateCheckResultKind,
  type UpdateCheckSideEffects,
} from '../services/update-check-flow';

const AUTO_CHECK_DELAY_MS = 2000;

export type AutoUpdateCheckUi = Pick<
  UpdateCheckSideEffects,
  'showToast' | 'showUpdateDetail'
>;

export type AutoUpdateCheckController = {
  resultModal: UpdateCheckResultKind | null;
  closeResultModal: () => void;
  snoozeToday: () => Promise<void>;
};

export function useAutoUpdateCheck(ui: AutoUpdateCheckUi): AutoUpdateCheckController {
  const {status, appUi} = useNovelMaster();
  const [resultModal, setResultModal] = useState<UpdateCheckResultKind | null>(
    null,
  );
  const ranRef = useRef(false);
  // ui 由 Host 每次渲染重建，走 ref 取最新值，避免它进了 effect deps 后
  // 在 2s 定时窗口内因引用变化被 cleanup 掉定时器。
  const uiRef = useRef(ui);
  uiRef.current = ui;

  const closeResultModal = useCallback(() => {
    setResultModal(null);
  }, []);

  const snoozeToday = useCallback(async () => {
    if (!appUi) return;
    // 写入失败不关弹窗，toast 提示后用户可重试。
    try {
      await snoozeUpdateCheckToday(appUi);
      setResultModal(null);
    } catch (cause) {
      uiRef.current.showToast(toastMessage('设置失败', cause));
    }
  }, [appUi]);

  useEffect(() => {
    if (status !== 'ready' || !appUi || ranRef.current) return;
    ranRef.current = true;

    const timer = setTimeout(() => {
      void runAutoUpdateCheckFlow(appUi, {
        ...uiRef.current,
        showResultModal: setResultModal,
      });
    }, AUTO_CHECK_DELAY_MS);

    return () => clearTimeout(timer);
  }, [status, appUi]);

  return {resultModal, closeResultModal, snoozeToday};
}
