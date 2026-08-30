/**
 * Background update check: 2s after runtime ready, first-screen result modal.
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Alert, Linking} from 'react-native';
import {useToast} from '../components/chrome/ToastHost';
import {
  UpdateCheckResultModal,
  type UpdateCheckResultKind,
} from '../components/update/UpdateCheckResultModal';
import {useNovelMaster} from '../runtime/novel-master-context';
import {toastMessage} from '../errors/toast-message';
import {
  isSnoozed,
  persistFailedUpdateCheck,
  persistUpdateCheckResult,
  readDismissedVersion,
  readSnoozeUntil,
  readUpdatesAutoCheck,
  writeDismissedVersion,
  writeSnoozeUntil,
} from '../storage/update-prefs';
import {checkForUpdates} from '../update-check/check-for-updates';
import type {UpdateCheckData} from '../update-check/types';

const AUTO_CHECK_DELAY_MS = 2000;

function showUpdateDetailAlert(
  data: UpdateCheckData,
  onLater: () => void,
  showToast: (message: string) => void,
): void {
  const message = data.releaseNotesExcerpt
    ? `v${data.remoteVersion}\n\n${data.releaseNotesExcerpt}\n\n将在浏览器中打开 GitHub 发行页下载。`
    : `v${data.remoteVersion}\n\n将在浏览器中打开 GitHub 发行页下载。`;

  Alert.alert('发现新版本', message, [
    {text: '取消', style: 'cancel'},
    {text: '稍后', onPress: onLater},
    {
      text: '前往下载',
      onPress: () => {
        // 对齐 AboutScreen openLink：外跳失败（无浏览器可处理等）toast 而非裸 rejection。
        void Linking.openURL(data.releaseUrl).catch(err =>
          showToast(toastMessage('无法打开链接', err)),
        );
      },
    },
  ]);
}

export function useAutoUpdateCheck(): React.ReactNode {
  const {status, appUi} = useNovelMaster();
  const {showToast} = useToast();
  const ranRef = useRef(false);
  const [resultModal, setResultModal] = useState<UpdateCheckResultKind | null>(
    null,
  );

  const handleCloseResultModal = useCallback(() => {
    setResultModal(null);
  }, []);

  const handleSnoozeToday = useCallback(async () => {
    if (!appUi) return;
    // 写入失败不关弹窗，toast 提示后用户可重试。
    try {
      await writeSnoozeUntil(appUi);
      setResultModal(null);
    } catch (cause) {
      showToast(toastMessage('设置失败', cause));
    }
  }, [appUi, showToast]);

  useEffect(() => {
    if (status !== 'ready' || !appUi || ranRef.current) return;
    ranRef.current = true;

    const timer = setTimeout(() => {
      void (async () => {
        // snoozed 提到 try 外：读偏好失败时未知静音状态，按未静音处理，
        // 保证用户能看到失败反馈而不是静默吞错。
        let snoozed = false;
        try {
          const autoCheck = await readUpdatesAutoCheck(appUi);
          if (!autoCheck) return;

          snoozed = isSnoozed(await readSnoozeUntil(appUi));

          const data = await checkForUpdates();
          await persistUpdateCheckResult(appUi, data);

          if (data.status === 'up-to-date') {
            if (!snoozed) {
              setResultModal('up-to-date');
            }
            return;
          }

          if (data.status !== 'update-available') return;

          const dismissed = await readDismissedVersion(appUi);
          if (dismissed === data.remoteVersion) return;

          showToast(`发现新版本 ${data.remoteVersion}`, {
            actionLabel: '查看',
            onAction: () => {
              showUpdateDetailAlert(data, () => {
                void writeDismissedVersion(appUi, data.remoteVersion);
              }, showToast);
            },
          });
        } catch {
          // 持久化失败标记自身可能因同一存储故障 reject，显式吃掉，不再冒泡。
          await persistFailedUpdateCheck(appUi).catch(() => undefined);
          if (!snoozed) {
            setResultModal('error');
          }
        }
      })();
    }, AUTO_CHECK_DELAY_MS);

    return () => clearTimeout(timer);
  }, [status, appUi, showToast]);

  return React.createElement(UpdateCheckResultModal, {
    visible: resultModal != null,
    kind: resultModal ?? 'up-to-date',
    onClose: handleCloseResultModal,
    onSnoozeToday: handleSnoozeToday,
  });
}
