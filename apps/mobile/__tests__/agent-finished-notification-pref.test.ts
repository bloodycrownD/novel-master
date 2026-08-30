/**
 * 「生成结束通知」偏好读写单测（T-P6 偏好部分）。
 */
import {describe, expect, it, jest} from '@jest/globals';
import {
  readAgentFinishedNotificationEnabled,
  writeAgentFinishedNotificationEnabled,
} from '@/storage/agent-finished-notification-pref';
import type {AppUiPreferences} from '@/storage/app-ui-prefs';

function appUiWith(raw: Record<string, string | undefined>): AppUiPreferences {
  return {
    get: jest.fn(async (key: string) => raw[key]),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    listKeys: jest.fn(async () => []),
  };
}

describe('agent-finished-notification-pref', () => {
  it('未配置时默认开启', async () => {
    const appUi = appUiWith({});
    await expect(readAgentFinishedNotificationEnabled(appUi)).resolves.toBe(
      true,
    );
  });

  it('读取已持久化的关闭状态', async () => {
    const appUi = appUiWith({agentFinishedNotification: 'false'});
    await expect(readAgentFinishedNotificationEnabled(appUi)).resolves.toBe(
      false,
    );
  });

  it('写入按 true/false 字符串持久化', async () => {
    const appUi = appUiWith({});
    await writeAgentFinishedNotificationEnabled(appUi, false);
    expect(appUi.set).toHaveBeenCalledWith(
      'agentFinishedNotification',
      'false',
    );
    await writeAgentFinishedNotificationEnabled(appUi, true);
    expect(appUi.set).toHaveBeenCalledWith('agentFinishedNotification', 'true');
  });

  it('非法值回退默认（开）', async () => {
    const appUi = appUiWith({agentFinishedNotification: 'bogus'});
    await expect(readAgentFinishedNotificationEnabled(appUi)).resolves.toBe(
      true,
    );
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
    await expect(readAgentFinishedNotificationEnabled(appUi)).resolves.toBe(
      true,
    );
  });
});
