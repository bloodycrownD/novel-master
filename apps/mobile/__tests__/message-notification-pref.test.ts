/**
 * 「消息通知」总开关偏好读写单测（合并自原「生成结束通知」「常驻通知」
 * 两个偏好的测试形态，key 换 messageNotification、默认关）。
 */
import {describe, expect, it, jest} from '@jest/globals';
import {KkvError} from '@novel-master/core';
import type {KkvService} from '@novel-master/core/kkv';
import {
  readMessageNotificationEnabled,
  writeMessageNotificationEnabled,
} from '@/storage/message-notification-pref';
import {
  createAppUiPreferences,
  type AppUiPreferences,
} from '@/storage/app-ui-prefs';

function appUiWith(raw: Record<string, string | undefined>): AppUiPreferences {
  return {
    get: jest.fn(async (key: string) => raw[key]),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    listKeys: jest.fn(async () => []),
  };
}

/** 内存 KKV：get 对未写值抛 NOT_FOUND，驱动 createAppUiPreferences 走 defaults 回退。 */
function createMemoryKkv(): KkvService {
  const data = new Map<string, string>();
  const compound = (module: string, key: string) => `${module}\0${key}`;

  return {
    async listKeys(module: string) {
      const prefix = `${module}\0`;
      return [...data.keys()]
        .filter(k => k.startsWith(prefix))
        .map(k => k.slice(prefix.length));
    },
    async get(module: string, key: string) {
      const v = data.get(compound(module, key));
      if (v === undefined) {
        throw new KkvError('NOT_FOUND', 'missing', {module, key});
      }
      return v;
    },
    async set(module: string, key: string, value: string) {
      data.set(compound(module, key), value);
    },
    async delete(module: string, key: string) {
      const k = compound(module, key);
      if (!data.has(k)) {
        throw new KkvError('NOT_FOUND', 'missing', {module, key});
      }
      data.delete(k);
    },
  };
}

describe('message-notification-pref', () => {
  it('未配置时默认关闭', async () => {
    const appUi = appUiWith({});
    await expect(readMessageNotificationEnabled(appUi)).resolves.toBe(false);
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

  it('非法值回退默认（关）', async () => {
    const appUi = appUiWith({messageNotification: 'bogus'});
    await expect(readMessageNotificationEnabled(appUi)).resolves.toBe(false);
  });

  it('读失败（KKV 异常）回退默认（关）', async () => {
    const appUi: AppUiPreferences = {
      get: jest.fn(async () => {
        throw new Error('kkv down');
      }),
      set: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
      listKeys: jest.fn(async () => []),
    };
    await expect(readMessageNotificationEnabled(appUi)).resolves.toBe(false);
  });

  it('appUi 非 null 且 KKV 未写值：get 走 NOT_FOUND 回退 APP_UI_DEFAULTS，默认关', async () => {
    const appUi = createAppUiPreferences(createMemoryKkv());
    // 锁 defaults 表翻转：若 APP_UI_DEFAULTS 仍为 'true'，get 回退命中
    // readBoolPref 的 raw === 'true' 分支直返 true，本断言即挂。
    await expect(readMessageNotificationEnabled(appUi)).resolves.toBe(false);
  });
});
