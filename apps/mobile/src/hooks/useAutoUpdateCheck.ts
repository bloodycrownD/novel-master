/**
 * Background update check: 2s after runtime ready, 24h throttle, dismiss per version.
 */

import {useEffect, useRef} from 'react';
import {Alert, Linking} from 'react-native';
import {useToast} from '../components/chrome/ToastHost';
import {useNovelMaster} from '../runtime/novel-master-context';
import {
  persistFailedUpdateCheck,
  persistUpdateCheckResult,
  readDismissedVersion,
  readLastCheckAt,
  readUpdatesAutoCheck,
  writeDismissedVersion,
} from '../storage/update-prefs';
import {checkForUpdates} from '../update-check/check-for-updates';
import type {UpdateCheckData} from '../update-check/types';

const AUTO_CHECK_DELAY_MS = 2000;
/** Minimum interval between automatic checks (24 hours). */
const AUTO_CHECK_THROTTLE_MS = 24 * 60 * 60 * 1000;

function isThrottled(lastCheckAt: string | undefined): boolean {
  if (!lastCheckAt) return false;
  const last = Date.parse(lastCheckAt);
  if (!Number.isFinite(last)) return false;
  return Date.now() - last < AUTO_CHECK_THROTTLE_MS;
}

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

export function useAutoUpdateCheck(): void {
  const {status, appUi} = useNovelMaster();
  const {showToast} = useToast();
  const ranRef = useRef(false);

  useEffect(() => {
    if (status !== 'ready' || !appUi || ranRef.current) return;
    ranRef.current = true;

    const timer = setTimeout(() => {
      void (async () => {
        const autoCheck = await readUpdatesAutoCheck(appUi);
        if (!autoCheck) return;

        const lastAt = await readLastCheckAt(appUi);
        if (isThrottled(lastAt)) return;

        try {
          const data = await checkForUpdates();
          await persistUpdateCheckResult(appUi, data);

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
        }
      })();
    }, AUTO_CHECK_DELAY_MS);

    return () => clearTimeout(timer);
  }, [status, appUi, showToast]);
}
