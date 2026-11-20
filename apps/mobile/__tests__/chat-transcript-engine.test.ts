/**
 * 引擎开关退役后的口径（chat-webview-unify Step 8 / Q1，2026-10-01 拍板）。
 *
 * 契约两条：**键照读**（`chatTranscriptEngine` 这个 KKV 键仍被读一次，
 * 让它有个显式消费点，别被后人当成漏改）、**值一律忽略**（历史版本写入的
 * `legacy-rn` 也照样按 `webview` 走）。
 */
import {ChatTranscriptEngine} from '@/storage/chat-transcript-engine';

describe('chat-transcript-engine（legacy-rn 已退役）', () => {
  it('默认恒为 webview', () => {
    expect(ChatTranscriptEngine.default()).toBe('webview');
  });

  it('KKV 留着 legacy-rn 也按 webview 走（值忽略）', async () => {
    const appUi = {
      get: jest.fn(async () => ({ok: true, value: 'legacy-rn'})),
    };
    expect(await ChatTranscriptEngine.read(appUi as never)).toBe('webview');
    // 键仍被读：读动作保留是为了留消费点，不是死代码
    expect(appUi.get).toHaveBeenCalledWith('chatTranscriptEngine');
  });

  it('KKV 未设 / 读失败都回落 webview', async () => {
    expect(
      await ChatTranscriptEngine.read({
        get: jest.fn(async () => ({ok: true, value: undefined})),
      } as never),
    ).toBe('webview');
    expect(
      await ChatTranscriptEngine.read({
        get: jest.fn(async () => ({
          ok: false,
          error: new Error('KKV 炸了'),
        })),
      } as never),
    ).toBe('webview');
  });

  it('appUi 缺失时也返回 webview（不抛）', async () => {
    expect(await ChatTranscriptEngine.read(null)).toBe('webview');
    expect(await ChatTranscriptEngine.read(undefined)).toBe('webview');
  });
});
