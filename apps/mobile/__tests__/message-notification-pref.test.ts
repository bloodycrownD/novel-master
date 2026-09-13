/**
 * 「消息通知」总开关偏好读写单测（合并自原「生成结束通知」「常驻通知」
 * 两个偏好的测试形态，key 换 messageNotification、默认开）。
 */
import {describe, expect, it, jest} from '@jest/globals';
import {
  readMessageNotificationEnabled,
  writeMessageNotificationEnabled,
} from '@/storage/message-notification-pref';
import type {AppUiPreferences} from '@/storage/app-ui-prefs';

function appUiWith(raw: Record<string, string | undefined>): AppUiPreferences {
  return {
    get: jest.fn(async (key: string) => raw[key]),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    listKeys: jest.fn(async () => []),
  };
}

describe('message-notification-pref', () => {
  it('未配置时默认开启', async () => {
    const appUi = appUiWith({});
    await expect(readMessageNotificationEnabled(appUi)).resolves.toBe(true);
  });

  it('读取已持久化的关闭状态', async () => {
    const appUi = appUiWith({messageNotification: 'false'});
    await expect(readMessageNotificationEnabled(appUi)).resolves.toBe(false);
  });

  it('写入按 true/false 字符串持久化', async () => {
    const appUi = appUiWith({});
    await writeMessageNotificationEnabled(appUi, false);
    expect(appUi.set).toHaveBeenCalledWith('messageNotification', 'false');
    await writeMessageNotificationEnabled(appUi, true);
    expect(appUi.set).toHaveBeenCalledWith('messageNotification', 'true');
  });

  it('非法值回退默认（开）', async () => {
    const appUi = appUiWith({messageNotification: 'bogus'});
    await expect(readMessageNotificationEnabled(appUi)).resolves.toBe(true);
  });

  it('读失败（KKV 异常）回退默认（开）', async () => {
    const appUi: AppUiPreferences = {
      get: jest.fn(async () => {
        throw new Error('kkv down');
      }),
      set: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
      listKeys: jest.fn(async () => []),
    };
    await expect(readMessageNotificationEnabled(appUi)).resolves.toBe(true);
  });
});
