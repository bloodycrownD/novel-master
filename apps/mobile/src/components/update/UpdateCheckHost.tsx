/**
 * 自动更新检查宿主（cr-fix-spec oq12/update-check-split）：
 * 挂在 App 根（ToastHost 内、NavigationContainer 之外），
 * 负责注入 toast / 版本详情 Alert 并渲染首屏结果弹窗。
 */
import React, {useCallback} from 'react';
import {Alert, Linking} from 'react-native';
import {useToast} from '../chrome/ToastHost';
import {useAutoUpdateCheck} from '../../hooks/useAutoUpdateCheck';
import {toastMessage} from '../../errors/toast-message';
import type {UpdateCheckData} from '../../update-check/types';
import {UpdateCheckResultModal} from './UpdateCheckResultModal';

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

export function UpdateCheckHost() {
  const {showToast} = useToast();

  const showUpdateDetail = useCallback(
    (data: UpdateCheckData, onLater: () => void) => {
      showUpdateDetailAlert(data, onLater, showToast);
    },
    [showToast],
  );

  const {resultModal, closeResultModal, snoozeToday} = useAutoUpdateCheck({
    showToast,
    showUpdateDetail,
  });

  return (
    <UpdateCheckResultModal
      visible={resultModal != null}
      kind={resultModal ?? 'up-to-date'}
      onClose={closeResultModal}
      onSnoozeToday={snoozeToday}
    />
  );
}
