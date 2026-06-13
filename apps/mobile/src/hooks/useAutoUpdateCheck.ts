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
        void Linking.openURL(data.releaseUrl);
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
    await writeSnoozeUntil(appUi);
    setResultModal(null);
  }, [appUi]);

  useEffect(() => {
    if (status !== 'ready' || !appUi || ranRef.current) return;
    ranRef.current = true;

    const timer = setTimeout(() => {
      void (async () => {
        const autoCheck = await readUpdatesAutoCheck(appUi);
        if (!autoCheck) return;

        const snoozeUntil = await readSnoozeUntil(appUi);
        const snoozed = isSnoozed(snoozeUntil);

        try {
          const data = await checkForUpdates();
          await persistUpdateCheckResult(appUi, data);

          if (snoozed) return;

          if (data.status === 'up-to-date') {
            setResultModal('up-to-date');
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
              });
            },
          });
        } catch {
          await persistFailedUpdateCheck(appUi);
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
