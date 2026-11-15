import {createAppUiPreferences} from '@/storage/app-ui-prefs';
import {
  readChatRichTextEnabled,
  writeChatRichTextEnabled,
} from '@/storage/chat-rich-text-pref';
import {AppError, Result} from '@novel-master/core/errors';
import type {KkvService} from '@novel-master/core/kkv';
import {APP_UI_KKV_MODULE} from '@/storage/app-ui-keys';

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
        return Result.err(
          new AppError('KKV_NOT_FOUND', {
            detail: `KKV key not found: ${module}/${key}`,
          }),
        );
      }
      return Result.ok(v);
    },
    async set(module: string, key: string, value: string) {
      data.set(compound(module, key), value);
    },
    async delete(module: string, key: string) {
      const k = compound(module, key);
      if (!data.has(k)) {
        return Result.err(
          new AppError('KKV_NOT_FOUND', {
            detail: `KKV key not found: ${module}/${key}`,
          }),
        );
      }
      data.delete(k);
      return Result.ok(undefined);
    },
  };
}

describe('chat-rich-text-pref', () => {
  it('defaults to false when key is missing', async () => {
    const prefs = createAppUiPreferences(createMemoryKkv());
    await expect(readChatRichTextEnabled(prefs)).resolves.toBe(false);
  });

  it('round-trips true after write', async () => {
    const prefs = createAppUiPreferences(createMemoryKkv());
    await writeChatRichTextEnabled(prefs, true);
    await expect(readChatRichTextEnabled(prefs)).resolves.toBe(true);
    await expect(prefs.listKeys()).resolves.toContain('chatRichText');
  });
});
