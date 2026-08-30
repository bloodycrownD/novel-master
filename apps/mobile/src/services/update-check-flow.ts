/**
 * 自动更新检查编排（cr-fix-spec oq12/update-check-split）：
 * 偏好读取、snooze / 已忽略版本决策、结果持久化。
 * 纯逻辑零 React / 组件依赖，弹 toast、开详情 Alert 等表现由调用方注入。
 */
import type {AppUiPreferences} from '../storage/app-ui-prefs';
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

export type UpdateCheckResultKind = 'up-to-date' | 'error';

export type UpdateCheckSideEffects = {
  /** toast 通道（带「查看」动作按钮的场景）。 */
  readonly showToast: (
    message: string,
    options?: {actionLabel: string; onAction: () => void},
  ) => void;
  /** 展示版本详情（Alert + 外跳下载页），onLater 为「稍后」回调。 */
  readonly showUpdateDetail: (
    data: UpdateCheckData,
    onLater: () => void,
  ) => void;
  /** 首屏结果弹窗（已最新 / 检查失败）。 */
  readonly showResultModal: (kind: UpdateCheckResultKind) => void;
};

export async function runAutoUpdateCheckFlow(
  appUi: AppUiPreferences,
  fx: UpdateCheckSideEffects,
): Promise<void> {
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
        fx.showResultModal('up-to-date');
      }
      return;
    }

    if (data.status !== 'update-available') return;

    const dismissed = await readDismissedVersion(appUi);
    if (dismissed === data.remoteVersion) return;

    fx.showToast(`发现新版本 ${data.remoteVersion}`, {
      actionLabel: '查看',
      onAction: () => {
        fx.showUpdateDetail(data, () => {
          void writeDismissedVersion(appUi, data.remoteVersion);
        });
      },
    });
  } catch {
    // 持久化失败标记自身可能因同一存储故障 reject，显式吃掉，不再冒泡。
    await persistFailedUpdateCheck(appUi).catch(() => undefined);
    if (!snoozed) {
      fx.showResultModal('error');
    }
  }
}

/** 「今日不再提醒」：写入今日静音截止，弹窗关闭交给调用方。 */
export async function snoozeUpdateCheckToday(
  appUi: AppUiPreferences,
): Promise<void> {
  await writeSnoozeUntil(appUi);
}
