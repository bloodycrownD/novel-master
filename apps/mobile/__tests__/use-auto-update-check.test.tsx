import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {UpdateCheckHost} from '@/components/update/UpdateCheckHost';

const {isSnoozed: isSnoozedActual} = jest.requireActual<
  typeof import('@/storage/update-prefs')
>('../src/storage/update-prefs');

const mockCheckForUpdates = jest.fn();
const mockReadUpdatesAutoCheck = jest.fn();
const mockReadSnoozeUntil = jest.fn();
const mockWriteSnoozeUntil = jest.fn();
const mockPersistUpdateCheckResult = jest.fn();
const mockPersistFailedUpdateCheck = jest.fn();
const mockReadDismissedVersion = jest.fn();
const mockWriteDismissedVersion = jest.fn();
const mockShowToast = jest.fn();

let modalProps: {
  visible?: boolean;
  kind?: string;
  onClose?: () => void;
  onSnoozeToday?: () => void | Promise<void>;
} | null = null;

jest.mock('@/runtime/novel-master-context', () => ({
  useNovelMaster: () => ({
    status: 'ready',
    appUi: {get: jest.fn(), set: jest.fn()},
  }),
}));

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('@/storage/update-prefs', () => ({
  isSnoozed: jest.requireActual('@/storage/update-prefs').isSnoozed,
  readUpdatesAutoCheck: (...args: unknown[]) =>
    mockReadUpdatesAutoCheck(...args),
  readSnoozeUntil: (...args: unknown[]) => mockReadSnoozeUntil(...args),
  writeSnoozeUntil: (...args: unknown[]) => mockWriteSnoozeUntil(...args),
  persistUpdateCheckResult: (...args: unknown[]) =>
    mockPersistUpdateCheckResult(...args),
  persistFailedUpdateCheck: (...args: unknown[]) =>
    mockPersistFailedUpdateCheck(...args),
  readDismissedVersion: (...args: unknown[]) =>
    mockReadDismissedVersion(...args),
  writeDismissedVersion: (...args: unknown[]) =>
    mockWriteDismissedVersion(...args),
}));

jest.mock('@/update-check/check-for-updates', () => ({
  checkForUpdates: (...args: unknown[]) => mockCheckForUpdates(...args),
}));

jest.mock('@/components/update/UpdateCheckResultModal', () => ({
  UpdateCheckResultModal: (props: typeof modalProps & object) => {
    modalProps = props;
    return null;
  },
}));

jest.mock('react-native', () => ({
  Alert: {alert: jest.fn()},
  Linking: {openURL: jest.fn()},
}));

function TestHost() {
  return <UpdateCheckHost />;
}

async function flushAutoCheck(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(2000);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useAutoUpdateCheck', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    modalProps = null;
    mockCheckForUpdates.mockClear();
    mockReadUpdatesAutoCheck.mockClear();
    mockReadSnoozeUntil.mockClear();
    mockWriteSnoozeUntil.mockClear();
    mockPersistUpdateCheckResult.mockClear();
    mockPersistFailedUpdateCheck.mockClear();
    mockReadDismissedVersion.mockClear();
    mockWriteDismissedVersion.mockClear();
    mockReadUpdatesAutoCheck.mockResolvedValue(true);
    mockReadSnoozeUntil.mockResolvedValue(undefined);
    mockReadDismissedVersion.mockResolvedValue(undefined);
    mockPersistUpdateCheckResult.mockResolvedValue(undefined);
    mockPersistFailedUpdateCheck.mockResolvedValue(undefined);
    mockWriteSnoozeUntil.mockResolvedValue(undefined);
    mockCheckForUpdates.mockResolvedValue({
      status: 'up-to-date',
      remoteVersion: '1.0.0',
    });
    mockShowToast.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows result modal when up-to-date and not snoozed', async () => {
    act(() => {
      TestRenderer.create(<TestHost />);
    });
    await flushAutoCheck();
    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1);
    expect(modalProps?.visible).toBe(true);
    expect(modalProps?.kind).toBe('up-to-date');
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('does not show modal while snooze is active but still checks', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockReadSnoozeUntil.mockResolvedValue(future);

    act(() => {
      TestRenderer.create(<TestHost />);
    });
    await flushAutoCheck();

    expect(mockCheckForUpdates).toHaveBeenCalled();
    expect(mockPersistUpdateCheckResult).toHaveBeenCalled();
    expect(modalProps?.visible).toBe(false);
  });

  it('shows modal again on next mount after close without snooze', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<TestHost />);
    });
    await flushAutoCheck();
    expect(modalProps?.visible).toBe(true);

    await act(async () => {
      modalProps?.onClose?.();
    });
    expect(modalProps?.visible).toBe(false);

    act(() => {
      renderer!.unmount();
      TestRenderer.create(<TestHost />);
    });
    await flushAutoCheck();
    expect(mockCheckForUpdates).toHaveBeenCalled();
    expect(modalProps?.visible).toBe(true);
  });

  it('writes snooze and hides modal when user taps snooze', async () => {
    act(() => {
      TestRenderer.create(<TestHost />);
    });
    await flushAutoCheck();
    expect(modalProps?.visible).toBe(true);

    await act(async () => {
      await modalProps?.onSnoozeToday?.();
    });

    expect(mockWriteSnoozeUntil).toHaveBeenCalledTimes(1);
    expect(modalProps?.visible).toBe(false);
  });

  it('shows error modal when check fails and not snoozed', async () => {
    mockCheckForUpdates.mockRejectedValue(new Error('network'));

    act(() => {
      TestRenderer.create(<TestHost />);
    });
    await flushAutoCheck();

    expect(mockPersistFailedUpdateCheck).toHaveBeenCalledTimes(1);
    expect(modalProps?.visible).toBe(true);
    expect(modalProps?.kind).toBe('error');
  });

  it('update-available keeps toast flow without result modal', async () => {
    mockCheckForUpdates.mockResolvedValue({
      status: 'update-available',
      remoteVersion: '9.9.9',
      releaseUrl: 'https://example.com',
      releaseNotesExcerpt: '',
    });

    act(() => {
      TestRenderer.create(<TestHost />);
    });
    await flushAutoCheck();

    expect(modalProps?.visible).toBe(false);
    expect(mockShowToast).toHaveBeenCalledWith(
      '发现新版本 9.9.9',
      expect.objectContaining({actionLabel: '查看'}),
    );
  });

  it('update-available still shows toast while snooze is active', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockReadSnoozeUntil.mockResolvedValue(future);
    mockCheckForUpdates.mockResolvedValue({
      status: 'update-available',
      remoteVersion: '9.9.9',
      releaseUrl: 'https://example.com',
      releaseNotesExcerpt: '',
    });

    act(() => {
      TestRenderer.create(<TestHost />);
    });
    await flushAutoCheck();

    expect(mockCheckForUpdates).toHaveBeenCalled();
    expect(mockPersistUpdateCheckResult).toHaveBeenCalled();
    expect(modalProps?.visible).toBe(false);
    expect(mockShowToast).toHaveBeenCalledWith(
      '发现新版本 9.9.9',
      expect.objectContaining({actionLabel: '查看'}),
    );
  });

  it('B-5: readUpdatesAutoCheck reject 被兑住，走失败持久化与错误弹窗', async () => {
    mockReadUpdatesAutoCheck.mockRejectedValue(new Error('pref boom'));

    act(() => {
      TestRenderer.create(<TestHost />);
    });
    await flushAutoCheck();

    expect(mockPersistFailedUpdateCheck).toHaveBeenCalledTimes(1);
    expect(modalProps?.visible).toBe(true);
    expect(modalProps?.kind).toBe('error');
  });

  it('B-5: readSnoozeUntil reject 同样被兑住', async () => {
    mockReadSnoozeUntil.mockRejectedValue(new Error('snooze boom'));

    act(() => {
      TestRenderer.create(<TestHost />);
    });
    await flushAutoCheck();

    expect(mockPersistFailedUpdateCheck).toHaveBeenCalledTimes(1);
    expect(modalProps?.visible).toBe(true);
    expect(modalProps?.kind).toBe('error');
  });

  it('B-5: persistFailedUpdateCheck 自身 reject 不冒泡（显式 catch）', async () => {
    mockCheckForUpdates.mockRejectedValue(new Error('network'));
    mockPersistFailedUpdateCheck.mockRejectedValue(new Error('disk'));

    act(() => {
      TestRenderer.create(<TestHost />);
    });
    await flushAutoCheck();
    // 存储同源故障时错误弹窗仍要出现，且不产生 unhandled rejection
    expect(modalProps?.visible).toBe(true);
    expect(modalProps?.kind).toBe('error');
  });

  it('B-5: snooze 写入失败 toast 且弹窗保持打开', async () => {
    act(() => {
      TestRenderer.create(<TestHost />);
    });
    await flushAutoCheck();
    expect(modalProps?.visible).toBe(true);

    mockWriteSnoozeUntil.mockRejectedValueOnce(new Error('write fail'));
    await act(async () => {
      await modalProps?.onSnoozeToday?.();
    });

    expect(mockShowToast).toHaveBeenCalledWith('设置失败：write fail');
    expect(modalProps?.visible).toBe(true);
  });

  it('B-5: 前往下载外跳失败 toast（对齐 AboutScreen openLink）', async () => {
    mockCheckForUpdates.mockResolvedValue({
      status: 'update-available',
      remoteVersion: '9.9.9',
      releaseUrl: 'https://example.com',
      releaseNotesExcerpt: '',
    });

    act(() => {
      TestRenderer.create(<TestHost />);
    });
    await flushAutoCheck();

    // toast 的「查看」打开 Alert，再点「前往下载」触发 Linking.openURL
    const {Alert, Linking} = require('react-native');
    Alert.alert.mockClear();
    const toastOptions = mockShowToast.mock.calls[0]?.[1];
    expect(toastOptions?.onAction).toBeInstanceOf(Function);
    act(() => {
      toastOptions.onAction();
    });

    const buttons = Alert.alert.mock.calls[0]?.[2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const download = buttons?.find(b => b.text === '前往下载');
    expect(download?.onPress).toBeInstanceOf(Function);

    Linking.openURL.mockRejectedValueOnce(new Error('no browser'));
    await act(async () => {
      download.onPress?.();
      await Promise.resolve();
    });

    expect(Linking.openURL).toHaveBeenCalledWith('https://example.com');
    expect(mockShowToast).toHaveBeenCalledWith('无法打开链接：no browser');
  });
});

describe('isSnoozed', () => {
  it('returns true for future snoozeUntil', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isSnoozedActual(future)).toBe(true);
  });

  it('returns false for past snoozeUntil', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isSnoozedActual(past)).toBe(false);
  });
});
