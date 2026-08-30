import {
  readBoolPref,
  readEnumPref,
  writeBoolPref,
} from '@/storage/app-ui-pref-io';
import type {AppUiPreferences} from '@/storage/app-ui-prefs';

type GetResult = string | undefined;

function appUiWithGet(
  get: jest.Mock<Promise<GetResult>, [string]>,
): AppUiPreferences {
  return {
    get,
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    listKeys: jest.fn(async () => []),
  } as unknown as AppUiPreferences;
}

const ALLOWED = ['legacy-rn', 'webview'] as const;

describe('app-ui-pref-io readEnumPref', () => {
  it('returns the stored value when it is in the allowed list', async () => {
    const get = jest.fn(async () => 'legacy-rn');
    await expect(
      readEnumPref(appUiWithGet(get), 'chatTranscriptEngine', ALLOWED, 'webview'),
    ).resolves.toBe('legacy-rn');
    expect(get).toHaveBeenCalledWith('chatTranscriptEngine');
  });

  it('falls back to default on invalid stored value', async () => {
    const get = jest.fn(async () => 'nope');
    await expect(
      readEnumPref(appUiWithGet(get), 'chatTranscriptEngine', ALLOWED, 'webview'),
    ).resolves.toBe('webview');
  });

  it('falls back to default when appUi.get rejects', async () => {
    const get = jest.fn(async () => {
      throw new Error('kkv boom');
    });
    await expect(
      readEnumPref(appUiWithGet(get), 'chatTranscriptEngine', ALLOWED, 'webview'),
    ).resolves.toBe('webview');
  });

  it('falls back to default without touching KKV when appUi is null', async () => {
    const get = jest.fn(async () => 'legacy-rn');
    await expect(
      readEnumPref(null, 'chatTranscriptEngine', ALLOWED, 'webview'),
    ).resolves.toBe('webview');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('app-ui-pref-io readBoolPref', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])('parses stored %s', async (raw, expected) => {
    const get = jest.fn(async () => raw);
    await expect(
      readBoolPref(appUiWithGet(get), 'chatRichText', false),
    ).resolves.toBe(expected);
  });

  it('falls back to default on invalid stored value', async () => {
    const get = jest.fn(async () => 'yes');
    await expect(
      readBoolPref(appUiWithGet(get), 'chatRichText', false),
    ).resolves.toBe(false);
  });

  it('falls back to default when appUi.get rejects', async () => {
    const get = jest.fn(async () => {
      throw new Error('kkv boom');
    });
    await expect(
      readBoolPref(appUiWithGet(get), 'chatStreamBatchEnabled', true),
    ).resolves.toBe(true);
  });

  it('falls back to default without touching KKV when appUi is null', async () => {
    await expect(
      readBoolPref(undefined, 'chatStreamBatchEnabled', true),
    ).resolves.toBe(true);
  });
});

describe('app-ui-pref-io writeBoolPref', () => {
  it('persists true/false as strings', async () => {
    const set = jest.fn(async () => undefined);
    const appUi = {
      get: jest.fn(async () => undefined),
      set,
      delete: jest.fn(async () => undefined),
      listKeys: jest.fn(async () => []),
    } as unknown as AppUiPreferences;

    await writeBoolPref(appUi, 'chatRichText', true);
    await writeBoolPref(appUi, 'chatRichText', false);
    expect(set).toHaveBeenNthCalledWith(1, 'chatRichText', 'true');
    expect(set).toHaveBeenNthCalledWith(2, 'chatRichText', 'false');
  });

  it('rejects (and warns) when appUi.set fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const set = jest.fn(async () => {
      throw new Error('disk full');
    });
    const appUi = {
      get: jest.fn(async () => undefined),
      set,
      delete: jest.fn(async () => undefined),
      listKeys: jest.fn(async () => []),
    } as unknown as AppUiPreferences;

    await expect(writeBoolPref(appUi, 'chatRichText', true)).rejects.toThrow(
      'disk full',
    );
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
