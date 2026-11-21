/**
 * 自动更新检查编排（cr-fix-spec oq12/update-check-split）：
 * 偏好读取、snooze / 已忽略版本决策、结果持久化。
 * 纯逻辑零 React / 组件依赖，弹 toast、开详情 Alert 等表现由调用方注入。
 */
import type {AppUiPreferences} from '../storage/app-ui-prefs';
import {UpdatePrefs} from '../storage/update-prefs';
import {AppUiPrefIo} from '../storage/app-ui-pref-io';
import {APP_UI_KEY_UPDATES_AUTO_CHECK} from '../storage/app-ui-keys';
import {CheckForUpdates} from '../update-check/check-for-updates';
import type {UpdateCheckData} from '@novel-master/core/common';
import {coreT} from '../i18n/core';

export type UpdateCheckResultKind = 'up-to-date' | 'error';

export type UpdateCheckSideEffects = {
  /** toast 通道（带「查看」动作按钮的场景）。 */
  readonly showToast: (message: string, options?: {actionLabel: string; onAction: () => void}) => void;
  /** 展示版本详情（Alert + 外跳下载页），onLater 为「稍后」回调。 */
  readonly showUpdateDetail: (data: UpdateCheckData, onLater: () => void) => void;
  /** 首屏结果弹窗（已最新 / 检查失败）。 */
  readonly showResultModal: (kind: UpdateCheckResultKind) => void;
};

export namespace UpdateCheckFlow {
  export async function run(appUi: AppUiPreferences, fx: UpdateCheckSideEffects): Promise<void> {
    // snoozed 提到失败收口外：读偏好失败时未知静音状态，按未静音处理，
    // 保证用户能看到失败反馈而不是静默吞错。
    let snoozed = false;
    // 失败收口（错误通道迁移四期）：读偏好失败（Result.err）与写持久化异常
    // （reject）共用同一终端——标记检查失败 + 弹错误结果。
    const fail = async (): Promise<void> => {
      // 持久化失败标记自身可能因同一存储故障 reject，显式吃掉，不再冒泡。
      await UpdatePrefs.persistFailedUpdateCheck(appUi).catch(() => undefined);
      if (!snoozed) {
        fx.showResultModal('error');
      }
    };
    // 读偏好的两步各兑住 infra rejection：已知失败沿 Result.err（下方判 ok），
    // 未预期异常（appUi.get reject）与 Result 失败同终端——fail 收口，不冒泡。
    let autoCheck: boolean;
    try {
      autoCheck = await AppUiPrefIo.readBoolPref(appUi, APP_UI_KEY_UPDATES_AUTO_CHECK, true);
    } catch {
      await fail();
      return;
    }
    if (!autoCheck) return;

    let snoozeResult: Awaited<ReturnType<typeof UpdatePrefs.readSnoozeUntil>>;
    try {
      snoozeResult = await UpdatePrefs.readSnoozeUntil(appUi);
    } catch {
      await fail();
      return;
    }
    if (!snoozeResult.ok) {
      await fail();
      return;
    }
    snoozed = UpdatePrefs.isSnoozed(snoozeResult.value);

    try {
      const checked = await CheckForUpdates.check();
      // 已知失败（版本比较非法）沿 Result.err 与未预期异常同终端——fail 收口
      // （错误通道迁移六期）；网络等未知异常仍走下方 catch。
      if (!checked.ok) {
        await fail();
        return;
      }
      const data = checked.value;
      await UpdatePrefs.persistUpdateCheckResult(appUi, data);

      if (data.status === 'up-to-date') {
        if (!snoozed) {
          fx.showResultModal('up-to-date');
        }
        return;
      }

      if (data.status !== 'update-available') return;

      const dismissed = await UpdatePrefs.readDismissedVersion(appUi);
      if (!dismissed.ok) {
        await fail();
        return;
      }
      if (dismissed.value === data.remoteVersion) return;

      fx.showToast(coreT({key: "ui.update.available_line", params: {version: data.remoteVersion}}), {
        actionLabel: coreT({key: "ui.common.view"}),
        onAction: () => {
          fx.showUpdateDetail(data, () => {
            void UpdatePrefs.writeDismissedVersion(appUi, data.remoteVersion);
          });
        },
      });
    } catch {
      await fail();
    }
  }

  /** 「今日不再提醒」：写入今日静音截止，弹窗关闭交给调用方。 */
  export async function snoozeToday(appUi: AppUiPreferences): Promise<void> {
    await UpdatePrefs.writeSnoozeUntil(appUi);
  }
}
